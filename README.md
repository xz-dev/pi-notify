# pi-notify

Configurable notifications for [Pi](https://github.com/badlogic/pi-mono). Notify through terminal-native protocols, launch commands through the platform shell or an explicit interpreter, run trusted JavaScript against Pi's public extension APIs, consume neutral semantic hooks from other extensions, and optionally let the AI publish a titled notification hook.

Inspired by [ferologics/pi-notify](https://github.com/ferologics/pi-notify).

## Features

- Uses Pi's public `agent_settled` event, so an idle notification is sent only after automatic retries, compaction, and queued continuations have settled.
- Observes `ask_user_question` through `tool_execution_start` without blocking or modifying the tool call.
- Consumes neutral semantic hooks on the public `pi:semantic-hook:v1` bus without a hook-name whitelist or producer identity.
- Loads nested global configuration plus optional trusted-project whole-unit overrides.
- Supports per-binding `delayMs` with retain-causal → delay → collect-live → execute semantics (no debounce/dedup).
- Supports first-class terminal BEL plus Windows Terminal toast, Kitty OSC 99, iTerm2 OSC 9, and OSC 777, including tmux passthrough.
- Preserves concise `cmd:` actions through the platform's default shell and supports `shell:` actions with an explicit interpreter.
- Runs trusted `js:` actions in-process with `pi`, `ctx`, causal `event`, and `notification` (including frozen `values`, `notification.bel()`, and `notification.osc()`).
- Optionally exposes `agent_notify({ title, content })` when `hooks["agent-notify"]` has at least one valid action; the tool is a pure producer of the `agent-notify` hook.
- Keeps terminal and command actions fire-and-forget while awaiting JavaScript actions. One action failure does not prevent later actions from being attempted.

## Requirements

- Pi 0.83.0 or newer with the public `agent_settled` and `tool_execution_start` events and `pi.events` bus.
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

Configuration is a nested JSON object with `events` (Pi lifecycle) and `hooks` (semantic hooks). Each binding is `{ "delayMs"?: number, "actions": [...] }`. `delayMs` defaults to `0` and must be a nonnegative safe integer within the Node timer maximum.

This is a breaking shape: old flat top-level event keys and `pi_notify:agent_notify` are ignored with one bounded migration diagnostic.

```json
{
  "events": {
    "agent_settled": {
      "delayMs": 0,
      "actions": [
        "bel",
        "osc",
        "cmd:paplay /usr/share/sounds/freedesktop/stereo/complete.oga",
        ["shell:/bin/bash", "-lc", "my-notify-script"]
      ]
    },
    "tool_execution_start:ask_user_question": {
      "actions": [
        "bel",
        "osc:Pi|{{TOOL}} needs your input in {{CWD}}"
      ]
    }
  },
  "hooks": {
    "agent-notify": {
      "actions": [
        "bel",
        "osc:{{TITLE}}|{{CONTENT}}",
        ["shell:powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Write-Output $env:PI_NOTIFY_CONTENT"]
      ]
    },
    "user-ready": {
      "delayMs": 0,
      "actions": [
        "bel",
        "js:const kind = notification.values.STOP_KIND; if (kind === 'AI_UNLOCK') notification.osc('Pi', notification.values.REASON); else if (kind === 'EXHAUSTED') notification.osc('Pi', 'Continue watchdog exhausted'); else if (kind === 'DECISION_FAILED') notification.osc('Pi', 'Continue watchdog decision failed');"
      ]
    },
    "build-finished": {
      "delayMs": 1000,
      "actions": ["bel", "osc:Build|{{RESULT}}"]
    }
  }
}
```

### Configuration files

1. Global: `$PI_CODING_AGENT_DIR/pi-notify.json`
   - Default: `~/.pi/agent/pi-notify.json`
2. Project: `<current Pi cwd>/.pi/pi-notify.json`
   - Read only when Pi reports the project as trusted.
   - A project binding replaces the matching global binding as one complete `{ delayMs, actions }` unit.
   - Nonmatching global event and hook bindings remain available.
   - An invalid higher-precedence binding is ignored and does not erase a valid lower-precedence binding.
   - An explicit empty `actions` array disables that binding.

A missing file is an empty configuration. Invalid JSON, unsupported lifecycle event names, invalid hook names, invalid actions, and invalid `delayMs` produce non-blocking warnings and are ignored.

### Lifecycle event keys

| Key | When it fires |
| --- | --- |
| `agent_settled` | Pi is idle with no automatic retry, compaction, or queued continuation left to run. |
| `tool_execution_start:ask_user_question` | The `ask_user_question` tool starts executing. Other tools do not match. |

### Semantic hooks

Any extension may publish on:

```text
pi:semantic-hook:v1
```

Envelope:

```json
{
  "version": 1,
  "name": "build-finished",
  "values": {
    "RESULT": "SUCCESS"
  }
}
```

Rules:

- `name` is lowercase kebab-case.
- optional `values` keys are uppercase underscore identifiers with string values.
- plain data only; no `ctx`, functions, callbacks, or plugin identity.
- best-effort current-listener delivery only: no buffer, replay, ack, retry, or backpressure.
- pi-notify routes `hooks[name]` with no semantic-name whitelist.
- unconfigured names are silent; malformed envelopes produce a bounded warning.

Consumer-owned fields for hooks:

| Template | Command variable | Value |
| --- | --- | --- |
| `{{HOOK}}` | `PI_NOTIFY_HOOK` | `<name>` |
| `{{EVENT}}` | `PI_NOTIFY_EVENT` | `hook:<name>` |

Validated producer values become additional templates and `PI_NOTIFY_*` entries unless they collide with reserved consumer keys: `EVENT`, `HOOK`, `CWD`, `HOSTNAME`, `SESSION_ID`, `SESSION_FILE`, `TOOL`, `TOOL_CALL_ID`.

Bare `osc` is valid only for lifecycle events (built-in default copy). Hook bindings reject bare `osc` with a config diagnostic; use `osc:<title>|<body>` or `notification.osc` in `js:`. Bare `bel` is valid for both lifecycle events and hooks because it has no text payload or event-specific default.

### Binding delay

Every received event or hook schedules its own independent timer:

1. validate and copy immutable causal data (Pi event payload or semantic name/values) plus the chosen binding;
2. wait `delayMs`;
3. verify the consumer generation is still current;
4. collect live cwd/session fields, a currently valid public `ExtensionContext`, and the inherited process environment;
5. construct `PI_NOTIFY_*`, render templates, and execute actions.

There is no debounce, replacement, coalescing, or revalidation against new activity. Reload/`session_shutdown` unsubscribes, cancels pending timers, and advances generation so late work cannot cause side effects.

### Actions

| Action | Behavior |
| --- | --- |
| `bel` | Emit one standard terminal BEL (`U+0007`). Valid for lifecycle events and semantic hooks; the terminal decides whether it is audible, visual, or a taskbar attention flash. |
| `osc` | Lifecycle only: send the event's built-in terminal notification. |
| `osc:<title>|<body>` | Send a terminal notification with template-expanded title and body. Both sides of `|` must be non-empty. |
| `cmd:<shell command>` | Launch the command through the platform's default shell with the current Pi cwd and notification environment. The command must be non-empty. |
| `["shell:<interpreter>", "arg1", ...]` | Resolve one explicit interpreter and launch it directly with the remaining strings as exact arguments. At least one argument is required. |
| `js:<code>` | Await trusted JavaScript in the plugin process with `pi`, `ctx`, causal `event`, and `notification` in scope. The code must be non-empty. |

Actions are started in array order and every action is attempted even if an earlier one fails. `bel`, `osc`, `cmd:`, and `shell:` are fire-and-forget; command completion order and exit status are intentionally not observed. `js:` is awaited. Lifecycle and hook consumer failures produce non-blocking warnings and never throw into Pi's bus or lifecycle.

## Templates and command environment

`osc:<title>|<body>` templates use the environment-variable name without the `PI_NOTIFY_` prefix:

| Template | Command variable | Availability |
| --- | --- | --- |
| `{{EVENT}}` | `PI_NOTIFY_EVENT` | Always |
| `{{HOOK}}` | `PI_NOTIFY_HOOK` | Semantic hooks only |
| `{{CWD}}` | `PI_NOTIFY_CWD` | Always |
| `{{HOSTNAME}}` | `PI_NOTIFY_HOSTNAME` | Always |
| `{{SESSION_ID}}` | `PI_NOTIFY_SESSION_ID` | Always |
| `{{SESSION_FILE}}` | `PI_NOTIFY_SESSION_FILE` | Persistent sessions only |
| `{{TOOL}}` | `PI_NOTIFY_TOOL` | Tool events only |
| `{{TOOL_CALL_ID}}` | `PI_NOTIFY_TOOL_CALL_ID` | Tool events only |
| `{{TITLE}}` / `{{CONTENT}}` / other producer keys | matching `PI_NOTIFY_*` | When provided by a hook producer |

If a template value is unavailable, its placeholder is preserved literally. The extension removes all inherited `PI_NOTIFY_*` values before adding the current context. Lifecycle tool arguments—including question text—are never copied into the command environment. A `js:` action intentionally receives the complete retained causal event, including tool arguments when present.

`cmd:` uses the platform shell (`/bin/sh` on Unix-like systems and `ComSpec`/`cmd.exe` on Windows).

A `shell:` tuple bypasses the host shell and calls the interpreter directly with `shell: false`. pi-notify does not add `-c`, `/c`, `-Command`, or any other argument. Only the bare interpreter name `powershell.exe` (case-insensitive) is resolved automatically on WSL.

### JavaScript notification context

| Name | Value |
| --- | --- |
| `pi` | The plugin's public Pi `ExtensionAPI`. |
| `ctx` | The public `ExtensionContext` collected at execution time (after any delay). |
| `event` | Retained causal event or semantic envelope from receipt time. |
| `notification` | Structured context: event key, optional hook name, cwd/hostname/session/tool fields, frozen `values`, `bel()`, and `osc(title, body)`. |

`notification.values` is `{}` for lifecycle events and the frozen validated producer values for hooks (system keys stripped).

`notification.bel()` emits through the same first-class BEL backend as a configured `bel` action. `notification.osc(title, body)` reuses the shared OSC backend (Windows Terminal toast, WSL PowerShell resolution, Kitty/iTerm/OSC777/tmux). Both participate in normal action error/continuation aggregation.

Because `js:` runs in the Pi process, it has the current user's full permissions and can call powerful Pi APIs. Global and trusted-project configuration are executable code; review them as carefully as an extension.

## AI notification tool

The model-facing tool is disabled by default. It is registered as:

```text
agent_notify({ title: string, content: string })
```

Only a non-empty `hooks["agent-notify"].actions` list containing at least one valid action enables it. The tool is an independent producer: it emits a fresh frozen envelope `{ version: 1, name: "agent-notify", values: { TITLE, CONTENT } }` on `pi:semantic-hook:v1` and returns exactly:

```text
Notification hook published
```

Successful synchronous construction and bus emit are enough for tool success. Synchronous emit failures become tool errors. Asynchronous consumer/action failures never feed back into the tool result; the generic router executes configured actions independently. See the [readable `agent_notify` configuration example](./example/agent-notify.md).

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

## Examples

- [`agent_notify` with BEL, templates, and optional ntfy](./example/agent-notify.md)
- [`ask_user_question` lifecycle notifications](./example/rpiv-ask-user-question.md)
- [`pi-continue-watchdog` semantic-hook notifications](./example/pi-continue-watchdog.md)

The examples prefer built-in `bel`, templated `osc:`, and direct `shell:` actions. Use `js:` only when behavior is genuinely conditional or cannot be expressed by those declarative actions.

## Development

```bash
npm ci
npm test
npm run typecheck
```

Tests use Node's built-in `node:test` runner through `tsx`, including a packed-artifact E2E with an independent neutral producer.

## License

MIT © xz-dev. See [LICENSE](LICENSE).
