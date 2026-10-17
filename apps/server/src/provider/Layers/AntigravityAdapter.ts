/**
 * AntigravityAdapter — Provider adapter for the official Antigravity Python SDK runtime.
 *
 * Communicates with the Python bridge via JSON-RPC over stdio and translates
 * bridge events into SealCode's canonical ProviderRuntimeEvents.
 *
 * @module AntigravityAdapter
 */

import * as NodeCrypto from "node:crypto";

import {
  ApprovalRequestId,
  EventId,
  ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  type ThreadTokenUsageSnapshot,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type {
  ProviderAdapterCapabilities,
  ProviderAdapterShape,
  ProviderThreadSnapshot,
} from "../Services/ProviderAdapter.ts";
import {
  makeAntigravityBridgeProcess,
  type AntigravityBridgeProcess,
} from "./AntigravityBridgeProcess.ts";
import type {
  BridgeNotification,
  BridgeSessionStartResult,
  BridgeTurnStartResult,
} from "../antigravity/bridgeProtocol.ts";

const PROVIDER = ProviderDriverKind.make("antigravity");

export const ANTIGRAVITY_SDK_ADAPTER_CAPABILITIES: ProviderAdapterCapabilities = {
  sessionModelSwitch: "unsupported",
  stablePromptPrefix: true,
  contextCompaction: "provider-native",
  promptCaching: "unsupported",
  toolTransport: "mcp",
  detachedDelegation: false,
};

const makeMcpActivityMetadata = (input: {
  readonly isMcp?: boolean | undefined;
  readonly serverId?: string | undefined;
  readonly serverDisplayName?: string | undefined;
  readonly upstreamToolName?: string | undefined;
  readonly canonicalToolName?: string | undefined;
  readonly providerToolName?: string | undefined;
  readonly toolName: string;
  readonly callId?: string | undefined;
}) => {
  if (!input.isMcp || !input.serverId || !input.upstreamToolName) return undefined;
  return {
    serverId: input.serverId,
    ...(input.serverDisplayName ? { serverDisplayName: input.serverDisplayName } : {}),
    upstreamToolName: input.upstreamToolName,
    canonicalToolName: input.canonicalToolName ?? input.toolName,
    ...(input.providerToolName ? { providerToolName: input.providerToolName } : {}),
    ...(input.callId ? { callId: input.callId } : {}),
  };
};

export interface AntigravityAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly pythonPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly bridgeProcess?: AntigravityBridgeProcess;
}

interface SessionState {
  session: ProviderSession;
  activeTurnId?: TurnId;
  assistantItemId?: RuntimeItemId;
  reasoningItemId?: RuntimeItemId;
  assistantStarted: boolean;
  reasoningStarted: boolean;
  totalTokens: number;
}

export type AntigravityAdapterShape = ProviderAdapterShape<ProviderAdapterError>;

