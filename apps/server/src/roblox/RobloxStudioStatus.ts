import type { RobloxStudioBridgeStatus, RobloxStudioStatus } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GlobalMcpManager from "../mcp/GlobalMcpManager.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as StudioBridge from "../studioBridge/StudioBridge.ts";
import {
  blenderExecutableFor,
  blenderMcpLaunchFor,
  MANAGED_SERVER_IDS,
  RobloxStudioConfig,
} from "./RobloxStudioConfig.ts";

const VERSION_TIMEOUT = "10 seconds";
const VERSION_CACHE_MS = 5 * 60_000;

/** The bridge, in the shape Settings shows. */
export const studioBridgeStatus = (
  snapshot: StudioBridge.StudioBridgeSnapshot,
): RobloxStudioBridgeStatus => ({
  state: snapshot.lifecycle.state,
  version: snapshot.build,
  ...(snapshot.lifecycle.error === undefined ? {} : { error: snapshot.lifecycle.error }),
  restarts: 0,
  pluginUpdated: snapshot.pluginReloadNeeded,
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

  /** An executable counts as Blender only when it answers as one. */
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

    const bridge: RobloxStudioBridgeStatus | undefined =
      roblox.mode === "sealcode" ? studioBridgeStatus(yield* studioBridge.snapshot) : undefined;

    // The bridge's `blender` tool exists whenever Harp mode is on.
    const executable = blenderExecutableFor(roblox, environment);
    const version =
      roblox.mode === "sealcode" && executable !== undefined
        ? yield* cachedVersion(executable)
        : undefined;
    const blenderProblem =
      roblox.mode !== "sealcode"
        ? undefined
        : executable === undefined
          ? "Blender was not found. Choose blender.exe in Settings."
          : version === undefined
            ? `${executable} did not answer --version as Blender.`
            : undefined;
    const launch = blenderMcpLaunchFor(roblox, environment);

    return {
      mode: roblox.mode,
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
                "No MCP for Blender install was found, so Harp runs `uvx blender-mcp`; install uv or set the command.",
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
