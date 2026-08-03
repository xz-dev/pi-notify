import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  clipDiagnostic,
  isKebabCaseName,
  isPlainObject,
  MAX_DIAGNOSTIC_SNIPPET,
  readOwnDataProperty,
} from "./semantic-hook.js";
import {
  LEGACY_TOP_LEVEL_KEYS,
  LIFECYCLE_EVENT_KEYS,
  type LifecycleEventKey,
  type NotificationAction,
  type NotificationBinding,
  type NotificationConfig,
  type ShellTupleAction,
} from "./types.js";

interface LoadConfigOptions {
  agentDir: string;
  cwd: string;
  projectTrusted: boolean;
  warn: (message: string) => void;
}

/** Node timer maximum (2^31-1). */
export const MAX_DELAY_MS = 2_147_483_647;

/** Bound action text so malformed config diagnostics stay finite. */
export const MAX_ACTION_TEXT_LENGTH = 8_192;

const lifecycleKeys = new Set<string>(LIFECYCLE_EVENT_KEYS);
const legacyTopLevelKeys = new Set<string>(LEGACY_TOP_LEVEL_KEYS);

function emptyHooks(): Record<string, NotificationBinding> {
  return Object.create(null) as Record<string, NotificationBinding>;
}

function emptyEvents(): Partial<Record<LifecycleEventKey, NotificationBinding>> {
  return Object.create(null) as Partial<Record<LifecycleEventKey, NotificationBinding>>;
}

export function isShellTupleAction(value: unknown): value is ShellTupleAction {
  if (!Array.isArray(value) || value.length < 2) return false;
  if (!value.every((item) => typeof item === "string")) return false;
  const head = value[0]!;
  if (!head.startsWith("shell:")) return false;
  if (head.length > MAX_ACTION_TEXT_LENGTH) return false;
  if (value.some((item) => item.length > MAX_ACTION_TEXT_LENGTH)) return false;
  const interpreter = head.slice("shell:".length);
  return interpreter.trim().length > 0;
}

function isStringAction(value: unknown): value is Exclude<NotificationAction, ShellTupleAction> {
  if (value === "bel" || value === "osc") return true;
  if (typeof value !== "string") return false;
  if (value.length > MAX_ACTION_TEXT_LENGTH) return false;
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

function isSafeDelayMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_DELAY_MS
  );
}

function formatActionForDiagnostic(action: unknown): string {
  try {
    const text = typeof action === "string" ? action : JSON.stringify(action);
    return clipDiagnostic(text ?? String(action));
  } catch {
    return "[unprintable action]";
  }
}

/**
 * Parse an actions array.
 * - `[]` is a valid explicit disable list.
 * - A nonempty array whose every entry is rejected is invalid (caller preserves lower-precedence binding).
 * - Mixed arrays keep only valid entries.
 */
function parseActions(
  value: unknown,
  pathLabel: string,
  bindingLabel: string,
  options: { rejectBareOsc: boolean; warn: (message: string) => void },
): NotificationAction[] | undefined {
  if (!Array.isArray(value)) {
    options.warn(`Ignoring ${bindingLabel} in ${pathLabel}: actions must be an array`);
    return undefined;
  }

  const actions: NotificationAction[] = [];
  let rejected = 0;
  for (const action of value) {
    if (options.rejectBareOsc && action === "osc") {
      options.warn(
        `Ignoring bare osc action for hook binding ${bindingLabel} in ${pathLabel}: hook bindings require osc:<title>|<body> or notification.osc in js`,
      );
      rejected += 1;
      continue;
    }
    if (isAction(action)) actions.push(action);
    else {
      rejected += 1;
      options.warn(
        `Ignoring invalid action ${JSON.stringify(formatActionForDiagnostic(action))} for ${bindingLabel} in ${pathLabel}`,
      );
    }
  }

  // Explicit empty actions is a valid whole-unit disable.
  if (value.length === 0) return actions;

  // Nonempty but all-rejected means the higher-precedence binding is invalid.
  if (actions.length === 0 && rejected > 0) {
    options.warn(
      `Ignoring ${bindingLabel} in ${pathLabel}: no valid actions after validation`,
    );
    return undefined;
  }

  return actions;
}

