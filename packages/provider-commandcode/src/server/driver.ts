/**
 * CommandCode keeps its sessions and credentials under the user's own
 * `~/.commandcode`, so continuation identity uses the default instance grouping.
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import {
  makeManagedServerProvider,
  type ProviderCheckReason,
} from "@t3tools/provider-core/server/managedProvider";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makeCachedProviderMaintenanceResolution,
  makePackageManagedProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";

import { COMMAND_CODE_DRIVER_KIND } from "../identity.ts";
import { CommandCodeSettings } from "../settings.ts";
import { makeCommandCodeAdapterV2 } from "./adapter.ts";
import { checkCommandCodeProviderStatus, makePendingCommandCodeProvider } from "./status.ts";
import { makeUnsupportedCommandCodeTextGeneration } from "./textGeneration.ts";

const decodeSettings = Schema.decodeSync(CommandCodeSettings);

/** `commandcode update` stays manual: only the installer that provably owns the binary may run it. */
const UPDATE = makePackageManagedProviderMaintenanceResolver({
  provider: COMMAND_CODE_DRIVER_KIND,
  npmPackageName: "command-code",
  nativeUpdate: null,
});

export type CommandCodeDriverEnv =
  | IdAllocator.IdAllocatorV2
  | ProviderHost.ProviderHost
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | ProviderLatestVersions.ProviderLatestVersions
  | Path.Path;

export const CommandCodeDriver: ProviderDriver<CommandCodeSettings, CommandCodeDriverEnv> = {
  driverKind: COMMAND_CODE_DRIVER_KIND,
  metadata: { displayName: "CommandCode", supportsMultipleInstances: true },
  configSchema: CommandCodeSettings,
  defaultConfig: () => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const httpClient = yield* HttpClient.HttpClient;
      const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
      const host = yield* ProviderHost.ProviderHost;
      const { cwd, providerStatusCacheDir } = host.paths;
      const processEnvironment = yield* mergeProviderInstanceEnvironment(
        environment,
        yield* HostProcess.Environment,
      );
      const effectiveConfig = { ...config, enabled } satisfies CommandCodeSettings;
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: COMMAND_CODE_DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: COMMAND_CODE_DRIVER_KIND,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
        resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
          binaryPath: effectiveConfig.binaryPath,
          env: processEnvironment,
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      );
      const checkProvider = Effect.fn("CommandCodeDriver.checkProvider")(function* (
        reason: ProviderCheckReason,
      ) {
        const status = yield* checkCommandCodeProviderStatus(
          effectiveConfig,
          processEnvironment,
          cwd,
          {
            reason,
            modelListCachePath: path.join(
              providerStatusCacheDir,
              "commandcode-models",
              `${instanceId}.json`,
            ),
          },
        ).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.provideService(HttpClient.HttpClient, httpClient),
        );
        return stampIdentity(status);
      });
      const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
      const snapshot = yield* makeManagedServerProvider<
        ProviderSnapshotSettings<CommandCodeSettings>
      >({
        resolveMaintenance,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          makePendingCommandCodeProvider(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider: checkProvider("requested"),
        checkProviderFor: checkProvider,
        enrichSnapshot: ({ settings, snapshot: currentSnapshot, publishSnapshot }) =>
          resolveMaintenance().pipe(
            Effect.flatMap((maintenanceCapabilities) =>
              enrichProviderSnapshotWithVersionAdvisory(currentSnapshot, maintenanceCapabilities, {
                enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
              }),
            ),
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.provideService(ProviderLatestVersions.ProviderLatestVersions, latestVersions),
            Effect.flatMap(publishSnapshot),
          ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: COMMAND_CODE_DRIVER_KIND,
              instanceId,
              detail: "Failed to build CommandCode snapshot.",
              cause,
            }),
        ),
      );
      const orchestrationAdapter = yield* makeCommandCodeAdapterV2({
        instanceId,
        settings: effectiveConfig,
        environment: processEnvironment,
        modelCatalog: snapshot.getSnapshot.pipe(Effect.map((current) => current.models)),
      });
      return {
        instanceId,
        driverKind: COMMAND_CODE_DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        orchestrationAdapter,
        textGeneration: makeUnsupportedCommandCodeTextGeneration(),
      } satisfies ProviderInstance;
    }),
};
