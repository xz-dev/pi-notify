#!/usr/bin/env node

import { stdin } from "node:process";

/**
 * Optional ntfy companion for the pi-notify examples.
 *
 * Copy this file to $PI_CODING_AGENT_DIR (normally $HOME/.pi/agent),
 * set NTFY_URL to a complete topic URL, chmod 700, and invoke it from a
 * documented cmd: action. Keep the copied file private if it contains a
 * private topic.
 */

const env = process.env;
const NTFY_URL = env.NTFY_URL ?? "https://ntfy.sh/YOUR_PRIVATE_TOPIC";
const mode = process.argv[2] ?? env.PI_NOTIFY_DELIVERY_MODE;

if (NTFY_URL.endsWith("/YOUR_PRIVATE_TOPIC")) {
  process.stderr.write("Set NTFY_URL or replace YOUR_PRIVATE_TOPIC before use\n");
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
const hostnameTag =
  hostname
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown-host";
const cwd = cleanHeader(env.PI_NOTIFY_CWD);
const sessionId = cleanHeader(env.PI_NOTIFY_SESSION_ID);

let title;
let message;
let tag;

if (mode === "question") {
  title = `❓ Pi Question · ${hostname} · ${cwd}`;
  message = await readQuestion();
  if (!message.trim()) process.exit(0);
  tag = "input-required";
} else if (mode === "agent") {
  const producerTitle = cleanHeader(env.PI_NOTIFY_TITLE).trim();
  message = cleanBody(env.PI_NOTIFY_CONTENT);
  if (!producerTitle || !message.trim()) process.exit(0);
  title = `🤖 ${producerTitle} · ${hostname} · ${cwd}`;
  tag = "agent";
} else if (mode === "continue") {
  const reasonType = cleanHeader(env.PI_NOTIFY_REASON_TYPE).trim().toUpperCase();
  const reason = cleanBody(env.PI_NOTIFY_REASON).trim();
  if (!reasonType || !reason) process.exit(0);
  title = `▶️ Pi Continue · ${hostname} · ${cwd}`;
  message = `${reasonType} · ${reason}`;
  tag = "continue";
} else if (mode === "wait") {
  const waitSeconds = cleanHeader(env.PI_NOTIFY_WAIT_SECONDS).trim();
  const reason = cleanBody(env.PI_NOTIFY_REASON).trim();
  const waitValue = Number(waitSeconds);
  if (!/^[1-9]\d*$/.test(waitSeconds) || !Number.isSafeInteger(waitValue) || waitValue > 1800 || !reason) process.exit(0);
  title = `⏳ Pi Waiting · ${hostname} · ${cwd}`;
  message = `${waitSeconds}s · ${reason}`;
  tag = "waiting";
} else if (mode === "reflect") {
  const reflectionType = cleanHeader(env.PI_NOTIFY_REFLECTION_TYPE).trim().toUpperCase();
  const reason = cleanBody(env.PI_NOTIFY_REASON).trim();
  const nextStep = cleanBody(env.PI_NOTIFY_NEXT_STEP).trim();
  if (!reflectionType || !reason || !nextStep) process.exit(0);
  if (reflectionType === "NO_ISSUE") {
    title = `👀 Pi Reflection clear · ${hostname} · ${cwd}`;
    tag = "reflection-clear";
  } else if (reflectionType === "ROUTE_CORRECTION") {
    title = `🧭 Pi Route correction · ${hostname} · ${cwd}`;
    tag = "route-correction";
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
    if (reasonType === "JOB_DONE") {
      title = `✅ Pi Done · ${hostname} · ${cwd}`;
      tag = "done";
    } else if (reasonType === "WAIT_USER") {
      title = `🙋 Pi Wait · ${hostname} · ${cwd}`;
      tag = "wait-user";
    } else if (reasonType === "JOB_BLOCKED") {
      title = `🚧 Pi Blocked · ${hostname} · ${cwd}`;
      tag = "blocked";
    }
  } else if (stopKind === "EXHAUSTED") {
    title = `🛑 Pi Continue stopped · ${hostname} · ${cwd}`;
    message = "Continue watchdog retry limit reached";
    tag = "retry-limit";
  } else if (stopKind === "DECISION_FAILED") {
    title = `⚠️ Pi Continue failed · ${hostname} · ${cwd}`;
    message = "Continue watchdog decision failed";
    tag = "decision-failed";
  } else {
    process.exit(0);
  }
} else {
  process.stderr.write("Usage: pi-notify-ntfy.mjs question|agent|continue|wait|reflect|user-ready\n");
  process.exit(2);
}

const body = `${message}\nsession id: ${sessionId}`;

try {
  const endpoint = new URL(NTFY_URL);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("Invalid ntfy URL");
  }
  let topic;
  try {
    topic = decodeURIComponent(endpoint.pathname.slice(1));
  } catch {
    throw new Error("Invalid ntfy topic");
  }
  if (!/^[-_A-Za-z0-9]{1,64}$/.test(topic)) throw new Error("Invalid ntfy topic");
  endpoint.pathname = "/";
  endpoint.search = "";
  endpoint.hash = "";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic,
      title,
      message: body,
      tags: [tag, hostnameTag],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  const detail = error instanceof Error ? error.message : "request failed";
  process.stderr.write(`[pi-notify-ntfy] Cannot publish notification: ${detail}\n`);
  process.exitCode = 1;
}
