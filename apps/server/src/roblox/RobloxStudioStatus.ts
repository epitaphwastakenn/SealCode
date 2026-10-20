import type {
  RobloxStudioBridgeStatus,
  RobloxStudioPlace,
  RobloxStudioStatus,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as GlobalMcpManager from "../mcp/GlobalMcpManager.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as StudioBridge from "../studioBridge/StudioBridge.ts";
import {
  blenderExecutableFor,
  blenderMcpLaunchFor,
  MANAGED_SERVER_IDS,
  RobloxStudioConfig,
  ROQER_SERVER_ID,
} from "./RobloxStudioConfig.ts";

const VERSION_TIMEOUT = "10 seconds";
const VERSION_CACHE_MS = 5 * 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** SealCode's own bridge, in the shape Settings shows for either bridge. */
export const studioBridgeStatus = (
  snapshot: StudioBridge.StudioBridgeSnapshot,
): RobloxStudioBridgeStatus => ({
  state: snapshot.lifecycle.state,
  version: snapshot.build,
  ...(snapshot.lifecycle.error === undefined ? {} : { error: snapshot.lifecycle.error }),
  restarts: 0,
  pluginUpdated: snapshot.lifecycle.pluginUpdated,
  ...(snapshot.lifecycle.pluginProblem === undefined
    ? {}
    : { pluginProblem: snapshot.lifecycle.pluginProblem }),
  ...(snapshot.lastRejection === undefined ? {} : { pluginRejected: snapshot.lastRejection }),
  pluginConnected: snapshot.peers.length > 0,
  places: snapshot.peers.map((peer) => ({
    instanceId: peer.instanceId,
    role: peer.role,
    ...(peer.placeId > 0 ? { placeId: peer.placeId } : {}),
    placeName: peer.placeName,
    isRunning: peer.isRunning,
    pluginVersion: peer.build,
  })),
});

/** The host's `get_bridge_status` answer, read into the shape Settings shows. */
export const parseBridgeStatus = (payload: unknown): RobloxStudioBridgeStatus | undefined => {
  if (!isRecord(payload) || !isRecord(payload.bridge)) return undefined;
  const bridge = payload.bridge;
  const http = isRecord(payload.http) ? payload.http : {};
  const places: RobloxStudioPlace[] = (Array.isArray(http.instances) ? http.instances : [])
    .filter(isRecord)
    .flatMap((instance) => {
      const instanceId = text(instance.instanceId);
      if (instanceId === undefined) return [];
      return [
        {
          instanceId,
          ...(text(instance.role) === undefined ? {} : { role: text(instance.role) as string }),
          ...(typeof instance.placeId === "number" ? { placeId: instance.placeId } : {}),
          ...(text(instance.placeName) === undefined
            ? {}
            : { placeName: text(instance.placeName) as string }),
          ...(typeof instance.isRunning === "boolean" ? { isRunning: instance.isRunning } : {}),
          ...(text(instance.pluginVersion) === undefined
            ? {}
            : { pluginVersion: text(instance.pluginVersion) as string }),
        } satisfies RobloxStudioPlace,
      ];
    });
  return {
    state: text(bridge.state) ?? "unknown",
    ...(text(bridge.version) === undefined ? {} : { version: text(bridge.version) as string }),
    ...(text(bridge.error) === undefined ? {} : { error: text(bridge.error) as string }),
    restarts: typeof bridge.restarts === "number" ? bridge.restarts : 0,
    pluginUpdated: bridge.pluginUpdated === true,
    ...(text(bridge.pluginProblem) === undefined
      ? {}
      : { pluginProblem: text(bridge.pluginProblem) as string }),
    ...(text(bridge.pluginRejected) === undefined
      ? {}
      : { pluginRejected: text(bridge.pluginRejected) as string }),
    pluginConnected: http.pluginConnected === true,
    places,
    ...(text(payload.warning) === undefined ? {} : { warning: text(payload.warning) as string }),
  };
};

export class RobloxStudioStatusService extends Context.Service<
  RobloxStudioStatusService,
  { readonly get: Effect.Effect<RobloxStudioStatus> }
>()("t3/roblox/RobloxStudioStatus/RobloxStudioStatusService") {}

const make = Effect.gen(function* () {
  const config = yield* RobloxStudioConfig;
  const manager = yield* GlobalMcpManager.GlobalMcpManager;
  const settings = yield* ServerSettings.ServerSettingsService;
  const runner = yield* ProcessRunner.ProcessRunner;
  const studioBridge = yield* StudioBridge.StudioBridge;
  const versions = new Map<string, { readonly version: string | undefined; readonly at: number }>();

  /** Roqer's `blenderVersion`: an executable counts as Blender only when it answers as one. */
  const blenderVersion = (executable: string) =>
    runner
      .run({
        command: executable,
        args: ["--version"],
        timeout: VERSION_TIMEOUT,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((output) => {
          const match = output.stdout.match(/^Blender (\d+\.\d+[^\r\n]*)/m);
          return match?.[1] ? `Blender ${match[1].trim()}` : undefined;
        }),
        Effect.orElseSucceed(() => undefined),
      );

  const cachedVersion = (executable: string) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const cached = versions.get(executable);
      if (cached !== undefined && now - cached.at < VERSION_CACHE_MS) return cached.version;
      const version = yield* blenderVersion(executable);
      versions.set(executable, { version, at: now });
      return version;
    });

  const get: RobloxStudioStatusService["Service"]["get"] = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(Effect.orDie);
    const roblox = current.robloxStudio;
    const environment = config.environment;
    const statuses = yield* manager.getStatuses;
    const managedIds = new Set(Object.keys(config.managedServers(current)));
    const servers = statuses.filter(
      (status) => MANAGED_SERVER_IDS.has(status.id) && managedIds.has(status.id),
    );

    let bridge: RobloxStudioBridgeStatus | undefined;
    if (roblox.mode === "sealcode") {
      bridge = studioBridgeStatus(yield* studioBridge.snapshot);
    } else if (
      servers.some((status) => status.id === ROQER_SERVER_ID && status.state === "ready")
    ) {
      const result = yield* manager.callServerTool({
        serverId: ROQER_SERVER_ID,
        toolName: "get_bridge_status",
        arguments: {},
      });
      const first = result.content[0];
      if (result.isError !== true && isRecord(first) && typeof first.text === "string") {
        bridge = yield* decodeJson(first.text).pipe(
          Effect.map(parseBridgeStatus),
          Effect.orElseSucceed(() => undefined),
        );
      }
    }

    const executable = blenderExecutableFor(roblox, environment);
    const version =
      roblox.blenderWorker && executable !== undefined
        ? yield* cachedVersion(executable)
        : undefined;
    const blenderProblem = !roblox.blenderWorker
      ? undefined
      : executable === undefined
        ? "Blender was not found. Choose blender.exe in Settings."
        : version === undefined
          ? `${executable} did not answer --version as Blender.`
          : undefined;
    const launch = blenderMcpLaunchFor(roblox, environment);

    return {
      mode: roblox.mode,
      roqer: {
        available: environment.roqer !== undefined && environment.nodeCommand !== undefined,
        ...(environment.roqer?.version === undefined ? {} : { version: environment.roqer.version }),
        ...(environment.roqer?.commit === undefined ? {} : { commit: environment.roqer.commit }),
        ...(environment.roqer?.skills === undefined ? {} : { skills: environment.roqer.skills }),
        ...(environment.roqerProblem === undefined ? {} : { problem: environment.roqerProblem }),
      },
      studioInstalled: environment.studioInstalled,
      officialMcpAvailable: environment.officialMcpPath !== undefined,
      servers,
      ...(bridge === undefined ? {} : { bridge }),
      blender: {
        ...(executable === undefined ? {} : { executable }),
        ...(version === undefined ? {} : { version }),
        ...(blenderProblem === undefined ? {} : { problem: blenderProblem }),
      },
      blenderMcp: {
        command: launch.command,
        args: [...launch.args],
        ...(roblox.blenderMcp &&
        roblox.blenderMcpCommand.length === 0 &&
        environment.detectedBlenderMcp === undefined
          ? {
              problem:
                "No MCP for Blender install was found, so SealCode runs `uvx blender-mcp`; install uv or set the command.",
            }
          : {}),
      },
    } satisfies RobloxStudioStatus;
  });

  return RobloxStudioStatusService.of({ get });
});

export const layer = Layer.effect(RobloxStudioStatusService, make).pipe(
  Layer.provide(ProcessRunner.layer),
);
