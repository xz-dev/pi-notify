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

test("project actions replace matching global actions in trusted projects", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      agent_settled: ["osc"],
      "tool_execution_start:ask_user_question": ["cmd:global-question"],
    }),
  );
  await writeFile(
    join(cwd, ".pi", "pi-notify.json"),
    JSON.stringify({ agent_settled: ["cmd:project-idle"] }),
  );

  const warnings: string[] = [];
  const config = await loadConfig({ agentDir, cwd, projectTrusted: true, warn: (message) => warnings.push(message) });

  assert.deepEqual(config, {
    agent_settled: ["cmd:project-idle"],
    "tool_execution_start:ask_user_question": ["cmd:global-question"],
  });
  assert.deepEqual(warnings, []);
});

test("untrusted projects cannot contribute command actions", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(join(agentDir, "pi-notify.json"), JSON.stringify({ agent_settled: ["osc"] }));
  await writeFile(join(cwd, ".pi", "pi-notify.json"), JSON.stringify({ agent_settled: ["cmd:untrusted"] }));

  const config = await loadConfig({ agentDir, cwd, projectTrusted: false, warn: () => undefined });

  assert.deepEqual(config, { agent_settled: ["osc"] });
});

test("invalid keys and actions are warned about and ignored", async () => {
  const { agentDir, cwd } = await fixture();
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      agent_settled: ["osc", "cmd:", "email"],
      agent_end: ["osc"],
    }),
  );

  const warnings: string[] = [];
  const config = await loadConfig({ agentDir, cwd, projectTrusted: false, warn: (message) => warnings.push(message) });

  assert.deepEqual(config, { agent_settled: ["osc"] });
  assert.equal(warnings.length, 3);
});
