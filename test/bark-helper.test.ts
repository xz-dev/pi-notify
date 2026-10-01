import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helperPath = fileURLToPath(new URL("../example/pi-notify-bark.mjs", import.meta.url));

interface BarkRequest {
  device_key?: string;
  title?: string;
  body?: string;
  group?: string;
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
  env.BARK_URL = endpoint;
  env.BARK_DEVICE_KEY = "fixture-device-key";
  env.PI_NOTIFY_HOSTNAME = "host";
  env.PI_NOTIFY_CWD = "/work";
  env.PI_NOTIFY_SESSION_ID = "fixture-session";
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
      responseWriter.end(response.body ?? '{"code":200,"message":"success"}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    endpoint: `http://127.0.0.1:${address.port}/push`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function parseRequest(request: CapturedRequest): BarkRequest {
  return JSON.parse(request.body) as BarkRequest;
}

test("Bark companion publishes the documented UTF-8 JSON push shape", async () => {
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
      }),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0]?.method, "POST");
    assert.equal(fixture.requests[0]?.path, "/push");
    assert.equal(fixture.requests[0]?.headers["content-type"], "application/json; charset=utf-8");
    assert.deepEqual(parseRequest(fixture.requests[0]!), {
      device_key: "fixture-device-key",
      title: "🤖 发布完成 🚀 · 工作站 · /工作/项目",
      body: "构建成功 — Καλημέρα — مرحبًا\nsession id: 会话-一",
      group: "pi-notify",
    });
  } finally {
    await fixture.close();
  }
});

