import type {
  ExtensionAPI,
  ExtensionContext,
  ToolExecutionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { homedir } from "node:os";
import { join } from "node:path";

import { runActions, type ActionRuntime, type JsActionScope } from "./src/actions.js";
import { createCommandLauncher, createShellLauncher } from "./src/command.js";
import { isShellTupleAction, loadConfig } from "./src/config.js";
import { createOscLauncher } from "./src/osc.js";
import { resolvePowerShell } from "./src/powershell.js";
import type {
  NotificationAction,
  NotificationContext,
  NotificationEnvironment,
  NotificationKey,
} from "./src/types.js";

export interface NotificationRuntime {
  agentDir: string;
  launchOsc: (title: string, body: string) => void;
  launchCommand: (command: string, cwd: string, environment: NotificationEnvironment) => void;
  launchShell: (
    executable: string,
    args: readonly string[],
    cwd: string,
    environment: NotificationEnvironment,
  ) => void;
  resolvePowerShell?: () => string | undefined;
  platform?: NodeJS.Platform;
  runJs?: (code: string, scope: JsActionScope) => Promise<void>;
  warn: (message: string) => void;
}

const defaultCopy: Record<Exclude<NotificationKey, "pi_notify:agent_notify">, { title: string; body: string }> = {
  agent_settled: { title: "Pi", body: "Ready for input" },
  "tool_execution_start:ask_user_question": { title: "Pi", body: "Question needs your input" },
};

const AGENT_NOTIFY_KEY = "pi_notify:agent_notify" as const;

function defaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function createRuntime(): NotificationRuntime {
  const warn = (message: string) => process.stderr.write(`[pi-notify] ${message}\n`);
  return {
    agentDir: defaultAgentDir(),
    launchOsc: createOscLauncher({ warn }),
    launchCommand: createCommandLauncher({ warn }),
    launchShell: createShellLauncher({ warn }),
    resolvePowerShell: () => resolvePowerShell(),
    warn,
  };
}

function toActionRuntime(runtime: NotificationRuntime): ActionRuntime {
  return {
    launchOsc: runtime.launchOsc,
    launchCommand: runtime.launchCommand,
    launchShell: runtime.launchShell,
    resolvePowerShell: runtime.resolvePowerShell,
    platform: runtime.platform,
    runJs: runtime.runJs,
    warn: runtime.warn,
  };
}

function buildNotificationContext(
  key: NotificationKey,
  ctx: ExtensionContext,
  extras?: {
    tool?: string;
    toolCallId?: string;
    title?: string;
    content?: string;
  },
): NotificationContext {
  return {
    event: key,
    cwd: ctx.cwd,
    sessionId: ctx.sessionManager.getSessionId(),
    sessionFile: ctx.sessionManager.getSessionFile(),
    ...(extras?.tool === undefined ? {} : { tool: extras.tool }),
    ...(extras?.toolCallId === undefined ? {} : { toolCallId: extras.toolCallId }),
    ...(extras?.title === undefined ? {} : { title: extras.title }),
    ...(extras?.content === undefined ? {} : { content: extras.content }),
  };
}

function isNonEmptyAction(action: NotificationAction): boolean {
  if (isShellTupleAction(action)) return true;
  return action.trim().length > 0;
}

async function notifyLifecycle(
  key: Exclude<NotificationKey, "pi_notify:agent_notify">,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  runtime: NotificationRuntime,
  event: unknown,
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

  const notification = buildNotificationContext(key, ctx, {
    tool: toolEvent?.toolName,
    toolCallId: toolEvent?.toolCallId,
  });

  await runActions({
    key,
    actions,
    pi,
    ctx,
    event,
    runtime: toActionRuntime(runtime),
    notification,
    throwOnFailure: false,
    defaultOsc: defaultCopy[key],
  });
}

function registerAgentNotifyTool(
  pi: ExtensionAPI,
  runtime: NotificationRuntime,
  actions: NotificationAction[],
  registered: { current: boolean },
): void {
  if (registered.current) return;
  registered.current = true;

  pi.registerTool({
    name: "agent_notify",
    label: "Agent Notify",
    description:
      "Send a user-configured external notification with required title and content text for the user-facing notification body.",
    promptSnippet: "Send a titled notification to the user through configured pi-notify actions",
    parameters: Type.Object({
      title: Type.String({ description: "User-facing notification title" }),
      content: Type.String({ description: "User-facing notification content/body" }),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const event = {
        type: "tool_execution_start",
        toolName: "agent_notify",
        toolCallId,
        args: { title: params.title, content: params.content },
      };
      const notification = buildNotificationContext(AGENT_NOTIFY_KEY, ctx, {
        tool: "agent_notify",
        toolCallId,
        title: params.title,
        content: params.content,
      });

      await runActions({
        key: AGENT_NOTIFY_KEY,
        actions,
        pi,
        ctx,
        event,
        runtime: toActionRuntime(runtime),
        notification,
        throwOnFailure: true,
        defaultOsc: { title: params.title, body: params.content },
      });

      return {
        content: [{ type: "text", text: "Notification sent" }],
        details: undefined,
      };
    },
  });
}

export default function registerExtension(pi: ExtensionAPI, runtime: NotificationRuntime = createRuntime()): void {
  const agentNotifyRegistered = { current: false };

  pi.on("session_start", async (_event, ctx) => {
    if (agentNotifyRegistered.current) return;

    const config = await loadConfig({
      agentDir: runtime.agentDir,
      cwd: ctx.cwd,
      projectTrusted: ctx.isProjectTrusted(),
      warn: runtime.warn,
    });
    const actions = (config[AGENT_NOTIFY_KEY] ?? []).filter(isNonEmptyAction);
    if (actions.length === 0) return;

    registerAgentNotifyTool(pi, runtime, actions, agentNotifyRegistered);
  });

  pi.on("agent_settled", (event, ctx) => notifyLifecycle("agent_settled", ctx, pi, runtime, event));
  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName !== "ask_user_question") return;
    return notifyLifecycle("tool_execution_start:ask_user_question", ctx, pi, runtime, event, event);
  });
}
