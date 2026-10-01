## Context

See `proposal.md` for motivation and `specs/watchdog-notification-hooks/spec.md` for the compatibility contract.

Current source already parses every valid kebab-case hook binding without a name whitelist, resolves matching bindings by own-property lookup, and runs their actions through the common scheduler. It exposes non-reserved producer strings to trusted JavaScript and structured command environments; only template-compatible `[A-Z_]+` keys are interpolated into string actions. Hook bindings reject bare `osc`, while trusted `js:` receives frozen values and the shared `notification.osc`/`notification.bel` backends.

Actual producer behavior is specified in separate project-local changes:

- `/home/xz/Code/ai/pi-continue-watchdog/openspec/changes/publish-watchdog-waiting-hook`
- `/home/xz/Code/ai/pi-reflect-watchdog/openspec/changes/publish-reflection-completed-hook`

Protected deployment is specified in root-level change:

- `/home/xz/openspec/changes/deploy-watchdog-notifications-locally`

## Goals / Non-Goals

**Goals:**
- Prove the planned hook names and values fit existing generic product seams.
- State exact JavaScript/environment/template availability and required-value guards.
- Preserve a zero product-source diff when current behavior satisfies the contract.
- Hand operational ownership to the root-level change.

**Non-Goals:**
- Adding watchdog-specific names, templates, conditionals, or dependencies to pi-notify core.
- Reading or modifying private config, helper, endpoint, topic, or device values.
- Installing producers, synchronizing Dotdrop, sending real notifications, or claiming operational acceptance.

## Decisions

### 1. Treat this as a no-code compatibility change

Do not add name-specific tests or production branches that merely restate current generic behavior. Verify the contract with existing config, action, extension, and packed-neutral-hook tests plus bounded source inspection. A product diff is evidence that the no-code premise failed and requires a new decision.

### 2. Describe value surfaces precisely

The shared semantic protocol accepts validated uppercase keys, including digits. pi-notify passes non-reserved keys to `notification.values` and rebuilt `PI_NOTIFY_*` environment variables. String-template interpolation is narrower and matches `[A-Z_]+`. All planned keys fit both forms, but the plan records the distinction rather than claiming every valid key is template-compatible.

### 3. Keep conditional copy in protected trusted JavaScript

The eventual local binding may branch on fixed known type strings, but every branch must guard its required values before calling `notification.osc` or launching the helper. Producer values are display data only. They do not become source code, executable paths, shell text, URLs, or control decisions outside the fixed branch table.

### 4. Separate apply authority from operational authority

This repository's OpenSpec apply root is `/home/xz/Code/ai/pi-notify`. Its tasks therefore end with compatibility evidence and a handoff. The root operations change owns the external installation and protected filesystem work under `/home/xz` and still requires explicit confirmation at each dangerous boundary.

## Risks / Trade-offs

- [A name-specific patch would erode the generic protocol] -> Stop if existing generic tests fail instead of improvising product awareness.
- [Documentation could overstate value availability] -> Distinguish JS/environment keys, template keys, and reserved consumer keys explicitly.
- [Trusted JavaScript can execute arbitrary code] -> Keep code fixed, local, mode-protected, and owned by the root operations change.
- [A no-code change can look vacuous] -> Tie completion to exact source evidence, runnable public-seam tests, and a named operational handoff.

## Migration Plan

1. Inspect the exact config, lookup, context, action, and scheduler seams.
2. Run existing focused generic tests, packed neutral-hook E2E, and typecheck.
3. Verify no product source/test/package diff exists.
4. Record the compatibility result and handoff to `deploy-watchdog-notifications-locally`.

Rollback is unnecessary because this repo-local change introduces no product behavior or protected configuration mutation.
