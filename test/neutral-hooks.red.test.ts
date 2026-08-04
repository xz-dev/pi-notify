import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import registerExtension, { type NotificationRuntime } from "../index.js";
import { loadConfig } from "../src/config.js";
import {
  SEMANTIC_HOOK_CHANNEL,
  parseSemanticHook,
} from "../src/semantic-hook.js";
import { createTemplateValues, createNotificationEnvironment, renderTemplate } from "../src/context.js";

async function fixture(): Promise<{ agentDir: string; cwd: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-notify-neutral-red-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  return { agentDir, cwd, root };
}

function makeCtx(cwd: string, trusted = true, overrides?: Partial<{ cwd: string; sessionId: string; sessionFile?: string }>) {
  let currentCwd = overrides?.cwd ?? cwd;
  let sessionId = overrides?.sessionId ?? "session-1";
  let sessionFile: string | undefined = overrides?.sessionFile ?? "/sessions/one.jsonl";
  return {
    get cwd() {
      return currentCwd;
    },
    setCwd(next: string) {
      currentCwd = next;
    },
    setSession(id: string, file?: string) {
      sessionId = id;
      sessionFile = file;
    },
    isProjectTrusted: () => trusted,
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => sessionFile,
    },
  };
}

async function flushAsync(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createPiHarness() {
  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const bus = new Map<string, Set<(data: unknown) => void>>();
  const tools: any[] = [];
  const pi = {
    on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => {
      handlers.set(event, handler);
    },
    registerTool: (tool: any) => tools.push(tool),
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        let set = bus.get(channel);
        if (!set) {
          set = new Set();
          bus.set(channel, set);
        }
        set.add(handler);
        return () => set!.delete(handler);
      },
      emit: (channel: string, data: unknown) => {
        for (const handler of bus.get(channel) ?? []) handler(data);
      },
    },
  };
  return { handlers, bus, tools, pi: pi as any };
}

test("nested config parses events/hooks, defaults delayMs, rejects bare hook osc, migrates legacy", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      events: {
        agent_settled: { actions: ["osc"] },
        "tool_execution_start:ask_user_question": { delayMs: 25, actions: ["cmd:q"] },
        agent_end: { actions: ["osc"] },
      },
      hooks: {
        "user-ready": { delayMs: 10, actions: ["osc:Pi|Ready"] },
        "agent-notify": { actions: ["osc"] },
        "Bad_Name": { actions: ["cmd:x"] },
        "good-hook": { delayMs: -1, actions: ["cmd:x"] },
        "over-max": { delayMs: 2147483648, actions: ["cmd:x"] },
        "empty-ok": { actions: [] },
      },
      agent_settled: ["osc", "cmd:legacy"],
      "pi_notify:agent_notify": ["cmd:legacy-notify"],
    }),
  );

  const warnings: string[] = [];
  const config = await loadConfig({
    agentDir,
    cwd,
    projectTrusted: false,
    warn: (message) => warnings.push(message),
  });

  assert.equal(config.events.agent_settled?.delayMs, 0);
  assert.deepEqual(config.events.agent_settled?.actions, ["osc"]);
  assert.equal(config.events["tool_execution_start:ask_user_question"]?.delayMs, 25);
  assert.equal((config.events as Record<string, unknown>).agent_end, undefined);
  assert.deepEqual(config.hooks["user-ready"], { delayMs: 10, actions: ["osc:Pi|Ready"] });
  // Bare-osc-only hook binding is all-rejected, so the binding is invalid and omitted.
  assert.equal(config.hooks["agent-notify"], undefined);
  assert.equal(config.hooks["Bad_Name"], undefined);
  assert.equal(config.hooks["good-hook"], undefined);
  assert.equal(config.hooks["over-max"], undefined);
  assert.deepEqual(config.hooks["empty-ok"], { delayMs: 0, actions: [] });
  assert.ok(warnings.some((entry) => /legacy|migrate|nested events\/hooks/i.test(entry)));
  assert.ok(warnings.some((entry) => /bare osc|hook.*osc/i.test(entry)));
  assert.ok(warnings.some((entry) => /no valid actions after validation/i.test(entry)));
  assert.equal(warnings.filter((entry) => /legacy|migrate|nested events\/hooks/i.test(entry)).length, 1);
});

