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

test("ntfy companion publishes a typed continue notification", async () => {
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
  const root = await mkdtemp(join(tmpdir(), "pi-notify-ntfy-continue-"));
  const helperPath = join(root, "pi-notify-ntfy.mjs");
  await writeFile(helperPath, await helperSource(`http://127.0.0.1:${address.port}/test-topic`));

  try {
    await execFileAsync(process.execPath, [helperPath, "continue"], {
      env: {
        ...process.env,
        PI_NOTIFY_REASON_TYPE: "verifying",
        PI_NOTIFY_REASON: "Tests still need to run.",
        PI_NOTIFY_HOSTNAME: "workstation",
        PI_NOTIFY_CWD: "/work/project",
        PI_NOTIFY_SESSION_ID: "session-continue",
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
    title: "▶️ Pi Continue · workstation · /work/project",
    message: "VERIFYING · Tests still need to run.\nsession id: session-continue",
    tags: ["continue", "workstation"],
  });
});

test("ntfy companion publishes question text from stdin", async () => {
  let requestBody: string | undefined;
  let resolveRequest!: () => void;
  const received = new Promise<void>((resolve) => {
    resolveRequest = resolve;
  });
  const requestTimedOut = AbortSignal.timeout(5_000);
  const requestOrTimeout = Promise.race([
    received,
    new Promise<never>((_, reject) =>
      requestTimedOut.addEventListener("abort", () => reject(new Error("ntfy request not received")), { once: true }),
    ),
  ]);
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
  await writeFile(helperPath, await helperSource(`http://127.0.0.1:${address.port}/test-topic`));

  try {
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          [helperPath, "question"],
          {
            env: {
              ...process.env,
              PI_NOTIFY_HOSTNAME: "workstation",
              PI_NOTIFY_CWD: "/work/project",
              PI_NOTIFY_SESSION_ID: "session-two",
            },
            timeout: 10_000,
          },
          (error) => (error ? reject(error) : resolve()),
        );
        child.stdin?.end("1. First question?\n2. Second question?");
      }),
      requestOrTimeout,
    ]);
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

test("ntfy companion isolates concurrent question bodies", async () => {
  const requestBodies: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requestBodies.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"id":"accepted"}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const root = await mkdtemp(join(tmpdir(), "pi-notify-ntfy-concurrent-"));
  const helperPath = join(root, "pi-notify-ntfy.mjs");
  await writeFile(helperPath, await helperSource(`http://127.0.0.1:${address.port}/test-topic`));

  try {
    const deliver = (index: number) =>
      new Promise<void>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          [helperPath, "question"],
          {
            env: {
              ...process.env,
              PI_NOTIFY_HOSTNAME: "workstation",
              PI_NOTIFY_CWD: "/work/project",
              PI_NOTIFY_SESSION_ID: `session-${index}`,
            },
            timeout: 10_000,
          },
          (error) => (error ? reject(error) : resolve()),
        );
        child.stdin?.end(`Question ${index}?`);
      });
    for (let index = 0; index < 12; index += 4) {
      await Promise.all(Array.from({ length: 4 }, (_, offset) => deliver(index + offset)));
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }

  const messages = requestBodies
    .map((body) => (JSON.parse(body) as NtfyRequest).message)
    .sort();
  const expected = Array.from({ length: 12 }, (_, index) => `Question ${index}?\nsession id: session-${index}`).sort();
  assert.deepEqual(messages, expected);
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
