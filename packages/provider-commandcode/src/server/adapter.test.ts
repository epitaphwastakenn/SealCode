import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  NodeId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2TurnItem,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";

import { CommandCodeSettings } from "../settings.ts";
import { makeCommandCodeAdapterV2 } from "./adapter.ts";
import { commandCodeModelCapabilities } from "./models.ts";
import { makeFakeCommandCode, type FakeCommandCodeRun } from "./fakeCommandCode.testkit.ts";

const layerTest = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  TestProviderHost.layer().pipe(Layer.provide(NodeServices.layer)),
);

const decodeSettings = Schema.decodeSync(CommandCodeSettings);
const isAdapterEvent = Schema.is(ProviderAdapter.ProviderAdapterV2Event);
const INSTANCE_ID = ProviderInstanceId.make("commandcode");
const THREAD_ID = ThreadId.make("thread-commandcode-test");
const SESSION_ID = ProviderSessionId.make("provider-session-commandcode-test");
const MODEL = "deepseek/deepseek-v4-flash";

const modelSelection = (model = MODEL, options?: ModelSelection["options"]): ModelSelection => ({
  instanceId: INSTANCE_ID,
  model,
  ...(options === undefined ? {} : { options }),
});

const policy = (
  runtimeMode: RuntimeMode = "full-access",
  interactionMode: ProviderInteractionMode = "default",
) =>
  ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({ runtimeMode, interactionMode, cwd: null });

const text = (delta: string) => ({ type: "event", event: { type: "text_delta", delta } });
const toolEvent = (event: Record<string, unknown>) => ({ type: "event", event });
const result = (fields: Record<string, unknown>) => ({
  type: "result",
  subtype: "success",
  usage: {},
  durationMs: 1,
  ...fields,
});

const openRuntime = Effect.fnUntraced(function* (runs: ReadonlyArray<FakeCommandCodeRun>) {
  const fake = yield* makeFakeCommandCode({ runs });
  const environment = yield* HostProcess.Environment;
  const adapter = yield* makeCommandCodeAdapterV2({
    instanceId: INSTANCE_ID,
    settings: decodeSettings({ enabled: true, binaryPath: fake.binaryPath }),
    environment,
    modelCatalog: Effect.succeed([
      {
        slug: MODEL,
        name: "DeepSeek",
        isCustom: false,
        capabilities: commandCodeModelCapabilities(["high", "max"]),
      },
    ]),
  });
  const runtime = yield* adapter.openSession({
    threadId: THREAD_ID,
    providerSessionId: SESSION_ID,
    modelSelection: modelSelection(),
    runtimePolicy: policy(),
  });
  const emitted = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  yield* runtime.events.pipe(
    Stream.runForEach((event) => Queue.offer(emitted, event)),
    Effect.forkScoped,
  );
  const takeUntil = (predicate: (event: ProviderAdapter.ProviderAdapterV2Event) => boolean) =>
    Effect.gen(function* () {
      const seen: Array<ProviderAdapter.ProviderAdapterV2Event> = [];
      while (true) {
        const event = yield* Queue.take(emitted);
        seen.push(event);
        if (predicate(event)) {
          // The orchestrator persists these as typed events, so a malformed one fails there.
          assert.isTrue(seen.every(isAdapterEvent), "an event does not satisfy the adapter schema");
          return seen;
        }
      }
    });
  const runToTerminal = takeUntil((event) => event.type === "turn.terminal");
  return { runtime, fake, takeUntil, runToTerminal };
});

const makeAppThread = Effect.fnUntraced(function* () {
  const now = yield* DateTime.now;
  return {
    createdBy: "user",
    creationSource: "web",
    id: THREAD_ID,
    projectId: "project:fixture:commandcode" as OrchestrationV2AppThread["projectId"],
    title: "CommandCode test thread",
    providerInstanceId: INSTANCE_ID,
    modelSelection: modelSelection(),
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  } satisfies OrchestrationV2AppThread;
});