test("trusted project whole-unit replacement; invalid high precedence preserves lower; untrusted ignored", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      events: {
        agent_settled: { delayMs: 5, actions: ["cmd:global-settled"] },
        "tool_execution_start:ask_user_question": { actions: ["cmd:global-question"] },
      },
      hooks: {
        "user-ready": { actions: ["cmd:global-ready"] },
        "build-finished": { actions: ["cmd:global-build"] },
      },
    }),
  );
  await writeFile(
    join(cwd, ".pi", "pi-notify.json"),
    JSON.stringify({
      events: {
        agent_settled: { actions: ["cmd:project-settled"] },
        "tool_execution_start:ask_user_question": { delayMs: -3, actions: ["cmd:bad-project"] },
      },
      hooks: {
        "user-ready": { actions: [] },
        "agent-notify": { actions: ["osc:T|C"] },
      },
    }),
  );

  const warnings: string[] = [];
  const trusted = await loadConfig({
    agentDir,
    cwd,
    projectTrusted: true,
    warn: (message) => warnings.push(message),
  });
  assert.deepEqual(trusted.events.agent_settled, { delayMs: 0, actions: ["cmd:project-settled"] });
  assert.deepEqual(trusted.events["tool_execution_start:ask_user_question"], {
    delayMs: 0,
    actions: ["cmd:global-question"],
  });
  assert.deepEqual(trusted.hooks["user-ready"], { delayMs: 0, actions: [] });
  assert.deepEqual(trusted.hooks["build-finished"], { delayMs: 0, actions: ["cmd:global-build"] });
  assert.deepEqual(trusted.hooks["agent-notify"], { delayMs: 0, actions: ["osc:T|C"] });
  assert.ok(warnings.some((entry) => /tool_execution_start:ask_user_question|delayMs/i.test(entry)));

  const untrusted = await loadConfig({
    agentDir,
    cwd,
    projectTrusted: false,
    warn: () => undefined,
  });
  assert.deepEqual(untrusted.events.agent_settled?.actions, ["cmd:global-settled"]);
  assert.equal(untrusted.hooks["agent-notify"], undefined);
});

