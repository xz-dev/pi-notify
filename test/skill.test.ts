import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillPath = new URL("../skills/adapt-pi-notify-skill/SKILL.md", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

test("adapt-pi-notify skill is packaged with the accepted neutral-hook contract", async () => {
  const [skill, manifestSource] = await Promise.all([
    readFile(skillPath, "utf8"),
    readFile(packagePath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource) as { files?: string[] };

  assert.equal(skill.startsWith("---\nname: adapt-pi-notify-skill\ndescription: "), true);
  assert.match(skill, /\n---\n\n# Adapt Pi Notify\n/);
  assert.match(skill, /pi:semantic-hook:v1/);
  assert.match(skill, /version: 1/);
  assert.match(skill, /lowercase kebab-case/);
  assert.match(skill, /best-effort to current listeners only/);
  assert.match(skill, /no buffering, replay, acknowledgment, retry, or backpressure/);
  assert.match(skill, /Neither side imports, identifies, queries, requires, acknowledges, or waits for the other/);

  assert.match(skill, /"STOP_KIND": "AI_UNLOCK"/);
  assert.match(skill, /"STOP_KIND": "EXHAUSTED"/);
  assert.match(skill, /"STOP_KIND": "DECISION_FAILED"/);
  assert.match(skill, /Human unlock and user\/manual abort are intentionally silent/);

  assert.match(skill, /delayMs/);
  assert.match(skill, /collect live cwd, session fields, valid Pi context, and inherited process environment/);
  assert.match(skill, /Do not snapshot runtime data, inherited environment, command environment, or rendered strings before the delay/);
  assert.match(skill, /no debounce, de-duplication, coalescing, or latest-event replacement/);
  assert.match(skill, /reload\/shutdown cancels pending timers and advances generation/);

  assert.match(skill, /notification\.values/);
  assert.match(skill, /notification\.osc\("Pi", notification\.values\.REASON\)/);
  assert.match(skill, /notification\.bel\(\)/);
  assert.doesNotMatch(skill, /Planned API/);
  assert.doesNotMatch(skill, /not available in the current pre-neutral-hooks pi-notify runtime/);

  assert.match(skill, /representative acceptance test and run it against the baseline to prove RED/);
  assert.match(skill, /fresh isolated Pi process/);
  assert.match(skill, /Do not reuse or reload the user's current Pi session/);
  assert.match(skill, /Back up protected config with mode\/owner\/hash/);
  assert.match(skill, /update Git packages through Pi CLI/);

  assert.equal(manifest.files?.includes("skills"), true);
  assert.equal(manifest.files?.includes("example"), true);
});
