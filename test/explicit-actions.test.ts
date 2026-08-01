import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import registerExtension, { type NotificationRuntime } from "../index.js";
import { loadConfig } from "../src/config.js";
import { createCommandLauncher, createShellLauncher } from "../src/command.js";
import { createNotificationEnvironment, renderTemplate } from "../src/context.js";
import { createOscLauncher } from "../src/osc.js";
import { isBarePowerShellExe, resolvePowerShell } from "../src/powershell.js";

async function fixture(): Promise<{ agentDir: string; cwd: string }> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "pi-notify-explicit-")));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  return { agentDir, cwd };
}

function makeCtx(cwd: string, trusted = true) {
  return {
    cwd,
    isProjectTrusted: () => trusted,
    sessionManager: {
      getSessionId: () => "session-1",
      getSessionFile: () => "/sessions/one.jsonl",
    },
  };
}

test("config accepts string actions and flat shell tuples; rejects old shell strings and invalid tuples", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      agent_settled: [
        "cmd:ok",
        ["shell:/bin/bash", "-lc", "echo hi"],
        "js:await Promise.resolve()",
        ["shell:pwsh", "-Command", "Write-Output hi"],
        ["shell:C:\\Tools\\pwsh.exe", "-NoProfile", "-Command", "Write-Output %PATH%"],
        "shell:/bin/bash:-lc 'echo hi'",
        "shell:pwsh:-Command Write-Output hi",
        "shell:",
        ["shell:/bin/bash"],
        ["shell:", "args"],
        ["shell:  ", "args"],
        ["shell:/bin/bash", 1],
        { shell: "/bin/bash" },
        "js:",
        "js:   ",
        "cmd:",
      ],
      "pi_notify:agent_notify": ["cmd:notify-me", "email", ["shell:/bin/true", "--ok"]],
      agent_end: ["osc"],
    }),
  );

  const warnings: string[] = [];
  const config = await loadConfig({
    agentDir,
    cwd,
    projectTrusted: false,
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(config.agent_settled, [
    "cmd:ok",
    ["shell:/bin/bash", "-lc", "echo hi"],
    "js:await Promise.resolve()",
    ["shell:pwsh", "-Command", "Write-Output hi"],
    ["shell:C:\\Tools\\pwsh.exe", "-NoProfile", "-Command", "Write-Output %PATH%"],
  ]);
  assert.deepEqual(config["pi_notify:agent_notify"], ["cmd:notify-me", ["shell:/bin/true", "--ok"]]);
  assert.equal((config as Record<string, unknown>).agent_end, undefined);
  assert.ok(warnings.length >= 10);
  assert.ok(warnings.some((entry) => entry.includes("shell:/bin/bash:-lc")));
});

test("trusted project replaces agent_notify hook; untrusted project is ignored", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({ "pi_notify:agent_notify": ["cmd:global-hook"] }),
  );
  await writeFile(
    join(cwd, ".pi", "pi-notify.json"),
    JSON.stringify({ "pi_notify:agent_notify": ["cmd:project-hook", "js:void 0"] }),
  );

  const trusted = await loadConfig({ agentDir, cwd, projectTrusted: true, warn: () => undefined });
  assert.deepEqual(trusted["pi_notify:agent_notify"], ["cmd:project-hook", "js:void 0"]);

  const untrusted = await loadConfig({ agentDir, cwd, projectTrusted: false, warn: () => undefined });
  assert.deepEqual(untrusted["pi_notify:agent_notify"], ["cmd:global-hook"]);
});

test("cmd behavior remains host-default-shell program text without extra quoting", async () => {
  const calls: Array<{ command: string }> = [];
  const launch = createCommandLauncher({
    inheritedEnvironment: { PATH: "/bin" },
    spawn: (command) => {
      calls.push({ command });
      return { once: () => undefined, unref: () => undefined };
    },
    warn: () => undefined,
  });

  launch(
    "notify --ready",
    "/work",
    createNotificationEnvironment({
      event: "agent_settled",
      cwd: "/work",
      sessionId: "s1",
    }),
  );

  assert.equal(calls[0]?.command, "notify --ready");
});

