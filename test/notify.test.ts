import assert from "node:assert/strict";
import test from "node:test";

import { createNotificationEnvironment, renderTemplate } from "../src/context.js";
import { createOscLauncher } from "../src/osc.js";
import { createCommandLauncher } from "../src/command.js";

test("templates use command-context names and preserve unavailable placeholders", () => {
  const values = {
    EVENT: "agent_settled",
    CWD: "/work/app",
    SESSION_ID: "session-1",
  };

  assert.equal(renderTemplate("{{EVENT}} in {{CWD}} for {{TOOL}}", values), "agent_settled in /work/app for {{TOOL}}");
});

test("command launcher overlays fixed event context without leaking tool arguments", () => {
  const calls: Array<{ command: string; options: unknown }> = [];
  const launch = createCommandLauncher({
    inheritedEnvironment: {
      PATH: "/bin",
      PI_NOTIFY_TOOL: "stale",
      PI_NOTIFY_ARGS: "stale-secret",
      pi_notify_custom: "stale-custom",
    },
    spawn: (command, options) => {
      calls.push({ command, options });
      return { once: () => undefined, unref: () => undefined };
    },
    warn: () => undefined,
  });

  const env = createNotificationEnvironment({
    event: "tool_execution_start:ask_user_question",
    cwd: "/work/app",
    sessionId: "session-1",
    sessionFile: "/sessions/one.jsonl",
    tool: "ask_user_question",
    toolCallId: "call-1",
  });
  launch("notify --event \"$PI_NOTIFY_EVENT\"", "/work/app", env);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "notify --event \"$PI_NOTIFY_EVENT\"");
  assert.deepEqual(calls[0]?.options, {
    cwd: "/work/app",
    env: {
      PATH: "/bin",
      PI_NOTIFY_CWD: "/work/app",
      PI_NOTIFY_EVENT: "tool_execution_start:ask_user_question",
      PI_NOTIFY_SESSION_FILE: "/sessions/one.jsonl",
      PI_NOTIFY_SESSION_ID: "session-1",
      PI_NOTIFY_TOOL: "ask_user_question",
      PI_NOTIFY_TOOL_CALL_ID: "call-1",
    },
    shell: true,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
});

test("osc launcher chooses protocol and wraps escape sequences for tmux", () => {
  const writes: string[] = [];
  const launch = createOscLauncher({
    environment: { KITTY_WINDOW_ID: "1", TMUX: "/tmp/tmux" },
    write: (value) => writes.push(value),
    spawnWindowsToast: () => {
      throw new Error("unexpected Windows toast");
    },
    warn: () => undefined,
  });

  launch("Pi", "Ready");

  assert.equal(writes.length, 2);
  assert.match(writes[0] ?? "", /^\x1bPtmux;/);
  assert.match(writes[0] ?? "", /\x1b\x1b\]99;/);
});

test("iTerm2 includes both the title and body", () => {
  const writes: string[] = [];
  const launch = createOscLauncher({
    environment: { TERM_PROGRAM: "iTerm.app" },
    write: (value) => writes.push(value),
    spawnWindowsToast: () => {
      throw new Error("unexpected Windows toast");
    },
    warn: () => undefined,
  });

  launch("Custom title", "Custom body");

  assert.deepEqual(writes, ["\x1b]9;Custom title: Custom body\x07"]);
});

test("Windows Terminal uses a fire-and-forget toast process", () => {
  const toasts: Array<{ title: string; body: string }> = [];
  const launch = createOscLauncher({
    environment: { WT_SESSION: "1" },
    write: () => {
      throw new Error("unexpected OSC write");
    },
    spawnWindowsToast: (title, body) => toasts.push({ title, body }),
    warn: () => undefined,
  });

  launch("Pi", "Ready");

  assert.deepEqual(toasts, [{ title: "Pi", body: "Ready" }]);
});
