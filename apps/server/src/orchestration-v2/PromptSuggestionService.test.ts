import { assert, describe, it } from "@effect/vitest";
import {
  MessageId,
  type ServerSettings as ContractServerSettings,
  type OrchestrationV2Command,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import type { DeepPartial } from "@t3tools/shared/Struct";
import type { PromptSuggestionGenerationInput } from "@t3tools/provider-core/server/textGeneration";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as PromptSuggestionService from "./PromptSuggestionService.ts";

const THREAD_ID = ThreadId.make("thread-suggestion");
const RUN_ID = RunId.make("run-suggestion");
const USER_MESSAGE_ID = MessageId.make("message-suggestion-user");
const NOW = DateTime.makeUnsafe(Date.parse("2026-10-28T12:00:00.000Z"));

const makeHarness = Effect.fn("makePromptSuggestionHarness")(function* (options: {
  readonly settings?: DeepPartial<ContractServerSettings>;
  readonly driverKind: string;
  readonly userCreatedBy?: "user" | "agent";
  readonly generated?: string;
}) {
  const generations = yield* Ref.make<ReadonlyArray<PromptSuggestionGenerationInput>>([]);
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2Command>>([]);
  const instanceId = ProviderInstanceId.make("codex");
  const thread = {
    id: THREAD_ID,
    projectId: ProjectId.make("project-suggestion"),
    worktreePath: null,
    archivedAt: null,
    deletedAt: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
    creationSource: "web",
  };
  const run = {
    id: RUN_ID,
    ordinal: 1,
    status: "completed",
    providerInstanceId: instanceId,
    userMessageId: USER_MESSAGE_ID,
  };
  const message = (overrides: Record<string, unknown>) => ({
    streaming: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
  const messages = [
    message({
      id: USER_MESSAGE_ID,
      role: "user",
      createdBy: options.userCreatedBy ?? "user",
      text: "Add a jump button.",
    }),
    message({
      id: MessageId.make("message-suggestion-assistant"),
      role: "assistant",
      text: "Added.",
    }),
  ];

  const layer = Layer.mergeAll(
    Layer.mock(Orchestrator.OrchestratorV2)({
      streamDomainEvents: Stream.empty,
      dispatch: (command) =>
        Ref.update(commands, (recorded) => [...recorded, command as OrchestrationV2Command]).pipe(
          Effect.as({ sequence: 1, storedEvents: [] }),
        ),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadRecords: () => Effect.succeed({ thread, runs: [run], messages } as never),
    }),
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: () => Effect.succeed(Option.some({ workspaceRoot: "/game" } as never)),
    }),
    Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
      getInstance: () => Effect.succeed({ driverKind: options.driverKind } as never),
    }),
    Layer.mock(TextGeneration.TextGeneration)({
      generatePromptSuggestion: (input) =>
        Ref.update(generations, (recorded) => [...recorded, input]).pipe(
          Effect.as({ suggestion: options.generated ?? "playtest it" }),
        ),
    }),
    ServerSettings.layerTest(options.settings),
  );
  const suggest = Effect.gen(function* () {
    const service = yield* PromptSuggestionService.make;
    yield* service.suggest(THREAD_ID, RUN_ID);
  }).pipe(Effect.provide(layer));
  return { suggest, generations, commands };
});

describe("PromptSuggestionService", () => {
  it.effect("does nothing until the user turns suggestions for other providers on", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ driverKind: "codex" });
      yield* harness.suggest;
      assert.lengthOf(yield* Ref.get(harness.generations), 0);
      assert.lengthOf(yield* Ref.get(harness.commands), 0);
    }),
  );

  it.effect("needs the main setting too", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        driverKind: "codex",
        settings: { suggestNextPrompt: false, suggestNextPromptOtherProviders: true },
      });
      yield* harness.suggest;
      assert.lengthOf(yield* Ref.get(harness.generations), 0);
    }),
  );

  it.effect("asks the text generation model for the finished turn and records the answer", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        driverKind: "codex",
        settings: { suggestNextPromptOtherProviders: true },
        generated: "playtest it",
      });
      yield* harness.suggest;
      const [input] = yield* Ref.get(harness.generations);
      assert.equal(input?.cwd, "/game");
      assert.equal(input?.userMessage, "Add a jump button.");
      assert.equal(input?.assistantMessage, "Added.");
      assert.deepEqual(yield* Ref.get(harness.commands), [
        {
          type: "thread.prompt-suggestion.record",
          commandId: `server:prompt-suggestion:${THREAD_ID}:${RUN_ID}`,
          threadId: THREAD_ID,
          runId: RUN_ID,
          text: "playtest it",
        },
      ]);
    }),
  );

  it.effect("leaves Claude to its own suggestions", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        driverKind: "claudeAgent",
        settings: { suggestNextPromptOtherProviders: true },
      });
      yield* harness.suggest;
      assert.lengthOf(yield* Ref.get(harness.generations), 0);
    }),
  );

  it.effect("skips a turn the user did not write", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        driverKind: "codex",
        userCreatedBy: "agent",
        settings: { suggestNextPromptOtherProviders: true },
      });
      yield* harness.suggest;
      assert.lengthOf(yield* Ref.get(harness.generations), 0);
    }),
  );

  it.effect("records nothing when the model has no suggestion", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        driverKind: "codex",
        settings: { suggestNextPromptOtherProviders: true },
        generated: "",
      });
      yield* harness.suggest;
      assert.lengthOf(yield* Ref.get(harness.generations), 1);
      assert.lengthOf(yield* Ref.get(harness.commands), 0);
    }),
  );
});
