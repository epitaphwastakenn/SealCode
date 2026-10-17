import type { GlobalMcpServer, GlobalMcpStatus } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpProviderSession from "./McpProviderSession.ts";
import { ServerSettingsService } from "../serverSettings.ts";

type UpstreamTool = {
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

class GlobalMcpConnectionError extends Data.TaggedError("GlobalMcpConnectionError")<{
  readonly cause: unknown;
}> {}

export type McpToolCatalogEntry = {
  readonly canonicalName: string;
  readonly serverId: string;
  readonly serverDisplayName: string;
  readonly upstreamToolName: string;
  readonly tool: UpstreamTool;
};

export type McpToolCatalog = {
  readonly tools: ReadonlyArray<McpToolCatalogEntry>;
  readonly byCanonicalName: ReadonlyMap<string, McpToolCatalogEntry>;
};

export type McpCallResult = {
  readonly [key: string]: unknown;
  readonly content: ReadonlyArray<unknown>;
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
};

export type McpInvocation = {
  readonly scope: McpInvocationContext.McpInvocationScope;
  readonly canonicalToolName: string;
  readonly arguments: Record<string, unknown>;
};

export class GlobalMcpManager extends Context.Service<
  GlobalMcpManager,
  {
    readonly reload: Effect.Effect<void>;
    readonly reloadServer: (id: string) => Effect.Effect<void>;
    readonly getStatuses: Effect.Effect<ReadonlyArray<GlobalMcpStatus>>;
    readonly getCatalog: Effect.Effect<McpToolCatalog>;
    readonly callTool: (input: McpInvocation) => Effect.Effect<McpCallResult>;
    readonly streamChanges: Stream.Stream<McpToolCatalog>;
    readonly streamStatusChanges: Stream.Stream<ReadonlyArray<GlobalMcpStatus>>;
    readonly close: Effect.Effect<void>;
  }
>()("t3/mcp/GlobalMcpManager") {}

const emptyCatalog: McpToolCatalog = {
  tools: [],
  byCanonicalName: new Map(),
};

const safeNamePart = (value: string): string => {
  const normalized = value.replace(/[^A-Za-z0-9_]/g, "_");
  return normalized.length > 0 ? normalized : "_";
};

const canonicalToolName = (serverId: string, toolName: string): string =>
  `mcp__${safeNamePart(serverId)}__${safeNamePart(toolName)}`;

const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message.slice(0, 500);
  }
  return "MCP connection failed.";
};

const inheritedEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

const headersFor = (server: GlobalMcpServer): Record<string, string> =>
  Object.fromEntries(server.headers.map((field) => [field.name, field.value]));

const environmentFor = (server: GlobalMcpServer): Record<string, string> => ({
  ...inheritedEnvironment(),
  ...Object.fromEntries(server.env.map((field) => [field.name, field.value])),
});

const serverFingerprint = (server: GlobalMcpServer): string =>
  [
    server.id,
    server.displayName,
    server.enabled,
    server.transport,
    server.command ?? "",
    ...server.args,
    server.cwd ?? "",
    server.url ?? "",
    ...server.env.map((field) => `${field.name}=${field.value}:${field.sensitive}`),
    ...server.headers.map((field) => `${field.name}=${field.value}:${field.sensitive}`),
  ].join("\u0000");

