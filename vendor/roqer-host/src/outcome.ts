import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { McpToolImage, McpToolOutcome } from "@roqer/apps/desktop/runtime/mcp-types";

type JsonRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MAX_IMAGES = 8;

const parseJson = (text: string): unknown => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};

/**
 * A bridge result read the way Roqer's desktop `McpClient` reads one: the plugin refuses with a
 * 200 whose payload is `{error}` or `{success: false}`, so those are failures too.
 */
export function outcomeFromResult(result: CallToolResult, durationMs = 0): McpToolOutcome {
  const texts: string[] = [];
  const images: McpToolImage[] = [];
  for (const block of result.content ?? []) {
    if (block.type === "text") texts.push(block.text);
    else if (block.type === "image" && images.length < MAX_IMAGES) {
      images.push({ data: block.data, mediaType: block.mimeType as McpToolImage["mediaType"] });
    }
  }
  const text = texts.join("\n");
  const data = result.structuredContent ?? parseJson(text);
  let ok = result.isError !== true;
  let errorCode: string | undefined;
  let message: string | undefined;
  if (isRecord(data) && data.success === false) {
    ok = false;
    if (typeof data.errorCode === "string") errorCode = data.errorCode;
    if (typeof data.message === "string") message = data.message;
  }
  if (isRecord(data) && typeof data.error === "string" && data.success !== true) {
    ok = false;
    message ??= typeof data.message === "string" ? data.message : data.error;
  }
  if (
    !ok &&
    message === undefined &&
    isRecord(data) &&
    isRecord(data.error) &&
    typeof data.error.message === "string"
  ) {
    message = data.error.message;
  }
  return {
    ok,
    data,
    text,
    ...(images.length > 0 ? { images } : {}),
    httpStatus: 200,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(message === undefined ? {} : { message }),
    durationMs,
  };
}

export function failedOutcome(message: string, errorCode = "request_failed"): McpToolOutcome {
  return {
    ok: false,
    data: undefined,
    text: message,
    httpStatus: 0,
    errorCode,
    message,
    durationMs: 0,
  };
}

/** What goes back to SealCode: the outcome's text (or its data) and its images. */
export function resultFromOutcome(outcome: McpToolOutcome, note?: string): CallToolResult {
  const body =
    outcome.text.length > 0
      ? outcome.text
      : outcome.data !== undefined
        ? JSON.stringify(outcome.data, null, 2)
        : (outcome.message ?? (outcome.ok ? "Done." : "The call failed."));
  const text = note === undefined ? body : `${body}\n\n${note}`;
  return {
    content: [
      { type: "text", text },
      ...(outcome.images ?? []).map((image) => ({
        type: "image" as const,
        data: image.data,
        mimeType: image.mediaType,
      })),
    ],
    ...(outcome.ok ? {} : { isError: true }),
  };
}

/** Roqer bounds what one Studio result may put in front of the model. */
export const MAX_RESULT_CHARS = 24_000;

export function boundResult(result: CallToolResult): CallToolResult {
  let budget = MAX_RESULT_CHARS;
  let trimmed = false;
  const content = (result.content ?? []).map((block) => {
    if (block.type !== "text") return block;
    if (block.text.length <= budget) {
      budget -= block.text.length;
      return block;
    }
    trimmed = true;
    const kept = block.text.slice(0, Math.max(0, budget));
    budget = 0;
    return { ...block, text: kept };
  });
  if (!trimmed) return result;
  content.push({
    type: "text",
    text: `[Result shortened to ${MAX_RESULT_CHARS} characters. Ask for less: a narrower path, a line_range, a smaller max_results or depth.]`,
  });
  const { structuredContent: _dropped, ...rest } = result;
  return { ...rest, content };
}
