import * as Effect from "effect/Effect";
import { Command, GlobalFlag } from "effect/unstable/cli";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import { ServerConfig, type StartupPresentation } from "../config.ts";
import { runServer } from "../server.ts";
import { type CliServerFlags, resolveServerConfig, sharedServerCommandFlags } from "./config.ts";

export const desktopOwnerDisconnected = Effect.callback<void>((resume) => {
  const onEnd = () => resume(Effect.void);
  process.stdin.once("end", onEnd);
  process.stdin.resume();
  return Effect.sync(() => process.stdin.off("end", onEnd));
});

export const runServerCommand = (
  flags: CliServerFlags,
  options?: {
    readonly startupPresentation?: StartupPresentation;
    readonly forceAutoBootstrapProjectFromCwd?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveServerConfig(flags, logLevel, options);
    const platform = yield* HostProcessPlatform;
    const server = runServer.pipe(Effect.provideService(ServerConfig, config));
    if (platform !== "win32" || !config.desktopBootstrapToken) return yield* server;
    return yield* Effect.raceFirst(server, desktopOwnerDisconnected);
  });

export const startCommand = Command.make("start", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run the SealCode server."),
  Command.withHandler((flags) => runServerCommand(flags)),
);

export const serveCommand = Command.make("serve", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription(
    "Run the SealCode server without opening a browser and print headless pairing details.",
  ),
  Command.withHandler((flags) =>
    runServerCommand(flags, {
      startupPresentation: "headless",
      forceAutoBootstrapProjectFromCwd: false,
    }),
  ),
);