test("structured shell spawns shell:false with exact executable argv env and options", () => {
  const calls: Array<{ executable: string; args: string[]; options: Record<string, unknown> }> = [];
  const launch = createShellLauncher({
    inheritedEnvironment: { PATH: "/bin", PI_NOTIFY_TOOL: "stale" },
    spawn: (executable, args, options) => {
      calls.push({ executable, args: [...args], options: { ...options } as Record<string, unknown> });
      return { once: () => undefined, unref: () => undefined };
    },
    warn: () => undefined,
  });

  const env = createNotificationEnvironment({
    event: "agent_settled",
    cwd: "/work",
    sessionId: "s1",
    title: "T",
  });
  launch("C:\\Program Files\\tool.exe", ["--path", "C:\\Users\\%USER%\\x", "a b"], "/work", env);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.executable, "C:\\Program Files\\tool.exe");
  assert.deepEqual(calls[0]?.args, ["--path", "C:\\Users\\%USER%\\x", "a b"]);
  assert.equal(calls[0]?.options.shell, false);
  assert.equal(calls[0]?.options.detached, true);
  assert.equal(calls[0]?.options.stdio, "ignore");
  assert.equal(calls[0]?.options.windowsHide, true);
  assert.equal(calls[0]?.options.cwd, "/work");
  assert.equal((calls[0]?.options.env as NodeJS.ProcessEnv).PATH, "/bin");
  assert.equal((calls[0]?.options.env as NodeJS.ProcessEnv).PI_NOTIFY_TITLE, "T");
  assert.equal((calls[0]?.options.env as NodeJS.ProcessEnv).PI_NOTIFY_TOOL, undefined);
});

test("shell action launches direct argv and continues later actions", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      agent_settled: [
        ["shell:/bin/bash", "-lc", "echo first"],
        "js:throw new Error('js boom')",
        "cmd:after-js",
      ],
    }),
  );

  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const shellLaunches: Array<{ executable: string; args: string[] }> = [];
  const cmdLaunches: string[] = [];
  const jsCalls: string[] = [];
  const warnings: string[] = [];
  const runtime: NotificationRuntime = {
    agentDir,
    launchOsc: () => undefined,
    launchCommand: (command) => cmdLaunches.push(command),
    launchShell: (executable, args) => shellLaunches.push({ executable, args: [...args] }),
    runJs: async (code) => {
      jsCalls.push(code);
      throw new Error("js boom");
    },
    warn: (message) => warnings.push(message),
  };
  const pi = {
    on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
    registerTool: () => undefined,
  } as any;

  registerExtension(pi, runtime);
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, makeCtx(cwd));

  assert.deepEqual(shellLaunches, [{ executable: "/bin/bash", args: ["-lc", "echo first"] }]);
  assert.equal(jsCalls.length, 1);
  assert.deepEqual(cmdLaunches, ["after-js"]);
  assert.ok(warnings.some((entry) => entry.includes("js boom")));
});

test("bare powershell.exe resolves; explicit powershell paths stay exact", async () => {
  assert.equal(isBarePowerShellExe("powershell.exe"), true);
  assert.equal(isBarePowerShellExe("PowerShell.EXE"), true);
  assert.equal(isBarePowerShellExe("/custom/powershell.exe"), false);
  assert.equal(isBarePowerShellExe("C:\\custom\\powershell.exe"), false);

  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      agent_settled: [
        ["shell:powershell.exe", "-NoProfile", "-Command", "Write-Output bare"],
        ["shell:/custom/powershell.exe", "-NoProfile", "-Command", "Write-Output explicit"],
        ["shell:C:\\custom\\powershell.exe", "-NoProfile", "-Command", "Write-Output winpath"],
      ],
    }),
  );

  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const shellLaunches: Array<{ executable: string; args: string[] }> = [];
  registerExtension(
    {
      on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
      registerTool: () => undefined,
    } as any,
    {
      agentDir,
      launchOsc: () => undefined,
      launchCommand: () => undefined,
      launchShell: (executable, args) => shellLaunches.push({ executable, args: [...args] }),
      resolvePowerShell: () => "/resolved/powershell.exe",
      warn: () => undefined,
    },
  );

  await handlers.get("agent_settled")?.({ type: "agent_settled" }, makeCtx(cwd));
  assert.deepEqual(shellLaunches, [
    { executable: "/resolved/powershell.exe", args: ["-NoProfile", "-Command", "Write-Output bare"] },
    { executable: "/custom/powershell.exe", args: ["-NoProfile", "-Command", "Write-Output explicit"] },
    { executable: "C:\\custom\\powershell.exe", args: ["-NoProfile", "-Command", "Write-Output winpath"] },
  ]);
});

