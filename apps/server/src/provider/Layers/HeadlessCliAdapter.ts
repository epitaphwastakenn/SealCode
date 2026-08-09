import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";

import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderUserInputAnswers,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { normalizeHeadlessCliModel } from "./HeadlessCliProvider.ts";

export interface HeadlessCliSettings {
  readonly binaryPath: string;
}

export interface HeadlessCliAdapterOptions {
  readonly provider: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly environment: NodeJS.ProcessEnv;
  readonly protocol: "antigravity" | "commandcode";
}

interface SessionContext {
  session: ProviderSession;
  process: NodeChildProcess.ChildProcessWithoutNullStreams | null;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
}

interface CliResult {
  readonly sessionId?: string;
  readonly finalText: string;
  readonly success: boolean;
  readonly error?: string;
  readonly usage?: unknown;
  readonly stopReason?: string;
}

type HeadlessCliAdapterError =
  | ProviderAdapterRequestError
  | ProviderAdapterSessionNotFoundError
  | ProviderAdapterValidationError;

const nowIso = () => new Date().toISOString();

function parseResumeCursor(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const candidate = record.conversationId ?? record.sessionId;
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}

function resolveReasoningEffort(input: ProviderSendTurnInput): string | undefined {
  return (
    getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort") ??
    getModelSelectionStringOptionValue(input.modelSelection, "effort")
  );
}

