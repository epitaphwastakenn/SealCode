import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { STUDIO_PROTOCOL_VERSION } from "./protocol.ts";
import * as StudioBridge from "./StudioBridge.ts";

const layer = StudioBridge.layer.pipe(Layer.provide(NodeServices.layer));

const hello = (
  overrides: Partial<StudioBridge.StudioHelloInput> = {},
): StudioBridge.StudioHelloInput => ({
  protocol: STUDIO_PROTOCOL_VERSION,
  build: "test",
  pluginSessionId: "session-edit",
  instanceId: "anon:abc",
  role: "edit",
  placeId: 0,
  gameId: 0,
  placeName: "Obby",
  dataModelName: "Obby",
  isRunning: false,
  studioVersion: "0.700",
  capabilities: ["scriptEditor", "made-up"],
  toggles: { paused: false, readOnly: false, allowLuau: true },
  ...overrides,
});

const requestsIn = (messages: ReadonlyArray<StudioBridge.DownstreamMessage>) =>
  messages.flatMap((message) => (message.kind === "request" ? [message] : []));

describe("StudioBridge", () => {
  it.effect("delivers a tool request to the polling plugin and returns its answer", () =>
    Effect.gen(function* () {
      const bridge = yield* StudioBridge.StudioBridge;
      const { sessionToken, assignedRole } = yield* bridge.hello(hello());
      expect(assignedRole).toBe("edit");
      const call = yield* bridge
        .request({ endpoint: "place-info", data: { x: 1 }, meta: { tool: "get_place_info" } })
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const messages = yield* bridge.poll({ sessionToken, inFlight: [], waitSeconds: 0 });
      const [request] = requestsIn(messages);
      expect(request).toMatchObject({
        endpoint: "place-info",
        data: { x: 1 },
        meta: { tool: "get_place_info" },
      });
      expect(
        yield* bridge.respond({ requestId: request!.requestId, payload: { placeName: "Obby" } }),
      ).toBe("accepted");
      const result = yield* Fiber.join(call);
      expect(result.payload).toEqual({ placeName: "Obby" });
      // A retried answer is acknowledged, not treated as unknown.
      expect(yield* bridge.respond({ requestId: request!.requestId, payload: {} })).toBe(
        "already_settled",
      );
      expect(yield* bridge.respond({ requestId: "never-sent", payload: {} })).toBe("unknown");
      const peer = (yield* bridge.peers)[0]!;
      expect(peer.capabilities).toEqual(["scriptEditor"]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("wakes a waiting poll as soon as work arrives", () =>
    Effect.gen(function* () {
      const bridge = yield* StudioBridge.StudioBridge;
      const { sessionToken } = yield* bridge.hello(hello());
      // The hello's own status message is drained first.
      yield* bridge.poll({ sessionToken, inFlight: [], waitSeconds: 0 });
      const waiting = yield* bridge
        .poll({ sessionToken, inFlight: [], waitSeconds: 20 })
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* bridge
        .request({ endpoint: "get-logs", data: {}, meta: { tool: "get_output_logs" } })
        .pipe(Effect.forkChild);
      const messages = yield* Fiber.join(waiting);
      expect(requestsIn(messages).map((message) => message.endpoint)).toEqual(["get-logs"]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses a plugin that speaks another protocol", () =>
    Effect.gen(function* () {
      const bridge = yield* StudioBridge.StudioBridge;
      const error = yield* bridge
        .hello(hello({ protocol: STUDIO_PROTOCOL_VERSION + 1 }))
        .pipe(Effect.flip);
      expect(error.status).toBe(426);
      expect(error.code).toBe("protocol_mismatch");
      expect((yield* bridge.snapshot).lastRejection).toContain("protocol");
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "refuses a second window for the same place while the first is active, then lets it take over",
    () =>
      Effect.gen(function* () {
        const bridge = yield* StudioBridge.StudioBridge;
        yield* bridge.hello(hello());
        const refused = yield* bridge.hello(hello({ pluginSessionId: "other" })).pipe(Effect.flip);
        expect(refused.code).toBe("duplicate_instance_role");
        yield* TestClock.adjust("4 seconds");
        const accepted = yield* bridge.hello(hello({ pluginSessionId: "other" }));
        expect(accepted.assignedRole).toBe("edit");
        expect((yield* bridge.peers).map((peer) => peer.pluginSessionId)).toEqual(["other"]);
      }).pipe(Effect.provide(layer)),
  );

  it.effect("redelivers a request the plugin never received", () =>
    Effect.gen(function* () {
      const bridge = yield* StudioBridge.StudioBridge;
      const { sessionToken } = yield* bridge.hello(hello());
      yield* bridge
        .request({ endpoint: "place-info", data: {}, meta: { tool: "get_place_info" } })
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const first = requestsIn(yield* bridge.poll({ sessionToken, inFlight: [], waitSeconds: 0 }));
      expect(first).toHaveLength(1);
      // The answer to that poll was lost: the next poll does not list the request as held.
      const second = requestsIn(yield* bridge.poll({ sessionToken, inFlight: [], waitSeconds: 0 }));
      expect(second.map((message) => message.requestId)).toEqual([first[0]!.requestId]);
      // Held requests are not sent again.
      const third = requestsIn(
        yield* bridge.poll({ sessionToken, inFlight: [first[0]!.requestId], waitSeconds: 0 }),
      );
      expect(third).toHaveLength(0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("tells a timeout before delivery from one after it", () =>
    Effect.gen(function* () {
      const bridge = yield* StudioBridge.StudioBridge;
      const { sessionToken } = yield* bridge.hello(hello());
      const undelivered = yield* bridge
        .request({ endpoint: "a", data: {}, timeoutMs: 2000, meta: { tool: "a" } })
        .pipe(Effect.flip, Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("3 seconds");
      const before = yield* Fiber.join(undelivered);
      expect(before).toMatchObject({ _tag: "StudioRequestTimeout", delivered: false });

      const delivered = yield* bridge
        .request({ endpoint: "b", data: {}, timeoutMs: 2000, meta: { tool: "b" } })
        .pipe(Effect.flip, Effect.forkChild);
      yield* Effect.yieldNow;
      const [message] = requestsIn(
        yield* bridge.poll({ sessionToken, inFlight: [], waitSeconds: 0 }),
      );
      yield* bridge.poll({ sessionToken, inFlight: [message!.requestId], waitSeconds: 0 });
      yield* TestClock.adjust("3 seconds");
      const after = yield* Fiber.join(delivered);
      expect(after).toMatchObject({ _tag: "StudioRequestTimeout", delivered: true });
      expect(after.message).toContain("read the target back");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails a request whose peer disconnects after taking it", () =>
    Effect.gen(function* () {
      const bridge = yield* StudioBridge.StudioBridge;
      const { sessionToken } = yield* bridge.hello(hello());
      const call = yield* bridge
        .request({ endpoint: "set-properties", data: {}, meta: { tool: "set_properties" } })
        .pipe(Effect.flip, Effect.forkChild);
      yield* Effect.yieldNow;
      yield* bridge.poll({ sessionToken, inFlight: [], waitSeconds: 0 });
      yield* bridge.bye(sessionToken);
      const error = yield* Fiber.join(call);
      expect(error).toMatchObject({ _tag: "StudioPeerDisconnected", delivered: true });
      expect(yield* bridge.peers).toHaveLength(0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps an unpublished place's id working after it is published", () =>
    Effect.gen(function* () {
      const bridge = yield* StudioBridge.StudioBridge;
      yield* bridge.hello(hello());
      const republished = yield* bridge.hello(hello({ instanceId: "place:123", placeId: 123 }));
      expect(republished.instanceId).toBe("place:123");
      const peer = yield* bridge.resolve({ instanceId: "anon:abc" });
      expect(peer.instanceId).toBe("place:123");
      // The play server of the published place joins the same place.
      yield* bridge.hello(
        hello({ pluginSessionId: "server", role: "server", instanceId: "place:123", placeId: 123 }),
      );
      expect((yield* bridge.peersOf("anon:abc")).map((entry) => entry.role).toSorted()).toEqual([
        "edit",
        "server",
      ]);
      expect((yield* bridge.resolve({ instanceId: "place:123", target: "server" })).role).toBe(
        "server",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("asks for instance_id when several places are connected, listing them", () =>
    Effect.gen(function* () {
      const bridge = yield* StudioBridge.StudioBridge;
      yield* bridge.hello(hello());
      yield* bridge.hello(
        hello({ pluginSessionId: "two", instanceId: "place:9", placeId: 9, placeName: "Tycoon" }),
      );
      const error = yield* bridge
        .request({ endpoint: "place-info", data: {}, meta: { tool: "get_place_info" } })
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "StudioRoutingError",
        code: "multiple_instances_connected",
      });
      expect(error._tag === "StudioRoutingError" ? error.instances : []).toHaveLength(2);
      const routed = yield* bridge.resolve({ instanceId: "place:9" });
      expect(routed.placeName).toBe("Tycoon");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("drops a peer that stops polling", () =>
    Effect.gen(function* () {
      const bridge = yield* StudioBridge.StudioBridge;
      yield* bridge.hello(hello());
      yield* TestClock.adjust("50 seconds");
      expect(yield* bridge.peers).toHaveLength(0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("publishes plugin events and drops unknown ones", () =>
    Effect.gen(function* () {
      const bridge = yield* StudioBridge.StudioBridge;
      const { sessionToken } = yield* bridge.hello(hello());
      const accepted = yield* bridge.postEvents({
        sessionToken,
        events: [{ type: "selection_changed", count: 2 }, { type: "run_this", code: "x" }, "junk"],
      });
      expect(accepted).toBe(1);
    }).pipe(Effect.provide(layer)),
  );
});
