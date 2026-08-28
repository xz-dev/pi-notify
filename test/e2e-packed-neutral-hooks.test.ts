import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createEventBus,
  createExtensionRuntime,
  DefaultResourceLoader,
  discoverAndLoadExtensions,
  ExtensionRunner,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

/**
 * Packed E2E using only public stock Pi SDK exports.
 *
 * Supported mechanisms:
 * - npm pack + isolated npm install of the package tarball
 * - createEventBus shared by discoverAndLoadExtensions
 * - discoverAndLoadExtensions for packed pi-notify + independent producer path
 * - ExtensionRunner.emit for session_start / session_shutdown / agent_settled
 * - DefaultResourceLoader.reload + settings packages for conventional package skill discovery
 *
 * Documented limits (not faked):
 * - Does not spawn the interactive `pi` TUI process.
 * - ResourceLoader.reload() reloads package resources/modules; Pi modes own the
 *   surrounding session_shutdown → reload → session_start sequence. This test
 *   exercises those public pieces in the same order.
 * - Packed extension uses default runtime; PI_CODING_AGENT_DIR points at the fixture agentDir.
 */

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface PackedFixture {
  root: string;
  agentDir: string;
  cwd: string;
  packageDir: string;
  utilityPackageDir: string;
  producerPath: string;
  markerPath: string;
}

function bindRunner(runner: ExtensionRunner): void {
  runner.bindCore(
    {
      sendMessage() {},
      sendUserMessage() {},
      appendEntry() {},
      setSessionName() {},
      getSessionName() {},
      setLabel() {},
      getActiveTools: () => [],
      getAllTools: () => [],
      setActiveTools() {},
      refreshTools() {},
      getCommands: () => [],
      setModel: async () => true,
      getThinkingLevel: () => "off",
      setThinkingLevel() {},
    } as never,
    {
      getModel: () => undefined,
      getScopedModels: () => [],
      isIdle: () => true,
      isProjectTrusted: () => true,
      getSignal: () => undefined,
      abort() {},
      hasPendingMessages: () => false,
      shutdown() {},
      getContextUsage: () => undefined,
      compact() {},
      getSystemPrompt: () => "",
    } as never,
  );
}

