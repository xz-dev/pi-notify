# Neutral semantic hooks

Status: Implemented on feat/neutral-semantic-hooks (uncommitted worktree). Breaking nested events/hooks config, generic semantic-hook consumer, delay lifecycle, agent_notify producer migration, notification.values/osc helper, packed E2E, docs/skill updates.

## Goal

Make pi-notify a generic consumer of semantic hooks published by arbitrary Pi extensions while preserving complete producer/consumer independence.

- Producers know only the semantic event they publish.
- pi-notify knows no producer and contains no whitelist of hook names.
- No extension imports, queries, identifies, requires, acknowledges, or waits for another extension.
- Communication uses Pi's public `pi.events` bus in the shared main-session `ResourceLoader`.

The first intended producers are independent examples, not protocol dependencies:

- the existing `agent_notify` model tool publishes `agent-notify`;
- pi-continue-watchdog may publish `user-ready` after its own authoritative state machine determines that the observable agent system is idle and will not continue automatically.

## Proven feasibility

### Theory

Pi's source establishes:

1. Extensions loaded by one `ResourceLoader` share one `EventBus`.
2. Extension lifecycle handlers are invoked sequentially and awaited.
3. `pi.events.emit()` invokes current listeners without waiting for their asynchronous completion; listener errors are contained and logged by the bus.
4. A terminating watchdog decision tool mutates watchdog state before its run ends; final `agent_settled` occurs afterward.
5. A continue decision stays in the same run and does not create an intermediate `agent_settled`.

### Bounded installed-runtime experiment

Artifacts:

- `/tmp/pi-notify-watchdog-feasibility-20260801T141652Z/experiment.mjs`
- `/tmp/pi-notify-watchdog-feasibility-20260801T141652Z/output.txt`
- `/tmp/pi-notify-watchdog-feasibility-20260801T141652Z/evidence.json`

Runtime:

- `@xz-dev/pi-coding-agent@0.83.0-xz.119.1.g9c1f27f7`
- `@xz-dev/pi-agent-core@0.83.0-xz.119.1.g9c1f27f7`

Result: 6 cases and 65 trace events passed without a provider or network call:

- shared bus delivery in both extension load orders;
- payload preservation and asynchronous consumer completion after producer return;
- listener error containment;
- isolation between separate `ResourceLoader` buses;
- listener cleanup across actual resource reload;
- unlock decision: one provider call, state unlocked before one final settled, one semantic-ready emission;
- continue decision: two provider calls, no intermediate settled and no premature ready emission.

Independent verdict: **sufficient with explicit plan constraints**.

## Neutral wire protocol

Channel:

```text
pi:semantic-hook:v1
```

Envelope:

```ts
interface SemanticHookV1 {
  readonly version: 1;
  readonly name: string; // lowercase kebab-case
  readonly values?: Readonly<Record<string, string>>;
}
```

Example:

```json
{
  "version": 1,
  "name": "agent-notify",
  "values": {
    "TITLE": "Build done",
    "CONTENT": "All tests passed"
  }
}
```

Protocol rules:

- `name` matches lowercase kebab-case and is not assigned by pi-notify.
- `values` keys match uppercase underscore identifiers and values are strings.
- The producer creates a fresh plain-data envelope for each emission and must not mutate it afterward.
- Consumers treat the complete envelope as transitively read-only and copy any data retained past the callback.
- No `ctx`, functions, callbacks, class instances, extension objects, state handles, or plugin identity enter the envelope.
- Consumers validate before acting. Unknown versions, invalid envelopes, and unconfigured names are ignored safely.
- Consumer-owned context keys such as `EVENT`, `HOOK`, `CWD`, `SESSION_ID`, `SESSION_FILE`, `TOOL`, and `TOOL_CALL_ID` cannot be overwritten by producer values.

## Delivery semantics

The protocol is intentionally:

- best-effort;
- current-listener-only;
- ephemeral and unbuffered;
- non-acknowledged;
- non-replayed;
- non-retried;
- without backpressure.