function parseBinding(
  value: unknown,
  pathLabel: string,
  bindingLabel: string,
  options: { rejectBareOsc: boolean; warn: (message: string) => void },
): NotificationBinding | undefined {
  if (!isPlainObject(value)) {
    options.warn(`Ignoring ${bindingLabel} in ${pathLabel}: binding must be an object`);
    return undefined;
  }

  if (!Object.hasOwn(value, "actions")) {
    options.warn(`Ignoring ${bindingLabel} in ${pathLabel}: actions is required`);
    return undefined;
  }

  const actionsProp = readOwnDataProperty(value, "actions");
  if (!actionsProp.ok) {
    options.warn(`Ignoring ${bindingLabel} in ${pathLabel}: actions ${actionsProp.reason}`);
    return undefined;
  }

  let delayMs = 0;
  if (Object.hasOwn(value, "delayMs")) {
    const delayProp = readOwnDataProperty(value, "delayMs");
    if (!delayProp.ok) {
      options.warn(`Ignoring ${bindingLabel} in ${pathLabel}: delayMs ${delayProp.reason}`);
      return undefined;
    }
    if (delayProp.value !== undefined) {
      if (!isSafeDelayMs(delayProp.value)) {
        options.warn(
          `Ignoring ${bindingLabel} in ${pathLabel}: delayMs must be a nonnegative safe integer ms within the Node timer maximum`,
        );
        return undefined;
      }
      delayMs = delayProp.value;
    }
  }

  const actions = parseActions(actionsProp.value, pathLabel, bindingLabel, options);
  if (actions === undefined) return undefined;

  return { delayMs, actions };
}

interface ParsedFile {
  config: NotificationConfig;
  sawLegacyTopLevel: boolean;
}

function emptyConfig(): NotificationConfig {
  return { events: emptyEvents(), hooks: emptyHooks() };
}

function ownKeys(object: object): string[] {
  try {
    return Object.keys(object);
  } catch {
    return [];
  }
}

