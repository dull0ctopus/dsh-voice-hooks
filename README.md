# Voice Hooks for DSH

Speaks a configurable message when DeepSeek Harness needs you:

| Event | DSH seam | Default message |
|---|---|---|
| `Elicitation` | `user-questions/request` | `Input required` |
| `PermissionRequest` | `approval/request` | `Permission required` |
| `Stop` | `agent/status` idle with an empty Host inbox | `DeepSeek finished` |

The `Stop` message is session-level: it fires after the main session has run and
returned to idle with no Host-side queued input. A 1.5 s grace period also lets
input queued in the UI start a new turn and cancel the notification.

Each message has a configurable sound (`afplay`) and spoken text (`say`);
`say` uses the system default voice. The bridge is an observer: it never
answers a question, grants or denies a permission, or blocks a turn. Hook
output and exit codes are ignored; a non-zero exit is only logged as a
diagnostic.

## Where to configure

Open **Plugins → Voice Hooks**. The form is on the bundle page itself, above
**Components**; there is no second-level configuration page. The redundant
**Components** section is hidden on this bundle page; the bundle-level switch at
the top still enables or disables the plugin.

The form follows the built-in **Shell** settings page: values are staged, then
saved together.

| Field | Default | Meaning |
|---|---|---|
| **Session finished** | `DeepSeek finished` | Spoken when the session goes idle after work and its queued input is empty. |
| **Permission required** | `Permission required` | Spoken for `PermissionRequest`. |
| **Input required** | `Input required` | Spoken for `Elicitation`. |
| **Sound** | `/System/Library/Sounds/Ping.aiff` | A select of macOS system sound files. **None** disables the ping. |

Empty text disables that event's command. **None** for Sound disables only the
ping, not the spoken message. The Sound select is a build-time snapshot of
`/System/Library/Sounds`.

Each of the three message fields has a **Try** button. It runs the current
draft text with the current draft Sound through the Host's `afplay`/`say`,
without saving the row.

The generated command is equivalent to:

```sh
afplay '/System/Library/Sounds/Ping.aiff' & say 'Input required'
```

### YAML form

The installed bundle inserts:

```yaml
- insert:
    - id: voice-hooks
      name: '@local/voice-hooks'
      config:
        finished: DeepSeek finished
        permissionRequired: Permission required
        inputRequired: Input required
        sound: /System/Library/Sounds/Ping.aiff
```

Override the row later with the same fields (the form writes this override for
you). `config` is replaced wholesale, so restate every field you want to keep.

## Hook stdin and environment

Each command receives one JSON object on stdin:

```json
{
  "hook_event_name": "PermissionRequest",
  "cwd": "/path/to/session/workspace",
  "session_id": "…",
  "tool_name": "bash",
  "call_id": "…",
  "reason": "…"
}
```

`Elicitation` adds `questions` and `tool_name: "ask_user_question"`; `Stop`
adds `stop_hook_active: false` and, because it is session-level, no `turn`
field. The command also receives:

- `DSH_HOOK_EVENT`: `Elicitation`, `PermissionRequest`, or `Stop`
- `DSH_HOOK_CWD`: the command's working directory
- `DSH_SESSION_ID`: the session id, when known

Commands run with the Host process's environment and privileges, in the
session's working directory.

## Install

This repository is private, so use its SSH Git address in **Add plugin**:

```text
git+ssh://git@github.com/dull0ctopus/dsh-voice-hooks.git
```

DSH stores that dependency as `github:dull0ctopus/dsh-voice-hooks`. For a
public repository, the HTTPS form works without credentials:

```text
https://github.com/dull0ctopus/dsh-voice-hooks.git
```

This repository is the bundle: `package.json` declares `dsh.bundle.patch` and
the `voice-hooks` row. Installation selects the bundle; the Host half activates
via HMR. A new or changed Client half needs one DSH app restart: the Client
module graph caches each package's `dsh.client` metadata until restart. A page
refresh is enough while only the form's code is replaced.

For local development, install this directory by its absolute path with
`plugin_manager` instead. Verify the Host row with the read-only `Config`
Inspection provider (filter by `@local/voice-hooks`).

The Host schema is exported from `index.js`; the browser half is `client.js`
and registers the `plugins.bundle.config` page for `@local/voice-hooks`. The
Config fields are volatile so the DSH settings form can edit them live.

Unit test the bridge without a running Harness:

```sh
node test/hook.test.mjs
node test/client.test.mjs
```

Remove it with `plugin_manager` `remove_bundle` targeting
`@local/voice-hooks`.

## Known limits

- macOS only: the generated commands use `afplay` and `say`.
- The Sound list is a snapshot of what was installed when this plugin build
  was made. Sound files added later do not appear until the plugin is rebuilt.
- This is a notification bridge, not a permission policy: `PermissionRequest`
  cannot auto-allow or deny, and `Elicitation` cannot answer.
- `Elicitation` is DSH's ask-user seam, not MCP elicitation specifically.
- The plugin is profile-wide: a session-level `Stop` fires for every top-level
  session on this machine, not only the session currently in view.
- `Stop` covers main sessions only: one message per idle transition; subagent
  activity is ignored.
- Input still sitting in the composer or UI queue that has not reached the Host
  is invisible. The 1.5 s grace period catches input submitted immediately
  after the session becomes idle, but cannot wait for an unsent draft.
