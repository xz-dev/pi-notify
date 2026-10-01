## Why

The public `example/` recipes describe an older subset of the accepted notification integration: they cover Continue partially, omit Reflect and timed-wait hooks, and provide only one combined ntfy helper. Users cannot discover each integration independently or compose ntfy and Bark delivery from reusable, credential-free examples. The current producer contracts and validated local presentation are stable, so this is the right time to refresh the examples without changing pi-notify core behavior.

## What Changes

- Refresh `example/pi-continue-watchdog.md` to document the current Continue hooks (`watchdog-continued`, `watchdog-waiting`, and `user-ready`), fields, presentation, silent states, and verification procedure.
- Add `example/pi-reflect-watchdog.md` as a standalone integration guide for `reflection-completed`, including `NO_ISSUE` and `ROUTE_CORRECTION` behavior, clipping boundaries, and route-correction independence.
- Add separate `example/pi-notify-ntfy.md` and `example/pi-notify-bark.md` guides so users can install, configure, test, and combine either backend independently.
- Extend the public ntfy helper to cover the current reusable notification modes and add a separate Bark helper using its JSON push contract; keep endpoint and credential values as explicit placeholders or user-owned environment/configuration, never repository secrets.
- Update `agent-notify` and `ask_user_question` guides to reference the split helpers and show optional single-backend or dual-backend composition.
- Refresh the root README example index and the packaged adaptation skill's current watchdog examples and links.
- Add local loopback HTTP tests for ntfy and Bark request shape, current modes, Unicode/body handling, validation, provider response failures, and independent helper operation.
- Make no pi-notify product-source, dependency, producer-repository, live-configuration, Dotdrop, or real-network changes.

## Capabilities

### New Capabilities

- `notification-integration-examples`: Provides current, credential-free, per-integration Markdown recipes and independently runnable ntfy/Bark helper examples for pi-notify lifecycle and semantic-hook notifications.

### Modified Capabilities

None.

## Impact

- Affects public documentation and example assets under `example/`, README navigation, the packaged `adapt-pi-notify-skill`, and helper-focused tests.
- Adds no runtime dependency or core API change; examples consume the existing `PI_NOTIFY_*` environment contract and `notification` action surfaces.
- Public helper files remain safe-to-copy templates: private endpoint hosts, ntfy topics, Bark device keys, and authorization data are never committed.
- Existing example paths remain valid; the new Reflect and backend-specific guides add discoverability without replacing the established integration URLs.
