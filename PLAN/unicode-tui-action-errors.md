# Multilingual ntfy delivery and TUI action failures

## Story

Actor: a Pi user configuring lifecycle-event and semantic-hook notification actions.

Need: multilingual titles and bodies must reach notification backends intact; if any configured action cannot execute, Pi must visibly report the failure in the active TUI.

Value: notification failures must not remain silent, especially when the failed notification was supposed to call the user back to Pi.

## Agreed behavior

1. The bundled ntfy companion accepts Unicode titles and bodies (including emoji, CJK, and non-ASCII host/cwd text) without passing non-ByteString text directly as Node `fetch` headers. ntfy receives the original Unicode text.
2. Every configured action under both `events` and `hooks` reports an execution failure through `ctx.ui.notify(message, "error")` when the originating extension context has a UI.
3. The same failure remains available on stderr. A failed action does not prevent later actions from running.
4. TUI errors are transient UI notifications only. pi-notify does not append a session entry and does not send a model-visible message.
5. No success toast is emitted. Stale callbacks after shutdown/reload remain silent.
6. Keep the existing explicit action contract: `cmd:` uses the host default shell, shell tuples use direct argv, `js:` is awaited, and actions remain non-blocking with respect to Pi.

## Concrete examples

### Unicode ntfy title

Given the example ntfy helper receives a title containing `🤖 发布完成` and a cwd containing `项目`,
when the helper publishes the notification,
then the HTTP request is accepted by Node `fetch` and ntfy decodes the original Unicode title and UTF-8 body.

### Semantic-hook action failure

Given `hooks.agent-notify.actions` contains a failing `js:` action followed by a working action,
when `agent_notify` publishes the hook,
then the tool still returns `Notification hook published`, the TUI receives one error notification identifying `hook:agent-notify` and `js`, stderr records the failure, and the later action runs.

### Lifecycle action failure

Given `events.agent_settled.actions` contains a failing `osc` or process action followed by a working action,
when the event runs,
then the TUI receives an error notification identifying `event:agent_settled` and the action type, stderr records the failure, and the later action runs.

### Headless and stale context

Given no UI is available, failures still go to stderr and no history entry is created. Given the extension generation has been cleaned up, a late asynchronous failure produces neither a TUI notification nor a retry.

## Implementation slices

- [ ] Slice 1 (`fix/multilingual-ntfy`): add a RED helper acceptance test, encode ntfy request metadata using ntfy's documented Unicode-safe request shape, make it GREEN, review, commit, merge.
- [ ] Slice 2 (`feat/tui-action-errors`): add RED event/hook TUI examples; add one failure-reporting seam shared by synchronous, awaited, and child-process callback failures; preserve continuation/stale semantics; review, commit, merge.
- [ ] Verification: full tests, typecheck, exact-index package/install/load smoke, live isolated Pi acceptance, independent final review.
- [ ] Protected local migration: back up `/home/xz/.pi/agent/pi-notify-ntfy.mjs`, update through the maintained example after source verification, preserve mode/owner/topic bytes, and run a real ntfy delivery probe.

## Source basis

- ntfy publish documentation permits UTF-8 via JSON publishing and recommends RFC 2047 when clients cannot emit Unicode HTTP headers: https://docs.ntfy.sh/publish/
- Pi 0.83.0 exposes transient `ctx.ui.notify(message, "error")`; it does not create a session entry or model-context message.
