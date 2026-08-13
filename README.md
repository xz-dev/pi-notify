# pi-notify

Route Pi lifecycle events and neutral semantic hooks to **notification actions**.

pi-notify is not limited to one notification form. Built-in actions are **BEL** and **OSC** (including Windows Terminal toast). Custom actions can launch a shell command, spawn an explicit interpreter, or run trusted JavaScript—so ntfy, scripts, and conditional logic are configuration, not hard-coded backends.

Inspired by [ferologics/pi-notify](https://github.com/ferologics/pi-notify).

## Mental model

```text
Trigger  →  Binding { delayMs, actions }  →  Action pipeline
```

| Layer | What it is |
| --- | --- |
| **Triggers** | Two fixed Pi lifecycle events, plus any semantic hook name on `pi:semantic-hook:v1` |
| **Binding** | Per-event / per-hook `{ "delayMs"?: number, "actions": [...] }` |
| **Actions** | What runs: built-in BEL/OSC, or custom `cmd:` / `shell:` / `js:` |

Producers own semantic meaning and timing. pi-notify only routes and executes. It has no hook-name whitelist and does not import or identify other extensions.

## Kinds

### Triggers

| Kind | Config | Open? | Keys |
| --- | --- | --- | --- |
| Lifecycle events | `events.*` | Closed set | `agent_settled`, `tool_execution_start:ask_user_question` |
| Semantic hooks | `hooks.<name>` | Open | Any lowercase kebab-case name |

Optional producer (not a third trigger kind):

| Name | When | Behavior |
| --- | --- | --- |
| `agent_notify({ title, content })` | Only if `hooks["agent-notify"]` has at least one valid action | Publishes the `agent-notify` hook; does not wait for delivery |

### Actions

| Action | Role | Execution |
| --- | --- | --- |
| `bel` | Built-in terminal BEL (`U+0007`) | Fire-and-forget; valid for lifecycle events and hooks |
| `osc` | Built-in lifecycle default OSC / Windows toast | Fire-and-forget; **lifecycle only** |
| `osc:<title>&#124;<body>` | Built-in OSC / Windows toast with templates | Fire-and-forget; required form for hooks |
| `cmd:<command>` | Platform default shell | Non-blocking; failed exit reports status and bounded output |
| `["shell:<interpreter>", "arg1", ...]` | Direct argv spawn (`shell: false`) | Non-blocking; failed exit reports status and bounded output |
| `js:<code>` | Trusted in-process JavaScript | Awaited |

Prefer declarative `bel`, templated `osc:`, and `shell:` tuples. Use `js:` only for conditional behavior those cannot express.

### Shared binding rules

- `delayMs` defaults to `0` (nonnegative safe integer within the Node timer maximum).
- Flow: retain causal data → wait `delayMs` → collect live cwd/session/env → execute.
- No debounce, dedup, or latest-event replacement. Reload / `session_shutdown` cancels pending work.
- Global config + trusted project config; matching bindings replace as whole units.
- Explicit `"actions": []` disables that binding.

## Features

- Routes Pi `agent_settled` and filtered `ask_user_question` starts, plus any semantic hook.
- First-class **BEL** and **OSC** notification backends (Kitty / iTerm2 / OSC 777 / Windows toast / tmux passthrough).
- Open custom actions via platform shell, direct interpreter, or trusted JavaScript.
- Neutral `pi:semantic-hook:v1` consumer with no producer identity and no name whitelist.
- Optional AI tool that only publishes an `agent-notify` hook.
- Non-blocking consumers: action failures never throw into Pi's bus or lifecycle.

## Requirements

- Pi 0.83.0 or newer with public `agent_settled`, `tool_execution_start`, and `pi.events`.
- Node.js 22.19.0 or newer.
- `tool_execution_start:ask_user_question` expects the model-visible tool name `ask_user_question` (as used by [`@juicesharp/rpiv-ask-user-question`](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question)).

## Install

```bash
pi install git:github.com/xz-dev/pi-notify
```

Restart Pi after installation. To try a checkout without installing:

```bash
pi -e /path/to/pi-notify/index.ts
```

## Configuration

### Prefer AI-assisted setup

The nested `events` / `hooks` shape, action syntax, templates, delay semantics, and Pi trust/lifecycle boundaries are easy to misconfigure by hand. **Prefer asking an AI coding agent to write or review your `pi-notify.json`.**

When you do, point the AI at:

1. **This repository** (README, `example/`, and the packaged `adapt-pi-notify-skill`) for pi-notify’s config contract and action kinds.
2. **The Pi source** at [https://github.com/earendil-works/pi](https://github.com/earendil-works/pi) for authoritative lifecycle events (`agent_settled`, `tool_execution_start`, session trust, `pi.events`, extension APIs).

Suggested prompt fragment:

```text
Configure pi-notify for my use case. Read the pi-notify README/examples/skill,
and verify Pi lifecycle/event/API assumptions against the earendil-works/pi source
(https://github.com/earendil-works/pi) rather than guessing from memory.
Write a complete pi-notify.json (global and/or trusted project) and explain each binding.
```

Nested JSON only. Old flat top-level event keys and `pi_notify:agent_notify` are ignored with one bounded migration diagnostic.

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

1. Global: `$PI_CODING_AGENT_DIR/pi-notify.json` (default `~/.pi/agent/pi-notify.json`)
2. Project: `<current Pi cwd>/.pi/pi-notify.json` (only when Pi reports the project trusted)

Rules:

- A project binding replaces the matching global binding as one complete `{ delayMs, actions }` unit.
- Non-matching global bindings remain.
- An invalid higher-precedence binding is ignored and does not erase a valid lower-precedence binding.
- Missing files are empty configuration.
- Invalid JSON, unsupported lifecycle keys, invalid hook names, invalid actions, and invalid `delayMs` produce non-blocking warnings and are ignored.

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
- Optional `values` keys are uppercase underscore identifiers with string values.
- Plain data only: no `ctx`, functions, callbacks, or plugin identity.
- Best-effort current-listener delivery only: no buffer, replay, ack, retry, or backpressure.
- pi-notify routes `hooks[name]` with no semantic-name whitelist.
- Unconfigured names are silent; malformed envelopes produce a bounded warning.

Consumer-owned fields for hooks:

| Template | Command variable | Value |
| --- | --- | --- |
| `{{HOOK}}` | `PI_NOTIFY_HOOK` | `<name>` |
| `{{EVENT}}` | `PI_NOTIFY_EVENT` | `hook:<name>` |

Validated producer values become additional templates and `PI_NOTIFY_*` entries unless they collide with reserved consumer keys: `EVENT`, `HOOK`, `CWD`, `HOSTNAME`, `SESSION_ID`, `SESSION_FILE`, `TOOL`, `TOOL_CALL_ID`.

Bare `osc` is valid only for lifecycle events (built-in default copy). Hook bindings reject bare `osc`; use `osc:<title>|<body>` or `notification.osc` in `js:`. Bare `bel` is valid for both because it has no text payload.

### Binding delay

Every received event or hook schedules its own independent timer:

1. Validate and copy immutable causal data plus the chosen binding.
2. Wait `delayMs`.
3. Verify the consumer generation is still current.
4. Collect live cwd/session fields, a currently valid public `ExtensionContext`, and the inherited process environment.
5. Construct `PI_NOTIFY_*`, render templates, and execute actions.

There is no debounce, replacement, coalescing, or revalidation against new activity. Reload / `session_shutdown` unsubscribes, cancels pending timers, and advances generation so late work cannot cause side effects.

### Action details

| Action | Behavior |
| --- | --- |
| `bel` | Emit one standard terminal BEL. The terminal decides whether it is audible, visual, or a taskbar flash. |
| `osc` | Lifecycle only: send the event's built-in terminal notification (`agent_settled` → “Ready for input”; ask-user → “Question needs your input”). |
| `osc:<title>&#124;<body>` | Send a terminal notification with template-expanded title and body. Both sides of the `&#124;` separator must be non-empty. |
| `cmd:<shell command>` | Launch through the platform default shell with the current Pi cwd and notification environment. |
| `["shell:<interpreter>", "arg1", ...]` | Resolve one explicit interpreter and launch it directly with the remaining strings as exact arguments. At least one argument is required. |
| `js:<code>` | Await trusted JavaScript in the plugin process with `pi`, `ctx`, causal `event`, and `notification` in scope. |

Actions start in array order; every action is attempted even if an earlier one fails. `bel` and `osc` are fire-and-forget. `cmd:` and `shell:` return immediately, then report failed exit status asynchronously with up to 4 KiB each of stdout and stderr; successful output stays silent. `js:` is awaited. Consumer failures produce non-blocking warnings and never throw into Pi's bus or lifecycle. Command output may contain sensitive data, so notification commands should not print secrets.

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

`cmd:` uses the platform shell (`/bin/sh` on Unix-like systems; `ComSpec` / `cmd.exe` on Windows).

A `shell:` tuple bypasses the host shell and calls the interpreter with `shell: false`. pi-notify does not add `-c`, `/c`, `-Command`, or any other argument. Only the bare interpreter name `powershell.exe` (case-insensitive) is resolved automatically on WSL.

### JavaScript notification context

| Name | Value |
| --- | --- |
| `pi` | The plugin's public Pi `ExtensionAPI`. |
| `ctx` | The public `ExtensionContext` collected at execution time (after any delay). |
| `event` | Retained causal event or semantic envelope from receipt time. |
| `notification` | Structured context: event key, optional hook name, cwd/hostname/session/tool fields, frozen `values`, `bel()`, and `osc(title, body)`. |

`notification.values` is `{}` for lifecycle events and the frozen validated producer values for hooks (system keys stripped).

`notification.bel()` uses the same first-class BEL backend as a configured `bel` action. `notification.osc(title, body)` reuses the shared OSC backend (Windows Terminal toast, WSL PowerShell resolution, Kitty/iTerm/OSC777/tmux). Both participate in normal action error/continuation aggregation.

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

Successful synchronous construction and bus emit are enough for tool success. Synchronous emit failures become tool errors. Asynchronous consumer/action failures never feed back into the tool result. See the [readable `agent_notify` configuration example](./example/agent-notify.md).

## Terminal support (BEL / OSC)

| Terminal | BEL | OSC / toast |
| --- | --- | --- |
| Ghostty | Terminal-dependent | OSC 777 |
| iTerm2 | Terminal-dependent | OSC 9 |
| WezTerm | Terminal-dependent | OSC 777 |
| rxvt-unicode | Terminal-dependent | OSC 777 |
| Kitty | Terminal-dependent | OSC 99 |
| tmux | Passthrough if enabled | Passthrough around the selected OSC protocol |
| Windows Terminal | Terminal-dependent | PowerShell toast |
| Terminal.app | Terminal-dependent | OSC 777 fallback is emitted, but Terminal.app does not display it |
| Alacritty | Terminal-dependent | OSC 777 fallback is emitted, but Alacritty does not display it |

Unknown terminals receive the OSC 777 fallback; whether it is displayed depends on terminal support. Inside tmux, enable passthrough:

```tmux
set -g allow-passthrough on
```

Zellij and GNU Screen do not provide equivalent passthrough support here.

## Examples

- [`agent_notify` with BEL, templates, and optional ntfy](./example/agent-notify.md)
- [`ask_user_question` lifecycle notifications](./example/rpiv-ask-user-question.md)
- [`pi-continue-watchdog` semantic-hook notifications](./example/pi-continue-watchdog.md)

Examples prefer built-in `bel`, templated `osc:`, and direct `shell:` actions. Use `js:` only when behavior is genuinely conditional.

To adapt another extension as a neutral producer, see the packaged skill `adapt-pi-notify-skill`.

## Development

```bash
npm ci
npm test
npm run typecheck
```

Tests use Node's built-in `node:test` runner through `tsx`, including a packed-artifact E2E with an independent neutral producer.

## License

MIT © xz-dev. See [LICENSE](LICENSE).