async function makePackedFixture(): Promise<PackedFixture> {
  const root = await mkdtemp(join(tmpdir(), "pi-notify-e2e-"));
  const packDir = join(root, "pack");
  const agentDir = join(root, "home", ".pi", "agent");
  const cwd = join(root, "project");
  const installRoot = join(root, "install");
  await Promise.all([
    mkdir(packDir, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
    mkdir(join(cwd, ".pi"), { recursive: true }),
    mkdir(installRoot, { recursive: true }),
  ]);

  const { stdout } = await execFileAsync("npm", ["pack", "--pack-destination", packDir], {
    cwd: repoRoot,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  const tarballName = stdout.trim().split("\n").at(-1) ?? "";
  const tarball = join(packDir, tarballName);
  await execFileAsync("npm", ["init", "-y"], { cwd: installRoot, timeout: 30_000 });
  const utilityTarball = process.env.PI_EXTENSION_UTILS_E2E_TARBALL;
  if (utilityTarball) {
    const installManifestPath = join(installRoot, "package.json");
    const installManifest = JSON.parse(await readFile(installManifestPath, "utf8")) as Record<string, unknown>;
    installManifest.overrides = { "pi-extension-utils": utilityTarball };
    await writeFile(installManifestPath, JSON.stringify(installManifest));
  }
  await execFileAsync(
    "npm",
    ["install", "--prefer-offline", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    { cwd: installRoot, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
  );

  const manifest = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
    name: string;
    pi?: { extensions?: string[]; skills?: string[] };
  };
  const packageDir = join(installRoot, "node_modules", manifest.name);
  const utilityPackageDir = join(installRoot, "node_modules", "pi-extension-utils");
  assert.equal((await lstat(utilityPackageDir)).isSymbolicLink(), false);
  const installedUtilityManifest = JSON.parse(
    await readFile(join(utilityPackageDir, "package.json"), "utf8"),
  ) as { exports?: Record<string, unknown> };
  assert.ok(installedUtilityManifest.exports?.["./semantic-hook"]);
  const inventory = await readdir(packageDir);
  assert.equal(inventory.includes("index.ts"), true);
  assert.equal(inventory.includes("src"), true);
  assert.equal(inventory.includes("skills"), true);
  assert.equal(inventory.includes("test"), false);
  assert.deepEqual(manifest.pi?.skills, ["./skills"]);

  const markerPath = join(root, "marker.jsonl");
  const producerPath = join(installRoot, "neutral-producer.mjs");
  await writeFile(
    producerPath,
    `import { publishSemanticHook } from "pi-extension-utils/semantic-hook";
export default function registerProducer(pi) {
  let emissions = 0;
  pi.on("session_start", () => {
    setTimeout(() => {
      emissions += 1;
      publishSemanticHook(pi.events, {
        name: "build-finished",
        values: {
          RESULT: "SUCCESS",
          BUILD_ID: "e2e-" + emissions,
        },
      });
    }, 25);
  });
}
`,
  );

  // Write markers via process.getBuiltinModule('fs') so js: works under Pi's jiti loader
  // without dynamic import (which jiti rejects). Avoid nested quote/newline escapes.
  const writeHookJs =
    "js:const fs=process.getBuiltinModule('fs');" +
    `fs.appendFileSync(${JSON.stringify(markerPath)},` +
    "JSON.stringify({kind:'hook',event:notification.event,hook:notification.hook," +
    "result:notification.values.RESULT,buildId:notification.values.BUILD_ID," +
    "cwd:notification.cwd,live:process.env.E2E_NOTIFY_LIVE||null," +
    "hasOsc:typeof notification.osc==='function'})+String.fromCharCode(10))";
  const writeSettledJs =
    "js:const fs=process.getBuiltinModule('fs');" +
    `fs.appendFileSync(${JSON.stringify(markerPath)},` +
    "JSON.stringify({kind:'settled',cwd:notification.cwd," +
    "live:process.env.E2E_NOTIFY_LIVE||null})+String.fromCharCode(10))";
  await writeFile(
    join(agentDir, "pi-notify.json"),
    JSON.stringify({
      events: {
        agent_settled: {
          delayMs: 0,
          actions: [writeSettledJs],
        },
      },
      hooks: {
        "build-finished": {
          delayMs: 60,
          actions: [writeHookJs, "osc:Build|{{RESULT}}"],
        },
      },
    }),
  );

  // Conventional package install entry for DefaultResourceLoader / package manager skill discovery.
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      packages: [packageDir],
      defaultProjectTrust: "always",
    }),
  );

  return { root, agentDir, cwd, packageDir, utilityPackageDir, producerPath, markerPath };
}

async function readMarkers(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test(
  "packed+isolated stock Pi: discoverAndLoadExtensions, shared EventBus, mode-ordered reload, package skills",
  { timeout: 180_000 },
  async () => {
    const fixture = await makePackedFixture();
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = fixture.agentDir;
    try {
      // --- Conventional package skill discovery through public DefaultResourceLoader ---
      const settingsManager = SettingsManager.create(fixture.cwd, fixture.agentDir);
      settingsManager.setProjectTrusted(true);
      const skillLoader = new DefaultResourceLoader({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        settingsManager,
        eventBus: createEventBus(),
        noExtensions: true,
      });
      await skillLoader.reload();
      const skills = skillLoader.getSkills().skills;
      assert.ok(
        skills.some((skill) => skill.name === "adapt-pi-notify-skill"),
        `expected adapt-pi-notify-skill via package discovery, got ${skills.map((s) => s.name).join(",") || "(none)"}`,
      );
      const skillBody = await readFile(
        join(fixture.packageDir, "skills", "adapt-pi-notify-skill", "SKILL.md"),
        "utf8",
      );
      assert.match(skillBody, /pi:semantic-hook:v1/);
      assert.equal(
        await readFile(join(fixture.utilityPackageDir, "dist", "semantic-hook.js"), "utf8").then(
          (source) =>
            source.includes("function publishSemanticHook") &&
            source.includes("function subscribeSemanticHooks"),
        ),
        true,
        "isolated fixture must use packed pi-extension-utils semantic-hook implementation",
      );

      // --- Shared EventBus + public discoverAndLoadExtensions for packed notify + independent producer ---
      const bus = createEventBus();
      const loaded = await discoverAndLoadExtensions(
        [fixture.packageDir, fixture.producerPath],
        fixture.cwd,
        fixture.agentDir,
        bus,
      );
      assert.equal(loaded.errors.length, 0, JSON.stringify(loaded.errors));
      assert.ok(loaded.extensions.length >= 2, `expected notify+producer, got ${loaded.extensions.length}`);

      const sessionManager = {
        getSessionId: () => "e2e-session",
        getSessionFile: () => "/tmp/e2e-session.jsonl",
      };
      const runner = new ExtensionRunner(
        loaded.extensions,
        loaded.runtime ?? createExtensionRuntime(),
        fixture.cwd,
        sessionManager as never,
        {} as never,
      );
      bindRunner(runner);

      process.env.E2E_NOTIFY_LIVE = "live-after-delay";
      await runner.emit({ type: "session_start" } as never);
      await new Promise((r) => setTimeout(r, 300));

      const first = await readMarkers(fixture.markerPath);
      assert.ok(first.length >= 1, `missing first hook marker: ${JSON.stringify(first)}`);
      const hook1 = first.at(-1)!;
      assert.equal(hook1.kind, "hook");
      assert.equal(hook1.result, "SUCCESS");
      assert.equal(hook1.live, "live-after-delay");
      assert.equal(hook1.event, "hook:build-finished");
      assert.equal(hook1.hook, "build-finished");
      assert.equal(hook1.hasOsc, true);

      // Mode-owned shutdown before reload: public ExtensionRunner.emit(session_shutdown).
      await runner.emit({ type: "session_shutdown", reason: "test-reload" } as never);
      process.env.E2E_NOTIFY_LIVE = "after-shutdown";
      bus.emit("pi:semantic-hook:v1", {
        version: 1,
        name: "build-finished",
        values: { RESULT: "LATE" },
      });
      await new Promise((r) => setTimeout(r, 200));
      const afterShutdown = await readMarkers(fixture.markerPath);
      assert.equal(
        afterShutdown.some((row) => row.result === "LATE"),
        false,
        "late emit after shutdown must not run consumer actions",
      );

      // Public resource reload (skills still present) + fresh extension load on a cleared bus.
      await skillLoader.reload();
      assert.ok(
        skillLoader.getSkills().skills.some((skill) => skill.name === "adapt-pi-notify-skill"),
      );
      if (typeof (bus as { clear?: () => void }).clear === "function") {
        (bus as { clear: () => void }).clear();
      }

      const reloaded = await discoverAndLoadExtensions(
        [fixture.packageDir, fixture.producerPath],
        fixture.cwd,
        fixture.agentDir,
        bus,
      );
      assert.equal(reloaded.errors.length, 0, JSON.stringify(reloaded.errors));
      const reloadedRunner = new ExtensionRunner(
        reloaded.extensions,
        reloaded.runtime ?? createExtensionRuntime(),
        fixture.cwd,
        {
          getSessionId: () => "e2e-session-2",
          getSessionFile: () => "/tmp/e2e-session-2.jsonl",
        } as never,
        {} as never,
      );
      bindRunner(reloadedRunner);

      await writeFile(fixture.markerPath, "");
      process.env.E2E_NOTIFY_LIVE = "post-reload";
      await reloadedRunner.emit({ type: "session_start" } as never);
      await new Promise((r) => setTimeout(r, 300));

      const postReload = await readMarkers(fixture.markerPath);
      assert.equal(
        postReload.length,
        1,
        `expected exactly one post-reload hook emission, got ${postReload.length}: ${JSON.stringify(postReload)}`,
      );
      assert.equal(postReload[0]?.kind, "hook");
      assert.equal(postReload[0]?.result, "SUCCESS");
      assert.equal(postReload[0]?.live, "post-reload");
      assert.equal(postReload[0]?.buildId, "e2e-1");

      await writeFile(fixture.markerPath, "");
      process.env.E2E_NOTIFY_LIVE = "settled-live";
      await reloadedRunner.emit({ type: "agent_settled" } as never);
      await new Promise((r) => setTimeout(r, 100));
      const settled = (await readMarkers(fixture.markerPath)).find((row) => row.kind === "settled");
      assert.ok(settled);
      assert.equal(settled.live, "settled-live");
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      delete process.env.E2E_NOTIFY_LIVE;
      await rm(fixture.root, { recursive: true, force: true });
    }
  },
);
