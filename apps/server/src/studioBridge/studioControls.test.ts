import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { RobloxStudioConfig } from "../roblox/RobloxStudioConfig.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { STUDIO_PROTOCOL_VERSION } from "./protocol.ts";
import * as StudioBridge from "./StudioBridge.ts";
import {
  parseStudioControlsMeta,
  playtestGate,
  policyFromControls,
  studioControlsMetaKey,
  type StudioControlsPolicy,
} from "./studioControls.ts";
import { handleMcpMessage } from "./studioMcp.ts";
import * as StudioTools from "./StudioTools.ts";

const layer = StudioTools.layer.pipe(
  Layer.provideMerge(StudioBridge.layer),
  Layer.provide(ServerSettingsService.layerTest()),
  Layer.provide(Layer.succeed(RobloxStudioConfig, RobloxStudioConfig.defaultValue())),
  Layer.provide(NodeServices.layer),
);

const fakePlace = (input: { readonly instanceId: string; readonly placeName: string }) =>
  Effect.gen(function* () {
    const bridge = yield* StudioBridge.StudioBridge;
    const { sessionToken } = yield* bridge.hello({
      protocol: STUDIO_PROTOCOL_VERSION,
      build: "test",
      pluginSessionId: `session-${input.instanceId}`,
      instanceId: input.instanceId,
      role: "edit",
      placeId: 0,
      gameId: 0,
      placeName: input.placeName,
      dataModelName: input.placeName,
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
            payload: { success: true, from: input.placeName },
          });
        }
      }),
    ).pipe(Effect.forkChild);
    return { calls, fiber };
  });

const textOf = (result: { readonly content: ReadonlyArray<any> }) =>
  result.content[0].text as string;

const policy = (overrides: Partial<StudioControlsPolicy> = {}): StudioControlsPolicy => ({
  allowPlaytests: true,
  excludedPlaces: [],
  ...overrides,
});

describe("Studio controls policy", () => {
  it("reads the gateway's meta and treats a missing one as no policy", () => {
    expect(parseStudioControlsMeta(undefined)).toBeUndefined();
    expect(parseStudioControlsMeta("nope")).toBeUndefined();
    expect(
      parseStudioControlsMeta({
        allowPlaytests: false,
        excludedPlaces: [{ placeKey: "place:1", placeName: "Lobby" }, { placeName: "no key" }, 4],
      }),
    ).toEqual({
      allowPlaytests: false,
      excludedPlaces: [{ placeKey: "place:1", placeName: "Lobby" }],
    });
    expect(policyFromControls({ allowPlaytests: false })).toEqual({
      allowPlaytests: false,
      excludedPlaces: [],
    });
    expect(policyFromControls(undefined).allowPlaytests).toBe(true);
  });

  it("blocks only the calls that start a playtest", () => {
    const off = policy({ allowPlaytests: false });
    const blocked = (tool: string, args: Record<string, unknown>) =>
      playtestGate(tool, args, off)?.isError === true;
    expect(blocked("playtest", { action: "start" })).toBe(true);
    expect(blocked("multiplayer_playtest", { action: "start" })).toBe(true);
    expect(blocked("multiplayer_playtest", { action: "add_players" })).toBe(true);
    for (const action of ["status", "stop"]) expect(blocked("playtest", { action })).toBe(false);
    for (const action of ["status", "end", "leave_client"]) {
      expect(blocked("multiplayer_playtest", { action })).toBe(false);
    }
    expect(blocked("execute_luau", { code: "game:GetService('StudioTestService')" })).toBe(true);
    expect(blocked("execute_luau", { code: "RunService:Run()" })).toBe(true);
    expect(blocked("execute_luau", { code: "return workspace.Gravity" })).toBe(false);
    expect(blocked("execute_luau", { code: "return RunService:IsRunning()" })).toBe(false);
    expect(blocked("eval_server_runtime", { code: "StudioTestService" })).toBe(false);
    expect(playtestGate("playtest", { action: "start" }, policy())).toBeUndefined();
    expect(playtestGate("playtest", { action: "start" }, undefined)).toBeUndefined();
  });
});

