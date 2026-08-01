# pi-notify

Configurable notifications for [Pi](https://github.com/badlogic/pi-mono). Notify through terminal-native protocols, launch commands through the platform shell or an explicit interpreter, run trusted JavaScript against Pi's public extension APIs, and optionally let the AI send a titled notification.

Inspired by [ferologics/pi-notify](https://github.com/ferologics/pi-notify).

## Features

- Uses Pi's public `agent_settled` event, so an idle notification is sent only after automatic retries, compaction, and queued continuations have settled.
- Observes `ask_user_question` through `tool_execution_start` without blocking or modifying the tool call.
- Loads global configuration plus optional trusted-project overrides.
- Supports terminal notifications through Windows Terminal toast, Kitty OSC 99, iTerm2 OSC 9, and OSC 777, including tmux passthrough.
- Preserves concise `cmd:` actions through the platform's default shell and supports `shell:` actions with an explicit interpreter.
- Runs trusted `js:` actions in-process with access to Pi's public extension API, the event context, and the complete event object.
- Optionally exposes `agent_notify({ title, content })` to the AI when the `pi_notify:agent_notify` hook has configured actions.
- Keeps terminal and command actions fire-and-forget while awaiting JavaScript actions. One action failure does not prevent later actions from being attempted.

## Requirements

- Pi 0.83.0 or newer with the public `agent_settled` and `tool_execution_start` events.
- Node.js 22.19.0 or newer.
- The `tool_execution_start:ask_user_question` key expects the model-visible tool name `ask_user_question`, used by [`@juicesharp/rpiv-ask-user-question`](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question).

## Install

Install directly from GitHub:

```bash
pi install git:github.com/xz-dev/pi-notify
```

Restart Pi after installation. To try a checkout without installing it:

```bash
pi -e /path/to/pi-notify/index.ts
```

## Configuration

The configuration is a JSON object from supported event keys to ordered arrays of actions. Most actions are strings; an explicit-interpreter action is a flat tuple whose first item selects the interpreter and whose remaining items are exact arguments:

```json
{
  "agent_settled": [
    "osc",
    "cmd:paplay /usr/share/sounds/freedesktop/stereo/complete.oga",
    ["shell:/bin/bash", "-lc", "my-notify-script"]
  ],
  "tool_execution_start:ask_user_question": [
    "osc:Pi|{{TOOL}} needs your input in {{CWD}}",
    "js:ctx.ui.notify(`Question in ${notification.cwd}`, 'info')"
  ],
  "pi_notify:agent_notify": [
    "osc:{{TITLE}}|{{CONTENT}}",
    ["shell:powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Write-Output $env:PI_NOTIFY_CONTENT"]
  ]
}
```

### Configuration files

1. Global: `$PI_CODING_AGENT_DIR/pi-notify.json`
   - Default: `~/.pi/agent/pi-notify.json`
2. Project: `<current Pi cwd>/.pi/pi-notify.json`
   - Read only when Pi reports the project as trusted.
   - A project value replaces the global value for the same event key.
   - Keys absent from the project file continue to use their global values.

A missing file is an empty configuration. Invalid JSON, unsupported keys, and invalid actions produce a non-blocking warning and are ignored.

### Supported event keys

| Key | When it fires |
| --- | --- |
| `agent_settled` | Pi is idle with no automatic retry, compaction, or queued continuation left to run. |
| `tool_execution_start:ask_user_question` | The `ask_user_question` tool starts executing. Other tools do not match. |
| `pi_notify:agent_notify` | The optional `agent_notify` AI tool is called. The tool is exposed only when this key contains at least one valid action. |

### Actions

| Action | Behavior |
| --- | --- |
| `osc` | Send the event's built-in terminal notification. |
| `osc:<title>|<body>` | Send a terminal notification with template-expanded title and body. Both sides of `|` must be non-empty. |
| `cmd:<shell command>` | Launch the command through the platform's default shell with the current Pi cwd and notification environment. The command must be non-empty. |
| `["shell:<interpreter>", "arg1", ...]` | Resolve one explicit interpreter and launch it directly with the remaining strings as exact arguments. At least one argument is required. |
| `js:<code>` | Await trusted JavaScript in the plugin process with `pi`, `ctx`, `event`, and `notification` in scope. The code must be non-empty. |

Actions are started in array order and every action is attempted even if an earlier one fails. `osc`, `cmd:`, and `shell:` are fire-and-forget; command completion order and exit status are intentionally not observed. `js:` is awaited. Lifecycle-hook failures produce non-blocking warnings. `agent_notify` reports an aggregated tool error after all actions are attempted if JavaScript, synchronous OSC delivery, or synchronous process startup failed. Errors emitted later by a detached child remain warning-only.

## Templates and command environment

`osc:<title>|<body>` templates use the environment-variable name without the `PI_NOTIFY_` prefix:

| Template | Command variable | Availability |
| --- | --- | --- |
| `{{EVENT}}` | `PI_NOTIFY_EVENT` | Always |
| `{{CWD}}` | `PI_NOTIFY_CWD` | Always |
| `{{SESSION_ID}}` | `PI_NOTIFY_SESSION_ID` | Always |
| `{{SESSION_FILE}}` | `PI_NOTIFY_SESSION_FILE` | Persistent sessions only |
| `{{TOOL}}` | `PI_NOTIFY_TOOL` | Tool events only |
| `{{TOOL_CALL_ID}}` | `PI_NOTIFY_TOOL_CALL_ID` | Tool events only |
| `{{TITLE}}` | `PI_NOTIFY_TITLE` | `agent_notify` only |
| `{{CONTENT}}` | `PI_NOTIFY_CONTENT` | `agent_notify` only |

If a template value is unavailable, its placeholder is preserved literally. For example, `{{TOOL}}` remains `{{TOOL}}` during `agent_settled`. A bare `osc` action under `pi_notify:agent_notify` uses the tool's title and content.

Pi currently exposes no public project-name field to extensions, so `PI_NOTIFY_PROJECT` is deliberately unset. The extension also removes all inherited `PI_NOTIFY_*` values before adding the current fixed context. Lifecycle tool arguments—including question text—are never copied into the command environment. A `js:` action intentionally receives the complete raw event, including tool arguments.

`cmd:` uses the platform shell (`/bin/sh` on Unix-like systems and `ComSpec`/`cmd.exe` on Windows). It is the shorthand for users who want to write only the shell program and do not need to choose an interpreter.

A `shell:` tuple bypasses the host shell and calls the interpreter directly with `shell: false`. pi-notify does not add `-c`, `/c`, `-Command`, or any other argument. It also does not split, join, expand, or otherwise reinterpret the argument strings. Supply every argument the chosen interpreter requires:

```json
{
  "agent_settled": [
    ["shell:/bin/bash", "-lc", "notify-send done"],
    ["shell:powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Write-Output done"]
  ]
}
```

Pipes, redirections, variable expansion, and other shell syntax work only when the selected interpreter is explicitly asked to process them, such as `/bin/bash` with `-lc`. Otherwise each argument is passed literally. The spawned process receives the `PI_NOTIFY_*` environment independently of its arguments.

Only the bare interpreter name `powershell.exe` (case-insensitive) is resolved automatically. On WSL, resolution checks `PATH`, then a `SystemRoot`/`WINDIR`-derived WSL path, then the standard path `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`. Explicit paths—including paths ending in `powershell.exe`—are preserved exactly. Windows Terminal toast notifications use the same bare-name resolver and fall back exactly once to terminal OSC when PowerShell cannot launch.

`js:` compiles user-authored JavaScript as an async function. Its four lexical parameters are:

| Name | Value |
| --- | --- |
| `pi` | The plugin's public Pi `ExtensionAPI`. |
| `ctx` | The public `ExtensionContext` for the current lifecycle event or tool call. |
| `event` | The complete event object. For `agent_notify`, this describes that tool invocation and includes its arguments. |
| `notification` | Structured notification context: event key, cwd, session fields, tool fields, and title/content when available. |

Because `js:` runs in the Pi process, it has the current user's full permissions and can call powerful Pi APIs. Global and trusted-project configuration are executable code; review them as carefully as an extension. Do not use `js:` for untrusted content.

## AI notification tool

The model-facing tool is disabled by default. It is registered as:

```text
agent_notify({ title: string, content: string })
```

Only a non-empty `pi_notify:agent_notify` action list containing at least one valid action enables it. A missing key, an empty array, or an array whose entries are all invalid leaves the tool unavailable to the AI. Trusted project configuration follows normal replacement precedence, so a project hook replaces the global hook for that project.

The tool attempts every configured action before returning. It reports concise success when all awaited or synchronously launched actions succeed, or one aggregated Pi tool error when they do not. A fire-and-forget command that exits unsuccessfully later cannot be reflected in the tool result.

## Terminal support

| Terminal | Support | Protocol |
| --- | --- | --- |
| Ghostty | Yes | OSC 777 |
| iTerm2 | Yes | OSC 9 |
| WezTerm | Yes | OSC 777 |
| rxvt-unicode | Yes | OSC 777 |
| Kitty | Yes | OSC 99 |
| tmux | Conditional | Passthrough around the selected OSC protocol |
| Windows Terminal | Yes | PowerShell toast |
| Terminal.app | No | OSC 777 fallback is emitted, but Terminal.app does not display it |
| Alacritty | No | OSC 777 fallback is emitted, but Alacritty does not display it |

Unknown terminals receive the OSC 777 fallback; whether it is displayed depends on terminal support. Inside tmux, enable passthrough:

```tmux
set -g allow-passthrough on
```

Zellij and GNU Screen do not provide equivalent passthrough support here.

## Development

```bash
npm ci
npm test
npm run typecheck
```

Tests use Node's built-in `node:test` runner through `tsx`.

## License

MIT © xz-dev. See [LICENSE](LICENSE).
