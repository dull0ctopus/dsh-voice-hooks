import assert from 'node:assert/strict'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, Config } from '../index.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-voice-hooks-test-'))
const bin = join(root, 'bin')
const originalPath = process.env.PATH
const originalTestDir = process.env.VOICE_HOOKS_TEST_DIR
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const file = (name) => join(root, name)
const unwrap = (value) =>
  value !== null && typeof value === 'object' && typeof value.get === 'function'
    ? value.get()
    : value

await mkdir(bin, { recursive: true })
await writeFile(
  join(bin, 'say'),
  `#!/bin/sh
printf '%s\\n' "$*" >> "$VOICE_HOOKS_TEST_DIR/say.log"
cat > "$VOICE_HOOKS_TEST_DIR/$DSH_HOOK_EVENT.json"
`,
)
await writeFile(
  join(bin, 'afplay'),
  `#!/bin/sh
printf '%s\\n' "$*" >> "$VOICE_HOOKS_TEST_DIR/afplay.log"
`,
)
await chmod(join(bin, 'say'), 0o755)
await chmod(join(bin, 'afplay'), 0o755)
process.env.PATH = `${bin}:${originalPath ?? ''}`
process.env.VOICE_HOOKS_TEST_DIR = root

async function waitFor(path, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await delay(25)
    }
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function readJsonWhenReady(path, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const text = await readFile(path, 'utf8')
      if (text.trim() !== '') return JSON.parse(text)
    } catch {
      /* the file may exist before its writer flushed the payload */
    }
    await delay(25)
  }
  throw new Error(`timed out waiting for JSON ${path}`)
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function createContext() {
  const listeners = new Map()
  const sections = []
  const settingsCalls = []
  const settingsUpdates = []
  const warnings = []
  const effects = []
  const rootAgent = {
    id: 'root-1',
    session: {},
    status: 'idle',
    inbox: { hasPending: false },
  }
  const childAgent = {
    id: 'child-1',
    session: {},
    status: 'idle',
    inbox: { hasPending: false },
  }
  const ctx = {
    fiber: { id: 'voice-hooks-fiber' },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') effects.push(dispose)
      return dispose
    },
    on(event, listener, prepend) {
      const entry = { listener, prepend }
      listeners.set(event, entry)
      return () => {
        if (listeners.get(event) === entry) listeners.delete(event)
      }
    },
    agents: {
      roots: () => [rootAgent],
      list: () => [rootAgent, childAgent],
      get: (id) =>
        id === rootAgent.id ? rootAgent : id === childAgent.id ? childAgent : undefined,
    },
    get(name) {
      if (name === 'workingDirectory') {
        return { get: () => root }
      }
      return undefined
    },
    inject(_services, callback) {
      callback({
        settings: {
          configure(presentation, owner) {
            settingsCalls.push({ presentation, owner })
          },
          update(ns, patch) {
            settingsUpdates.push({ ns, patch })
            return Promise.resolve()
          },
        },
        systemPrompt: {
          section(section) {
            sections.push(section)
            return () => {}
          },
        },
      })
    },
    logger: {
      warn(message) {
        warnings.push(message)
      },
    },
  }
  return {
    ctx,
    listeners,
    sections,
    settingsCalls,
    settingsUpdates,
    warnings,
    effects,
    rootAgent,
    childAgent,
  }
}

// Schema defaults are what a row with no explicit values gets.
const defaults = Config({})
assert.equal(unwrap(defaults.sound), '/System/Library/Sounds/Ping.aiff')
assert.equal(unwrap(defaults.inputRequired), 'Input required')
assert.equal(unwrap(defaults.permissionRequired), 'Permission required')
assert.equal(unwrap(defaults.finished), 'DeepSeek finished')

const config = Config({
  sound: '/fake/Ping.aiff',
  inputRequired: 'Input required',
  permissionRequired: 'Permission required',
  finished: 'DeepSeek finished',
})
const { ctx, listeners, sections, settingsCalls, warnings, effects, rootAgent, childAgent } =
  createContext()
apply(ctx, config)

assert.equal(listeners.get('user-questions/request')?.prepend, true)
assert.equal(listeners.get('approval/request')?.prepend, true)
assert.ok(listeners.has('agent/status'))
assert.equal(settingsCalls.length, 1)
assert.deepEqual(settingsCalls[0].presentation, { auto: false })
assert.equal(settingsCalls[0].owner, ctx.fiber)
assert.equal(warnings.length, 0)

// Elicitation: the observer sees the request, calls next(), and speaks the
// configured text with the configured sound.
let nextCalls = 0
const questionAnswer = await listeners.get('user-questions/request').listener(
  {
    questions: [{ id: 'q1', header: 'Plan', question: 'Proceed?', options: [{ label: 'Yes' }] }],
    agent: { id: 'root-1', session: {} },
    wait: { callId: 'call-1' },
  },
  async () => {
    nextCalls += 1
    return { answers: [] }
  },
)
assert.deepEqual(questionAnswer, { answers: [] })
assert.equal(nextCalls, 1)

