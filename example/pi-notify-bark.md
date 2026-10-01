# Bark backend helper

[`pi-notify-bark.mjs`](./pi-notify-bark.mjs) is a standalone Bark adapter. It consumes the existing `PI_NOTIFY_*` action environment and one mode; it does not import pi-notify, a producer, or the ntfy helper.

## Install and configure

Copy helper outside repository, keep it owner-only, and provide endpoint/key through user-owned environment:

```bash
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$agent_dir"
install -m 700 example/pi-notify-bark.mjs "$agent_dir/pi-notify-bark.mjs"
export BARK_URL='https://your-bark-host.example/push'
export BARK_DEVICE_KEY='YOUR_BARK_DEVICE_KEY'
chmod 700 "$agent_dir/pi-notify-bark.mjs"
```

`BARK_URL` must be configured as complete `/push` endpoint. `BARK_DEVICE_KEY` is separate and is sent only in request JSON. Replace placeholders only in user-owned environment/config; never commit populated values.

Use separate `cmd:` action. `$HOME` is expanded by platform shell, so path stays portable:

```json
{"hooks":{"agent-notify":{"actions":["cmd:\"$HOME/.pi/agent/pi-notify-bark.mjs\" agent"]}}}
```

For ntfy-only, use only its action. For both backends, add a second independent action:

```json
{"hooks":{"agent-notify":{"delayMs":0,"actions":["cmd:\"$HOME/.pi/agent/pi-notify-ntfy.mjs\" agent","cmd:\"$HOME/.pi/agent/pi-notify-bark.mjs\" agent"]}}}
```

Do not use `$HOME` in a `shell:` tuple: tuples are direct argv, not shell expansion.

## Modes and inputs

Both public helpers support `question`, `agent`, `continue`, `reflect`, and `user-ready`.

| Mode | Required `PI_NOTIFY_*` fields | Presentation |
| --- | --- | --- |
| `question` | complete UTF-8 stdin | `❓ Pi Question · HOSTNAME · CWD`; stdin body |
| `agent` | `TITLE`, `CONTENT` | `🤖 TITLE · HOSTNAME · CWD` |
| `continue` | none | `▶️ Pi Continue`; fixed `Continue watchdog continued` message |
| `reflect` | `REFLECTION_TYPE`, `REASON`, `NEXT_STEP` | fixed clear/route-correction reflection title |
| `user-ready` | `STOP_KIND`; AI unlock also `REASON_TYPE`, `REASON` | done/wait/blocked, terminal-error, or exhausted; other reason types such as `WAIT_CALLBACK` send nothing |

Question text is read from that invocation's stdin, never `PI_NOTIFY_QUESTION_BODY` or a temporary file. Multiline and Unicode bodies are preserved; metadata is cleaned for safe single-line headers. Missing fields, unsupported modes, and incomplete presentations exit silently without a request. Unsupported modes exit with usage status 2. Requests use a finite 15-second timeout.

## Request and failures

The helper sends one UTF-8 `POST` to configured `/push` with JSON:

```json
{"device_key":"YOUR_BARK_DEVICE_KEY","title":"...","body":"...\nsession id: ...","group":"pi-notify"}
```

HTTP non-success exits unsuccessfully. Bark numeric response `code` must equal `200`; a successful HTTP response with empty, malformed, or non-numeric/no `code` is accepted for compatibility. Diagnostics are bounded and never include endpoint, device key, response body, or full payload.

## Local verification (no network)

Use a fresh local HTTP server bound to `127.0.0.1` and set `BARK_URL=http://127.0.0.1:<port>/push` with a fixture key. Capture method, `/push` path, and JSON; exercise every mode, stdin, multiline/Unicode, invalid input, HTTP 503, numeric `code: 400`, and HTTP-success text/empty responses. Do not use a real Bark endpoint during verification.

Related: [ntfy helper](./pi-notify-ntfy.md), [Continue](./pi-continue-watchdog.md), [Reflect](./pi-reflect-watchdog.md), [README](../README.md).
