#!/usr/bin/env node

import { stdin } from "node:process";

/**
 * Optional Bark companion for the pi-notify examples.
 *
 * Copy this file to $PI_CODING_AGENT_DIR (normally $HOME/.pi/agent),
 * set BARK_URL to your Bark /push endpoint and BARK_DEVICE_KEY to your
 * device key, chmod 700, and invoke it from a documented cmd: action.
 */

const env = process.env;
const BARK_URL = env.BARK_URL ?? "https://example.invalid/push";
const BARK_DEVICE_KEY = env.BARK_DEVICE_KEY ?? "YOUR_BARK_DEVICE_KEY";
const mode = process.argv[2] ?? env.PI_NOTIFY_DELIVERY_MODE;

if (
  BARK_URL === "https://example.invalid/push" ||
  BARK_DEVICE_KEY === "YOUR_BARK_DEVICE_KEY" ||
  !BARK_DEVICE_KEY.trim()
) {
  process.stderr.write("Set BARK_URL and BARK_DEVICE_KEY before use\n");
  process.exit(2);
}

function cleanHeader(value) {
  return String(value ?? "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function cleanBody(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
}

async function readQuestion() {
  try {
    stdin.setEncoding("utf8");
    let question = "";
    for await (const chunk of stdin) question += chunk;
    return cleanBody(question);
  } catch {
    return "";
  }
}

const hostname = cleanHeader(env.PI_NOTIFY_HOSTNAME).trim() || "unknown-host";
const cwd = cleanHeader(env.PI_NOTIFY_CWD);
const sessionId = cleanHeader(env.PI_NOTIFY_SESSION_ID);

let title;
let message;

if (mode === "question") {
  title = `❓ Pi Question · ${hostname} · ${cwd}`;
  message = await readQuestion();
  if (!message.trim()) process.exit(0);
} else if (mode === "agent") {
  const producerTitle = cleanHeader(env.PI_NOTIFY_TITLE).trim();
  message = cleanBody(env.PI_NOTIFY_CONTENT);
  if (!producerTitle || !message.trim()) process.exit(0);
  title = `🤖 ${producerTitle} · ${hostname} · ${cwd}`;
} else if (mode === "continue") {
  const reasonType = cleanHeader(env.PI_NOTIFY_REASON_TYPE).trim().toUpperCase();
  const reason = cleanBody(env.PI_NOTIFY_REASON).trim();
  if (!reasonType || !reason) process.exit(0);
  title = `▶️ Pi Continue · ${hostname} · ${cwd}`;
  message = `${reasonType} · ${reason}`;
} else if (mode === "wait") {
  const waitSeconds = cleanHeader(env.PI_NOTIFY_WAIT_SECONDS).trim();
  const reason = cleanBody(env.PI_NOTIFY_REASON).trim();
  const waitValue = Number(waitSeconds);
  if (!/^[1-9]\d*$/.test(waitSeconds) || !Number.isSafeInteger(waitValue) || waitValue > 1800 || !reason) process.exit(0);
  title = `⏳ Pi Waiting · ${hostname} · ${cwd}`;
  message = `${waitSeconds}s · ${reason}`;
} else if (mode === "reflect") {
  const reflectionType = cleanHeader(env.PI_NOTIFY_REFLECTION_TYPE).trim().toUpperCase();
  const reason = cleanBody(env.PI_NOTIFY_REASON).trim();
  const nextStep = cleanBody(env.PI_NOTIFY_NEXT_STEP).trim();
  if (!reflectionType || !reason || !nextStep) process.exit(0);
  if (reflectionType === "NO_ISSUE") {
    title = `👀 Pi Reflection clear · ${hostname} · ${cwd}`;
  } else if (reflectionType === "ROUTE_CORRECTION") {
    title = `🧭 Pi Route correction · ${hostname} · ${cwd}`;
  } else {
    process.exit(0);
  }
  message = `${reason}\nNext: ${nextStep}`;
} else if (mode === "user-ready") {
  const stopKind = cleanHeader(env.PI_NOTIFY_STOP_KIND).trim().toUpperCase();
  if (stopKind === "AI_UNLOCK") {
    const reasonType = cleanHeader(env.PI_NOTIFY_REASON_TYPE).trim().toUpperCase();
    message = cleanBody(env.PI_NOTIFY_REASON).trim();
    if (!message || !["JOB_DONE", "WAIT_USER", "JOB_BLOCKED"].includes(reasonType)) process.exit(0);
    title =
      reasonType === "JOB_DONE"
        ? `✅ Pi Done · ${hostname} · ${cwd}`
        : reasonType === "WAIT_USER"
          ? `🙋 Pi Wait · ${hostname} · ${cwd}`
          : `🚧 Pi Blocked · ${hostname} · ${cwd}`;
  } else if (stopKind === "EXHAUSTED") {
    title = `🛑 Pi Continue stopped · ${hostname} · ${cwd}`;
    message = "Continue watchdog retry limit reached";
  } else if (stopKind === "DECISION_FAILED") {
    title = `⚠️ Pi Continue failed · ${hostname} · ${cwd}`;
    message = "Continue watchdog decision failed";
  } else {
    process.exit(0);
  }
} else {
  process.stderr.write("Usage: pi-notify-bark.mjs question|agent|continue|wait|reflect|user-ready\n");
  process.exit(2);
}

const body = `${message}\nsession id: ${sessionId}`;

try {
  const endpoint = new URL(BARK_URL);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/push" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("Invalid Bark URL");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      device_key: BARK_DEVICE_KEY,
      title,
      body,
      group: "pi-notify",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json().catch(() => null);
  if (result && typeof result.code === "number" && result.code !== 200) {
    throw new Error(`Bark code ${result.code}`);
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : "request failed";
  process.stderr.write(`[pi-notify-bark] Cannot publish notification: ${detail}\n`);
  process.exitCode = 1;
}
