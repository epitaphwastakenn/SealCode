import { AntigravitySettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
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
  type HeadlessCliProviderDefinition,
} from "../Layers/HeadlessCliProvider.ts";
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

const DRIVER_KIND = ProviderDriverKind.make("antigravity");
const decodeSettings = Schema.decodeSync(AntigravitySettings);
const DEFINITION: HeadlessCliProviderDefinition = {
  driver: DRIVER_KIND,
  displayName: "Antigravity",
  protocol: "antigravity",
  defaultModels: [
    { slug: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)" },
    { slug: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)" },
    { slug: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)" },
  ],
};
const UPDATE = makeStaticProviderMaintenanceResolver(
  makeManualOnlyProviderMaintenanceCapabilities({ provider: DRIVER_KIND, packageName: null }),
);

export type AntigravityDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerSettingsService;

function resolveBinaryPath(
  path: Path.Path,
  config: AntigravitySettings,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) {
  if (config.binaryPath !== "agy" || platform !== "win32") return config.binaryPath;
  const localAppData = environment.LOCALAPPDATA;
  return localAppData ? path.join(localAppData, "agy", "bin", "agy.exe") : config.binaryPath;
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
    continuation: { groupKey: `antigravity:${input.instanceId}` },
  });

export const AntigravityDriver: ProviderDriver<AntigravitySettings, AntigravityDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Antigravity", supportsMultipleInstances: true },
  configSchema: AntigravitySettings,
  defaultConfig: () => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const hostPlatform = yield* HostProcessPlatform;
      const serverSettings = yield* ServerSettingsService;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const effectiveConfig = {
        ...config,
        enabled,
        binaryPath: resolveBinaryPath(path, config, processEnv, hostPlatform),
      } satisfies AntigravitySettings;
      const stamp = stampIdentity({ instanceId, displayName, accentColor });
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      });
      const adapter = yield* makeHeadlessCliAdapter(effectiveConfig, {
        provider: DRIVER_KIND,
        instanceId,
        environment: processEnv,
        protocol: "antigravity",
      });
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<
        ProviderSnapshotSettings<AntigravitySettings>
      >({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialHeadlessCliProvider(DEFINITION, settings.provider).pipe(Effect.map(stamp)),
        checkProvider: checkHeadlessCliProviderStatus(DEFINITION, effectiveConfig, processEnv).pipe(
          Effect.map(stamp),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Antigravity snapshot: ${cause.message}`,
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
          providerName: "Antigravity",
          protocol: "antigravity",
          platform: hostPlatform,
        }),
      } satisfies ProviderInstance;
    }),
};
