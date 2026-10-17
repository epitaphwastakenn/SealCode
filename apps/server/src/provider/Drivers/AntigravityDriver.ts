import { AntigravitySettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import { HostProcessArchitecture } from "@t3tools/shared/hostProcess";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeAntigravityTextGeneration } from "../../textGeneration/AntigravityTextGeneration.ts";
import { makeUnsupportedTextGeneration } from "../../textGeneration/UnsupportedTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeAntigravityAdapter } from "../Layers/AntigravityAdapter.ts";
import { makeAntigravityAcpAdapter } from "../Layers/AntigravityAcpAdapter.ts";
import { checkAntigravityAcpProvider } from "../Layers/AntigravityAcpProvider.ts";
import { makeAntigravityRuntimeFactory } from "../acp/AntigravityAcpSupport.ts";
import { makeAntigravitySetup } from "../AntigravitySetup.ts";
import { PINNED_SDK_VERSION } from "../antigravity/bridgeProtocol.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { type ProviderDriver, type ProviderInstance } from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import { buildServerProvider, type ServerProviderDraft } from "../providerSnapshot.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
} from "../providerUpdateSettings.ts";
const DRIVER_KIND = ProviderDriverKind.make("antigravity");
const decodeSettings = Schema.decodeSync(AntigravitySettings);
export type AntigravityDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | ServerConfig
  | ServerSettingsService;

function checkSdkProviderStatus(
  config: AntigravitySettings,
  processEnv: NodeJS.ProcessEnv,
  stamp: (snapshot: ServerProviderDraft) => ServerProvider,
): Effect.Effect<ServerProvider> {
  const models = [
    {
      id: "gemini-3.7-flash",
      name: "Gemini 3.7 Flash",
      description: "Default Antigravity SDK model",
      isDefault: true,
    },
    ...config.customModels.map((m) => ({
      id: m,
      name: m,
    })),
  ];

  const hasApiKey = Boolean(processEnv.GEMINI_API_KEY);
  const hasVertex = Boolean(
    processEnv.GOOGLE_GENAI_USE_VERTEXAI || processEnv.GOOGLE_CLOUD_PROJECT,
  );
  const statusLevel =
    hasApiKey || hasVertex ? ("ready_to_connect" as const) : ("configuration_required" as const);
  const statusMessage =
    statusLevel === "ready_to_connect"
      ? "Antigravity SDK ready (API key / Vertex ADC configured)."
      : "Configuration required: Set GEMINI_API_KEY or configure Vertex AI ADC. Google account ACP sign-in is separate from the Python SDK.";

  return Effect.map(Effect.map(DateTime.now, DateTime.formatIso), (checkedAt) =>
    stamp(
      buildServerProvider({
        presentation: {
          displayName: "Antigravity",
          showInteractionModeToggle: true,
          requiresNewThreadForModelChange: true,
        },
        enabled: config.enabled,
        checkedAt,
        models: models.map((model, index) => ({
          slug: model.id,
          name: model.name,
          isCustom: index > 0,
          ...(index === 0 ? { isDefault: true } : {}),
          capabilities: null,
        })),
        probe: {
          installed: true,
          version: PINNED_SDK_VERSION,
          status: statusLevel === "ready_to_connect" ? "ready" : "warning",
          auth: { status: hasApiKey || hasVertex ? "authenticated" : "unknown" },
          message: statusMessage,
        },
      }),
    ),
  );
}

export const AntigravityDriver: ProviderDriver<AntigravitySettings, AntigravityDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Antigravity", supportsMultipleInstances: true },
  configSchema: AntigravitySettings,
  defaultConfig: () => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const settings = yield* ServerSettingsService;
      const arch = yield* HostProcessArchitecture;
      const fs = yield* FileSystem.FileSystem;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const effectiveConfig = { ...config, enabled };
      const isSdk = config.runtime === "sdk";
      const continuationKey = isSdk
        ? `antigravity:instance:${instanceId}`
        : `antigravity:acp:instance:${instanceId}`;
      const stamp = (snapshot: ServerProviderDraft): ServerProvider => ({
        ...snapshot,
        instanceId,
        driver: DRIVER_KIND,
        ...(displayName ? { displayName } : {}),
        ...(accentColor ? { accentColor } : {}),
        continuation: { groupKey: continuationKey },
      });
      const runtime = isSdk
        ? undefined
        : yield* makeAntigravityRuntimeFactory({
            instanceId,
            config: effectiveConfig,
            environment: processEnv,
          });
      const adapter = runtime
        ? yield* makeAntigravityAcpAdapter({ instanceId, makeRuntime: runtime.makeRuntime })
        : yield* makeAntigravityAdapter({
            instanceId,
            pythonPath: config.sdkPythonPath,
            environment: processEnv,
          });
      const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
        provider: DRIVER_KIND,
        packageName: null,
      });
      const source = makeProviderSnapshotSettingsSource(effectiveConfig, settings);
      const check = (probe: boolean) =>
        runtime
          ? checkAntigravityAcpProvider({ ...runtime, enabled, probe, environment: processEnv }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.map(stamp),
            )
          : checkSdkProviderStatus(effectiveConfig, processEnv, stamp);
      const snapshot = yield* makeManagedServerProvider({
        maintenanceCapabilities,
        getSettings: source.getSettings,
        streamSettings: source.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: () => check(false),
        checkProvider: check(true),
      });
      const setup = runtime
        ? yield* makeAntigravitySetup({
            ...runtime,
            arch,
            manualInstallation: Boolean(config.acpBinaryPath),
            stopSessions: adapter.stopAll(),
            refresh: snapshot.refresh,
          })
        : undefined;
      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity: { driverKind: DRIVER_KIND, continuationKey },
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        ...(setup ? { setup } : {}),
        textGeneration: isSdk
          ? makeAntigravityTextGeneration({
              pythonPath: config.sdkPythonPath,
              environment: processEnv,
            })
          : {
              ...makeUnsupportedTextGeneration("Antigravity ACP"),
              generateContextTransferSummary: (input) =>
                Effect.succeed({ summary: input.context.trim() }),
            },
      } satisfies ProviderInstance;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: cause.message,
            cause,
          }),
      ),
    ),
};
