import {
  type ModelCapabilities,
  type ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChildProcess } from "effect/unstable/process";

import {
  buildServerProvider,
  buildSelectOptionDescriptor,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

export interface HeadlessCliProviderConfig {
  readonly enabled: boolean;
  readonly binaryPath: string;
  readonly customModels: ReadonlyArray<string>;
}

export interface HeadlessCliProviderDefinition {
  readonly driver: ProviderDriverKind;
  readonly displayName: string;
  readonly protocol: "antigravity" | "commandcode";
  readonly defaultModels: ReadonlyArray<{ readonly slug: string; readonly name: string }>;
}

const HEADLESS_CLI_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    buildSelectOptionDescriptor({
      id: "effort",
      label: "Reasoning",
      options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium", isDefault: true },
        { value: "high", label: "High" },
      ],
    }),
  ],
  vision: false,
});
const PROBE_TIMEOUT_MS = 20_000;

function modelRows(
  definition: HeadlessCliProviderDefinition,
  output: string,
): ReadonlyArray<ServerProviderModel> {
  const parsed: ServerProviderModel[] = [];
  const seen = new Set<string>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (
      !line ||
      /^(?:available models|open source|anthropic|openai|google|sakana|meta|xai|pass the|docs:|fetching)/i.test(
        line,
      )
    ) {
      continue;
    }
    const match =
      definition.protocol === "antigravity"
        ? line.match(/^([^\s]+)\s+(.+)$/)
        : line.match(/^([^\s]+)\s{2,}(.+)$/);
    const slug = match?.[1]?.trim();
    if (!slug || !/[a-z0-9]/i.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    const name = match?.[2]?.trim() || slug;
    parsed.push({ slug, name, isCustom: false, capabilities: HEADLESS_CLI_CAPABILITIES });
  }
  return parsed;
}

function configuredModels(
  definition: HeadlessCliProviderDefinition,
  config: HeadlessCliProviderConfig,
  discovered?: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<ServerProviderModel> {
  const builtIn =
    discovered && discovered.length > 0
      ? discovered
      : definition.defaultModels.map((model) => ({
          ...model,
          isCustom: false as const,
          capabilities: HEADLESS_CLI_CAPABILITIES,
        }));
  return providerModelsFromSettings(builtIn, config.customModels, HEADLESS_CLI_CAPABILITIES);
}

function runCommand(
  binaryPath: string,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) {
  return Effect.gen(function* () {
    const resolved = yield* resolveSpawnCommand(binaryPath, args, { env: environment });
    return yield* spawnAndCollect(
      binaryPath,
      ChildProcess.make(resolved.command, resolved.args, {
        env: environment,
        shell: resolved.shell,
      }),
    );
  });
}

export function buildInitialHeadlessCliProvider(
  definition: HeadlessCliProviderDefinition,
  config: HeadlessCliProviderConfig,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    return buildServerProvider({
      presentation: {
        displayName: definition.displayName,
        badgeLabel: "Native CLI",
        showInteractionModeToggle: true,
        requiresNewThreadForModelChange: true,
      },
      enabled: config.enabled,
      checkedAt,
      models: configuredModels(definition, config),
      probe: config.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: `Checking ${definition.displayName} CLI availability...`,
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: `${definition.displayName} is disabled in SealCode settings.`,
          },
    });
  });
}

export function checkHeadlessCliProviderStatus(
  definition: HeadlessCliProviderDefinition,
  config: HeadlessCliProviderConfig,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<
  ServerProviderDraft,
  never,
  import("effect/unstable/process").ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    if (!config.enabled) return yield* buildInitialHeadlessCliProvider(definition, config);

    const probeArgs =
      definition.protocol === "commandcode" ? ["--no-auto-update", "--version"] : ["--help"];
    const probe = yield* runCommand(config.binaryPath, probeArgs, environment).pipe(
      Effect.timeoutOption(PROBE_TIMEOUT_MS),
      Effect.exit,
    );
    if (probe._tag === "Failure") {
      const cause = probe.cause;
      return buildServerProvider({
        presentation: {
          displayName: definition.displayName,
          badgeLabel: "Native CLI",
          showInteractionModeToggle: true,
          requiresNewThreadForModelChange: true,
        },
        enabled: true,
        checkedAt,
        models: configuredModels(definition, config),
        probe: {
          installed: !isCommandMissingCause(cause),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: `${definition.displayName} CLI could not be started.`,
        },
      });
    }
    if (Option.isNone(probe.value)) {
      return buildServerProvider({
        presentation: {
          displayName: definition.displayName,
          badgeLabel: "Native CLI",
          showInteractionModeToggle: true,
          requiresNewThreadForModelChange: true,
        },
        enabled: true,
        checkedAt,
        models: configuredModels(definition, config),
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: `${definition.displayName} CLI health check timed out.`,
        },
      });
    }
    const probeResult = probe.value.value;
    const modelArgs =
      definition.protocol === "commandcode" ? ["--no-auto-update", "--list-models"] : ["models"];
    const modelResult = yield* runCommand(config.binaryPath, modelArgs, environment).pipe(
      Effect.timeoutOption(PROBE_TIMEOUT_MS),
      Effect.orElseSucceed(() => Option.none()),
    );
    const discovered = Option.isSome(modelResult)
      ? modelRows(definition, `${modelResult.value.stdout}\n${modelResult.value.stderr}`)
      : [];
    const version = parseGenericCliVersion(`${probeResult.stdout}\n${probeResult.stderr}`);
    const ok = probeResult.code === 0;
    return buildServerProvider({
      presentation: {
        displayName: definition.displayName,
        badgeLabel: "Native CLI",
        showInteractionModeToggle: true,
        requiresNewThreadForModelChange: true,
      },
      enabled: true,
      checkedAt,
      models: configuredModels(definition, config, discovered),
      probe: {
        installed: true,
        version,
        status: ok ? "ready" : "error",
        auth: { status: "unknown" },
        message: ok
          ? `${definition.displayName} CLI is ready with ${configuredModels(definition, config, discovered).length} models.`
          : `${definition.displayName} CLI returned exit code ${probeResult.code}.`,
      },
    });
  }).pipe(Effect.catchCause(() => buildInitialHeadlessCliProvider(definition, config)));
}
