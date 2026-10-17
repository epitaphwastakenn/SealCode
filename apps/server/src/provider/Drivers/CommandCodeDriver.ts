import { CommandCodeSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeHeadlessCliTextGeneration } from "../../textGeneration/HeadlessCliTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeHeadlessCliAdapter } from "../Layers/HeadlessCliAdapter.ts";
import {
  buildInitialHeadlessCliProvider,
  checkHeadlessCliProviderStatus,
  makeHeadlessCliModelCapabilityRegistry,
  type HeadlessCliProviderDefinition,
} from "../Layers/HeadlessCliProvider.ts";
import { probeCommandCodeSubscriptionUsage } from "../commandCodeUsage.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  makeStaticProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";

const DRIVER_KIND = ProviderDriverKind.make("commandcode");
const decodeSettings = Schema.decodeSync(CommandCodeSettings);
const DEFINITION: HeadlessCliProviderDefinition = {
  driver: DRIVER_KIND,
  displayName: "CommandCode",
  protocol: "commandcode",
  defaultModels: [
    { slug: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { slug: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { slug: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
  ],
  subscriptionUsage: probeCommandCodeSubscriptionUsage,
};
const UPDATE = makeStaticProviderMaintenanceResolver(
  makeManualOnlyProviderMaintenanceCapabilities({
    provider: DRIVER_KIND,
    packageName: "command-code",
  }),
);

export type CommandCodeDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerSettingsService;

function resolveBinaryPath(
  config: CommandCodeSettings,
) {
  return config.binaryPath === "commandcode" ? "cmdc" : config.binaryPath;
}

const COMMAND_CODE_MODEL_REFERENCE = [
  "dist",
  "bundled",
  "command-code-knowledge",
  "reference",
  "models.md",
] as const;

function commandCodeModelCatalogPaths(path: Path.Path, binaryPath: string): ReadonlyArray<string> {
  const directory = path.dirname(binaryPath);
  return [
    path.join(directory, "node_modules", "command-code", ...COMMAND_CODE_MODEL_REFERENCE),
    path.join(directory, "..", "command-code", ...COMMAND_CODE_MODEL_REFERENCE),
    path.join(directory, "bundled", ...COMMAND_CODE_MODEL_REFERENCE.slice(1)),
    path.join(directory, ...COMMAND_CODE_MODEL_REFERENCE),
  ];
}

function readCommandCodeModelCatalog(
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  binaryPath: string,
) {
  return Effect.gen(function* () {
    for (const candidate of commandCodeModelCatalogPaths(path, binaryPath)) {
      const contents = yield* fileSystem.readFileString(candidate).pipe(Effect.option);
      if (Option.isSome(contents)) return contents.value;
    }
    return "";
  });
}

const stampIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: `commandcode:${input.instanceId}` },
  });

export const CommandCodeDriver: ProviderDriver<CommandCodeSettings, CommandCodeDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "CommandCode", supportsMultipleInstances: true },
  configSchema: CommandCodeSettings,
  defaultConfig: () => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fileSystem = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const hostPlatform = yield* HostProcessPlatform;
      const serverSettings = yield* ServerSettingsService;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const effectiveConfig = {
        ...config,
        enabled,
        binaryPath: resolveBinaryPath(config),
      } satisfies CommandCodeSettings;
      const capabilityRegistry = makeHeadlessCliModelCapabilityRegistry();
      const modelCatalog = yield* readCommandCodeModelCatalog(
        fileSystem,
        path,
        effectiveConfig.binaryPath,
      );
      const stamp = stampIdentity({ instanceId, displayName, accentColor });
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      });
      const adapter = yield* makeHeadlessCliAdapter(effectiveConfig, {
        provider: DRIVER_KIND,
        instanceId,
        environment: processEnv,
        protocol: "commandcode",
        modelCapabilities: capabilityRegistry.resolve,
      });
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<
        ProviderSnapshotSettings<CommandCodeSettings>
      >({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialHeadlessCliProvider(DEFINITION, settings.provider, capabilityRegistry).pipe(
            Effect.map(stamp),
          ),
        checkProvider: checkHeadlessCliProviderStatus(DEFINITION, effectiveConfig, processEnv, {
          capabilityRegistry,
          modelCatalog,
          platform: hostPlatform,
        }).pipe(
          Effect.map(stamp),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build CommandCode snapshot: ${cause.message}`,
              cause,
            }),
        ),
      );
      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity: defaultProviderContinuationIdentity({
          driverKind: DRIVER_KIND,
          instanceId,
        }),
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration: makeHeadlessCliTextGeneration({
          binaryPath: effectiveConfig.binaryPath,
          environment: processEnv,
          provider: DRIVER_KIND,
          providerName: "CommandCode",
          protocol: "commandcode",
          platform: hostPlatform,
        }),
      } satisfies ProviderInstance;
    }),
};