export const makeAntigravityAdapter = (
  options: AntigravityAdapterOptions = {},
): Effect.Effect<AntigravityAdapterShape, ProviderAdapterProcessError, Scope.Scope | ServerConfig> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const instanceId = options.instanceId ?? ProviderInstanceId.make("antigravity");
    const serverConfig = yield* Effect.serviceOption(ServerConfig);
    const stateDir = serverConfig._tag === "Some" ? serverConfig.value.stateDir : undefined;

    const eventsQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessionsRef = yield* Ref.make<Map<string, SessionState>>(new Map());

    const bridge =
      options.bridgeProcess ??
      (yield* makeAntigravityBridgeProcess({
        pythonPath: options.pythonPath,
        environment: options.environment,
      }));

    const nowIso = () => new Date().toISOString();
    const makeStamp = () => ({
      eventId: EventId.make(NodeCrypto.randomUUID()),
      createdAt: nowIso(),
    });

    const publish = (event: ProviderRuntimeEvent) =>
      Effect.runFork(Queue.offer(eventsQueue, event));

    // Handle incoming bridge notifications
    const handleNotification = (notif: BridgeNotification) => {
      Effect.runFork(
        Effect.gen(function* () {
          const sessions = yield* Ref.get(sessionsRef);

          switch (notif.method) {
            case "content.delta": {
              const { sessionId, turnId, delta } = notif.params;
              const state = sessions.get(sessionId);
              if (!state) return;

              const threadId = ThreadId.make(sessionId);
              const currentTurnId = TurnId.make(turnId);

              if (!state.assistantStarted) {
                state.assistantStarted = true;
                state.assistantItemId = RuntimeItemId.make(`assistant-${turnId}`);
                publish({
                  type: "item.started",
                  ...makeStamp(),
                  provider: PROVIDER,
                  providerInstanceId: instanceId,
                  threadId,
                  turnId: currentTurnId,
                  itemId: state.assistantItemId,
                  payload: { itemType: "assistant_message", status: "inProgress" },
                });
              }

              publish({
                type: "content.delta",
                ...makeStamp(),
                provider: PROVIDER,
                providerInstanceId: instanceId,
                threadId,
                turnId: currentTurnId,
                itemId: state.assistantItemId!,
                payload: { streamKind: "assistant_text", delta },
              });
              break;
            }

            case "reasoning.delta": {
              const { sessionId, turnId, delta } = notif.params;
              const state = sessions.get(sessionId);
              if (!state) return;

              const threadId = ThreadId.make(sessionId);
              const currentTurnId = TurnId.make(turnId);

              if (!state.reasoningStarted) {
                state.reasoningStarted = true;
                state.reasoningItemId = RuntimeItemId.make(`reasoning-${turnId}`);
                publish({
                  type: "item.started",
                  ...makeStamp(),
                  provider: PROVIDER,
                  providerInstanceId: instanceId,
                  threadId,
                  turnId: currentTurnId,
                  itemId: state.reasoningItemId,
                  payload: { itemType: "reasoning", status: "inProgress", title: "Reasoning" },
                });
              }

              publish({
                type: "content.delta",
                ...makeStamp(),
                provider: PROVIDER,
                providerInstanceId: instanceId,
                threadId,
                turnId: currentTurnId,
                itemId: state.reasoningItemId!,
                payload: { streamKind: "reasoning_text", delta },
              });
              break;
            }

            case "tool.started": {
              const {
                sessionId,
                turnId,
                callId,
                toolName,
                args,
                isMcp,
                serverId,
                upstreamToolName,
                canonicalToolName,
                providerToolName,
              } = notif.params;
              const threadId = ThreadId.make(sessionId);
              const currentTurnId = TurnId.make(turnId);
              const mcp = makeMcpActivityMetadata({
                isMcp,
                serverId,
                upstreamToolName,
                canonicalToolName,
                providerToolName,
                toolName,
                callId,
              });

              publish({
                type: "item.started",
                ...makeStamp(),
                provider: PROVIDER,
                providerInstanceId: instanceId,
                threadId,
                turnId: currentTurnId,
                itemId: RuntimeItemId.make(callId),
                payload: {
                  itemType: mcp ? "mcp_tool_call" : "dynamic_tool_call",
                  status: "inProgress",
                  title: toolName,
                  data: args,
                  ...(mcp ? { mcp } : {}),
                },
              });
              break;
            }

            case "tool.completed": {
              const {
                sessionId,
                turnId,
                callId,
                toolName,
                result,
                isMcp,
                serverId,
                upstreamToolName,
                canonicalToolName,
                providerToolName,
              } = notif.params;
              const threadId = ThreadId.make(sessionId);
              const currentTurnId = TurnId.make(turnId);
              const mcp = makeMcpActivityMetadata({
                isMcp,
                serverId,
                upstreamToolName,
                canonicalToolName,
                providerToolName,
                toolName,
                callId,
              });

              publish({
                type: "item.completed",
                ...makeStamp(),
                provider: PROVIDER,
                providerInstanceId: instanceId,
                threadId,
                turnId: currentTurnId,
                itemId: RuntimeItemId.make(callId),
                payload: {
                  itemType: mcp ? "mcp_tool_call" : "dynamic_tool_call",
                  status: "completed",
                  title: toolName,
                  data: typeof result === "object" && result !== null ? (result as Record<string, unknown>) : { result },
                  ...(mcp ? { mcp } : {}),
                },
              });
              break;
            }

            case "tool.failed": {
              const {
                sessionId,
                turnId,
                callId,
                toolName,
                error,
                isMcp,
                serverId,
                upstreamToolName,
                canonicalToolName,
                providerToolName,
              } = notif.params;
              const threadId = ThreadId.make(sessionId);
              const currentTurnId = TurnId.make(turnId);
              const mcp = makeMcpActivityMetadata({
                isMcp,
                serverId,
                upstreamToolName,
                canonicalToolName,
                providerToolName,
                toolName,
                callId,
              });

              publish({
                type: "item.completed",
                ...makeStamp(),
                provider: PROVIDER,
                providerInstanceId: instanceId,
                threadId,
                turnId: currentTurnId,
                itemId: RuntimeItemId.make(callId),
                payload: {
                  itemType: mcp ? "mcp_tool_call" : "dynamic_tool_call",
                  status: "failed",
                  title: toolName,
                  detail: error,
                  data: { error },
                  ...(mcp ? { mcp } : {}),
                },
              });
              break;
            }

            case "approval.requested": {
              const {
                sessionId,
                turnId,
                requestId,
                toolName,
                args,
                itemType,
                message,
                serverId,
                upstreamToolName,
                canonicalToolName,
                providerToolName,
              } = notif.params;
              const threadId = ThreadId.make(sessionId);
              const currentTurnId = TurnId.make(turnId);
              const mcp = makeMcpActivityMetadata({
                isMcp: itemType === "mcp_tool_call",
                serverId,
                upstreamToolName,
                canonicalToolName,
                providerToolName,
                toolName,
                callId: requestId,
              });
              const requestType =
                itemType === "command_execution"
                  ? "command_execution_approval"
                  : itemType === "file_change"
                    ? "file_change_approval"
                    : "dynamic_tool_call";
              const detail =
                typeof args === "object" && args !== null
                  ? ((args as Record<string, any>).CommandLine as string) ||
                    ((args as Record<string, any>).command as string) ||
                    ((args as Record<string, any>).path as string) ||
                    ((args as Record<string, any>).Path as string) ||
                    message ||
                    toolName
                  : message || toolName;

              publish({
                type: "request.opened",
                ...makeStamp(),
                provider: PROVIDER,
                providerInstanceId: instanceId,
                threadId,
                turnId: currentTurnId,
                requestId: RuntimeRequestId.make(requestId),
                payload: {
                  requestType,
                  ...(detail ? { detail } : {}),
                  ...(args !== undefined ? { args } : {}),
                  ...(mcp ? { mcp } : {}),
                },
              });
              break;
            }

            case "user_input.requested": {
              const { sessionId, turnId, requestId, questions } = notif.params;
              const threadId = ThreadId.make(sessionId);
              const currentTurnId = TurnId.make(turnId);

              publish({
                type: "user-input.requested",
                ...makeStamp(),
                provider: PROVIDER,
                providerInstanceId: instanceId,
                threadId,
                turnId: currentTurnId,
                requestId: RuntimeRequestId.make(requestId),
                payload: {
                  questions: questions.map((q, idx) => ({
                    id: (q.id && q.id.trim().length > 0 ? q.id : undefined) || (q.question && q.question.trim().length > 0 ? q.question : undefined) || `q-${idx}`,
                    header: (q.header && q.header.trim().length > 0 ? q.header : undefined) || `Question ${idx + 1}`,
                    question: q.question || "",
                    options: (q.options || []).map((opt) =>
                      typeof opt === "string"
                        ? { label: opt, description: "" }
                        : { label: opt.label || "", description: opt.description || "" },
                    ),
                    multiSelect: q.multiSelect ?? q.is_multi_select ?? false,
                  })),
                },
              });
              break;
            }

            case "usage.updated": {
              const { sessionId, turnId, inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens, totalTurnTokens, totalProcessedTokens } = notif.params;
              const threadId = ThreadId.make(sessionId);
              const state = sessions.get(sessionId);
              if (state && totalProcessedTokens) {
                state.totalTokens = totalProcessedTokens;
              }

              const usageSnapshot: ThreadTokenUsageSnapshot = {
                inputTokens,
                outputTokens,
                cachedInputTokens: cachedInputTokens ?? 0,
                reasoningOutputTokens: reasoningOutputTokens ?? 0,
                usedTokens: totalTurnTokens ?? (inputTokens + outputTokens),
                lastUsedTokens: totalTurnTokens ?? (inputTokens + outputTokens),
                totalProcessedTokens: totalProcessedTokens ?? totalTurnTokens ?? (inputTokens + outputTokens),
                compactsAutomatically: true,
              };

              publish({
                type: "thread.token-usage.updated",
                ...makeStamp(),
                provider: PROVIDER,
                providerInstanceId: instanceId,
                threadId,
                turnId: TurnId.make(turnId),
                payload: {
                  usage: usageSnapshot,
                },
              });
              break;
            }

            case "turn.completed": {
              const { sessionId, turnId, state: turnState, stopReason, error } = notif.params;
              const state = sessions.get(sessionId);
              if (!state) return;

              const threadId = ThreadId.make(sessionId);
              const currentTurnId = TurnId.make(turnId);

              if (state.assistantStarted && state.assistantItemId) {
                publish({
                  type: "item.completed",
                  ...makeStamp(),
                  provider: PROVIDER,
                  providerInstanceId: instanceId,
                  threadId,
                  turnId: currentTurnId,
                  itemId: state.assistantItemId,
                  payload: { itemType: "assistant_message", status: "completed" },
                });
                state.assistantStarted = false;
              }

              if (state.reasoningStarted && state.reasoningItemId) {
                publish({
                  type: "item.completed",
                  ...makeStamp(),
                  provider: PROVIDER,
                  providerInstanceId: instanceId,
                  threadId,
                  turnId: currentTurnId,
                  itemId: state.reasoningItemId,
                  payload: { itemType: "reasoning", status: "completed", title: "Reasoning" },
                });
                state.reasoningStarted = false;
              }

              publish({
                type: "turn.completed",
                ...makeStamp(),
                provider: PROVIDER,
                providerInstanceId: instanceId,
                threadId,
                turnId: currentTurnId,
                payload: {
                  state: turnState,
                  ...(stopReason ? { stopReason } : {}),
                  ...(error ? { errorMessage: error } : {}),
                },
              });

              state.activeTurnId = undefined;
              state.session = {
                ...state.session,
                status: "ready",
                activeTurnId: undefined,
                updatedAt: nowIso(),
              };
              break;
            }
          }
        }),
      );
    };

    // Pump notifications in background fiber
    const notificationFiber = yield* Effect.forkIn(
      Stream.runForEach(bridge.streamNotifications, (notif) => Effect.sync(() => handleNotification(notif))),
      scope,
    );

    const startSession = (input: ProviderSessionStartInput): Effect.Effect<ProviderSession, ProviderAdapterError> =>
      Effect.gen(function* () {
        const sessionId = input.threadId;
        const mcpSession = McpProviderSession.readMcpProviderSession(input.threadId);
        const result = yield* bridge.sendRequest<BridgeSessionStartResult>("session.start", {
          sessionId,
          cwd: input.cwd,
          model: input.modelSelection?.model,
          systemInstructions: input.systemInstructions,
          runtimeMode: input.runtimeMode,
          saveDir: stateDir ? `${stateDir}/antigravity/${instanceId}` : undefined,
          conversationId: input.resumeCursor ? JSON.parse(input.resumeCursor)?.conversationId : undefined,
          ...(mcpSession
            ? {
                mcpServers: McpProviderSession.makeSealCodeMcpEndpoints(mcpSession).map(
                  (endpoint) => ({
                    name: endpoint.name,
                    transport: "http" as const,
                    url: endpoint.url,
                    headers: { Authorization: endpoint.authorizationHeader },
                  }),
                ),
              }
            : {}),
        });

        const resumeCursor = JSON.stringify({
          protocolVersion: "1.0.0",
          conversationId: result.conversationId,
        });

        const session: ProviderSession = {
          threadId: input.threadId,
          runtimeMode: input.runtimeMode,
          cwd: input.cwd,
          model: result.model,
          status: "ready",
          resumeCursor,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };

        yield* Ref.update(sessionsRef, (map) => {
          map.set(sessionId, {
            session,
            assistantStarted: false,
            reasoningStarted: false,
            totalTokens: 0,
          });
          return map;
        });

        return session;
      });

    const sendTurn = (input: ProviderSendTurnInput): Effect.Effect<ProviderTurnStartResult, ProviderAdapterError> =>
      Effect.gen(function* () {
        const sessions = yield* Ref.get(sessionsRef);
        const state = sessions.get(input.threadId);
        if (!state) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId: input.threadId,
          });
        }

        const prompt = input.input?.trim() ?? "";
        const turnId = TurnId.make(NodeCrypto.randomUUID());

        state.activeTurnId = turnId;
        state.assistantStarted = false;
        state.reasoningStarted = false;
        state.session = {
          ...state.session,
          status: "running",
          activeTurnId: turnId,
          updatedAt: nowIso(),
        };

        const imagePaths: string[] = [];
        if (input.attachments && input.attachments.length > 0) {
          for (const att of input.attachments) {
            const resolved = yield* resolveAttachmentPath(att.attachmentId);
            if (resolved) {
              imagePaths.push(resolved);
            }
          }
        }

        yield* bridge.sendRequest<BridgeTurnStartResult>("turn.start", {
          sessionId: input.threadId,
          turnId,
          prompt,
          imagePaths,
          interactionMode: input.interactionMode,
        });

        return { turnId };
      });

    const interruptTurn = (threadId: ThreadId, turnId?: TurnId): Effect.Effect<void, ProviderAdapterError> =>
      Effect.gen(function* () {
        yield* bridge.sendRequest("turn.cancel", {
          sessionId: threadId,
          turnId,
        });
      });

    const respondToRequest = (
      threadId: ThreadId,
      requestId: ApprovalRequestId,
      decision: ProviderApprovalDecision,
    ): Effect.Effect<void, ProviderAdapterError> =>
      Effect.gen(function* () {
        yield* bridge.sendRequest("approval.resolve", {
          sessionId: threadId,
          requestId,
          decision: decision.outcome,
          reason: decision.feedback,
        });
      });

    const respondToUserInput = (
      threadId: ThreadId,
      requestId: ApprovalRequestId,
      answers: ProviderUserInputAnswers,
    ): Effect.Effect<void, ProviderAdapterError> =>
      Effect.gen(function* () {
        yield* bridge.sendRequest("user_input.resolve", {
          sessionId: threadId,
          requestId,
          answers,
        });
      });

    const stopSession = (threadId: ThreadId): Effect.Effect<void, ProviderAdapterError> =>
      Effect.gen(function* () {
        yield* bridge.sendRequest("session.stop", { sessionId: threadId });
        yield* Ref.update(sessionsRef, (map) => {
          map.delete(threadId);
          return map;
        });
      });

    const listSessions = (): Effect.Effect<ReadonlyArray<ProviderSession>> =>
      Effect.gen(function* () {
        const sessions = yield* Ref.get(sessionsRef);
        return Array.from(sessions.values()).map((s) => s.session);
      });

    const hasSession = (threadId: ThreadId): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const sessions = yield* Ref.get(sessionsRef);
        return sessions.has(threadId);
      });

    const readThread = (threadId: ThreadId): Effect.Effect<ProviderThreadSnapshot, ProviderAdapterError> =>
      Effect.succeed({
        threadId,
        turns: [],
      });

    const rollbackThread = (
      threadId: ThreadId,
      _numTurns: number,
    ): Effect.Effect<ProviderThreadSnapshot, ProviderAdapterError> =>
      Effect.succeed({
        threadId,
        turns: [],
      });

    const stopAll = (): Effect.Effect<void, ProviderAdapterError> =>
      Effect.gen(function* () {
        yield* bridge.sendRequest("shutdown", {});
        yield* Ref.update(sessionsRef, (map) => {
          map.clear();
          return map;
        });
      });

    return {
      provider: PROVIDER,
      capabilities: ANTIGRAVITY_SDK_ADAPTER_CAPABILITIES,
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      streamEvents: Stream.fromQueue(eventsQueue),
    };
  });
