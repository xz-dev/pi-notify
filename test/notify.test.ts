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
    values: {},
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

function decodeKittyPayload(sequence: string): { metadata: string; text: string } {
  // Plain: ESC ] 99 ; metadata ; payload ESC \
  // tmux: ESC P tmux ; ESC ESC ] 99 ; metadata ; payload ESC ESC \ ESC \
  const match = sequence.match(/(?:\x1b\x1b|\x1b)\]99;([^;]*);([A-Za-z0-9+/=]+)/);
  assert.ok(match, `expected Kitty OSC 99 sequence, got: ${JSON.stringify(sequence)}`);
  return {
    metadata: match[1] ?? "",
    text: Buffer.from(match[2] ?? "", "base64").toString("utf8"),
  };
}

test("Kitty OSC 99 uses e=1 base64 payloads and preserves multiline title/body", () => {
  const writes: string[] = [];
  const launch = createOscLauncher({
    environment: { KITTY_WINDOW_ID: "1" },
    write: (value) => writes.push(value),
    spawnWindowsToast: () => {
      throw new Error("unexpected Windows toast");
    },
    warn: () => undefined,
  });

  const title = "Pi Done";
  const body = "Waiting for review\nsession id: abc-123";
  launch(title, body);

  assert.equal(writes.length, 2);
  assert.match(writes[0] ?? "", /^\x1b\]99;i=pi-notify:d=0:e=1;[A-Za-z0-9+/=]+\x1b\\$/);
  assert.match(writes[1] ?? "", /^\x1b\]99;i=pi-notify:p=body:e=1;[A-Za-z0-9+/=]+\x1b\\$/);
  // No raw multiline payload on the wire
  assert.equal((writes[0] ?? "").includes("\n"), false);
  assert.equal((writes[1] ?? "").includes("\n"), false);

  const decodedTitle = decodeKittyPayload(writes[0] ?? "");
  const decodedBody = decodeKittyPayload(writes[1] ?? "");
  assert.equal(decodedTitle.metadata, "i=pi-notify:d=0:e=1");
  assert.equal(decodedBody.metadata, "i=pi-notify:p=body:e=1");
  assert.equal(decodedTitle.text, title);
  assert.equal(decodedBody.text, body);
});

test("Kitty OSC 99 wraps base64 sequences for tmux", () => {
  const writes: string[] = [];
  const launch = createOscLauncher({
    environment: { KITTY_WINDOW_ID: "1", TMUX: "/tmp/tmux" },
    write: (value) => writes.push(value),
    spawnWindowsToast: () => {
      throw new Error("unexpected Windows toast");
    },
    warn: () => undefined,
  });

  launch("Pi", "Ready\nsession id: s1");

  assert.equal(writes.length, 2);
  // Complete tmux DCS envelope: ESC P tmux ; <ESC-doubled OSC> ESC \
  // Inner ST is doubled (ESC ESC \) and the outer DCS still ends with ESC \.
  assert.match(
    writes[0] ?? "",
    /^\x1bPtmux;\x1b\x1b\]99;i=pi-notify:d=0:e=1;[A-Za-z0-9+/=]+\x1b\x1b\\\x1b\\$/,
  );
  assert.match(
    writes[1] ?? "",
    /^\x1bPtmux;\x1b\x1b\]99;i=pi-notify:p=body:e=1;[A-Za-z0-9+/=]+\x1b\x1b\\\x1b\\$/,
  );

  const decodedTitle = decodeKittyPayload(writes[0] ?? "");
  const decodedBody = decodeKittyPayload(writes[1] ?? "");
  assert.equal(decodedTitle.text, "Pi");
  assert.equal(decodedBody.text, "Ready\nsession id: s1");
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

