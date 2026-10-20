import { StudioLimits } from "./protocol.ts";

export type StudioContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export interface StudioToolResult {
  readonly content: ReadonlyArray<StudioContentBlock>;
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Fields the bridge or plugin use for themselves that the model never needs. */
const INTERNAL_KEYS = new Set(["requestId", "pluginSessionId", "sessionToken", "_debug"]);

const stripInternal = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripInternal);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!INTERNAL_KEYS.has(key)) out[key] = stripInternal(entry);
  }
  return out;
};

/** A plugin answer is a failure when it carries `error` without `success: true`, or `success: false`. */
export const isFailurePayload = (payload: unknown): boolean =>
  isRecord(payload) &&
  (payload.success === false || ("error" in payload && payload.success !== true));

/**
 * One JSON object for the model, mirrored as text for clients that ignore structured content.
 * Oversized results are cut with a note rather than handed over whole.
 */
export const jsonResult = (
  value: unknown,
  options: { readonly isError?: boolean; readonly suffix?: string } = {},
): StudioToolResult => {
  const cleaned = stripInternal(value);
  let text = JSON.stringify(cleaned, null, 1);
  if (options.suffix !== undefined) text = `${text}\n\n${options.suffix}`;
  const isError = options.isError ?? isFailurePayload(cleaned);
  if (text.length > StudioLimits.maxResultChars) {
    return {
      content: [
        {
          type: "text",
          text: `${text.slice(0, StudioLimits.maxResultChars)}\n\n[Result cut at ${String(StudioLimits.maxResultChars)} characters. Ask for less: a narrower path, a line_range, a lower maxResults or a filter.]`,
        },
      ],
      ...(isError ? { isError } : {}),
    };
  }
  return {
    content: [{ type: "text", text }],
    ...(isRecord(cleaned) && options.suffix === undefined ? { structuredContent: cleaned } : {}),
    ...(isError ? { isError } : {}),
  };
};

/** A text block holding one compact JSON value. */
export const jsonText = (value: unknown): StudioContentBlock => ({
  type: "text",
  text: JSON.stringify(value),
});

export const errorResult = (
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
): StudioToolResult => jsonResult({ error, message, ...extra }, { isError: true });
