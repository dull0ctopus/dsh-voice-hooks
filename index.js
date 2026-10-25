/**
 * Voice hooks for DeepSeek Harness.
 *
 * Three Claude Code-style hook events are bridged onto DSH extension seams:
 *
 *   Elicitation       <- user-questions/request
 *   PermissionRequest <- approval/request
 *   Stop              <- agent/status idle with an empty Host inbox
 *
 * The spoken text and sound file are plugin Config fields. The Voice Hooks
 * bundle page edits them, and the command for each event is generated from
 * those values. Hook commands are fire-and-forget observers: the DSH event
 * always continues, and the hook never answers a question, grants a
 * permission, or vetoes a turn.
 *
 * @module @local/voice-hooks
 */
import { spawn } from 'node:child_process'
import z from '@deepseek-ai/schemastery'

const DEFAULT_SOUND = '/System/Library/Sounds/Ping.aiff'
const DEFAULT_INPUT = 'Input required'
const DEFAULT_PERMISSION = 'Permission required'
const DEFAULT_FINISHED = 'DeepSeek finished'

const DEFAULT_TIMEOUT_MS = 60_000
const STDERR_LIMIT = 4_096

/**
 * Wait briefly after the agent becomes idle before speaking the completion
 * message. Input already queued in the Host inbox suppresses the timer
 * outright; this grace period also lets the UI hand over queued input it has
 * not submitted yet, which starts a new turn and cancels the notification.
 */
const IDLE_GRACE_MS = 1_500

/**
 * The visual configuration page reads these exact field names. Every field has
 * a default, so an empty row config still produces working hooks.
 */
export const Config = z.object({
  finished: z
    .string()
    .default(DEFAULT_FINISHED)
    .description('Text spoken when the session is idle and no queued input remains.')
    .volatile(),
  permissionRequired: z
    .string()
    .default(DEFAULT_PERMISSION)
    .description('Text spoken when DSH requests permission.')
    .volatile(),
  inputRequired: z
    .string()
    .default(DEFAULT_INPUT)
    .description('Text spoken when DSH asks the human for input.')
    .volatile(),
  sound: z
    .string()
    .default(DEFAULT_SOUND)
    .description('Sound file played before the spoken message. Leave empty to disable it.')
    .volatile(),
  preview: z
    .string()
    .default('')
    .description('Internal one-shot preview payload used by the Try buttons.')
    .volatile(),
})

/** The bridge needs the live-agent registry to tell a main-session turn from a subagent turn. */
export const inject = ['agents']

/**
 * Register the hook bridge and the bundle-page configuration policy.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {Record<string, unknown>} [config] - resolved voice-hook settings.
 */
