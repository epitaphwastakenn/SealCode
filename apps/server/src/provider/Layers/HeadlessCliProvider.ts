import {
  type ModelCapabilities,
  type ProviderDriverKind,
  type ServerProviderModel,
  type SubscriptionUsage,
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
  type CommandResult,
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
  readonly subscriptionUsage?: (input: {
    readonly environment: NodeJS.ProcessEnv;
    readonly checkedAt: string;
  }) => Effect.Effect<SubscriptionUsage | undefined>;
  /**
   * Some providers expose account state through a separate local service.
   * Probe that service even when their CLI health check is unavailable.
   */
  readonly probeSubscriptionUsageBeforeCliHealth?: boolean;
}

export function normalizeHeadlessCliModel(
  protocol: HeadlessCliProviderDefinition["protocol"],
  model: string | undefined,
): string | undefined {
  if (!model || protocol !== "antigravity") return model;
  return model.replace(
    /(?:-(?:minimal|low|medium|high|xhigh|max|thinking)|\s+\((?:minimal|low|medium|high|xhigh|max|thinking)\))$/i,
    "",
  );
}

const HEADLESS_CLI_NO_EFFORT_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
  vision: false,
});
const PROBE_TIMEOUT_MS = 20_000;

export function headlessCliHealthProbeArgs(
  protocol: HeadlessCliProviderDefinition["protocol"],
): ReadonlyArray<string> {
  return protocol === "commandcode"
    ? ["--no-auto-update", "--version"]
    : protocol === "antigravity"
      ? ["--version"]
      : ["--help"];
}

const EFFORT_ORDER = new Map([
  ["minimal", 0],
  ["low", 1],
  ["medium", 2],
  ["high", 3],
  ["thinking", 4],
  ["xhigh", 5],
  ["max", 6],
]);

