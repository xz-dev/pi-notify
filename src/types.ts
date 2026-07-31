export const NOTIFICATION_KEYS = ["agent_settled", "tool_execution_start:ask_user_question"] as const;

export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];
export type NotificationAction = "osc" | `osc:${string}` | `cmd:${string}`;
export type NotificationConfig = Partial<Record<NotificationKey, NotificationAction[]>>;

export const TEMPLATE_KEYS = ["EVENT", "CWD", "SESSION_ID", "SESSION_FILE", "TOOL", "TOOL_CALL_ID"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export type TemplateValues = Partial<Record<TemplateKey, string>>;
export type NotificationEnvironment = Record<`PI_NOTIFY_${TemplateKey}`, string>;
