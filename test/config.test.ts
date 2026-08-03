import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";

async function fixture(): Promise<{ agentDir: string; cwd: string }> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "pi-notify-")));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  return { agentDir, cwd };
}

test("project bindings replace matching global bindings in trusted projects", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      events: {
        agent_settled: { actions: ["osc"] },
        "tool_execution_start:ask_user_question": { actions: ["cmd:global-question"] },
      },
    }),
  );
  await writeFile(
    join(cwd, ".pi", "pi-notify.json"),
    JSON.stringify({
      events: {
        agent_settled: { actions: ["cmd:project-idle"] },
      },
    }),
  );

  const warnings: string[] = [];
  const config = await loadConfig({ agentDir, cwd, projectTrusted: true, warn: (message) => warnings.push(message) });

  assert.deepEqual(config.events.agent_settled, { delayMs: 0, actions: ["cmd:project-idle"] });
  assert.deepEqual(config.events["tool_execution_start:ask_user_question"], {
    delayMs: 0,
    actions: ["cmd:global-question"],
  });
  assert.deepEqual(warnings, []);
});

test("untrusted projects cannot contribute bindings", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({ events: { agent_settled: { actions: ["osc"] } } }),
  );
  await writeFile(
    join(cwd, ".pi", "pi-notify.json"),
    JSON.stringify({ events: { agent_settled: { actions: ["cmd:untrusted"] } } }),
  );

  const config = await loadConfig({ agentDir, cwd, projectTrusted: false, warn: () => undefined });

  assert.deepEqual(config.events.agent_settled, { delayMs: 0, actions: ["osc"] });
});

test("invalid keys and actions are warned about and ignored; legacy top-level migrates once", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      events: {
        agent_settled: { actions: ["osc", "cmd:", "email"] },
        agent_end: { actions: ["osc"] },
      },
      agent_settled: ["osc"],
    }),
  );

  const warnings: string[] = [];
  const config = await loadConfig({ agentDir, cwd, projectTrusted: false, warn: (message) => warnings.push(message) });

  assert.deepEqual(config.events.agent_settled, { delayMs: 0, actions: ["osc"] });
  assert.ok(warnings.some((entry) => /legacy top-level/i.test(entry)));
  assert.ok(warnings.some((entry) => entry.includes("agent_end") || entry.includes("unsupported event")));
  assert.ok(warnings.some((entry) => entry.includes("cmd:") || entry.includes("email")));
});

test("explicit empty actions disables; all-rejected project binding preserves global; mixed keeps valid", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      events: {
        agent_settled: { actions: ["cmd:global-settled"] },
      },
      hooks: {
        "user-ready": { actions: ["cmd:global-ready"] },
        mixed: { actions: ["cmd:global-mixed"] },
      },
    }),
  );
  await writeFile(
    join(cwd, ".pi", "pi-notify.json"),
    JSON.stringify({
      events: {
        agent_settled: { actions: [] },
      },
      hooks: {
        "user-ready": { actions: ["osc"] },
        mixed: { actions: ["osc", "cmd:keep", "email"] },
      },
    }),
  );

  const warnings: string[] = [];
  const config = await loadConfig({
    agentDir,
    cwd,
    projectTrusted: true,
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(config.events.agent_settled, { delayMs: 0, actions: [] });
  assert.deepEqual(config.hooks["user-ready"], { delayMs: 0, actions: ["cmd:global-ready"] });
  assert.deepEqual(config.hooks.mixed, { delayMs: 0, actions: ["cmd:keep"] });
  assert.ok(warnings.some((entry) => /bare osc/i.test(entry)));
  assert.ok(warnings.some((entry) => /no valid actions after validation/i.test(entry)));
  assert.ok(warnings.some((entry) => entry.includes("email")));
});

test("hooks map is null-prototype and constructor lookup is own-property only", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      hooks: {
        constructor: { actions: ["cmd:ctor"] },
      },
    }),
  );

  const config = await loadConfig({
    agentDir,
    cwd,
    projectTrusted: false,
    warn: () => undefined,
  });

  assert.equal(Object.getPrototypeOf(config.hooks), null);
  assert.equal(Object.hasOwn(config.hooks, "constructor"), true);
  assert.deepEqual(config.hooks.constructor, { delayMs: 0, actions: ["cmd:ctor"] });

  const empty = await loadConfig({
    agentDir: join(agentDir, "missing-agent"),
    cwd,
    projectTrusted: false,
    warn: () => undefined,
  });
  assert.equal(Object.getPrototypeOf(empty.hooks), null);
  assert.equal(Object.hasOwn(empty.hooks, "constructor"), false);
  assert.equal(empty.hooks.constructor, undefined);
});

test("bound diagnostics clip large invalid names/actions without throwing", async () => {
  const { agentDir, cwd } = await fixture();
  const hugeName = `bad-${"a".repeat(500)}`;
  const hugeAction = `cmd:${"x".repeat(20_000)}`;
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      hooks: {
        [hugeName]: { actions: ["cmd:ok"] },
        "user-ready": { actions: [hugeAction, "cmd:keep"] },
      },
    }),
  );

  const warnings: string[] = [];
  const config = await loadConfig({
    agentDir,
    cwd,
    projectTrusted: false,
    warn: (message) => warnings.push(message),
  });

  assert.equal(config.hooks[hugeName], undefined);
  assert.deepEqual(config.hooks["user-ready"], { delayMs: 0, actions: ["cmd:keep"] });
  assert.ok(warnings.every((entry) => entry.length < 2_000));
  assert.ok(warnings.some((entry) => entry.includes("…") || entry.includes("invalid hook name")));
});
