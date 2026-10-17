import * as NodeURL from "node:url";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ApprovalRequestId,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../../config.ts";
import * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import { makeAntigravityAcpAdapter } from "./AntigravityAcpAdapter.ts";

const threadId = ThreadId.make("acp-test");
const instanceId = ProviderInstanceId.make("antigravity");
const cwd = NodeURL.fileURLToPath(new URL("../../..", import.meta.url));
const script = NodeURL.fileURLToPath(
  new URL("../../../scripts/antigravity-acp-mock.mjs", import.meta.url),
);
const layer = ServerConfig.layerTest(cwd, cwd).pipe(Layer.provideMerge(NodeServices.layer));
const harness = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const adapter = yield* makeAntigravityAcpAdapter({
    instanceId,
    makeRuntime: (input) =>
      AcpSessionRuntime.make({
        ...input,
        spawn: { command: "node", args: [script], cwd },
        clientInfo: { name: "test", version: "1" },
        authMethodId: "oauth-personal",
        resumeMethod: "resume",
        cancelBehavior: "wait-for-prompt",
      }).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
  });
  const queue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  yield* adapter.streamEvents.pipe(
    Stream.runForEach((event) => Queue.offer(queue, event)),
    Effect.forkScoped,
  );
  const until = (type: ProviderRuntimeEvent["type"]) =>
    Effect.gen(function* () {
      const events: ProviderRuntimeEvent[] = [];
      while (true) {
        const event = yield* Queue.take(queue);
        events.push(event);
        if (event.type === type) return { event, events };
      }
    });
  const start = adapter.startSession({ threadId, cwd, runtimeMode: "full-access" });
  const send = (input: string) => adapter.sendTurn({ threadId, input });
  return { adapter, start, send, until };
});

describe("Antigravity ACP", () => {
  it.effect("keeps tool failures local and drains text before completing a turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.start;
        yield* h.send("tools");
        const result = yield* h.until("turn.completed");
        expect(result.event.payload).toMatchObject({ state: "completed" });
        expect(
          result.events.some(
            (event) => event.type === "item.completed" && event.payload.status === "failed",
          ),
        ).toBe(true);
        expect(
          result.events
            .filter((event) => event.type === "content.delta")
            .map((event) => event.payload.delta),
        ).toEqual(["gemini-test"]);
        expect(result.events.some((event) => event.type === "runtime.error")).toBe(false);
      }).pipe(Effect.provide(layer)),
    ),
  );
  it.effect("preserves identity across failure and resumes through session/resume", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        const session = yield* h.start;
        yield* h.send("fail");
        expect((yield* h.until("turn.completed")).event.payload).toMatchObject({ state: "failed" });
        expect((yield* h.adapter.listSessions())[0]?.resumeCursor).toEqual(session.resumeCursor);
        yield* h.adapter.stopSession(threadId);
        yield* h.adapter.startSession({
          threadId,
          cwd,
          runtimeMode: "full-access",
          resumeCursor: session.resumeCursor,
        });
        yield* h.send("hello");
        expect((yield* h.until("turn.completed")).event.payload).toMatchObject({
          state: "completed",
        });
      }).pipe(Effect.provide(layer)),
    ),
  );
  it.effect("waits for native cancellation before allowing another turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.start;
        yield* h.send("hang");
        yield* h.until("content.delta");
        yield* h.adapter.interruptTurn(threadId, undefined);
        const result = yield* h.until("turn.completed");
        expect(result.event.payload).toMatchObject({ state: "interrupted" });
        expect(
          result.events.some(
            (event) => event.type === "content.delta" && event.payload.delta === "stopped",
          ),
        ).toBe(true);
        yield* h.send("hello");
        expect((yield* h.until("turn.completed")).event.payload).toMatchObject({
          state: "completed",
        });
      }).pipe(Effect.provide(layer)),
    ),
  );
  it.effect("handles process death as a terminal failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.start;
        yield* h.send("exit");
        expect((yield* h.until("turn.completed")).event.payload).toMatchObject({ state: "failed" });
      }).pipe(Effect.provide(layer)),
    ),
  );
  it.effect("uses native approval option IDs and rejects unavailable choices", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.start;
        yield* h.send("permission");
        const opened = (yield* h.until("request.opened")).event;
        expect(opened.payload).toMatchObject({
          availableDecisions: ["cancel", "accept", "decline"],
        });
        const requestId = ApprovalRequestId.make(opened.requestId!);
        yield* h.adapter
          .respondToRequest(threadId, requestId, "acceptForSession")
          .pipe(Effect.flip);
        yield* h.adapter.respondToRequest(threadId, requestId, "accept");
        const result = yield* h.until("turn.completed");
        expect(
          result.events.some(
            (event) => event.type === "content.delta" && event.payload.delta === "allow",
          ),
        ).toBe(true);
      }).pipe(Effect.provide(layer)),
    ),
  );
  it.effect("keeps native questions interactive in full access and validates answers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.start;
        yield* h.send("question");
        const requestId = ApprovalRequestId.make(
          (yield* h.until("user-input.requested")).event.requestId!,
        );
        yield* h.adapter
          .respondToUserInput(threadId, requestId, { interaction_1: "custom" })
          .pipe(Effect.flip);
        yield* h.adapter.respondToUserInput(threadId, requestId, { interaction_1: "Option B" });
        const result = yield* h.until("turn.completed");
        expect(
          result.events.some(
            (event) => event.type === "content.delta" && event.payload.delta === "b",
          ),
        ).toBe(true);
      }).pipe(Effect.provide(layer)),
    ),
  );
  it.effect("rejects legacy CLI conversation IDs before starting ACP", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        const error = yield* h.adapter
          .startSession({
            threadId,
            cwd,
            runtimeMode: "full-access",
            resumeCursor: "legacy-conversation",
          })
          .pipe(Effect.flip);
        expect(error.message).toContain("Start a new ACP thread");
      }).pipe(Effect.provide(layer)),
    ),
  );
  it.effect("rejects a competing send without cancelling the active turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.start;
        yield* h.send("hang");
        yield* h.until("content.delta");
        expect((yield* h.send("another prompt").pipe(Effect.flip)).message).toContain(
          "running turn",
        );
        yield* h.adapter.interruptTurn(threadId, undefined);
        expect((yield* h.until("turn.completed")).event.payload).toMatchObject({
          state: "interrupted",
        });
      }).pipe(Effect.provide(layer)),
    ),
  );
  it.effect("closes a pending native question exactly once when stopping the session", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.start;
        yield* h.send("question");
        yield* h.until("user-input.requested");
        yield* h.adapter.stopSession(threadId);
        const result = yield* h.until("turn.completed");
        expect(result.events.filter((event) => event.type === "user-input.resolved")).toHaveLength(
          1,
        );
        expect(result.event.payload).toMatchObject({ state: "interrupted" });
        expect(yield* h.adapter.hasSession(threadId)).toBe(false);
      }).pipe(Effect.provide(layer)),
    ),
  );
  it.effect("changes models within an ACP session", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.start;
        yield* h.adapter.sendTurn({
          threadId,
          input: "hello",
          modelSelection: { instanceId, model: "gemini-other" },
        });
        const result = yield* h.until("turn.completed");
        expect(
          result.events.some(
            (event) => event.type === "content.delta" && event.payload.delta === "gemini-other",
          ),
        ).toBe(true);
      }).pipe(Effect.provide(layer)),
    ),
  );
});