test("semantic envelope validates, copies, and rejects malformed protocol", () => {
  assert.equal(SEMANTIC_HOOK_CHANNEL, "pi:semantic-hook:v1");

  const ok = parseSemanticHook({
    version: 1,
    name: "user-ready",
    values: { STOP_KIND: "AI_UNLOCK", REASON: "waiting" },
    extra: "ignored-if-copy-only-valid",
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) throw new Error("expected ok");
  assert.equal(ok.envelope.version, 1);
  assert.equal(ok.envelope.name, "user-ready");
  assert.deepEqual(ok.envelope.values, { STOP_KIND: "AI_UNLOCK", REASON: "waiting" });
  assert.equal(Object.isFrozen(ok.envelope), true);
  assert.equal(Object.isFrozen(ok.envelope.values), true);

  const nullProto = Object.assign(Object.create(null), {
    version: 1,
    name: "user-ready",
    values: Object.assign(Object.create(null), { STOP_KIND: "X" }),
  });
  const nullParsed = parseSemanticHook(nullProto);
  assert.equal(nullParsed.ok, true);

  class EnvelopeClass {
    version = 1;
    name = "user-ready";
  }
  const badCases: unknown[] = [
    null,
    new Date(),
    new EnvelopeClass(),
    { version: 2, name: "user-ready" },
    { version: 1, name: "UserReady" },
    { version: 1, name: "user_ready" },
    { version: 1, name: "user-ready", values: [] },
    { version: 1, name: "user-ready", values: { badKey: "x" } },
    { version: 1, name: "user-ready", values: { OK: 1 } },
    { version: 1, name: "a".repeat(200) },
  ];
  for (const sample of badCases) {
    const parsed = parseSemanticHook(sample);
    assert.equal(parsed.ok, false, JSON.stringify(sample));
  }

  const accessorEnvelope: Record<string, unknown> = {};
  Object.defineProperty(accessorEnvelope, "version", {
    enumerable: true,
    get() {
      return 1;
    },
  });
  Object.defineProperty(accessorEnvelope, "name", {
    enumerable: true,
    get() {
      return "user-ready";
    },
  });
  assert.equal(parseSemanticHook(accessorEnvelope).ok, false);

  const throwingEnvelope: Record<string, unknown> = {};
  Object.defineProperty(throwingEnvelope, "version", {
    enumerable: true,
    get() {
      throw new Error("boom-version");
    },
  });
  assert.doesNotThrow(() => {
    const parsed = parseSemanticHook(throwingEnvelope);
    assert.equal(parsed.ok, false);
  });
});

test("hook routing sets HOOK/EVENT, merges values, protects system keys", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      hooks: {
        "user-ready": {
          actions: [
            "osc:{{HOOK}}|{{EVENT}} {{STOP_KIND}} {{CWD}}",
            "cmd:hook-cmd",
            "js:capture",
          ],
        },
      },
    }),
  );

  const { handlers, tools, pi } = createPiHarness();
  const launches: Array<{ type: string; value?: string; env?: Record<string, string | undefined> }> = [];
  const jsScopes: any[] = [];
  const warnings: string[] = [];
  const runtime: NotificationRuntime = {
    agentDir,
    launchOsc: (title, body) => launches.push({ type: "osc", value: `${title}|${body}` }),
    launchCommand: (command, _cwd, env) => launches.push({ type: "cmd", value: command, env }),
    launchShell: () => undefined,
    runJs: async (_code, scope) => {
      jsScopes.push(scope);
    },
    warn: (message) => warnings.push(message),
  };

  registerExtension(pi, runtime);
  await handlers.get("session_start")?.(
    { type: "session_start" },
    makeCtx(cwd),
  );

  pi.events.emit(SEMANTIC_HOOK_CHANNEL, {
    version: 1,
    name: "user-ready",
    values: {
      STOP_KIND: "AI_UNLOCK",
      EVENT: "spoof-event",
      HOOK: "spoof-hook",
      CWD: "spoof-cwd",
      HOSTNAME: "spoof-host",
      SESSION_ID: "spoof-session",
      TITLE: "ignored-as-system-or-allowed?",
    },
  });

  await flushAsync(20);

  assert.equal(tools.length, 0);
  const osc = launches.find((entry) => entry.type === "osc");
  assert.equal(osc?.value, "user-ready|hook:user-ready AI_UNLOCK " + cwd);
  const cmd = launches.find((entry) => entry.type === "cmd");
  assert.equal(cmd?.env?.PI_NOTIFY_HOOK, "user-ready");
  assert.equal(cmd?.env?.PI_NOTIFY_EVENT, "hook:user-ready");
  assert.equal(cmd?.env?.PI_NOTIFY_STOP_KIND, "AI_UNLOCK");
  assert.equal(cmd?.env?.PI_NOTIFY_CWD, cwd);
  assert.notEqual(cmd?.env?.PI_NOTIFY_EVENT, "spoof-event");
  assert.notEqual(cmd?.env?.PI_NOTIFY_HOOK, "spoof-hook");
  assert.notEqual(cmd?.env?.PI_NOTIFY_CWD, "spoof-cwd");
  assert.notEqual(cmd?.env?.PI_NOTIFY_HOSTNAME, "spoof-host");
  assert.equal(jsScopes[0]?.notification.values.STOP_KIND, "AI_UNLOCK");
  assert.equal(jsScopes[0]?.notification.values.EVENT, undefined);
  assert.equal(Object.isFrozen(jsScopes[0]?.notification.values), true);
  assert.equal(typeof jsScopes[0]?.notification.bel, "function");
  assert.equal(typeof jsScopes[0]?.notification.osc, "function");

  const before = warnings.length;
  pi.events.emit(SEMANTIC_HOOK_CHANNEL, { version: 1, name: "no-such-hook", values: { X: "1" } });
  await flushAsync(20);
  assert.equal(warnings.length, before);

  pi.events.emit(SEMANTIC_HOOK_CHANNEL, { version: 9, name: "user-ready" });
  await flushAsync(20);
  assert.ok(warnings.slice(before).some((entry) => /semantic|envelope|protocol|invalid/i.test(entry)));
});

