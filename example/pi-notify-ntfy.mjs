#!/usr/bin/env node

import { stdin } from "node:process";

/**
 * Optional ntfy companion for the pi-notify examples.
 *
 * Copy this file to $PI_CODING_AGENT_DIR (normally $HOME/.pi/agent),
 * replace YOUR_PRIVATE_TOPIC, chmod 700, and launch it from the documented js: action.
 */

const NTFY_URL = "https://ntfy.sh/YOUR_PRIVATE_TOPIC";
const env = process.env;
const mode = process.argv[2] ?? env.PI_NOTIFY_DELIVERY_MODE;

if (NTFY_URL.endsWith("/YOUR_PRIVATE_TOPIC")) {
  process.stderr.write("Replace YOUR_PRIVATE_TOPIC in pi-notify-ntfy.mjs before use\n");
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
  stdin.setEncoding("utf8");
  let question = "";
  for await (const chunk of stdin) question += chunk;
  message = cleanBody(question);
  if (!message) process.exit(0);
  tag = "input-required";
} else if (mode === "agent") {
  if (!env.PI_NOTIFY_TITLE || !env.PI_NOTIFY_CONTENT) process.exit(0);
  title = `🤖 ${cleanHeader(env.PI_NOTIFY_TITLE)} · ${hostname} · ${cwd}`;
  message = cleanBody(env.PI_NOTIFY_CONTENT);
  tag = "agent";
} else if (mode === "continue") {
  const reasonType = cleanHeader(env.PI_NOTIFY_REASON_TYPE).trim().toUpperCase();
  const reason = cleanBody(env.PI_NOTIFY_REASON).trim();
  if (!reasonType || !reason) process.exit(0);
  title = `▶️ Pi Continue · ${hostname} · ${cwd}`;
  message = `${reasonType} · ${reason}`;
  tag = "continue";
} else if (mode === "user-ready") {
  if (env.PI_NOTIFY_STOP_KIND === "AI_UNLOCK") {
    title = `🙋 Pi Done · ${hostname} · ${cwd}`;
    message = cleanBody(env.PI_NOTIFY_REASON);
    tag = "done";
  } else if (env.PI_NOTIFY_STOP_KIND === "EXHAUSTED") {
    title = `🛑 Pi Continue stopped · ${hostname} · ${cwd}`;
    message = "Continue watchdog retry limit reached";
    tag = "retry-limit";
  } else if (env.PI_NOTIFY_STOP_KIND === "DECISION_FAILED") {
    title = `⚠️ Pi Continue failed · ${hostname} · ${cwd}`;
    message = "Continue watchdog decision failed";
    tag = "decision-failed";
  } else {
    process.exit(0);
  }
} else {
  process.stderr.write("Usage: pi-notify-ntfy.mjs question|agent|continue|user-ready\n");
  process.exit(2);
}

const body = `${message}\nsession id: ${sessionId}`;

try {
  const endpoint = new URL(NTFY_URL);
  const topic = decodeURIComponent(endpoint.pathname.slice(1));
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
  process.stderr.write(`[pi-notify-ntfy] Cannot publish notification: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
