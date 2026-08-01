import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  NOTIFICATION_KEYS,
  type NotificationAction,
  type NotificationConfig,
  type NotificationKey,
  type ShellTupleAction,
} from "./types.js";

interface LoadConfigOptions {
  agentDir: string;
  cwd: string;
  projectTrusted: boolean;
  warn: (message: string) => void;
}

const notificationKeys = new Set<string>(NOTIFICATION_KEYS);

export function isShellTupleAction(value: unknown): value is ShellTupleAction {
  if (!Array.isArray(value) || value.length < 2) return false;
  if (!value.every((item) => typeof item === "string")) return false;
  const head = value[0]!;
  if (!head.startsWith("shell:")) return false;
  const interpreter = head.slice("shell:".length);
  return interpreter.trim().length > 0;
}

function isStringAction(value: unknown): value is Exclude<NotificationAction, ShellTupleAction> {
  if (value === "osc") return true;
  if (typeof value !== "string") return false;
  if (value.startsWith("cmd:")) return value.slice(4).trim().length > 0;
  if (value.startsWith("js:")) return value.slice(3).trim().length > 0;
  // Obsolete string form shell:<interpreter>:<raw> is intentionally invalid.
  if (value.startsWith("shell:")) return false;
  if (!value.startsWith("osc:")) return false;

  const template = value.slice(4);
  const separator = template.indexOf("|");
  return separator > 0 && separator < template.length - 1;
}

function isAction(value: unknown): value is NotificationAction {
  return isStringAction(value) || isShellTupleAction(value);
}

export function parseShellTuple(action: ShellTupleAction): { interpreter: string; args: string[] } {
  const head = action[0];
  return {
    interpreter: head.slice("shell:".length),
    args: action.slice(1) as string[],
  };
}

async function readConfig(path: string, warn: (message: string) => void): Promise<NotificationConfig> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    warn(`Cannot read ${path}: ${String(error)}`);
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    warn(`Invalid JSON in ${path}: ${String(error)}`);
    return {};
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    warn(`Ignoring ${path}: the top level must be an object`);
    return {};
  }

  const config: NotificationConfig = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!notificationKeys.has(key)) {
      warn(`Ignoring unsupported notification key ${JSON.stringify(key)} in ${path}`);
      continue;
    }
    if (!Array.isArray(value)) {
      warn(`Ignoring ${JSON.stringify(key)} in ${path}: its value must be an action array`);
      continue;
    }

    const actions: NotificationAction[] = [];
    for (const action of value) {
      if (isAction(action)) actions.push(action);
      else warn(`Ignoring invalid action ${JSON.stringify(action)} for ${JSON.stringify(key)} in ${path}`);
    }
    config[key as NotificationKey] = actions;
  }
  return config;
}

export async function loadConfig(options: LoadConfigOptions): Promise<NotificationConfig> {
  const globalConfig = await readConfig(join(options.agentDir, "pi-notify.json"), options.warn);
  if (!options.projectTrusted) return globalConfig;

  const projectConfig = await readConfig(join(options.cwd, ".pi", "pi-notify.json"), options.warn);
  return { ...globalConfig, ...projectConfig };
}