test("delay uses independent timers, retains causal payload, collects live env/ctx after delay", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      events: {
        agent_settled: {
          delayMs: 40,
          actions: ["cmd:settled-cmd", "js:settled-js"],
        },
      },
      hooks: {
        "build-finished": {
          delayMs: 40,
          actions: ["cmd:build-cmd", "osc:Build|{{RESULT}} {{CWD}}"],
        },
      },
    }),
  );

  const scheduled: Array<{ ms: number; run: () => void; cleared: boolean }> = [];
  const { handlers, pi } = createPiHarness();
  const launches: Array<{ type: string; value?: string; cwd?: string; env?: Record<string, string | undefined>; at: number }> = [];
  const jsScopes: any[] = [];
  let now = 0;
  const runtime: NotificationRuntime = {
    agentDir,
    launchOsc: (title, body) => launches.push({ type: "osc", value: `${title}|${body}`, at: now }),
    launchCommand: (command, commandCwd, env) =>
      launches.push({ type: "cmd", value: command, cwd: commandCwd, env, at: now }),
    launchShell: () => undefined,
    runJs: async (_code, scope) => {
      jsScopes.push({ ...scope, at: now });
    },
    warn: () => undefined,
    scheduler: {
      setTimeout(fn, ms) {
        const entry = { ms, run: fn, cleared: false };
        scheduled.push(entry);
        return entry as any;
      },
      clearTimeout(handle: any) {
        if (handle) handle.cleared = true;
      },
    },
  };

  registerExtension(pi, runtime);
  const ctx = makeCtx(cwd);
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);

  await handlers.get("agent_settled")?.({ type: "agent_settled", mark: "A" }, ctx);
  await handlers.get("agent_settled")?.({ type: "agent_settled", mark: "B" }, ctx);
  pi.events.emit(SEMANTIC_HOOK_CHANNEL, {
    version: 1,
    name: "build-finished",
    values: { RESULT: "SUCCESS" },
  });
  await flushAsync();

  assert.equal(scheduled.filter((entry) => !entry.cleared).length, 3);
  assert.ok(scheduled.every((entry) => entry.ms === 40));
  assert.equal(launches.length, 0);

  process.env.PI_NOTIFY_NEUTRAL_PROBE = "live-after-delay";
  ctx.setCwd(join(cwd, "moved"));
  ctx.setSession("session-live", "/sessions/live.jsonl");

  now = 40;
  for (const entry of [...scheduled]) {
    if (!entry.cleared) entry.run();
  }
  await new Promise((resolve) => setImmediate(resolve));

  const settledCmds = launches.filter((entry) => entry.value === "settled-cmd");
  assert.equal(settledCmds.length, 2);
  assert.ok(settledCmds.every((entry) => entry.cwd === join(cwd, "moved")));
  assert.ok(settledCmds.every((entry) => entry.env?.PI_NOTIFY_CWD === join(cwd, "moved")));
  assert.ok(settledCmds.every((entry) => entry.env?.PI_NOTIFY_SESSION_ID === "session-live"));

  const buildCmd = launches.find((entry) => entry.value === "build-cmd");
  assert.equal(buildCmd?.env?.PI_NOTIFY_EVENT, "hook:build-finished");
  assert.equal(buildCmd?.env?.PI_NOTIFY_RESULT, "SUCCESS");

  const osc = launches.find((entry) => entry.type === "osc");
  assert.equal(osc?.value, `Build|SUCCESS ${join(cwd, "moved")}`);

  assert.equal(jsScopes.length, 2);
  assert.equal(jsScopes[0]?.event?.mark, "A");
  assert.equal(jsScopes[1]?.event?.mark, "B");
  assert.equal(jsScopes[0]?.ctx.cwd, join(cwd, "moved"));

  delete process.env.PI_NOTIFY_NEUTRAL_PROBE;
});

