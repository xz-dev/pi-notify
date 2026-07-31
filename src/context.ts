import { TEMPLATE_KEYS, type NotificationEnvironment, type TemplateValues } from "./types.js";

interface NotificationContext {
  event: string;
  cwd: string;
  sessionId: string;
  sessionFile?: string;
  tool?: string;
  toolCallId?: string;
}

export function createTemplateValues(context: NotificationContext): TemplateValues {
  return {
    EVENT: context.event,
    CWD: context.cwd,
    SESSION_ID: context.sessionId,
    ...(context.sessionFile === undefined ? {} : { SESSION_FILE: context.sessionFile }),
    ...(context.tool === undefined ? {} : { TOOL: context.tool }),
    ...(context.toolCallId === undefined ? {} : { TOOL_CALL_ID: context.toolCallId }),
  };
}

export function createNotificationEnvironment(context: NotificationContext): NotificationEnvironment {
  const values = createTemplateValues(context);
  return Object.fromEntries(
    TEMPLATE_KEYS.flatMap((key) => (values[key] === undefined ? [] : [[`PI_NOTIFY_${key}`, values[key]]])),
  ) as NotificationEnvironment;
}

export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key: string) => values[key as keyof TemplateValues] ?? placeholder);
}
