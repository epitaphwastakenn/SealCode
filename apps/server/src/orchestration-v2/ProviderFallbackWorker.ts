import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const FALLBACK_MESSAGE_PREFIX = "provider-fallback:";
// A failover must follow its failure closely; an older limit is the user's to resume.
const FALLBACK_WINDOW = { minutes: 2 } as const;

/**
 * The same continuation the composer sends for "Resume", aimed at the fallback
 * account. A run that was itself a failover is never failed over again, so two
 * accounts that point at each other cannot trade a thread back and forth.
 */
export function providerFallbackCommand(input: {
  readonly threadId: ThreadId;
  readonly run: Pick<
    OrchestrationV2Run,
    "id" | "providerInstanceId" | "modelSelection" | "userMessageId"
  >;
  readonly fallbackInstanceId: ProviderInstanceId | undefined;
}): OrchestrationV2Command | null {
  const { run, fallbackInstanceId } = input;
  if (
    fallbackInstanceId === undefined ||
    fallbackInstanceId === run.providerInstanceId ||
    run.userMessageId.startsWith(FALLBACK_MESSAGE_PREFIX)
  )
    return null;
  const identity = `${FALLBACK_MESSAGE_PREFIX}${input.threadId}:${run.id}`;
  return {
    type: "message.dispatch",
    commandId: CommandId.make(identity),
    messageId: MessageId.make(identity),
    threadId: input.threadId,
    manualContinuationOfRunId: run.id,
    modelSelection: { ...run.modelSelection, instanceId: fallbackInstanceId },
    text: "Continue where you left off.",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "server",
  };
}

const makeSweep = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;

  const fallbackReady = Effect.fn("ProviderFallbackWorker.fallbackReady")(function* (
    instanceId: ProviderInstanceId,
    model: string,
  ) {
    const instance = yield* registry.getInstance(instanceId);
    if (instance === undefined || !instance.enabled) return false;
    const snapshot = yield* instance.snapshot.getSnapshot.pipe(Effect.option);
    return (
      snapshot._tag === "Some" &&
      snapshot.value.auth.status === "authenticated" &&
      snapshot.value.models.some((candidate) => candidate.slug === model)
    );
  });

  return Effect.fn("ProviderFallbackWorker.sweep")(function* () {
    const preferences = yield* settings.getSettings;
    const configured = Object.values(preferences.providerInstances).some(
      (instance) => instance.fallbackInstanceId !== undefined,
    );
    if (!configured) return;
    const since = DateTime.subtract(yield* DateTime.now, FALLBACK_WINDOW);
    for (const { threadId, run } of yield* projections.getUsageLimitedRuns({ since })) {
      const fallbackInstanceId =
        preferences.providerInstances[run.providerInstanceId]?.fallbackInstanceId;
      const command = providerFallbackCommand({ threadId, run, fallbackInstanceId });
      if (command === null || fallbackInstanceId === undefined) continue;
      if (!(yield* fallbackReady(fallbackInstanceId, run.modelSelection.model))) {
        yield* Effect.logDebug("orchestration-v2.provider-fallback.unavailable", {
          threadId,
          fallbackInstanceId,
          model: run.modelSelection.model,
        });
        continue;
      }
      yield* threads.dispatch(command).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.provider-fallback.dispatch-failed", {
            threadId,
            cause,
          }),
        ),
      );
    }
  });
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sweep = yield* makeSweep;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("provider-fallback", sweep());
  }),
);
