# Example: `agent_notify` + pi-notify

This recipe enables pi-notify's optional model-facing tool:

```text
agent_notify({ title, content })
```

The tool publishes the neutral `agent-notify` semantic hook. It is registered only when `hooks["agent-notify"]` has at least one valid action.

## Recommended readable configuration

Use built-in actions for behavior pi-notify already supports. This example sends one terminal BEL and one templated OSC/Windows notification without JavaScript:

```json
{
  "hooks": {
    "agent-notify": {
      "delayMs": 0,
      "actions": [
        "bel",
        "osc:🤖 {{TITLE}} · {{HOSTNAME}} · {{CWD}}|{{CONTENT}}\nsession id: {{SESSION_ID}}"
      ]
    }
  }
}
```

Available producer templates are `{{TITLE}}` and `{{CONTENT}}`; normal pi-notify context templates such as `{{HOSTNAME}}`, `{{CWD}}`, and `{{SESSION_ID}}` are also available.

Use `js:` only when the action is genuinely conditional or cannot be represented by templates and built-in actions.

## Optional ntfy companion

For a remote ntfy notification, copy [`pi-notify-ntfy.mjs`](./pi-notify-ntfy.mjs) to a private path outside the package, replace `YOUR_PRIVATE_TOPIC`, and make it owner-executable:

```bash
install -m 700 example/pi-notify-ntfy.mjs ~/.pi/agent/pi-notify-ntfy.mjs
```

Then append a portable `cmd:` action. The host shell expands `$HOME`, so the same config works under different user home directories:

```json
{
  "hooks": {
    "agent-notify": {
      "delayMs": 0,
      "actions": [
        "bel",
        "osc:🤖 {{TITLE}} · {{HOSTNAME}} · {{CWD}}|{{CONTENT}}\nsession id: {{SESSION_ID}}",
        "cmd:\"$HOME/.pi/agent/pi-notify-ntfy.mjs\" agent"
      ]
    }
  }
}
```

Do not put `$HOME` in a structured `shell:` tuple: tuples use direct argv execution (`shell: false`), so environment-variable text is not expanded.

The tuple is direct argv execution (`shell: false`), not a shell command string. The helper receives notification context through `PI_NOTIFY_*`; it does not need embedded JavaScript in JSON.

Treat a real ntfy topic URL as a credential. Keep the private helper owner-only and never commit it with the topic filled in.

## AI-facing behavior

A successful tool call returns exactly:

```text
Notification hook published
```

This confirms synchronous publication to Pi's neutral bus, not delivery completion. BEL/OSC/process failures are non-blocking consumer failures and do not alter the model tool result.

## Related

- [pi-notify README](../README.md)
- [Ask-user lifecycle example](./rpiv-ask-user-question.md)
- [Continue-watchdog semantic-hook example](./pi-continue-watchdog.md)