test("WSL powershell.exe resolution order is PATH then SystemRoot/WINDIR then canonical path", () => {
  const calls: string[] = [];
  const fromPath = resolvePowerShell({
    platform: "linux",
    env: { PATH: "/custom/bin", SystemRoot: "C:\\Windows" },
    which: (command) => {
      calls.push(`which:${command}`);
      return command === "powershell.exe" ? "/custom/bin/powershell.exe" : undefined;
    },
    isExecutable: () => {
      throw new Error("should not check filesystem when PATH hits");
    },
  });
  assert.equal(fromPath, "/custom/bin/powershell.exe");
  assert.deepEqual(calls, ["which:powershell.exe"]);

  const fromSystemRoot = resolvePowerShell({
    platform: "linux",
    env: { SystemRoot: "C:\\Windows" },
    which: () => undefined,
    isExecutable: (path) => path === "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
  });
  assert.equal(fromSystemRoot, "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe");

  const fromCanonical = resolvePowerShell({
    platform: "linux",
    env: {},
    which: () => undefined,
    isExecutable: (path) => path === "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
  });
  assert.equal(fromCanonical, "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe");

  const native = resolvePowerShell({
    platform: "win32",
    env: {},
    which: () => undefined,
    isExecutable: () => false,
  });
  assert.equal(native, "powershell.exe");
});

test("Windows Terminal toast falls back to OSC once when PowerShell launch fails asynchronously", async () => {
  const writes: string[] = [];
  let errorListener: ((error: Error) => void) | undefined;
  const launch = createOscLauncher({
    environment: { WT_SESSION: "1" },
    write: (value) => writes.push(value),
    resolvePowerShell: () => "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    spawn: () => ({
      once: (_event, listener) => {
        errorListener = listener;
        return undefined;
      },
      unref: () => undefined,
    }),
    warn: () => undefined,
  });

  launch("Pi", "Ready");
  assert.equal(writes.length, 0);
  assert.ok(errorListener);

  errorListener!(new Error("ENOENT powershell"));
  assert.equal(writes.length, 1);
  assert.match(writes[0] ?? "", /\x1b\]777;notify;Pi;Ready\x07/);

  errorListener!(new Error("second error"));
  assert.equal(writes.length, 1);
});

test("Windows Terminal toast shared fallback gate fires once when unref throws then child errors", () => {
  const writes: string[] = [];
  const warnings: string[] = [];
  let errorListener: ((error: Error) => void) | undefined;
  const launch = createOscLauncher({
    environment: { WT_SESSION: "1" },
    write: (value) => writes.push(value),
    resolvePowerShell: () => "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    spawn: () => ({
      once: (_event, listener) => {
        errorListener = listener;
        return undefined;
      },
      unref: () => {
        throw new Error("unref failed");
      },
    }),
    warn: (message) => warnings.push(message),
  });

  launch("Pi", "Ready");
  assert.equal(writes.length, 1);
  assert.equal(warnings.length, 1);
  assert.ok(errorListener);
  errorListener!(new Error("later async error"));
  assert.equal(writes.length, 1);
  assert.equal(warnings.length, 1);
});

test("Windows Terminal toast falls back immediately when PowerShell is unavailable", () => {
  const writes: string[] = [];
  const launch = createOscLauncher({
    environment: { WT_SESSION: "1", KITTY_WINDOW_ID: "1" },
    write: (value) => writes.push(value),
    resolvePowerShell: () => undefined,
    spawn: () => {
      throw new Error("spawn should not run");
    },
    warn: () => undefined,
  });

  launch("Title", "Body");
  assert.equal(writes.length, 2);
  assert.match(writes[0] ?? "", /\]99;/);
});