export function apply(ctx, config) {
  const running = new Set()
  const idleTimers = new Map()
  const seenRunning = new Set()
  const clearIdleTimer = (id) => {
    const timer = idleTimers.get(id)
    if (timer === undefined) return
    clearTimeout(timer)
    idleTimers.delete(id)
  }
  // A plugin loaded mid-turn must still notify when that turn drains.
  for (const agent of ctx.agents.list()) {
    if (agent.status === 'running' && isRootAgent(ctx, agent)) seenRunning.add(agent.id)
  }

  ctx.effect(() => {
      const disposers = [
        // `true` prepends the observer, so it runs before the answerer that
        // claims the waterfall and would otherwise skip listeners after it.
        ctx.on(
          'user-questions/request',
          (request, next) => {
            dispatch('Elicitation', request)
            return next()
          },
          true,
        ),
        ctx.on(
          'approval/request',
          (request, next) => {
            dispatch('PermissionRequest', request)
            return next()
          },
          true,
        ),
        ctx.on('agent/status', ({ agent, status }) => {
          if (!isRootAgent(ctx, agent)) return
          const id = agent.id
          if (status === 'running') {
            seenRunning.add(id)
            clearIdleTimer(id)
            return
          }
          if (status !== 'idle' || !seenRunning.has(id)) return
          // Host-side queued input means this session is not finished. The
          // driver will move back to `running` when it claims the queue.
          if (agent.inbox?.hasPending === true) return
          clearIdleTimer(id)
          const timer = setTimeout(() => {
            idleTimers.delete(id)
            const live = ctx.agents.get(id)
            if (live === undefined || live !== agent) return
            if (live.status !== 'idle' || live.inbox?.hasPending === true) return
            dispatch('Stop', { agent: live })
          }, IDLE_GRACE_MS)
          timer.unref?.()
          idleTimers.set(id, timer)
        }),
        ctx.on('agent/disposed', ({ agent }) => {
          if (agent === undefined) return
          clearIdleTimer(agent.id)
          seenRunning.delete(agent.id)
        }),
      ]
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* the context may already be unwinding */
          }
        }
        for (const timer of idleTimers.values()) clearTimeout(timer)
        idleTimers.clear()
        seenRunning.clear()
      }
    })

  ctx.effect(() => () => {
    for (const child of running) {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
    }
    running.clear()
  })

  // The bundle page carries the configuration; keep a duplicate automatic
  // Settings page out of the composition. Best effort: older compositions may
  // not serve the settings service.
  ctx.inject(['settings'], (scope) => {
    ctx.effect(() => {
      try {
        return scope.settings.configure({ auto: false }, ctx.fiber)
      } catch (error) {
        warn(ctx, `could not set the configuration page policy: ${errorText(error)}`)
        return undefined
      }
    }, 'voice-hooks:settings-policy')

    // The Try buttons write a one-shot `preview` field through the settings
    // form. The settings document update is the signal to run it; the field is
    // cleared immediately so it cannot replay on a later reload.
    ctx.effect(
      () =>
        ctx.on('settings/document-updated', (ns) => {
          if (ns !== 'voice-hooks') return
          const raw = unwrap(config?.preview)
          if (typeof raw !== 'string' || raw === '') return
          const preview = readPreview(raw)
          if (preview !== undefined) {
            const command = buildCommand(preview.text, {
              sound: preview.sound,
            })
            if (command !== '') {
              try {
                runHook(command, 'Preview', { hook_event_name: 'Preview' }, process.cwd())
              } catch (error) {
                warn(ctx, `Preview failed: ${errorText(error)}`)
              }
            }
          }
          try {
            scope.settings
              .update('voice-hooks', { preview: '' })
              .catch((error) => warn(ctx, `could not clear the preview: ${errorText(error)}`))
          } catch (error) {
            warn(ctx, `could not clear the preview: ${errorText(error)}`)
          }
        }),
      'voice-hooks:preview',
    )
  })

  /**
   * Run one event's generated command without delaying the DSH event.
   *
   * @param {'Elicitation' | 'PermissionRequest' | 'Stop'} eventName - bridged event.
   * @param {unknown} source - the DSH payload.
   */
  function dispatch(eventName, source) {
    const current = readSettings(config)
    const message =
      eventName === 'Stop'
        ? current.finished
        : eventName === 'PermissionRequest'
          ? current.permissionRequired
          : current.inputRequired
    const command = buildCommand(message, current)
    if (command === '') return
    try {
      const payload = payloadFor(eventName, source, ctx)
      runHook(command, eventName, payload, payload.cwd)
    } catch (error) {
      warn(ctx, `${eventName} dispatch failed: ${errorText(error)}`)
    }
  }

  /**
   * Start the command without waiting for it. The shell owns the command
   * string, so `afplay ... & say ...` behaves as it does in a terminal.
   *
   * @param {string} command - the generated shell command.
   * @param {string} eventName - the bridged event that fired.
   * @param {Record<string, unknown>} payload - JSON payload written to stdin.
   * @param {string} cwd - working directory for the command.
   */
  function runHook(command, eventName, payload, cwd) {
    const isWindows = process.platform === 'win32'
    const file = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh'
    const args = isWindows ? ['/d', '/s', '/c', command] : ['-c', command]
    const env = {
      ...process.env,
      DSH_HOOK_EVENT: eventName,
      DSH_HOOK_CWD: cwd,
      ...(typeof payload.session_id === 'string' ? { DSH_SESSION_ID: payload.session_id } : {}),
    }

    let child
    try {
      child = spawn(file, args, {
        cwd,
        env,
        stdio: ['pipe', 'ignore', 'pipe'],
        detached: !isWindows,
        windowsHide: true,
      })
    } catch (error) {
      warn(ctx, `could not start the ${eventName} hook command: ${errorText(error)}`)
      return
    }

    running.add(child)

    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      warn(ctx, `${eventName} hook command exceeded ${DEFAULT_TIMEOUT_MS} ms; stopping its process group`)
      terminate(child)
    }, DEFAULT_TIMEOUT_MS)
    timer.unref?.()

    child.once('error', (error) => {
      clearTimeout(timer)
      running.delete(child)
      warn(ctx, `${eventName} hook command failed to start: ${errorText(error)}`)
    })

    child.stderr?.on('data', (chunk) => {
      if (stderr.length >= STDERR_LIMIT) return
      stderr += String(chunk).slice(0, STDERR_LIMIT - stderr.length)
    })

    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      running.delete(child)
      if (timedOut || signal !== null || code === 0 || code === null) return
      const detail = stderr.trim()
      warn(
        ctx,
        `${eventName} hook command exited with code ${code}${detail === '' ? '' : `: ${detail}`}`,
      )
    })

    // A command that ignores stdin exits first; EPIPE is expected, not an error.
    child.stdin?.on('error', () => {})
    try {
      child.stdin?.end(`${JSON.stringify(payload)}\n`)
    } catch (error) {
      warn(ctx, `could not write the ${eventName} payload to the hook command: ${errorText(error)}`)
    }
    child.unref?.()
  }
}

