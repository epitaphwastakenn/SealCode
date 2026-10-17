import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import * as McpInteractionBroker from "./McpInteractionBroker.ts";

const scope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("antigravity"),
  activeTurnId: "turn-1",
  capabilities: new Set(["preview", "harness", "global-mcp"] as const),
  issuedAt: 1,
};

const registration = {
  threadId: scope.threadId,
  providerSessionId: scope.providerSessionId,
  providerInstanceId: scope.providerInstanceId,
  turnId: "turn-1",
};

const question = {
  id: "implementation",
  header: "Implementation",
  question: "Which implementation should we use?",
  options: [
    { label: "Option A", description: "Use the existing helper." },
    { label: "Option B", description: "Write a new helper." },
  ],
};

const makeBroker = McpInteractionBroker.__testing.make();

it.effect("routes a matching invocation and rejects a second simultaneous call", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const answers = yield* Deferred.make<McpInteractionBroker.McpInteractionToolOutput, string>();
      const _unregister = yield* broker.register(registration, () => Deferred.await(answers));

      const first = yield* broker
        .invoke({ scope, questions: [question] })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const duplicate = yield* broker.invoke({ scope, questions: [question] }).pipe(Effect.flip);
      expect(duplicate).toBe(McpInteractionBroker.MCP_INTERACTION_ALREADY_PENDING);

      expect(first.pollUnsafe()).toBeUndefined();

      yield* Deferred.succeed(answers, { answers: { implementation: "Option A" } });
      expect(yield* Fiber.join(first)).toEqual({ answers: { implementation: "Option A" } });
    }),
  ),
);

it.effect("rejects invocations that do not match the registered turn scope", () =>
  Effect.gen(function* () {
    const broker = yield* makeBroker;
    const _unregister = yield* broker.register(registration, () =>
      Effect.succeed({ answers: { implementation: "Option A" } }),
    );

    const wrongThread = yield* broker
      .invoke({
        scope: { ...scope, threadId: ThreadId.make("thread-other") },
        questions: [question],
      })
      .pipe(Effect.flip);
    expect(wrongThread).toBe(McpInteractionBroker.MCP_INTERACTION_NO_ACTIVE_TURN);

    const wrongSession = yield* broker
      .invoke({
        scope: { ...scope, providerSessionId: "provider-session-other" },
        questions: [question],
      })
      .pipe(Effect.flip);
    expect(wrongSession).toBe(McpInteractionBroker.MCP_INTERACTION_NO_ACTIVE_TURN);

    const wrongInstance = yield* broker
      .invoke({
        scope: { ...scope, providerInstanceId: ProviderInstanceId.make("codex") },
        questions: [question],
      })
      .pipe(Effect.flip);
    expect(wrongInstance).toBe(McpInteractionBroker.MCP_INTERACTION_NO_ACTIVE_TURN);

    const wrongTurn = yield* broker
      .invoke({
        scope: { ...scope, activeTurnId: "turn-other" },
        questions: [question],
      })
      .pipe(Effect.flip);
    expect(wrongTurn).toBe(McpInteractionBroker.MCP_INTERACTION_NO_ACTIVE_TURN);
  }),
);

it.effect("allows a matching call when the credential has not yet recorded the active turn", () =>
  Effect.gen(function* () {
    const broker = yield* makeBroker;
    const _unregister = yield* broker.register(registration, () =>
      Effect.succeed({ answers: { implementation: "custom" } }),
    );

    const result = yield* broker.invoke({
      scope: { ...scope, activeTurnId: undefined },
      questions: [question],
    });
    expect(result).toEqual({ answers: { implementation: "custom" } });
  }),
);

it.effect("cancels an in-flight invocation when the registration is removed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const blocked = yield* Deferred.make<McpInteractionBroker.McpInteractionToolOutput, string>();
      const unregister = yield* broker.register(registration, () => Deferred.await(blocked));
      const fiber = yield* broker.invoke({ scope, questions: [question] }).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      yield* unregister;
      expect(yield* Fiber.join(fiber).pipe(Effect.flip)).toBe(
        McpInteractionBroker.MCP_INTERACTION_CANCELLED,
      );

      const missing = yield* broker.invoke({ scope, questions: [question] }).pipe(Effect.flip);
      expect(missing).toBe(McpInteractionBroker.MCP_INTERACTION_NO_ACTIVE_TURN);
    }),
  ),
);

it.effect("replacing a registration cancels the previous turn exactly once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const firstBlocked = yield* Deferred.make<
        McpInteractionBroker.McpInteractionToolOutput,
        string
      >();
      const _firstUnregister = yield* broker.register(registration, () =>
        Deferred.await(firstBlocked),
      );
      const first = yield* broker.invoke({ scope, questions: [question] }).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const _secondUnregister = yield* broker.register({ ...registration, turnId: "turn-2" }, () =>
        Effect.succeed({ answers: { implementation: "Option B" } }),
      );
      expect(yield* Fiber.join(first).pipe(Effect.flip)).toBe(
        McpInteractionBroker.MCP_INTERACTION_CANCELLED,
      );

      const next = yield* broker.invoke({
        scope: { ...scope, activeTurnId: "turn-2" },
        questions: [question],
      });
      expect(next).toEqual({ answers: { implementation: "Option B" } });
    }),
  ),
);

it.effect("ignores a stale unregister after a replacement registration", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* makeBroker;
      const staleUnregister = yield* broker.register(registration, () =>
        Effect.succeed({ answers: { implementation: "stale" } }),
      );
      const _nextUnregister = yield* broker.register({ ...registration, turnId: "turn-2" }, () =>
        Effect.succeed({ answers: { implementation: "Option B" } }),
      );
      yield* staleUnregister;
      const next = yield* broker.invoke({
        scope: { ...scope, activeTurnId: "turn-2" },
        questions: [question],
      });
      expect(next).toEqual({ answers: { implementation: "Option B" } });
    }),
  ),
);
