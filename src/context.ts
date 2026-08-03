import {
  SYSTEM_TEMPLATE_KEYS,
  type NotificationContext,
  type NotificationEnvironment,
  type TemplateValues,
} from "./types.js";

const systemKeySet = new Set<string>(SYSTEM_TEMPLATE_KEYS);

export function createTemplateValues(context: NotificationContext): TemplateValues {
  const values: TemplateValues = {
    EVENT: context.event,
    CWD: context.cwd,
    SESSION_ID: context.sessionId,
  };

  if (context.hook !== undefined) values.HOOK = context.hook;
  if (context.sessionFile !== undefined) values.SESSION_FILE = context.sessionFile;
  if (context.tool !== undefined) values.TOOL = context.tool;
  if (context.toolCallId !== undefined) values.TOOL_CALL_ID = context.toolCallId;

  for (const [key, value] of Object.entries(context.values ?? {})) {
    if (systemKeySet.has(key)) continue;
    values[key] = value;
  }

  return values;
}

export function createNotificationEnvironment(context: NotificationContext): NotificationEnvironment {
  const values = createTemplateValues(context);
  const environment: NotificationEnvironment = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) environment[`PI_NOTIFY_${key}`] = value;
  }
  return environment;
}

export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key: string) => values[key] ?? placeholder);
}
