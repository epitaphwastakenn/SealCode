import {
  CommandId,
  isProviderNativeSubagentThread,
  latestPromptSuggestionRun,
  ProviderDriverKind,
  type OrchestrationV2DomainEvent,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

// Claude Code suggests inside the session, reusing its prompt cache, so it never needs this.
const NATIVE_SUGGESTION_DRIVER = ProviderDriverKind.make("claudeAgent");
const GENERATION_TIMEOUT = Duration.seconds(90);

/**
 * Suggests the next prompt for providers with no native suggestion, using the text
 * generation model once per finished turn. Off unless the user opts in, because each
 * request is billed on its own with no shared prompt cache. It never blocks a turn:
 * it starts after the run completed and a failure is only logged.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const textGeneration = yield* TextGeneration.TextGeneration;

  const suggest = Effect.fn("PromptSuggestionService.suggest")(function* (
    threadId: ThreadId,
    runId: RunId,
  ) {
    const current = yield* settings.getSettings;
    if (!current.suggestNextPrompt || !current.suggestNextPromptOtherProviders) return;

    const { thread, runs, messages } = yield* projections.getThreadRecords(
      threadId,
      ["runs", "messages"],
      { messageRunIds: [runId], messageRoles: ["user", "assistant"] },
    );
    const run = runs.find((candidate) => candidate.id === runId);
    if (
      run === undefined ||
      run.status !== "completed" ||
      latestPromptSuggestionRun(runs)?.id !== runId ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      thread.promptSuggestion?.runId === runId ||
      isProviderNativeSubagentThread(thread)
    ) {
      return;
    }
    const instance = yield* registry.getInstance(run.providerInstanceId);
    if (instance === undefined || instance.driverKind === NATIVE_SUGGESTION_DRIVER) return;

    // Server-made turns (wakes, compaction) were not written by the user, so there is nothing to predict.
    const userMessage = messages.find(
      (message) =>
        message.id === run.userMessageId && message.role === "user" && message.createdBy === "user",
    );
    const assistantMessage = messages
      .filter(
        (message) => message.role === "assistant" && !message.streaming && message.text.length > 0,
      )
      .toSorted(
        (a, b) => DateTime.toEpochMillis(b.updatedAt) - DateTime.toEpochMillis(a.updatedAt),
      )[0];
    if (userMessage === undefined || assistantMessage === undefined) return;

    const project = yield* projects.get(thread.projectId);
    if (Option.isNone(project)) return;
    const generatePromptSuggestion = textGeneration.generatePromptSuggestion;
    if (generatePromptSuggestion === undefined) return;
    const generated = yield* generatePromptSuggestion({
      cwd: thread.worktreePath ?? project.value.workspaceRoot,
      userMessage: userMessage.text,
      assistantMessage: assistantMessage.text,
      modelSelection: resolveProjectSettings(current, thread.projectId).settings
        .textGenerationModelSelection,
    }).pipe(Effect.timeout(GENERATION_TIMEOUT));
    if (generated.suggestion.length === 0) return;

    yield* orchestrator.dispatch({
      type: "thread.prompt-suggestion.record",
      // One suggestion per completed run, even across duplicate events.
      commandId: CommandId.make(`server:prompt-suggestion:${threadId}:${runId}`),
      threadId,
      runId,
      text: generated.suggestion,
    });
  });

  const handle = (
    event: OrchestrationV2DomainEvent,
    timers: FiberMap.FiberMap<ThreadId>,
    started: Map<ThreadId, RunId>,
  ) => {
    if (event.type !== "run.updated" || event.payload.status !== "completed") return Effect.void;
    // Completed runs are rewritten for unrelated reasons; each one is paid for once.
    if (started.get(event.threadId) === event.payload.id) return Effect.void;
    started.set(event.threadId, event.payload.id);
    return FiberMap.run(
      timers,
      event.threadId,
      suggest(event.threadId, event.payload.id).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("orchestration-v2.prompt-suggestion.skipped", {
                threadId: event.threadId,
                cause,
              }),
        ),
      ),
    ).pipe(Effect.asVoid);
  };

  const start = Effect.fn("PromptSuggestionService.start")(function* () {
    // Keyed by thread: a newer completed run replaces a generation still in flight.
    const timers = yield* FiberMap.make<ThreadId>();
    const started = new Map<ThreadId, RunId>();
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        handle(event, timers, started),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.prompt-suggestion.stream-failed", { cause }),
        ),
      ),
    );
  });

  return { start, suggest };
});