function normalizeModelKey(model: string | undefined): string | undefined {
  const normalized = model?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function normalizeEffortValues(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].toSorted(
    (left, right) =>
      (EFFORT_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (EFFORT_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

function titleCaseEffort(value: string): string {
  return value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase() + value.slice(1);
}

export function capabilitiesForEffortLevels(
  values: ReadonlyArray<string> | undefined,
): ModelCapabilities {
  const efforts = normalizeEffortValues(values ?? []);
  if (efforts.length === 0) return HEADLESS_CLI_NO_EFFORT_CAPABILITIES;
  const defaultValue = efforts.includes("medium") ? "medium" : efforts[0];
  return createModelCapabilities({
    optionDescriptors: [
      buildSelectOptionDescriptor({
        id: "effort",
        label: "Reasoning",
        options: efforts.map((value) => ({
          value,
          label: titleCaseEffort(value),
          ...(value === defaultValue ? { isDefault: true } : {}),
        })),
      }),
    ],
    vision: false,
  });
}

export interface HeadlessCliModelCapabilityRegistry {
  readonly resolve: (model: string | undefined) => ModelCapabilities;
  readonly reset: () => void;
  readonly setModelCapabilities: (
    models: ReadonlyArray<Pick<ServerProviderModel, "slug" | "capabilities">>,
  ) => void;
  readonly setEffortLevels: (effortsByModel: ReadonlyMap<string, ReadonlyArray<string>>) => void;
}

export function makeHeadlessCliModelCapabilityRegistry(): HeadlessCliModelCapabilityRegistry {
  const capabilities = new Map<string, ModelCapabilities>();
  return {
    resolve: (model) => {
      const key = normalizeModelKey(model);
      return (key ? capabilities.get(key) : undefined) ?? HEADLESS_CLI_NO_EFFORT_CAPABILITIES;
    },
    reset: () => capabilities.clear(),
    setModelCapabilities: (models) => {
      for (const model of models) {
        const key = normalizeModelKey(model.slug);
        if (key) capabilities.set(key, model.capabilities ?? HEADLESS_CLI_NO_EFFORT_CAPABILITIES);
      }
    },
    setEffortLevels: (effortsByModel) => {
      for (const [model, efforts] of effortsByModel) {
        const key = normalizeModelKey(model);
        if (key) capabilities.set(key, capabilitiesForEffortLevels(efforts));
      }
    },
  };
}

export function parseCommandCodeModelCatalog(
  output: string,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const effortsByModel = new Map<string, ReadonlyArray<string>>();
  for (const rawLine of output.split(/\r?\n/)) {
    const cells = rawLine.split("|").map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const model = cells[1]?.replace(/^`|`$/g, "").trim();
    const effortsCell = cells[4]?.trim();
    const key = normalizeModelKey(model);
    if (!key || !effortsCell || /^(?:-|—|none)$/i.test(effortsCell)) continue;
    const efforts = normalizeEffortValues(effortsCell.split(","));
    if (efforts.length > 0) effortsByModel.set(key, efforts);
  }
  return effortsByModel;
}

export function parseHeadlessCliModelRows(
  definition: HeadlessCliProviderDefinition,
  output: string,
  effortsByModel: ReadonlyMap<string, ReadonlyArray<string>> = new Map(),
): ReadonlyArray<ServerProviderModel> {
  const parsed: Array<{ slug: string; name: string }> = [];
  const discoveredEfforts = new Map(effortsByModel);
  const seen = new Set<string>();
  const terminalOutput = output
    .replace(/\x1b\[[0-9;?]*H/g, "\n")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll("\r", "");
  for (const rawLine of terminalOutput.split("\n")) {
    const line = rawLine
      .replace(/\x1b\[[0-9;]*m/g, "")
      .trim()
      .replace(/^(?:[-*•>]\s+)+/u, "");
    const normalizedLine = line;
    if (
      !normalizedLine ||
      /^(?:(?:[\u2800-\u28ff]\s*)?fetching\b.*|available models\b.*|open source|anthropic|openai|google|sakana|meta|xai|pass the\b.*|docs:.*)$/i.test(
        normalizedLine,
      )
    ) {
      continue;
    }
    if (definition.protocol === "antigravity") {
      const displayMatch = normalizedLine.match(/^(?<model>.+?)(?:\s+\((?<effort>[^()]+)\))?$/u);
      const displayModel = displayMatch?.groups?.model?.trim();
      const displayEffort = displayMatch?.groups?.effort?.trim();
      const displayHasSlugPrefix = Boolean(
        displayModel && /^[a-z0-9][a-z0-9._:/-]+\s+[A-Z]/.test(displayModel),
      );
      if (
        displayModel &&
        !displayHasSlugPrefix &&
        (displayEffort || /^(?:Gemini|Claude|GPT-OSS)\b/.test(displayModel))
      ) {
        const model = displayModel;
        const effort = displayEffort;
        if (effort) {
          const key = normalizeModelKey(model)!;
          discoveredEfforts.set(key, [...(discoveredEfforts.get(key) ?? []), effort]);
        }
        if (!seen.has(model)) {
          seen.add(model);
          parsed.push({ slug: model, name: model });
        }
        continue;
      }
    }
    const match =
      definition.protocol === "antigravity"
        ? normalizedLine.match(/^([^\s]+)(?:\s+(.+))?$/)
        : normalizedLine.match(/^([^\s]+)\s{2,}(.+)$/);
    const discoveredSlug = match?.[1]?.trim();
    const rawName = match?.[2]?.trim();
    const effort =
      definition.protocol === "antigravity"
        ? (discoveredSlug?.match(/-(?<effort>minimal|low|medium|high|xhigh|max|thinking)$/i)?.groups
            ?.effort ?? rawName?.match(/\((?<effort>[^()]+)\)$/u)?.groups?.effort)
        : undefined;
    const slug =
      definition.protocol === "antigravity"
        ? discoveredSlug?.replace(/-(?:minimal|low|medium|high|xhigh|max|thinking)$/i, "")
        : discoveredSlug;
    if (!slug || !/^[a-z0-9][a-z0-9._:/-]*$/.test(slug) || /[:/]$/.test(slug)) {
      continue;
    }
    if (effort) {
      discoveredEfforts.set(slug, [...(discoveredEfforts.get(slug) ?? []), effort]);
    }
    if (seen.has(slug)) continue;
    seen.add(slug);
    const name =
      definition.protocol === "commandcode"
        ? slug
        : (rawName?.replace(/\s+\([^()]+\)$/u, "") ?? slug);
    parsed.push({ slug, name });
  }
  return parsed.map((model) => ({
    ...model,
    isCustom: false,
    capabilities: capabilitiesForEffortLevels(
      discoveredEfforts.get(normalizeModelKey(model.slug)!),
    ),
  }));
}

function configuredModels(
  definition: HeadlessCliProviderDefinition,
  config: HeadlessCliProviderConfig,
  capabilityRegistry: HeadlessCliModelCapabilityRegistry,
  discovered?: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<ServerProviderModel> {
  const builtIn =
    discovered && discovered.length > 0
      ? discovered
      : definition.defaultModels.map((model) => ({
          ...model,
          isCustom: false as const,
          capabilities: capabilityRegistry.resolve(model.slug),
        }));
  return providerModelsFromSettings(
    builtIn,
    config.customModels,
    capabilityRegistry.resolve(undefined),
  ).map((model) => ({ ...model, capabilities: capabilityRegistry.resolve(model.slug) }));
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

function runWindowsPtyCommand(
  binaryPath: string,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<CommandResult> {
  return Effect.tryPromise(() => import("node-pty")).pipe(
    Effect.orDie,
    Effect.flatMap((nodePty) =>
      Effect.callback<CommandResult>((resume) => {
        let output = "";
        let child: import("node-pty").IPty;
        try {
          child = nodePty.spawn(binaryPath, [...args], {
            cwd: process.cwd(),
            cols: 160,
            rows: 40,
            env: environment,
            name: "xterm-color",
          });
        } catch (cause) {
          resume(Effect.die(cause));
          return;
        }
        const dataSubscription = child.onData((chunk) => {
          output += chunk;
        });
        const exitSubscription = child.onExit(({ exitCode }) => {
          dataSubscription.dispose();
          exitSubscription.dispose();
          resume(Effect.succeed({ stdout: output, stderr: "", code: exitCode }));
        });
        return Effect.sync(() => {
          dataSubscription.dispose();
          exitSubscription.dispose();
          child.kill();
        });
      }),
    ),
  );
}

export function buildInitialHeadlessCliProvider(
  definition: HeadlessCliProviderDefinition,
  config: HeadlessCliProviderConfig,
  capabilityRegistry: HeadlessCliModelCapabilityRegistry = makeHeadlessCliModelCapabilityRegistry(),
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
      models: configuredModels(definition, config, capabilityRegistry),
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
  options: {
    readonly capabilityRegistry?: HeadlessCliModelCapabilityRegistry;
    readonly modelCatalog?: string;
  } = {},
): Effect.Effect<
  ServerProviderDraft,
  never,
  import("effect/unstable/process").ChildProcessSpawner.ChildProcessSpawner
> {
  const capabilityRegistry = options.capabilityRegistry ?? makeHeadlessCliModelCapabilityRegistry();
  const modelCatalog = options.modelCatalog ?? "";
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    if (!config.enabled)
      return yield* buildInitialHeadlessCliProvider(definition, config, capabilityRegistry);

    const preflightSubscriptionUsage =
      definition.probeSubscriptionUsageBeforeCliHealth && definition.subscriptionUsage
        ? yield* definition
            .subscriptionUsage({ environment, checkedAt })
            .pipe(Effect.orElseSucceed(() => undefined))
        : undefined;

    const probeArgs = headlessCliHealthProbeArgs(definition.protocol);
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
        models: configuredModels(definition, config, capabilityRegistry),
        probe: {
          installed: !isCommandMissingCause(cause),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          ...(preflightSubscriptionUsage ? { subscriptionUsage: preflightSubscriptionUsage } : {}),
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
        models: configuredModels(definition, config, capabilityRegistry),
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          ...(preflightSubscriptionUsage ? { subscriptionUsage: preflightSubscriptionUsage } : {}),
          message: `${definition.displayName} CLI health check timed out.`,
        },
      });
    }
    const probeResult = probe.value.value;
    const modelArgs =
      definition.protocol === "commandcode" ? ["--no-auto-update", "--list-models"] : ["models"];
    const modelResult = yield* Effect.suspend(() =>
      definition.protocol === "antigravity" && process.platform === "win32"
        ? runWindowsPtyCommand(config.binaryPath, modelArgs, environment)
        : runCommand(config.binaryPath, modelArgs, environment),
    ).pipe(
      Effect.timeoutOption(PROBE_TIMEOUT_MS),
      Effect.orElseSucceed(() => Option.none()),
    );
    const effortsByModel =
      definition.protocol === "commandcode"
        ? parseCommandCodeModelCatalog(modelCatalog)
        : new Map<string, ReadonlyArray<string>>();
    const discovered = Option.isSome(modelResult)
      ? parseHeadlessCliModelRows(
          definition,
          `${modelResult.value.stdout}\n${modelResult.value.stderr}`,
          effortsByModel,
        )
      : [];
    if (Option.isSome(modelResult)) {
      capabilityRegistry.reset();
      capabilityRegistry.setEffortLevels(effortsByModel);
      capabilityRegistry.setModelCapabilities(discovered);
    }
    const version = parseGenericCliVersion(`${probeResult.stdout}\n${probeResult.stderr}`);
    const ok = probeResult.code === 0;
    const subscriptionUsage =
      preflightSubscriptionUsage ??
      (ok && definition.subscriptionUsage
        ? yield* definition
            .subscriptionUsage({ environment, checkedAt })
            .pipe(Effect.orElseSucceed(() => undefined))
        : undefined);
    return buildServerProvider({
      presentation: {
        displayName: definition.displayName,
        badgeLabel: "Native CLI",
        showInteractionModeToggle: true,
        requiresNewThreadForModelChange: true,
      },
      enabled: true,
      checkedAt,
      models: configuredModels(definition, config, capabilityRegistry, discovered),
      probe: {
        installed: true,
        version,
        status: ok ? "ready" : "error",
        auth: { status: "unknown" },
        ...(subscriptionUsage ? { subscriptionUsage } : {}),
        message: ok
          ? `${definition.displayName} CLI is ready with ${configuredModels(definition, config, capabilityRegistry, discovered).length} models.`
          : `${definition.displayName} CLI returned exit code ${probeResult.code}.`,
      },
    });
  }).pipe(
    Effect.catchCause(() =>
      buildInitialHeadlessCliProvider(definition, config, capabilityRegistry),
    ),
  );
}