test("iTerm2 and OSC777 retain LF, strip dangerous controls, and map semicolon to comma", () => {
  const itermWrites: string[] = [];
  const osc777Writes: string[] = [];
  // Hostile inputs: ST (ESC \), C1 ST (U+009C), BEL, NUL, tab, and ';' in BOTH title and body.
  const hostileTitle = "Title;part\x1b\\\u009c\x07\x00\tA";
  const hostileBody = "line1\nline2;part\x1b\\\u009c\x07\x00\tsession id: s1";
  // Controls strip; ESC ST leaves a literal backslash; ';' becomes ',' for delimiter protocols.
  const safeTitle = "Title,part\\A";
  const safeBody = "line1\nline2,part\\session id: s1";

  createOscLauncher({
    environment: { TERM_PROGRAM: "iTerm.app" },
    write: (value) => itermWrites.push(value),
    spawnWindowsToast: () => {
      throw new Error("unexpected Windows toast");
    },
    warn: () => undefined,
  })(hostileTitle, hostileBody);

  createOscLauncher({
    environment: { TERM: "xterm-256color" },
    write: (value) => osc777Writes.push(value),
    spawnWindowsToast: () => {
      throw new Error("unexpected Windows toast");
    },
    warn: () => undefined,
  })(hostileTitle, hostileBody);

  assert.deepEqual(itermWrites, [`\x1b]9;${safeTitle}: ${safeBody}\x07`]);
  assert.deepEqual(osc777Writes, [`\x1b]777;notify;${safeTitle};${safeBody}\x07`]);
  assert.equal((itermWrites[0] ?? "").includes("\u009c"), false);
  assert.equal((osc777Writes[0] ?? "").includes("\u009c"), false);
  assert.equal((itermWrites[0] ?? "").includes(";part"), false);
  assert.equal((osc777Writes[0] ?? "").includes(";part"), false);
});

test("Kitty decoded payload strips ST/C1/BEL/NUL/tab while preserving LF and semicolon text", () => {
  const writes: string[] = [];
  const launch = createOscLauncher({
    environment: { KITTY_WINDOW_ID: "1" },
    write: (value) => writes.push(value),
    spawnWindowsToast: () => {
      throw new Error("unexpected Windows toast");
    },
    warn: () => undefined,
  });

  const hostileTitle = "Title;part\x1b\\\u009c\x07\x00\tA";
  const hostileBody = "line1\nline2;part\x1b\\\u009c\x07\x00\tsession id: s1";
  launch(hostileTitle, hostileBody);

  const decodedTitle = decodeKittyPayload(writes[0] ?? "");
  const decodedBody = decodeKittyPayload(writes[1] ?? "");
  // Kitty base64 path keeps ';' (not a field delimiter in payload); controls are stripped.
  assert.equal(decodedTitle.text, "Title;part\\A");
  assert.equal(decodedBody.text, "line1\nline2;part\\session id: s1");
  assert.equal(decodedTitle.text.includes("\u009c"), false);
  assert.equal(decodedBody.text.includes("\u009c"), false);
  assert.equal(decodedTitle.text.includes("\x1b"), false);
  assert.equal(decodedBody.text.includes("\x07"), false);
  assert.equal(decodedBody.text.includes("\x00"), false);
  assert.equal(decodedBody.text.includes("\t"), false);
});

test("Windows Terminal toast receives real LF after CR normalization", () => {
  const toasts: Array<{ title: string; body: string }> = [];
  const launch = createOscLauncher({
    environment: { WT_SESSION: "1" },
    write: () => {
      throw new Error("unexpected OSC write");
    },
    spawnWindowsToast: (title, body) => toasts.push({ title, body }),
    warn: () => undefined,
  });

  launch("Pi\r\nDone", "Ready\rfor\nreview\rsession id: s1");

  assert.deepEqual(toasts, [{ title: "Pi\nDone", body: "Ready\nfor\nreview\nsession id: s1" }]);
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

test("CRLF and lone CR normalize to LF for Kitty decoded body", () => {
  const writes: string[] = [];
  const launch = createOscLauncher({
    environment: { KITTY_WINDOW_ID: "1" },
    write: (value) => writes.push(value),
    spawnWindowsToast: () => {
      throw new Error("unexpected Windows toast");
    },
    warn: () => undefined,
  });

  launch("T", "a\r\nb\rc");
  assert.equal(decodeKittyPayload(writes[1] ?? "").text, "a\nb\nc");
});