test("sync structured shell spawn error aggregates; async child error stays warn-only", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      "pi_notify:agent_notify": [
        ["shell:/missing/tool", "--flag"],
        "cmd:after-shell",
      ],
      agent_settled: [["shell:/missing/async", "x"]],
    }),
  );

  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const tools: Array<{ execute: Function }> = [];
  const commands: string[] = [];
  const warnings: string[] = [];
  let asyncListener: ((error: Error) => void) | undefined;

  const shellLaunch = createShellLauncher({
    inheritedEnvironment: { PATH: "/bin" },
    spawn: (executable) => {
      if (executable === "/missing/tool") {
        throw new Error("spawn ENOENT sync");
      }
      return {
        once: (_event, listener) => {
          asyncListener = listener;
          return undefined;
        },
        unref: () => undefined,
      };
    },
    warn: (message) => warnings.push(message),
  });

  registerExtension(
    {
      on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
      registerTool: (tool: any) => tools.push(tool),
    } as any,
    {
      agentDir,
      launchOsc: () => undefined,
      launchCommand: (command) => commands.push(command),
      launchShell: shellLaunch,
      warn: (message) => warnings.push(message),
    },
  );

  await handlers.get("session_start")?.({ type: "session_start" }, makeCtx(cwd));
  await assert.rejects(
    () => tools[0]!.execute("call-shell", { title: "T", content: "C" }, undefined, undefined, makeCtx(cwd)),
    (error: Error) => {
      assert.match(error.message, /pi-notify action failures/);
      assert.match(error.message, /spawn ENOENT sync/);
      return true;
    },
  );
  assert.deepEqual(commands, ["after-shell"]);

  const beforeAsync = warnings.length;
  await handlers.get("agent_settled")?.({ type: "agent_settled" }, makeCtx(cwd));
  assert.ok(asyncListener);
  asyncListener!(new Error("async child failed"));
  assert.ok(warnings.slice(beforeAsync).some((entry) => entry.includes("async child failed")));
  assert.ok(!warnings.slice(beforeAsync).some((entry) => entry.includes("pi-notify action failures")));
});

test("synchronous OSC failure participates in agent_notify aggregate while later action runs", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      "pi_notify:agent_notify": ["osc", "cmd:after-osc"],
    }),
  );

  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const tools: Array<{ execute: Function }> = [];
  const commands: string[] = [];
  registerExtension(
    {
      on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
      registerTool: (tool: any) => tools.push(tool),
    } as any,
    {
      agentDir,
      launchOsc: () => {
        throw new Error("stdout write failed");
      },
      launchCommand: (command) => commands.push(command),
      launchShell: () => undefined,
      warn: () => undefined,
    },
  );

  await handlers.get("session_start")?.({ type: "session_start" }, makeCtx(cwd));
  await assert.rejects(
    () => tools[0]!.execute("call-osc", { title: "T", content: "C" }, undefined, undefined, makeCtx(cwd)),
    (error: Error) => {
      assert.match(error.message, /pi-notify action failures/);
      assert.match(error.message, /stdout write failed/);
      return true;
    },
  );
  assert.deepEqual(commands, ["after-osc"]);
});

test("WT toast unref fallback write throw aggregates in agent_notify; later child error does not re-fallback", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      "pi_notify:agent_notify": ["osc", "cmd:after-fallback"],
    }),
  );

  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const tools: Array<{ execute: Function }> = [];
  const commands: string[] = [];
  const warnings: string[] = [];
  let errorListener: ((error: Error) => void) | undefined;
  let writeAttempts = 0;

  const launchOsc = createOscLauncher({
    environment: { WT_SESSION: "1" },
    write: () => {
      writeAttempts += 1;
      throw new Error("fallback stdout failed");
    },
    resolvePowerShell: () => "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    spawn: () => ({
      once: (_event, listener) => {
        errorListener = listener;
        return undefined;
      },
      unref: () => {
        throw new Error("unref failed");
      },
    }),
    warn: (message) => warnings.push(message),
  });

  registerExtension(
    {
      on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
      registerTool: (tool: any) => tools.push(tool),
    } as any,
    {
      agentDir,
      launchOsc,
      launchCommand: (command) => commands.push(command),
      launchShell: () => undefined,
      warn: (message) => warnings.push(message),
    },
  );

  await handlers.get("session_start")?.({ type: "session_start" }, makeCtx(cwd));
  await assert.rejects(
    () =>
      tools[0]!.execute(
        "call-wt-fallback",
        { title: "T", content: "C" },
        undefined,
        undefined,
        makeCtx(cwd),
      ),
    (error: Error) => {
      assert.match(error.message, /pi-notify action failures/);
      assert.match(error.message, /fallback stdout failed/);
      return true;
    },
  );
  assert.deepEqual(commands, ["after-fallback"]);
  assert.equal(writeAttempts, 1);
  assert.ok(errorListener);

  const warningsBeforeChildError = warnings.length;
  errorListener!(new Error("later async child error"));
  assert.equal(writeAttempts, 1);
  assert.equal(warnings.length, warningsBeforeChildError);
  assert.ok(!warnings.some((entry) => entry.includes("later async child error")));
});

