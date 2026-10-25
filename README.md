A DeepSeek Harness plugin that speaks configurable macOS messages when DSH needs your input, asks for permission, or finishes all pending work.

# Voice Hooks

## What it does

| When | Default message |
|---|---|
| DSH needs your input | `Input required` |
| DSH requests permission | `Permission required` |
| The session is idle and its queued work is done | `DeepSeek finished` |

Each message is spoken with macOS `say` using the system default voice. A
system sound (`afplay`) can play first. The finish message is session-level: it
waits until the session has no Host-side queued input and a short grace period
passes.

## Configure

Open **Plugins → Voice Hooks**.

- Edit the three messages and choose a **Sound** (or **None**).
- Press **Try** on a message to hear the current draft with the current sound,
  without saving.
- Press **Save** to apply.

The form is on the plugin's bundle page; there is no Components sub-page.

## Install

In **Plugins → Add plugin**, use the public HTTPS address:

```text
https://github.com/dull0ctopus/dsh-voice-hooks.git
```

SSH is also available when HTTPS is blocked:

```text
git+ssh://git@github.com/dull0ctopus/dsh-voice-hooks.git
```

After installation, enable the bundle. The Host half activates via HMR; a new
Client half needs one DSH app restart because its module metadata is cached. A
page refresh is enough for form-only changes.

## Notes

- macOS only (`afplay` and `say`).
- The Sound list is a snapshot of `/System/Library/Sounds` from this build.
- Try runs on the Host and needs the form to be writable.
- Unsent text in the composer is invisible to the Host, so the finish message
  cannot wait for it. Host-side queued input is respected.
- One finish message per idle transition; subagent activity is ignored.

## Development

```sh
node test/hook.test.mjs
node test/client.test.mjs
```

Install the local directory by absolute path with `plugin_manager`.