The producer does not await or inspect consumer work. An absent or failing consumer never changes producer state or behavior. Each producer defines semantic epoch ownership and must publish at most once per such epoch when its product contract requires that guarantee.

The bus is `ResourceLoader`-local, not process-global. Producers that derive a process-wide result must emit from the elected main attachment, where consumers intended for the user's session are loaded. No cross-child-session bus delivery is claimed.

## pi-notify configuration redesign

This is an explicitly accepted breaking migration. The old flat top-level event keys and `pi_notify:agent_notify` form are rejected with bounded migration diagnostics; there is no compatibility mode.

```json
{
  "events": {
    "agent_settled": {
      "delayMs": 0,
      "actions": ["osc"]
    },
    "tool_execution_start:ask_user_question": {
      "delayMs": 0,
      "actions": ["osc"]
    }
  },
  "hooks": {
    "agent-notify": {
      "delayMs": 0,
      "actions": ["osc:{{TITLE}}|{{CONTENT}}"]
    },
    "user-ready": {
      "delayMs": 1000,
      "actions": ["osc:Pi|Ready for input"]
    }
  }
}
```

### Configuration precedence

The existing configuration locations remain unchanged:

1. global `$PI_CODING_AGENT_DIR/pi-notify.json`;
2. trusted project `<cwd>/.pi/pi-notify.json`.

Project configuration is read only when Pi reports the project trusted. Effective configuration merges independently by namespace and exact binding name:

- `events.<event-name>` in a trusted project replaces the matching global event binding as one complete `{ delayMs, actions }` unit;
- `hooks.<hook-name>` in a trusted project replaces the matching global hook binding as one complete unit;
- nonmatching global event and hook bindings remain available;
- bindings are never field-merged across precedence levels;
- an invalid higher-precedence binding is ignored with one bounded diagnostic and does not erase a valid lower-precedence binding;
- an explicit valid empty `actions` array is a complete replacement and disables that matching binding.

The breaking legacy top-level format is ignored with bounded migration diagnostics and does not participate in merging.

### Generic hook consumer

- Subscribe once to `pi:semantic-hook:v1` during extension activation/session setup.
- Validate the envelope, look up `hooks[envelope.name]`, and execute the existing action pipeline.
- The router does not contain `agent-notify`, `user-ready`, or any other semantic hook name.
- Add consumer-owned `HOOK` to templates and `PI_NOTIFY_HOOK`.
- For semantic hooks, set consumer-owned `EVENT` / `PI_NOTIFY_EVENT` to the stable logical event key `hook:<name>`; for example `hook:user-ready`. `HOOK` / `PI_NOTIFY_HOOK` contains only `<name>`. The bus channel itself is never exposed as `EVENT`.
- Merge validated producer `values` into template/environment values without allowing system-key overrides.
- Generic hook execution remains fire-and-forget from the bus producer's perspective. Within one binding, JavaScript actions retain their current awaited ordering; OSC and process actions retain fire-and-forget behavior.

### Binding delay

Every event or hook binding is:

```ts
{
  delayMs: number; // non-negative integer milliseconds, default 0
  actions: NotificationAction[];
}
```

`delayMs` is a pure display/execution delay:

- every received event schedules its own independent execution;
- no debounce, replacement, coalescing, or deduplication;
- new agent activity does not cancel or revalidate a semantic event;
- the consumer never interprets hook-specific truth;
- duplicate producer events may produce duplicate notifications.

The ordering is strictly **retain causal data, delay, collect live context, then execute** for both namespaces:

1. At receipt time, validate and copy only immutable causal data:
   - for `events`, the complete Pi event payload needed by delayed actions, including tool event arguments where the public event provides them;
   - for `hooks`, semantic `name` and producer `values`.
2. Do **not** retain a runtime-derived template map, command environment, inherited process environment, or pre-rendered action.
3. Wait for `delayMs`.
4. Verify the consumer generation is still current.
5. Collect live consumer/runtime data at that moment, including current cwd/session fields, a currently valid public `ExtensionContext`, consumer-owned template fields, and the inherited process environment used to build `PI_NOTIFY_*` command environments.
6. Render templates and launch/await actions. A delayed `js:` action receives the retained causal `event` or semantic envelope plus the newly collected execution-time `ctx` and notification context.