const startTurn = Effect.fnUntraced(function* (
  runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime,
  providerThread: OrchestrationV2ProviderThread,
  options: {
    readonly prompt?: string;
    readonly runOrdinal?: number;
    readonly selection?: ModelSelection;
    readonly runtimePolicy?: ProviderAdapter.ProviderAdapterV2RuntimePolicy;
  } = {},
) {
  const runOrdinal = options.runOrdinal ?? 1;
  const runId = RunId.make(`run:${THREAD_ID}:${runOrdinal}`);
  yield* runtime.startTurn({
    appThread: yield* makeAppThread(),
    threadId: THREAD_ID,
    runId,
    runOrdinal,
    providerTurnOrdinal: runOrdinal,
    attemptId: RunAttemptId.make(`run-attempt:${runId}:1`),
    rootNodeId: NodeId.make(`node:${runId}:root`),
    providerThread,
    message: {
      messageId: `message:${THREAD_ID}:${runOrdinal}` as never,
      text: options.prompt ?? "Hello CommandCode",
      attachments: [],
      createdBy: "user",
      creationSource: "web",
    },
    modelSelection: options.selection ?? modelSelection(),
    runtimePolicy: options.runtimePolicy ?? policy(),
  });
});

const ensureThread = (runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime) =>
  runtime.ensureThread({
    threadId: THREAD_ID,
    modelSelection: modelSelection(),
    runtimePolicy: policy(),
  });

const latestItem = (
  events: ReadonlyArray<ProviderAdapter.ProviderAdapterV2Event>,
  type: OrchestrationV2TurnItem["type"],
) =>
  events.findLast(
    (event): event is Extract<typeof event, { readonly type: "turn_item.updated" }> =>
      event.type === "turn_item.updated" && event.turnItem.type === type,
  )?.turnItem;

const terminal = (events: ReadonlyArray<ProviderAdapter.ProviderAdapterV2Event>) =>
  events.findLast(
    (event): event is Extract<typeof event, { readonly type: "turn.terminal" }> =>
      event.type === "turn.terminal",
  );

