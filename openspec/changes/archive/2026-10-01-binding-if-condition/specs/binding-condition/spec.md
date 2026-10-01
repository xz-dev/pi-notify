## Purpose

Lets a notification binding skip all of its actions based on the event or producer values, while keeping declarative actions such as `bel`, `osc:`, and `cmd:`.

## ADDED Requirements

### Requirement: Optional binding condition
An event or hook binding SHALL accept an optional `if` string containing a JavaScript expression. pi-notify SHALL evaluate it once per received event or hook, after `delayMs` and the generation check and before the first action, with `pi`, `ctx`, `event`, and `notification` in scope as for `js:` actions; `await` SHALL be allowed. A falsy result SHALL skip every action of that binding. A binding without `if` SHALL behave as before.

#### Scenario: Filter by producer value
- **GIVEN** the `user-ready` hook binding has `"if": "notification.values.REASON_TYPE !== 'WAIT_CALLBACK'"` and actions `["bel", "cmd:..."]`
- **WHEN** a `user-ready` hook arrives with `REASON_TYPE=WAIT_CALLBACK`
- **THEN** neither the BEL nor the command runs
- **AND** a later `user-ready` with `REASON_TYPE=JOB_DONE` runs both

#### Scenario: Async condition
- **WHEN** `if` awaits a promise that resolves truthy
- **THEN** the actions run

### Requirement: Failing or invalid condition
If the expression throws or rejects, pi-notify SHALL warn with the binding key and SHALL skip the actions; the failure SHALL NOT throw into Pi. A present `if` that is not a non-empty string of at most 8192 characters SHALL invalidate that binding with a warning, and the lower-precedence binding SHALL stay in effect.

#### Scenario: Expression throws
- **WHEN** `if` references an undefined variable
- **THEN** a warning names the binding and no action runs

#### Scenario: Invalid project condition
- **GIVEN** the global binding is valid and the trusted project binding sets `"if": 42`
- **WHEN** configuration loads
- **THEN** a warning is reported and the global binding is used
