import { ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import { Command, Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import { resolveAntigravityInstanceDirectories } from "../provider/antigravityAuthSupport.ts";
import { makeAntigravityConnectProxy } from "../provider/AntigravityConnectProxy.ts";
import { runAntigravityDiagnostics } from "../provider/AntigravityDiagnostics.ts";
import { makeAntigravityInstallation } from "../provider/AntigravityInstallation.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

const diagnoseCommand = Command.make("diagnose", {
  ...projectLocationFlags,
  output: Flag.String("output").pipe(
    Flag.withDescription("Also save the report to this file."),
    Flag.optional,
  ),
  skipAgent: Flag.Boolean("skip-agent").pipe(
    Flag.withDescription("Only check the network; do not start Antigravity."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Check the network path to Google, start Antigravity once, and print a report to send for help. It never contains credentials.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
      const environment = yield* HostProcess.Environment;
      const installation = yield* makeAntigravityInstallation({ baseDir: config.baseDir });
      const executable = yield* installation
        .acquire(undefined, environment)
        .pipe(Effect.catch((cause) => Effect.succeed({ error: cause.detail })));
      const proxy = yield* makeAntigravityConnectProxy();
      const directories = yield* resolveAntigravityInstanceDirectories(
        config.stateDir,
        ProviderInstanceId.make("antigravity"),
      );
      const report = yield* runAntigravityDiagnostics({
        platform: yield* HostProcess.Platform,
        stateDir: config.stateDir,
        profileDirectory: directories.profile,
        processEnvironment: environment,
        agentEnvironment: yield* proxy.environment(environment),
        installation: executable,
        runAgentTest: !flags.skipAgent,
      });
      yield* Console.log(report);
      if (Option.isSome(flags.output)) {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(flags.output.value, report);
        yield* Console.log(`Saved to ${flags.output.value}`);
      }
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  ),
);

export const antigravityCommand = Command.make("antigravity").pipe(
  Command.withDescription("Troubleshoot the Antigravity provider."),
  Command.withSubcommands([diagnoseCommand]),
);
