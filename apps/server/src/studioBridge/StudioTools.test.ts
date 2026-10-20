import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { STUDIO_PROTOCOL_VERSION } from "./protocol.ts";
import * as StudioBridge from "./StudioBridge.ts";
import { handleMcpMessage } from "./studioMcp.ts";
import * as StudioTools from "./StudioTools.ts";

const layer = StudioTools.layer.pipe(
  Layer.provideMerge(StudioBridge.layer),
  Layer.provide(NodeServices.layer),
);

/** A stand-in plugin: answers each endpoint through `answer` until interrupted. */
const fakePlugin = (answer: (endpoint: string, data: any) => unknown) =>
  Effect.gen(function* () {
    const bridge = yield* StudioBridge.StudioBridge;
    const { sessionToken } = yield* bridge.hello({
      protocol: STUDIO_PROTOCOL_VERSION,
      build: "test",
      pluginSessionId: "edit",
      instanceId: "anon:place",
      role: "edit",
      placeId: 0,
      gameId: 0,
      placeName: "Place",
      dataModelName: "Place",
      isRunning: false,
      studioVersion: "",
      pluginHash: "h",
      capabilities: [],
      toggles: { paused: false, readOnly: false, allowLuau: true },
    });
    const calls: Array<{ endpoint: string; data: any }> = [];
    const fiber = yield* Effect.forever(
      Effect.gen(function* () {
        const messages = yield* bridge.poll({ sessionToken, inFlight: [], waitSeconds: 20 });
        for (const message of messages) {
          if (message.kind !== "request") continue;
          calls.push({ endpoint: message.endpoint, data: message.data });
          yield* bridge.respond({
            requestId: message.requestId,
            payload: answer(message.endpoint, message.data),
          });
        }
      }),
    ).pipe(Effect.forkChild);
    return { calls, fiber };
  });

const textOf = (result: { readonly content: ReadonlyArray<any> }) =>
  result.content[0].text as string;

describe("StudioTools", () => {
  it.effect("verifies a script write by reading the whole script back", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const plugin = yield* fakePlugin((endpoint) =>
        endpoint === "edit-script"
          ? {
              success: true,
              path: "game.ServerScriptService.Main",
              revision: "r1:5:aa",
              instanceRef: "ir:x:1",
            }
          : { path: "game.ServerScriptService.Main", revision: "r1:5:aa", lineCount: 1 },
      );
      const result = yield* tools.call(
        "edit_script",
        { path: "game.ServerScriptService.Main", edits: [{ old_string: "a", new_string: "b" }] },
        {},
      );
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain("verified revision r1:5:aa");
      expect(plugin.calls.map((call) => call.endpoint)).toEqual([
        "edit-script",
        "get-script-source",
      ]);
      expect(plugin.calls[1]!.data).toMatchObject({ instanceRef: "ir:x:1", lineRange: "1-" });
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("says a write is unverified when Studio holds another revision", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const plugin = yield* fakePlugin((endpoint) =>
        endpoint === "set-script-source"
          ? { success: true, revision: "r1:5:aa" }
          : { revision: "r1:9:bb" },
      );
      const result = yield* tools.call(
        "set_script_source",
        { path: "game.Workspace.Script", source: "print()", expectedRevision: "r1:0:00" },
        {},
      );
      expect(textOf(result)).toContain("Do not describe this change as verified");
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("writes an empty script without a revision but refuses a non-empty one", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      let body = "  \n";
      const plugin = yield* fakePlugin((endpoint, data) =>
        endpoint === "get-script-source"
          ? { rawSource: body, revision: `rev-${body.length}` }
          : { success: true, revision: "after", expected: data.expectedRevision },
      );
      const ok = yield* tools.call(
        "set_script_source",
        { path: "game.Workspace.S", source: "x" },
        {},
      );
      expect(ok.isError).toBeUndefined();
      expect(
        plugin.calls.find((call) => call.endpoint === "set-script-source")!.data.expectedRevision,
      ).toBe("rev-3");
      body = "print('hi')";
      const refused = yield* tools.call(
        "set_script_source",
        { path: "game.Workspace.S", source: "x" },
        {},
      );
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain("expected_revision_required");
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reports a plugin that predates an endpoint as outdated", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const plugin = yield* fakePlugin((endpoint) => ({ error: `Unknown endpoint: ${endpoint}` }));
      const result = yield* tools.call("get_place_info", {}, {});
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("plugin_outdated");
      yield* Fiber.interrupt(plugin.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("folds a print that several peers echoed into one log entry", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const bridge = yield* StudioBridge.StudioBridge;
      const plugin = yield* fakePlugin(() => ({
        entries: [{ seq: 4, ts: 100, level: "OUT", message: "hello" }],
        nextSince: 4,
        totalDropped: 0,
      }));
      const { sessionToken } = yield* bridge.hello({
        protocol: STUDIO_PROTOCOL_VERSION,
        build: "test",
        pluginSessionId: "server",
        instanceId: "anon:place",
        role: "server",
        placeId: 0,
        gameId: 0,
        placeName: "Place",
        dataModelName: "Place",
        isRunning: true,
        studioVersion: "",
        pluginHash: "h",
        capabilities: [],
        toggles: { paused: false, readOnly: false, allowLuau: true },
      });
      const server = yield* Effect.forever(
        Effect.gen(function* () {
          for (const message of yield* bridge.poll({
            sessionToken,
            inFlight: [],
            waitSeconds: 20,
          })) {
            if (message.kind !== "request") continue;
            yield* bridge.respond({
              requestId: message.requestId,
              payload: {
                entries: [{ seq: 1, ts: 101, level: "OUT", message: "hello" }],
                nextSince: 1,
                totalDropped: 0,
              },
            });
          }
        }),
      ).pipe(Effect.forkChild);
      const result = yield* tools.call("get_output_logs", {}, {});
      const parsed = JSON.parse(textOf(result));
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0]).toMatchObject({ peer: "edit", alsoSeenBy: ["server"] });
      expect(parsed.next).toEqual({ edit: 4, server: 1 });
      yield* Fiber.interrupt(plugin.fiber);
      yield* Fiber.interrupt(server);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("serves the tool list and calls over JSON-RPC with the thread id", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const bridge = yield* StudioBridge.StudioBridge;
      const listed = yield* handleMcpMessage(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        tools,
        bridge.markAgentLinked,
      );
      expect(listed.kind).toBe("json");
      const names = (listed as any).body.result.tools.map((tool: { name: string }) => tool.name);
      expect(names).toContain("get_script_source");
      expect((yield* bridge.snapshot).agentLinked).toBe(true);
      const called = yield* handleMcpMessage(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_place_info", arguments: {}, _meta: { "sealcode/threadId": "t1" } },
        },
        tools,
        Effect.void,
      );
      const result = (called as any).body.result;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("no_studio_connected");
      const notification = yield* handleMcpMessage(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        tools,
        Effect.void,
      );
      expect(notification.kind).toBe("accepted");
    }).pipe(Effect.provide(layer)),
  );
});
