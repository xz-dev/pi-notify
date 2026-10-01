## Why

`bel`, `osc:`, and `cmd:` actions run unconditionally, so filtering a binding by producer values (for example, staying silent for a watchdog `WAIT_CALLBACK` stop) forces every action into `js:` code. Users lose the declarative shortcuts exactly when they need a simple filter.

## What Changes

- Add an optional binding-level `if`: a trusted JavaScript expression evaluated once per received event or hook, after `delayMs` and before the first action, with the same `pi`, `ctx`, `event`, `notification` scope as `js:` (async allowed).
- A falsy result skips every action of that binding. A throw warns and skips. A non-string or blank `if` invalidates the binding, and the lower-precedence binding stays in effect.
- Bindings without `if` behave exactly as before.

Non-goals: per-action conditions, a declarative condition language, `else` branches.

## Capabilities

### New Capabilities
- `binding-condition`: the optional `if` expression on event and hook bindings.

### Modified Capabilities
<!-- None. -->

## Impact

- `src/types.ts`, `src/config.ts` (parse/validate), `src/actions.ts` (evaluate before actions), `index.ts` (pass through, injectable evaluator).
- `README.md` binding docs.
- Like `js:`, `if` is executable code from global or trusted-project config. It adds no new trust surface.
