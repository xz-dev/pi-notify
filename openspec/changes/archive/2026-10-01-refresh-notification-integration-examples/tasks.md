## 1. Public backend helpers

- [x] 1.1 Refresh `example/pi-notify-ntfy.mjs` as a self-contained, single-backend adapter supporting `question`, `agent`, `continue`, `wait`, `reflect`, and `user-ready`; verify syntax, missing-field silence, finite timeout, multiline/Unicode bodies, and no private values.
- [x] 1.2 Add `example/pi-notify-bark.mjs` with the same documented mode/context contract and Bark JSON push behavior; verify syntax, required `BARK_URL`/`BARK_DEVICE_KEY` handling, HTTP/provider response failures, and no private values.
- [x] 1.3 Add or update helper installation/configuration snippets showing owner-only permissions, replaceable placeholders, and separate `cmd:` actions for ntfy-only, Bark-only, and dual-backend composition; verify every snippet uses portable `$HOME` paths and contains no real endpoint or credential.

## 2. Integration documentation

- [x] 2.1 Refresh `example/pi-continue-watchdog.md` with current neutral-channel bindings for `watchdog-continued`, `watchdog-waiting`, and `user-ready`; verify exact `REASON_TYPE`/`REASON`, decimal `WAIT_SECONDS` without `REASON_TYPE`, terminal-kind mappings, silent states, and links to both backend guides.
- [x] 2.2 Add `example/pi-reflect-watchdog.md` as an independent Reflect guide; verify `reflection-completed`, `REFLECTION_TYPE` values `NO_ISSUE`/`ROUTE_CORRECTION`, `REASON`, `NEXT_STEP`, clipping/durability boundary, and no dependency on Continue.
- [x] 2.3 Refresh `example/agent-notify.md` and `example/rpiv-ask-user-question.md` to reference split backend helpers and optional composition; verify existing paths and current `PI_NOTIFY_*` inputs remain documented.
- [x] 2.4 Add `example/pi-notify-ntfy.md` and `example/pi-notify-bark.md` with standalone setup, endpoint/request contracts, modes, local loopback verification, failure handling, and secret-safety guidance; verify links and placeholder-only content.

## 3. Tests and navigation

- [x] 3.1 Extend `test/ntfy-helper.test.ts` for `wait`, `reflect`, current `user-ready` presentation, validation silence, multiline/Unicode payloads, and backend failure behavior; verify all requests target loopback fixtures.
- [x] 3.2 Add Bark helper tests for JSON field shape, `group`, device-key handling, all supported presentation modes, invalid input silence, HTTP failures, provider response-code failures, and loopback-only operation; verify no external network calls.
- [x] 3.3 Update `README.md` Examples navigation and `skills/adapt-pi-notify-skill/SKILL.md` with current integration/backend links and hook fields; extend `test/skill.test.ts` to assert required files, links, and exact contract tokens.

## 4. Validation and review

- [x] 4.1 Run syntax/config/link/secret scans over public examples and confirm no private URL, topic, device key, authorization data, production payload, or live-file change is present.
- [x] 4.2 Run focused helper and skill tests, full test suite, and typecheck with real backend access disabled; verify all pass without modifying producer repositories, dependencies, Dotdrop files, live configuration, or retained deployment evidence.
- [x] 4.3 Validate `refresh-notification-integration-examples` with `openspec validate --strict` and review final diff for scope, portability, backwards-compatible paths, and documentation-to-contract consistency.
