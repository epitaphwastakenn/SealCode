import * as NodeEvents from "node:events";
import * as NodeStream from "node:stream";

import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";

import { makeHeadlessCliAdapter } from "./HeadlessCliAdapter.ts";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
const threadId = ThreadId.make("commandcode-lifecycle");
const makeHarness = Effect.gen(function* () {
  const adapter = yield* makeHeadlessCliAdapter(
    { binaryPath: "commandcode" },
    {
      provider: ProviderDriverKind.make("commandcode"),
      instanceId: ProviderInstanceId.make("commandcode"),
      protocol: "commandcode",
      environment: {},
    },
  );
  const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
  yield* adapter.streamEvents.pipe(
    Stream.runForEach((event) => Queue.offer(events, event)),
    Effect.forkScoped,
  );
  yield* adapter.startSession({
    threadId,
    runtimeMode: "full-access",
    resumeCursor: "conversation-1",
  });
  const start = Effect.gen(function* () {
    const child = Object.assign(new NodeEvents.EventEmitter(), {
      stdout: new NodeStream.PassThrough(),
      stderr: new NodeStream.PassThrough(),
      stdin: new NodeStream.PassThrough(),
      kill: vi.fn(),
    });
    const spawned = Promise.withResolvers<void>();
    spawn.mockImplementationOnce(() => {
      spawned.resolve();
      return child;
    });
    yield* adapter.sendTurn({ threadId, input: "hello" });
    yield* Effect.promise(() => spawned.promise);
    return {
      child,
      frame: (frame: unknown) => child.stdout.write(`${JSON.stringify(frame)}\n`),
    };
  });
  const finish = Effect.gen(function* () {
    const seen: ProviderRuntimeEvent[] = [];
    while (true) {
      const event = yield* Queue.take(events);
      seen.push(event);
      if (event.type === "turn.completed") return { seen, payload: event.payload };
    }
  });
  return { adapter, start, finish };
});

const init = { type: "init" };
const result = {
  type: "result",
  subtype: "success",
  sessionId: "conversation-1",
  finalText: "done",
};

describe("CommandCode CLI turn lifecycle", () => {
  it.effect("drains stdout after process exit before settling the turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeHarness;
        const p = yield* h.start;
        p.frame(init);
        p.child.emit("exit", 1);
        p.frame(result);
        p.child.emit("close", 1);
        const completed = yield* h.finish;
        expect(completed.payload.state).toBe("completed");
        expect(
          completed.seen.filter((e) => e.type === "content.delta").map((e) => e.payload.delta),
        ).toEqual(["done"]);
      }),
    ),
  );

  it.effect("does not mistake init for success when the CLI crashes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeHarness;
        const p = yield* h.start;
        p.frame(init);
        p.child.stderr.write("CLI crashed");
        p.child.emit("exit", 1);
        p.child.emit("close", 1);
        const completed = yield* h.finish;
        expect(completed.payload).toMatchObject({ state: "failed", errorMessage: "CLI crashed" });
        expect((yield* h.adapter.listSessions())[0]?.resumeCursor).toBe("conversation-1");
      }),
    ),
  );

  it.effect("ignores frames from a settled process during the next turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeHarness;
        const first = yield* h.start;
        first.frame(init);
        first.frame(result);
        yield* h.finish;
        const next = yield* h.start;
        first.frame({
          type: "event",
          event: { type: "text_delta", delta: "late" },
        });
        first.frame({ type: "result", subtype: "error", finalText: "late" });
        next.frame(result);
        const completed = yield* h.finish;
        expect(
          completed.seen.filter((e) => e.type === "content.delta").map((e) => e.payload.delta),
        ).toEqual(["done"]);
        expect(completed.payload.state).toBe("completed");
      }),
    ),
  );

  it.effect("keeps cancellation and conversation identity when another send is rejected", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeHarness;
        const p = yield* h.start;
        p.frame(init);
        yield* h.adapter.interruptTurn(threadId);
        yield* h.adapter.sendTurn({ threadId, input: "too early" }).pipe(Effect.flip);
        p.child.emit("close", 1);
        expect((yield* h.finish).payload.state).toBe("interrupted");
        expect((yield* h.adapter.listSessions())[0]?.resumeCursor).toBe("conversation-1");
      }),
    ),
  );

  it.effect("clears a previous failure when the next turn succeeds", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeHarness;
        const first = yield* h.start;
        first.frame(init);
        first.frame({
          type: "result",
          subtype: "error",
          finalText: "",
          error: "quota exceeded",
        });
        yield* h.finish;
        const next = yield* h.start;
        next.frame(result);
        yield* h.finish;
        expect((yield* h.adapter.listSessions())[0]).toMatchObject({
          status: "ready",
          resumeCursor: "conversation-1",
        });
        expect((yield* h.adapter.listSessions())[0]?.lastError).toBeUndefined();
      }),
    ),
  );

  it.effect("flushes a final result without a trailing newline exactly once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* makeHarness;
        const p = yield* h.start;
        p.frame(init);
        p.child.stdout.write(JSON.stringify(result));
        p.child.emit("close", 0);
        const completed = yield* h.finish;
        expect(completed.payload.state).toBe("completed");
        expect(completed.seen.filter((e) => e.type === "content.delta")).toHaveLength(1);
      }),
    ),
  );
});
