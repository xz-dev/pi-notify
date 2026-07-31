# pi-notify

Configurable, fire-and-forget notifications for [Pi](https://github.com/badlogic/pi-mono). Notify through terminal-native protocols, launch your own shell commands, or do both when Pi becomes idle or asks you a question.

Inspired by [ferologics/pi-notify](https://github.com/ferologics/pi-notify).

## Features

- Uses Pi's public `agent_settled` event, so an idle notification is sent only after automatic retries, compaction, and queued continuations have settled.
- Observes `ask_user_question` through `tool_execution_start` without blocking or modifying the tool call.
- Loads global configuration plus optional trusted-project overrides.
- Supports terminal notifications through Windows Terminal toast, Kitty OSC 99, iTerm2 OSC 9, and OSC 777, including tmux passthrough.
- Runs arbitrary user-configured `cmd:` actions with notification context in `PI_NOTIFY_*` environment variables.
- Treats both `osc` and `cmd:` actions as fire-and-forget. Failures do not block Pi or stop later actions from launching.

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

The configuration is a JSON object from supported event keys to ordered arrays of actions:

```json
{
  "agent_settled": [
    "osc",
    "cmd:paplay /usr/share/sounds/freedesktop/stereo/complete.oga"
  ],
  "tool_execution_start:ask_user_question": [
    "osc:Pi|{{TOOL}} needs your input in {{CWD}}",
    "cmd:my-notify-script"
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

### Actions

| Action | Behavior |
| --- | --- |
| `osc` | Send the event's built-in terminal notification. |
| `osc:<title>|<body>` | Send a terminal notification with template-expanded title and body. Both sides of `|` must be non-empty. |
| `cmd:<shell command>` | Launch the command through the platform shell with the current Pi cwd and notification environment. The command must be non-empty. |

Actions are launched in array order. Their completion order is not guaranteed, and their exit status is intentionally not awaited.

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

If a template value is unavailable, its placeholder is preserved literally. For example, `{{TOOL}}` remains `{{TOOL}}` during `agent_settled`.

Pi currently exposes no public project-name field to extensions, so `PI_NOTIFY_PROJECT` is deliberately unset. The extension also removes all inherited `PI_NOTIFY_*` values before adding the current fixed context. Tool arguments—including question text—are never copied into the command environment.

`cmd:` uses the platform shell (`/bin/sh` on Unix-like systems and `ComSpec`/`cmd.exe` on Windows). Shell syntax is therefore platform-specific. Configuration files execute user-authored commands; only enable project configuration in directories you trust.

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
