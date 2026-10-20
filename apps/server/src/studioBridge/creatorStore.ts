// @effect-diagnostics nodeBuiltinImport:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off globalDateInEffect:off globalRandomInEffect:off globalTimers:off preferSchemaOverJson:off globalFetchInEffect:off
import * as Effect from "effect/Effect";

/**
 * Roblox's public Creator Store endpoints (no key needed). Results are trimmed to what an agent
 * uses to choose an asset, and prices are read so paid items are never offered for insertion.
 */

const STORE = "https://apis.roblox.com/toolbox-service/v2";
const THUMBNAILS = "https://thumbnails.roblox.com/v1/assets";
const TIMEOUT_MS = 15_000;

export const ASSET_TYPES = [
  "Model",
  "Audio",
  "Decal",
  "MeshPart",
  "Video",
  "FontFamily",
  "Plugin",
] as const;
export type CreatorStoreAssetType = (typeof ASSET_TYPES)[number];

/** Particle and VFX searches are Model searches with words that steer toward effects. */
export const searchCategory = (
  type: string | undefined,
): { readonly category: CreatorStoreAssetType; readonly extraQuery?: string } => {
  switch ((type ?? "Model").toLowerCase()) {
    case "vfx":
    case "particle":
    case "particles":
      return { category: "Model", extraQuery: "vfx" };
    case "image":
    case "decal":
      return { category: "Decal" };
    case "audio":
    case "sound":
      return { category: "Audio" };
    case "meshpart":
    case "mesh":
      return { category: "MeshPart" };
    case "video":
      return { category: "Video" };
    case "font":
    case "fontfamily":
      return { category: "FontFamily" };
    case "plugin":
      return { category: "Plugin" };
    default:
      return { category: "Model" };
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fetchJson = (url: string) =>
  Effect.tryPromise({
    try: async (signal) => {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const response = await fetch(url, { signal: AbortSignal.any([signal, timeout]) });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `Creator Store answered HTTP ${String(response.status)}: ${text.slice(0, 200)}`,
        );
      }
      return JSON.parse(text) as unknown;
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

/** USD price of a store entry; 0 for free items. */
const priceOf = (entry: Record<string, unknown>): number => {
  const product = isRecord(entry.creatorStoreProduct) ? entry.creatorStoreProduct : undefined;
  const price = product && isRecord(product.purchasePrice) ? product.purchasePrice : undefined;
  const quantity = price && isRecord(price.quantity) ? price.quantity : undefined;
  if (!quantity) return 0;
  const significand = Number(quantity.significand ?? 0);
  const exponent = Number(quantity.exponent ?? 0);
  return Number.isFinite(significand) ? Math.round(significand * 10 ** exponent * 100) / 100 : 0;
};

export interface StoreAssetSummary {
  readonly id: number;
  readonly name: string;
  readonly creator: string;
  readonly verifiedCreator: boolean;
  readonly priceUsd: number;
  readonly upVotePercent?: number;
  readonly votes?: number;
  readonly hasScripts: boolean;
  readonly scriptCount: number;
  readonly triangles?: number;
  readonly instanceCounts?: Record<string, unknown>;
  readonly description: string;
  readonly updated?: string;
}

const summarize = (entry: Record<string, unknown>): StoreAssetSummary | undefined => {
  const asset = isRecord(entry.asset) ? entry.asset : undefined;
  if (!asset || typeof asset.id !== "number") return undefined;
  const creator = isRecord(entry.creator) ? entry.creator : {};
  const voting = isRecord(entry.voting) ? entry.voting : {};
  const mesh = isRecord(asset.objectMeshSummary) ? asset.objectMeshSummary : undefined;
  return {
    id: asset.id,
    name: String(asset.name ?? ""),
    creator: String(creator.name ?? ""),
    verifiedCreator: creator.verified === true,
    priceUsd: priceOf(entry),
    ...(typeof voting.upVotePercent === "number" ? { upVotePercent: voting.upVotePercent } : {}),
    ...(typeof voting.voteCount === "number" ? { votes: voting.voteCount } : {}),
    hasScripts: asset.hasScripts === true,
    scriptCount: typeof asset.scriptCount === "number" ? asset.scriptCount : 0,
    ...(mesh && typeof mesh.triangles === "number" && mesh.triangles > 0
      ? { triangles: mesh.triangles }
      : {}),
    ...(isRecord(asset.instanceCounts) ? { instanceCounts: asset.instanceCounts } : {}),
    description: String(asset.description ?? "").slice(0, 300),
    ...(typeof asset.updateTime === "string" ? { updated: asset.updateTime.slice(0, 10) } : {}),
  };
};

export const searchStore = (input: {
  readonly type: string | undefined;
  readonly query: string | undefined;
  readonly maxResults: number;
  readonly sortBy: string | undefined;
  readonly includePaid: boolean;
}) =>
  Effect.gen(function* () {
    const { category, extraQuery } = searchCategory(input.type);
    const query = [input.query?.trim(), extraQuery]
      .filter((part) => part !== undefined && part !== "")
      .join(" ");
    const params = new URLSearchParams({
      searchCategoryType: category,
      // Paid items are dropped below, so ask for extra to still fill the page.
      maxPageSize: String(
        Math.min(100, input.includePaid ? input.maxResults : input.maxResults * 3),
      ),
    });
    if (query !== "") params.set("query", query);
    if (input.sortBy) params.set("sortCategory", input.sortBy);
    const body = yield* fetchJson(`${STORE}/assets:search?${params.toString()}`);
    const entries =
      isRecord(body) && Array.isArray(body.creatorStoreAssets) ? body.creatorStoreAssets : [];
    const all = entries.flatMap((entry) => {
      const summary = isRecord(entry) ? summarize(entry) : undefined;
      return summary ? [summary] : [];
    });
    const results = (input.includePaid ? all : all.filter((asset) => asset.priceUsd === 0)).slice(
      0,
      input.maxResults,
    );
    return {
      category,
      query,
      results,
      droppedPaid: all.length - all.filter((a) => a.priceUsd === 0).length,
    };
  });

export const assetDetails = (assetId: number) =>
  fetchJson(`${STORE}/assets/${String(assetId)}`).pipe(
    Effect.map((body) => (isRecord(body) ? summarize(body) : undefined)),
  );

/** The asset's store thumbnail as PNG bytes, when Roblox has one ready. */
export const assetThumbnail = (assetId: number, size: "150x150" | "420x420" | "768x432") =>
  Effect.gen(function* () {
    const body = yield* fetchJson(
      `${THUMBNAILS}?assetIds=${String(assetId)}&size=${size}&format=Png&isCircular=false`,
    );
    const first = isRecord(body) && Array.isArray(body.data) ? body.data[0] : undefined;
    if (!isRecord(first) || first.state !== "Completed" || typeof first.imageUrl !== "string") {
      return undefined;
    }
    const imageUrl = first.imageUrl;
    return yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(imageUrl, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        });
        if (!response.ok) throw new Error(`thumbnail HTTP ${String(response.status)}`);
        return Buffer.from(await response.arrayBuffer());
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
  });
