import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helperPath = fileURLToPath(new URL("../example/pi-notify-ntfy.mjs", import.meta.url));

interface NtfyRequest {
  topic?: string;
  title?: string;
  message?: string;
  tags?: string[];
}

interface CapturedRequest {
  method?: string;
  path?: string;
  headers: IncomingHttpHeaders;
  body: string;
}

interface HelperResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface ResponseSpec {
  status?: number;
  body?: string;
  contentType?: string;
}

function isolatedEnv(endpoint: string, values: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["HOME", "LANG", "LC_ALL", "PATH", "TEMP", "TMP", "TMPDIR", "USERPROFILE", "WINDIR", "SystemRoot"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.NTFY_URL = endpoint;
  Object.assign(env, values);
  return env;
}

function runHelper(args: string[], env: NodeJS.ProcessEnv, input = ""): Promise<HelperResult> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [helperPath, ...args],
      { env, timeout: 10_000 },
      (error, stdout, stderr) => {
        resolve({
          status: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout,
          stderr,
        });
      },
    );
    child.stdin?.end(input);
  });
}

async function startServer(response: ResponseSpec = {}): Promise<{
  endpoint: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, responseWriter) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        method: request.method,
        path: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      responseWriter.writeHead(response.status ?? 200, {
        "Content-Type": response.contentType ?? "application/json",
      });
      responseWriter.end(response.body ?? '{"id":"accepted"}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    endpoint: `http://127.0.0.1:${address.port}/test-topic`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function parseRequest(request: CapturedRequest): NtfyRequest {
  return JSON.parse(request.body) as NtfyRequest;
}

test("ntfy companion publishes multilingual title and body as UTF-8 JSON", async () => {
  const fixture = await startServer();
  try {
    const result = await runHelper(
      ["agent"],
      isolatedEnv(fixture.endpoint, {
        PI_NOTIFY_TITLE: "发布完成 🚀",
        PI_NOTIFY_CONTENT: "构建成功 — Καλημέρα — مرحبًا",
        PI_NOTIFY_HOSTNAME: "工作站",
        PI_NOTIFY_CWD: "/工作/项目",
        PI_NOTIFY_SESSION_ID: "会话-一",
        PI_NOTIFY_QUESTION_BODY: "must not be used",
      }),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0]?.method, "POST");
    assert.equal(fixture.requests[0]?.path, "/");
    assert.equal(fixture.requests[0]?.headers["content-type"], "application/json");
    assert.deepEqual(parseRequest(fixture.requests[0]!), {
      topic: "test-topic",
      title: "🤖 发布完成 🚀 · 工作站 · /工作/项目",
      message: "构建成功 — Καλημέρα — مرحبًا\nsession id: 会话-一",
      tags: ["agent", "unknown-host"],
    });
  } finally {
    await fixture.close();
  }
});

test("ntfy companion publishes continue notification with its fixed message", async () => {
  const fixture = await startServer();
  try {
    const continueResult = await runHelper(
      ["continue"],
      isolatedEnv(fixture.endpoint, {
        PI_NOTIFY_HOSTNAME: "workstation",
        PI_NOTIFY_CWD: "/work/project",
        PI_NOTIFY_SESSION_ID: "session-continue",
        PI_NOTIFY_REASON_TYPE: "must not be used",
        PI_NOTIFY_REASON: "must not be used",
      }),
    );
    assert.equal(continueResult.status, 0, continueResult.stderr);
    assert.deepEqual(fixture.requests.map(parseRequest), [
      {
        topic: "test-topic",
        title: "▶️ Pi Continue · workstation · /work/project",
        message: "Continue watchdog continued\nsession id: session-continue",
        tags: ["continue", "workstation"],
      },
    ]);
  } finally {
    await fixture.close();
  }
});

