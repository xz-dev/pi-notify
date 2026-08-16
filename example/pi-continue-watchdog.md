# Example: pi-continue-watchdog + pi-notify

This standalone recipe connects [`pi-continue-watchdog`](https://github.com/xz-dev/pi-continue-watchdog) to [pi-notify](https://github.com/xz-dev/pi-notify) through Pi's neutral semantic-hook bus. Neither package imports or detects the other.

## How it works

```text
pi-continue-watchdog                         pi-notify
        |                                       |
        | pi.events.emit(                       | hooks["user-ready"]
        |   "pi:semantic-hook:v1", envelope) -->| hooks["watchdog-continued"]
        |                                       | hooks["agent-notify"]
        |                                       |
        |                                       +-- terminal OSC / Windows toast
        |                                       +-- detached curl POST to ntfy
```

The channel is exactly `pi:semantic-hook:v1`. Delivery is best-effort to current listeners: no acknowledgement, replay, retry, backpressure, or producer wait. The watchdog owns terminal-state semantics; pi-notify only validates, routes, and displays the envelope.

The watchdog publishes `user-ready` at most once for the applicable aggregate-idle epoch:

| `STOP_KIND` | Extra value | Notification |
| --- | --- | --- |
| `AI_UNLOCK` | validated `REASON` | `🙋 Pi Done` |
| `EXHAUSTED` | none | `🛑 Pi Continue stopped` |
| `DECISION_FAILED` | none | `⚠️ Pi Continue failed` |

A separately configured `watchdog-continued` hook is published after each accepted continue has been durably recorded. It carries validated `REASON_TYPE` and `REASON` values. Manual unlock, main-agent abort, ordinary unlocked idle, and a still-busy observable child remain silent.

Example envelope:

```json
{
  "version": 1,
  "name": "user-ready",
  "values": {
    "STOP_KIND": "AI_UNLOCK",
    "REASON": "Waiting for user confirmation"
  }
}
```

An accepted continue envelope is:

```json
{
  "version": 1,
  "name": "watchdog-continued",
  "values": {
    "REASON_TYPE": "VERIFYING",
    "REASON": "Tests still need to run."
  }
}
```

When `hooks["agent-notify"]` has an action, pi-notify also registers `agent_notify({ title, content })`. Its neutral envelope is:

```json
{
  "version": 1,
  "name": "agent-notify",
  "values": {
    "TITLE": "Build finished",
    "CONTENT": "All tests passed"
  }
}
```

The tool's model-visible success text is exactly `Notification hook published`; consumer delivery failures do not alter that result.

## Notification format

Each title has this shape:

```text
<status title> · <hostname> · <absolute Pi cwd>
```

The body ends with a real LF and the session ID:

```text
<message>
session id: <SESSION_ID>
```

Hostname resolution prefers `process.env.HOSTNAME`; when it is undefined, the recipe uses `os.hostname()`. An empty or unsafe result falls back to `unknown-host`. ntfy receives **two** comma-separated tags: the semantic tag and a lowercase, comma-safe hostname tag.

| Source | Status title | Message | Semantic ntfy tag |
| --- | --- | --- | --- |
| `watchdog-continued` | `▶️ Pi Continue` | `<REASON_TYPE> · <REASON>` | `continue` |
| `AI_UNLOCK` | `🙋 Pi Done` | producer `REASON` | `done` |
| `EXHAUSTED` | `🛑 Pi Continue stopped` | `Continue watchdog retry limit reached` | `retry-limit` |
| `DECISION_FAILED` | `⚠️ Pi Continue failed` | `Continue watchdog decision failed` | `decision-failed` |
| `agent-notify` | `🤖 ` + producer `TITLE` | producer `CONTENT` | `agent` |

For fictitious host `example-host` and cwd `/srv/app`, an AI unlock is submitted as:

```text
Title: 🙋 Pi Done · example-host · /srv/app
Body:  Waiting for user confirmation
       session id: <SESSION_ID>
Tags:  done,example-host
```

## Install

```bash
pi install git:github.com/xz-dev/pi-notify
pi install git:github.com/xz-dev/pi-continue-watchdog
```

Restart Pi after installation or use Pi's supported reload flow.

## Configuration

The inline `js:` remains here because this recipe needs conditional `STOP_KIND` routing, shared sanitization, and independent OSC/ntfy delivery. For ordinary fixed text, prefer the built-in `bel`, templated `osc:`, and structured `shell:` actions shown in the other examples.

Write the following nested config to `$PI_CODING_AGENT_DIR/pi-notify.json` (normally `~/.pi/agent/pi-notify.json`). Replace `YOUR_PRIVATE_TOPIC`; an ntfy topic URL should be treated like a credential and must not be committed.

```json
{
  "hooks": {
    "watchdog-continued": {
      "delayMs": 0,
      "actions": [
        "bel",
        "osc:▶️ Pi Continue · {{HOSTNAME}} · {{CWD}}|{{REASON_TYPE}} · {{REASON}}\nsession id: {{SESSION_ID}}",
        "cmd:\"$PI_CODING_AGENT_DIR/pi-notify-ntfy.mjs\" continue"
      ]
    },
    "user-ready": {
      "delayMs": 0,
      "actions": [
        "bel",
        "js:const cleanBody=(value)=>String(value??'').replace(/\\r\\n?/g,'\\n').replace(/[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f]/g,'');const cleanHeader=(value)=>String(value??'').replace(/[\\r\\n\\u2028\\u2029]+/g,' ').replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g,'');const warn=()=>{try{process.stderr.write('[pi-notify-config] Cannot launch ntfy\\n')}catch{}};const publish=(rawTitle,rawMessage,semanticTag)=>{const cwd=cleanHeader(notification.cwd);const sessionId=cleanHeader(notification.sessionId);const rawHostname=process.env.HOSTNAME??process.getBuiltinModule('os').hostname();const hostname=cleanHeader(rawHostname).trim()||'unknown-host';const hostnameTag=hostname.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'unknown-host';const title=cleanHeader(rawTitle)+' · '+hostname+' · '+cwd;const body=cleanBody(rawMessage)+'\\nsession id: '+sessionId;const tags=semanticTag+','+hostnameTag;try{notification.osc(title,body)}catch{}try{const child=process.getBuiltinModule('child_process').spawn('curl',['-fsS','--max-time','15','-o','/dev/null','-H','Title: '+title,'-H','Tags: '+tags,'--data-raw',body,'https://ntfy.sh/YOUR_PRIVATE_TOPIC'],{detached:true,stdio:'ignore',windowsHide:true,shell:false});child.once('error',warn);child.unref()}catch{warn()}};const kind=notification.values.STOP_KIND;if(kind==='AI_UNLOCK')publish('🙋 Pi Done',notification.values.REASON,'done');else if(kind==='EXHAUSTED')publish('🛑 Pi Continue stopped','Continue watchdog retry limit reached','retry-limit');else if(kind==='DECISION_FAILED')publish('⚠️ Pi Continue failed','Continue watchdog decision failed','decision-failed')"
      ]
    },
    "agent-notify": {
      "delayMs": 0,
      "actions": [
        "bel",
        "js:const cleanBody=(value)=>String(value??'').replace(/\\r\\n?/g,'\\n').replace(/[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f]/g,'');const cleanHeader=(value)=>String(value??'').replace(/[\\r\\n\\u2028\\u2029]+/g,' ').replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g,'');const warn=()=>{try{process.stderr.write('[pi-notify-config] Cannot launch ntfy\\n')}catch{}};const publish=(rawTitle,rawMessage,semanticTag)=>{const cwd=cleanHeader(notification.cwd);const sessionId=cleanHeader(notification.sessionId);const rawHostname=process.env.HOSTNAME??process.getBuiltinModule('os').hostname();const hostname=cleanHeader(rawHostname).trim()||'unknown-host';const hostnameTag=hostname.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'unknown-host';const title=cleanHeader(rawTitle)+' · '+hostname+' · '+cwd;const body=cleanBody(rawMessage)+'\\nsession id: '+sessionId;const tags=semanticTag+','+hostnameTag;try{notification.osc(title,body)}catch{}try{const child=process.getBuiltinModule('child_process').spawn('curl',['-fsS','--max-time','15','-o','/dev/null','-H','Title: '+title,'-H','Tags: '+tags,'--data-raw',body,'https://ntfy.sh/YOUR_PRIVATE_TOPIC'],{detached:true,stdio:'ignore',windowsHide:true,shell:false});child.once('error',warn);child.unref()}catch{warn()}};if(typeof notification.values.TITLE==='string'&&typeof notification.values.CONTENT==='string')publish('🤖 '+notification.values.TITLE,notification.values.CONTENT,'agent')"
      ]
    }
  }
}
```

Why `delayMs` is `0`: the watchdog already waits for its authoritative terminal aggregate-idle boundary. The consumer should not add another arbitrary delay.

## Safety and transport details

- This is trusted executable `js:` configuration. Keep the global file owner-only (`chmod 600`) and use project config only in trusted projects.
- `cleanHeader` turns CR, LF, U+2028, and U+2029 into spaces and strips C0/C1 controls. Titles, hostname, cwd, and the session-ID suffix therefore stay single-line.
- `cleanBody` preserves LF but strips other C0/C1 controls. Producer content may be multiline; the final session line remains structurally one line.
- Curl is invoked directly with argv and `shell: false`; `--data-raw` preserves the multiline body without treating leading `@` as a filename.
- OSC and ntfy are attempted independently. Launch failures are bounded and do not throw into Pi's hook lifecycle.
- Unknown `STOP_KIND` and incomplete `agent-notify` values are silent.
- The hostname tag is lowercase and allows only ASCII letters/digits, `.`, `_`, and `-`; unsafe runs become `-`.

### Multiline compatibility

The same cleaned title/body strings are submitted to both transports; that is submission parity, not guaranteed visual parity:

- ntfy carries the body LF through `--data-raw`.
- Kitty OSC 99 uses UTF-8 Base64 (`e=1`) and preserves LF on the wire.
- Windows toast, iTerm2 OSC 9, and generic OSC 777 receive LF best-effort; their final displayed layout is client-defined and may fold or rewrap it.

Kitty protocol reference: <https://sw.kovidgoyal.net/kitty/desktop-notifications/>

## Verify without sending a real notification

1. Parse the config:

   ```bash
   python3 -m json.tool ~/.pi/agent/pi-notify.json >/dev/null
   ```

2. Put a fake `curl` earlier in `PATH` that records argv to a mode-600 temporary file and performs no network request.
3. Start a fresh isolated Pi process/runtime in a known cwd and use a known session ID.
4. Exercise `watchdog-continued`, `AI_UNLOCK`, `EXHAUSTED`, `DECISION_FAILED`, and `agent_notify`.
5. Assert one OSC attempt and one ntfy attempt per valid event; manual unlock, abort, unknown stop kinds, and malformed values must remain silent.
6. Verify title order is status → hostname → absolute cwd, body ends with one `session id:` line, and curl has two tags.
7. Include hostile CR/LF/U+2028/U+2029 in title metadata and verify the `Title:` header remains one line; include LF in message content and verify the body retains it.

Only after local capture passes should you optionally send one clearly marked live ntfy smoke.

## Related

- [pi-notify README](../README.md)
- [Ask-user lifecycle example](./rpiv-ask-user-question.md)
- [ntfy tags and emoji documentation](https://docs.ntfy.sh/publish/#tags-emojis)
