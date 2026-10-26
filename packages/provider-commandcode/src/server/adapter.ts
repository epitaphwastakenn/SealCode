/**
 * One `commandcode --print` process per turn. Nothing stays resident between
 * turns, so a session is only bookkeeping: the CLI's own session id, read from
 * each run's result frame, is the resume cursor that carries the conversation.
 */
import { AgentScope } from "@t3tools/shared/AgentScope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import type {
  OrchestrationV2ExecutionNode,
  OrchestrationV2ProviderCapabilities,
  OrchestrationV2ProviderRef,
  OrchestrationV2ProviderSession,
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurn,
  OrchestrationV2TurnItem,
  ProviderInstanceId,
  ServerProviderModel,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { providerMessageTextWithAttachmentPaths } from "@t3tools/provider-core/server/attachmentPrompt";
import {
  makeProviderFailure,
  makeProviderFailureTurnItem,
} from "@t3tools/provider-core/server/failure";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { turnScopedSelectionTransition } from "@t3tools/provider-core/server/selectionTransition";

import { COMMAND_CODE_DRIVER_KIND } from "../identity.ts";
import type { CommandCodeSettings } from "../settings.ts";
import {
  commandCodeArgs,
  commandCodeFailure,
  commandCodeToolText,
  describeCommandCodeError,
  parseCommandCodeFrame,
  resolveCommandCodeEffort,
  type CommandCodeFrame,
  type CommandCodeResult,
} from "./cli.ts";

const STREAM_FLUSH = Duration.millis(50);
/** Lets stdout drain after the process exits, since a tool's child can hold the pipe open. */
const EXIT_DRAIN = Duration.millis(250);
const STDERR_SETTLE = Duration.millis(250);
const KILL_GRACE = Duration.seconds(2);
const STDERR_TAIL_CHARS = 4_000;

const CommandCodeCapabilitiesV2 = {
  runtimePolicy: { enforcement: "native" },
  sessions: {
    supportsMultipleProviderThreadsPerSession: false,
    supportsModelSwitchInSession: true,
    supportsProviderSwitchingViaHandoff: true,
    supportsRuntimeModeSwitchInSession: true,
    pendingRequestsSurviveRestart: false,
  },
  threads: {
    canCreateEmptyThread: true,
    canReadThreadSnapshot: false,
    canRollbackThread: false,
    canForkThread: false,
    canForkFromTurn: false,
    canForkFromSubagentThread: false,
    exposesNativeThreadId: true,
  },
  turns: {
    exposesNativeTurnId: false,
    emitsTurnStarted: true,
    emitsTurnCompleted: true,
    supportsInterrupt: true,
    supportsActiveSteering: false,
    // Stop kills the process, and a killed first turn leaves no session id to resume.
    supportsSteeringByInterruptRestart: false,
    supportsQueuedMessages: true,
    terminalStatusQuality: "strong",
  },
  streaming: {
    streamsAssistantText: true,
    streamsReasoning: true,
    streamsToolOutput: false,
    streamsPlanText: false,
    emitsMessageCompleted: true,
  },
  tools: {
    exposesToolItemIds: true,
    emitsToolStarted: true,
    emitsToolCompleted: true,
    emitsToolOutput: true,
    supportsMcpTools: false,
    supportsDynamicToolCallbacks: false,
  },
  approvals: {
    supportsCommandApproval: false,
    supportsFileReadApproval: false,
    supportsFileChangeApproval: false,
    supportsApplyPatchApproval: false,
    approvalsHaveNativeRequestIds: false,
    approvalCallbacksAreLiveOnly: false,
    approvalsCanOriginateFromSubagents: false,
  },
  planning: {
    emitsPlanUpdated: false,
    emitsTodoList: false,
    emitsProposedPlan: false,
    supportsStructuredQuestions: false,
    planDeltasHaveItemIds: false,
  },
  subagents: {
    supportsSubagents: false,
    exposesSubagentThreadIds: false,
    emitsSubagentLifecycle: false,
    canWaitForSubagents: false,
    canCloseSubagents: false,
    canForkSubagentThread: false,
  },
  context: {
    acceptsSystemContext: false,
    acceptsDeveloperContext: false,
    acceptsSyntheticUserContext: true,
    canGenerateSummaries: false,
    canConsumeHandoffSummaries: true,
    supportsDeltaHandoff: true,
    supportsFullThreadHandoff: true,
    maxRecommendedHandoffChars: null,
  },
  checkpointing: {
    appCanCheckpointFilesystem: true,
    supportsNestedCheckpointScopes: false,
    providerCanRollbackConversation: false,
    providerRollbackReturnsSnapshot: false,
    providerCanReadConversationSnapshot: false,
  },
  identity: {
    nativeThreadIds: "strong",
    nativeTurnIds: "weak",
    nativeItemIds: "strong",
    nativeRequestIds: "none",
  },
} satisfies OrchestrationV2ProviderCapabilities;

