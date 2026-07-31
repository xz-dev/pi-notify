import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import registerExtension, { type NotificationRuntime } from "../index.js";

test("routes settled and ask-user events while ignoring other tools", async () => {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "pi-notify-extension-")));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      agent_settled: ["osc:Pi|{{EVENT}} at {{CWD}}", "cmd:idle-command"],
      "tool_execution_start:ask_user_question": ["osc:Pi|{{TOOL}} needs input", "cmd:question-command"],
    }),
  );

  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const launches: Array<{ type: string; value: string; env?: Record<string, string> }> = [];
  const runtime: NotificationRuntime = {
    agentDir,
    launchOsc: (title, body) => launches.push({ type: "osc", value: `${title}|${body}` }),
    launchCommand: (command, _cwd, env) => launches.push({ type: "cmd", value: command, env }),
    warn: () => undefined,
  };
  const pi = {
    on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
  } as any;
  registerExtension(pi, runtime);
  const ctx = {
    cwd,
    isProjectTrusted: () => true,
    sessionManager: {
      getSessionId: () => "session-1",
      getSessionFile: () => undefined,
    },
  };

  await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
  await handlers.get("tool_execution_start")?.(
    { type: "tool_execution_start", toolName: "bash", toolCallId: "call-0", args: { secret: "never expose" } },
    ctx,
  );
  await handlers.get("tool_execution_start")?.(
    {
      type: "tool_execution_start",
      toolName: "ask_user_question",
      toolCallId: "call-1",
      args: { questions: [{ question: "private" }] },
    },
    ctx,
  );

  assert.deepEqual(
    launches.map(({ type, value }) => ({ type, value })),
    [
      { type: "osc", value: `Pi|agent_settled at ${cwd}` },
      { type: "cmd", value: "idle-command" },
      { type: "osc", value: "Pi|ask_user_question needs input" },
      { type: "cmd", value: "question-command" },
    ],
  );
  assert.equal(launches[3]?.env?.PI_NOTIFY_TOOL, "ask_user_question");
  assert.equal(Object.values(launches[3]?.env ?? {}).some((value) => value.includes("private")), false);
});
