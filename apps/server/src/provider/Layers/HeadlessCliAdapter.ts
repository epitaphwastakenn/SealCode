import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  type ProviderApprovalDecision,
  type ModelCapabilities,
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
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  createHeadlessCliMcpProfile,
  type HeadlessCliMcpProfile,
} from "./HeadlessCliMcpProfile.ts";

export interface HeadlessCliSettings {
  readonly binaryPath: string;
}

export type HeadlessCliProtocol = "commandcode";

export interface HeadlessCliAdapterOptions {
  readonly provider: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly environment: NodeJS.ProcessEnv;
  readonly protocol: HeadlessCliProtocol;
  readonly modelCapabilities?: (model: string | undefined) => ModelCapabilities;
}

interface SessionContext {
  session: ProviderSession;
  process: NodeChildProcess.ChildProcess | null;
  mcpProfile?: HeadlessCliMcpProfile | undefined;
  cancelRequested: boolean;
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

export function isHeadlessCliTerminalResultFrame(
  _protocol: HeadlessCliAdapterOptions["protocol"],
  frame: Record<string, unknown>,
): boolean {
  return frame.type === "result";
}

/**
 * Returns only final-response text that has not already been streamed.
 * Providers may emit a partial stream, a complete stream, or a final result
 * frame after the stream. Comparing the trailing stream avoids suppressing a
 * real final response just because the same words appeared in commentary.
 */
export function missingFinalAssistantText(
  streamedText: string,
  currentSegmentText: string,
  finalText: string,
): string {
  if (!finalText || streamedText.endsWith(finalText)) {
    return "";
  }
  if (currentSegmentText && finalText.startsWith(currentSegmentText)) {
    return finalText.slice(currentSegmentText.length);
  }
  return finalText;
}

export function resolveHeadlessCliWorkspaceCwd(cwd: string | undefined): string | undefined {
  const trimmed = cwd?.trim();
  return trimmed ? NodePath.resolve(trimmed) : undefined;
}

function readMcpActivityMetadata(
  providerToolName: string | undefined,
  callId: string,
  payload: Record<string, unknown>,
) {
  return McpProviderSession.makeMcpToolActivityMetadata({
    providerToolName:
      typeof payload.providerToolName === "string" ? payload.providerToolName : providerToolName,
    serverId: typeof payload.serverId === "string" ? payload.serverId : undefined,
    serverDisplayName:
      typeof payload.serverDisplayName === "string" ? payload.serverDisplayName : undefined,
    upstreamToolName:
      typeof payload.upstreamToolName === "string" ? payload.upstreamToolName : undefined,
    canonicalToolName:
      typeof payload.canonicalToolName === "string" ? payload.canonicalToolName : undefined,
    callId,
  });
}

function terminateProcessTree(
  child: NodeChildProcess.ChildProcess,
  platform: NodeJS.Platform,
): void {
  try {
    if (platform === "win32") {
      if (child.pid !== undefined) {
        NodeChildProcess.spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true,
          timeout: 2000,
        });
      }
      return;
    }
    child.kill("SIGTERM");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}

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

function resolveHeadlessCliEffort(
  _protocol: HeadlessCliProtocol,
  model: string | undefined,
  input: ProviderSendTurnInput,
  capabilities: ModelCapabilities | undefined,
): string | undefined {
  const descriptor = capabilities?.optionDescriptors?.find((option) =>
    ["effort", "reasoning", "reasoningeffort"].includes(option.id.trim().toLowerCase()),
  );
  const effort = resolveReasoningEffort(input)?.trim();
  if (!model || !descriptor || !effort) return undefined;
  if (descriptor.type !== "select" || !descriptor.options?.length) return effort;
  return descriptor.options.find((option) => option.id.toLowerCase() === effort.toLowerCase())?.id;
}

