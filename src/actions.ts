import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { CommandLaunchError } from "./command.js";
import { isShellTupleAction, parseShellTuple } from "./config.js";
import { createNotificationEnvironment, createTemplateValues, renderTemplate } from "./context.js";
import { isBarePowerShellExe, resolvePowerShell } from "./powershell.js";
import type {
  NotificationAction,
  NotificationContext,
  NotificationEnvironment,
  NotificationKey,
  TemplateValues,
} from "./types.js";

export interface ActionRuntime {
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

export interface JsActionScope {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  event: unknown;
  notification: NotificationContext;
}

export interface RunActionsOptions {
  key: NotificationKey;
  actions: NotificationAction[];
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  event: unknown;
  runtime: ActionRuntime;
  notification: NotificationContext;
  /** When true, collect launch/JS failures and throw one aggregated Error after all actions. */
  throwOnFailure: boolean;
  defaultOsc?: { title: string; body: string };
}

function defaultRunJs(code: string, scope: JsActionScope): Promise<void> {
  const runner = new Function(
    "pi",
    "ctx",
    "event",
    "notification",
    `"use strict"; return (async () => { ${code}\n })();`,
  ) as (
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    event: unknown,
    notification: NotificationContext,
  ) => Promise<unknown>;
  return Promise.resolve(runner(scope.pi, scope.ctx, scope.event, scope.notification)).then(() => undefined);
}

function parseOscAction(
  action: Extract<NotificationAction, string>,
  values: TemplateValues,
  key: NotificationKey,
  defaultOsc?: { title: string; body: string },
): { title: string; body: string } {
  if (action === "osc") {
    if (defaultOsc) return defaultOsc;
    if (key === "pi_notify:agent_notify") {
      return {
        title: values.TITLE ?? "Pi",
        body: values.CONTENT ?? "",
      };
    }
    throw new Error(`Missing default OSC copy for ${key}`);
  }

  const template = action.slice(4);
  const separator = template.indexOf("|");
  return {
    title: renderTemplate(template.slice(0, separator), values),
    body: renderTemplate(template.slice(separator + 1), values),
  };
}

function resolveShellInterpreter(interpreter: string, runtime: ActionRuntime): string {
  if (!isBarePowerShellExe(interpreter)) return interpreter;
  const resolved =
    runtime.resolvePowerShell?.() ?? resolvePowerShell({ platform: runtime.platform ?? process.platform });
  return resolved ?? interpreter;
}

function actionLabel(action: NotificationAction): string {
  if (isShellTupleAction(action)) return "shell";
  if (action === "osc" || action.startsWith("osc:")) return "osc";
  if (action.startsWith("cmd:")) return "cmd";
  if (action.startsWith("js:")) return "js";
  return "action";
}

export async function runActions(options: RunActionsOptions): Promise<void> {
  const { actions, runtime, notification, throwOnFailure } = options;
  const values = createTemplateValues(notification);
  const environment = createNotificationEnvironment(notification);
  const failures: string[] = [];
  const runJs = runtime.runJs ?? defaultRunJs;

  for (const action of actions) {
    try {
      if (isShellTupleAction(action)) {
        const { interpreter, args } = parseShellTuple(action);
        const resolved = resolveShellInterpreter(interpreter, runtime);
        runtime.launchShell(resolved, args, notification.cwd, environment);
        continue;
      }

      if (action === "osc" || action.startsWith("osc:")) {
        const { title, body } = parseOscAction(action, values, options.key, options.defaultOsc);
        runtime.launchOsc(title, body);
        continue;
      }

      if (action.startsWith("cmd:")) {
        runtime.launchCommand(action.slice(4), notification.cwd, environment);
        continue;
      }

      if (action.startsWith("js:")) {
        await runJs(action.slice(3), {
          pi: options.pi,
          ctx: options.ctx,
          event: options.event,
          notification,
        });
        continue;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const label = actionLabel(action);
      failures.push(`${label}: ${message}`);
      if (!throwOnFailure) {
        // CommandLaunchError already warned at the launcher; avoid duplicate per-action noise.
        if (!(error instanceof CommandLaunchError)) {
          runtime.warn(`Notification action failed (${label}): ${message}`);
        }
      }
    }
  }

  if (throwOnFailure && failures.length > 0) {
    throw new Error(`pi-notify action failures: ${failures.join("; ")}`);
  }

  if (!throwOnFailure && failures.length > 0) {
    runtime.warn(`Notification actions reported ${failures.length} failure(s): ${failures.join("; ")}`);
  }
}