describe("CommandCodeAdapterV2", () => {
  it("rejects a malformed event, so the schema check on emitted events has teeth", () => {
    assert.isFalse(isAdapterEvent({ type: "turn.terminal", driver: "commandcode" }));
  });

  it.effect("streams the answer, then resumes the CLI session it reported", () =>
    Effect.gen(function* () {
      const { runtime, fake, runToTerminal } = yield* openRuntime([
        {
          frames: [
            text("Hello "),
            text("world"),
            result({ sessionId: "session-1", stopReason: "end_turn", finalText: "Hello world" }),
          ],
        },
        { frames: [text("Again"), result({ sessionId: "session-1", finalText: "Again" })] },
      ]);
      const first = yield* ensureThread(runtime);
      assert.isNull(first.nativeThreadRef);
      yield* startTurn(runtime, first);
      const firstEvents = yield* runToTerminal;

      const message = latestItem(firstEvents, "assistant_message");
      assert.isTrue(message?.type === "assistant_message" && message.text === "Hello world");
      assert.isTrue(message?.type === "assistant_message" && !message.streaming);
      assert.equal(terminal(firstEvents)?.status, "completed");
      const bound = firstEvents.findLast((event) => event.type === "provider_thread.updated");
      assert.equal(
        bound?.type === "provider_thread.updated" && bound.providerThread.nativeThreadRef?.nativeId,
        "session-1",
      );
      assert.equal(runtime.providerSession.status, "ready");

      const resumed = yield* runtime.resumeThread({
        providerThread: bound?.type === "provider_thread.updated" ? bound.providerThread : first,
      });
      yield* startTurn(runtime, resumed, { runOrdinal: 2, prompt: "And again" });
      yield* runToTerminal;

      const [firstRun, secondRun] = yield* fake.invocations;
      assert.notInclude(firstRun?.args ?? [], "--resume");
      assert.deepEqual(
        secondRun?.args.slice(
          secondRun.args.indexOf("--resume"),
          2 + secondRun.args.indexOf("--resume"),
        ),
        ["--resume", "session-1"],
      );
      assert.equal(secondRun?.stdin, "And again");
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("passes a multi-line prompt on stdin untouched by shell quoting", () =>
    Effect.gen(function* () {
      const prompt = 'line one\nline two & more\n%PATH% "quoted" ^ | > <';
      const { runtime, fake, runToTerminal } = yield* openRuntime([
        { frames: [text("ok"), result({ sessionId: "s", finalText: "ok" })] },
      ]);
      yield* startTurn(runtime, yield* ensureThread(runtime), { prompt });
      yield* runToTerminal;
      const [run] = yield* fake.invocations;
      assert.equal(run?.stdin, prompt);
      assert.notInclude(run?.args.join(" ") ?? "", "line one");
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("maps permission mode, plan mode, and a supported effort onto flags", () =>
    Effect.gen(function* () {
      const { runtime, fake, runToTerminal } = yield* openRuntime([
        { frames: [result({ sessionId: "s1", finalText: "one" })] },
        { frames: [result({ sessionId: "s1", finalText: "two" })] },
      ]);
      const thread = yield* ensureThread(runtime);
      yield* startTurn(runtime, thread, {
        runtimePolicy: policy("approval-required", "plan"),
        selection: modelSelection(MODEL, [{ id: "effort", value: "max" }]),
      });
      yield* runToTerminal;
      yield* startTurn(runtime, thread, {
        runOrdinal: 2,
        runtimePolicy: policy("full-access"),
        selection: modelSelection(MODEL, [{ id: "effort", value: "medium" }]),
      });
      yield* runToTerminal;

      const [supervised, full] = yield* fake.invocations;
      assert.include(supervised?.args ?? [], "--plan");
      assert.notInclude(supervised?.args ?? [], "--yolo");
      assert.include(supervised?.args.join(" ") ?? "", `--model ${MODEL} --effort max`);
      assert.include(full?.args ?? [], "--yolo");
      assert.notInclude(full?.args ?? [], "--effort");
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("keeps the turn completed when a tool inside the run fails", () =>
    Effect.gen(function* () {
      const { runtime, runToTerminal } = yield* openRuntime([
        {
          frames: [
            toolEvent({
              type: "tool_queued",
              toolCallId: "call-1",
              toolName: "read_file",
              input: { file_path: "/missing" },
            }),
            toolEvent({ type: "tool_running", toolCallId: "call-1", toolName: "read_file" }),
            toolEvent({
              type: "tool_errored",
              toolCallId: "call-1",
              toolName: "read_file",
              error: "ENOENT",
            }),
            toolEvent({
              type: "tool_queued",
              toolCallId: "call-2",
              toolName: "shell_command",
              input: { command: "git", args: ["status"] },
            }),
            toolEvent({
              type: "tool_completed",
              toolCallId: "call-2",
              toolName: "shell_command",
              result: [{ type: "text", text: "clean" }],
            }),
            text("The file does not exist."),
            result({ sessionId: "s", finalText: "The file does not exist." }),
          ],
        },
      ]);
      yield* startTurn(runtime, yield* ensureThread(runtime));
      const events = yield* runToTerminal;

      const tools = events.flatMap((event) =>
        event.type === "turn_item.updated" &&
        (event.turnItem.type === "dynamic_tool" || event.turnItem.type === "command_execution")
          ? [event.turnItem]
          : [],
      );
      const read = tools.findLast((item) => item.type === "dynamic_tool");
      assert.isTrue(read?.type === "dynamic_tool" && read.status === "failed");
      assert.isTrue(read?.type === "dynamic_tool" && read.output === "ENOENT");
      const command = tools.findLast((item) => item.type === "command_execution");
      assert.isTrue(
        command?.type === "command_execution" &&
          command.status === "completed" &&
          command.input === "git status" &&
          command.output === "clean",
      );
      assert.equal(terminal(events)?.status, "completed");
      assert.equal(runtime.providerSession.status, "ready");
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("fails the turn with a classified failure when the CLI itself fails", () =>
    Effect.gen(function* () {
      const { runtime, runToTerminal } = yield* openRuntime([
        {
          frames: [
            {
              type: "result",
              subtype: "error",
              usage: {},
              durationMs: 1,
              finalText: "",
              error: "Error: Rate limit exceeded. Please wait a moment and try again.",
            },
          ],
          stderr: "Error: Rate limit exceeded. Please wait a moment and try again.\n",
          exitCode: 5,
        },
      ]);
      yield* startTurn(runtime, yield* ensureThread(runtime));
      const events = yield* runToTerminal;

      const end = terminal(events);
      assert.equal(end?.status, "failed");
      assert.equal(end?.status === "failed" && end.failure.class, "usage_limit");
      assert.include(end?.status === "failed" ? end.failure.message : "", "Rate limit");
      assert.equal(runtime.providerSession.status, "error");
      assert.equal(latestItem(events, "error")?.status, "failed");
      const thread = events.findLast((event) => event.type === "provider_thread.updated");
      assert.isTrue(
        thread?.type === "provider_thread.updated" &&
          thread.providerThread.nativeThreadRef === null,
      );
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("fails a run that exits without a result frame", () =>
    Effect.gen(function* () {
      const { runtime, runToTerminal } = yield* openRuntime([
        { stderr: "Error: segfault in tool\n", exitCode: 1 },
      ]);
      yield* startTurn(runtime, yield* ensureThread(runtime));
      const end = terminal(yield* runToTerminal);
      assert.equal(end?.status, "failed");
      assert.equal(end?.status === "failed" && end.failure.message, "segfault in tool");
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("fails a run that produced nothing to show", () =>
    Effect.gen(function* () {
      const { runtime, runToTerminal } = yield* openRuntime([
        { frames: [result({ sessionId: "s", finalText: "" })], exitCode: 9 },
      ]);
      yield* startTurn(runtime, yield* ensureThread(runtime));
      const end = terminal(yield* runToTerminal);
      assert.equal(
        end?.status === "failed" && end.failure.message,
        "CommandCode returned no response.",
      );
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("shows the result's final text when the CLI streamed no deltas", () =>
    Effect.gen(function* () {
      const { runtime, runToTerminal } = yield* openRuntime([
        { frames: [result({ sessionId: "s", finalText: "Only in the result" })] },
      ]);
      yield* startTurn(runtime, yield* ensureThread(runtime));
      const events = yield* runToTerminal;
      const message = latestItem(events, "assistant_message");
      assert.isTrue(message?.type === "assistant_message" && message.text === "Only in the result");
      assert.equal(terminal(events)?.status, "completed");
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("ends a stopped turn as interrupted and leaves nothing running", () =>
    Effect.gen(function* () {
      const { runtime, takeUntil, runToTerminal } = yield* openRuntime([
        {
          frames: [
            toolEvent({
              type: "tool_queued",
              toolCallId: "call-1",
              toolName: "shell_command",
              input: { command: "sleep 100" },
            }),
          ],
          hang: true,
        },
      ]);
      const thread = yield* ensureThread(runtime);
      yield* startTurn(runtime, thread);
      const started = yield* takeUntil(
        (event) =>
          event.type === "turn_item.updated" && event.turnItem.type === "command_execution",
      );
      const turn = started.findLast((event) => event.type === "provider_turn.updated");
      assert.isTrue(turn?.type === "provider_turn.updated");
      if (turn?.type !== "provider_turn.updated") return;

      yield* runtime.interruptTurn({
        providerThread: thread,
        providerTurnId: turn.providerTurn.id,
      });
      const events = yield* runToTerminal;

      assert.equal(terminal(events)?.status, "interrupted");
      const command = latestItem(events, "command_execution");
      assert.equal(command?.status, "interrupted");
      assert.equal(runtime.providerSession.status, "ready");
      assert.isUndefined(
        events.find(
          (event) => event.type === "turn_item.updated" && event.turnItem.type === "error",
        ),
      );

      // Stop on a turn that already ended is a no-op rather than an error.
      yield* runtime.interruptTurn({
        providerThread: thread,
        providerTurnId: turn.providerTurn.id,
      });
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("rejects a second turn while one is running", () =>
    Effect.gen(function* () {
      const { runtime, takeUntil } = yield* openRuntime([
        { frames: [text("working")], hang: true },
      ]);
      const thread = yield* ensureThread(runtime);
      yield* startTurn(runtime, thread);
      yield* takeUntil((event) => event.type === "provider_session.updated");
      const second = yield* startTurn(runtime, thread, { runOrdinal: 2 }).pipe(Effect.result);
      assert.equal(second._tag, "Failure");
      assert.equal(
        second._tag === "Failure" && second.failure._tag,
        "ProviderAdapterTurnStartError",
      );
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("fails to start a turn, without turn events, when the binary is missing", () =>
    Effect.gen(function* () {
      const environment = yield* HostProcess.Environment;
      const adapter = yield* makeCommandCodeAdapterV2({
        instanceId: INSTANCE_ID,
        settings: decodeSettings({
          enabled: true,
          binaryPath: "/definitely-missing/commandcode",
        }),
        environment,
        modelCatalog: Effect.succeed([]),
      });
      const runtime = yield* adapter.openSession({
        threadId: THREAD_ID,
        providerSessionId: SESSION_ID,
        modelSelection: modelSelection(),
        runtimePolicy: policy(),
      });
      const failed = yield* startTurn(runtime, yield* ensureThread(runtime)).pipe(Effect.result);
      assert.equal(failed._tag, "Failure");
      assert.equal(runtime.providerSession.status, "ready");
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );
});
