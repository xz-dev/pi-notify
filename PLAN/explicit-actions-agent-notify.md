# Explicit actions and AI notification tool

Status: Implemented and independently approved

## Story

- Actor: pi-notify users and the active Pi AI agent.
- Need: users can choose an interpreter explicitly, run trusted in-process JavaScript against Pi's public extension APIs, and optionally let the AI send a titled notification.
- Value: notifications can use platform-specific interpreters or Pi-native behavior without hardcoded plugin backends.

## Scope

- Preserve the published `cmd:<command>` host-default-shell shorthand.
- Add flat tuple actions `["shell:<interpreter>", "arg1", ...]`.
  - The earlier unshipped string form is invalid.
  - The plugin adds no `-c`, `/c`, or `-Command` arguments and performs no argument parsing or concatenation.
  - It directly spawns the interpreter with `shell: false`, preserving every argument boundary exactly.
  - Only bare `powershell.exe` resolves from `PATH`, then `SystemRoot`/`WINDIR`, then `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`; explicit paths remain exact.
- Reuse that PowerShell resolver for Windows Terminal toast; if the toast cannot launch, attempt terminal OSC fallback exactly once.
- Add awaited `js:<code>` actions with `pi`, event-time `ctx`, full raw `event`, and `notification` in scope.
- Add optional model tool `agent_notify({ title, content })` controlled by non-empty valid actions at `pi_notify:agent_notify`.
- Add `TITLE` and `CONTENT` to templates and command environment when available.
- Preserve global + trusted-project replacement precedence.

## Acceptance examples

1. Existing `cmd:` actions keep their host-default-shell behavior.
2. `["shell:/bin/bash", "-lc", "echo ok"]` directly launches `/bin/bash` with exact argv and `shell: false`, without plugin-added flags; later actions are still attempted.
3. WSL `powershell.exe` uses PATH, then `SystemRoot`/`WINDIR`, then the canonical `/mnt/c/.../powershell.exe`; Windows Terminal toast shares the resolver and falls back to OSC when launch fails.
4. `js:` is awaited and receives `pi`, `ctx`, the complete event, and notification context; a thrown error does not prevent later actions.
5. Missing, empty, or wholly invalid `pi_notify:agent_notify` actions do not expose `agent_notify` to the model.
6. A non-empty valid hook exposes `agent_notify`; title and content are required and become `{{TITLE}}`, `{{CONTENT}}`, `PI_NOTIFY_TITLE`, `PI_NOTIFY_CONTENT`, and notification fields for JavaScript.
7. `agent_notify` attempts every action. If an awaited JS action, synchronous process startup, or synchronous OSC delivery fails, it reports one aggregated Pi tool error; background command exit status and later asynchronous child errors remain intentionally unobserved by the tool result.
8. Synchronous OSC failure enters the same tool-error aggregate; lifecycle hooks catch and warn. Windows Terminal fallback is gated so unavailable, synchronous, and asynchronous launch failures emit OSC at most once.
9. A trusted project hook replaces the global hook; an untrusted project cannot contribute it.

## Verification seam

Use the existing Node `node:test` extension/config/launcher public seams with injected spawn/write/runtime doubles. Do not invoke real external notification programs.
