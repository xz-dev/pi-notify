export const LIFECYCLE_EVENT_KEYS = [
  "agent_settled",
  "tool_execution_start:ask_user_question",
] as const;

export type LifecycleEventKey = (typeof LIFECYCLE_EVENT_KEYS)[number];

/** Flat argv tuple: first item is shell:<interpreter>, remaining items are exact argv strings. */
export type ShellTupleAction = readonly [shellSpec: `shell:${string}`, ...args: string[]];

export type NotificationAction =
  | "osc"
  | `osc:${string}`
  | `cmd:${string}`
  | `js:${string}`
  | ShellTupleAction;

export interface NotificationBinding {
  delayMs: number;
  actions: NotificationAction[];
}

export interface NotificationConfig {
  events: Partial<Record<LifecycleEventKey, NotificationBinding>>;
  hooks: Record<string, NotificationBinding>;
}

/** Consumer-owned keys that producer values cannot override. */
export const SYSTEM_TEMPLATE_KEYS = [
  "EVENT",
  "HOOK",
  "CWD",
  "SESSION_ID",
  "SESSION_FILE",
  "TOOL",
  "TOOL_CALL_ID",
] as const;

export type SystemTemplateKey = (typeof SYSTEM_TEMPLATE_KEYS)[number];

/** Template map may include system keys plus arbitrary producer UPPER_SNAKE values. */
export type TemplateValues = Record<string, string | undefined>;

export type NotificationEnvironment = Record<string, string | undefined>;

export interface NotificationContext {
  event: string;
  hook?: string;
  cwd: string;
  sessionId: string;
  sessionFile?: string;
  tool?: string;
  toolCallId?: string;
  /** Frozen validated producer values for hooks; empty object for lifecycle events. */
  values: Readonly<Record<string, string>>;
}

export interface JsNotificationContext extends NotificationContext {
  /** Invoke the shared OSC backend; participates in action error aggregation. */
  osc: (title: string, body: string) => void;
}

/** @deprecated Legacy flat key list retained only for migration diagnostics. */
export const LEGACY_TOP_LEVEL_KEYS = [
  "agent_settled",
  "tool_execution_start:ask_user_question",
  "pi_notify:agent_notify",
] as const;
