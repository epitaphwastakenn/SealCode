// @effect-diagnostics nodeBuiltinImport:off -- Server configuration holds secrets; only its digest may reach the cache file.
import * as NodeCrypto from "node:crypto";

import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

/** One MCP tool as the server listed it. */
export type UpstreamTool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly annotations?: Record<string, unknown>;
  readonly execution?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
  readonly icons?: ReadonlyArray<Record<string, unknown>>;
  readonly title?: string;
};

/** What a server offered the last time it was started, valid for the configuration that started it. */
export type CachedMcpTools = {
  /** A digest, never the configuration itself: environment variables and headers hold secrets. */
  readonly fingerprint: string;
  readonly discoveredAt: number;
  readonly tools: ReadonlyArray<UpstreamTool>;
};

export const digestFingerprint = (fingerprint: string): string =>
  NodeCrypto.createHash("sha256").update(fingerprint).digest("hex");

/** A tool list this old is read again at the next start, in case the server changed under it. */
export const MCP_TOOL_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export interface McpToolCacheStore {
  readonly load: Effect.Effect<ReadonlyMap<string, CachedMcpTools>>;
  readonly save: (entries: ReadonlyMap<string, CachedMcpTools>) => Effect.Effect<void>;
}

/** Without a file, a restart starts every server to learn its tools. */
export const McpToolCache = Context.Reference<McpToolCacheStore>("t3/mcp/McpToolCache", {
  defaultValue: () => ({ load: Effect.succeed(new Map()), save: () => Effect.void }),
});

const CacheFile = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  servers: Schema.Record(
    Schema.String,
    Schema.Struct({
      fingerprint: Schema.String,
      discoveredAt: Schema.Number,
      tools: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
});
const cacheFileJson = Schema.fromJsonString(CacheFile);
const decodeCacheFile = Schema.decodeUnknownOption(cacheFileJson);
const encodeCacheFile = Schema.encodeSync(cacheFileJson);

const isUpstreamTool = (value: Record<string, unknown>): value is UpstreamTool =>
  typeof value["name"] === "string" &&
  typeof value["inputSchema"] === "object" &&
  value["inputSchema"] !== null;

export const makeFileMcpToolCache = Effect.fn("McpToolCache.makeFile")(function* (
  filePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return {
    load: fileSystem.readFileString(filePath).pipe(
      Effect.map((raw) => decodeCacheFile(raw)),
      Effect.orElseSucceed(() => Option.none<typeof CacheFile.Type>()),
      Effect.map((decoded): ReadonlyMap<string, CachedMcpTools> => {
        const entries = new Map<string, CachedMcpTools>();
        if (Option.isNone(decoded)) return entries;
        for (const [id, entry] of Object.entries(decoded.value.servers)) {
          // One unreadable tool makes the whole list suspect; the server is asked again.
          if (!entry.tools.every(isUpstreamTool)) continue;
          entries.set(id, {
            fingerprint: entry.fingerprint,
            discoveredAt: entry.discoveredAt,
            tools: entry.tools as ReadonlyArray<UpstreamTool>,
          });
        }
        return entries;
      }),
    ),
    save: (entries) =>
      writeFileStringAtomically({
        filePath,
        contents: `${encodeCacheFile({
          schemaVersion: 1,
          servers: Object.fromEntries(entries),
        })}\n`,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.ignore({ log: true }),
      ),
  } satisfies McpToolCacheStore;
});

/** Tool lists in the caches directory, so a start can offer a stdio server's tools without running it. */
export const layerFile = Layer.effect(
  McpToolCache,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return yield* makeFileMcpToolCache(path.join(config.providerStatusCacheDir, "mcp-tools.json"));
  }),
);