describe("Studio controls enforcement", () => {
  it.effect("refuses playtest starters before any request reaches the plugin", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const place = yield* fakePlace({ instanceId: "anon:a", placeName: "Lobby" });
      const controls = policy({ allowPlaytests: false });
      for (const [name, args] of [
        ["playtest", { action: "start" }],
        ["multiplayer_playtest", { action: "start" }],
        ["multiplayer_playtest", { action: "add_players", numPlayers: 1 }],
        ["execute_luau", { code: "game:GetService('StudioTestService'):ExecutePlayModeAsync()" }],
      ] as const) {
        const result = yield* tools.call(name, args, { controls });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("playtests_disabled");
      }
      expect(place.calls).toEqual([]);
      yield* Fiber.interrupt(place.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps stop, status, end and leave_client working with playtests off", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const place = yield* fakePlace({ instanceId: "anon:a", placeName: "Lobby" });
      const controls = policy({ allowPlaytests: false });
      for (const [name, args] of [
        ["playtest", { action: "status" }],
        ["playtest", { action: "stop" }],
        ["multiplayer_playtest", { action: "status" }],
        ["multiplayer_playtest", { action: "end" }],
        ["multiplayer_playtest", { action: "leave_client", target: "client-1" }],
      ] as const) {
        const result = yield* tools.call(name, args, { controls });
        expect(textOf(result)).not.toContain("playtests_disabled");
      }
      const luau = yield* tools.call("execute_luau", { code: "return 1" }, { controls });
      expect(textOf(luau)).not.toContain("playtests_disabled");
      expect(place.calls.map((call) => call.endpoint)).toContain("execute-luau");
      yield* Fiber.interrupt(place.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("lets playtests through when the thread allows them", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const place = yield* fakePlace({ instanceId: "anon:a", placeName: "Lobby" });
      yield* tools.call("execute_luau", { code: "StudioTestService" }, { controls: policy() });
      yield* tools.call("execute_luau", { code: "StudioTestService" }, {});
      expect(place.calls).toHaveLength(2);
      yield* Fiber.interrupt(place.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses a place the thread turned off, naming it, even when asked by id", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const lobby = yield* fakePlace({ instanceId: "anon:a", placeName: "Lobby" });
      const arena = yield* fakePlace({ instanceId: "anon:b", placeName: "Arena" });
      const controls = policy({ excludedPlaces: [{ placeKey: "anon:a", placeName: "Lobby" }] });
      const result = yield* tools.call(
        "execute_luau",
        { code: "return 1", instance_id: "anon:a" },
        { controls },
      );
      expect(result.isError).toBe(true);
      const body = JSON.parse(textOf(result));
      expect(body.error).toBe("place_excluded");
      expect(body.message).toContain('"Lobby"');
      expect(body.instances.map((entry: any) => entry.instance_id)).toEqual(["anon:b"]);
      expect(lobby.calls).toEqual([]);
      expect(arena.calls).toEqual([]);
      yield* Fiber.interrupt(lobby.fiber);
      yield* Fiber.interrupt(arena.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("routes calls without an instance_id to the one place left", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const lobby = yield* fakePlace({ instanceId: "anon:a", placeName: "Lobby" });
      const arena = yield* fakePlace({ instanceId: "anon:b", placeName: "Arena" });
      const controls = policy({ excludedPlaces: [{ placeKey: "anon:a", placeName: "Lobby" }] });
      const result = yield* tools.call("execute_luau", { code: "return 1" }, { controls });
      expect(result.isError).toBeUndefined();
      expect(arena.calls).toHaveLength(1);
      expect(lobby.calls).toEqual([]);
      const unrestricted = yield* tools.call("execute_luau", { code: "return 1" }, {});
      expect(textOf(unrestricted)).toContain("multiple_instances_connected");
      yield* Fiber.interrupt(lobby.fiber);
      yield* Fiber.interrupt(arena.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("says every place is off when none is left", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const lobby = yield* fakePlace({ instanceId: "anon:a", placeName: "Lobby" });
      const controls = policy({ excludedPlaces: [{ placeKey: "anon:a", placeName: "Lobby" }] });
      const result = yield* tools.call("execute_luau", { code: "return 1" }, { controls });
      const body = JSON.parse(textOf(result));
      expect(body.error).toBe("place_excluded");
      expect(body.message).toContain("Lobby");
      expect(lobby.calls).toEqual([]);
      yield* Fiber.interrupt(lobby.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("lists only allowed places and says how many are off", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const lobby = yield* fakePlace({ instanceId: "anon:a", placeName: "Lobby" });
      const arena = yield* fakePlace({ instanceId: "anon:b", placeName: "Arena" });
      const controls = policy({ excludedPlaces: [{ placeKey: "anon:a", placeName: "Lobby" }] });
      const connected = JSON.parse(
        textOf(yield* tools.call("get_connected_instances", {}, { controls })),
      );
      expect(connected.instances.map((entry: any) => entry.place_name)).toEqual(["Arena"]);
      expect(connected.turned_off_for_this_thread).toBe(1);
      const status = JSON.parse(textOf(yield* tools.call("get_bridge_status", {}, { controls })));
      expect(status.peers.map((entry: any) => entry.place_name)).toEqual(["Arena"]);
      const all = JSON.parse(textOf(yield* tools.call("get_connected_instances", {}, {})));
      expect(all.instances).toHaveLength(2);
      expect(all.turned_off_for_this_thread).toBeUndefined();
      yield* Fiber.interrupt(lobby.fiber);
      yield* Fiber.interrupt(arena.fiber);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads the policy from the gateway's _meta, and no _meta means no policy", () =>
    Effect.gen(function* () {
      const tools = yield* StudioTools.StudioTools;
      const place = yield* fakePlace({ instanceId: "anon:a", placeName: "Lobby" });
      const call = (params: Record<string, unknown>) =>
        handleMcpMessage(
          { jsonrpc: "2.0", id: 1, method: "tools/call", params },
          tools,
          Effect.void,
        ).pipe(Effect.map((reply) => (reply as any).body.result));
      const blocked = yield* call({
        name: "playtest",
        arguments: { action: "start" },
        _meta: { [studioControlsMetaKey]: { allowPlaytests: false, excludedPlaces: [] } },
      });
      expect(textOf(blocked)).toContain("playtests_disabled");
      expect(place.calls).toEqual([]);
      const noPolicy = yield* call({ name: "playtest", arguments: { action: "status" } });
      expect(textOf(noPolicy)).not.toContain("playtests_disabled");
      yield* Fiber.interrupt(place.fiber);
    }).pipe(Effect.provide(layer)),
  );
});