test("ntfy companion presents supported reflection results", async () => {
  const fixture = await startServer();
  try {
    const cases = [
      {
        type: "NO_ISSUE",
        title: "👀 Pi Reflection clear · workstation · /work/project",
        tag: "reflection-clear",
        sessionId: "session-clear",
      },
      {
        type: "ROUTE_CORRECTION",
        title: "🧭 Pi Route correction · workstation · /work/project",
        tag: "route-correction",
        sessionId: "session-route",
      },
    ];
    for (const item of cases) {
      const result = await runHelper(
        ["reflect"],
        isolatedEnv(fixture.endpoint, {
          PI_NOTIFY_REFLECTION_TYPE: item.type,
          PI_NOTIFY_REASON: "The route is understood.",
          PI_NOTIFY_NEXT_STEP: "Continue with the verified plan.",
          PI_NOTIFY_HOSTNAME: "workstation",
          PI_NOTIFY_CWD: "/work/project",
          PI_NOTIFY_SESSION_ID: item.sessionId,
        }),
      );
      assert.equal(result.status, 0, result.stderr);
    }
    assert.deepEqual(fixture.requests.map(parseRequest), [
      {
        topic: "test-topic",
        title: cases[0]!.title,
        message: "The route is understood.\nNext: Continue with the verified plan.\nsession id: session-clear",
        tags: [cases[0]!.tag, "workstation"],
      },
      {
        topic: "test-topic",
        title: cases[1]!.title,
        message: "The route is understood.\nNext: Continue with the verified plan.\nsession id: session-route",
        tags: [cases[1]!.tag, "workstation"],
      },
    ]);
  } finally {
    await fixture.close();
  }
});

test("ntfy companion maps automatic user-ready outcomes without conflating reason types", async () => {
  const fixture = await startServer();
  try {
    const cases = [
      ["AI_UNLOCK", "JOB_DONE", "✅ Pi Done · workstation · /work/project", "done", "All work is complete."],
      ["AI_UNLOCK", "WAIT_USER", "🙋 Pi Wait · workstation · /work/project", "wait-user", "Please choose the next step."],
      ["AI_UNLOCK", "JOB_BLOCKED", "🚧 Pi Blocked · workstation · /work/project", "blocked", "The required service is unavailable."],
      ["ERROR_UNLOCK", "", "❌ Pi Continue error · workstation · /work/project", "error-unlock", "Continue watchdog unlocked · run ended in error (automatic unlock)"],
      ["EXHAUSTED", "", "🛑 Pi Continue stopped · workstation · /work/project", "retry-limit", "Continue watchdog retry limit reached"],
    ] as const;
    for (const [stopKind, reasonType, title, tag, reason] of cases) {
      const values: Record<string, string> = {
        PI_NOTIFY_STOP_KIND: stopKind,
        PI_NOTIFY_REASON: reason,
        PI_NOTIFY_HOSTNAME: "workstation",
        PI_NOTIFY_CWD: "/work/project",
        PI_NOTIFY_SESSION_ID: `session-${tag}`,
      };
      if (reasonType) values.PI_NOTIFY_REASON_TYPE = reasonType;
      const result = await runHelper(["user-ready"], isolatedEnv(fixture.endpoint, values));
      assert.equal(result.status, 0, result.stderr);
    }
    assert.deepEqual(
      fixture.requests.map(parseRequest).map(({ title, message, tags }) => ({ title, message, tags })),
      cases.map(([, , title, tag, reason]) => ({
        title,
        message: `${reason}\nsession id: session-${tag}`,
        tags: [tag, "workstation"],
      })),
    );
  } finally {
    await fixture.close();
  }
});

test("ntfy companion reads each question from its own UTF-8 stdin stream", async () => {
  const fixture = await startServer();
  try {
    const result = await runHelper(
      ["question"],
      isolatedEnv(fixture.endpoint, {
        PI_NOTIFY_HOSTNAME: "workstation",
        PI_NOTIFY_CWD: "/work/project",
        PI_NOTIFY_SESSION_ID: "session-question",
        PI_NOTIFY_QUESTION_BODY: "this inherited value must be ignored",
      }),
      "1. First question?\n2. Second question?",
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parseRequest(fixture.requests[0]!), {
      topic: "test-topic",
      title: "❓ Pi Question · workstation · /work/project",
      message: "1. First question?\n2. Second question?\nsession id: session-question",
      tags: ["input-required", "workstation"],
    });
  } finally {
    await fixture.close();
  }
});

test("ntfy companion isolates concurrent question bodies", async () => {
  const fixture = await startServer();
  try {
    const deliveries = Array.from({ length: 12 }, (_, index) =>
      runHelper(
        ["question"],
        isolatedEnv(fixture.endpoint, {
          PI_NOTIFY_HOSTNAME: "workstation",
          PI_NOTIFY_CWD: "/work/project",
          PI_NOTIFY_SESSION_ID: `session-${index}`,
        }),
        `Question ${index}?`,
      ),
    );
    const results = await Promise.all(deliveries);
    assert.ok(results.every((result) => result.status === 0), results.map((result) => result.stderr).join(""));
    const messages = fixture.requests.map((request) => parseRequest(request).message).sort();
    const expected = Array.from({ length: 12 }, (_, index) => `Question ${index}?\nsession id: session-${index}`).sort();
    assert.deepEqual(messages, expected);
  } finally {
    await fixture.close();
  }
});

