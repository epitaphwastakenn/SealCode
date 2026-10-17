import { assert, describe, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { makeAntigravityAdapter } from "./AntigravityAdapter.ts";

describe("AntigravityAdapter", () => {
  it.effect("starts session, sends turn, and receives streamed events", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const adapter = yield* makeAntigravityAdapter({
        instanceId: ProviderInstanceId.make("antigravity"),
      }).pipe(Effect.provideService(Scope.Scope, scope));

      const threadId = ThreadId.make("test-thread-1");
      const session = yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
      });

      assert.equal(session.threadId, threadId);
      assert.equal(session.status, "ready");

      // Subscribe to events
      const eventQueue = yield* Queue.unbounded<any>();
      yield* Effect.forkIn(Stream.runIntoQueue(adapter.streamEvents, eventQueue), scope);

      // Send turn
      const turnResult = yield* adapter.sendTurn({
        threadId,
        input: "Hello Antigravity SDK",
      });

      assert.isDefined(turnResult.turnId);

      // Collect emitted events
      const events: any[] = [];
      while (true) {
        const ev = yield* Queue.take(eventQueue);
        events.push(ev);
        if (ev.type === "turn.completed") break;
      }

      const types = events.map((e) => e.type);
      assert.isTrue(types.includes("content.delta") || types.includes("item.started"));
      assert.isTrue(types.includes("turn.completed"));

      // Clean up
      yield* adapter.stopSession(threadId);
      yield* Scope.close(scope, Effect.void);
    }),
  );

  it.effect("handles turn cancellation", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const adapter = yield* makeAntigravityAdapter({
        instanceId: ProviderInstanceId.make("antigravity"),
      }).pipe(Effect.provideService(Scope.Scope, scope));

      const threadId = ThreadId.make("test-thread-cancel");
      yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
      });

      const turnResult = yield* adapter.sendTurn({
        threadId,
        input: "Long running prompt",
      });

      yield* adapter.interruptTurn(threadId, turnResult.turnId);

      yield* adapter.stopSession(threadId);
      yield* Scope.close(scope, Effect.void);
    }),
  );

  it.effect("handles approval and user input dispatching", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const adapter = yield* makeAntigravityAdapter({
        instanceId: ProviderInstanceId.make("antigravity"),
      }).pipe(Effect.provideService(Scope.Scope, scope));

      const threadId = ThreadId.make("test-thread-approval");
      yield* adapter.startSession({
        threadId,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
      });

      const requestId = ApprovalRequestId.make("req-1");
      yield* adapter.respondToRequest(threadId, requestId, "accept" as ProviderApprovalDecision);

      yield* adapter.respondToUserInput(threadId, requestId, {
        "q-1": ["Option A"],
      });

      yield* adapter.stopSession(threadId);
      yield* Scope.close(scope, Effect.void);
    }),
  );
});
