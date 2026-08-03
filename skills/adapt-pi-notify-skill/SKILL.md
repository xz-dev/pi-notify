---
name: adapt-pi-notify-skill
description: Adapt an independent Pi extension to publish neutral semantic hooks that pi-notify can consume, or configure and verify pi-notify hook actions safely.
---

# Adapt Pi Notify

## When to Use

Use this skill when:

- a Pi extension owns a meaningful state transition that should trigger user notification;
- pi-notify should consume a new semantic hook without importing or identifying its producer;
- a pi-notify `events` or `hooks` binding needs `delayMs`, templates, commands, or JavaScript actions;
- an installed Git package and protected local pi-notify configuration must be migrated and verified.

Do not use this protocol when a normal Pi lifecycle event already expresses the exact fact. Do not make pi-notify infer domain state that belongs to another extension.

## Preconditions and Ownership

Before writing code:

1. Identify the extension that owns the semantic truth.
2. Define the exact event-time meaning and the producer's epoch or at-most-once rule.
3. Define false-positive and false-negative examples, including intermediate states that must not publish.
4. Agree on the hook name and optional string values with the human.
5. Record acceptance examples and prove one representative RED before production edits.

The producer owns semantic timing and de-duplication. pi-notify owns only generic routing and action execution. Neither side imports, identifies, queries, requires, acknowledges, or waits for the other.

## Neutral Protocol

Publish on Pi's public ResourceLoader-local bus:

```text
pi:semantic-hook:v1
```

Use a fresh plain-data envelope:

```ts
interface SemanticHookV1 {
  readonly version: 1;
  readonly name: string; // lowercase kebab-case
  readonly values?: Readonly<Record<string, string>>;
}
```

Example:

```ts
pi.events.emit(
  "pi:semantic-hook:v1",
  Object.freeze({
    version: 1,
    name: "build-finished",
    values: Object.freeze({ RESULT: "SUCCESS" }),
  }),
);
```

Protocol constraints:

- `name` is lowercase kebab-case.
- `values` keys are uppercase underscore identifiers and every value is a string.
- Create a new envelope per emission and do not mutate it afterward.
- Do not include `ctx`, functions, callbacks, class instances, extension objects, state handles, secrets, or producer/consumer identity.
- Delivery is best-effort to current listeners only: no buffering, replay, acknowledgment, retry, or backpressure.
- The producer never inspects listener presence or consumer completion.
- When scope matters, aggregate state in the producer and emit from the elected main attachment because separate ResourceLoaders have separate buses.

## Minimal Producer Procedure

1. Add a tiny protocol module containing only the neutral channel, plain envelope types/builders, and emitter.
2. Wire it at the producer's existing authoritative seam; do not duplicate the domain state machine in pi-notify.
3. Add the smallest generation/epoch guard needed for at-most-once behavior.
4. Ensure intermediate states, human-owned actions, stale ownership, reload, and shutdown do not publish unless the accepted contract explicitly says otherwise.
5. Treat listener absence or failure as irrelevant to producer behavior.
6. Test with an independent temporary consumer probe that knows only the neutral channel and schema.

### Watchdog example

`pi-continue-watchdog` publishes `user-ready` only for automatic terminal states that need user attention:

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

or:

```json
{
  "version": 1,
  "name": "user-ready",
  "values": {
    "STOP_KIND": "EXHAUSTED"
  }
}
```

or:

```json
{
  "version": 1,
  "name": "user-ready",
  "values": {
    "STOP_KIND": "DECISION_FAILED"
  }
}
```

AI decision unlock uses the producer's existing validated reason. Human unlock and user/manual abort are intentionally silent. This is an example of producer-owned semantics, not a pi-notify dependency.

## pi-notify Consumer Configuration

The target configuration is intentionally split into Pi lifecycle events and semantic hooks:

```json
{
  "events": {
    "tool_execution_start:ask_user_question": {
      "delayMs": 0,
      "actions": ["osc"]
    }
  },
  "hooks": {
    "build-finished": {
      "delayMs": 0,
      "actions": ["osc:Build|{{RESULT}}"]
    }
  }
}
```

pi-notify routes any valid envelope by `hooks[envelope.name]`; it must not contain a hook-name whitelist.

Semantic hook actions receive consumer-owned fields:

```text
HOOK=<name>
EVENT=hook:<name>
```

and validated producer values as templates and `PI_NOTIFY_*`, unless they collide with reserved consumer-owned fields.

The model tool `agent_notify({ title, content })` is an independent producer of `agent-notify`. It is exposed only when that hook has valid configured actions. A successful synchronous bus publication returns exactly:

```text
Notification hook published
```

Consumer action failures are not acknowledgments and do not alter the tool result.

## Delay Semantics

Each binding has:

```ts
{
  delayMs: number; // non-negative integer milliseconds, default 0
  actions: NotificationAction[];
}
```

