import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  ServerProvider as ServerProviderSchema,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { writeFileStringAtomically } from "../atomicWrite.ts";
// Only used to read snapshots written by the removed CLI integration.
const antigravityDisplayKey = (slug: string, name?: string) => (name?.trim() || slug)
  .toLowerCase()
  .replace(/\s*\((?:low|medium|high|thinking)\)/gi, " ")
  .replace(/-(?:low|medium|high|thinking)(?=[^a-z0-9]|$)/gi, " ")
  .replace(/[^a-z0-9]+/g, " ").trim();

const decodeProviderStatusCache = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ServerProviderSchema),
);

const LEGACY_ANTIGRAVITY_EFFORT_MODEL = /-(?:low|medium|high)$/i;

const isAntigravityCatalogId = (slug: string): boolean =>
  /^[a-z0-9][a-z0-9._:/-]*$/.test(slug) && !/[:/]$/.test(slug);

const antigravityCachedModelRank = (slug: string): number =>
  (isAntigravityCatalogId(slug) ? 2 : 0) + (/-thinking$/i.test(slug) ? 1 : 0);

const cachedModelsForProvider = (
  provider: ProviderDriverKind,
  models: ReadonlyArray<ServerProvider["models"][number]>,
  fallbackModels: ReadonlyArray<ServerProvider["models"][number]>,
): ReadonlyArray<ServerProvider["models"][number]> => {
  if (provider !== "antigravity") return models;

  const fallbackKeys = new Set(
    fallbackModels.map((model) => antigravityDisplayKey(model.slug, model.name)),
  );
  const selected = new Map<string, ServerProvider["models"][number]>();
  for (const model of models) {
    if (model.isCustom) {
      selected.set(`custom:${model.slug}`, model);
      continue;
    }
    if (LEGACY_ANTIGRAVITY_EFFORT_MODEL.test(model.slug)) continue;
    const key = antigravityDisplayKey(model.slug, model.name);
    if (fallbackKeys.has(key)) continue;
    const existing = selected.get(key);
    if (
      !existing ||
      antigravityCachedModelRank(model.slug) > antigravityCachedModelRank(existing.slug)
    ) {
      selected.set(key, model);
    }
  }
  return [...selected.values()];
};

const mergeProviderModels = (
  fallbackModels: ReadonlyArray<ServerProvider["models"][number]>,
  cachedModels: ReadonlyArray<ServerProvider["models"][number]>,
): ReadonlyArray<ServerProvider["models"][number]> => {
  const fallbackSlugs = new Set(fallbackModels.map((model) => model.slug));
  return [...fallbackModels, ...cachedModels.filter((model) => !fallbackSlugs.has(model.slug))];
};

export const orderProviderSnapshots = (
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> =>
  [...providers].toSorted(
    (left, right) =>
      (left.displayName ?? "").localeCompare(right.displayName ?? "") ||
      left.driver.localeCompare(right.driver) ||
      left.instanceId.localeCompare(right.instanceId),
  );

export const isCachedProviderCorrelated = (input: {
  readonly cachedProvider: ServerProvider;
  readonly fallbackProvider: ServerProvider;
}): boolean =>
  input.cachedProvider.instanceId === input.fallbackProvider.instanceId &&
  input.cachedProvider.driver === input.fallbackProvider.driver &&
  (input.fallbackProvider.driver !== "antigravity" || input.cachedProvider.continuation.groupKey === input.fallbackProvider.continuation.groupKey);

export const hydrateCachedProvider = (input: {
  readonly cachedProvider: ServerProvider;
  readonly fallbackProvider: ServerProvider;
}): ServerProvider => {
  if (!isCachedProviderCorrelated(input)) {
    return input.fallbackProvider;
  }

  if (
    !input.fallbackProvider.enabled ||
    input.cachedProvider.enabled !== input.fallbackProvider.enabled
  ) {
    return input.fallbackProvider;
  }

  const { message: _fallbackMessage, ...fallbackWithoutMessage } = input.fallbackProvider;
  const hydratedProvider: ServerProvider = {
    ...fallbackWithoutMessage,
    models: mergeProviderModels(
      input.fallbackProvider.models,
      input.fallbackProvider.continuation.groupKey.startsWith("antigravity:acp:") ? input.cachedProvider.models : cachedModelsForProvider(
        input.fallbackProvider.driver,
        input.cachedProvider.models,
        input.fallbackProvider.models,
      ),
    ),
    installed: input.cachedProvider.installed,
    version: input.cachedProvider.version,
    status: input.cachedProvider.status,
    auth: input.cachedProvider.auth,
    checkedAt: input.cachedProvider.checkedAt,
    slashCommands: input.cachedProvider.slashCommands,
    skills: input.cachedProvider.skills,
  };

  return input.cachedProvider.message
    ? { ...hydratedProvider, message: input.cachedProvider.message }
    : hydratedProvider;
};

/**
 * Resolve the on-disk cache path for a provider instance snapshot.
 *
 * File naming: `<cacheDir>/<instanceId>.json`. For the default instance of
 * a built-in kind this equals the legacy `<kind>.json` path (because
 * `defaultInstanceIdForDriver(kind).toString() === kind`), so existing
 * cached snapshots remain readable without any rename step.
 *
 * Non-default instances (e.g. `codex_personal`) land in their own files and
 * never collide with other instances.
 *
 * Cache contents must still carry matching `instanceId` + `driver` identity
 * before hydration. The filename alone is not trusted as a routing key.
 */
export const resolveProviderStatusCachePath = Effect.fn("resolveProviderStatusCachePath")(
  function* (input: {
    readonly cacheDir: string;
    readonly instanceId: ProviderInstanceId;
  }): Effect.fn.Return<string, never, Path.Path> {
    const path = yield* Path.Path;
    return path.join(input.cacheDir, `${input.instanceId}.json`);
  },
);

/**
 * Legacy kind-keyed path resolver retained for callers that still think in
 * terms of `ProviderDriverKind`. Prefer `resolveProviderStatusCachePath` with an
 * `instanceId`; new code should route through the instance registry.
 *
 * @deprecated use `resolveProviderStatusCachePath` with an instance id.
 */
export const resolveLegacyProviderStatusCachePath = Effect.fn(
  "resolveLegacyProviderStatusCachePath",
)(function* (input: {
  readonly cacheDir: string;
  readonly provider: ProviderDriverKind;
}): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  return path.join(input.cacheDir, `${input.provider}.json`);
});

export const readProviderStatusCache = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return undefined;
    }

    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    return yield* decodeProviderStatusCache(trimmed).pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          Effect.logWarning("failed to parse provider status cache, ignoring", {
            path: filePath,
            errorTag: causeErrorTag(cause),
          }).pipe(Effect.as(undefined)),
        onSuccess: Effect.succeed,
      }),
    );
  });

export const writeProviderStatusCache = (input: {
  readonly filePath: string;
  readonly provider: ServerProvider;
}) => {
  const { updateState: _updateState, ...cacheableProvider } = input.provider;
  return writeFileStringAtomically({
    filePath: input.filePath,
    contents: `${JSON.stringify(cacheableProvider, null, 2)}\n`,
  });
};