This execution-time `ctx` rule supersedes the prior plan's event-time-`ctx` wording whenever `delayMs > 0`; with `delayMs = 0`, receipt and execution occur in the same scheduling path but use the same conceptual split. The implementation must not pre-render templates, construct a command environment, or snapshot inherited environment/runtime context before the delay. Producer `values` and Pi event payloads remain event-time causal data; live consumer context is execution-time data. If a required public Pi context field cannot be read safely at execution time, the implementation must stop for a contract decision rather than silently fall back to a stale snapshot.

On `session_shutdown`/reload, pi-notify unsubscribes idempotently, cancels all pending binding timers, and advances a consumer generation. Every delayed callback and every continuation after an `await` checks that generation before causing a side effect. Old in-flight work is not assumed to be cancelled merely because the bus listener was removed.

### Existing AI tool as an independent producer

- The model-facing tool remains `agent_notify({ title, content })`.
- It is enabled only when `hooks["agent-notify"]` contains at least one valid action; otherwise it remains unregistered/unexposed.
- Tool execution publishes a neutral envelope named `agent-notify` with `TITLE` and `CONTENT` values.
- The tool producer knows its own semantic name but does not access action definitions or consumer internals.
- The generic router receives the envelope exactly like any other hook.
- Because bus delivery is non-acknowledged, the tool result truthfully reports only that the hook was published: exact model-visible success text is `Notification hook published`. Synchronous emit/construction failures are tool errors. Consumer/action failures warn independently and never feed back.

## Implementation slices

Do not start production work until the model-visible `agent_notify` result wording is explicitly accepted.

1. **Acceptance and config RED**
   - Fix exact tool-result wording.
   - Add RED tests for breaking `events`/`hooks` configuration, delay validation, trusted project replacement per matching event/hook, and bounded legacy diagnostics.
2. **Neutral protocol module**
   - Add envelope constants/types/validator and public-bus listener cleanup tests.
3. **Generic hook consumer**
   - Route arbitrary valid names without a name whitelist; assert `HOOK=<name>` and `EVENT=hook:<name>` in templates and environment; values/system-key override tests; unknown/invalid event tests.
4. **Delay lifecycle**
   - Fake-clock tests for independent timers, no debounce/dedup, pure display delay, shutdown cancellation, and generation guards before/after awaits.
   - For one ordinary Pi event and one semantic hook, prove delay-before-collection: mutate cwd/session/runtime context and inherited environment during the delay, then assert templates, `PI_NOTIFY_*`, and delayed `js:` inputs use retained causal payload plus values/context visible immediately before execution.
5. **AI producer migration**
   - Publish `agent-notify`, dynamically expose tool based on the generic mapping, remove special action dispatch, and verify model-visible result wording.
6. **Packed stock-Pi E2E**
   - Install the packed artifact in isolation with stock supported Pi.
   - Load a separate temporary neutral producer extension.
   - Verify generic hook routing, producer values, configured delay in milliseconds, delay-before-live-context/environment collection, action execution, missing listener behavior, reload cleanup, and no duplicate listener after reload.
7. **Documentation and migration**
   - Update README examples, security model, protocol semantics, breaking migration, and limitations.

### Bare hook osc decision

Bare `osc` remains valid for lifecycle bindings (built-in default copy). Hook bindings reject bare `osc` with a bounded config diagnostic; use `osc:<title>|<body>` or `notification.osc` in `js:`. This matches the packaged skill pitfall and avoids inventing semantic-specific defaults.

## Required verification

- Focused and full Node tests.
- Typecheck.
- Clean install.
- Packed isolated Pi load.
- Packed real-Pi producer/consumer E2E with finite timeouts.
- Independent functional review of the exact staged artifact.
- Independent documentation review.
