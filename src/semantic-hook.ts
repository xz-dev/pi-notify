export const SEMANTIC_HOOK_CHANNEL = "pi:semantic-hook:v1" as const;

/** Bounded protocol sizes keep diagnostics and validation proportionate. */
export const MAX_HOOK_NAME_LENGTH = 128;
export const MAX_VALUES_KEY_LENGTH = 128;
export const MAX_VALUES_VALUE_LENGTH = 4_096;
export const MAX_DIAGNOSTIC_SNIPPET = 120;

export interface SemanticHookV1 {
  readonly version: 1;
  readonly name: string;
  readonly values?: Readonly<Record<string, string>>;
}

export type ParseSemanticHookResult =
  | { ok: true; envelope: SemanticHookV1 }
  | { ok: false; reason: string };

const KEBAB_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UPPER_SNAKE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

export function isKebabCaseName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_HOOK_NAME_LENGTH && KEBAB_NAME.test(name);
}

export function isUpperSnakeKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_VALUES_KEY_LENGTH && UPPER_SNAKE.test(key);
}

/** Ordinary object or null-prototype record; rejects Date, class instances, arrays, and custom protos. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function clipDiagnostic(text: string): string {
  if (text.length <= MAX_DIAGNOSTIC_SNIPPET) return text;
  return `${text.slice(0, MAX_DIAGNOSTIC_SNIPPET)}…`;
}

/**
 * Read one own data property without invoking accessors or inherited fields.
 * Throws from getters are contained and reported as failure.
 */
export function readOwnDataProperty(
  object: object,
  key: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    if (!Object.hasOwn(object, key)) return { ok: false, reason: "missing" };
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || "get" in descriptor || "set" in descriptor || !("value" in descriptor)) {
      return { ok: false, reason: "not a data property" };
    }
    return { ok: true, value: descriptor.value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `property access failed: ${clipDiagnostic(message)}` };
  }
}

function freezeValues(values: Record<string, string>): Readonly<Record<string, string>> {
  return Object.freeze({ ...values });
}

/**
 * Validate a fresh semantic-hook envelope and return a frozen copy of name/values.
 * Only own data properties on plain objects are accepted; unknown top-level fields are dropped.
 */
export function parseSemanticHook(data: unknown): ParseSemanticHookResult {
  if (!isPlainObject(data)) {
    return { ok: false, reason: "envelope must be a plain object" };
  }

  const versionProp = readOwnDataProperty(data, "version");
  if (!versionProp.ok) {
    return { ok: false, reason: versionProp.reason === "missing" ? "version must be exactly 1" : versionProp.reason };
  }
  if (versionProp.value !== 1) {
    return { ok: false, reason: "version must be exactly 1" };
  }

  const nameProp = readOwnDataProperty(data, "name");
  if (!nameProp.ok) {
    return {
      ok: false,
      reason: nameProp.reason === "missing" ? "name must be lowercase kebab-case" : nameProp.reason,
    };
  }
  if (typeof nameProp.value !== "string" || !isKebabCaseName(nameProp.value)) {
    return { ok: false, reason: "name must be lowercase kebab-case" };
  }

  let values: Readonly<Record<string, string>> | undefined;
  if (Object.hasOwn(data, "values")) {
    const valuesProp = readOwnDataProperty(data, "values");
    if (!valuesProp.ok) {
      return { ok: false, reason: valuesProp.reason };
    }
    if (valuesProp.value === undefined) {
      // own data property set to undefined is treated as absent values
    } else if (!isPlainObject(valuesProp.value)) {
      return { ok: false, reason: "values must be a plain non-array object" };
    } else {
      const copied: Record<string, string> = Object.create(null);
      let keys: string[];
      try {
        keys = Object.keys(valuesProp.value);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: `values keys inaccessible: ${clipDiagnostic(message)}` };
      }
      for (const key of keys) {
        if (!isUpperSnakeKey(key)) {
          return { ok: false, reason: `invalid values key ${JSON.stringify(clipDiagnostic(key))}` };
        }
        const entry = readOwnDataProperty(valuesProp.value, key);
        if (!entry.ok) {
          return { ok: false, reason: `values.${clipDiagnostic(key)}: ${entry.reason}` };
        }
        if (typeof entry.value !== "string") {
          return { ok: false, reason: `values.${clipDiagnostic(key)} must be a string` };
        }
        if (entry.value.length > MAX_VALUES_VALUE_LENGTH) {
          return { ok: false, reason: `values.${clipDiagnostic(key)} exceeds ${MAX_VALUES_VALUE_LENGTH} characters` };
        }
        copied[key] = entry.value;
      }
      values = freezeValues(copied);
    }
  }

  const envelope: SemanticHookV1 =
    values === undefined
      ? Object.freeze({ version: 1 as const, name: nameProp.value })
      : Object.freeze({ version: 1 as const, name: nameProp.value, values });

  return { ok: true, envelope };
}