function commandArgs(input: {
  readonly protocol: HeadlessCliAdapterOptions["protocol"];
  readonly prompt: string;
  readonly resumeCursor?: string;
  readonly send: ProviderSendTurnInput;
  readonly session: ProviderSession;
}): ReadonlyArray<string> {
  const model = normalizeHeadlessCliModel(
    input.protocol,
    input.send.modelSelection?.model ?? input.session.model,
  );
  const effort = resolveReasoningEffort(input.send);
  if (input.protocol === "antigravity") {
    return [
      "--print",
      input.prompt,
      "--output-format",
      "stream-json",
      "--print-timeout",
      "5m",
      ...(input.resumeCursor ? ["--conversation", input.resumeCursor] : []),
      ...(model ? ["--model", model] : []),
      ...(effort ? ["--effort", effort] : []),
      ...(input.send.interactionMode === "plan" ? ["--mode", "plan"] : []),
      ...(input.session.runtimeMode === "full-access" || input.session.runtimeMode === "auto"
        ? ["--dangerously-skip-permissions"]
        : []),
    ];
  }
  return [
    "--no-auto-update",
    "--skip-onboarding",
    "--trust",
    "--max-turns",
    "100",
    "--print",
    input.prompt,
    "--output-format",
    "json",
    ...(input.resumeCursor ? ["--resume", input.resumeCursor] : []),
    ...(model ? ["--model", model] : []),
    ...(effort ? ["--effort", effort] : []),
    ...(input.send.interactionMode === "plan" ? ["--plan"] : []),
    ...(input.session.runtimeMode === "full-access"
      ? ["--yolo"]
      : input.session.runtimeMode === "auto" || input.session.runtimeMode === "auto-accept-edits"
        ? ["--auto-accept"]
        : []),
  ];
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export const makeHeadlessCliAdapter = Effect.fn("makeHeadlessCliAdapter")(function* (
  settings: HeadlessCliSettings,
  options: HeadlessCliAdapterOptions,
) {
  const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const hostPlatform = yield* HostProcessPlatform;
  const adapterScope = yield* Effect.scope;
  const sessions = new Map<ThreadId, SessionContext>();

  const publish = (event: ProviderRuntimeEvent) =>
    Effect.runFork(PubSub.publish(runtimeEvents, event).pipe(Effect.asVoid));
  const stamp = () => ({ eventId: EventId.make(NodeCrypto.randomUUID()), createdAt: nowIso() });

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<SessionContext, ProviderAdapterSessionNotFoundError> => {
    const context = sessions.get(threadId);
    return context
      ? Effect.succeed(context)
      : Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: options.provider,
            threadId,
          }),
        );
  };

  const startSession = (input: ProviderSessionStartInput) =>
    Effect.sync(() => {
      const updatedAt = nowIso();
      const resumeCursor = parseResumeCursor(input.resumeCursor);
      const session: ProviderSession = {
        provider: options.provider,
        providerInstanceId: options.instanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        threadId: input.threadId,
        ...(resumeCursor ? { resumeCursor } : {}),
        createdAt: updatedAt,
        updatedAt,
      };
      sessions.set(input.threadId, { session, process: null, turns: [] });
      publish({
        type: "session.started",
        ...stamp(),
        provider: options.provider,
        providerInstanceId: options.instanceId,
        threadId: input.threadId,
        payload: {
          message: `${options.protocol === "antigravity" ? "Antigravity" : "CommandCode"} session ready.`,
          ...(resumeCursor ? { resume: resumeCursor } : {}),
        },
      });
      return session;
    });

  const sendTurn: ProviderAdapterShape<HeadlessCliAdapterError>["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      if (context.process) {
        return yield* new ProviderAdapterRequestError({
          provider: options.provider,
          method: "sendTurn",
          detail: `Thread '${input.threadId}' already has a running turn.`,
        });
      }
      if (input.attachments && input.attachments.length > 0) {
        return yield* new ProviderAdapterValidationError({
          provider: options.provider,
          operation: "sendTurn",
          issue: "Images require the configured Codex image viewer before this provider can run.",
        });
      }
      const prompt = input.input?.trim();
      if (!prompt) {
        return yield* new ProviderAdapterValidationError({
          provider: options.provider,
          operation: "sendTurn",
          issue: "A non-empty prompt is required.",
        });
      }
      const turnId = TurnId.make(NodeCrypto.randomUUID());
      const assistantItemId = RuntimeItemId.make(`assistant-${turnId}`);
      const resumeCursor = parseResumeCursor(context.session.resumeCursor);
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        updatedAt: nowIso(),
      };
      publish({
        type: "turn.started",
        ...stamp(),
        provider: options.provider,
        providerInstanceId: options.instanceId,
        threadId: input.threadId,
        turnId,
        payload: {
          ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
          ...(resolveReasoningEffort(input) ? { effort: resolveReasoningEffort(input) } : {}),
        },
      });

      const run = Effect.callback<void>((resume) => {
        const args = commandArgs({
          protocol: options.protocol,
          prompt,
          ...(resumeCursor ? { resumeCursor } : {}),
          send: input,
          session: context.session,
        });
        const child = NodeChildProcess.spawn(settings.binaryPath, args, {
          cwd: context.session.cwd,
          env: options.environment,
          windowsHide: true,
          shell: hostPlatform === "win32" && /\.(?:cmd|bat)$/i.test(settings.binaryPath),
        });
        context.process = child;
        let stdoutBuffer = "";
        let stderr = "";
        let assistantStarted = false;
        let assistantText = "";
        let result: CliResult | undefined;
        const ensureAssistantStarted = () => {
          if (assistantStarted) return;
          assistantStarted = true;
          publish({
            type: "item.started",
            ...stamp(),
            provider: options.provider,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: assistantItemId,
            payload: { itemType: "assistant_message", status: "inProgress" },
          });
        };
        const emitText = (text: string) => {
          if (!text) return;
          ensureAssistantStarted();
          assistantText += text;
          publish({
            type: "content.delta",
            ...stamp(),
            provider: options.provider,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: assistantItemId,
            payload: { streamKind: "assistant_text", delta: text },
          });
        };
        const emitTool = (event: Record<string, unknown>) => {
          const raw = event.event;
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
          const detail = raw as Record<string, unknown>;
          const type = typeof detail.type === "string" ? detail.type : "tool";
          if (!type.startsWith("tool_")) return;
          const toolCallId =
            typeof detail.toolCallId === "string" ? detail.toolCallId : NodeCrypto.randomUUID();
          const completed = /(?:completed|finished|result|failed|error)/i.test(type);
          publish({
            type: completed ? "item.completed" : "item.updated",
            ...stamp(),
            provider: options.provider,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: RuntimeItemId.make(toolCallId),
            payload: {
              itemType: "dynamic_tool_call",
              status: completed
                ? /failed|error/i.test(type)
                  ? "failed"
                  : "completed"
                : "inProgress",
              title:
                typeof detail.toolName === "string" ? detail.toolName : type.replaceAll("_", " "),
              ...(typeof detail.description === "string" ? { detail: detail.description } : {}),
              data: detail,
            },
          });
        };
        const handleLine = (line: string) => {
          const frame = parseJsonLine(line.trim());
          if (!frame) return;
          if (options.protocol === "antigravity") {
            if (frame.event === "init" && typeof frame.conversation_id === "string") {
              result = { sessionId: frame.conversation_id, finalText: "", success: true };
              return;
            }
            if (frame.event === "step_update") {
              const step = frame.step_update;
              if (step && typeof step === "object" && !Array.isArray(step)) {
                const payload = step as Record<string, unknown>;
                if (
                  payload.step_type === "agent_response" &&
                  typeof payload.text_delta === "string"
                ) {
                  emitText(payload.text_delta);
                } else if (
                  typeof payload.step_type === "string" &&
                  !["user_input", "unknown", "checkpoint"].includes(payload.step_type)
                ) {
                  const completed = payload.state === "DONE";
                  publish({
                    type: completed ? "item.completed" : "item.updated",
                    ...stamp(),
                    provider: options.provider,
                    providerInstanceId: options.instanceId,
                    threadId: input.threadId,
                    turnId,
                    itemId: RuntimeItemId.make(
                      `antigravity-${turnId}-${String(payload.step_index ?? NodeCrypto.randomUUID())}`,
                    ),
                    payload: {
                      itemType: "dynamic_tool_call",
                      status: completed ? "completed" : "inProgress",
                      title: payload.step_type,
                      data: payload,
                    },
                  });
                }
              }
              return;
            }
            if (frame.event === "result") {
              const value = frame.result;
              if (value && typeof value === "object" && !Array.isArray(value)) {
                const payload = value as Record<string, unknown>;
                const finalText = typeof payload.response === "string" ? payload.response : "";
                const sessionId =
                  typeof payload.conversation_id === "string"
                    ? payload.conversation_id
                    : result?.sessionId;
                result = {
                  ...(sessionId ? { sessionId } : {}),
                  finalText,
                  success: payload.status === "SUCCESS",
                  ...(payload.usage !== undefined ? { usage: payload.usage } : {}),
                  ...(typeof payload.status === "string" ? { stopReason: payload.status } : {}),
                };
              }
            }
            return;
          }
          if (frame.type === "event") {
            emitTool(frame);
            return;
          }
          if (frame.type === "result") {
            const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : undefined;
            result = {
              ...(sessionId ? { sessionId } : {}),
              finalText: typeof frame.finalText === "string" ? frame.finalText : "",
              success: frame.subtype === "success",
              ...(typeof frame.error === "string" ? { error: frame.error } : {}),
              ...(frame.usage !== undefined ? { usage: frame.usage } : {}),
              ...(typeof frame.stopReason === "string" ? { stopReason: frame.stopReason } : {}),
            };
          }
        };
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdoutBuffer += chunk;
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() ?? "";
          for (const line of lines) handleLine(line);
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", (error) => {
          result = { finalText: "", success: false, error: error.message };
        });
        child.on("close", (code) => {
          if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
          const finalResult = result ?? {
            finalText: "",
            success: code === 0,
            ...(stderr.trim() ? { error: stderr.trim() } : {}),
          };
          if (finalResult.finalText && assistantText.length === 0) emitText(finalResult.finalText);
          if (assistantStarted) {
            publish({
              type: "item.completed",
              ...stamp(),
              provider: options.provider,
              providerInstanceId: options.instanceId,
              threadId: input.threadId,
              turnId,
              itemId: assistantItemId,
              payload: { itemType: "assistant_message", status: "completed" },
            });
          }
          const updatedAt = nowIso();
          context.process = null;
          context.turns.push({ id: turnId, items: assistantText ? [{ text: assistantText }] : [] });
          const nextCursor = finalResult.sessionId ?? resumeCursor;
          const { activeTurnId: _activeTurnId, ...sessionWithoutTurn } = context.session;
          context.session = {
            ...sessionWithoutTurn,
            status: finalResult.success ? "ready" : "error",
            ...(nextCursor ? { resumeCursor: nextCursor } : {}),
            updatedAt,
            ...(finalResult.success
              ? {}
              : {
                  lastError:
                    finalResult.error ?? (stderr.trim() || `CLI exited with code ${code}.`),
                }),
          };
          if (!finalResult.success) {
            publish({
              type: "runtime.error",
              ...stamp(),
              provider: options.provider,
              providerInstanceId: options.instanceId,
              threadId: input.threadId,
              turnId,
              payload: {
                message: finalResult.error ?? (stderr.trim() || `CLI exited with code ${code}.`),
                class: "provider_error",
              },
            });
          }
          publish({
            type: "turn.completed",
            ...stamp(),
            provider: options.provider,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            payload: {
              state: finalResult.success ? "completed" : "failed",
              ...(finalResult.stopReason ? { stopReason: finalResult.stopReason } : {}),
              ...(finalResult.usage !== undefined ? { usage: finalResult.usage } : {}),
              ...(!finalResult.success && context.session.lastError
                ? { errorMessage: context.session.lastError }
                : {}),
            },
          });
          resume(Effect.void);
        });
        return Effect.sync(() => child.kill());
      });
      yield* Effect.forkIn(run, adapterScope);
      return {
        threadId: input.threadId,
        turnId,
        ...(resumeCursor ? { resumeCursor } : {}),
      };
    });

  const interruptTurn = (threadId: ThreadId, turnId?: TurnId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      if (turnId && context.session.activeTurnId && context.session.activeTurnId !== turnId) return;
      context.process?.kill();
    });

  const unsupportedResponse = (
    threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _value: ProviderApprovalDecision | ProviderUserInputAnswers,
  ) =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: options.provider,
        method: "respondToRequest",
        detail: `Provider '${options.provider}' headless sessions do not expose interactive approval callbacks for thread '${threadId}'.`,
      }),
    );

  const stopSession = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      context.process?.kill();
      sessions.delete(threadId);
    });
  const stopAll = () =>
    Effect.sync(() => {
      for (const context of sessions.values()) context.process?.kill();
      sessions.clear();
    });

  yield* Effect.addFinalizer(() =>
    stopAll().pipe(Effect.tap(() => PubSub.shutdown(runtimeEvents))),
  );

  return {
    provider: options.provider,
    capabilities: { sessionModelSwitch: "unsupported" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest: unsupportedResponse,
    respondToUserInput: unsupportedResponse,
    stopSession,
    listSessions: () =>
      Effect.sync(() => Array.from(sessions.values(), (context) => ({ ...context.session }))),
    hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
    readThread: (threadId) =>
      requireSession(threadId).pipe(
        Effect.map((context) => ({ threadId, turns: [...context.turns] })),
      ),
    rollbackThread: (threadId) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: options.provider,
          method: "rollbackThread",
          detail: `Provider '${options.provider}' does not expose provider-side rollback for thread '${threadId}'.`,
        }),
      ),
    stopAll,
    streamEvents: Stream.fromPubSub(runtimeEvents),
  } satisfies ProviderAdapterShape<HeadlessCliAdapterError>;
});
