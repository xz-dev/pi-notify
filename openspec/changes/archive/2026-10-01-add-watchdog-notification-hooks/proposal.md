## Why

The new watchdog producer hooks need a notification consumer, but pi-notify is intentionally generic. Before protected local deployment, this repository must verify that its existing public configuration and action seams already support the new names and values without adding watchdog-specific product logic.

## What Changes

- Codify that valid kebab-case hook names such as `watchdog-waiting` and `reflection-completed` use the existing generic hook-binding path.
- Verify the exact value surfaces available to JavaScript, structured command environments, and OSC templates, including reserved-key protection and missing-value behavior.
- Confirm conditional `js:` actions can guard required values and call the shared OSC backend without adding templates or hook-name awareness to core.
- Record an explicit handoff to root-level OpenSpec change `deploy-watchdog-notifications-locally` for extension installation, protected config/helper edits, Dotdrop synchronization, live smoke tests, and rollback.
- Make no pi-notify product-source change unless verification disproves an established generic capability.

## Capabilities

### New Capabilities
- `watchdog-notification-hooks`: Records and verifies pi-notify's generic compatibility contract for watchdog hook names and notification-relevant values.

### Modified Capabilities

None.

## Impact

- Applies only to repo-local compatibility inspection, existing tests, and OpenSpec artifacts under `/home/xz/Code/ai/pi-notify`.
- Does not own or modify `~/.pi/agent`, Dotdrop, producer repositories, extension installation, or private notification endpoints.
- Depends on no product-code change because current pi-notify already accepts arbitrary valid hook names; any contrary test evidence must stop the no-op plan for review rather than trigger an unplanned patch.
