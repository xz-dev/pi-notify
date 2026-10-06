# Example: Herdr notifications with source IDs

Add a Herdr popup alongside BEL, OSC, and any existing push actions. Its body names the originating tab, pane, and Pi session; its title identifies the event or hook.

This does **not** capture arbitrary commands' BEL output. A bell alone does not identify its source. This recipe explicitly calls `herdr notification show` when a configured Pi event or hook fires.

## Requirements

- Run Pi inside Herdr (`HERDR_ENV=1`) with `herdr` on `PATH`.
- Herdr supplies `HERDR_TAB_ID` and `HERDR_PANE_ID`; pi-notify supplies `PI_NOTIFY_SESSION_ID` and event/hook fields.
- These commands use a POSIX shell (`cmd:` uses `/bin/sh` on Unix-like systems).

Verify installed syntax with `herdr --help` and `herdr notification`. Current syntax:

```sh
herdr notification show "Command finished" \
  --body "tab=$HERDR_TAB_ID pane=$HERDR_PANE_ID" \
  --sound none
```

`--sound none` avoids adding a second sound when BEL or another action already provides one. The IDs are inherited process context, not a lookup of the UI-focused pane; after moving a pane, inherited IDs can be stale. The `session` field below is Pi's session ID, not a Herdr session name.

## Configuration

Merge into `$PI_CODING_AGENT_DIR/pi-notify.json` (default `~/.pi/agent/pi-notify.json`). **Append the `cmd:` action to existing action arrays**, rather than overwriting your OSC text, private push commands, or conditions. Matching trusted-project bindings replace global bindings as whole units; append there instead if a project overrides the binding.

The guard belongs inside each Herdr action, not on the whole binding: outside Herdr, BEL/OSC/push actions must still run. Quoted shell variables preserve spaces and shell metacharacters as data. Do not use `{{HERDR_TAB_ID}}` templates or put `$HERDR_TAB_ID` in direct `shell:` argv: neither expands inherited shell variables.

This standalone example covers questions, explicit agent notices, Continue completion/continuation, and reflection. `WAIT_CALLBACK` stays silent. Incomplete reflections also stay silent. It does not add `agent_settled`, which could duplicate watchdog completion notifications.

```json
{
  "events": {
    "tool_execution_start:ask_user_question": {
      "delayMs": 0,
      "actions": [
        "bel",
        "osc:Pi Question|Input needed in {{CWD}}",
        "cmd:if [ \"${HERDR_ENV:-}\" = 1 ]; then herdr notification show \"Pi ${PI_NOTIFY_HOOK:-$PI_NOTIFY_EVENT}\" --body \"tab=$HERDR_TAB_ID pane=$HERDR_PANE_ID session=$PI_NOTIFY_SESSION_ID\" --sound none; fi"
      ]
    }
  },
  "hooks": {
    "agent-notify": {
      "delayMs": 0,
      "actions": [
        "bel",
        "osc:{{TITLE}}|{{CONTENT}}",
        "cmd:if [ \"${HERDR_ENV:-}\" = 1 ]; then herdr notification show \"Pi ${PI_NOTIFY_HOOK:-$PI_NOTIFY_EVENT}\" --body \"tab=$HERDR_TAB_ID pane=$HERDR_PANE_ID session=$PI_NOTIFY_SESSION_ID\" --sound none; fi"
      ]
    },
    "user-ready": {
      "delayMs": 0,
      "if": "notification.values.REASON_TYPE?.toUpperCase() !== 'WAIT_CALLBACK'",
      "actions": [
        "bel",
        "osc:Pi Ready|{{STOP_KIND}} · {{REASON}}",
        "cmd:if [ \"${HERDR_ENV:-}\" = 1 ]; then herdr notification show \"Pi ${PI_NOTIFY_HOOK:-$PI_NOTIFY_EVENT}\" --body \"tab=$HERDR_TAB_ID pane=$HERDR_PANE_ID session=$PI_NOTIFY_SESSION_ID\" --sound none; fi"
      ]
    },
    "watchdog-continued": {
      "delayMs": 0,
      "actions": [
        "bel",
        "osc:Pi Continue|Continue watchdog continued",
        "cmd:if [ \"${HERDR_ENV:-}\" = 1 ]; then herdr notification show \"Pi ${PI_NOTIFY_HOOK:-$PI_NOTIFY_EVENT}\" --body \"tab=$HERDR_TAB_ID pane=$HERDR_PANE_ID session=$PI_NOTIFY_SESSION_ID\" --sound none; fi"
      ]
    },
    "reflection-completed": {
      "delayMs": 0,
      "if": "['REFLECTION_TYPE', 'REASON', 'NEXT_STEP'].every(key => notification.values[key]?.trim())",
      "actions": [
        "bel",
        "osc:Pi Reflection · {{REFLECTION_TYPE}}|{{REASON}}\nNext: {{NEXT_STEP}}",
        "cmd:if [ \"${HERDR_ENV:-}\" = 1 ]; then herdr notification show \"Pi ${PI_NOTIFY_HOOK:-$PI_NOTIFY_EVENT}\" --body \"tab=$HERDR_TAB_ID pane=$HERDR_PANE_ID session=$PI_NOTIFY_SESSION_ID\" --sound none; fi"
      ]
    }
  }
}
```

Existing reflection recipes validate all three fields inside `js:` and backend helpers. When appending Herdr, add the same binding-level condition shown above so malformed reflection hooks do not create a popup while the existing actions stay silent.

Restart Pi to load edited configuration. No new pi-notify backend or helper installation is needed. If Herdr cannot be launched inside Herdr, the ordinary command-action warning reports the failure; other actions remain independent.

## Verify

Recipe checks use a fake `herdr` executable, not the user's running session:

```sh
TMPDIR=/var/tmp node --import tsx --test test/herdr-example.test.ts
```

For one live popup, run inside the intended Herdr pane:

```sh
if [ "${HERDR_ENV:-}" = 1 ]; then
  herdr notification show "Pi source test" \
    --body "tab=$HERDR_TAB_ID pane=$HERDR_PANE_ID" --sound none
fi
```

Only configured events/hooks get source popups. Unrelated terminal bells remain unchanged.
