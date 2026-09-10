# Example: pi-continue-watchdog + pi-notify

This standalone recipe connects [`pi-continue-watchdog`](https://github.com/xz-dev/pi-continue-watchdog) to [pi-notify](https://github.com/xz-dev/pi-notify) through Pi's neutral semantic-hook bus. Neither package imports, identifies, or waits for the other.

## Contract

Channel is exactly `pi:semantic-hook:v1`. Delivery is best-effort to current listeners only: no acknowledgement, replay, retry, backpressure, or producer wait.

| Hook | Producer values | Meaning |
| --- | --- | --- |
| `watchdog-continued` | `REASON_TYPE`, `REASON` | Durable accepted continue; type is normally `WORK_REMAINS` or `VERIFYING`. |
| `watchdog-waiting` | `REASON`, decimal-string `WAIT_SECONDS` | Durable passive wait. It has **no `REASON_TYPE`** and starts no continuation turn. |
| `user-ready` | `STOP_KIND` | Automatic terminal state. `AI_UNLOCK` also has producer `REASON_TYPE` + `REASON`; `EXHAUSTED` and `DECISION_FAILED` have no extra fields. |

Example wait envelope:

```json
{
  "version": 1,
  "name": "watchdog-waiting",
  "values": { "REASON": "Waiting for CI.", "WAIT_SECONDS": "300" }
}
```

`user-ready` terminal kinds map to `AI_UNLOCK` (typed producer reason), `EXHAUSTED` (retry budget exhausted), and `DECISION_FAILED` (three invalid decisions). Manual unlock, main-agent abort, ordinary unlocked idle, intermediate/cancelled/stale/invalid states, and a still-busy child publish no notification. pi-notify must not infer these silent states.

## Notification presentation

Helpers append `session id: <SESSION_ID>` to body. Continue uses `▶️ Pi Continue` and `<REASON_TYPE> · <REASON>`. Wait uses `⏳ Pi Waiting` and `<WAIT_SECONDS>s · <REASON>`. Automatic user-ready uses producer-owned reason mapping: `🙋 Pi Done` (`JOB_DONE`), `🙋 Pi Wait` (`WAIT_USER`), `🚧 Pi Blocked` (`JOB_BLOCKED`), fallback `🔔 Pi Ready`, `🛑 Pi Continue stopped`, or `⚠️ Pi Continue failed`.

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
    "watchdog-waiting": {
      "delayMs": 0,
      "actions": [
        "bel",
        "cmd:\"$HOME/.pi/agent/pi-notify-ntfy.mjs\" wait",
        "cmd:\"$HOME/.pi/agent/pi-notify-bark.mjs\" wait"
      ]
    },
    "user-ready": {
      "delayMs": 0,
      "actions": [
        "bel",
        "cmd:\"$HOME/.pi/agent/pi-notify-ntfy.mjs\" user-ready",
        "cmd:\"$HOME/.pi/agent/pi-notify-bark.mjs\" user-ready"
      ]
    }
  }
}
```

For ntfy-only or Bark-only, remove other helper action. A helper failure is independent; pi-notify still attempts later actions. Do not use `$HOME` in direct-argv `shell:` tuples.

## Verify without real network

1. Parse config with `python3 -m json.tool`.
2. Run fresh isolated Pi process with a local HTTP fixture bound to `127.0.0.1`; use only fixture `NTFY_URL` or `BARK_URL` and fixture key.
3. Trigger durable continue, wait, AI unlock, exhaustion, and decision-failed events. Assert exact `PI_NOTIFY_REASON_TYPE`, `PI_NOTIFY_REASON`, and decimal `PI_NOTIFY_WAIT_SECONDS`; assert wait has no reason type.
4. Verify titles, multiline/Unicode body, session suffix, and one request per configured backend.
5. Verify manual unlock, abort, cancelled/stale/invalid/intermediate, and busy-child paths remain silent.

Related: [Reflect](./pi-reflect-watchdog.md), [ntfy helper](./pi-notify-ntfy.md), [Bark helper](./pi-notify-bark.md), [README](../README.md).
