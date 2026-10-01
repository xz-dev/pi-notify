## 1. Generic Compatibility Evidence

- [x] 1.1 Inspect `src/config.ts`, `src/context.ts`, `src/actions.ts`, and the semantic-hook scheduler/lookup path; verify valid kebab-case names are generic, bindings use own-property lookup, and no watchdog-specific branch is required.
- [x] 1.2 Verify planned non-reserved values reach frozen `notification.values` and `PI_NOTIFY_*`, planned keys are string-template compatible, reserved keys remain consumer-owned, and bare hook `osc` remains rejected.
- [x] 1.3 Verify fixed `js:` actions can guard required values before `notification.osc`; synthetic missing-field behavior must produce neither OSC nor external-helper invocation.

## 2. Repo-Local Quality Gate

- [x] 2.1 Run `node --import tsx --test test/neutral-hooks.red.test.ts test/extension.test.ts`, `npm run test:e2e:packed-hooks`, `npm test`, `npm run typecheck`, `git diff --check`, and `openspec validate add-watchdog-notification-hooks --type change --strict --no-interactive`; verify all pass.
- [x] 2.2 Verify `git diff -- src test package.json package-lock.json` is empty and no private config, endpoint, topic, key, or generated report entered the repository.
- [x] 2.3 Record the no-code compatibility conclusion and exact handoff locator `/home/xz/openspec/changes/deploy-watchdog-notifications-locally`; do not install extensions or edit protected/Dotdrop files from this repo-local apply.

## 3. Stop Condition

- [x] 3.1 If any required generic capability is disproved, leave this change in progress, preserve the focused reproduction, and ask for a separate pi-notify product-change decision before modifying source.