test("Bark companion supports stdin questions and lifecycle presentation modes", async () => {
  const fixture = await startServer();
  try {
    const cases: Array<{ args: string[]; values: Record<string, string>; input?: string }> = [
      {
        args: ["question"],
        values: { PI_NOTIFY_HOSTNAME: "host", PI_NOTIFY_CWD: "/work", PI_NOTIFY_SESSION_ID: "q" },
        input: "第一问？\n第二问？",
      },
      {
        args: ["continue"],
        values: { PI_NOTIFY_SESSION_ID: "c" },
      },
      {
        args: ["reflect"],
        values: {
          PI_NOTIFY_REFLECTION_TYPE: "NO_ISSUE",
          PI_NOTIFY_REASON: "Route is sound",
          PI_NOTIFY_NEXT_STEP: "Continue with the verified path",
          PI_NOTIFY_SESSION_ID: "r-clear",
        },
      },
      {
        args: ["reflect"],
        values: {
          PI_NOTIFY_REFLECTION_TYPE: "ROUTE_CORRECTION",
          PI_NOTIFY_REASON: "Route changed",
          PI_NOTIFY_NEXT_STEP: "Use the corrected path",
          PI_NOTIFY_SESSION_ID: "r-route",
        },
      },
      {
        args: ["user-ready"],
        values: {
          PI_NOTIFY_STOP_KIND: "AI_UNLOCK",
          PI_NOTIFY_REASON_TYPE: "WAIT_USER",
          PI_NOTIFY_REASON: "Choose a path",
          PI_NOTIFY_SESSION_ID: "u",
        },
      },
    ];
    for (const item of cases) {
      const result = await runHelper(item.args, isolatedEnv(fixture.endpoint, item.values), item.input);
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(fixture.requests.length, cases.length);
    assert.deepEqual(
      fixture.requests.map(parseRequest).map(({ device_key, group }) => ({ device_key, group })),
      cases.map(() => ({ device_key: "fixture-device-key", group: "pi-notify" })),
    );
    assert.equal(parseRequest(fixture.requests[0]!).body, "第一问？\n第二问？\nsession id: q");
    assert.equal(parseRequest(fixture.requests[1]!).title, "▶️ Pi Continue · host · /work");
    assert.equal(parseRequest(fixture.requests[1]!).body, "Continue watchdog continued\nsession id: c");
    assert.equal(parseRequest(fixture.requests[2]!).title, "👀 Pi Reflection clear · host · /work");
    assert.equal(parseRequest(fixture.requests[3]!).title, "🧭 Pi Route correction · host · /work");
    assert.equal(parseRequest(fixture.requests[4]!).title, "🙋 Pi Wait · host · /work");
  } finally {
    await fixture.close();
  }
});

test("Bark companion stays silent for unsupported reflection types and user-ready reason types", async () => {
  const fixture = await startServer();
  try {
    for (const values of [
      { PI_NOTIFY_REFLECTION_TYPE: "FUTURE_REVIEW", PI_NOTIFY_REASON: "reason", PI_NOTIFY_NEXT_STEP: "next" },
      { PI_NOTIFY_STOP_KIND: "AI_UNLOCK", PI_NOTIFY_REASON_TYPE: "UNKNOWN", PI_NOTIFY_REASON: "reason" },
      { PI_NOTIFY_STOP_KIND: "AI_UNLOCK", PI_NOTIFY_REASON_TYPE: "WAIT_CALLBACK", PI_NOTIFY_REASON: "reason" },
      { PI_NOTIFY_STOP_KIND: "AI_UNLOCK", PI_NOTIFY_REASON: "reason" },
    ] as Array<Record<string, string>>) {
      const result = await runHelper([values.PI_NOTIFY_REFLECTION_TYPE ? "reflect" : "user-ready"], isolatedEnv(fixture.endpoint, values));
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(fixture.requests.length, 0);
  } finally {
    await fixture.close();
  }
});

test("Bark companion maps all automatic user-ready outcomes", async () => {
  const fixture = await startServer();
  try {
    const cases = [
      ["JOB_DONE", "✅ Pi Done · host · /work", "All done"],
      ["WAIT_USER", "🙋 Pi Wait · host · /work", "Choose"],
      ["JOB_BLOCKED", "🚧 Pi Blocked · host · /work", "Blocked"],
    ] as const;
    for (const [reasonType, expectedTitle, reason] of cases) {
      const result = await runHelper(
        ["user-ready"],
        isolatedEnv(fixture.endpoint, {
          PI_NOTIFY_STOP_KIND: "AI_UNLOCK",
          PI_NOTIFY_REASON_TYPE: reasonType,
          PI_NOTIFY_REASON: reason,
          PI_NOTIFY_HOSTNAME: "host",
          PI_NOTIFY_CWD: "/work",
          PI_NOTIFY_SESSION_ID: reasonType,
        }),
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(parseRequest(fixture.requests.at(-1)!).title, expectedTitle);
    }
  } finally {
    await fixture.close();
  }
});

test("Bark companion accepts HTTP success without a numeric response code", async () => {
  const fixture = await startServer({ body: "not-json", contentType: "text/plain" });
  try {
    const result = await runHelper(
      ["agent"],
      isolatedEnv(fixture.endpoint, { PI_NOTIFY_TITLE: "title", PI_NOTIFY_CONTENT: "content" }),
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await fixture.close();
  }
});

test("Bark companion rejects a non-success provider response code", async () => {
  const fixture = await startServer({ body: '{"code":400,"message":"bad key"}' });
  try {
    const result = await runHelper(
      ["agent"],
      isolatedEnv(fixture.endpoint, {
        PI_NOTIFY_TITLE: "private title must not be printed",
        PI_NOTIFY_CONTENT: "private content must not be printed",
      }),
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^\[pi-notify-bark\] Cannot publish notification: Bark code 400/m);
    assert.doesNotMatch(result.stderr, /bad key|private title|private content|fixture-device-key/);
  } finally {
    await fixture.close();
  }
});

test("Bark companion stays silent for incomplete or invalid presentations", async () => {
  const fixture = await startServer();
  try {
    const cases: Array<[string[], Record<string, string>, string?]> = [
      [["agent"], { PI_NOTIFY_TITLE: "title" }],
      [["reflect"], { PI_NOTIFY_REFLECTION_TYPE: "NO_ISSUE", PI_NOTIFY_REASON: "reason" }],
      [["user-ready"], { PI_NOTIFY_STOP_KIND: "NOT_AUTOMATIC" }],
      [["question"], {}, ""],
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

test("Bark companion exits with usage for removed wait mode and stays silent for removed stop kind", async () => {
  const fixture = await startServer();
  try {
    // Removed producer outputs: wait mode is unsupported (usage exit 2),
    // DECISION_FAILED is an unknown stop kind (silent exit 0).
    const waitResult = await runHelper(
      ["wait"],
      isolatedEnv(fixture.endpoint, {
        PI_NOTIFY_REASON: "reason",
        PI_NOTIFY_WAIT_SECONDS: "60",
        PI_NOTIFY_SESSION_ID: "w",
      }),
    );
    assert.equal(waitResult.status, 2);
    assert.match(waitResult.stderr, /^Usage: pi-notify-bark\.mjs /m);

    const failedResult = await runHelper(
      ["user-ready"],
      isolatedEnv(fixture.endpoint, { PI_NOTIFY_STOP_KIND: "DECISION_FAILED", PI_NOTIFY_SESSION_ID: "f" }),
    );
    assert.equal(failedResult.status, 0, failedResult.stderr);
    assert.equal(fixture.requests.length, 0);
  } finally {
    await fixture.close();
  }
});

test("Bark companion fails closed for missing credentials and malformed endpoints", async () => {
  const missingKey = await runHelper(
    ["agent"],
    isolatedEnv("http://127.0.0.1:1/push", {
      BARK_DEVICE_KEY: "",
      PI_NOTIFY_TITLE: "title",
      PI_NOTIFY_CONTENT: "content",
    }),
  );
  assert.equal(missingKey.status, 2);
  assert.match(missingKey.stderr, /^Set BARK_URL and BARK_DEVICE_KEY before use/m);

  const malformedUrl = await runHelper(
    ["agent"],
    isolatedEnv("http://127.0.0.1:1/not-push", { PI_NOTIFY_TITLE: "title", PI_NOTIFY_CONTENT: "content" }),
  );
  assert.notEqual(malformedUrl.status, 0);
  assert.match(malformedUrl.stderr, /^\[pi-notify-bark\] Cannot publish notification: Invalid Bark URL/m);
  assert.doesNotMatch(malformedUrl.stderr, /title|content|fixture-device-key/);
});
