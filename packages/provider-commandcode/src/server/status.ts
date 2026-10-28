import type { ServerProviderModel } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath, resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";

import type { ProviderCheckReason } from "@t3tools/provider-core/server/managedProvider";
import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ProviderProbeResult,
} from "@t3tools/provider-core/server/snapshotProbe";

import type { CommandCodeSettings } from "../settings.ts";
import {
  COMMAND_CODE_FALLBACK_MODELS,
  COMMAND_CODE_NO_EFFORT_CAPABILITIES,
  commandCodeModels,
  parseCommandCodeModelCatalog,
  parseCommandCodeModelList,
  parseCommandCodeModelReference,
} from "./models.ts";
import { readCommandCodeUsageLimits } from "./usageLimits.ts";

/** Print mode cannot ask for approval, so Supervised is read-only; see `commandCodeArgs`. */
const COMMAND_CODE_PRESENTATION = {
  displayName: "CommandCode",
  showInteractionModeToggle: false,
  supportsConversationRollback: false,
  requiresNewThreadForModelChange: false,
  supportedRuntimeModes: ["approval-required", "full-access"],
} as const;

const PROBE_TIMEOUT_MS = 15_000;
const MODEL_REFERENCE = ["bundled", "command-code-knowledge", "reference", "models.md"] as const;

const fallbackModels = (settings: CommandCodeSettings): ReadonlyArray<ServerProviderModel> =>
  providerModelsFromSettings(
    COMMAND_CODE_FALLBACK_MODELS.map((model) => ({
      ...model,
      isCustom: false,
      capabilities: COMMAND_CODE_NO_EFFORT_CAPABILITIES,
    })),
    settings.customModels,
    COMMAND_CODE_NO_EFFORT_CAPABILITIES,
  );

export const makePendingCommandCodeProvider = Effect.fn("makePendingCommandCodeProvider")(
  function* (settings: CommandCodeSettings) {
    return buildServerProvider({
      presentation: COMMAND_CODE_PRESENTATION,
      enabled: settings.enabled,
      checkedAt: DateTime.formatIso(yield* DateTime.now),
      models: fallbackModels(settings),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: settings.enabled
          ? "Checking CommandCode CLI availability..."
          : "CommandCode is disabled in SealCode settings.",
      },
    });
  },
);

/**
 * The npm shim sits beside `node_modules` on Windows; elsewhere it is a symlink
 * into the package's `dist` directory.
 */
const readModelReference = Effect.fn("readCommandCodeModelReference")(function* (
  binaryPath: string,
  environment: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolved = yield* resolveCommandPath(binaryPath, { env: environment });
  if (resolved === null) return "";
  const real = yield* fileSystem.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved));
  const candidates = [
    path.join(path.dirname(real), ...MODEL_REFERENCE),
    path.join(path.dirname(resolved), "node_modules", "command-code", "dist", ...MODEL_REFERENCE),
  ];
  for (const candidate of candidates) {
    const contents = yield* fileSystem.readFileString(candidate).pipe(Effect.option);
    if (Option.isSome(contents)) return contents.value;
  }
  return "";
});

/** The installed package names its own version, so a status check need not start Node to ask. */
const readInstalledVersion = Effect.fn("readCommandCodeInstalledVersion")(function* (
  binaryPath: string,
  environment: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolved = yield* resolveCommandPath(binaryPath, { env: environment });
  if (resolved === null) return null;
  const real = yield* fileSystem.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved));
  const packageDirectories = [
    path.dirname(path.dirname(real)),
    path.join(path.dirname(resolved), "node_modules", "command-code"),
  ];
  for (const directory of packageDirectories) {
    const manifest = yield* fileSystem
      .readFileString(path.join(directory, "package.json"))
      .pipe(Effect.map(decodePackageManifest), Effect.option);
    if (Option.isSome(manifest) && Option.isSome(manifest.value)) {
      const { name, version } = manifest.value.value;
      if (name === "command-code") return parseGenericCliVersion(version);
    }
  }
  return null;
});

const decodePackageManifest = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String })),
);

const MODEL_LIST_REUSE_MS = 24 * 60 * 60_000;
const ListedModelsRecord = Schema.Struct({
  version: Schema.String,
  listedAt: Schema.String,
  output: Schema.String,
});
const listedModelsRecordJson = Schema.fromJsonString(ListedModelsRecord);
const decodeListedModelsRecord = Schema.decodeUnknownOption(listedModelsRecordJson);
const encodeListedModelsRecord = Schema.encodeSync(listedModelsRecordJson);

const readModelCatalogCache = Effect.fn("readCommandCodeModelCatalogCache")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home =
    environment.USERPROFILE?.trim() ||
    environment.HOME?.trim() ||
    (yield* HostProcess.HomeDirectory);
  const directory = path.join(home, ".commandcode", "cache", "model-catalog", "v1");
  const names = yield* fileSystem.readDirectory(directory).pipe(Effect.orElseSucceed(() => []));
  return yield* Effect.forEach(
    names.filter((name) => name.startsWith("catalog-") && name.endsWith(".json")),
    (name) =>
      fileSystem.readFileString(path.join(directory, name)).pipe(Effect.orElseSucceed(() => "")),
  );
});

type RunCommandCode<R> = (
  args: ReadonlyArray<string>,
) => Effect.Effect<
  Result.Result<
    Option.Option<{ readonly stdout: string; readonly stderr: string; readonly code: number }>,
    unknown
  >,
  never,
  R
>;

