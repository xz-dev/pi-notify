import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const helperUrl = new URL("../example/pi-notify-ntfy.mjs", import.meta.url);

interface NtfyRequest {
  topic?: string;
  title?: string;
  message?: string;
  tags?: string[];
}

async function helperSource(endpoint: string): Promise<string> {
  return (await readFile(helperUrl, "utf8")).replace("https://ntfy.sh/YOUR_PRIVATE_TOPIC", endpoint);
}

test("ntfy companion publishes multilingual title and body as UTF-8 JSON", async () => {
  let requestPath: string | undefined;
  let contentType: string | undefined;
  let requestBody: string | undefined;
  let resolveRequest!: () => void;
  const received = new Promise<void>((resolve) => {
    resolveRequest = resolve;
  });
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requestPath = request.url;
      contentType = request.headers["content-type"];
      requestBody = Buffer.concat(chunks).toString("utf8");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"id":"accepted"}');
      resolveRequest();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const root = await mkdtemp(join(tmpdir(), "pi-notify-ntfy-test-"));
  const helperPath = join(root, "pi-notify-ntfy.mjs");
  await writeFile(helperPath, await helperSource(`http://127.0.0.1:${address.port}/test-topic`));

  try {
    await execFileAsync(process.execPath, [helperPath, "agent"], {
      env: {
        ...process.env,
        PI_NOTIFY_TITLE: "发布完成 🚀",
        PI_NOTIFY_CONTENT: "构建成功 — Καλημέρα — مرحبًا",
        PI_NOTIFY_HOSTNAME: "工作站",
        PI_NOTIFY_CWD: "/工作/项目",
        PI_NOTIFY_SESSION_ID: "会话-一",
      },
      timeout: 10_000,
    });
    await received;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }

  assert.equal(requestPath, "/");
  assert.equal(contentType, "application/json");
  assert.deepEqual(JSON.parse(requestBody ?? "") as NtfyRequest, {
    topic: "test-topic",
    title: "🤖 发布完成 🚀 · 工作站 · /工作/项目",
    message: "构建成功 — Καλημέρα — مرحبًا\nsession id: 会话-一",
    tags: ["agent", "unknown-host"],
  });
});

test("ntfy companion publishes question text from a body file", async () => {
  let requestBody: string | undefined;
  let resolveRequest!: () => void;
  const received = new Promise<void>((resolve) => {
    resolveRequest = resolve;
  });
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requestBody = Buffer.concat(chunks).toString("utf8");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"id":"accepted"}');
      resolveRequest();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const root = await mkdtemp(join(tmpdir(), "pi-notify-ntfy-question-"));
  const helperPath = join(root, "pi-notify-ntfy.mjs");
  const bodyFile = join(root, "question-body.txt");
  await writeFile(helperPath, await helperSource(`http://127.0.0.1:${address.port}/test-topic`));
  await writeFile(bodyFile, "1. First question?\n2. Second question?");

  try {
    await execFileAsync(process.execPath, [helperPath], {
      env: {
        ...process.env,
        PI_NOTIFY_DELIVERY_MODE: "question",
        PI_NOTIFY_QUESTION_BODY_FILE: bodyFile,
        PI_NOTIFY_HOSTNAME: "workstation",
        PI_NOTIFY_CWD: "/work/project",
        PI_NOTIFY_SESSION_ID: "session-two",
      },
      timeout: 10_000,
    });
    await received;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }

  assert.deepEqual(JSON.parse(requestBody ?? "") as NtfyRequest, {
    topic: "test-topic",
    title: "❓ Pi Question · workstation · /work/project",
    message: "1. First question?\n2. Second question?\nsession id: session-two",
    tags: ["input-required", "workstation"],
  });
});

test("ntfy companion removes the question body file after reading it", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-notify-ntfy-question-cleanup-"));
  const helperPath = join(root, "pi-notify-ntfy.mjs");
  const bodyFile = join(root, "question-body.txt");
  await writeFile(helperPath, await helperSource("https://ntfy.sh/invalid/topic"));
  await writeFile(bodyFile, "question");

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [helperPath], {
        env: {
          ...process.env,
          PI_NOTIFY_DELIVERY_MODE: "question",
          PI_NOTIFY_QUESTION_BODY_FILE: bodyFile,
        },
        timeout: 10_000,
      }),
    );
    await assert.rejects(readFile(bodyFile), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ntfy companion rejects an invalid topic with a controlled diagnostic", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-notify-ntfy-invalid-"));
  const helperPath = join(root, "pi-notify-ntfy.mjs");
  await writeFile(helperPath, await helperSource("https://ntfy.sh/invalid/topic"));

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [helperPath, "agent"], {
        env: {
          ...process.env,
          PI_NOTIFY_TITLE: "title",
          PI_NOTIFY_CONTENT: "content",
        },
        timeout: 10_000,
      }),
      (error: unknown) => {
        const stderr = String((error as { stderr?: string }).stderr ?? "");
        assert.match(stderr, /^\[pi-notify-ntfy\] Cannot publish notification: Invalid ntfy topic/m);
        assert.doesNotMatch(stderr, /at file:|node:internal/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
