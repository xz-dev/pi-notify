## 1. Implementation

- [x] 1.1 Parse and validate `if` in `src/config.ts` and carry it on `NotificationBinding`. Verify with the test "invalid binding if rejects the binding and keeps the lower-precedence one".
- [x] 1.2 Evaluate `if` in `runActions` before any action, with an injectable `evaluateCondition` and a `new Function` default. Verify with the test "binding if gates every action, including bel and cmd shortcuts"; it fails when the gate is removed.
- [x] 1.3 Document `if` in `README.md` (shared rules, the binding-condition section, the delay flow).

## 2. Verification

- [x] 2.1 `npm test` and `tsc --noEmit` pass.
