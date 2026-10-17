import * as NodeCrypto from "node:crypto";
import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  RuntimeRequestId,
  TurnId,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ThreadId,
  type TurnCompletedPayload,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type * as AcpSchema from "effect-acp/schema";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { mapAcpToAdapterError } from "../acp/AcpAdapterSupport.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import { parsePermissionRequest } from "../acp/AcpRuntimeModel.ts";
import {
  antigravityPermissionMode,
  antigravityErrorMessage,
  selectAntigravityModel,
  type AntigravityRuntime,
  type AntigravityRuntimeFactory,
} from "../acp/AntigravityAcpSupport.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

const provider = ProviderDriverKind.make("antigravity");
const decodeCursor = Schema.decodeUnknownOption(
  Schema.Struct({ protocol: Schema.Literal("antigravity-acp"), sessionId: Schema.NonEmptyString }),
);
type Adapter = ProviderAdapterShape<ProviderAdapterError>;
type Pending = {
  request: AcpSchema.RequestPermissionRequest;
  response: Deferred.Deferred<AcpSchema.RequestPermissionResponse>;
  question: boolean;
};
type Session = {
  session: ProviderSession;
  providerSessionId?: string;
  runtime: AntigravityRuntime;
  scope: Scope.Closeable;
  pending: Map<ApprovalRequestId, Pending>;
  sendLock: Semaphore.Semaphore;
  turn?: { id: TurnId; cancelled: boolean; reasoning: boolean } | undefined;
  fiber?: Fiber.Fiber<void, never>;
};