test("ntfy companion stays silent for incomplete or invalid presentations", async () => {
  const fixture = await startServer();
  try {
    const cases: Array<[string[], Record<string, string>, string?]> = [
      ["agent".split(" "), { PI_NOTIFY_TITLE: "title" }],
      ["reflect".split(" "), { PI_NOTIFY_REFLECTION_TYPE: "NO_ISSUE", PI_NOTIFY_REASON: "reason" }],
      ["reflect".split(" "), { PI_NOTIFY_REFLECTION_TYPE: "FUTURE_REVIEW", PI_NOTIFY_REASON: "reason", PI_NOTIFY_NEXT_STEP: "next" }],
      ["user-ready".split(" "), { PI_NOTIFY_STOP_KIND: "AI_UNLOCK", PI_NOTIFY_REASON: "reason", PI_NOTIFY_REASON_TYPE: "UNKNOWN" }],
      ["user-ready".split(" "), { PI_NOTIFY_STOP_KIND: "NOT_AUTOMATIC" }],
      ["question".split(" "), {}, ""],
    ];
    for (const [args, values, input] of cases) {
      const result = await runHelper(args, isolatedEnv(fixture.endpoint, values), input);
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(fixture.requests.length, 0);
  } finally {
    await fixture.close();
  }
});

test("ntfy companion exits with usage for removed wait mode and stays silent for removed stop kind", async () => {
  const fixture = await startServer();
  try {
    // Removed producer outputs: wait mode is unsupported (usage exit 2),
    // DECISION_FAILED is an unknown stop kind (silent exit 0).
    const waitResult = await runHelper(
      ["wait"],
      isolatedEnv(fixture.endpoint, {
        PI_NOTIFY_REASON: "reason",
        PI_NOTIFY_WAIT_SECONDS: "60",
        PI_NOTIFY_HOSTNAME: "workstation",
        PI_NOTIFY_CWD: "/work/project",
        PI_NOTIFY_SESSION_ID: "session-wait",
      }),
    );
    assert.equal(waitResult.status, 2);
    assert.match(waitResult.stderr, /^Usage: pi-notify-ntfy\.mjs /m);

    const failedResult = await runHelper(
      ["user-ready"],
      isolatedEnv(fixture.endpoint, {
        PI_NOTIFY_STOP_KIND: "DECISION_FAILED",
        PI_NOTIFY_HOSTNAME: "workstation",
        PI_NOTIFY_CWD: "/work/project",
        PI_NOTIFY_SESSION_ID: "session-failed",
      }),
    );
    assert.equal(failedResult.status, 0, failedResult.stderr);
    assert.equal(fixture.requests.length, 0);
  } finally {
    await fixture.close();
  }
});

test("ntfy companion rejects endpoint query and fragment before making a request", async () => {
  for (const endpoint of ["http://127.0.0.1:1/test-topic?token=secret", "http://127.0.0.1:1/test-topic#fragment"]) {
    const result = await runHelper(
      ["agent"],
      isolatedEnv(endpoint, { PI_NOTIFY_TITLE: "title", PI_NOTIFY_CONTENT: "content" }),
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^\[pi-notify-ntfy\] Cannot publish notification: Invalid ntfy URL/m);
    assert.doesNotMatch(result.stderr, /secret|fragment|content|title/);
  }
});

test("ntfy companion rejects an invalid topic before making a request", async () => {
  const result = await runHelper(
    ["agent"],
    isolatedEnv("http://127.0.0.1/invalid/topic", {
      PI_NOTIFY_TITLE: "title",
      PI_NOTIFY_CONTENT: "content",
    }),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^\[pi-notify-ntfy\] Cannot publish notification: Invalid ntfy topic/m);
  assert.doesNotMatch(result.stderr, /127\.0\.0\.1|content|title/);
});

test("ntfy companion reports local backend HTTP failures without dumping payloads", async () => {
  const fixture = await startServer({ status: 503, body: '{"error":"unavailable"}' });
  try {
    const result = await runHelper(
      ["agent"],
      isolatedEnv(fixture.endpoint, {
        PI_NOTIFY_TITLE: "private title should not appear in diagnostics",
        PI_NOTIFY_CONTENT: "private content should not appear in diagnostics",
      }),
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^\[pi-notify-ntfy\] Cannot publish notification: HTTP 503/m);
    assert.doesNotMatch(result.stderr, /private title|private content|unavailable/);
  } finally {
    await fixture.close();
  }
});
