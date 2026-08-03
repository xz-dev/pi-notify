#!/usr/bin/env node

/**
 * Optional ntfy companion for the pi-notify examples.
 *
 * Copy this file outside the package, replace YOUR_PRIVATE_TOPIC, chmod 700,
 * and reference the copied absolute path from a shell: action.
 */

const NTFY_URL = "https://ntfy.sh/YOUR_PRIVATE_TOPIC";
const mode = process.argv[2];

if (NTFY_URL.endsWith("/YOUR_PRIVATE_TOPIC")) {
  process.stderr.write("Replace YOUR_PRIVATE_TOPIC in pi-notify-ntfy.mjs before use\n");
  process.exit(2);
}
const env = process.env;

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
  message = `${cleanHeader(env.PI_NOTIFY_TOOL)} needs your input in ${cwd}`;
  tag = "input-required";
} else if (mode === "agent") {
  if (!env.PI_NOTIFY_TITLE || !env.PI_NOTIFY_CONTENT) process.exit(0);
  title = `🤖 ${cleanHeader(env.PI_NOTIFY_TITLE)} · ${hostname} · ${cwd}`;
  message = cleanBody(env.PI_NOTIFY_CONTENT);
  tag = "agent";
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
  process.stderr.write("Usage: pi-notify-ntfy.mjs question|agent|user-ready\n");
  process.exit(2);
}

const body = `${message}\nsession id: ${sessionId}`;

try {
  const response = await fetch(NTFY_URL, {
    method: "POST",
    headers: {
      Title: title,
      Tags: `${tag},${hostnameTag}`,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  process.stderr.write(`[pi-notify-ntfy] Cannot publish notification: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