/**
 * Resolve the settings, tolerating an older row config that omitted a field.
 * Empty strings are meaningful: they disable the sound or the speech.
 *
 * @param {Record<string, unknown> | undefined} config - the row config.
 * @returns {{ finished: string, permissionRequired: string, inputRequired: string, sound: string }}
 */
function readSettings(config) {
  return {
    finished: textOf(config?.finished, DEFAULT_FINISHED),
    permissionRequired: textOf(config?.permissionRequired, DEFAULT_PERMISSION),
    inputRequired: textOf(config?.inputRequired, DEFAULT_INPUT),
    sound: textOf(config?.sound, DEFAULT_SOUND),
  }
}

/**
 * Unwrap a schemastery volatile value. Volatile Config fields reach a plugin
 * as a live wrapper with `get()` rather than as the plain scalar the form
 * stores, so every read must go through this helper.
 *
 * @param {unknown} value - configured value or volatile wrapper.
 * @returns {unknown} the current plain value.
 */
function unwrap(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

/**
 * Read one string setting, falling back only when the value is not a string.
 *
 * @param {unknown} value - configured value.
 * @param {string} fallback - value used when the field is absent or invalid.
 * @returns {string} trimmed configured value or the fallback.
 */
function textOf(value, fallback) {
  const plain = unwrap(value)
  return typeof plain === 'string' ? plain.trim() : fallback
}

/**
 * Parse a fresh Try-button preview payload. The timestamp keeps a stale
 * persisted payload from replaying after a restart.
 *
 * @param {unknown} value - the internal `preview` Config value.
 * @returns {{ text: string, sound: string } | undefined} the payload, or undefined when absent/stale/malformed.
 */
function readPreview(value) {
  const raw = unwrap(value)
  if (typeof raw !== 'string' || raw === '') return undefined
  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) return undefined
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > 5_000) return undefined
    if (typeof parsed.text !== 'string' || typeof parsed.sound !== 'string') {
      return undefined
    }
    return { text: parsed.text, sound: parsed.sound }
  } catch {
    return undefined
  }
}

/**
 * Build the shell command for one event from the configured text and sound.
 * Empty text or an empty sound path disables that part of the command.
 *
 * @param {string} message - spoken text.
 * @param {{ sound: string }} settings - resolved sound setting.
 * @returns {string} a shell command, or an empty string when nothing should run.
 */
function buildCommand(message, settings) {
  const text = typeof message === 'string' ? message.trim() : ''
  const parts = []

  if (settings.sound !== '') {
    parts.push(`afplay ${shellQuote(settings.sound)} &`)
  }
  if (text !== '') {
    parts.push(`say ${shellQuote(text)}`)
  }

  return parts.join(' ')
}

/**
 * Quote one argument for a POSIX shell, including embedded single quotes.
 *
 * @param {string} value - raw argument.
 * @returns {string} a single-quoted shell word.
 */
function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

/**
 * Build the JSON payload a hook command receives, from the DSH event without
 * leaking live objects such as AbortSignals or agents.
 *
 * @param {'Elicitation' | 'PermissionRequest' | 'Stop'} eventName - bridged event.
 * @param {unknown} source - the DSH payload.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context, for the session directory.
 * @returns {Record<string, unknown>} JSON-safe hook payload.
 */