test("shutdown cancels timers and generation guards prevent late side effects", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      events: { agent_settled: { delayMs: 100, actions: ["cmd:late"] } },
      hooks: { "user-ready": { delayMs: 100, actions: ["cmd:late-hook"] } },
    }),
  );

  const scheduled: Array<{ run: () => void; cleared: boolean }> = [];
  const { handlers, bus, pi } = createPiHarness();
  const launches: string[] = [];
  const runtime: NotificationRuntime = {
    agentDir,
    launchOsc: () => undefined,
    launchCommand: (command) => launches.push(command),
    launchShell: () => undefined,
    warn: () => undefined,
    scheduler: {
      setTimeout(fn) {
        const entry = { run: fn, cleared: false };
        scheduled.push(entry);
        return entry as any;
      },
      clearTimeout(handle: any) {
        handle.cleared = true;
      },
    },
  };

  registerExtension(pi, runtime);
  const ctx = makeCtx(cwd);
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
  pi.events.emit(SEMANTIC_HOOK_CHANNEL, { version: 1, name: "user-ready", values: { X: "1" } });
  await flushAsync();
  assert.equal(scheduled.length, 2);

  await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
  assert.ok(scheduled.every((entry) => entry.cleared));
  assert.equal(bus.get(SEMANTIC_HOOK_CHANNEL)?.size ?? 0, 0);

  for (const entry of scheduled) entry.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(launches, []);
});

test("notification.osc reuses backend and continues after errors; values are frozen", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      hooks: {
        "user-ready": {
          actions: [
            "js:notification.osc('A', notification.values.REASON); throw new Error('after-osc');",
            "cmd:after-js",
          ],
        },
      },
    }),
  );

  const { handlers, pi } = createPiHarness();
  const oscCalls: Array<{ title: string; body: string }> = [];
  const commands: string[] = [];
  const warnings: string[] = [];
  registerExtension(pi, {
    agentDir,
    launchOsc: (title, body) => oscCalls.push({ title, body }),
    launchCommand: (command) => commands.push(command),
    launchShell: () => undefined,
    warn: (message) => warnings.push(message),
  });
  await handlers.get("session_start")?.({ type: "session_start" }, makeCtx(cwd));
  pi.events.emit(SEMANTIC_HOOK_CHANNEL, {
    version: 1,
    name: "user-ready",
    values: { REASON: "Waiting" },
  });
  await flushAsync(20);

  assert.deepEqual(oscCalls, [{ title: "A", body: "Waiting" }]);
  assert.deepEqual(commands, ["after-js"]);
  assert.ok(warnings.some((entry) => entry.includes("after-osc")));
});

test("notification.bel backend failure aggregates once, remains catchable, and later actions run", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      hooks: {
        "user-ready": {
          actions: [
            "js:try { notification.bel(); } catch (error) { globalThis.__belCaught = String(error); }",
            "cmd:after-bel-fail",
          ],
        },
      },
    }),
  );

  const { handlers, pi } = createPiHarness();
  const commands: string[] = [];
  const warnings: string[] = [];
  delete (globalThis as { __belCaught?: string }).__belCaught;
  registerExtension(pi, {
    agentDir,
    launchBel: () => {
      throw new Error("bel-backend-down");
    },
    launchOsc: () => undefined,
    launchCommand: (command) => commands.push(command),
    launchShell: () => undefined,
    warn: (message) => warnings.push(message),
  });
  await handlers.get("session_start")?.({ type: "session_start" }, makeCtx(cwd));
  pi.events.emit(SEMANTIC_HOOK_CHANNEL, { version: 1, name: "user-ready" });
  await flushAsync(20);

  assert.deepEqual(commands, ["after-bel-fail"]);
  assert.match(String((globalThis as { __belCaught?: string }).__belCaught), /bel-backend-down/);
  const diagnostic = warnings.filter((entry) =>
    /pi-notify · hook:user-ready · bel action failed: bel-backend-down/.test(entry),
  );
  assert.equal(diagnostic.length, 1);
  assert.equal(warnings.filter((entry) => entry.includes("bel-backend-down")).length, 1);
  delete (globalThis as { __belCaught?: string }).__belCaught;
});

