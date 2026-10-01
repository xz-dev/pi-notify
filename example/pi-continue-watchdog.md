# Example: pi-continue-watchdog + pi-notify

This standalone recipe connects [`pi-continue-watchdog`](https://github.com/xz-dev/pi-continue-watchdog) to [pi-notify](https://github.com/xz-dev/pi-notify) through Pi's neutral semantic-hook bus. Neither package imports, identifies, or waits for the other.

## Contract

Channel is exactly `pi:semantic-hook:v1`. Delivery is best-effort to current listeners only: no acknowledgement, replay, retry, backpressure, or producer wait.

| Hook | Producer values | Meaning |
| --- | --- | --- |
| `watchdog-continued` | none | Durable accepted automatic continuation. It has **no values**. |
| `user-ready` | `STOP_KIND` | Automatic terminal state. `AI_UNLOCK` also has producer `REASON_TYPE` + `REASON`; `ERROR_UNLOCK` and `EXHAUSTED` have no extra fields. |

Example continue envelope:

```json
{
  "version": 1,
  "name": "watchdog-continued"
}
```

`user-ready` terminal kinds map to `AI_UNLOCK` (typed producer reason, emitted when the model calls the `unlock_continue_watchdog` tool), `ERROR_UNLOCK` (terminal-error automatic unlock), and `EXHAUSTED` (retry budget exhausted). Manual unlock, main-agent abort, ordinary unlocked idle, intermediate/cancelled/stale/invalid states, and a still-busy child publish no notification. pi-notify must not infer these silent states.

## Notification presentation

Helpers append `session id: <SESSION_ID>` to body. Continue uses `▶️ Pi Continue` and the fixed message `Continue watchdog continued`. Automatic user-ready uses producer-owned reason mapping: `✅ Pi Done` (`JOB_DONE`), `🙋 Pi Wait` (`WAIT_USER`), `🚧 Pi Blocked` (`JOB_BLOCKED`), nothing for `WAIT_CALLBACK`, `❌ Pi Continue error` (`ERROR_UNLOCK`), or `🛑 Pi Continue stopped` (`EXHAUSTED`).

## Install

```bash
pi install git:github.com/xz-dev/pi-notify
pi install git:github.com/xz-dev/pi-continue-watchdog
```

Restart Pi after installation or use Pi's supported reload flow.

## Configuration

Copy one or both standalone helpers owner-only. Configure `NTFY_URL` as a complete topic URL, or `BARK_URL` as a `/push` endpoint plus `BARK_DEVICE_KEY`, in user-owned environment. Never commit populated credentials. See [ntfy](./pi-notify-ntfy.md) and [Bark](./pi-notify-bark.md) for setup and local verification.

```bash
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$agent_dir"
install -m 700 example/pi-notify-ntfy.mjs "$agent_dir/pi-notify-ntfy.mjs"
install -m 700 example/pi-notify-bark.mjs "$agent_dir/pi-notify-bark.mjs"
```

Use separate `cmd:` actions. `$HOME` is expanded by platform shell; helpers receive producer fields through `PI_NOTIFY_*`:

```json
{
  "hooks": {
    "watchdog-continued": {
      "delayMs": 0,
      "actions": [
        "bel",
        "cmd:\"$HOME/.pi/agent/pi-notify-ntfy.mjs\" continue",
        "cmd:\"$HOME/.pi/agent/pi-notify-bark.mjs\" continue"
      ]
    },
    "user-ready": {
      "delayMs": 0,
      "if": "notification.values.REASON_TYPE !== 'WAIT_CALLBACK'",
      "actions": [
        "bel",
        "cmd:\"$HOME/.pi/agent/pi-notify-ntfy.mjs\" user-ready",
        "cmd:\"$HOME/.pi/agent/pi-notify-bark.mjs\" user-ready"
      ]
    }
  }
}
```

`WAIT_CALLBACK` means the agent stopped to wait for another agent or program to call back, so nobody needs to look. The binding `if` keeps every action silent for it, including `bel`; the helpers also ignore reason types they do not map. For ntfy-only or Bark-only, remove other helper action. A helper failure is independent; pi-notify still attempts later actions. Do not use `$HOME` in direct-argv `shell:` tuples.

## Verify without real network

1. Parse config with `python3 -m json.tool`.
2. Run fresh isolated Pi process with a local HTTP fixture bound to `127.0.0.1`; use only fixture `NTFY_URL` or `BARK_URL` and fixture key.
3. Trigger durable continue, AI unlock, terminal-error auto-unlock, and exhaustion events. Assert `watchdog-continued` carries no `PI_NOTIFY_REASON_TYPE`/`PI_NOTIFY_REASON`; assert `AI_UNLOCK` carries both; assert `ERROR_UNLOCK` and `EXHAUSTED` have no reason type.
4. Verify titles, multiline/Unicode body, session suffix, and one request per configured backend.
5. Verify manual unlock, abort, cancelled/stale/invalid/intermediate, and busy-child paths remain silent.

Related: [Reflect](./pi-reflect-watchdog.md), [ntfy helper](./pi-notify-ntfy.md), [Bark helper](./pi-notify-bark.md), [README](../README.md).
