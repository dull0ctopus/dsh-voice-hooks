**一个 DeepSeek Harness 插件**：在 DSH 需要你输入、请求权限或完成所有待处理任务时，朗读可配置的 macOS 提示。

# Voice Hooks（中文）

## 功能

| 时机 | 默认文本 |
|---|---|
| DSH 需要你输入 | `Input required` |
| DSH 请求权限 | `Permission required` |
| 会话空闲且排队工作完成 | `DeepSeek finished` |

每条消息通过 macOS `say` 使用系统默认语音朗读，可先播放系统音效（`afplay`）。完成提示是会话级的：会等待会话没有 Host 侧排队输入，并经过短暂宽限期。

## 配置

打开 **Plugins → Voice Hooks**。

- 编辑三条消息，并选择 **Sound**（或 **None**）。
- 点击消息旁的 **Try**，用当前草稿和当前音效试听，不会保存。
- 点击 **Save** 应用。

表单位于插件包页面，没有 Components 子页面。

## 安装

在 **Plugins → Add plugin** 中使用公开的 HTTPS 地址：

```text
https://github.com/dull0ctopus/dsh-voice-hooks.git
```

HTTPS 不可用时，也可以使用 SSH：

```text
git+ssh://git@github.com/dull0ctopus/dsh-voice-hooks.git
```

## 说明

- 仅支持 macOS。
- Sound 列表是构建时 `/System/Library/Sounds` 的快照。
- Try 在 Host 上执行，需要表单处于可写状态。
- 输入框中尚未发送的文本对 Host 不可见，因此完成提示无法等待它；Host 侧已排队的输入会被正确处理。
- 每次进入空闲只提示一次；忽略子代理活动。

---

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

## Notes

- macOS only
- The Sound list is a snapshot of `/System/Library/Sounds` from this build.
- Try runs on the Host and needs the form to be writable.
- Unsent text in the composer is invisible to the Host, so the finish message
  cannot wait for it. Host-side queued input is respected.
- One finish message per idle transition; subagent activity is ignored.