test("notification.osc backend failure aggregates once, still throws into js, later actions run", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      hooks: {
        "user-ready": {
          actions: [
            "js:try { notification.osc('T','B'); } catch (error) { globalThis.__oscCaught = String(error); }",
            "cmd:after-osc-fail",
          ],
        },
      },
    }),
  );

  const { handlers, pi } = createPiHarness();
  const commands: string[] = [];
  const warnings: string[] = [];
  delete (globalThis as { __oscCaught?: string }).__oscCaught;
  registerExtension(pi, {
    agentDir,
    launchOsc: () => {
      throw new Error("osc-backend-down");
    },
    launchCommand: (command) => commands.push(command),
    launchShell: () => undefined,
    warn: (message) => warnings.push(message),
  });
  await handlers.get("session_start")?.({ type: "session_start" }, makeCtx(cwd));
  pi.events.emit(SEMANTIC_HOOK_CHANNEL, { version: 1, name: "user-ready" });
  await flushAsync(20);

  assert.deepEqual(commands, ["after-osc-fail"]);
  assert.match(String((globalThis as { __oscCaught?: string }).__oscCaught), /osc-backend-down/);
  const diagnostic = warnings.filter((entry) =>
    /pi-notify · hook:user-ready · osc action failed: osc-backend-down/.test(entry),
  );
  assert.equal(diagnostic.length, 1);
  assert.equal(warnings.filter((entry) => entry.includes("osc-backend-down")).length, 1);
  delete (globalThis as { __oscCaught?: string }).__oscCaught;
});

test("awaited js resolve/reject after shutdown produces no stale warnings or later actions", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      hooks: {
        reject: {
          actions: [
            "js:await new Promise((_, reject) => setTimeout(() => reject(new Error('late-reject')), 40))",
            "cmd:after-reject",
          ],
        },
        resolve: {
          actions: [
            "js:await new Promise((resolve) => setTimeout(resolve, 40))",
            "cmd:after-resolve",
          ],
        },
      },
    }),
  );

  for (const name of ["reject", "resolve"] as const) {
    const { handlers, pi } = createPiHarness();
    const launches: string[] = [];
    const warnings: string[] = [];
    registerExtension(pi, {
      agentDir,
      launchOsc: () => undefined,
      launchCommand: (command) => launches.push(command),
      launchShell: () => undefined,
      warn: (message) => warnings.push(message),
    });
    const ctx = makeCtx(cwd);
    await handlers.get("session_start")?.({ type: "session_start" }, ctx);
    pi.events.emit(SEMANTIC_HOOK_CHANNEL, { version: 1, name });
    await flushAsync(5);
    await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
    await flushAsync(80);
    assert.deepEqual(launches, [], name);
    assert.deepEqual(warnings, [], name);
  }
});

test("hook name constructor is silent when unconfigured and works when configured", async () => {
  const { agentDir, cwd } = await fixture();
  const { handlers, pi } = createPiHarness();
  const launches: string[] = [];
  const warnings: string[] = [];
  registerExtension(pi, {
    agentDir,
    launchOsc: () => undefined,
    launchCommand: (command) => launches.push(command),
    launchShell: () => undefined,
    warn: (message) => warnings.push(message),
  });
  const ctx = makeCtx(cwd);

  await writeFile(join(agentDir, "pi-notify.json"), JSON.stringify({ hooks: {} }));
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);
  pi.events.emit(SEMANTIC_HOOK_CHANNEL, { version: 1, name: "constructor" });
  await flushAsync(20);
  assert.deepEqual(launches, []);
  assert.deepEqual(warnings, []);

  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({ hooks: { constructor: { actions: ["cmd:ctor-ok"] } } }),
  );
  pi.events.emit(SEMANTIC_HOOK_CHANNEL, { version: 1, name: "constructor" });
  await flushAsync(20);
  assert.deepEqual(launches, ["ctor-ok"]);
  assert.deepEqual(warnings, []);
});

