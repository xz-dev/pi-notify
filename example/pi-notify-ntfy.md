# ntfy backend helper

[`pi-notify-ntfy.mjs`](./pi-notify-ntfy.mjs) is a standalone ntfy adapter. It consumes the existing `PI_NOTIFY_*` action environment and one mode; it does not import pi-notify, a producer, or the Bark helper.

## Install and configure

Copy helper outside repository, keep it owner-only, and provide backend secret through environment:

```bash
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$agent_dir"
install -m 700 example/pi-notify-ntfy.mjs "$agent_dir/pi-notify-ntfy.mjs"
export NTFY_URL='https://ntfy.sh/YOUR_PRIVATE_TOPIC'
chmod 700 "$agent_dir/pi-notify-ntfy.mjs"
```

`NTFY_URL` is complete topic URL. The helper extracts one topic path segment, posts to URL host root, and puts topic in JSON body. Replace placeholder only in user-owned environment/config; never commit populated topic or endpoint.

Use separate `cmd:` action. `$HOME` is expanded by platform shell, so path stays portable:

```json
{"hooks":{"agent-notify":{"actions":["cmd:\"$HOME/.pi/agent/pi-notify-ntfy.mjs\" agent"]}}}
```

For Bark-only, use only its action. For both backends, add a second independent action:

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
| `user-ready` | `STOP_KIND`; AI unlock also `REASON_TYPE`, `REASON` | done/wait/blocked, terminal-error, or exhausted |

Question text is read from that invocation's stdin, never `PI_NOTIFY_QUESTION_BODY` or a temporary file. Multiline and Unicode bodies are preserved; metadata is cleaned for safe single-line headers. Missing fields, unsupported modes, and incomplete presentations exit silently without a request. Unsupported modes exit with usage status 2. Requests use a finite 15-second timeout.

## Request and failures

The helper sends one `POST` to the ntfy host root with JSON:

```json
{"topic":"YOUR_PRIVATE_TOPIC","title":"...","message":"...\nsession id: ...","tags":["...","..."]}
```

`tags` includes semantic mode tag and normalized host tag. Non-success HTTP status, invalid URL/topic, or transport timeout exits unsuccessfully with a bounded backend-specific diagnostic. Diagnostics never include URL, credentials, or full payload.

## Local verification (no network)

Use a fresh local HTTP server bound to `127.0.0.1` and set `NTFY_URL=http://127.0.0.1:<port>/test-topic`. Capture method, root path, and JSON; exercise every mode, stdin, multiline/Unicode, invalid input, and HTTP 503. Do not use `ntfy.sh` or any real endpoint during verification.

Related: [Bark helper](./pi-notify-bark.md), [Continue](./pi-continue-watchdog.md), [Reflect](./pi-reflect-watchdog.md), [README](../README.md).