function payloadFor(eventName, source, ctx) {
  const input = isRecord(source) ? source : {}
  const agent = isRecord(input.agent) ? input.agent : undefined
  const payload = {
    hook_event_name: eventName,
    cwd: sessionCwd(ctx, agent),
  }

  if (agent?.id !== undefined) payload.session_id = String(agent.id)

  if (eventName === 'Elicitation') {
    payload.tool_name = 'ask_user_question'
    payload.questions = normalizeQuestions(input.questions)
    const wait = isRecord(input.wait) ? input.wait : undefined
    if (wait?.callId !== undefined) payload.call_id = String(wait.callId)
    return payload
  }

  if (eventName === 'PermissionRequest') {
    if (input.toolName !== undefined) payload.tool_name = String(input.toolName)
    if (input.callId !== undefined) payload.call_id = String(input.callId)
    if (input.reason !== undefined) payload.reason = String(input.reason)
    if (isRecord(input.displayReason)) payload.display_reason = { ...input.displayReason }
    return payload
  }

  if (input.turn !== undefined) payload.turn = input.turn
  payload.stop_hook_active = false
  return payload
}

/**
 * Copy the fields of an ask_user_question batch that fit the hook payload;
 * unknown DSH-only fields are left out.
 *
 * @param {unknown} questions - the request's questions.
 * @returns {Array<Record<string, unknown>>} JSON-safe questions.
 */
function normalizeQuestions(questions) {
  if (!Array.isArray(questions)) return []
  const out = []
  for (const question of questions) {
    if (!isRecord(question)) continue
    const copy = {
      id: question.id,
      question: question.question,
    }
    if (question.detail !== undefined) copy.detail = question.detail
    if (question.header !== undefined) copy.header = question.header
    if (Array.isArray(question.options)) {
      copy.options = question.options
        .filter(isRecord)
        .map((option) => ({
          label: option.label,
          ...(option.description === undefined ? {} : { description: option.description }),
        }))
    }
    if (question.multiSelect !== undefined) copy.multiSelect = question.multiSelect
    out.push(copy)
  }
  return out
}

/**
 * Whether an agent is a live top-level session agent rather than a subagent.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {unknown} agent - the agent from the turn-stopping payload.
 * @returns {boolean} true for a main-session agent or when no registry is available.
 */
function isRootAgent(ctx, agent) {
  if (!isRecord(agent) || agent.id === undefined) return true
  try {
    return ctx.agents.roots().some((root) => root.id === agent.id)
  } catch {
    return true
  }
}

/**
 * The session's working directory, or the host process directory as a fallback.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown> | undefined} agent - the live agent.
 * @returns {string} the directory a hook command starts in.
 */
function sessionCwd(ctx, agent) {
  try {
    const session = agent?.session
    const service = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined
    if (session !== undefined && service !== undefined) {
      const cwd = service.get(session)
      if (typeof cwd === 'string' && cwd !== '') return cwd
    }
  } catch {
    /* optional service; fall through */
  }
  return process.cwd()
}

/**
 * Stop one command and, on POSIX, its detached process group.
 *
 * @param {import('node:child_process').ChildProcess} child - the shell process.
 */
function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return

  const signal = 'SIGTERM'
  try {
    if (process.platform !== 'win32' && typeof child.pid === 'number') {
      process.kill(-child.pid, signal)
    } else {
      child.kill(signal)
    }
  } catch {
    try {
      child.kill(signal)
    } catch {
      /* already gone */
    }
  }

  // A command that ignores SIGTERM must not survive its timeout forever.
  const force = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      if (process.platform !== 'win32' && typeof child.pid === 'number') {
        process.kill(-child.pid, 'SIGKILL')
      } else {
        child.kill('SIGKILL')
      }
    } catch {
      /* already gone */
    }
  }, 2_000)
  force.unref?.()
  child.once('exit', () => clearTimeout(force))
}

/**
 * Emit a diagnostic through the Harness logger when present, else stderr.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} message - diagnostic text.
 */
function warn(ctx, message) {
  const line = `[voice-hooks] ${message}`
  try {
    if (typeof ctx.logger?.warn === 'function') {
      ctx.logger.warn(line)
      return
    }
  } catch {
    /* fall through to console */
  }
  console.warn(line)
}

/**
 * Whether a value is a plain record.
 *
 * @param {unknown} value - candidate value.
 * @returns {value is Record<string, any>} true for non-array objects.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A short diagnostic for an unknown thrown value.
 *
 * @param {unknown} error - the thrown value.
 * @returns {string} its message or string form.
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}