test("awaited js action receives pi, ctx, full event, notification and later actions continue after throw", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      "tool_execution_start:ask_user_question": ["js:seen", "cmd:after"],
    }),
  );

  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const launches: string[] = [];
  const seen: Array<{ pi: unknown; ctx: unknown; event: unknown; notification: unknown }> = [];
  const runtime: NotificationRuntime = {
    agentDir,
    launchOsc: () => undefined,
    launchCommand: (command) => launches.push(command),
    launchShell: () => undefined,
    runJs: async (_code, scope) => {
      seen.push(scope);
      throw new Error("intentional");
    },
    warn: () => undefined,
  };
  const pi = {
    on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
    registerTool: () => undefined,
    marker: "pi-object",
  } as any;

  registerExtension(pi, runtime);
  const event = {
    type: "tool_execution_start",
    toolName: "ask_user_question",
    toolCallId: "call-q",
    args: { questions: [{ question: "secret" }] },
  };
  const ctx = makeCtx(cwd);
  await handlers.get("tool_execution_start")?.(event, ctx);

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.pi, pi);
  assert.equal(seen[0]?.ctx, ctx);
  assert.deepEqual(seen[0]?.event, event);
  assert.equal((seen[0]?.notification as any).event, "tool_execution_start:ask_user_question");
  assert.equal((seen[0]?.notification as any).tool, "ask_user_question");
  assert.equal(launches[0], "after");
});

test("missing empty or all-invalid agent_notify hook does not register the tool", async () => {
  const cases = [
    {},
    { "pi_notify:agent_notify": [] },
    { "pi_notify:agent_notify": ["cmd:", "js:", "shell:", ["shell:/bin/bash"], ["shell:", "x"]] },
  ];

  for (const document of cases) {
    const { agentDir, cwd } = await fixture();
    await writeFile(join(agentDir, "pi-notify.json"), JSON.stringify(document));
    const registered: string[] = [];
    const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
    const pi = {
      on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
      registerTool: (tool: { name: string }) => registered.push(tool.name),
    } as any;
    registerExtension(pi, {
      agentDir,
      launchOsc: () => undefined,
      launchCommand: () => undefined,
      launchShell: () => undefined,
      warn: () => undefined,
    });
    await handlers.get("session_start")?.({ type: "session_start" }, makeCtx(cwd));
    assert.deepEqual(registered, []);
  }
});