export function commandArgs(input: {
  readonly protocol: HeadlessCliAdapterOptions["protocol"];
  readonly prompt: string;
  readonly resumeCursor?: string;
  readonly send: ProviderSendTurnInput;
  readonly session: ProviderSession;
  readonly capabilities?: ModelCapabilities;
}): ReadonlyArray<string> {
  const model = input.send.modelSelection?.model ?? input.session.model;
  const effort = resolveHeadlessCliEffort(input.protocol, model, input.send, input.capabilities);
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
    ...(input.send.interactionMode !== "plan" && input.session.runtimeMode === "full-access"
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
  const platform = yield* HostProcessPlatform;
  const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const adapterScope = yield* Effect.scope;
  const sessions = new Map<ThreadId, SessionContext>();

  const publish = (event: ProviderRuntimeEvent) =>
    Effect.runFork(Queue.offer(runtimeEvents, event).pipe(Effect.asVoid));
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

  const restoreMcpOverlay = (context: SessionContext) => {
    const profile = context.mcpProfile;
    context.mcpProfile = undefined;
    if (profile) void profile.cleanup();
  };

  const startSession = (input: ProviderSessionStartInput) =>
    Effect.sync(() => {
      const cwd = resolveHeadlessCliWorkspaceCwd(input.cwd);
      const updatedAt = nowIso();
      const resumeCursor = parseResumeCursor(input.resumeCursor);
      const session: ProviderSession = {
        provider: options.provider,
        providerInstanceId: options.instanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        ...(cwd ? { cwd } : {}),
        ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        threadId: input.threadId,
        ...(resumeCursor ? { resumeCursor } : {}),
        createdAt: updatedAt,
        updatedAt,
      };
      sessions.set(input.threadId, { session, process: null, cancelRequested: false, turns: [] });
      publish({
        type: "session.started",
        ...stamp(),
        provider: options.provider,
        providerInstanceId: options.instanceId,
        threadId: input.threadId,
        payload: {
          message: `CommandCode session ready.`,
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
      context.cancelRequested = false;
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
      const spawnCwd = resolveHeadlessCliWorkspaceCwd(context.session.cwd);
      const turnId = TurnId.make(NodeCrypto.randomUUID());
      const resumeCursor = parseResumeCursor(context.session.resumeCursor);
      const turnSession: ProviderSession = {
        ...context.session,
        ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        updatedAt: nowIso(),
      };
      const turnModel = input.modelSelection?.model ?? turnSession.model;
      const turnCapabilities = options.modelCapabilities?.(turnModel);
      const turnEffort = resolveHeadlessCliEffort(
        options.protocol,
        turnModel,
        input,
        turnCapabilities,
      );
      const args = commandArgs({
        protocol: options.protocol,
        prompt,
        ...(resumeCursor ? { resumeCursor } : {}),
        send: input,
        session: turnSession,
        ...(turnCapabilities ? { capabilities: turnCapabilities } : {}),
      });
      const mcpSession = McpProviderSession.readMcpProviderSession(input.threadId);
      const mcpProfile = yield* Effect.tryPromise({
        try: () => {
          if (!mcpSession) return Promise.resolve(undefined);
          return createHeadlessCliMcpProfile(options.protocol, mcpSession, options.environment);
        },
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: options.provider,
            method: "mcp.profile.create",
            detail: `Failed to create the MCP profile: ${String(cause)}`,
            cause,
          }),
      });
      if (context.cancelRequested) {
        if (mcpProfile) void mcpProfile.cleanup();
        return yield* new ProviderAdapterRequestError({
          provider: options.provider,
          method: "sendTurn",
          detail: `Thread '${input.threadId}' was interrupted before the turn started.`,
        });
      }
      context.mcpProfile = mcpProfile;
      const processEnvironment = mcpProfile?.environment ?? options.environment;
      const spawnCommand = yield* resolveSpawnCommand(settings.binaryPath, args, {
        env: processEnvironment,
      });
      let assistantItemId = RuntimeItemId.make(`assistant-${turnId}`);
      context.session = {
        ...turnSession,
        status: "running",
        activeTurnId: turnId,
      };
      if (context.cancelRequested) {
        restoreMcpOverlay(context);
        return yield* new ProviderAdapterRequestError({
          provider: options.provider,
          method: "sendTurn",
          detail: `Thread '${input.threadId}' was interrupted before the turn started.`,
        });
      }
      publish({
        type: "turn.started",
        ...stamp(),
        provider: options.provider,
        providerInstanceId: options.instanceId,
        threadId: input.threadId,
        turnId,
        payload: {
          ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
          ...(turnEffort ? { effort: turnEffort } : {}),
        },
      });
      const run = Effect.callback<void>((resume) => {
        const child = NodeChildProcess.spawn(spawnCommand.command, spawnCommand.args, {
          ...(spawnCwd ? { cwd: spawnCwd } : {}),
          env: processEnvironment,
          windowsHide: true,
          shell: spawnCommand.shell,
        });
        context.process = child;
        child.stdin?.end();
        if (context.cancelRequested) {
          terminateProcessTree(child, platform);
        }
        let stdoutBuffer = "";
        let stderr = "";
        let assistantStarted = false;
        let reasoningStarted = false;
        let assistantText = "";
        let totalAssistantText = "";
        let result: CliResult | undefined;
        let conversationId = resumeCursor;
        let exitCode: number | null = null;
        let reasoningItemId = RuntimeItemId.make(`reasoning-${turnId}`);
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
        const ensureReasoningStarted = () => {
          if (reasoningStarted) return;
          reasoningStarted = true;
          publish({
            type: "item.started",
            ...stamp(),
            provider: options.provider,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: reasoningItemId,
            payload: { itemType: "reasoning", status: "inProgress", title: "Reasoning" },
          });
        };
        const emitText = (
          text: string,
          streamKind: "assistant_text" | "reasoning_text" = "assistant_text",
        ) => {
          if (streamKind === "reasoning_text") {
            if (!text) return;
            ensureReasoningStarted();
            publish({
              type: "content.delta",
              ...stamp(),
              provider: options.provider,
              providerInstanceId: options.instanceId,
              threadId: input.threadId,
              turnId,
              itemId: reasoningItemId,
              payload: { streamKind: "reasoning_text", delta: text },
            });
            return;
          }
          if (!text) return;
          ensureAssistantStarted();
          assistantText += text;
          totalAssistantText += text;
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
        const completeAssistantSegment = () => {
          if (!assistantStarted) return;
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
          assistantStarted = false;
          assistantText = "";
          assistantItemId = RuntimeItemId.make(`assistant-${turnId}-${NodeCrypto.randomUUID()}`);
        };
        const completeReasoningSegment = () => {
          if (!reasoningStarted) return;
          publish({
            type: "item.completed",
            ...stamp(),
            provider: options.provider,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: reasoningItemId,
            payload: { itemType: "reasoning", status: "completed", title: "Reasoning" },
          });
          reasoningStarted = false;
          reasoningItemId = RuntimeItemId.make(`reasoning-${turnId}-${NodeCrypto.randomUUID()}`);
        };
        const emitFinalText = (text: string) => {
          const missingText = missingFinalAssistantText(totalAssistantText, assistantText, text);
          if (missingText) emitText(missingText);
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
          const title =
            typeof detail.toolName === "string" ? detail.toolName : type.replaceAll("_", " ");
          const mcp = readMcpActivityMetadata(title, toolCallId, detail);
          publish({
            type: completed ? "item.completed" : "item.updated",
            ...stamp(),
            provider: options.provider,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            turnId,
            itemId: RuntimeItemId.make(toolCallId),
            payload: {
              itemType: mcp ? "mcp_tool_call" : "dynamic_tool_call",
              status: completed
                ? /failed|error/i.test(type)
                  ? "failed"
                  : "completed"
                : "inProgress",
              title,
              ...(typeof detail.description === "string" ? { detail: detail.description } : {}),
              data: detail,
              ...(mcp ? { mcp } : {}),
            },
          });
        };
        let turnFinalized = false;
        const finalizeTurn = (code: number | null = 0) => {
          if (turnFinalized) return;
          turnFinalized = true;
          const finalResult = result ?? {
            finalText: "",
            success: code === 0,
            ...(stderr.trim() ? { error: stderr.trim() } : {}),
          };
          emitFinalText(finalResult.finalText);
          completeReasoningSegment();
          completeAssistantSegment();
          const interrupted = context.cancelRequested;
          const updatedAt = nowIso();
          context.process = null;
          restoreMcpOverlay(context);
          context.turns.push({
            id: turnId,
            items: totalAssistantText ? [{ text: totalAssistantText }] : [],
          });
          const succeeded = !interrupted && finalResult.success;
          const nextCursor = finalResult.sessionId ?? conversationId;
          const {
            activeTurnId: _activeTurnId,
            resumeCursor: _resumeCursor,
            lastError: _lastError,
            ...sessionWithoutTurn
          } = context.session;
          context.session = {
            ...sessionWithoutTurn,
            status: interrupted || succeeded ? "ready" : "error",
            ...(nextCursor ? { resumeCursor: nextCursor } : {}),
            updatedAt,
            ...(succeeded
              ? {}
              : interrupted
                ? {}
                : {
                    lastError:
                      finalResult.error ?? (stderr.trim() || `CLI exited with code ${code ?? 1}.`),
                  }),
          };
          if (!succeeded && !interrupted) {
            publish({
              type: "runtime.error",
              ...stamp(),
              provider: options.provider,
              providerInstanceId: options.instanceId,
              threadId: input.threadId,
              turnId,
              payload: {
                message:
                  finalResult.error ?? (stderr.trim() || `CLI exited with code ${code ?? 1}.`),
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
              state: interrupted ? "interrupted" : succeeded ? "completed" : "failed",
              ...(finalResult.stopReason ? { stopReason: finalResult.stopReason } : {}),
              ...(finalResult.usage !== undefined ? { usage: finalResult.usage } : {}),
              ...(!succeeded && !interrupted && context.session.lastError
                ? { errorMessage: context.session.lastError }
                : {}),
            },
          });
          resume(Effect.void);
        };
        const finishTurn = (code: number | null = 0) => {
          finalizeTurn(code);
          terminateProcessTree(child, platform);
        };

        const handleLine = (line: string) => {
          if (turnFinalized) return;
          const frame = parseJsonLine(line.trim());
          if (!frame) return;
          if (frame.type === "event") {
            const raw = frame.event;
            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
              const detail = raw as Record<string, unknown>;
              if (detail.type === "text_delta" && typeof detail.delta === "string") {
                emitText(detail.delta);
              } else if (detail.type === "text_delta" && typeof detail.text === "string") {
                emitText(detail.text);
              } else if (detail.type === "message_update" || detail.type === "message_end") {
                const fullText = Array.isArray(detail.content)
                  ? detail.content
                      .filter(
                        (c): c is Record<string, unknown> =>
                          Boolean(c) && typeof c === "object" && !Array.isArray(c),
                      )
                      .filter((c) => c.type === "text" && typeof c.text === "string")
                      .map((c) => c.text as string)
                      .join("")
                  : "";
                if (fullText.length > assistantText.length) {
                  emitText(fullText.slice(assistantText.length));
                }
                if (detail.type === "message_end") {
                  completeAssistantSegment();
                }
              } else if (detail.type === "run_end") {
                if (
                  detail.result &&
                  typeof detail.result === "object" &&
                  !Array.isArray(detail.result)
                ) {
                  const res = detail.result as Record<string, unknown>;
                  if (typeof res.finalText === "string") emitFinalText(res.finalText);
                }
              } else {
                emitTool(frame);
              }
            } else {
              emitTool(frame);
            }
            return;
          }
          if (isHeadlessCliTerminalResultFrame("commandcode", frame)) {
            const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : undefined;
            const finalText = typeof frame.finalText === "string" ? frame.finalText : "";
            emitFinalText(finalText);
            result = {
              ...(sessionId ? { sessionId } : {}),
              finalText,
              success: frame.subtype === "success",
              ...(typeof frame.error === "string" ? { error: frame.error } : {}),
              ...(frame.usage !== undefined ? { usage: frame.usage } : {}),
              ...(typeof frame.stopReason === "string" ? { stopReason: frame.stopReason } : {}),
            };
            finishTurn(result.success ? 0 : 1);
          }
        };
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          stdoutBuffer += chunk;
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() ?? "";
          for (const line of lines) handleLine(line);
        });
        child.stderr?.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", (error) => {
          if (turnFinalized) return;
          result = { finalText: "", success: false, error: error.message };
          finishTurn(1);
        });
        child.on("exit", (code) => {
          exitCode = code;
        });
        child.on("close", (code) => {
          if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
          stdoutBuffer = "";
          finalizeTurn(code ?? exitCode);
        });
        return Effect.sync(() => {
          if (context.process === child) {
            terminateProcessTree(child, platform);
          }
        });
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
      context.cancelRequested = true;
      if (context.process) terminateProcessTree(context.process, platform);
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
      context.cancelRequested = true;
      if (context.process) terminateProcessTree(context.process, platform);
      restoreMcpOverlay(context);
      sessions.delete(threadId);
    });
  const stopAll = () =>
    Effect.sync(() => {
      const contexts = Array.from(sessions.values());
      sessions.clear();
      for (const context of contexts) {
        context.cancelRequested = true;
        if (context.process) terminateProcessTree(context.process, platform);
        restoreMcpOverlay(context);
      }
    });

  yield* Effect.addFinalizer(() => stopAll().pipe(Effect.tap(() => Queue.shutdown(runtimeEvents))));

  return {
    provider: options.provider,
    capabilities: {
      sessionModelSwitch: "unsupported",
      stablePromptPrefix: false,
      contextCompaction: "unsupported",
      promptCaching: "unsupported",
      toolTransport: "mcp",
      detachedDelegation: false,
    },
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
    streamEvents: Stream.fromQueue(runtimeEvents),
  } satisfies ProviderAdapterShape<HeadlessCliAdapterError>;
});