Execution order is strict:

1. validate and copy immutable causal event or hook data;
2. wait for `delayMs`;
3. verify the consumer generation is still current;
4. collect live cwd, session fields, valid Pi context, and inherited process environment;
5. construct `PI_NOTIFY_*`, render templates, and execute actions.

Do not snapshot runtime data, inherited environment, command environment, or rendered strings before the delay. Delayed JavaScript receives retained causal data plus execution-time context.

`delayMs` is a display/execution delay, not semantic revalidation:

- no debounce, de-duplication, coalescing, or latest-event replacement;
- new activity does not cancel a valid semantic event;
- every received event has an independent timer;
- reload/shutdown cancels pending timers and advances generation;
- check generation before and after awaited work.

Use `delayMs: 0` when the producer already emits at the authoritative final boundary, as watchdog does for `user-ready`.

## JavaScript Notification Helpers

When conditional notification text is needed, use the generic JavaScript notification context rather than hardcoding semantics in pi-notify:

```js
const kind = notification.values.STOP_KIND;
if (kind === "AI_UNLOCK") {
  notification.osc("Pi", notification.values.REASON);
} else if (kind === "EXHAUSTED") {
  notification.osc("Pi", "Continue watchdog exhausted");
} else if (kind === "DECISION_FAILED") {
  notification.osc("Pi", "Continue watchdog decision failed");
}
```

`notification.osc(title, body)` must reuse pi-notify's existing safe Windows Terminal, WSL PowerShell, Kitty, iTerm2, OSC 777, and tmux backend. Treat producer values as untrusted display/command inputs and quote command usage correctly.

## Independence and Security

Never:

- import another plugin's private runtime;
- poll another plugin's lock/state variables;
- put plugin names in the neutral channel;
- send Pi custom messages merely to bridge extensions;
- add callback/ack objects to the envelope;
- expose secrets in hook values, tests, logs, commits, or reports;
- edit `~/.pi/agent/git/...` installed checkouts directly.

Trusted project configuration is executable code when it contains `js:` or process actions. Preserve Pi's project-trust gate. Producer values cannot override consumer-owned `EVENT`, `HOOK`, `CWD`, `SESSION_ID`, `SESSION_FILE`, `TOOL`, or `TOOL_CALL_ID`.

## ATDD and TDD

Before implementation, agree on concrete examples covering:

- every state that publishes;
- every intermediate/human state that stays silent;
- exact envelope values;
- at-most-once epoch behavior;
- stale generation/demotion/reload behavior;
- consumer absent, throwing, and asynchronously rejecting;
- invalid/unknown envelopes;
- binding delay and live execution-time data collection.

Add a representative acceptance test and run it against the baseline to prove RED. Save concise RED evidence outside the repository. Then implement one vertical slice at a time and independently review the exact staged artifact.

## Packed and Live Verification

1. Run full unit, lint, typecheck, and build checks with finite timeouts.
2. `npm pack` the exact candidate and inspect the file inventory.
3. Install into an isolated temporary HOME and Pi agent directory.
4. Load a separate neutral producer or consumer probe; it must not import the product package.
5. Test current-listener delivery, producer independence, delay timing, live environment collection, and reload cleanup.
6. Launch a fresh isolated Pi process for live acceptance. Do not reuse or reload the user's current Pi session when a new process can prove the behavior.
7. After review and push, update Git packages through Pi CLI, not by editing installed files.
8. Back up protected config with mode/owner/hash, migrate atomically, preserve private action bytes, and verify mode afterward.

## Pitfalls

- Emitting generic `agent_settled` from a consumer cannot replace producer-owned domain truth.
- Pi buses are ResourceLoader-local; child and main sessions may not share one.
- `pi.events.emit()` does not await asynchronous consumers.
- Removing a listener cannot cancel consumer work already in flight.
- A fake clock must advance `now()` when runtime timers use deadlines/chunking.
- A bare hook `osc` has no semantic-specific default text; configure explicit text, or use `notification.osc`.
- Do not add a delay after an already-authoritative producer boundary merely to guess whether work resumes.

## Completion Checklist

- [ ] Human accepted semantic name, values, and silent states.
- [ ] Producer and consumer remain mutually unaware.
- [ ] Representative RED captured before production changes.
- [ ] Envelope is fresh, plain, validated, and transitively read-only.
- [ ] Producer emits from the correct main/epoch seam at most once.
- [ ] Generic consumer has no semantic-name whitelist.
- [ ] Delay collects live runtime/environment only after waiting.
- [ ] Reload/shutdown cancels timers and stale async side effects.
- [ ] Full and packed isolated tests pass.
- [ ] Fresh Pi process acceptance passes.
- [ ] Independent review approves the exact staged artifact.
- [ ] Package updates use Pi CLI and installed revisions match source.
- [ ] Local config migration preserves ownership, mode, and private actions.
