import {
  TEMPLATE_KEYS,
  type NotificationContext,
  type NotificationEnvironment,
  type TemplateValues,
} from "./types.js";

export function createTemplateValues(context: NotificationContext): TemplateValues {
  return {
    EVENT: context.event,
    CWD: context.cwd,
    SESSION_ID: context.sessionId,
    ...(context.sessionFile === undefined ? {} : { SESSION_FILE: context.sessionFile }),
    ...(context.tool === undefined ? {} : { TOOL: context.tool }),
    ...(context.toolCallId === undefined ? {} : { TOOL_CALL_ID: context.toolCallId }),
    ...(context.title === undefined ? {} : { TITLE: context.title }),
    ...(context.content === undefined ? {} : { CONTENT: context.content }),
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