async function readNestedConfig(path: string, warn: (message: string) => void): Promise<ParsedFile> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: emptyConfig(), sawLegacyTopLevel: false };
    }
    warn(`Cannot read ${path}: ${String(error)}`);
    return { config: emptyConfig(), sawLegacyTopLevel: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    warn(`Invalid JSON in ${path}: ${String(error)}`);
    return { config: emptyConfig(), sawLegacyTopLevel: false };
  }

  if (!isPlainObject(parsed)) {
    warn(`Ignoring ${path}: the top level must be an object`);
    return { config: emptyConfig(), sawLegacyTopLevel: false };
  }

  const root = parsed;
  const config = emptyConfig();
  let sawLegacyTopLevel = false;

  for (const key of ownKeys(root)) {
    if (key === "events" || key === "hooks") continue;
    const prop = readOwnDataProperty(root, key);
    if (!prop.ok) {
      warn(`Ignoring unsupported top-level key ${JSON.stringify(clipDiagnostic(key))} in ${path}: ${prop.reason}`);
      continue;
    }
    if (legacyTopLevelKeys.has(key)) {
      sawLegacyTopLevel = true;
      continue;
    }
    // Unknown top-level keys other than legacy event names: ignore quietly unless they look like old flat config.
    if (isPlainObject(prop.value)) {
      warn(`Ignoring unsupported top-level key ${JSON.stringify(clipDiagnostic(key))} in ${path}`);
    } else if (Array.isArray(prop.value)) {
      sawLegacyTopLevel = true;
    } else {
      warn(`Ignoring unsupported top-level key ${JSON.stringify(clipDiagnostic(key))} in ${path}`);
    }
  }

  if (sawLegacyTopLevel) {
    warn(
      `Ignoring legacy top-level pi-notify configuration in ${path}; migrate to nested events/hooks bindings`,
    );
  }

  if (Object.hasOwn(root, "events")) {
    const eventsProp = readOwnDataProperty(root, "events");
    if (!eventsProp.ok) {
      warn(`Ignoring events in ${path}: ${eventsProp.reason}`);
    } else if (!isPlainObject(eventsProp.value)) {
      warn(`Ignoring events in ${path}: value must be an object`);
    } else {
      for (const name of ownKeys(eventsProp.value)) {
        if (!lifecycleKeys.has(name)) {
          warn(`Ignoring unsupported event binding ${JSON.stringify(clipDiagnostic(name))} in ${path}`);
          continue;
        }
        const bindingProp = readOwnDataProperty(eventsProp.value, name);
        if (!bindingProp.ok) {
          warn(`Ignoring events.${name} in ${path}: ${bindingProp.reason}`);
          continue;
        }
        const binding = parseBinding(bindingProp.value, path, `events.${name}`, {
          rejectBareOsc: false,
          warn,
        });
        if (binding) config.events[name as LifecycleEventKey] = binding;
      }
    }
  }

  if (Object.hasOwn(root, "hooks")) {
    const hooksProp = readOwnDataProperty(root, "hooks");
    if (!hooksProp.ok) {
      warn(`Ignoring hooks in ${path}: ${hooksProp.reason}`);
    } else if (!isPlainObject(hooksProp.value)) {
      warn(`Ignoring hooks in ${path}: value must be an object`);
    } else {
      for (const name of ownKeys(hooksProp.value)) {
        if (!isKebabCaseName(name)) {
          warn(
            `Ignoring invalid hook name ${JSON.stringify(clipDiagnostic(name))} in ${path}: expected lowercase kebab-case`,
          );
          continue;
        }
        const bindingProp = readOwnDataProperty(hooksProp.value, name);
        if (!bindingProp.ok) {
          warn(`Ignoring hooks.${clipDiagnostic(name)} in ${path}: ${bindingProp.reason}`);
          continue;
        }
        const binding = parseBinding(bindingProp.value, path, `hooks.${name}`, {
          rejectBareOsc: true,
          warn,
        });
        if (binding) config.hooks[name] = binding;
      }
    }
  }

  return { config, sawLegacyTopLevel };
}

function mergeConfigs(base: NotificationConfig, overlay: NotificationConfig): NotificationConfig {
  const events = emptyEvents();
  const hooks = emptyHooks();
  for (const key of Object.keys(base.events) as LifecycleEventKey[]) {
    const binding = base.events[key];
    if (binding) events[key] = binding;
  }
  for (const key of Object.keys(overlay.events) as LifecycleEventKey[]) {
    const binding = overlay.events[key];
    if (binding) events[key] = binding;
  }
  for (const key of Object.keys(base.hooks)) {
    if (Object.hasOwn(base.hooks, key)) hooks[key] = base.hooks[key]!;
  }
  for (const key of Object.keys(overlay.hooks)) {
    if (Object.hasOwn(overlay.hooks, key)) hooks[key] = overlay.hooks[key]!;
  }
  return { events, hooks };
}

/**
 * Load nested events/hooks configuration.
 * Project bindings replace matching global bindings as whole units when trusted.
 * An invalid higher-precedence binding is ignored and does not erase a valid lower-precedence binding.
 * An explicit empty `actions` array is a valid whole-unit disable.
 */
export async function loadConfig(options: LoadConfigOptions): Promise<NotificationConfig> {
  const globalParsed = await readNestedConfig(join(options.agentDir, "pi-notify.json"), options.warn);
  if (!options.projectTrusted) return globalParsed.config;

  // Capture only valid project bindings; invalid ones warn during parse and are omitted,
  // so merge keeps the corresponding global binding.
  const projectParsed = await readNestedConfig(join(options.cwd, ".pi", "pi-notify.json"), options.warn);
  return mergeConfigs(globalParsed.config, projectParsed.config);
}

/** Safe own-property hook lookup; avoids prototype pollution on ordinary maps. */
export function getHookBinding(
  hooks: Record<string, NotificationBinding>,
  name: string,
): NotificationBinding | undefined {
  return Object.hasOwn(hooks, name) ? hooks[name] : undefined;
}
