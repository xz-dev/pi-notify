import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import registerExtension, { type NotificationRuntime } from "../index.js";
import { createCommandLauncher, createShellLauncher } from "../src/command.js";
import { createOscLauncher } from "../src/osc.js";

interface Toast {
  message: string;
  type?: "info" | "warning" | "error";
}

async function fixture(config: unknown): Promise<{ agentDir: string; cwd: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-notify-tui-errors-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "pi-notify.json"), JSON.stringify(config));
  return { agentDir, cwd };
}

function createHarness() {
  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const bus = new Map<string, Set<(data: unknown) => void>>();
  const tools: any[] = [];
  let historyWrites = 0;
  const pi = {
    on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
    registerTool: (tool: any) => tools.push(tool),
    appendEntry: () => {
      historyWrites += 1;
    },
    sendMessage: () => {
      historyWrites += 1;
    },
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        let listeners = bus.get(channel);
        if (!listeners) {
          listeners = new Set();
          bus.set(channel, listeners);
        }
        listeners.add(handler);
        return () => listeners!.delete(handler);
      },
      emit: (channel: string, data: unknown) => {
        for (const handler of bus.get(channel) ?? []) handler(data);
      },
    },
  };
  return { handlers, tools, pi: pi as any, historyWrites: () => historyWrites };
}

function makeCtx(cwd: string, toasts: Toast[], notify?: (message: string, type?: Toast["type"]) => void) {
  return {
    cwd,
    hasUI: true,
    ui: {
      notify: notify ?? ((message: string, type?: Toast["type"]) => toasts.push({ message, type })),
    },
    isProjectTrusted: () => true,
    sessionManager: {
      getSessionId: () => "session-1",
      getSessionFile: () => "/sessions/one.jsonl",
    },
  };
}

function fakeChild(unrefError?: Error): EventEmitter & { unref: () => void } {
  const child = new EventEmitter() as EventEmitter & { unref: () => void };
  child.unref = () => {
    if (unrefError) throw unrefError;
  };
  return child;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 5));
}

test("event and hook action failures show TUI-only errors and later actions continue", async () => {
  const { agentDir, cwd } = await fixture({
    events: {
      agent_settled: { actions: ["bel", "osc:Pi|Ready", "js:boom", "cmd:after-event"] },
    },
    hooks: {
      "agent-notify": { actions: [["shell:/missing/tool", "x"], "cmd:after-hook"] },
    },
  });
  const { handlers, tools, pi, historyWrites } = createHarness();
  const toasts: Toast[] = [];
  const commands: string[] = [];
  const warnings: string[] = [];
  const runtime: NotificationRuntime = {
    agentDir,
    launchBel: () => {
      throw new Error("bel failed");
    },
    launchOsc: () => {
      throw new Error("osc failed");
    },
    launchCommand: (command) => commands.push(command),
    launchShell: () => {
      throw new Error("shell failed");
    },
    runJs: async () => {
      throw new Error("js failed");
    },
    warn: (message) => warnings.push(message),
  };
  const ctx = makeCtx(cwd, toasts);

  registerExtension(pi, runtime);
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
  const result = await tools[0]!.execute("call-1", { title: "T", content: "C" }, undefined, undefined, ctx);
  await flush();

  assert.equal(result.content[0].text, "Notification hook published");
  assert.deepEqual(commands, ["after-event", "after-hook"]);
  assert.deepEqual(toasts, [
    { message: "pi-notify · event:agent_settled · bel action failed: bel failed", type: "error" },
    { message: "pi-notify · event:agent_settled · osc action failed: osc failed", type: "error" },
    { message: "pi-notify · event:agent_settled · js action failed: js failed", type: "error" },
    { message: "pi-notify · hook:agent-notify · shell action failed: shell failed", type: "error" },
  ]);
  for (const failure of ["bel failed", "osc failed", "js failed", "shell failed"]) {
    assert.equal(warnings.filter((message) => message.includes(failure)).length, 1);
  }
  assert.equal(historyWrites(), 0);
});

test("default process launchers report child errors and nonzero exits once, but not after shutdown", async () => {
  const { agentDir, cwd } = await fixture({
    events: { agent_settled: { actions: ["cmd:failing-command"] } },
    hooks: {
      "agent-notify": {
        actions: [
          ["shell:/failing/tool", "x"],
          ["shell:/signaled/tool", "y"],
        ],
      },
    },
  });
  const { handlers, tools, pi } = createHarness();
  const toasts: Toast[] = [];
  const warnings: string[] = [];
  const commandChildren: EventEmitter[] = [];
  const shellChildren: EventEmitter[] = [];
  const ctx = makeCtx(cwd, toasts);

  registerExtension(pi, {
    agentDir,
    launchOsc: () => undefined,
    launchCommand: createCommandLauncher({
      spawn: () => {
        const child = fakeChild();
        commandChildren.push(child);
        return child;
      },
      warn: (message) => warnings.push(message),
    }),
    launchShell: createShellLauncher({
      spawn: () => {
        const child = fakeChild();
        shellChildren.push(child);
        return child;
      },
      warn: (message) => warnings.push(message),
    }),
    warn: (message) => warnings.push(message),
  });
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
  await tools[0]!.execute("call-2", { title: "T", content: "C" }, undefined, undefined, ctx);
  await flush();

  commandChildren[0]!.emit("exit", 7, null);
  commandChildren[0]!.emit("error", new Error("late duplicate"));
  shellChildren[0]!.emit("error", new Error("spawn EACCES"));
  shellChildren[0]!.emit("exit", 1, null);
  shellChildren[1]!.emit("exit", null, "SIGTERM");
  shellChildren[1]!.emit("error", new Error("late signal duplicate"));
  assert.deepEqual(toasts, [
    {
      message: "pi-notify · event:agent_settled · cmd action failed: Notification command exited with code 7",
      type: "error",
    },
    { message: "pi-notify · hook:agent-notify · shell action failed: spawn EACCES", type: "error" },
    {
      message: "pi-notify · hook:agent-notify · shell action failed: Notification shell exited with signal SIGTERM",
      type: "error",
    },
  ]);
  assert.equal(warnings.length, 3);

  await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
  await flush();
  const warningCount = warnings.length;
  await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
  commandChildren[1]!.emit("exit", 9, null);
  assert.equal(toasts.length, 3);
  assert.equal(warnings.length, warningCount);
});

