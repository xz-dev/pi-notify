import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  NOTIFICATION_KEYS,
  type NotificationAction,
  type NotificationConfig,
  type NotificationKey,
} from "./types.js";

interface LoadConfigOptions {
  agentDir: string;
  cwd: string;
  projectTrusted: boolean;
  warn: (message: string) => void;
}

const notificationKeys = new Set<string>(NOTIFICATION_KEYS);

function isAction(value: unknown): value is NotificationAction {
  if (value === "osc") return true;
  if (typeof value !== "string") return false;
  if (value.startsWith("cmd:")) return value.slice(4).trim().length > 0;
  if (!value.startsWith("osc:")) return false;

  const template = value.slice(4);
  const separator = template.indexOf("|");
  return separator > 0 && separator < template.length - 1;
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
