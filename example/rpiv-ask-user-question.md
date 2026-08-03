# Example: rpiv-ask-user-question + pi-notify

This standalone recipe sends a notification when [`@juicesharp/rpiv-ask-user-question`](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question) starts its model-visible `ask_user_question` tool.

Unlike the watchdog example, this uses a Pi **lifecycle event**, not the neutral semantic-hook bus:

```text
rpiv-ask-user-question
        |
        | tool starts: ask_user_question
        v
Pi tool_execution_start
        |
        | events["tool_execution_start:ask_user_question"]
        v
pi-notify
        +-- terminal OSC / Windows toast
        +-- detached curl POST to ntfy
```

pi-notify observes the tool start; it does not block, rewrite, answer, or inspect the questionnaire. Other tools do not match this binding. This recipe intentionally does not publish question text, options, or answers.

## Notification format

```text
Title: ❓ Pi Question · <hostname> · <absolute Pi cwd>
Body:  ask_user_question needs your input in <absolute Pi cwd>
       session id: <SESSION_ID>
Tags:  input-required,<hostname-tag>
```

Hostname resolution prefers `process.env.HOSTNAME`, then `os.hostname()` when the environment variable is undefined. The ntfy request contains two tags: the semantic `input-required` tag and a lowercase, comma-safe hostname tag.

OSC and ntfy receive the same cleaned logical title/body strings. Kitty and ntfy preserve the LF before `session id:` in transport; Windows toast, iTerm2 OSC 9, and OSC 777 display multiline text best-effort.

## Install

```bash
pi install git:github.com/xz-dev/pi-notify
pi install npm:@juicesharp/rpiv-ask-user-question
```

Restart Pi after installation or use Pi's supported reload flow.

## Configuration

The inline `js:` below is retained for the full OSC/ntfy parity recipe: it builds one sanitized hostname-tagged payload and sends it independently to both transports. If you only need terminal notification, prefer `"bel"` plus a templated `osc:` action as shown in the README.

Write the following nested config to `$PI_CODING_AGENT_DIR/pi-notify.json` (normally `~/.pi/agent/pi-notify.json`). If the file already contains `hooks`, merge this `events` object instead of replacing unrelated bindings.

Replace `YOUR_PRIVATE_TOPIC`; treat a real ntfy topic URL like a credential.

```json
{
  "events": {
    "tool_execution_start:ask_user_question": {
      "delayMs": 0,
      "actions": [
        "bel",
        "js:const cleanBody=(value)=>String(value??'').replace(/\\r\\n?/g,'\\n').replace(/[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f]/g,'');const cleanHeader=(value)=>String(value??'').replace(/[\\r\\n\\u2028\\u2029]+/g,' ').replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g,'');const warn=()=>{try{process.stderr.write('[pi-notify-config] Cannot launch ntfy\\n')}catch{}};const publish=(rawTitle,rawMessage,semanticTag)=>{const cwd=cleanHeader(notification.cwd);const sessionId=cleanHeader(notification.sessionId);const rawHostname=process.env.HOSTNAME??process.getBuiltinModule('os').hostname();const hostname=cleanHeader(rawHostname).trim()||'unknown-host';const hostnameTag=hostname.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'unknown-host';const title=cleanHeader(rawTitle)+' · '+hostname+' · '+cwd;const body=cleanBody(rawMessage)+'\\nsession id: '+sessionId;const tags=semanticTag+','+hostnameTag;try{notification.osc(title,body)}catch{}try{const child=process.getBuiltinModule('child_process').spawn('curl',['-fsS','--max-time','15','-o','/dev/null','-H','Title: '+title,'-H','Tags: '+tags,'--data-raw',body,'https://ntfy.sh/YOUR_PRIVATE_TOPIC'],{detached:true,stdio:'ignore',windowsHide:true,shell:false});child.once('error',warn);child.unref()}catch{warn()}};const cwd=cleanHeader(notification.cwd);publish('❓ Pi Question',String(notification.tool)+' needs your input in '+cwd,'input-required')"
      ]
    }
  }
}
```

## Why this does not leak the question

The action uses only pi-notify's live notification context:

- `notification.tool` — `ask_user_question`
- `notification.cwd` — current absolute Pi cwd
- `notification.sessionId` — current Pi session ID

It never reads the retained causal event's arguments, so prompt text and option labels are not sent to ntfy.

## Safety details

- This is full-privilege `js:` configuration. Keep a global config owner-only (`chmod 600`) and allow project config only in trusted projects.
- `cleanHeader` makes status title, hostname, cwd, and session ID single-line by normalizing CR, LF, U+2028, and U+2029 and stripping C0/C1 controls.
- The cwd inserted into the ask-user message is passed through `cleanHeader`, so a newline-bearing path cannot create extra body lines.
- `cleanBody` preserves LF for real multiline message content and strips other C0/C1 controls.
- Curl uses direct argv, `shell: false`, a 15-second bound, ignored stdio, and `--data-raw`; no host-shell string is constructed.
- OSC and ntfy launch paths are independent and non-blocking.
- The hostname tag permits only lowercase ASCII letters/digits, `.`, `_`, and `-`; unsafe runs become `-`, with `unknown-host` as fallback.

## Multiline compatibility

The recipe submits the same cleaned strings to OSC and ntfy, but final rendered layout depends on the client:

- ntfy preserves the body LF sent via `--data-raw`.
- Kitty OSC 99 uses UTF-8 Base64 (`e=1`) and preserves LF on the wire.
- Windows toast, iTerm2 OSC 9, and generic OSC 777 receive LF best-effort and may fold or rewrap it.

Kitty protocol reference: <https://sw.kovidgoyal.net/kitty/desktop-notifications/>

## Verify without network access

1. Parse the config:

   ```bash
   python3 -m json.tool ~/.pi/agent/pi-notify.json >/dev/null
   ```

2. Put a fake `curl` earlier in `PATH`; it should record argv to a private temporary file and exit without networking.
3. Start a fresh isolated Pi runtime in a known cwd/session and cause the model to call `ask_user_question`.
4. Assert exactly one OSC attempt and one curl attempt when the tool starts. Answering or dismissing the question must not create another notification from this binding.
5. Check the title order is `❓ Pi Question · hostname · cwd`.
6. Check the body has exactly the tool/cwd line followed by `session id: ...`.
7. Check ntfy tags are exactly `input-required,<normalized-hostname>`.
8. Start another tool and verify this binding remains silent.
9. Inspect the recorded body and ensure no question text or option labels are present.
10. Test hostile CR/LF/U+2028/U+2029 in cwd/session/hostname and verify title/session metadata stay single-line.

## Related

- [pi-notify README](../README.md)
- [Continue-watchdog semantic-hook example](./pi-continue-watchdog.md)
- [ntfy tags documentation](https://docs.ntfy.sh/publish/#tags-emojis)
