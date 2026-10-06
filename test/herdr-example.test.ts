import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runActions } from "../src/actions.js";
import { createCommandLauncher } from "../src/command.js";
import { loadConfig } from "../src/config.js";

// Run the documented actions against a fake CLI, never the user's Herdr session.
test("Herdr recipe preserves existing actions and reports source only inside Herdr", async () => {
  const doc = await readFile(new URL("../example/pi-notify-herdr.md", import.meta.url), "utf8");
  const json = doc.match(/```json\n([\s\S]*?)\n```/)?.[1];
  assert.ok(json, "recipe has a complete JSON configuration");
  const root = await mkdtemp(join(tmpdir(), "pi-notify-herdr-"));
  await writeFile(join(root, "pi-notify.json"), json);
  const output = join(root, "calls.jsonl");
  await writeFile(join(root, "herdr"), `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.HERDR_TEST_OUTPUT, JSON.stringify(process.argv.slice(2)) + '\\n');\n`, { mode: 0o700 });
  const warnings: string[] = [];
  const config = await loadConfig({ agentDir: root, cwd: root, projectTrusted: false, warn: (message) => warnings.push(message) });
  assert.deepEqual(warnings, []);
  const bindings = [...Object.entries(config.events), ...Object.entries(config.hooks)];
  assert.equal(bindings.length, 5);
  const sessionId = 'session "quoted"; $(printf injected)';
  let calls = 0;
  let originalActions = 0;
  for (const herdrEnv of ["", "0", "1"]) {
    for (const [key, binding] of bindings) {
      assert.ok(binding);
      const hook = key === "tool_execution_start:ask_user_question" ? undefined : key;
      const event = hook ? `hook:${hook}` : key;
      const inheritedEnvironment = {
        PATH: `${root}:/usr/bin:/bin`,
        HERDR_ENV: herdrEnv,
        HERDR_TAB_ID: "w1:t2",
        HERDR_PANE_ID: "w1:p3",
        HERDR_TEST_OUTPUT: output,
        PI_NOTIFY_SESSION_ID: "stale-session",
        PI_NOTIFY_HOOK: "stale-hook",
      };
      const launchCommand = createCommandLauncher({
        inheritedEnvironment,
        warn: assert.fail,
        spawn(command, options) {
          const result = spawnSync(command, { cwd: options.cwd, env: options.env, shell: options.shell, encoding: "utf8", timeout: 5000 });
          assert.equal(result.status, 0, result.stderr || result.error?.message || "command failed");
          return { once() {}, unref() {} };
        },
      });
      for (const silent of [false, true]) {
        // Existing WAIT_CALLBACK and incomplete-reflection cases stay silent.
        if (silent && key !== "user-ready" && key !== "reflection-completed") continue;
        let commands = 0;
        const beforeOriginal = originalActions;
        await runActions({
          key,
          actions: binding.actions,
          condition: binding.if,
          pi: {} as any,
          ctx: {} as any,
          event: {},
          notification: {
            event, hook, cwd: root, sessionId,
            values: {
              TITLE: "Test", CONTENT: "Body", STOP_KIND: "AI_UNLOCK",
              REASON_TYPE: silent ? "WAIT_CALLBACK" : "JOB_DONE",
              REFLECTION_TYPE: "NO_ISSUE", REASON: "Done",
              NEXT_STEP: silent ? " \n\t " : "Wait for input",
            },
          },
          runtime: {
            launchBel: () => { originalActions++; },
            launchOsc: () => { originalActions++; },
            launchCommand: (...args) => { commands++; launchCommand(...args); },
            launchShell: assert.fail,
            warn: assert.fail,
          },
          throwOnFailure: true,
        });
        assert.equal(commands, silent ? 0 : 1);
        assert.equal(originalActions - beforeOriginal, silent ? 0 : 2);
        if (herdrEnv === "1" && !silent) {
          const lines = (await readFile(output, "utf8")).trim().split("\n");
          assert.equal(lines.length, ++calls);
          assert.deepEqual(JSON.parse(lines.at(-1)!), [
            "notification", "show", `Pi ${hook ?? event}`,
            "--body", `tab=w1:t2 pane=w1:p3 session=${sessionId}`,
            "--sound", "none",
          ]);
        } else if (calls === 0) {
          await assert.rejects(readFile(output), { code: "ENOENT" });
        } else {
          assert.equal((await readFile(output, "utf8")).trim().split("\n").length, calls);
        }
      }
    }
  }
  assert.equal(calls, 5);
});