export interface CommandCodeAdapterV2Options {
  readonly instanceId: ProviderInstanceId;
  readonly settings: CommandCodeSettings;
  readonly environment: NodeJS.ProcessEnv;
  /** Read for each turn so a refreshed catalog applies without reopening the session. */
  readonly modelCatalog: Effect.Effect<ReadonlyArray<ServerProviderModel>>;
}

type ItemStatus = OrchestrationV2TurnItem["status"];

interface StreamItem {
  readonly kind: "assistant_message" | "reasoning";
  readonly nativeItemId: string;
  readonly startedAt: DateTime.Utc;
  text: string;
  completed: boolean;
  flushScheduled: boolean;
}

interface ToolCall {
  readonly toolName: string;
  readonly startedAt: DateTime.Utc;
  input: unknown;
  terminal: boolean;
}

interface ActiveTurn {
  readonly input: ProviderAdapter.ProviderAdapterV2TurnInput;
  readonly providerTurn: OrchestrationV2ProviderTurn;
  readonly child: ChildProcessSpawner.ChildProcessHandle;
  readonly scope: Scope.Closeable;
  readonly ordinals: Map<string, number>;
  readonly tools: Map<string, ToolCall>;
  nextOrdinal: number;
  streamCount: number;
  openText: StreamItem | null;
  openReasoning: StreamItem | null;
  sawAssistantText: boolean;
  result: CommandCodeResult | undefined;
  runError: string | undefined;
  interrupted: boolean;
}

interface ThreadState {
  providerThread: OrchestrationV2ProviderThread;
  /** The CLI's session id from the latest run, for when the orchestrator's copy lags. */
  sessionId: string | null;
}

const providerRef = (
  nativeId: string,
  strength: "strong" | "weak" = "strong",
): OrchestrationV2ProviderRef => ({ driver: COMMAND_CODE_DRIVER_KIND, nativeId, strength });

const asRecord = (value: unknown) => (Predicate.isObject(value) ? value : undefined);
const asString = (value: unknown) => (Predicate.isString(value) ? value : undefined);

