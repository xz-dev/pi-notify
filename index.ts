import type { ExtensionAPI, ExtensionContext, ToolExecutionStartEvent } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";

import { createCommandLauncher } from "./src/command.js";
import { loadConfig } from "./src/config.js";
import { createNotificationEnvironment, createTemplateValues, renderTemplate } from "./src/context.js";
import { createOscLauncher } from "./src/osc.js";
import type { NotificationAction, NotificationEnvironment, NotificationKey, TemplateValues } from "./src/types.js";

export interface NotificationRuntime {
  agentDir: string;
  launchOsc: (title: string, body: string) => void;
  launchCommand: (command: string, cwd: string, environment: NotificationEnvironment) => void;
  warn: (message: string) => void;
}

const defaultCopy: Record<NotificationKey, { title: string; body: string }> = {
  agent_settled: { title: "Pi", body: "Ready for input" },
  "tool_execution_start:ask_user_question": { title: "Pi", body: "Question needs your input" },
};

function defaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function createRuntime(): NotificationRuntime {
  const warn = (message: string) => process.stderr.write(`[pi-notify] ${message}\n`);
  return {
    agentDir: defaultAgentDir(),
    launchOsc: createOscLauncher({ warn }),
    launchCommand: createCommandLauncher({ warn }),
    warn,
  };
}

function parseOscAction(action: NotificationAction, values: TemplateValues, key: NotificationKey) {
  if (action === "osc") return defaultCopy[key];
  const template = action.slice(4);
  const separator = template.indexOf("|");
  return {
    title: renderTemplate(template.slice(0, separator), values),
    body: renderTemplate(template.slice(separator + 1), values),
  };
}

async function notify(
  key: NotificationKey,
  ctx: ExtensionContext,
  runtime: NotificationRuntime,
  toolEvent?: ToolExecutionStartEvent,
): Promise<void> {
  const config = await loadConfig({
    agentDir: runtime.agentDir,
    cwd: ctx.cwd,
    projectTrusted: ctx.isProjectTrusted(),
    warn: runtime.warn,
  });
  const actions = config[key] ?? [];
  if (actions.length === 0) return;

  const context = {
    event: key,
    cwd: ctx.cwd,
    sessionId: ctx.sessionManager.getSessionId(),
    sessionFile: ctx.sessionManager.getSessionFile(),
    ...(toolEvent === undefined ? {} : { tool: toolEvent.toolName, toolCallId: toolEvent.toolCallId }),
  };
  const values = createTemplateValues(context);
  const environment = createNotificationEnvironment(context);

  for (const action of actions) {
    if (action === "osc" || action.startsWith("osc:")) {
      const { title, body } = parseOscAction(action, values, key);
      runtime.launchOsc(title, body);
    } else {
      runtime.launchCommand(action.slice(4), ctx.cwd, environment);
    }
  }
}

export default function registerExtension(pi: ExtensionAPI, runtime: NotificationRuntime = createRuntime()): void {
  pi.on("agent_settled", (_event, ctx) => notify("agent_settled", ctx, runtime));
  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName !== "ask_user_question") return;
    return notify("tool_execution_start:ask_user_question", ctx, runtime, event);
  });
}
