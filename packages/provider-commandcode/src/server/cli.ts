/**
 * CommandCode runs one process per turn in print mode. `--output-format json`
 * makes it write NDJSON: one `event` frame per agent event and a single
 * `result` frame last. See `reference/headless.md` in the CLI's own bundle.
 */
import type {
  ModelSelection,
  OrchestrationV2ProviderFailure,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProviderModel,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { makeProviderFailure } from "@t3tools/provider-core/server/failure";

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const COMMAND_CODE_EXIT = {
  authentication: 3,
  permissionDenied: 4,
  rateLimited: 5,
  connection: 6,
  server: 7,
  maxTurns: 8,
  insufficientCredits: 10,
} as const;

/**
 * The prompt travels on stdin, never in argv: a `.cmd` shim runs through
 * cmd.exe, which cannot carry a newline and truncates long command lines.
 * `--print` comes last so it takes no value and reads that stdin.
 */
export function commandCodeArgs(input: {
  readonly resumeSessionId: string | null;
  readonly model: string | undefined;
  readonly effort: string | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}): ReadonlyArray<string> {
  return [
    "--no-auto-update",
    "--skip-onboarding",
    "--trust",
    "--output-format",
    "json",
    ...(input.resumeSessionId === null ? [] : ["--resume", input.resumeSessionId]),
    ...(input.model === undefined ? [] : ["--model", input.model]),
    ...(input.effort === undefined ? [] : ["--effort", input.effort]),
    ...(input.interactionMode === "plan" ? ["--plan"] : []),
    // Print mode refuses file writes and shell commands unless `--yolo` is set,
    // even under `--auto-accept`, so full access is the only mode that opens them.
    ...(input.runtimeMode === "full-access" ? ["--yolo"] : []),
    "--print",
  ];
}

/**
 * Passes only an effort the selected model advertises. A stale selection left
 * over from a model switch would otherwise reach the CLI as an invalid level.
 */
export function resolveCommandCodeEffort(
  models: ReadonlyArray<ServerProviderModel>,
  selection: ModelSelection,
): string | undefined {
  const requested = getModelSelectionStringOptionValue(selection, "effort");
  if (requested === undefined) return undefined;
  const descriptor = models
    .find((model) => model.slug === selection.model)
    ?.capabilities?.optionDescriptors?.find((candidate) => candidate.id === "effort");
  return descriptor?.type === "select"
    ? descriptor.options.find((option) => option.id.toLowerCase() === requested.toLowerCase())?.id
    : undefined;
}

export interface CommandCodeResult {
  readonly subtype: string;
  readonly sessionId: string | undefined;
  readonly finalText: string;
  readonly error: string | undefined;
}

export type CommandCodeFrame =
  | { readonly type: "event"; readonly event: Readonly<Record<string, unknown>> }
  | { readonly type: "result"; readonly result: CommandCodeResult };

const asRecord = (value: unknown) => (Predicate.isObject(value) ? value : undefined);
const asString = (value: unknown) => (Predicate.isString(value) ? value : undefined);

export function parseCommandCodeFrame(line: string): CommandCodeFrame | undefined {
  const parsed = decodeJson(line);
  if (parsed._tag === "None") return undefined;
  const frame = asRecord(parsed.value);
  if (frame === undefined) return undefined;
  if (frame["type"] === "event") {
    const event = asRecord(frame["event"]);
    return event === undefined ? undefined : { type: "event", event };
  }
  if (frame["type"] === "result") {
    return {
      type: "result",
      result: {
        subtype: asString(frame["subtype"]) ?? "error",
        sessionId: asString(frame["sessionId"]),
        finalText: asString(frame["finalText"]) ?? "",
        error: asString(frame["error"]),
      },
    };
  }
  return undefined;
}

/** Tool results arrive as content blocks; only their text is shown. */
export function commandCodeToolText(value: unknown): string | undefined {
  if (Predicate.isString(value)) return value;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .flatMap((block) => {
      const record = asRecord(block);
      return record?.["type"] === "text" && Predicate.isString(record["text"])
        ? [record["text"]]
        : [];
    })
    .join("");
  return text.length === 0 ? undefined : text;
}

export function describeCommandCodeError(error: unknown): string | undefined {
  return asString(error) ?? asString(asRecord(error)?.["message"]);
}

/**
 * Only a CLI-level outcome fails a turn. A tool that errors inside the run is a
 * work-log row: the agent sees the error and carries on.
 */
export function commandCodeFailure(input: {
  readonly result: CommandCodeResult | undefined;
  readonly exitCode: number | undefined;
  readonly stderr: string;
  readonly runError: string | undefined;
}): OrchestrationV2ProviderFailure | null {
  const { result, exitCode } = input;
  if (result?.subtype === "success") return null;
  const detail =
    result?.error?.trim() ||
    input.runError?.trim() ||
    input.stderr.trim() ||
    (exitCode === undefined
      ? "CommandCode stopped without a result."
      : `CommandCode exited with code ${exitCode}.`);
  const message = detail.replace(/^Error:\s*/i, "");
  const code = exitCode === undefined ? null : `exit_${exitCode}`;
  if (result?.subtype === "max_turns" || exitCode === COMMAND_CODE_EXIT.maxTurns) {
    return makeProviderFailure({
      class: "provider_error",
      code,
      message:
        "CommandCode stopped at its turn limit before finishing. Send a follow-up message to continue.",
    });
  }
  switch (exitCode) {
    case COMMAND_CODE_EXIT.authentication:
      return makeProviderFailure({
        class: "permission_error",
        code,
        message:
          "CommandCode is not signed in. Run `commandcode login` on the T3 server host, then retry.",
      });
    case COMMAND_CODE_EXIT.permissionDenied:
      return makeProviderFailure({ class: "permission_error", code, message });
    case COMMAND_CODE_EXIT.rateLimited:
    case COMMAND_CODE_EXIT.insufficientCredits:
      return makeProviderFailure({ class: "usage_limit", code, message, retryable: false });
    case COMMAND_CODE_EXIT.connection:
      return makeProviderFailure({ class: "transport_error", code, message, retryable: true });
    case COMMAND_CODE_EXIT.server:
      return makeProviderFailure({ class: "provider_error", code, message, retryable: true });
    default:
      return makeProviderFailure({ class: "provider_error", code, message });
  }
}