/**
 * `--list-models` starts a second Node process for several seconds. The same CLI version lists
 * the same models, so a saved copy answers every check except an explicit refresh.
 */
const listModelsOutput = Effect.fn("checkCommandCodeProviderStatus.listModels")(function* <
  R,
>(input: {
  readonly run: RunCommandCode<R>;
  readonly version: string | null;
  readonly options: CommandCodeStatusOptions;
}) {
  const { run, version, options } = input;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cachePath = options.modelListCachePath;
  const now = yield* DateTime.now;
  if (cachePath !== undefined && version !== null && options.reason !== "requested") {
    const saved = yield* fileSystem.readFileString(cachePath).pipe(
      Effect.map(decodeListedModelsRecord),
      Effect.orElseSucceed(() => Option.none<typeof ListedModelsRecord.Type>()),
    );
    if (Option.isSome(saved) && saved.value.version === version) {
      const age = DateTime.toEpochMillis(now) - Date.parse(saved.value.listedAt);
      // While the app opens, a list for this version is good enough at any age.
      if (options.reason === "startup" || (age >= 0 && age < MODEL_LIST_REUSE_MS)) {
        return saved.value.output;
      }
    }
  }
  const listResult = yield* run(["--no-auto-update", "--list-models"]);
  if (
    !Result.isSuccess(listResult) ||
    Option.isNone(listResult.success) ||
    listResult.success.value.code !== 0
  ) {
    return undefined;
  }
  const output = `${listResult.success.value.stdout}\n${listResult.success.value.stderr}`;
  if (cachePath !== undefined && version !== null && parseCommandCodeModelList(output).length > 0) {
    yield* writeFileStringAtomically({
      filePath: cachePath,
      contents: `${encodeListedModelsRecord({ version, listedAt: DateTime.formatIso(now), output })}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.ignore({ log: true }),
    );
  }
  return output;
});

export interface CommandCodeStatusOptions {
  readonly reason?: ProviderCheckReason;
  /** Where `--list-models` output is kept between checks; the same CLI version lists the same models. */
  readonly modelListCachePath?: string;
}

export const checkCommandCodeProviderStatus = Effect.fn("checkCommandCodeProviderStatus")(
  function* (
    settings: CommandCodeSettings,
    environment: NodeJS.ProcessEnv,
    cwd?: string,
    options: CommandCodeStatusOptions = {},
  ) {
    if (!settings.enabled) return yield* makePendingCommandCodeProvider(settings);
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const snapshot = (
      probe: ProviderProbeResult,
      models: ReadonlyArray<ServerProviderModel> = fallbackModels(settings),
    ) =>
      buildServerProvider({
        presentation: COMMAND_CODE_PRESENTATION,
        enabled: true,
        checkedAt,
        models,
        probe,
      });
    const run = Effect.fn("checkCommandCodeProviderStatus.run")(
      function* (args: ReadonlyArray<string>) {
        const spawnCommand = yield* resolveSpawnCommand(settings.binaryPath, args, {
          env: environment,
        });
        return yield* spawnAndCollect(
          settings.binaryPath,
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            env: environment,
            shell: spawnCommand.shell,
            ...(cwd ? { cwd } : {}),
          }),
        );
      },
      Effect.timeoutOption(PROBE_TIMEOUT_MS),
      Effect.result,
    );

    // Only an explicit refresh pays for starting the CLI to prove it runs.
    const installedVersion =
      options.reason === "requested"
        ? null
        : yield* readInstalledVersion(settings.binaryPath, environment).pipe(
            Effect.orElseSucceed(() => null),
          );
    let version = installedVersion;
    if (version === null) {
      // `--no-auto-update` keeps a status refresh from replacing the binary mid-run.
      const versionResult = yield* run(["--no-auto-update", "--version"]);
      if (Result.isFailure(versionResult)) {
        const missing = isCommandMissingCause(versionResult.failure);
        return snapshot({
          installed: !missing,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: missing
            ? "CommandCode CLI (`commandcode`) was not found. Install it with `npm install -g command-code` and run `commandcode login` on this T3 server host."
            : "Failed to execute CommandCode CLI. Check its binary path on this T3 server host.",
        });
      }
      if (Option.isNone(versionResult.success)) {
        return snapshot({
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "CommandCode CLI version check timed out.",
        });
      }
      const versionOutput = versionResult.success.value;
      version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
      if (versionOutput.code !== 0) {
        return snapshot({
          installed: true,
          version,
          status: "error",
          auth: { status: "unknown" },
          message: "CommandCode CLI is installed but failed to run.",
        });
      }
    }

    const listOutput = yield* listModelsOutput({ run, version, options });
    const listed = listOutput === undefined ? [] : parseCommandCodeModelList(listOutput);
    const reference = new Map([
      ...parseCommandCodeModelReference(
        yield* readModelReference(settings.binaryPath, environment).pipe(
          Effect.orElseSucceed(() => ""),
        ),
      ),
      ...parseCommandCodeModelCatalog(yield* readModelCatalogCache(environment)),
    ]);
    const usageLimits = yield* readCommandCodeUsageLimits(environment);
    return snapshot(
      // The CLI has no sign-in probe that stays offline and quiet. A signed-out
      // account surfaces on the first turn as a failed run instead.
      {
        installed: true,
        version,
        status: "ready",
        auth: { status: "unknown" },
        ...(usageLimits === undefined ? {} : { usageLimits }),
      },
      providerModelsFromSettings(
        commandCodeModels(listed, reference),
        settings.customModels,
        COMMAND_CODE_NO_EFFORT_CAPABILITIES,
      ),
    );
  },
);
