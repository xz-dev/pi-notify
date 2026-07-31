# Configurable notification extension

## Accepted behavior

- [x] Use public `agent_settled` as the agent-idle hook.
- [x] Use `tool_execution_start:ask_user_question` as the filtered ask-user hook.
- [x] Load global `PI_CODING_AGENT_DIR/pi-notify.json` (default `~/.pi/agent/pi-notify.json`).
- [x] For trusted projects, load `<cwd>/.pi/pi-notify.json`; valid project keys replace matching global keys.
- [x] Support ordered action arrays containing `default` and non-empty `cmd:<shell command>` values.
- [x] Treat `default` and `cmd:` actions as fire-and-forget; failures never block Pi or later actions.
- [x] Expose the accepted fixed `PI_NOTIFY_*` command environment and never expose tool arguments.
- [x] Omit `PI_NOTIFY_PROJECT` until Pi has a public project-name API.

## Implementation

- [ ] Add package metadata, TypeScript source, and focused Node tests.
- [ ] Prove the acceptance test fails before production implementation.
- [ ] Implement config loading, event routing, terminal protocols, and command launch.
- [ ] Run typecheck and tests; commit the functional slice.
- [ ] Obtain independent reviewer approval and address findings.
- [ ] Merge the functional branch.

## Release documentation

- [ ] Add README, example configuration, environment reference, and MIT license in a documentation-only commit.
- [ ] Verify the final package from a clean install.
- [ ] Create and push public `xz-dev/pi-notify` GitHub repository.
