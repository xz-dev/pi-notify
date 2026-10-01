# watchdog-notification-hooks Specification

## Purpose
Verify that pi-notify's existing generic semantic-hook consumer can safely support the planned watchdog notification configuration without product-specific code.

## Requirements

### Requirement: Watchdog hook names use generic binding lookup
pi-notify SHALL accept configured `watchdog-waiting` and `reflection-completed` bindings through the same valid lowercase kebab-case lookup used by every semantic hook. Core SHALL NOT whitelist, import, identify, or wait for either watchdog producer.

#### Scenario: Configured watchdog hook arrives
- **WHEN** a valid version-1 envelope names a configured watchdog hook
- **THEN** pi-notify resolves the whole matching binding and runs its actions through the normal hook path

#### Scenario: Watchdog hook is not configured
- **WHEN** the same valid envelope has no matching binding
- **THEN** pi-notify remains silent without changing producer behavior

### Requirement: Valid producer values reach the appropriate action surfaces
Non-reserved validated values SHALL be exposed as frozen `notification.values` to trusted JavaScript and as `PI_NOTIFY_*` variables to structured command actions. Keys compatible with `[A-Z_]+` SHALL additionally be available to string templates. Producer values SHALL NOT override consumer-owned system keys.

#### Scenario: Planned values arrive
- **WHEN** a watchdog envelope carries `REASON_TYPE`, `REASON`, `WAIT_SECONDS`, `REFLECTION_TYPE`, or `NEXT_STEP`
- **THEN** trusted JavaScript and structured command actions receive those non-reserved string values

#### Scenario: Producer supplies a reserved key
- **WHEN** an envelope carries a valid key reserved for consumer context
- **THEN** the execution-time consumer-owned value remains authoritative

### Requirement: Conditional presentation remains explicit trusted configuration
A hook binding that needs value-dependent OSC text SHALL use a non-empty trusted `js:` action and `notification.osc(title, body)`. Bare `osc` SHALL remain invalid for hook bindings. The JavaScript SHALL guard all required values before terminal side effects; missing values SHALL not produce malformed OSC or invoke an external helper.

#### Scenario: Required values are present
- **WHEN** fixed trusted binding code receives every field required for one presentation
- **THEN** it may select fixed presentation copy and pass producer text only as display data

#### Scenario: Required value is absent
- **WHEN** fixed trusted binding code lacks a required producer field
- **THEN** it performs no OSC or helper delivery for that presentation and does not coerce `undefined` into output

### Requirement: Protected deployment has separate operational ownership
Repo-local apply SHALL stop after compatibility verification and handoff. Extension installation, `~/.pi/agent` changes, Dotdrop changes, real private-backend smokes, permission checks, and rollback SHALL be owned by root-level change `deploy-watchdog-notifications-locally` and require their own explicit operational authorization.

#### Scenario: Compatibility verification passes
- **WHEN** existing generic unit and packed public-seam tests pass without a product-source diff
- **THEN** this change records a no-code compatibility result and points to the root operations change

#### Scenario: Verification exposes a core gap
- **WHEN** a required generic behavior fails under a focused reproducible test
- **THEN** implementation stops for a separately reviewed pi-notify product-change decision rather than silently expanding this change
