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
import { getHookBinding, loadConfig } from "./src/config.js";
import { createOscLauncher } from "./src/osc.js";
import { resolvePowerShell } from "./src/powershell.js";
import {
  SEMANTIC_HOOK_CHANNEL,
  parseSemanticHook,
  type SemanticHookV1,
} from "./src/semantic-hook.js";
import type {
  LifecycleEventKey,
  NotificationAction,
  NotificationBinding,
  NotificationContext,
  NotificationEnvironment,
} from "./src/types.js";
import { SYSTEM_TEMPLATE_KEYS } from "./src/types.js";

const systemTemplateKeySet = new Set<string>(SYSTEM_TEMPLATE_KEYS);

function copyProducerValues(values: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> {
  const copied: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (systemTemplateKeySet.has(key)) continue;
    copied[key] = value;
  }
  return Object.freeze(copied);
}

export interface TimerHandle {
  unref?: () => unknown;
}

export interface Scheduler {
  setTimeout: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
}

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
  scheduler?: Scheduler;
}

const LIFECYCLE_DEFAULT_OSC: Record<LifecycleEventKey, { title: string; body: string }> = {
  agent_settled: { title: "Pi", body: "Ready for input" },
  "tool_execution_start:ask_user_question": { title: "Pi", body: "Question needs your input" },
};

const AGENT_NOTIFY_HOOK = "agent-notify";

function defaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function defaultScheduler(): Scheduler {
  return {
    setTimeout: (fn, ms) => {
      const handle = setTimeout(fn, ms);
      handle.unref?.();
      return handle;
    },
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  };
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

function isNonEmptyAction(action: NotificationAction): boolean {
  if (Array.isArray(action)) return true;
  return typeof action === "string" && action.trim().length > 0;
}

function bindingHasActions(binding: NotificationBinding | undefined): binding is NotificationBinding {
  return !!binding && binding.actions.some(isNonEmptyAction);
}

function copyJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function buildLifecycleNotification(
  key: LifecycleEventKey,
  ctx: ExtensionContext,
  toolEvent?: ToolExecutionStartEvent,
): NotificationContext {
  return {
    event: key,
    cwd: ctx.cwd,
    sessionId: ctx.sessionManager.getSessionId(),
    sessionFile: ctx.sessionManager.getSessionFile(),
    values: Object.freeze({}),
    ...(toolEvent?.toolName === undefined ? {} : { tool: toolEvent.toolName }),
    ...(toolEvent?.toolCallId === undefined ? {} : { toolCallId: toolEvent.toolCallId }),
  };
}

function buildHookNotification(name: string, values: Readonly<Record<string, string>>, ctx: ExtensionContext): NotificationContext {
  return {
    event: `hook:${name}`,
    hook: name,
    cwd: ctx.cwd,
    sessionId: ctx.sessionManager.getSessionId(),
    sessionFile: ctx.sessionManager.getSessionFile(),
    values: copyProducerValues(values),
  };
}

interface PendingWork {
  handle: TimerHandle;
  generation: number;
}

interface AttachmentState {
  generation: number;
  pending: Set<PendingWork>;
  unsubscribeBus?: () => void;
  agentNotifyRegistered: boolean;
  cleaned: boolean;
}

export default function registerExtension(pi: ExtensionAPI, runtime: NotificationRuntime = createRuntime()): void {
  const scheduler = runtime.scheduler ?? defaultScheduler();
  const actionRuntime = toActionRuntime(runtime);
  const state: AttachmentState = {
    generation: 0,
    pending: new Set(),
    agentNotifyRegistered: false,
    cleaned: false,
  };

  const isCurrent = (generation: number) => !state.cleaned && state.generation === generation;

  function cancelPending(): void {
    for (const work of state.pending) {
      try {
        scheduler.clearTimeout(work.handle);
      } catch {
        // ignore
      }
    }
    state.pending.clear();
  }

  function cleanup(): void {
    if (state.cleaned) return;
    state.cleaned = true;
    state.generation += 1;
    cancelPending();
    try {
      state.unsubscribeBus?.();
    } catch {
      // ignore
    }
    state.unsubscribeBus = undefined;
  }

  function scheduleBinding(options: {
    delayMs: number;
    actions: NotificationAction[];
    key: string;
    defaultOsc?: { title: string; body: string };
    /** Causal event retained from receipt time. */
    causalEvent: unknown;
    /** Build live notification context at execution time from current ctx. */
    buildNotification: (ctx: ExtensionContext) => NotificationContext;
    ctx: ExtensionContext;
  }): void {
    if (state.cleaned) return;
    const generation = state.generation;
    const actions = options.actions.slice();
    const causalEvent = copyJson(options.causalEvent);
    const defaultOsc = options.defaultOsc ? { ...options.defaultOsc } : undefined;
    const key = options.key;
    const liveCtx = options.ctx;

    const run = async (): Promise<void> => {
      if (!isCurrent(generation)) return;
      try {
        const notification = options.buildNotification(liveCtx);
        if (!isCurrent(generation)) return;
        await runActions({
          key,
          actions,
          pi,
          ctx: liveCtx,
          event: causalEvent,
          runtime: actionRuntime,
          notification,
          throwOnFailure: false,
          defaultOsc,
          isCurrent: () => isCurrent(generation),
        });
      } catch (error) {
        if (!isCurrent(generation)) return;
        const message = error instanceof Error ? error.message : String(error);
        runtime.warn(`Notification pipeline failed (${key}): ${message}`);
      }
    };

    if (options.delayMs === 0) {
      // Same conceptual flow without an unnecessary timer: schedule as a microtask-like async turn.
      const handle: TimerHandle = {
        unref() {
          return this;
        },
      };
      const work: PendingWork = { handle, generation };
      state.pending.add(work);
      queueMicrotask(() => {
        state.pending.delete(work);
        void run();
      });
      return;
    }

    const work: PendingWork = {
      generation,
      handle: undefined as unknown as TimerHandle,
    };
    work.handle = scheduler.setTimeout(() => {
      state.pending.delete(work);
      void run();
    }, options.delayMs);
    try {
      work.handle.unref?.();
    } catch {
      // ignore
    }
    state.pending.add(work);
  }

  async function handleLifecycle(
    key: LifecycleEventKey,
    event: unknown,
    ctx: ExtensionContext,
    toolEvent?: ToolExecutionStartEvent,
  ): Promise<void> {
    if (state.cleaned) return;
    try {
      const config = await loadConfig({
        agentDir: runtime.agentDir,
        cwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
        warn: runtime.warn,
      });
      if (state.cleaned) return;
      const binding = config.events[key];
      if (!bindingHasActions(binding)) return;

      scheduleBinding({
        delayMs: binding.delayMs,
        actions: binding.actions,
        key,
        defaultOsc: LIFECYCLE_DEFAULT_OSC[key],
        causalEvent: event,
        buildNotification: (liveCtx) => buildLifecycleNotification(key, liveCtx, toolEvent),
        ctx,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.warn(`Lifecycle notification failed (${key}): ${message}`);
    }
  }

  function handleSemanticHook(data: unknown, ctx: ExtensionContext): void {
    if (state.cleaned) return;
    const parsed = parseSemanticHook(data);
    if (!parsed.ok) {
      runtime.warn(`Ignoring invalid semantic hook envelope: ${parsed.reason}`);
      return;
    }
    void dispatchHook(parsed.envelope, ctx);
  }

  async function dispatchHook(envelope: SemanticHookV1, ctx: ExtensionContext): Promise<void> {
    if (state.cleaned) return;
    try {
      const config = await loadConfig({
        agentDir: runtime.agentDir,
        cwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
        warn: runtime.warn,
      });
      if (state.cleaned) return;
      const binding = getHookBinding(config.hooks, envelope.name);
      // Unconfigured names are silent (including prototype names like constructor).
      if (!bindingHasActions(binding)) return;

      const values = copyProducerValues(envelope.values);
      scheduleBinding({
        delayMs: binding.delayMs,
        actions: binding.actions,
        key: `hook:${envelope.name}`,
        causalEvent: {
          version: 1,
          name: envelope.name,
          ...(Object.keys(values).length > 0 ? { values: { ...values } } : {}),
        },
        buildNotification: (liveCtx) => buildHookNotification(envelope.name, values, liveCtx),
        ctx,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.warn(`Hook notification failed (${envelope.name}): ${message}`);
    }
  }

  function registerAgentNotifyTool(): void {
    if (state.agentNotifyRegistered) return;
    state.agentNotifyRegistered = true;

    pi.registerTool({
      name: "agent_notify",
      label: "Agent Notify",
      description:
        "Publish a neutral agent-notify semantic hook with required title and content for configured pi-notify consumers.",
      promptSnippet: "Publish a titled notification hook for the user through pi-notify",
      parameters: Type.Object({
        title: Type.String({ description: "User-facing notification title" }),
        content: Type.String({ description: "User-facing notification content/body" }),
      }),
      async execute(_toolCallId, params) {
        const envelope = Object.freeze({
          version: 1 as const,
          name: AGENT_NOTIFY_HOOK,
          values: Object.freeze({
            TITLE: params.title,
            CONTENT: params.content,
          }),
        });
        // Synchronous construction/emit only. Consumer failures never feed back.
        pi.events.emit(SEMANTIC_HOOK_CHANNEL, envelope);
        return {
          content: [{ type: "text", text: "Notification hook published" }],
          details: undefined,
        };
      },
    });
  }

  function subscribeBus(ctx: ExtensionContext): void {
    if (state.unsubscribeBus || state.cleaned) return;
    if (!pi.events || typeof pi.events.on !== "function") {
      runtime.warn("pi.events is unavailable; semantic hook consumer is disabled for this attachment");
      return;
    }
    state.unsubscribeBus = pi.events.on(SEMANTIC_HOOK_CHANNEL, (data) => {
      handleSemanticHook(data, ctx);
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    // Fresh attachment activation for this registration instance.
    state.cleaned = false;
    subscribeBus(ctx);

    if (state.agentNotifyRegistered) return;
    try {
      const config = await loadConfig({
        agentDir: runtime.agentDir,
        cwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
        warn: runtime.warn,
      });
      if (bindingHasActions(getHookBinding(config.hooks, AGENT_NOTIFY_HOOK))) {
        registerAgentNotifyTool();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.warn(`Cannot evaluate agent_notify registration: ${message}`);
    }
  });

  pi.on("session_shutdown", async () => {
    cleanup();
  });

  pi.on("agent_settled", (event, ctx) => handleLifecycle("agent_settled", event, ctx));
  pi.on("tool_execution_start", (event, ctx) => {
    if (event.toolName !== "ask_user_question") return;
    return handleLifecycle("tool_execution_start:ask_user_question", event, ctx, event);
  });
}