const stableMcpValueFingerprint = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value !== "object") return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) {
    return `[${value.map(stableMcpValueFingerprint).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${key}:${stableMcpValueFingerprint(record[key])}`)
    .join(",")}}`;
};

const catalogFingerprint = (catalog: McpToolCatalog): string =>
  catalog.tools
    .map((entry) =>
      [
        entry.canonicalName,
        entry.serverId,
        entry.serverDisplayName,
        entry.upstreamToolName,
        stableMcpValueFingerprint(entry.tool),
      ].join("\u0000"),
    )
    .join("\u0001");

type McpTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

const createTransport = (server: GlobalMcpServer): McpTransport => {
  if (server.transport === "stdio") {
    if (!server.command) {
      throw new Error(`MCP server ${server.id} is missing its command.`);
    }
    return new StdioClientTransport({
      command: server.command,
      args: [...server.args],
      env: environmentFor(server),
      stderr: "pipe",
      ...(server.cwd === undefined ? {} : { cwd: server.cwd }),
    });
  }

  if (!server.url) {
    throw new Error(`MCP server ${server.id} is missing its URL.`);
  }
  const requestInit = { headers: headersFor(server) };
  return server.transport === "sse"
    ? new SSEClientTransport(new URL(server.url), { requestInit })
    : new StreamableHTTPClientTransport(new URL(server.url), { requestInit });
};

type UpstreamConnection = {
  readonly fingerprint: string;
  readonly server: GlobalMcpServer;
  readonly client: Client;
  readonly tools: ReadonlyArray<UpstreamTool>;
};

const closeConnection = (connection: UpstreamConnection): Effect.Effect<void> =>
  Effect.promise(() => connection.client.close().catch(() => undefined));

const make = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const reloadSemaphore = yield* Semaphore.make(1);
  const catalogRef = yield* Ref.make<McpToolCatalog>(emptyCatalog);
  const catalogChanges = yield* PubSub.unbounded<McpToolCatalog>();
  const statusChanges = yield* PubSub.sliding<ReadonlyArray<GlobalMcpStatus>>(1);
  const connections = new Map<string, UpstreamConnection>();
  const statuses = new Map<string, GlobalMcpStatus>();

  const publishStatuses = () =>
    PubSub.publish(
      statusChanges,
      [...statuses.values()].sort((left, right) => left.id.localeCompare(right.id)),
    ).pipe(Effect.asVoid);

  const setStatus = (
    server: GlobalMcpServer,
    state: GlobalMcpStatus["state"],
    toolCount: number,
    failure?: unknown,
  ) => {
    const next: GlobalMcpStatus = {
      id: server.id,
      state,
      toolCount,
      ...(failure === undefined ? {} : { errorMessage: errorMessage(failure) }),
      updatedAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
    };
    statuses.set(server.id, next);
  };

  const discoverTools = async (client: Client): Promise<ReadonlyArray<UpstreamTool>> => {
    const discovered: UpstreamTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      discovered.push(...(page.tools as ReadonlyArray<UpstreamTool>));
      cursor = typeof page.nextCursor === "string" && page.nextCursor.length > 0
        ? page.nextCursor
        : undefined;
    } while (cursor !== undefined);
    return discovered;
  };

  const connect = (
    server: GlobalMcpServer,
  ): Effect.Effect<UpstreamConnection, GlobalMcpConnectionError> =>
    Effect.tryPromise({
      try: async () => {
        const transport = createTransport(server);
        const client = new McpClient(
          { name: "SealCode Global MCP", version: "1.0.0" },
          { capabilities: {} },
        );
        try {
          await client.connect(transport as Parameters<Client["connect"]>[0]);
          const tools = await discoverTools(client);
          return {
            fingerprint: serverFingerprint(server),
            server,
            client,
            tools,
          } satisfies UpstreamConnection;
        } catch (cause) {
          await client.close().catch(() => undefined);
          throw cause;
        }
      },
      catch: (cause) => new GlobalMcpConnectionError({ cause }),
    });

  const rebuildCatalog = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const entries: McpToolCatalogEntry[] = [];
      const byName = new Map<string, McpToolCatalogEntry>();
      const collisions = new Map<string, Set<string>>();

      for (const connection of [...connections.values()].sort((left, right) =>
        left.server.id.localeCompare(right.server.id),
      )) {
        for (const tool of connection.tools) {
          const entry: McpToolCatalogEntry = {
            canonicalName: canonicalToolName(connection.server.id, tool.name),
            serverId: connection.server.id,
            serverDisplayName: connection.server.displayName,
            upstreamToolName: tool.name,
            tool,
          };
          const previous = byName.get(entry.canonicalName);
          if (previous) {
            const owners = collisions.get(entry.canonicalName) ?? new Set<string>();
            owners.add(previous.serverId);
            owners.add(entry.serverId);
            collisions.set(entry.canonicalName, owners);
            continue;
          }
          byName.set(entry.canonicalName, entry);
          entries.push(entry);
        }
      }

      for (const [name, owners] of collisions) {
        byName.delete(name);
        for (const owner of owners) {
          const current = statuses.get(owner);
          if (current) {
            statuses.set(owner, {
              ...current,
              state: "error",
              errorMessage: `MCP tool name collision for ${name}.`,
              updatedAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
            });
          }
        }
      }

      const next: McpToolCatalog = {
        tools: entries.filter((entry) => byName.get(entry.canonicalName) === entry),
        byCanonicalName: byName,
      };
      McpProviderSession.setMcpToolCatalog(
        next.tools.map((entry) => ({
          canonicalName: entry.canonicalName,
          serverId: entry.serverId,
          serverDisplayName: entry.serverDisplayName,
          upstreamToolName: entry.upstreamToolName,
        })),
      );
      const previous = yield* Ref.get(catalogRef);
      yield* Ref.set(catalogRef, next);
      if (catalogFingerprint(previous) !== catalogFingerprint(next)) {
        yield* PubSub.publish(catalogChanges, next);
      }
      yield* publishStatuses();
    });

  const reloadUnlocked = (
    configured: Readonly<Record<string, GlobalMcpServer>>,
    forcedServerId?: string,
  ) =>
    Effect.gen(function* () {
      const configuredIds = new Set(Object.keys(configured));

      for (const [id, connection] of connections) {
        const next = configured[id];
        if (
          !next ||
          !next.enabled ||
          forcedServerId === id ||
          serverFingerprint(next) !== connection.fingerprint
        ) {
          yield* closeConnection(connection);
          connections.delete(id);
        }
      }

      for (const [id, status] of statuses) {
        if (!configuredIds.has(id)) statuses.delete(id);
        else if (!configured[id]?.enabled && status.state !== "disabled") statuses.delete(id);
      }

      for (const server of Object.values(configured).sort((left, right) =>
        left.id.localeCompare(right.id),
      )) {
        if (!server.enabled) {
          setStatus(server, "disabled", 0);
          continue;
        }
        const existing = connections.get(server.id);
        if (
          existing &&
          forcedServerId !== server.id &&
          existing.fingerprint === serverFingerprint(server)
        ) {
          setStatus(server, "ready", existing.tools.length);
          continue;
        }

        setStatus(server, "connecting", 0);
        yield* publishStatuses();
        const result = yield* Effect.result(connect(server));
        if (Result.isFailure(result)) {
          setStatus(server, "error", 0, result.failure);
          continue;
        }
        connections.set(server.id, result.success);
        setStatus(server, "ready", result.success.tools.length);
      }

      yield* rebuildCatalog();
    });

  const readConfigured = settings.getSettings.pipe(
    Effect.catch((cause) =>
      Effect.logWarning("failed to read global MCP settings", { cause }).pipe(
        Effect.as({ mcpServers: {} as Record<string, GlobalMcpServer> }),
      ),
    ),
  );

  const reload = reloadSemaphore.withPermits(1)(
    readConfigured.pipe(Effect.flatMap((current) => reloadUnlocked(current.mcpServers))),
  );

  const reloadServer = (id: string) =>
    reloadSemaphore.withPermits(1)(
      readConfigured.pipe(Effect.flatMap((current) => reloadUnlocked(current.mcpServers, id))),
    );

  const getStatuses: GlobalMcpManager["Service"]["getStatuses"] = Effect.sync(() =>
    [...statuses.values()].sort((left, right) => left.id.localeCompare(right.id)),
  );

  const getCatalog = Ref.get(catalogRef);

  const callTool: GlobalMcpManager["Service"]["callTool"] = (input) =>
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({
        "mcp.thread_id": input.scope.threadId,
        "mcp.provider_session_id": input.scope.providerSessionId,
        "mcp.provider_instance_id": input.scope.providerInstanceId,
        "mcp.turn_id": input.scope.activeTurnId ?? "",
        "mcp.tool": input.canonicalToolName,
      });
      const catalog = yield* Ref.get(catalogRef);
      const entry = catalog.byCanonicalName.get(input.canonicalToolName);
      if (!entry) {
        return {
          isError: true,
          content: [{ type: "text", text: "Unknown MCP tool." }],
        } satisfies McpCallResult;
      }
      const connection = connections.get(entry.serverId);
      if (!connection) {
        return {
          isError: true,
          content: [{ type: "text", text: "MCP server is not connected." }],
        } satisfies McpCallResult;
      }
      const call = Effect.tryPromise({
        try: () => connection.client.callTool({
          name: entry.upstreamToolName,
          arguments: input.arguments,
        }),
        catch: (cause) => new GlobalMcpConnectionError({ cause }),
      });
      const settled = yield* Effect.result(call);
      if (Result.isFailure(settled)) {
        const message = errorMessage(settled.failure.cause);
        setStatus(connection.server, "error", connection.tools.length, settled.failure.cause);
        yield* publishStatuses();
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          structuredContent: { error: { message } },
        } satisfies McpCallResult;
      }
      return settled.success as McpCallResult;
    });

  const close = reloadSemaphore.withPermits(1)(
    Effect.gen(function* () {
      for (const connection of connections.values()) yield* closeConnection(connection);
      connections.clear();
      statuses.clear();
      yield* Ref.set(catalogRef, emptyCatalog);
      McpProviderSession.clearMcpToolCatalog();
    }),
  );

  const service: GlobalMcpManager["Service"] = {
    reload,
    reloadServer,
    getStatuses,
    getCatalog,
    callTool,
    streamChanges: Stream.fromPubSub(catalogChanges),
    streamStatusChanges: Stream.concat(
      Stream.fromEffect(getStatuses),
      Stream.fromPubSub(statusChanges),
    ),
    close,
  };

  yield* settings.streamChanges.pipe(Stream.runForEach(() => reload), Effect.forkScoped);
  yield* reload;
  yield* Effect.addFinalizer(() => close);
  return service;
});

export const layer = Layer.effect(GlobalMcpManager, make);
