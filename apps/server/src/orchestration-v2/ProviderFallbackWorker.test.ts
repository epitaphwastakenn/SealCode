import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { describe, expect, vi } from "vite-plus/test";

import {
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  MessageId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderFallbackWorker from "./ProviderFallbackWorker.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const primary = ProviderInstanceId.make("codex");
const backup = ProviderInstanceId.make("codex_backup");
const threadId = ThreadId.make("thread-fallback");

const limitedRun = (userMessageId = "message-1") =>
  ({
    id: RunId.make("run-1"),
    providerInstanceId: primary,
    modelSelection: {
      instanceId: primary,
      model: "gpt-5.4",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
    userMessageId: MessageId.make(userMessageId),
  }) as unknown as OrchestrationV2Run;

describe("providerFallbackCommand", () => {
  it("continues the failed run on the fallback account with the same model and options", () => {
    expect(
      ProviderFallbackWorker.providerFallbackCommand({
        threadId,
        run: limitedRun(),
        fallbackInstanceId: backup,
      }),
    ).toMatchObject({
      type: "message.dispatch",
      commandId: "provider-fallback:thread-fallback:run-1",
      messageId: "provider-fallback:thread-fallback:run-1",
      threadId,
      manualContinuationOfRunId: "run-1",
      modelSelection: {
        instanceId: backup,
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "high" }],
      },
      dispatchMode: { type: "start_immediately" },
    });
  });

  it("never fails over to itself, without a fallback, or twice in a row", () => {
    for (const input of [
      { run: limitedRun(), fallbackInstanceId: undefined },
      { run: limitedRun(), fallbackInstanceId: primary },
      { run: limitedRun("provider-fallback:thread-fallback:run-0"), fallbackInstanceId: backup },
    ]) {
      expect(ProviderFallbackWorker.providerFallbackCommand({ threadId, ...input })).toBeNull();
    }
  });
});

const sweepWith = (input: {
  readonly fallbackInstanceId?: ProviderInstanceId;
  readonly auth?: "authenticated" | "unauthenticated";
  readonly models?: ReadonlyArray<string>;
  readonly run?: OrchestrationV2Run;
}) =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2Command> = [];
    const getUsageLimitedRuns = vi.fn(() =>
      Effect.succeed([{ threadId, run: input.run ?? limitedRun() }]),
    );
    const registered = yield* Ref.make<Effect.Effect<void> | undefined>(undefined);
    const layer = ProviderFallbackWorker.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(Scheduler.Scheduler)({
            register: (_name, work) => Ref.set(registered, work as never),
          }),
          Layer.mock(ProjectionStore.ProjectionStoreV2)({ getUsageLimitedRuns }),
          Layer.mock(ThreadManagement.ThreadManagementService)({
            dispatch: ((command: OrchestrationV2Command) =>
              Effect.sync(() => void dispatched.push(command))) as never,
          }),
          Layer.mock(ServerSettings.ServerSettingsService)({
            getSettings: Effect.succeed({
              providerInstances: {
                [primary]: {
                  driver: "codex",
                  ...(input.fallbackInstanceId === undefined
                    ? {}
                    : { fallbackInstanceId: input.fallbackInstanceId }),
                },
              },
            } as never),
          }),
          Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
            getInstance: (id) =>
              Effect.succeed(
                id === backup
                  ? ({
                      enabled: true,
                      snapshot: {
                        getSnapshot: Effect.succeed({
                          auth: { status: input.auth ?? "authenticated" },
                          models: (input.models ?? ["gpt-5.4"]).map((slug) => ({ slug })),
                        }),
                      },
                    } as never)
                  : undefined,
              ),
          }),
        ),
      ),
    );
    yield* Effect.scoped(Layer.build(layer));
    yield* (yield* Ref.get(registered))!;
    return { dispatched, getUsageLimitedRuns };
  });

describe("ProviderFallbackWorker", () => {
  it.effect("dispatches the continuation when the fallback account is ready", () =>
    Effect.gen(function* () {
      const { dispatched } = yield* sweepWith({ fallbackInstanceId: backup });
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toMatchObject({
        type: "message.dispatch",
        modelSelection: { instanceId: backup },
      });
    }),
  );

  it.effect("leaves the thread alone when the fallback is signed out or lacks the model", () =>
    Effect.gen(function* () {
      for (const variant of [{ auth: "unauthenticated" as const }, { models: ["other-model"] }]) {
        const { dispatched } = yield* sweepWith({ fallbackInstanceId: backup, ...variant });
        expect(dispatched).toEqual([]);
      }
    }),
  );

  it.effect("does not read the projection when no instance has a fallback", () =>
    Effect.gen(function* () {
      const { dispatched, getUsageLimitedRuns } = yield* sweepWith({});
      expect(getUsageLimitedRuns).not.toHaveBeenCalled();
      expect(dispatched).toEqual([]);
    }),
  );
});