await waitFor(file('say.log'))
await waitFor(file('afplay.log'))
const elicitation = await readJsonWhenReady(file('Elicitation.json'))
assert.equal(elicitation.hook_event_name, 'Elicitation')
assert.equal(elicitation.session_id, 'root-1')
assert.equal(elicitation.tool_name, 'ask_user_question')
assert.equal(elicitation.call_id, 'call-1')
assert.equal(elicitation.cwd, root)
assert.equal(elicitation.questions[0].header, 'Plan')
assert.equal(elicitation.questions[0].options[0].label, 'Yes')
assert.match(await readFile(file('say.log'), 'utf8'), /Input required/)
assert.match(await readFile(file('afplay.log'), 'utf8'), /\/fake\/Ping\.aiff/)

// PermissionRequest: the observer preserves the answerer outcome.
const outcome = await listeners.get('approval/request').listener(
  {
    agent: { id: 'root-1', session: {} },
    toolName: 'Bash',
    callId: 'call-2',
    reason: 'sandbox escalation',
    displayReason: { en: 'Needs approval' },
  },
  async () => 'allowed-once',
)
assert.equal(outcome, 'allowed-once')
await waitFor(file('PermissionRequest.json'))
const permission = await readJsonWhenReady(file('PermissionRequest.json'))
assert.equal(permission.hook_event_name, 'PermissionRequest')
assert.equal(permission.session_id, 'root-1')
assert.equal(permission.tool_name, 'Bash')
assert.equal(permission.call_id, 'call-2')
assert.equal(permission.reason, 'sandbox escalation')
assert.deepEqual(permission.display_reason, { en: 'Needs approval' })
assert.match(await readFile(file('say.log'), 'utf8'), /Permission required/)

// Stop is session-level: one message after the root session becomes idle.
const status = (agent, next) => {
  agent.status = next
  listeners.get('agent/status').listener({ agent, status: next })
}

status(rootAgent, 'running')
status(rootAgent, 'idle')
assert.equal(
  await exists(file('Stop.json')),
  false,
  'the idle notification must wait for the grace period',
)
await waitFor(file('Stop.json'))
const stop = await readJsonWhenReady(file('Stop.json'))
assert.equal(stop.hook_event_name, 'Stop')
assert.equal(stop.session_id, 'root-1')
assert.equal(stop.turn, undefined)
assert.equal(stop.stop_hook_active, false)
assert.match(await readFile(file('say.log'), 'utf8'), /DeepSeek finished/)

// Host-side queued input suppresses the notification until the queue drains.
await rm(file('Stop.json'))
const drainStart = (await readFile(file('say.log'), 'utf8')).length
rootAgent.inbox.hasPending = true
status(rootAgent, 'running')
status(rootAgent, 'idle')
await delay(2_000)
assert.equal(await exists(file('Stop.json')), false, 'queued input must not notify')
assert.equal((await readFile(file('say.log'), 'utf8')).length, drainStart)
rootAgent.inbox.hasPending = false
status(rootAgent, 'running')
status(rootAgent, 'idle')
await waitFor(file('Stop.json'))

// A subagent idle transition must not fire the main-session Stop hook.
await rm(file('Stop.json'))
const childStart = (await readFile(file('say.log'), 'utf8')).length
status(childAgent, 'running')
status(childAgent, 'idle')
await delay(2_000)
assert.equal(await exists(file('Stop.json')), false)
assert.equal((await readFile(file('say.log'), 'utf8')).length, childStart)

// A new turn arriving inside the grace period cancels the notification.
status(rootAgent, 'running')
status(rootAgent, 'idle')
await delay(500)
status(rootAgent, 'running')
await delay(2_000)
assert.equal(
  await exists(file('Stop.json')),
  false,
  'a new turn must cancel the pending idle notification',
)

// Try preview: a fresh `preview` payload speaks the draft text and is cleared.
const previewContext = createContext()
const previewConfig = {
  sound: '/fake/Ping.aiff',
  inputRequired: 'Input',
  permissionRequired: 'Permission',
  finished: 'Finished',
  preview: JSON.stringify({
    text: 'Preview text',
    sound: '/fake/Ping.aiff',
    at: Date.now(),
  }),
}
apply(previewContext.ctx, previewConfig)
assert.ok(previewContext.listeners.has('settings/document-updated'))
previewContext.listeners.get('settings/document-updated').listener('voice-hooks', 1)
await waitFor(file('Preview.json'))
const previewCommand = await readJsonWhenReady(file('Preview.json'))
assert.equal(previewCommand.hook_event_name, 'Preview')
assert.match(await readFile(file('say.log'), 'utf8'), /Preview text/)
assert.deepEqual(previewContext.settingsUpdates, [
  { ns: 'voice-hooks', patch: { preview: '' } },
])
for (const dispose of previewContext.effects) {
  try {
    await dispose()
  } catch {
    /* already disposed */
  }
}

for (const dispose of effects) {
  try {
    await dispose()
  } catch {
    /* already disposed */
  }
}

if (originalPath === undefined) delete process.env.PATH
else process.env.PATH = originalPath
if (originalTestDir === undefined) delete process.env.VOICE_HOOKS_TEST_DIR
else process.env.VOICE_HOOKS_TEST_DIR = originalTestDir

await rm(root, { recursive: true, force: true })
console.log('voice-hooks: all assertions passed')