test("agent_notify is producer-only: registers from hooks.agent-notify, publishes envelope, exact result", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      hooks: {
        "agent-notify": {
          actions: ["cmd:should-not-block-tool", "js:throw new Error('consumer boom')"],
        },
      },
    }),
  );

  const { handlers, tools, pi, bus } = createPiHarness();
  const received: unknown[] = [];
  bus.set(SEMANTIC_HOOK_CHANNEL, new Set([(data) => received.push(data)]));

  const commands: string[] = [];
  const warnings: string[] = [];
  registerExtension(pi, {
    agentDir,
    launchOsc: () => undefined,
    launchCommand: (command) => commands.push(command),
    launchShell: () => undefined,
    runJs: async () => {
      throw new Error("consumer boom");
    },
    warn: (message) => warnings.push(message),
  });

  await handlers.get("session_start")?.({ type: "session_start" }, makeCtx(cwd));
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "agent_notify");

  const result = await tools[0].execute(
    "call-1",
    { title: "Ship", content: "Ready" },
    undefined,
    undefined,
    makeCtx(cwd),
  );
  assert.equal(result.content[0].text, "Notification hook published");

  await flushAsync(20);
  assert.ok(received.some((entry: any) => entry?.name === "agent-notify"));
  const envelope = received.find((entry: any) => entry?.name === "agent-notify") as any;
  assert.equal(envelope.version, 1);
  assert.deepEqual(envelope.values, { TITLE: "Ship", CONTENT: "Ready" });
  assert.ok(commands.includes("should-not-block-tool"));
  assert.ok(warnings.some((entry) => entry.includes("consumer boom")));

  const { handlers: handlers2, tools: tools2, pi: pi2 } = createPiHarness();
  pi2.events.emit = () => {
    throw new Error("bus down");
  };
  registerExtension(pi2, {
    agentDir,
    launchOsc: () => undefined,
    launchCommand: () => undefined,
    launchShell: () => undefined,
    warn: () => undefined,
  });
  await handlers2.get("session_start")?.({ type: "session_start" }, makeCtx(cwd));
  await assert.rejects(
    () => tools2[0].execute("c2", { title: "T", content: "C" }, undefined, undefined, makeCtx(cwd)),
    /bus down/,
  );
});

test("agent_notify tool absent without hooks.agent-notify actions", async () => {
  const cases = [
    {},
    { hooks: { "agent-notify": { actions: [] } } },
    { hooks: { "agent-notify": { actions: ["osc"] } } },
    { "pi_notify:agent_notify": ["cmd:legacy"] },
  ];
  for (const document of cases) {
    const { agentDir, cwd } = await fixture();
    await writeFile(join(agentDir, "pi-notify.json"), JSON.stringify(document));
    const { handlers, tools, pi } = createPiHarness();
    registerExtension(pi, {
      agentDir,
      launchOsc: () => undefined,
      launchCommand: () => undefined,
      launchShell: () => undefined,
      warn: () => undefined,
    });
    await handlers.get("session_start")?.({ type: "session_start" }, makeCtx(cwd));
    assert.equal(tools.length, 0, JSON.stringify(document));
  }
});

test("template helpers expose HOOK and producer values without system override", () => {
  const values = createTemplateValues({
    event: "hook:user-ready",
    hook: "user-ready",
    cwd: "/work",
    sessionId: "s1",
    values: {
      STOP_KIND: "AI_UNLOCK",
      EVENT: "spoof",
      HOOK: "spoof",
      CWD: "spoof",
      TITLE: "ok-title",
    },
  });
  assert.equal(values.EVENT, "hook:user-ready");
  assert.equal(values.HOOK, "user-ready");
  assert.equal(values.CWD, "/work");
  assert.equal(values.STOP_KIND, "AI_UNLOCK");
  assert.equal(values.TITLE, "ok-title");
  assert.equal(renderTemplate("{{HOOK}}/{{EVENT}}/{{STOP_KIND}}/{{TITLE}}", values), "user-ready/hook:user-ready/AI_UNLOCK/ok-title");

  const env = createNotificationEnvironment({
    event: "hook:user-ready",
    hook: "user-ready",
    cwd: "/work",
    sessionId: "s1",
    values: { STOP_KIND: "X" },
  });
  assert.equal(env.PI_NOTIFY_HOOK, "user-ready");
  assert.equal(env.PI_NOTIFY_EVENT, "hook:user-ready");
  assert.equal(env.PI_NOTIFY_STOP_KIND, "X");
});
