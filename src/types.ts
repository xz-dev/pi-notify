export const NOTIFICATION_KEYS = [
  "agent_settled",
  "tool_execution_start:ask_user_question",
  "pi_notify:agent_notify",
] as const;

export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

/** Flat argv tuple: first item is shell:<interpreter>, remaining items are exact argv strings. */
export type ShellTupleAction = readonly [shellSpec: `shell:${string}`, ...args: string[]];

export type NotificationAction =
  | "osc"
  | `osc:${string}`
  | `cmd:${string}`
  | `js:${string}`
  | ShellTupleAction;

export type NotificationConfig = Partial<Record<NotificationKey, NotificationAction[]>>;

export const TEMPLATE_KEYS = [
  "EVENT",
  "CWD",
  "SESSION_ID",
  "SESSION_FILE",
  "TOOL",
  "TOOL_CALL_ID",
  "TITLE",
  "CONTENT",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export type TemplateValues = Partial<Record<TemplateKey, string>>;
export type NotificationEnvironment = Partial<Record<`PI_NOTIFY_${TemplateKey}`, string>>;

export interface NotificationContext {
  event: string;
  cwd: string;
  sessionId: string;
  sessionFile?: string;
  tool?: string;
  toolCallId?: string;
  title?: string;
  content?: string;
}