test("sync spawn and unref failures report exactly once to stderr and TUI", async () => {
  const { agentDir, cwd } = await fixture({
    events: { agent_settled: { actions: ["cmd:spawn-fails", "cmd:unref-fails"] } },
  });
  const { handlers, pi } = createHarness();
  const toasts: Toast[] = [];
  const warnings: string[] = [];
  const children: EventEmitter[] = [];
  let launch = 0;
  const ctx = makeCtx(cwd, toasts);

  registerExtension(pi, {
    agentDir,
    launchOsc: () => undefined,
    launchCommand: createCommandLauncher({
      spawn: () => {
        launch += 1;
        if (launch === 1) throw new Error("spawn sync failed");
        const child = fakeChild(new Error("unref failed"));
        children.push(child);
        return child;
      },
      warn: (message) => warnings.push(message),
    }),
    launchShell: () => undefined,
    warn: (message) => warnings.push(message),
  });
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
  await flush();
  children[0]!.emit("error", new Error("late child error"));
  children[0]!.emit("exit", 8, null);

  assert.deepEqual(toasts, [
    {
      message: "pi-notify · event:agent_settled · cmd action failed: Cannot launch notification command: spawn sync failed",
      type: "error",
    },
    {
      message: "pi-notify · event:agent_settled · cmd action failed: Cannot launch notification command: unref failed",
      type: "error",
    },
  ]);
  assert.equal(warnings.length, 2);
});

test("a throwing TUI notifier never blocks later actions and stderr remains available", async () => {
  const { agentDir, cwd } = await fixture({
    events: { agent_settled: { actions: ["js:boom", "cmd:after"] } },
  });
  const { handlers, pi, historyWrites } = createHarness();
  const commands: string[] = [];
  const warnings: string[] = [];
  const ctx = makeCtx(cwd, [], () => {
    throw new Error("UI unavailable");
  });

  registerExtension(pi, {
    agentDir,
    launchOsc: () => undefined,
    launchCommand: (command) => commands.push(command),
    launchShell: () => undefined,
    runJs: async () => {
      throw new Error("js failed");
    },
    warn: (message) => warnings.push(message),
  });
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
  await flush();

  assert.deepEqual(commands, ["after"]);
  assert.ok(warnings.some((message) => message.includes("js failed")));
  assert.ok(warnings.some((message) => message.includes("Cannot show notification action failure")));
  assert.equal(historyWrites(), 0);
});

test("an asynchronous Windows fallback failure is reported once without an uncaught callback error", () => {
  const warnings: string[] = [];
  const failures: string[] = [];
  const child = fakeChild();
  const launch = createOscLauncher({
    environment: { WT_SESSION: "1" },
    write: () => {
      throw new Error("fallback write failed");
    },
    resolvePowerShell: () => "powershell.exe",
    spawn: () => child,
    warn: (message) => warnings.push(message),
  });

  launch("Pi", "Ready", {
    isCurrent: () => true,
    reportFailure: (error) => failures.push(error instanceof Error ? error.message : String(error)),
  });
  assert.doesNotThrow(() => child.emit("error", new Error("PowerShell failed")));
  child.emit("exit", 1, null);

  assert.deepEqual(failures, ["fallback write failed"]);
  assert.ok(warnings.some((message) => message.includes("PowerShell failed")));
});

test("notification.osc reports an asynchronous fallback failure through its js action", async () => {
  const { agentDir, cwd } = await fixture({
    events: { agent_settled: { actions: ["js:notification.osc('Pi', 'Ready')", "cmd:after"] } },
  });
  const { handlers, pi } = createHarness();
  const toasts: Toast[] = [];
  const warnings: string[] = [];
  const commands: string[] = [];
  const child = fakeChild();
  const ctx = makeCtx(cwd, toasts);

  registerExtension(pi, {
    agentDir,
    launchOsc: createOscLauncher({
      environment: { WT_SESSION: "1" },
      write: () => {
        throw new Error("fallback write failed");
      },
      resolvePowerShell: () => "powershell.exe",
      spawn: () => child,
      warn: (message) => warnings.push(message),
    }),
    launchCommand: (command) => commands.push(command),
    launchShell: () => undefined,
    warn: (message) => warnings.push(message),
  });
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
  await flush();
  assert.deepEqual(commands, ["after"]);

  assert.doesNotThrow(() => child.emit("error", new Error("PowerShell failed")));
  assert.deepEqual(toasts, [
    {
      message: "pi-notify · event:agent_settled · osc action failed: fallback write failed",
      type: "error",
    },
  ]);
  assert.equal(warnings.filter((message) => message.includes("fallback write failed")).length, 1);
});
