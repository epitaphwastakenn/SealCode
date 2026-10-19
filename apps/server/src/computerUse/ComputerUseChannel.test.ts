import { assert, describe, it } from "@effect/vitest";
import type { ComputerUseCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { makeComputerUseBroker } from "./ComputerUseChannel.ts";

const makeHarness = Effect.gen(function* () {
  const sent = yield* Queue.unbounded<ComputerUseCommand>();
  const broker = yield* makeComputerUseBroker((command) =>
    Queue.offer(sent, command).pipe(Effect.asVoid),
  );
  const nextInvoke = Queue.take(sent).pipe(
    Effect.map((command) => {
      assert.strictEqual(command.type, "invoke");
      return command as Extract<ComputerUseCommand, { type: "invoke" }>;
    }),
  );
  return { sent, broker, nextInvoke };
});

describe("ComputerUseChannel broker", () => {
  it.effect("dispatches an action to the desktop and returns its answer", () =>
    Effect.gen(function* () {
      const { broker, nextInvoke } = yield* makeHarness;
      const fiber = yield* broker
        .invoke({ threadId: "thread-a", action: { kind: "screenshot" } })
        .pipe(Effect.forkChild);
      const command = yield* nextInvoke;
      assert.deepEqual(command.action, { kind: "screenshot" });
      assert.strictEqual(command.threadId, "thread-a");
      yield* broker.handleEvent({
        type: "result",
        requestId: command.requestId,
        ok: true,
        result: {
          text: "Captured.",
          screenshot: { data: "AAAA", mimeType: "image/jpeg", width: 1456, height: 819 },
        },
      });
      const result = yield* Fiber.join(fiber);
      assert.strictEqual(result.text, "Captured.");
      assert.strictEqual(result.screenshot?.width, 1456);
    }),
  );

  it.effect("surfaces the desktop's refusal as the action's error", () =>
    Effect.gen(function* () {
      const { broker, nextInvoke } = yield* makeHarness;
      const fiber = yield* broker
        .invoke({ threadId: "thread-a", action: { kind: "type", text: "Oi" } })
        .pipe(Effect.forkChild);
      const command = yield* nextInvoke;
      yield* broker.handleEvent({
        type: "result",
        requestId: command.requestId,
        ok: false,
        message: '"Code" was granted at tier "click"',
      });
      const exit = yield* Fiber.await(fiber);
      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(Exit.isFailure(exit) && exit.cause), 'tier "click"');
    }),
  );

  it.effect("fails a call the desktop never answers", () =>
    Effect.gen(function* () {
      const { broker, nextInvoke } = yield* makeHarness;
      const fiber = yield* broker
        .invoke({ threadId: "thread-a", action: { kind: "screenshot" } })
        .pipe(Effect.forkChild);
      yield* nextInvoke;
      yield* TestClock.adjust("61 seconds");
      const exit = yield* Fiber.await(fiber);
      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(Exit.isFailure(exit) && exit.cause), "did not finish screenshot");
    }),
  );

  it.effect("waits for the access dialog much longer than for an action", () =>
    Effect.gen(function* () {
      const { broker, nextInvoke } = yield* makeHarness;
      const fiber = yield* broker
        .invoke({ threadId: "thread-a", action: { kind: "request_access", apps: ["Paint"] } })
        .pipe(Effect.forkChild);
      const command = yield* nextInvoke;
      yield* TestClock.adjust("5 minutes");
      yield* broker.handleEvent({
        type: "result",
        requestId: command.requestId,
        ok: true,
        result: { text: "Granted: Paint (full)." },
      });
      assert.strictEqual((yield* Fiber.join(fiber)).text, "Granted: Paint (full).");
    }),
  );

  it.effect("a stop fails that thread's pending calls and reports the thread", () =>
    Effect.gen(function* () {
      const { broker, nextInvoke } = yield* makeHarness;
      const stops = yield* broker.stops.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
      const stopped = yield* broker
        .invoke({ threadId: "thread-a", action: { kind: "screenshot" } })
        .pipe(Effect.forkChild);
      const other = yield* broker
        .invoke({ threadId: "thread-b", action: { kind: "screenshot" } })
        .pipe(Effect.forkChild);
      yield* nextInvoke;
      const otherCommand = yield* nextInvoke;
      yield* broker.handleEvent({ type: "stop", threadId: "thread-a" });

      const exit = yield* Fiber.await(stopped);
      assert.include(String(Exit.isFailure(exit) && exit.cause), "stopped computer use");
      assert.deepEqual(yield* Fiber.join(stops), ["thread-a"]);

      yield* broker.handleEvent({
        type: "result",
        requestId: otherCommand.requestId,
        ok: true,
        result: { text: "ok" },
      });
      assert.strictEqual((yield* Fiber.join(other)).text, "ok");
    }),
  );

  it.effect("ends only threads that drove the computer, once", () =>
    Effect.gen(function* () {
      const { broker, sent, nextInvoke } = yield* makeHarness;
      yield* broker.end({ threadId: "thread-idle", restoreHiddenApps: true });
      assert.strictEqual(yield* Queue.size(sent), 0);

      const fiber = yield* broker
        .invoke({ threadId: "thread-a", action: { kind: "screenshot" } })
        .pipe(Effect.forkChild);
      const command = yield* nextInvoke;
      yield* broker.handleEvent({
        type: "result",
        requestId: command.requestId,
        ok: true,
        result: { text: "ok" },
      });
      yield* Fiber.join(fiber);

      yield* broker.end({ threadId: "thread-a", restoreHiddenApps: false });
      yield* broker.end({ threadId: "thread-a", restoreHiddenApps: false });
      assert.deepEqual(yield* Queue.takeAll(sent), [
        { type: "end", threadId: "thread-a", restoreHiddenApps: false },
      ]);
    }),
  );

  it.effect("still ends a stopped thread, so its hidden apps come back", () =>
    Effect.gen(function* () {
      const { broker, sent, nextInvoke } = yield* makeHarness;
      const fiber = yield* broker
        .invoke({ threadId: "thread-a", action: { kind: "screenshot" } })
        .pipe(Effect.forkChild);
      yield* nextInvoke;
      yield* broker.handleEvent({ type: "stop", threadId: "thread-a" });
      yield* Fiber.await(fiber);
      yield* broker.end({ threadId: "thread-a", restoreHiddenApps: true });
      assert.deepEqual(yield* Queue.takeAll(sent), [
        { type: "end", threadId: "thread-a", restoreHiddenApps: true },
      ]);
    }),
  );
});
