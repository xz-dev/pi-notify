# Example: pi-reflect-watchdog + pi-notify

This standalone recipe connects [`pi-reflect-watchdog`](https://github.com/xz-dev/pi-reflect-watchdog) to [pi-notify](https://github.com/xz-dev/pi-notify) through Pi's neutral semantic-hook bus. Reflect is independent: it does not require or invoke `pi-continue-watchdog`.

## Contract

Channel is exactly `pi:semantic-hook:v1`. Delivery is best-effort to current listeners only: no acknowledgement, replay, retry, or consumer wait. The producer stores its valid reflection and completion marker durably before publishing one `reflection-completed` envelope:

```json
{
  "version": 1,
  "name": "reflection-completed",
  "values": {
    "REFLECTION_TYPE": "NO_ISSUE",
    "REASON": "Verified route is sound.",
    "NEXT_STEP": "Continue with planned work."
  }
}
```

`REFLECTION_TYPE` is `NO_ISSUE` or `ROUTE_CORRECTION`. `REASON` and `NEXT_STEP` are producer-owned: values longer than 4096 UTF-16 code units are clipped by producer to a whole-code-point prefix plus `…` for this hook, while durable reflection report retains full text. Consumers must not infer or recreate clipping. Route correction starts its ordinary continuation independently; pi-notify does not await, acknowledge, cancel, or replace it.

Invalid/intermediate XML, exhausted validation, cancellation, ownership loss, shutdown, incomplete persistence, and missing/throwing listeners produce no completion notification. pi-notify must not infer these silent states.

## Install

```bash
pi install git:github.com/xz-dev/pi-notify
pi install git:github.com/xz-dev/pi-reflect-watchdog@master
```

Restart Pi after installation or use Pi's supported reload flow.

## Configuration

Copy one backend helper owner-only as described in [ntfy](./pi-notify-ntfy.md) or [Bark](./pi-notify-bark.md). `cmd:` actions receive validated producer fields as `PI_NOTIFY_REFLECTION_TYPE`, `PI_NOTIFY_REASON`, and `PI_NOTIFY_NEXT_STEP`:

```bash
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$agent_dir"
install -m 700 example/pi-notify-ntfy.mjs "$agent_dir/pi-notify-ntfy.mjs"
```

Configure only Reflect, or compose both backends as two independent actions:

```json
{
  "hooks": {
    "reflection-completed": {
      "delayMs": 0,
      "actions": [
        "bel",
        "cmd:\"$HOME/.pi/agent/pi-notify-ntfy.mjs\" reflect",
        "cmd:\"$HOME/.pi/agent/pi-notify-bark.mjs\" reflect"
      ]
    }
  }
}
```

Set backend credentials in user-owned environment (`NTFY_URL`, or `BARK_URL` plus `BARK_DEVICE_KEY`). Keep credential-bearing files owner-only and never commit populated values. `$HOME` is expanded by `cmd:` platform shell; do not put it in direct-argv `shell:` tuples.

## Presentation

Both helpers present `NO_ISSUE` and `ROUTE_CORRECTION` with fixed status titles and preserve reason plus next step in multiline body, followed by `session id: <SESSION_ID>`. Other reflection types are not produced by current producer and should not be invented in configuration.

## Verify locally

Use a fresh isolated Pi process and an HTTP fixture bound to `127.0.0.1`; set `NTFY_URL` to its topic URL or `BARK_URL` to its `/push` URL and use a fixture device key. Capture request JSON without contacting any public notification service. Trigger one valid no-issue and one route-correction completion; verify one request per configured backend, exact fields, and clipped values if producer report exceeds 4096 UTF-16 units. Verify invalid/retried/incomplete/cancelled/shutdown paths stay silent.

Related: [Continue](./pi-continue-watchdog.md), [ntfy](./pi-notify-ntfy.md), [Bark](./pi-notify-bark.md), [README](../README.md).
