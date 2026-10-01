## Context

The repository already ships public Markdown recipes and one standalone ntfy helper. Current reviewed producer behavior publishes neutral envelopes on `pi:semantic-hook:v1`; pi-notify supplies `PI_NOTIFY_*` context fields to configured `cmd:` actions. The accepted presentation contract includes Continue, timed wait, reflection completion, and user-ready states, while the private live helper combines two backends and therefore cannot be copied into a public repository. See `proposal.md` for motivation and `specs/notification-integration-examples/spec.md` for observable requirements.

## Goals / Non-Goals

**Goals:**

- Make each producer integration independently understandable and installable.
- Publish two self-contained, replaceable backend adapters: one ntfy and one Bark.
- Keep helper inputs aligned with the existing action environment and current fixed presentation.
- Make one backend, the other backend, or both easy to select through separate actions.
- Keep examples portable, local-testable, and free of private values.
- Preserve existing example paths and avoid changing pi-notify runtime behavior.

**Non-Goals:**

- No changes to pi-notify core source, semantic-hook producers, or producer state machines.
- No shared public helper runtime, new package dependency, transport abstraction, or provider SDK.
- No Bark support in the private live configuration as part of this change.
- No real ntfy/Bark delivery, production configuration, Dotdrop operation, dependency upgrade, commit, or push.
- No per-hook document explosion or replacement of historical deployment artifacts.

## Decisions

### Keep helpers self-contained and separate

Implement `example/pi-notify-ntfy.mjs` and `example/pi-notify-bark.mjs` as independently runnable files. Each parses the same mode/context contract and owns only its backend request. This lets users copy one file without hidden imports and lets pi-notify invoke both through separate `cmd:` actions.

**Alternative considered:** extract a shared example library. Rejected because a second copied file plus an install step creates coupling and packaging ambiguity for a small adapter; duplicated presentation parsing is cheaper than a public runtime dependency.

### Preserve existing semantic presentation, centralize no new policy

Reuse the already documented titles, body mappings, supported modes, field names, clipping assumptions, and finite timeout. Helpers validate their trust-boundary inputs and remain silent when a presentation is incomplete or unsupported; they do not infer producer state or add new hook vocabulary.

**Alternative considered:** expose raw envelope passthrough. Rejected because it leaks producer-internal variation into user recipes and would diverge from the accepted notification contract.

### Use environment variables for backend-specific private values

The ntfy helper will accept `NTFY_URL` as a complete user-owned topic URL, parse its single topic path segment, and post to the URL's host root with `topic` in the JSON body. The Bark helper will accept `BARK_URL` as a configured `/push` endpoint and `BARK_DEVICE_KEY` separately, placing the key in the JSON body. Examples will show placeholders and owner-only installation/configuration. No value from the private live helper or current machine enters source, tests, docs, or reports.

**Alternative considered:** commit a populated JSON config template. Rejected because it encourages accidental credential commits and conflicts with the public/private boundary.

### Keep network tests loopback-only

Extend the existing ntfy test style with local HTTP servers and add equivalent Bark tests. Assertions cover method, path, JSON fields, Unicode and multiline bodies, stdin isolation, mode mappings, invalid input silence, HTTP failures, and Bark response-code failures. A Bark HTTP-success response with malformed JSON, no numeric `code`, or a non-numeric `code` is accepted for compatibility; a numeric code must equal `200`. Tests never resolve or contact production endpoints.

**Alternative considered:** rely only on static documentation checks. Rejected because request-shape and failure semantics are externally observable and inexpensive to test locally.

### Update navigation and skill alongside examples

Treat README links, producer integration guides, backend guides, packaged skill text, and focused tests as one documentation surface. Keep names and links explicit so a user can start from any integration guide or the README and reach the correct helper without private context.

**Alternative considered:** update only the helper files. Rejected because stale recipes would continue directing users to incomplete or combined behavior.

## Risks / Trade-offs

- [Duplicated parsing/presentation code] → Keep files short and behaviorally covered by focused tests; do not introduce a shared abstraction until a separate reuse need exists.
- [Bark deployments differ in endpoint path or response details] → Require a configured `/push` endpoint, test the exact chosen JSON contract, accept HTTP-success responses without a numeric provider code for compatibility, and treat numeric codes other than `200` as failure.
- [Users may copy placeholders unchanged] → Use conspicuous placeholder values, fail closed on missing/invalid credentials, and include owner-only/no-commit instructions.
- [Documentation can drift from producer revisions] → Derive field names and state mappings from current public producer READMEs and existing accepted contracts, then validate links and exact tokens in `test/skill.test.ts`.
- [Two actions can have independent backend failures] → Keep helpers independent; each reports only its own bounded diagnostic and lets pi-notify execute the other configured action.
- [Tests accidentally make external requests] → Bind fixtures to loopback addresses, assert captured requests, and add a static secret/endpoint scan to validation.

## Migration Plan

1. Add the new OpenSpec plan artifacts (this change only).
2. On explicit apply authorization, update existing guides, add Reflect and Bark guides, add the Bark helper, refresh the ntfy helper, README, skill, and focused tests.
3. Run static example/config validation and loopback-only helper tests; then run the repository test and typecheck commands without real backend access.
4. Review the diff for private values, unintended producer/core/dependency changes, broken existing links, and untracked-file contamination.
5. Rollback, if needed, by reverting only the documentation/example/helper/test changes from this change; no live or Dotdrop state is touched.

## Open Questions

None that affect the specified behavior or task breakdown. Exact placeholder spelling and local test-server port selection can be chosen during implementation without changing the contract.
