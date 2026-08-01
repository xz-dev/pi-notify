import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import registerExtension, { type NotificationRuntime } from "../index.js";
import { loadConfig } from "../src/config.js";

async function fixture(): Promise<{ agentDir: string; cwd: string }> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "pi-notify-red-")));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  return { agentDir, cwd };
}

/**
 * Representative acceptance: valid pi_notify:agent_notify hook registers agent_notify once,
 * title/content reach structured shell env + OSC template. Shell is a flat argv tuple.
 */
test("agent_notify registers once with title/content and structured shell argv", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      "pi_notify:agent_notify": [
        "osc:{{TITLE}}|{{CONTENT}}",
        ["shell:/bin/bash", "-lc", "notify \"$PI_NOTIFY_TITLE\""],
        "cmd:legacy-cmd",
      ],
    }),
  );

  const warnings: string[] = [];
  const config = await loadConfig({
    agentDir,
    cwd,
    projectTrusted: true,
    warn: (message) => warnings.push(message),
  });
  assert.deepEqual(config["pi_notify:agent_notify"], [
    "osc:{{TITLE}}|{{CONTENT}}",
    ["shell:/bin/bash", "-lc", "notify \"$PI_NOTIFY_TITLE\""],
    "cmd:legacy-cmd",
  ]);
  assert.deepEqual(warnings, []);

  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const registeredTools: Array<{ name: string; parameters: any; execute: Function }> = [];
  const launches: Array<{
    type: string;
    value?: string;
    executable?: string;
    args?: string[];
    env?: Record<string, string>;
  }> = [];
  const runtime: NotificationRuntime = {
    agentDir,
    launchOsc: (title, body) => launches.push({ type: "osc", value: `${title}|${body}` }),
    launchCommand: (command, _cwd, env) => launches.push({ type: "cmd", value: command, env }),
    launchShell: (executable, args, _cwd, env) =>
      launches.push({ type: "shell", executable, args: [...args], env }),
    warn: () => undefined,
  };
  const pi = {
    on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
    registerTool: (tool: { name: string; parameters: any; execute: Function }) => registeredTools.push(tool),
  } as any;

  registerExtension(pi, runtime);

  const ctx = {
    cwd,
    isProjectTrusted: () => true,
    sessionManager: {
      getSessionId: () => "session-1",
      getSessionFile: () => "/sessions/one.jsonl",
    },
  };

  await handlers.get("session_start")?.({ type: "session_start" }, ctx);
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);

  assert.equal(registeredTools.length, 1);
  assert.equal(registeredTools[0]?.name, "agent_notify");
  assert.ok(registeredTools[0]?.parameters);
  assert.ok(registeredTools[0]?.parameters.properties?.title);
  assert.ok(registeredTools[0]?.parameters.properties?.content);

  const result = await registeredTools[0]!.execute(
    "call-notify-1",
    { title: "Build done", content: "Tests passed" },
    undefined,
    undefined,
    ctx,
  );

  assert.match(String(result?.content?.[0]?.text ?? result), /notified|sent|success/i);

  const osc = launches.find((entry) => entry.type === "osc");
  assert.equal(osc?.value, "Build done|Tests passed");

  const shell = launches.find((entry) => entry.type === "shell");
  assert.ok(shell);
  assert.equal(shell!.executable, "/bin/bash");
  assert.deepEqual(shell!.args, ["-lc", "notify \"$PI_NOTIFY_TITLE\""]);
  assert.equal(shell!.env?.PI_NOTIFY_TITLE, "Build done");
  assert.equal(shell!.env?.PI_NOTIFY_CONTENT, "Tests passed");
  assert.equal(shell!.env?.PI_NOTIFY_EVENT, "pi_notify:agent_notify");

  const legacy = launches.find((entry) => entry.value === "legacy-cmd");
  assert.ok(legacy);
  assert.equal(legacy!.env?.PI_NOTIFY_TITLE, "Build done");
});
