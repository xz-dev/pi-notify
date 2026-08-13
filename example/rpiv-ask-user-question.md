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
        +-- detached Node helper POST to ntfy
```

pi-notify observes the tool start; it does not block, rewrite, or answer the questionnaire. Other tools do not match this binding. This recipe publishes only each question's `question` text; options and answers are never published.

## Notification format

```text
Title: ❓ Pi Question · <hostname> · <absolute Pi cwd>
Body:  <question text>
       session id: <SESSION_ID>

For multiple questions:
       1. <first question>
       2. <second question>
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

The inline `js:` below reads the retained causal event's `event.args.questions[].question`, formats one question directly or multiple questions as numbered lines, then sends the body to OSC and a detached ntfy helper. It passes `notification.sessionId`, cwd, and hostname explicitly to the child; options and answers never leave Pi.

Write the following nested config to `$PI_CODING_AGENT_DIR/pi-notify.json` (normally `~/.pi/agent/pi-notify.json`). If the file already contains `hooks`, merge this `events` object instead of replacing unrelated bindings.

Install the companion helper, replace `YOUR_PRIVATE_TOPIC` in the copied file, and keep it owner-only:

```bash
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$agent_dir"
install -m 700 example/pi-notify-ntfy.mjs "$agent_dir/pi-notify-ntfy.mjs"
```

The example action resolves `$PI_CODING_AGENT_DIR` (or `~/.pi/agent`) at runtime and starts this helper with `process.execPath`; it does not hardcode `/usr/bin/node`. It uses a unique body filename per tool call, so overlapping notifications do not overwrite each other. Treat a real ntfy topic URL like a credential.

```json
{
  "events": {
    "tool_execution_start:ask_user_question": {
      "delayMs": 0,
      "actions": [
        "bel",
        "js:const questions=event?.args?.questions?.map((item)=>item?.question).filter((question)=>typeof question==='string'&&question.length>0)??[];const body=questions.length===1?questions[0]:questions.map((question,index)=>`${index+1}. ${question}`).join('\\n');if(body){const fs=process.getBuiltinModule('node:fs');const path=process.getBuiltinModule('node:path');const agentDir=process.env.PI_CODING_AGENT_DIR??path.join(process.env.HOME??'.','.pi','agent');const callId=String(event?.toolCallId??Date.now()).replace(/[^a-zA-Z0-9._-]/g,'_');const bodyFile=path.join(agentDir,`pi-notify-question-body-${callId}-${Math.random().toString(36).slice(2)}.txt`);const helper=path.join(agentDir,'pi-notify-ntfy.mjs');fs.writeFileSync(bodyFile,body,{mode:0o600});const child=process.getBuiltinModule('node:child_process').spawn(process.execPath,[helper],{detached:true,stdio:'ignore',env:{...process.env,PI_NOTIFY_DELIVERY_MODE:'question',PI_NOTIFY_QUESTION_BODY_FILE:bodyFile,PI_NOTIFY_HOSTNAME:notification.hostname??'',PI_NOTIFY_CWD:notification.cwd,PI_NOTIFY_SESSION_ID:notification.sessionId}});child.unref();notification.osc(`❓ Pi Question · ${notification.hostname} · ${notification.cwd}`,body)}"
      ]
    }
  }
}
```

## What gets published

The action reads only `event.args.questions[].question`:

- One question: question text directly.
- Multiple questions: numbered lines (`1.`, `2.`, `3.`).
- Options, descriptions, headers, previews, and answers are not read.
- `notification.sessionId`, `notification.cwd`, and `notification.hostname` are passed explicitly to the detached helper, so session ID remains available outside the Pi process.

## Safety details

- This is full-privilege `js:` configuration. Keep a global config owner-only (`chmod 600`) and allow project config only in trusted projects.
- `cleanHeader` makes status title, hostname, cwd, and session ID single-line by normalizing CR, LF, U+2028, and U+2029 and stripping C0/C1 controls.
- The cwd inserted into the ask-user message is passed through `cleanHeader`, so a newline-bearing path cannot create extra body lines.
- `cleanBody` preserves LF for real multiline message content and strips other C0/C1 controls.
- The detached helper uses `fetch`, a 15-second bound, and ignored stdio; no host-shell string is constructed.
- OSC and ntfy launch paths are independent and non-blocking.
- The hostname tag permits only lowercase ASCII letters/digits, `.`, `_`, and `-`; unsafe runs become `-`, with `unknown-host` as fallback.

## Multiline compatibility

The recipe submits the same cleaned strings to OSC and ntfy, but final rendered layout depends on the client:

- ntfy preserves the body LF sent in the JSON request.
- Kitty OSC 99 uses UTF-8 Base64 (`e=1`) and preserves LF on the wire.
- Windows toast, iTerm2 OSC 9, and generic OSC 777 receive LF best-effort and may fold or rewrap it.

Kitty protocol reference: <https://sw.kovidgoyal.net/kitty/desktop-notifications/>

## Verify without network access

1. Parse the config:

   ```bash
   python3 -m json.tool ~/.pi/agent/pi-notify.json >/dev/null
   ```

2. Point the copied helper's `NTFY_URL` at a local HTTP test endpoint, or replace its `fetch` call in a temporary copy; verify the request body without contacting a public service.
3. Start a fresh isolated Pi runtime in a known cwd/session and cause the model to call `ask_user_question`.
4. Assert exactly one OSC attempt and one helper attempt when the tool starts. Answering or dismissing the question must not create another notification from this binding.
5. Check the title order is `❓ Pi Question · hostname · cwd`.
6. Check one-question body is exactly the question followed by `session id: ...`.
7. Check multiple-question body uses one numbered question per line, followed by non-empty `session id: ...`.
8. Check ntfy tags are exactly `input-required,<normalized-hostname>`.
9. Start another tool and verify this binding remains silent.
10. Inspect the recorded body and ensure no option labels, descriptions, headers, or previews are present.
11. Test hostile CR/LF/U+2028/U+2029 in cwd/session/hostname and verify title/session metadata stay single-line.

## Related

- [pi-notify README](../README.md)
- [Continue-watchdog semantic-hook example](./pi-continue-watchdog.md)
- [ntfy tags documentation](https://docs.ntfy.sh/publish/#tags-emojis)