export const makeCommandCodeAdapterV2 = Effect.fn("makeCommandCodeAdapterV2")(function* (
  options: CommandCodeAdapterV2Options,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const agentScope = yield* AgentScope;
  const platform = yield* HostProcess.Platform;
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  const host = yield* ProviderHost.ProviderHost;

  const protocolError = (detail: string) =>
    new ProviderAdapter.ProviderAdapterProtocolError({
      driver: COMMAND_CODE_DRIVER_KIND,
      detail,
    });

  return ProviderAdapter.ProviderAdapterV2.of({
    instanceId: options.instanceId,
    driver: COMMAND_CODE_DRIVER_KIND,
    getCapabilities: () => Effect.succeed(CommandCodeCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed(turnScopedSelectionTransition()),
    openSession: Effect.fn("CommandCodeAdapterV2.openSession")(function* (
      input: ProviderAdapter.ProviderAdapterV2OpenSessionInput,
    ) {
      const sessionScope = yield* Effect.scope;
      const defaultCwd = input.runtimePolicy.cwd ?? host.paths.cwd;
      const openedAt = yield* DateTime.now;
      let sessionEntity: OrchestrationV2ProviderSession = {
        id: input.providerSessionId,
        driver: COMMAND_CODE_DRIVER_KIND,
        providerInstanceId: options.instanceId,
        status: "ready",
        cwd: defaultCwd,
        model: input.modelSelection.model,
        capabilities: CommandCodeCapabilitiesV2,
        createdAt: openedAt,
        updatedAt: openedAt,
        lastError: null,
      };
      const events = yield* Queue.unbounded<
        ProviderAdapter.ProviderAdapterV2Event,
        ProviderAdapter.ProviderAdapterV2Error | Cause.Done
      >();
      yield* Effect.addFinalizer(() => Queue.end(events));
      // A completed stream item and its trailing throttled flush must not
      // interleave, or a stale `streaming` update could land after the final one.
      const streamPermit = yield* Semaphore.make(1);
      let thread: ThreadState | null = null;
      let active: ActiveTurn | null = null;

      const emit = (event: ProviderAdapter.ProviderAdapterV2Event) =>
        Queue.offer(events, event).pipe(Effect.asVoid);

      const updateSession = Effect.fnUntraced(function* (
        patch: Pick<OrchestrationV2ProviderSession, "status" | "lastError"> &
          Partial<Pick<OrchestrationV2ProviderSession, "model">>,
      ) {
        sessionEntity = { ...sessionEntity, ...patch, updatedAt: yield* DateTime.now };
        yield* emit({
          type: "provider_session.updated",
          driver: COMMAND_CODE_DRIVER_KIND,
          providerSession: sessionEntity,
        });
      });

      const updateThread = Effect.fnUntraced(function* (
        state: ThreadState,
        patch: Partial<OrchestrationV2ProviderThread>,
      ) {
        state.providerThread = {
          ...state.providerThread,
          ...patch,
          updatedAt: yield* DateTime.now,
        };
        yield* emit({
          type: "provider_thread.updated",
          driver: COMMAND_CODE_DRIVER_KIND,
          providerThread: state.providerThread,
        });
      });

      const itemOrdinal = (turn: ActiveTurn, nativeItemId: string): number => {
        const existing = turn.ordinals.get(nativeItemId);
        if (existing !== undefined) return existing;
        const ordinal = turn.nextOrdinal++;
        turn.ordinals.set(nativeItemId, ordinal);
        return ordinal;
      };

      const itemBase = (
        turn: ActiveTurn,
        nativeItemId: string,
        startedAt: DateTime.Utc,
        updatedAt: DateTime.Utc,
      ) => ({
        id: idAllocator.derive.turnItemFromProviderItem({
          driver: COMMAND_CODE_DRIVER_KIND,
          nativeItemId,
        }),
        threadId: turn.input.threadId,
        runId: turn.input.runId,
        nodeId: idAllocator.derive.nodeFromProviderItem({
          driver: COMMAND_CODE_DRIVER_KIND,
          nativeItemId,
        }),
        providerThreadId: turn.input.providerThread.id,
        providerTurnId: turn.providerTurn.id,
        nativeItemRef: providerRef(nativeItemId),
        parentItemId: null,
        ordinal: itemOrdinal(turn, nativeItemId),
        startedAt,
        updatedAt,
      });

      const emitNode = (
        turn: ActiveTurn,
        nativeItemId: string,
        kind: OrchestrationV2ExecutionNode["kind"],
        status: OrchestrationV2ExecutionNode["status"],
        startedAt: DateTime.Utc,
        completedAt: DateTime.Utc | null,
      ) =>
        emit({
          type: "node.updated",
          driver: COMMAND_CODE_DRIVER_KIND,
          node: {
            id: idAllocator.derive.nodeFromProviderItem({
              driver: COMMAND_CODE_DRIVER_KIND,
              nativeItemId,
            }),
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            parentNodeId: turn.input.rootNodeId,
            rootNodeId: turn.input.rootNodeId,
            kind,
            status,
            countsForRun: false,
            providerThreadId: turn.input.providerThread.id,
            providerTurnId: turn.providerTurn.id,
            nativeItemRef: providerRef(nativeItemId),
            runtimeRequestId: null,
            checkpointScopeId: null,
            startedAt,
            completedAt,
          },
        });

      const emitStreamItem = Effect.fnUntraced(function* (
        turn: ActiveTurn,
        item: StreamItem,
        streaming: boolean,
      ) {
        const emittedAt = yield* DateTime.now;
        const completedAt = streaming ? null : emittedAt;
        const status = streaming ? "running" : "completed";
        const base = itemBase(turn, item.nativeItemId, item.startedAt, emittedAt);
        yield* emitNode(turn, item.nativeItemId, item.kind, status, item.startedAt, completedAt);
        if (item.kind === "reasoning") {
          yield* emit({
            type: "turn_item.updated",
            driver: COMMAND_CODE_DRIVER_KIND,
            turnItem: {
              ...base,
              status,
              title: null,
              completedAt,
              type: "reasoning",
              text: item.text,
              streaming,
            },
          });
          return;
        }
        const messageId = idAllocator.derive.messageFromProviderItem({
          driver: COMMAND_CODE_DRIVER_KIND,
          nativeItemId: item.nativeItemId,
        });
        yield* emit({
          type: "turn_item.updated",
          driver: COMMAND_CODE_DRIVER_KIND,
          turnItem: {
            ...base,
            status,
            title: null,
            completedAt,
            type: "assistant_message",
            messageId,
            text: item.text,
            streaming,
          },
        });
        yield* emit({
          type: "message.updated",
          driver: COMMAND_CODE_DRIVER_KIND,
          message: {
            id: messageId,
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            nodeId: base.nodeId,
            role: "assistant",
            text: item.text,
            attachments: [],
            streaming,
            createdBy: "agent",
            creationSource: "provider",
            createdAt: item.startedAt,
            updatedAt: emittedAt,
          },
        });
      });

      const scheduleFlush = (turn: ActiveTurn, item: StreamItem) =>
        Effect.suspend(() => {
          if (item.flushScheduled || item.completed) return Effect.void;
          item.flushScheduled = true;
          return Effect.sleep(STREAM_FLUSH).pipe(
            Effect.andThen(
              streamPermit.withPermits(1)(
                Effect.suspend(() => {
                  item.flushScheduled = false;
                  return item.completed ? Effect.void : emitStreamItem(turn, item, true);
                }),
              ),
            ),
            Effect.forkIn(turn.scope),
            Effect.asVoid,
          );
        });

      const completeStreamItem = (turn: ActiveTurn, item: StreamItem | null) =>
        item === null
          ? Effect.void
          : streamPermit.withPermits(1)(
              Effect.suspend(() => {
                if (item.completed) return Effect.void;
                item.completed = true;
                return item.text.length === 0 ? Effect.void : emitStreamItem(turn, item, false);
              }),
            );

      const appendStreamText = Effect.fnUntraced(function* (
        turn: ActiveTurn,
        kind: StreamItem["kind"],
        delta: string,
      ) {
        const current = kind === "reasoning" ? turn.openReasoning : turn.openText;
        let item = current;
        if (item === null || item.completed) {
          item = {
            kind,
            nativeItemId: `${turn.providerTurn.id}:${kind === "reasoning" ? "r" : "m"}${turn.streamCount++}`,
            startedAt: yield* DateTime.now,
            text: "",
            completed: false,
            flushScheduled: false,
          };
          itemOrdinal(turn, item.nativeItemId);
          if (kind === "reasoning") turn.openReasoning = item;
          else turn.openText = item;
        }
        item.text += delta;
        if (kind === "assistant_message") turn.sawAssistantText = true;
        yield* scheduleFlush(turn, item);
      });

      const completeOpenStreamItems = (turn: ActiveTurn) =>
        completeStreamItem(turn, turn.openReasoning).pipe(
          Effect.andThen(completeStreamItem(turn, turn.openText)),
        );

      const emitTool = Effect.fnUntraced(function* (
        turn: ActiveTurn,
        toolCallId: string,
        call: ToolCall,
        status: ItemStatus,
        outputText: string | undefined,
      ) {
        const emittedAt = yield* DateTime.now;
        const completedAt = status === "running" ? null : emittedAt;
        const base = {
          ...itemBase(turn, toolCallId, call.startedAt, emittedAt),
          status,
          completedAt,
        };
        const input = asRecord(call.input);
        yield* emitNode(turn, toolCallId, "tool_call", status, call.startedAt, completedAt);
        const filePath = asString(input?.["file_path"]);
        let turnItem: OrchestrationV2TurnItem;
        if (call.toolName === "shell_command") {
          const command = asString(input?.["command"]) ?? "";
          const rawArgs = input?.["args"];
          const args = Array.isArray(rawArgs) ? rawArgs.filter(Predicate.isString) : [];
          turnItem = {
            ...base,
            title: call.toolName,
            type: "command_execution",
            input: [command, ...args].join(" "),
            ...(outputText === undefined ? {} : { output: outputText }),
            ...(status === "failed" ? { outputIndicatesFailure: true } : {}),
          };
        } else if ((call.toolName === "edit_file" || call.toolName === "write_file") && filePath) {
          const oldStr = asString(input?.["old_string"]);
          const newStr = asString(
            input?.[call.toolName === "edit_file" ? "new_string" : "content"],
          );
          turnItem = {
            ...base,
            title: call.toolName,
            type: "file_change",
            fileName: filePath,
            ...(oldStr === undefined || oldStr.length === 0 ? {} : { oldStr }),
            ...(newStr === undefined ? {} : { newStr }),
            ...(status === "failed" && outputText !== undefined ? { diffStr: outputText } : {}),
          };
        } else {
          turnItem = {
            ...base,
            title: call.toolName,
            type: "dynamic_tool",
            toolName: call.toolName,
            input: call.input ?? {},
            ...(outputText === undefined ? {} : { output: outputText }),
          };
        }
        yield* emit({ type: "turn_item.updated", driver: COMMAND_CODE_DRIVER_KIND, turnItem });
      });

      /** A run reports tool failures as events; they never decide the turn's status. */
      const settleTool = Effect.fnUntraced(function* (
        turn: ActiveTurn,
        event: Readonly<Record<string, unknown>>,
        status: Exclude<ItemStatus, "running">,
        outputText: string | undefined,
      ) {
        const toolCallId = asString(event["toolCallId"]);
        const call = toolCallId === undefined ? undefined : turn.tools.get(toolCallId);
        if (toolCallId === undefined || call === undefined || call.terminal) return;
        call.terminal = true;
        yield* emitTool(turn, toolCallId, call, status, outputText);
      });

      const handleEvent = Effect.fnUntraced(function* (
        turn: ActiveTurn,
        event: Readonly<Record<string, unknown>>,
      ) {
        switch (event["type"]) {
          case "text_delta": {
            const delta = asString(event["delta"]);
            if (delta === undefined || delta.length === 0) return;
            yield* completeStreamItem(turn, turn.openReasoning);
            yield* appendStreamText(turn, "assistant_message", delta);
            return;
          }
          case "thinking_delta": {
            const delta = asString(event["delta"]);
            if (delta !== undefined && delta.length > 0) {
              yield* appendStreamText(turn, "reasoning", delta);
            }
            return;
          }
          case "thinking_end":
            yield* completeStreamItem(turn, turn.openReasoning);
            return;
          case "tool_queued":
          case "tool_running": {
            const toolCallId = asString(event["toolCallId"]);
            if (toolCallId === undefined) return;
            // Text before a tool call and text after it are separate messages.
            yield* completeOpenStreamItems(turn);
            let call = turn.tools.get(toolCallId);
            if (call === undefined) {
              call = {
                toolName: asString(event["toolName"]) ?? "tool",
                startedAt: yield* DateTime.now,
                input: event["input"],
                terminal: false,
              };
              turn.tools.set(toolCallId, call);
              itemOrdinal(turn, toolCallId);
            }
            if (!call.terminal) yield* emitTool(turn, toolCallId, call, "running", undefined);
            return;
          }
          case "tool_completed":
            yield* settleTool(turn, event, "completed", commandCodeToolText(event["result"]));
            return;
          case "tool_errored":
            yield* settleTool(turn, event, "failed", describeCommandCodeError(event["error"]));
            return;
          case "tool_denied":
            yield* settleTool(
              turn,
              event,
              "failed",
              "CommandCode refused this tool because its permission mode does not allow it.",
            );
            return;
          case "run_error":
            turn.runError = describeCommandCodeError(event["error"]);
            return;
          default:
            // The event list grows with the CLI; unknown types are not an error.
            return;
        }
      });

      const handleFrame = (turn: ActiveTurn, frame: CommandCodeFrame) =>
        Effect.suspend(() => {
          if (frame.type === "result") {
            turn.result = frame.result;
            return Effect.void;
          }
          return handleEvent(turn, frame.event);
        });

      const finishTurn = Effect.fnUntraced(function* (
        state: ThreadState,
        turn: ActiveTurn,
        outcome: { readonly exitCode: number | undefined; readonly stderr: string },
      ) {
        if (active !== turn) return;
        active = null;
        const completedAt = yield* DateTime.now;
        const { result } = turn;
        if (!turn.sawAssistantText && result !== undefined && result.finalText.trim().length > 0) {
          // A CLI that sent no deltas still returns the final answer in its result.
          yield* appendStreamText(turn, "assistant_message", result.finalText);
        }
        yield* completeOpenStreamItems(turn);
        const unfinishedStatus: ItemStatus = turn.interrupted ? "interrupted" : "failed";
        for (const [toolCallId, call] of turn.tools) {
          if (call.terminal) continue;
          call.terminal = true;
          yield* emitTool(turn, toolCallId, call, unfinishedStatus, undefined);
        }
        const emptyRun =
          turn.tools.size === 0 &&
          !turn.sawAssistantText &&
          (result?.finalText.trim() ?? "").length === 0;
        const failure = turn.interrupted
          ? null
          : (commandCodeFailure({
              result,
              exitCode: outcome.exitCode,
              stderr: outcome.stderr,
              runError: turn.runError,
            }) ??
            (emptyRun
              ? makeProviderFailure({
                  class: "provider_error",
                  message: "CommandCode returned no response.",
                })
              : null));
        const status = turn.interrupted ? "interrupted" : failure === null ? "completed" : "failed";
        const sessionId = result?.sessionId ?? state.sessionId;
        state.sessionId = sessionId;
        yield* emit({
          type: "provider_turn.updated",
          driver: COMMAND_CODE_DRIVER_KIND,
          threadId: turn.input.threadId,
          providerTurn: { ...turn.providerTurn, status, completedAt },
        });
        yield* updateThread(state, {
          status: "idle",
          ...(sessionId === null ? {} : { nativeThreadRef: providerRef(sessionId) }),
        });
        yield* updateSession({
          status: failure === null ? "ready" : "error",
          lastError: failure?.message ?? null,
        });
        if (failure === null) {
          yield* emit({
            type: "turn.terminal",
            driver: COMMAND_CODE_DRIVER_KIND,
            providerThreadId: state.providerThread.id,
            providerTurnId: turn.providerTurn.id,
            runOrdinal: turn.input.runOrdinal,
            status: status === "interrupted" ? "interrupted" : "completed",
            failure: null,
            threadDisposition: "reusable",
          });
          return;
        }
        const failureOrdinal = itemOrdinal(turn, `terminal-failure:${turn.providerTurn.id}`);
        yield* emit({
          type: "turn_item.updated",
          driver: COMMAND_CODE_DRIVER_KIND,
          turnItem: makeProviderFailureTurnItem({
            driver: COMMAND_CODE_DRIVER_KIND,
            threadId: turn.input.threadId,
            runId: turn.input.runId,
            nodeId: turn.input.rootNodeId,
            providerThreadId: state.providerThread.id,
            providerTurnId: turn.providerTurn.id,
            itemOrdinal: failureOrdinal,
            failure,
            occurredAt: completedAt,
          }),
        });
        yield* emit({
          type: "turn.terminal",
          driver: COMMAND_CODE_DRIVER_KIND,
          providerThreadId: state.providerThread.id,
          providerTurnId: turn.providerTurn.id,
          runOrdinal: turn.input.runOrdinal,
          failureItemOrdinal: failureOrdinal,
          status: "failed",
          failure,
          threadDisposition: "reusable",
        });
      });

      const runTurn = Effect.fnUntraced(function* (state: ThreadState, turn: ActiveTurn) {
        const { child } = turn;
        let stderr = "";
        const stderrFiber = yield* child.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) =>
            Effect.sync(() => {
              stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL_CHARS);
            }),
          ),
          Effect.ignore,
          Effect.forkIn(turn.scope),
        );
        const exitCode = child.exitCode.pipe(
          Effect.map((code): number | undefined => code),
          Effect.orElseSucceed((): number | undefined => undefined),
        );
        const reading = child.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) =>
            Effect.suspend(() => {
              const frame = parseCommandCodeFrame(line);
              return frame === undefined ? Effect.void : handleFrame(turn, frame);
            }),
          ),
        );
        const code = yield* Effect.raceFirst(
          reading.pipe(Effect.andThen(exitCode)),
          exitCode.pipe(Effect.tap(() => Effect.sleep(EXIT_DRAIN))),
        ).pipe(Effect.orElseSucceed((): number | undefined => undefined));
        yield* Fiber.join(stderrFiber).pipe(Effect.timeoutOption(STDERR_SETTLE));
        yield* finishTurn(state, turn, { exitCode: code, stderr });
      });

      const registerThread = (
        threadInput: ProviderAdapter.ProviderAdapterV2EnsureThreadInput,
        sessionId: string | null,
      ) =>
        Effect.gen(function* () {
          if (active !== null) {
            return yield* protocolError("Cannot register a CommandCode thread while a turn runs");
          }
          const existing = threadInput.existingProviderThread;
          const now = yield* DateTime.now;
          const providerThread: OrchestrationV2ProviderThread = {
            id:
              existing?.id ??
              idAllocator.derive.providerThread({
                driver: COMMAND_CODE_DRIVER_KIND,
                providerInstanceId: options.instanceId,
                nativeThreadId: `thread:${threadInput.threadId}`,
              }),
            driver: COMMAND_CODE_DRIVER_KIND,
            providerInstanceId: options.instanceId,
            providerSessionId: input.providerSessionId,
            appThreadId: threadInput.threadId,
            ownerNodeId: existing?.ownerNodeId ?? null,
            nativeThreadRef: sessionId === null ? null : providerRef(sessionId),
            nativeConversationHeadRef: existing?.nativeConversationHeadRef ?? null,
            status: "idle",
            firstRunOrdinal: existing?.firstRunOrdinal ?? null,
            lastRunOrdinal: existing?.lastRunOrdinal ?? null,
            handoffIds: existing?.handoffIds ?? [],
            forkedFrom: existing?.forkedFrom ?? null,
            pendingBackgroundTasks: [],
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          thread = { providerThread, sessionId };
          return providerThread;
        });

      const runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime = {
        instanceId: options.instanceId,
        driver: COMMAND_CODE_DRIVER_KIND,
        providerSessionId: input.providerSessionId,
        get providerSession() {
          return sessionEntity;
        },
        events: Stream.fromQueue(events),
        ensureThread: (threadInput) =>
          registerThread(threadInput, null).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapter.ProviderAdapterEnsureThreadError({
                  driver: COMMAND_CODE_DRIVER_KIND,
                  threadId: threadInput.threadId,
                  cause,
                }),
            ),
          ),
        // Nothing is resident, so resuming only adopts the stored CLI session id.
        // A session the CLI no longer has surfaces on the first turn instead.
        resumeThread: (threadInput) =>
          registerThread(
            {
              threadId:
                threadInput.threadId ?? threadInput.providerThread.appThreadId ?? input.threadId,
              modelSelection: threadInput.modelSelection ?? input.modelSelection,
              runtimePolicy: threadInput.runtimePolicy ?? input.runtimePolicy,
              existingProviderThread: threadInput.providerThread,
            },
            threadInput.providerThread.nativeThreadRef?.nativeId ?? null,
          ).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapter.ProviderAdapterResumeThreadError({
                  driver: COMMAND_CODE_DRIVER_KIND,
                  providerSessionId: input.providerSessionId,
                  providerThreadId: threadInput.providerThread.id,
                  cause,
                }),
            ),
          ),
        startTurn: (turnInput) =>
          Effect.gen(function* () {
            const state = thread;
            if (state === null) return yield* protocolError("CommandCode session has no thread");
            if (active !== null) {
              return yield* protocolError(
                `CommandCode provider thread ${turnInput.providerThread.id} already has an active turn`,
              );
            }
            const prompt = yield* providerMessageTextWithAttachmentPaths({
              text: turnInput.message.text,
              attachments: turnInput.message.attachments,
              resolveAttachmentPath: (attachment) => host.resolveAttachmentPath(attachment),
              resolveExtractedTextPath: host.resolveExtractedTextPath,
            });
            if (prompt.trim().length === 0) {
              return yield* protocolError("CommandCode needs a non-empty prompt");
            }
            const models = yield* options.modelCatalog;
            const args = commandCodeArgs({
              resumeSessionId:
                turnInput.providerThread.nativeThreadRef?.nativeId ?? state.sessionId,
              model: turnInput.modelSelection.model,
              effort: resolveCommandCodeEffort(models, turnInput.modelSelection),
              runtimeMode: turnInput.runtimePolicy.runtimeMode,
              interactionMode: turnInput.runtimePolicy.interactionMode,
            });
            const launch = yield* agentScope.wrap({
              command: options.settings.binaryPath,
              args,
              name: "commandcode",
              threadId: turnInput.threadId,
              env: options.environment,
            });
            const spawnCommand = yield* resolveSpawnCommand(launch.command, launch.args, {
              env: options.environment,
            });
            const scope = yield* Scope.fork(sessionScope, "sequential");
            const child = yield* spawner
              .spawn(
                ChildProcess.make(spawnCommand.command, spawnCommand.args, {
                  cwd: turnInput.runtimePolicy.cwd ?? defaultCwd,
                  env: options.environment,
                  extendEnv: false,
                  shell: spawnCommand.shell,
                  stdin: { stream: Stream.succeed(new TextEncoder().encode(prompt)) },
                  // Its own process group lets a kill reach the tools it started.
                  detached: platform !== "win32",
                }),
              )
              .pipe(
                Scope.provide(scope),
                Effect.tapError(() => Scope.close(scope, Exit.void)),
              );
            const startedAt = yield* DateTime.now;
            const nativeTurnId = `${state.providerThread.id}:attempt:${turnInput.attemptId}`;
            const providerTurn: OrchestrationV2ProviderTurn = {
              id: idAllocator.derive.providerTurn({
                driver: COMMAND_CODE_DRIVER_KIND,
                nativeTurnId,
              }),
              providerThreadId: turnInput.providerThread.id,
              nodeId: turnInput.rootNodeId,
              runAttemptId: turnInput.attemptId,
              nativeTurnRef: providerRef(nativeTurnId, "weak"),
              ordinal: turnInput.providerTurnOrdinal,
              status: "running",
              startedAt,
              completedAt: null,
            };
            const turn: ActiveTurn = {
              input: turnInput,
              providerTurn,
              child,
              scope,
              ordinals: new Map(),
              tools: new Map(),
              nextOrdinal: turnInput.providerTurnOrdinal * 100 + 1,
              streamCount: 0,
              openText: null,
              openReasoning: null,
              sawAssistantText: false,
              result: undefined,
              runError: undefined,
              interrupted: false,
            };
            active = turn;
            state.providerThread = turnInput.providerThread;
            yield* emit({
              type: "provider_turn.updated",
              driver: COMMAND_CODE_DRIVER_KIND,
              threadId: turnInput.threadId,
              providerTurn,
            });
            yield* updateThread(state, {
              status: "active",
              firstRunOrdinal: state.providerThread.firstRunOrdinal ?? turnInput.runOrdinal,
              lastRunOrdinal: turnInput.runOrdinal,
            });
            yield* updateSession({
              status: "running",
              lastError: null,
              model: turnInput.modelSelection.model,
            });
            yield* runTurn(state, turn).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.void
                  : Effect.logError("CommandCode turn failed unexpectedly", {
                      cause: Cause.pretty(cause),
                    }).pipe(
                      Effect.andThen(
                        finishTurn(state, turn, {
                          exitCode: undefined,
                          stderr: "CommandCode adapter failed unexpectedly.",
                        }),
                      ),
                    ),
              ),
              Effect.ensuring(Scope.close(scope, Exit.void)),
              Effect.forkIn(sessionScope),
            );
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapter.ProviderAdapterTurnStartError({
                  driver: COMMAND_CODE_DRIVER_KIND,
                  threadId: turnInput.threadId,
                  providerThreadId: turnInput.providerThread.id,
                  runId: turnInput.runId,
                  cause,
                }),
            ),
          ),
        steerTurn: (steerInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterSteerRunUnsupportedError({
              driver: COMMAND_CODE_DRIVER_KIND,
              providerThreadId: steerInput.providerThread.id,
            }),
          ),
        interruptTurn: (interruptInput) =>
          Effect.suspend(() => {
            const turn = active;
            // Stop on a turn that already settled is the common race, not a failure.
            if (turn === null || turn.providerTurn.id !== interruptInput.providerTurnId) {
              return Effect.void;
            }
            turn.interrupted = true;
            return turn.child.kill({ forceKillAfter: KILL_GRACE }).pipe(
              Effect.catch((error) =>
                turn.child.isRunning.pipe(
                  Effect.orElseSucceed(() => false),
                  Effect.flatMap((running) => (running ? Effect.fail(error) : Effect.void)),
                ),
              ),
            );
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapter.ProviderAdapterInterruptError({
                  driver: COMMAND_CODE_DRIVER_KIND,
                  providerThreadId: interruptInput.providerThread.id,
                  providerTurnId: interruptInput.providerTurnId,
                  cause,
                }),
            ),
          ),
        respondToRuntimeRequest: (requestInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterRuntimeRequestResponseError({
              driver: COMMAND_CODE_DRIVER_KIND,
              requestId: requestInput.requestId,
              cause: "CommandCode print mode raises no approval or question requests.",
            }),
          ),
        readThreadSnapshot: (snapshotInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterReadThreadSnapshotError({
              driver: COMMAND_CODE_DRIVER_KIND,
              providerThreadId: snapshotInput.providerThread.id,
              cause: "CommandCode cannot read a conversation back.",
            }),
          ),
        rollbackThread: (rollbackInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterRollbackThreadError({
              driver: COMMAND_CODE_DRIVER_KIND,
              providerThreadId: rollbackInput.providerThread.id,
              checkpointId: rollbackInput.target.checkpointId,
              cause: "CommandCode cannot roll a conversation back.",
            }),
          ),
        forkThread: (forkInput) =>
          Effect.fail(
            new ProviderAdapter.ProviderAdapterForkThreadError({
              driver: COMMAND_CODE_DRIVER_KIND,
              providerThreadId: forkInput.sourceProviderThread.id,
              cause: "CommandCode threads fork through portable context, not natively.",
            }),
          ),
      };
      return runtime;
    }),
  });
});