export const makeAntigravityAcpAdapter = Effect.fn("makeAntigravityAcpAdapter")(
  function* (options: { instanceId: ProviderInstanceId; makeRuntime: AntigravityRuntimeFactory }) {
    const owner = yield* Scope.Scope;
    const fs = yield* FileSystem.FileSystem;
    const server = yield* ServerConfig;
    const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, Session>();
    const stamp = () => ({
      eventId: EventId.make(NodeCrypto.randomUUID()),
      createdAt: new Date().toISOString(),
    });
    const emit = (event: ProviderRuntimeEvent) =>
      Queue.offer(events, { ...event, providerInstanceId: options.instanceId });
    const requireSession = (threadId: ThreadId) =>
      sessions.has(threadId)
        ? Effect.succeed(sessions.get(threadId)!)
        : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider, threadId }));
    const validation = (operation: string, issue: string) =>
      new ProviderAdapterValidationError({ provider, operation, issue });
    const cancelRequests = (context: Session) =>
      Effect.gen(function* () {
        const requests = [...context.pending.entries()];
        context.pending.clear();
        for (const [requestId, pending] of requests) {
          yield* Deferred.succeed(pending.response, { outcome: { outcome: "cancelled" } });
          const common = {
            ...stamp(),
            provider,
            threadId: context.session.threadId,
            turnId: context.turn?.id,
            requestId: RuntimeRequestId.make(requestId),
          };
          yield* emit(
            pending.question
              ? { type: "user-input.resolved", ...common, payload: { answers: {} } }
              : {
                  type: "request.resolved",
                  ...common,
                  payload: { requestType: "dynamic_tool_call", decision: "cancel" },
                },
          );
        }
      });
    const settle = (context: Session, payload: TurnCompletedPayload) =>
      Effect.gen(function* () {
        const turn = context.turn;
        if (!turn) return;
        yield* cancelRequests(context);
        if (turn.reasoning)
          yield* emit({
            type: "item.completed",
            ...stamp(),
            provider,
            threadId: context.session.threadId,
            turnId: turn.id,
            itemId: RuntimeItemId.make(`reasoning-${turn.id}`),
            payload: { itemType: "reasoning", status: "completed" },
          });
        context.turn = undefined;
        context.session = {
          ...context.session,
          activeTurnId: undefined,
          status: payload.state === "failed" ? "error" : "ready",
          lastError: payload.errorMessage,
          updatedAt: stamp().createdAt,
        };
        yield* emit({
          type: "turn.completed",
          ...stamp(),
          provider,
          threadId: context.session.threadId,
          turnId: turn.id,
          payload,
        });
      }).pipe(Effect.uninterruptible);

    const stopSession: Adapter["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (context.turn) context.turn.cancelled = true;
        yield* cancelRequests(context);
        yield* settle(context, { state: "interrupted" });
        if (context.fiber) yield* Fiber.interrupt(context.fiber);
        yield* Scope.close(context.scope, Exit.void);
        sessions.delete(threadId);
      });
    const stopAll = () => Effect.forEach([...sessions.keys()], stopSession, { discard: true });
    yield* Effect.addFinalizer(() => stopAll().pipe(Effect.orDie));

    const startSession: Adapter["startSession"] = (input) =>
      Effect.gen(function* () {
        if (!input.cwd)
          return yield* validation("startSession", "Antigravity ACP needs a project directory.");
        const cursor =
          input.resumeCursor === undefined
            ? undefined
            : Option.getOrUndefined(decodeCursor(input.resumeCursor));
        if (input.resumeCursor !== undefined && !cursor)
          return yield* validation(
            "startSession",
            "This conversation belongs to the removed Antigravity CLI or SDK runtime. Start a new ACP thread; the old history is preserved.",
          );
        if (sessions.has(input.threadId)) yield* stopSession(input.threadId);
        const scope = yield* Scope.fork(owner, "sequential");
        return yield* Effect.gen(function* () {
          const mcp = McpProviderSession.readMcpProviderSession(input.threadId);
          const runtime = yield* options.makeRuntime({
            cwd: input.cwd!,
            ...(cursor ? { resumeSessionId: cursor.sessionId } : {}),
            mcpServers: mcp
              ? McpProviderSession.makeSealCodeMcpEndpoints(mcp).map((endpoint) => ({
                  type: "http" as const,
                  name: endpoint.name,
                  url: endpoint.url,
                  headers: [{ name: "Authorization", value: endpoint.authorizationHeader }],
                }))
              : [],
          });
          const context: Session = {
            runtime,
            scope,
            sendLock: yield* Semaphore.make(1),
            pending: new Map(),
            session: {
              provider,
              providerInstanceId: options.instanceId,
              threadId: input.threadId,
              cwd: input.cwd,
              runtimeMode: input.runtimeMode,
              status: "connecting",
              createdAt: stamp().createdAt,
              updatedAt: stamp().createdAt,
            },
          };
          yield* runtime.handleRequestPermission((request) =>
            Effect.gen(function* () {
              const requestId = ApprovalRequestId.make(NodeCrypto.randomUUID());
              const response = yield* Deferred.make<AcpSchema.RequestPermissionResponse>();
              const question = request.toolCall.toolCallId.startsWith("interaction_");
              context.pending.set(requestId, { request, response, question });
              if (question) {
                yield* emit({
                  type: "user-input.requested",
                  ...stamp(),
                  provider,
                  threadId: input.threadId,
                  turnId: context.turn?.id,
                  requestId: RuntimeRequestId.make(requestId),
                  payload: {
                    questions: [
                      {
                        id: request.toolCall.toolCallId,
                        header: "Question",
                        question: request.toolCall.title || "Choose an option.",
                        multiSelect: false,
                        allowCustomAnswer: false,
                        options: request.options.map((option) => ({
                          label: option.name || option.optionId,
                          description: option.name || option.optionId,
                        })),
                      },
                    ],
                  },
                });
              } else {
                const permission = parsePermissionRequest(request);
                const opened = makeAcpRequestOpenedEvent({
                  stamp: stamp(),
                  provider,
                  threadId: input.threadId,
                  turnId: context.turn?.id,
                  requestId: RuntimeRequestId.make(requestId),
                  permissionRequest: permission,
                  detail:
                    permission.detail ??
                    request.toolCall.title ??
                    "Antigravity requests permission",
                  args: request.toolCall.rawInput,
                  source: "acp.jsonrpc",
                  method: "session/request_permission",
                  rawPayload: request,
                });
                if (opened.type === "request.opened")
                  yield* emit({
                    ...opened,
                    payload: {
                      ...opened.payload,
                      availableDecisions: [
                        "cancel",
                        ...request.options.flatMap((option) =>
                          option.kind === "allow_once"
                            ? ["accept" as const]
                            : option.kind === "allow_always"
                              ? ["acceptForSession" as const]
                              : option.kind === "reject_once"
                                ? ["decline" as const]
                                : [],
                        ),
                      ],
                    },
                  });
              }
              return yield* Deferred.await(response).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    context.pending.delete(requestId);
                  }),
                ),
              );
            }),
          );
          yield* runtime.getEvents().pipe(
            Stream.runForEach((event) => {
              if (event._tag === "EventStreamBarrier")
                return Deferred.succeed(event.acknowledge, undefined);
              if (!context.turn) return Effect.void;
              const base = {
                stamp: stamp(),
                provider,
                threadId: input.threadId,
                turnId: context.turn.id,
              };
              switch (event._tag) {
                case "AssistantItemStarted":
                case "AssistantItemCompleted":
                  return emit(
                    makeAcpAssistantItemEvent({
                      ...base,
                      itemId: event.itemId,
                      lifecycle:
                        event._tag === "AssistantItemStarted" ? "item.started" : "item.completed",
                    }),
                  );
                case "ContentDelta":
                  return emit(makeAcpContentDeltaEvent({ ...base, ...event }));
                case "ToolCallUpdated":
                  return emit(
                    makeAcpToolCallEvent({
                      ...base,
                      toolCall: event.toolCall,
                      rawPayload: event.rawPayload,
                    }),
                  );
                case "PlanUpdated":
                  return emit(
                    makeAcpPlanUpdatedEvent({
                      ...base,
                      payload: event.payload,
                      rawPayload: event.rawPayload,
                      source: "acp.jsonrpc",
                      method: "session/update",
                    }),
                  );
                case "ModeChanged":
                  return Effect.void;
              }
            }),
            Effect.forkIn(scope),
          );
          yield* runtime.handleSessionUpdate((notification) =>
            Effect.gen(function* () {
              const update = notification.update;
              const turn = context.turn;
              if (
                !turn ||
                notification.sessionId !== context.providerSessionId ||
                update.sessionUpdate !== "agent_thought_chunk" ||
                update.content.type !== "text"
              )
                return;
              const common = {
                ...stamp(),
                provider,
                threadId: input.threadId,
                turnId: turn.id,
                itemId: RuntimeItemId.make(`reasoning-${turn.id}`),
              };
              if (!turn.reasoning) {
                turn.reasoning = true;
                yield* emit({
                  type: "item.started",
                  ...common,
                  payload: { itemType: "reasoning", status: "inProgress" },
                });
              }
              yield* emit({
                type: "content.delta",
                ...common,
                eventId: EventId.make(NodeCrypto.randomUUID()),
                payload: { streamKind: "reasoning_text", delta: update.content.text },
              });
            }),
          );
          const started = yield* runtime.start();
          context.providerSessionId = started.sessionId;
          const model = yield* selectAntigravityModel(runtime, input.modelSelection?.model);
          yield* runtime.setMode(antigravityPermissionMode(input.runtimeMode));
          context.session = {
            ...context.session,
            status: "ready",
            model,
            resumeCursor: { protocol: "antigravity-acp", sessionId: started.sessionId },
          };
          sessions.set(input.threadId, context);
          yield* emit({
            type: "thread.started",
            ...stamp(),
            provider,
            threadId: input.threadId,
            payload: { providerThreadId: started.sessionId },
          });
          return context.session;
        }).pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.catchCause((cause) =>
            Effect.fail(
              new ProviderAdapterRequestError({
                provider,
                method: "session/new",
                detail: antigravityErrorMessage(cause),
                cause,
              }),
            ),
          ),
          Effect.onError(() => Scope.close(scope, Exit.void)),
        );
      });

    const sendTurn: Adapter["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);
        return yield* context.sendLock.withPermit(
          Effect.gen(function* () {
            if (context.turn)
              return yield* validation(
                "sendTurn",
                "Antigravity already has a running turn. Interrupt it before sending another message.",
              );
            if (input.interactionMode === "plan")
              return yield* validation(
                "sendTurn",
                "Use Antigravity's native /plan command for planning.",
              );
            const prompt: AcpSchema.ContentBlock[] = input.input
              ? [{ type: "text", text: input.input }]
              : [];
            for (const attachment of input.attachments ?? []) {
              const file = resolveAttachmentPath({
                attachmentsDir: server.attachmentsDir,
                attachment,
              });
              if (!file)
                return yield* validation("sendTurn", "The attachment is no longer available.");
              const data = yield* fs.readFile(file).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider,
                      method: "attachment.read",
                      detail: "Could not read the attachment.",
                      cause,
                    }),
                ),
              );
              if (data.byteLength > 10 * 1024 * 1024)
                return yield* validation(
                  "sendTurn",
                  "Antigravity images must be 10 MiB or smaller.",
                );
              prompt.push({
                type: "image",
                mimeType: attachment.mimeType,
                data: Buffer.from(data).toString("base64"),
              });
            }
            if (!prompt.length)
              return yield* validation("sendTurn", "A message or attachment is required.");
            const turn = {
              id: TurnId.make(NodeCrypto.randomUUID()),
              cancelled: false,
              reasoning: false,
            };
            context.turn = turn;
            context.session = {
              ...context.session,
              status: "running",
              activeTurnId: turn.id,
              lastError: undefined,
            };
            yield* emit({
              type: "turn.started",
              ...stamp(),
              provider,
              threadId: input.threadId,
              turnId: turn.id,
              payload: {},
            });
            context.fiber = yield* Effect.gen(function* () {
              const model = yield* selectAntigravityModel(
                context.runtime,
                input.modelSelection?.model ?? context.session.model,
              );
              context.session = { ...context.session, model };
              if (turn.cancelled) return yield* settle(context, { state: "interrupted" });
              const result = yield* context.runtime.prompt({ prompt });
              yield* context.runtime.drainEvents;
              yield* settle(context, {
                state:
                  turn.cancelled || result.stopReason === "cancelled" ? "interrupted" : "completed",
                stopReason: result.stopReason,
              });
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.gen(function* () {
                  yield* context.runtime.drainEvents;
                  yield* settle(context, {
                    state: turn.cancelled ? "interrupted" : "failed",
                    ...(turn.cancelled ? {} : { errorMessage: Cause.pretty(cause) }),
                  });
                }),
              ),
              Effect.forkIn(context.scope),
            );
            return {
              threadId: input.threadId,
              turnId: turn.id,
              resumeCursor: context.session.resumeCursor,
            };
          }),
        );
      });

    const respond: Adapter["respondToRequest"] = (threadId, requestId, decision) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const pending = context.pending.get(requestId);
        if (!pending || pending.question)
          return yield* validation("respondToRequest", "This approval is no longer pending.");
        const kind =
          decision === "accept"
            ? "allow_once"
            : decision === "acceptForSession"
              ? "allow_always"
              : "reject_once";
        const option = pending.request.options.find((option) => option.kind === kind);
        if (decision !== "cancel" && !option)
          return yield* validation(
            "respondToRequest",
            "Antigravity did not offer this permission choice.",
          );
        context.pending.delete(requestId);
        yield* Deferred.succeed(pending.response, {
          outcome:
            decision === "cancel"
              ? { outcome: "cancelled" }
              : { outcome: "selected", optionId: option!.optionId },
        });
        yield* emit({
          type: "request.resolved",
          ...stamp(),
          provider,
          threadId,
          turnId: context.turn?.id,
          requestId: RuntimeRequestId.make(requestId),
          payload: { requestType: "dynamic_tool_call", decision },
        });
      });
    const respondToUserInput: Adapter["respondToUserInput"] = (threadId, requestId, answers) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const pending = context.pending.get(requestId);
        if (!pending?.question)
          return yield* validation("respondToUserInput", "This question is no longer pending.");
        const answer = answers[pending.request.toolCall.toolCallId];
        const value =
          typeof answer === "string"
            ? answer
            : Array.isArray(answer) && answer.length === 1
              ? answer[0]
              : undefined;
        const matches = pending.request.options.filter(
          (option) => option.optionId === value || option.name === value,
        );
        if (matches.length !== 1)
          return yield* validation(
            "respondToUserInput",
            "Choose one of Antigravity's offered answers; this question does not accept custom text.",
          );
        context.pending.delete(requestId);
        yield* Deferred.succeed(pending.response, {
          outcome: { outcome: "selected", optionId: matches[0]!.optionId },
        });
        yield* emit({
          type: "user-input.resolved",
          ...stamp(),
          provider,
          threadId,
          turnId: context.turn?.id,
          requestId: RuntimeRequestId.make(requestId),
          payload: { answers },
        });
      });
    return {
      provider,
      capabilities: {
        sessionModelSwitch: "in-session",
        stablePromptPrefix: false,
        contextCompaction: "provider-native",
        promptCaching: "provider-managed",
        toolTransport: "mcp",
        detachedDelegation: false,
      },
      startSession,
      sendTurn,
      respondToRequest: respond,
      respondToUserInput,
      stopSession,
      stopAll,
      interruptTurn: (threadId, turnId) =>
        Effect.gen(function* () {
          const context = yield* requireSession(threadId);
          if (!context.turn || (turnId && context.turn.id !== turnId)) return;
          context.turn.cancelled = true;
          yield* cancelRequests(context);
          yield* context.runtime.cancel.pipe(
            Effect.mapError((error) =>
              mapAcpToAdapterError(provider, threadId, "session/cancel", error),
            ),
          );
          if (context.fiber) yield* Fiber.await(context.fiber);
        }),
      hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
      listSessions: () =>
        Effect.sync(() => [...sessions.values()].map((context) => context.session)),
      readThread: (threadId) => requireSession(threadId).pipe(Effect.as({ threadId, turns: [] })),
      rollbackThread: () =>
        Effect.fail(
          validation(
            "rollbackThread",
            "Antigravity ACP does not support conversation rewind. Start a new thread.",
          ),
        ),
      streamEvents: Stream.fromQueue(events),
    } satisfies Adapter;
  },
);
