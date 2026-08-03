import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { CommandLaunchError } from "./command.js";
import { isShellTupleAction, parseShellTuple } from "./config.js";
import { createNotificationEnvironment, createTemplateValues, renderTemplate } from "./context.js";
import { isBarePowerShellExe, resolvePowerShell } from "./powershell.js";
import type {
  JsNotificationContext,
  NotificationAction,
  NotificationContext,
  NotificationEnvironment,
  TemplateValues,
} from "./types.js";

export interface ActionRuntime {
  launchBel: () => void;
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
  notification: JsNotificationContext;
}

export interface RunActionsOptions {
  /** Logical key used only for diagnostics and bare-osc default lookup. */
  key: string;
  actions: NotificationAction[];
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  event: unknown;
  runtime: ActionRuntime;
  notification: NotificationContext;
  /** When true, collect launch/JS failures and throw one aggregated Error after all actions. */
  throwOnFailure: boolean;
  defaultOsc?: { title: string; body: string };
  /** Optional generation gate checked before side effects (including notification.osc). */
  isCurrent?: () => boolean;
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
    notification: JsNotificationContext,
  ) => Promise<unknown>;
  return Promise.resolve(runner(scope.pi, scope.ctx, scope.event, scope.notification)).then(() => undefined);
}

function parseOscAction(
  action: Extract<NotificationAction, string>,
  values: TemplateValues,
  key: string,
  defaultOsc?: { title: string; body: string },
): { title: string; body: string } {
  if (action === "osc") {
    if (defaultOsc) return defaultOsc;
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
  if (action === "bel") return "bel";
  if (action === "osc" || action.startsWith("osc:")) return "osc";
  if (action.startsWith("cmd:")) return "cmd";
  if (action.startsWith("js:")) return "js";
  return "action";
}

function buildJsNotification(
  notification: NotificationContext,
  runtime: ActionRuntime,
  failures: string[],
  isCurrent?: () => boolean,
): JsNotificationContext {
  const values = Object.freeze({ ...(notification.values ?? {}) });
  const launch = (label: "bel" | "osc", operation: () => void): void => {
    if (isCurrent && !isCurrent()) return;
    try {
      operation();
    } catch (error) {
      // Record once for aggregate reporting; still rethrow so surrounding js can observe.
      const message = error instanceof Error ? error.message : String(error);
      const failure = `${label}: ${message}`;
      if (!failures.includes(failure)) failures.push(failure);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  return {
    ...notification,
    values,
    bel(): void {
      launch("bel", runtime.launchBel);
    },
    osc(title: string, body: string): void {
      launch("osc", () => runtime.launchOsc(title, body));
    },
  };
}

export async function runActions(options: RunActionsOptions): Promise<void> {
  const { actions, runtime, notification, throwOnFailure, isCurrent } = options;
  if (isCurrent && !isCurrent()) return;

  const values = createTemplateValues(notification);
  const environment = createNotificationEnvironment(notification);
  const failures: string[] = [];
  const runJs = runtime.runJs ?? defaultRunJs;
  const jsNotification = buildJsNotification(notification, runtime, failures, isCurrent);

  for (const action of actions) {
    if (isCurrent && !isCurrent()) return;
    try {
      if (isShellTupleAction(action)) {
        const { interpreter, args } = parseShellTuple(action);
        const resolved = resolveShellInterpreter(interpreter, runtime);
        runtime.launchShell(resolved, args, notification.cwd, environment);
        continue;
      }

      if (action === "bel") {
        runtime.launchBel();
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
          notification: jsNotification,
        });
        if (isCurrent && !isCurrent()) return;
        continue;
      }
    } catch (error) {
      // Stale generation after await/shutdown: no warnings, no further actions, no aggregate report.
      if (isCurrent && !isCurrent()) return;

      const message = error instanceof Error ? error.message : String(error);
      const label = actionLabel(action);
      const failure = `${label}: ${message}`;
      // notification.bel/osc already recorded their own failure; do not also count/report as js failure.
      const alreadyRecordedByHelper =
        label === "js" && (failures.includes(`bel: ${message}`) || failures.includes(`osc: ${message}`));
      if (!alreadyRecordedByHelper && !failures.includes(failure)) failures.push(failure);
      if (!throwOnFailure && !alreadyRecordedByHelper) {
        // CommandLaunchError already warned at the launcher. Terminal actions report through the aggregate below.
        if (!(error instanceof CommandLaunchError) && label !== "bel" && label !== "osc") {
          runtime.warn(`Notification action failed (${label}): ${message}`);
        }
      }
    }
  }

  if (isCurrent && !isCurrent()) return;

  if (throwOnFailure && failures.length > 0) {
    throw new Error(`pi-notify action failures: ${failures.join("; ")}`);
  }

  if (!throwOnFailure && failures.length > 0) {
    runtime.warn(`Notification actions reported ${failures.length} failure(s): ${failures.join("; ")}`);
  }
}