test("valid agent_notify hook registers once with title/content schema and TITLE/CONTENT context", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      "pi_notify:agent_notify": [
        "osc",
        "osc:Title {{TITLE}}|Body {{CONTENT}}",
        ["shell:/usr/bin/env", "echo", "$PI_NOTIFY_TITLE"],
        "js:capture",
      ],
    }),
  );

  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const tools: Array<{ name: string; description: string; promptSnippet?: string; parameters: any; execute: Function }> =
    [];
  const launches: Array<{
    type: string;
    value?: string;
    executable?: string;
    args?: string[];
    env?: Record<string, string>;
  }> = [];
  const jsScopes: any[] = [];
  const runtime: NotificationRuntime = {
    agentDir,
    launchOsc: (title, body) => launches.push({ type: "osc", value: `${title}|${body}` }),
    launchCommand: (command, _cwd, env) => launches.push({ type: "cmd", value: command, env }),
    launchShell: (executable, args, _cwd, env) => launches.push({ type: "shell", executable, args: [...args], env }),
    runJs: async (_code, scope) => {
      jsScopes.push(scope);
    },
    warn: () => undefined,
  };
  const pi = {
    on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
    registerTool: (tool: any) => tools.push(tool),
  } as any;

  registerExtension(pi, runtime);
  const ctx = makeCtx(cwd);
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);

  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.name, "agent_notify");
  assert.match(tools[0]?.description ?? "", /external notification/i);
  assert.match(tools[0]?.promptSnippet ?? "", /titled notification/i);
  assert.ok(tools[0]?.parameters.properties.title);
  assert.ok(tools[0]?.parameters.properties.content);
  assert.deepEqual(tools[0]?.parameters.required ?? Object.keys(tools[0]?.parameters.properties ?? {}), [
    "title",
    "content",
  ]);

  const result = await tools[0]!.execute("call-1", { title: "Ship", content: "Ready" }, undefined, undefined, ctx);
  assert.match(String(result.content[0].text), /Notification sent/);

  assert.deepEqual(
    launches.filter((entry) => entry.type === "osc").map((entry) => entry.value),
    ["Ship|Ready", "Title Ship|Body Ready"],
  );

  const shell = launches.find((entry) => entry.type === "shell");
  assert.equal(shell?.executable, "/usr/bin/env");
  assert.deepEqual(shell?.args, ["echo", "$PI_NOTIFY_TITLE"]);
  assert.equal(shell?.env?.PI_NOTIFY_TITLE, "Ship");
  assert.equal(shell?.env?.PI_NOTIFY_CONTENT, "Ready");
  assert.equal(shell?.env?.PI_NOTIFY_EVENT, "pi_notify:agent_notify");

  assert.equal(jsScopes.length, 1);
  assert.equal(jsScopes[0].notification.title, "Ship");
  assert.equal(jsScopes[0].notification.content, "Ready");
  assert.equal(jsScopes[0].event.toolName, "agent_notify");
  assert.deepEqual(jsScopes[0].event.args, { title: "Ship", content: "Ready" });
});

test("agent_notify attempts all actions and throws one aggregate error on failures", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      "pi_notify:agent_notify": ["js:one", "cmd:two", "js:three"],
    }),
  );

  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const tools: Array<{ execute: Function }> = [];
  const commands: string[] = [];
  const runtime: NotificationRuntime = {
    agentDir,
    launchOsc: () => undefined,
    launchCommand: (command) => {
      commands.push(command);
      throw new Error("cmd launch failed");
    },
    launchShell: () => undefined,
    runJs: async (code) => {
      throw new Error(`js failed ${code}`);
    },
    warn: () => undefined,
  };
  const pi = {
    on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
    registerTool: (tool: any) => tools.push(tool),
  } as any;

  registerExtension(pi, runtime);
  await handlers.get("session_start")?.({ type: "session_start" }, makeCtx(cwd));

  await assert.rejects(
    () => tools[0]!.execute("call-2", { title: "T", content: "C" }, undefined, undefined, makeCtx(cwd)),
    (error: Error) => {
      assert.match(error.message, /pi-notify action failures/);
      assert.match(error.message, /js failed js:one|js failed one/);
      assert.match(error.message, /cmd launch failed/);
      assert.match(error.message, /js failed js:three|js failed three/);
      return true;
    },
  );
  assert.deepEqual(commands, ["two"]);
});

test("lifecycle hooks never throw into Pi when actions fail", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({ agent_settled: ["js:boom", "cmd:still-runs"] }),
  );

  const handlers = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  const commands: string[] = [];
  const warnings: string[] = [];
  registerExtension(
    {
      on: (event: string, handler: (event: any, ctx: any) => void | Promise<void>) => handlers.set(event, handler),
      registerTool: () => undefined,
    } as any,
    {
      agentDir,
      launchOsc: () => undefined,
      launchCommand: (command) => commands.push(command),
      launchShell: () => undefined,
      runJs: async () => {
        throw new Error("boom");
      },
      warn: (message) => warnings.push(message),
    },
  );

  await handlers.get("agent_settled")?.({ type: "agent_settled" }, makeCtx(cwd));
  assert.deepEqual(commands, ["still-runs"]);
  assert.ok(warnings.length > 0);
});

test("TITLE and CONTENT templates render only when provided", () => {
  assert.equal(renderTemplate("{{TITLE}} / {{CONTENT}} / {{TOOL}}", { TITLE: "A", CONTENT: "B" }), "A / B / {{TOOL}}");
});
