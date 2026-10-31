import type { GlobalMcpServer, GlobalMcpStatus } from "@t3tools/contracts";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  ErrorCode,
  McpError,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import type * as McpInvocationContext from "./McpInvocationContext.ts";
import { RobloxStudioConfig } from "../roblox/RobloxStudioConfig.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  digestFingerprint,
  MCP_TOOL_CACHE_MAX_AGE_MS,
  McpToolCache,
  type CachedMcpTools,
  type UpstreamTool,
} from "./McpToolCache.ts";

/**
 * A server that never answers `initialize` must not hold the settings reload (and with it every
 * other configured server) hostage.
 */
const CONNECT_TIMEOUT = Duration.seconds(30);

/**
 * Studio playtests, uploads and Blender jobs run for minutes, past the SDK's one-minute default;
 * a server that reports progress keeps its call alive.
 */
const TOOL_CALL_TIMEOUT_MS = 15 * 60_000;

/** A server that died on its own is brought back on this schedule, then left in its error. */
const RECONNECT_BACKOFF = [
  Duration.seconds(1),
  Duration.seconds(3),
  Duration.seconds(10),
  Duration.seconds(30),
] as const;

/**
 * A stdio server that nobody has called for this long is stopped; its tools stay on offer from the
 * saved list and the next call starts it again. Long enough that a conversation waiting on the
 * user does not lose a server's session.
 */
const IDLE_STOP_AFTER_MS = 30 * 60_000;
const IDLE_CHECK_INTERVAL = Duration.minutes(1);

const KEPT_STDERR_LINES = 20;

/** Lets a server tell which Harp thread a call belongs to, so it can scope its skills and jobs. */
export const THREAD_SCOPE_META_KEY = "sealcode/threadId";

class GlobalMcpConnectionError extends Schema.TaggedError<GlobalMcpConnectionError>()(
  "GlobalMcpConnectionError",
  {
    serverId: Schema.String,
    cause: Schema.Defect(),
    output: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return `The MCP server ${this.serverId} is not responding.`;
  }
}

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
  readonly meta?: Readonly<Record<string, unknown>>;
};

export class GlobalMcpManager extends Context.Service<
  GlobalMcpManager,
  {
    /** Applies the configured servers, reconnecting only those whose configuration changed. */
    readonly reload: Effect.Effect<void>;
    /** Drops and re-establishes one server's connection, then reports every server's status. */
    readonly reconnectServer: (id: string) => Effect.Effect<ReadonlyArray<GlobalMcpStatus>>;
    readonly getStatuses: Effect.Effect<ReadonlyArray<GlobalMcpStatus>>;
    readonly getCatalog: Effect.Effect<McpToolCatalog>;
    readonly callTool: (input: McpInvocation) => Effect.Effect<McpCallResult>;
    /** A call Harp itself makes, such as reading a managed server's status. */
    readonly callServerTool: (input: {
      readonly serverId: string;
      readonly toolName: string;
      readonly arguments: Record<string, unknown>;
    }) => Effect.Effect<McpCallResult>;
    readonly streamChanges: Stream.Stream<McpToolCatalog>;
    /** Starts with the current statuses, then emits whenever any server's status changes. */
    readonly streamStatusChanges: Stream.Stream<ReadonlyArray<GlobalMcpStatus>>;
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

const errorMessage = (cause: unknown, output?: string): string => {
  const base =
    cause instanceof Error && cause.message.trim().length > 0
      ? cause.message.slice(0, 500)
      : "MCP connection failed.";
  return output === undefined || output.length === 0
    ? base
    : `${base} Last output: ${output.slice(-500)}`;
};

/**
 * A request timeout or a protocol-level refusal says nothing about whether the connection is
 * alive, so only a dead transport flips the server's status to an error.
 */
const isConnectionFailure = (cause: unknown): boolean =>
  !(cause instanceof McpError) || cause.code === ErrorCode.ConnectionClosed;

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

/** Carries what the process printed out of the promise, beside why it failed. */
class ConnectAttemptError {
  readonly cause: unknown;
  readonly output: string;
  constructor(cause: unknown, output: string) {
    this.cause = cause;
    this.output = output;
  }
}

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
  /** Undefined while the server is stopped but its saved tools are on offer. */
  readonly client: Client | undefined;
  readonly tools: ReadonlyArray<UpstreamTool>;
  /** The process's recent stderr, which is the only account of why a stdio server died. */
  readonly output: () => string;
};

type ConnectionEvents = {
  /** The transport closed without Harp closing it. */
  readonly onClosed: (serverId: string, client: Client) => void;
  readonly onToolsChanged: (serverId: string, client: Client) => void;
};

/** Clients Harp is closing on purpose, whose close is not a crash to recover from. */
const closingClients = new WeakSet<Client>();

type RunningConnection = UpstreamConnection & { readonly client: Client };

const isRunning = (connection: UpstreamConnection): connection is RunningConnection =>
  connection.client !== undefined;

/** Only a stdio server costs a process to keep; a remote one is a socket. */
const startsOnDemand = (server: GlobalMcpServer): boolean => server.transport === "stdio";

const toolsDiffer = (left: ReadonlyArray<UpstreamTool>, right: ReadonlyArray<UpstreamTool>) =>
  left.length !== right.length ||
  left.some(
    (tool, index) => stableMcpValueFingerprint(tool) !== stableMcpValueFingerprint(right[index]),
  );

const closeConnection = (connection: UpstreamConnection): Effect.Effect<void> => {
  const client = connection.client;
  if (client === undefined) return Effect.void;
  return Effect.promise(() => {
    closingClients.add(client);
    return client.close().catch(() => undefined);
  });
};

const recentOutput = (transport: McpTransport) => {
  const lines: string[] = [];
  if (transport instanceof StdioClientTransport) {
    // Piped stderr must be drained, or a chatty server blocks on a full pipe.
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length > 0) lines.push(trimmed.slice(0, 500));
      }
      if (lines.length > KEPT_STDERR_LINES) lines.splice(0, lines.length - KEPT_STDERR_LINES);
    });
  }
  return () => lines.slice(-3).join(" | ");
};

const discoverTools = async (
  client: Client,
  signal: AbortSignal,
): Promise<ReadonlyArray<UpstreamTool>> => {
  const discovered: UpstreamTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { signal });
    discovered.push(...(page.tools as ReadonlyArray<UpstreamTool>));
    cursor =
      typeof page.nextCursor === "string" && page.nextCursor.length > 0
        ? page.nextCursor
        : undefined;
  } while (cursor !== undefined);
  return discovered;
};

const connect = (
  server: GlobalMcpServer,
  events: ConnectionEvents,
): Effect.Effect<RunningConnection, GlobalMcpConnectionError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const transport = createTransport(server);
      const output = recentOutput(transport);
      const client = new McpClient(
        { name: "Harp Global MCP", version: "1.0.0" },
        { capabilities: {} },
      );
      try {
        await client.connect(transport as Parameters<Client["connect"]>[0], { signal });
        const tools = await discoverTools(client, signal);
        client.onclose = () => {
          if (!closingClients.has(client)) events.onClosed(server.id, client);
        };
        client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
          events.onToolsChanged(server.id, client);
        });
        return {
          fingerprint: serverFingerprint(server),
          server,
          client,
          tools,
          output,
        } satisfies RunningConnection;
      } catch (cause) {
        closingClients.add(client);
        await client.close().catch(() => undefined);
        throw new ConnectAttemptError(cause, output());
      }
    },
    catch: (cause) =>
      cause instanceof ConnectAttemptError
        ? new GlobalMcpConnectionError({
            serverId: server.id,
            cause: cause.cause,
            output: cause.output,
          })
        : new GlobalMcpConnectionError({ serverId: server.id, cause }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: CONNECT_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new GlobalMcpConnectionError({
            serverId: server.id,
            cause: new Error(
              `MCP server did not respond within ${Duration.toSeconds(CONNECT_TIMEOUT)} seconds.`,
            ),
          }),
        ),
    }),
  );

const make = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const roblox = yield* RobloxStudioConfig;
  const reloadSemaphore = yield* Semaphore.make(1);
  const catalogRef = yield* Ref.make<McpToolCatalog>(emptyCatalog);
  const catalogChanges = yield* PubSub.unbounded<McpToolCatalog>();
  const statusChanges = yield* PubSub.sliding<ReadonlyArray<GlobalMcpStatus>>(1);
  const toolCache = yield* McpToolCache;
  const connections = new Map<string, UpstreamConnection>();
  /** What each stdio server offered when it last ran, so a start need not run it to list tools. */
  const savedTools = new Map(yield* toolCache.load);
  const startLocks = new Map<string, Semaphore.Semaphore>();
  const activity = new Map<string, { inFlight: number; lastUsedAt: number }>();
  const statuses = new Map<string, GlobalMcpStatus>();
  const closedServers = yield* Queue.unbounded<{ readonly id: string; readonly client: Client }>();
  const changedTools = yield* Queue.unbounded<{ readonly id: string; readonly client: Client }>();
  const events: ConnectionEvents = {
    onClosed: (id, client) => void Queue.offerUnsafe(closedServers, { id, client }),
    onToolsChanged: (id, client) => void Queue.offerUnsafe(changedTools, { id, client }),
  };
  /** Consecutive automatic reconnects per server, reset by a connection that stays up. */
  const reconnectAttempts = new Map<string, number>();

  const startLockFor = (id: string) => {
    let lock = startLocks.get(id);
    if (lock === undefined) {
      lock = Semaphore.makeUnsafe(1);
      startLocks.set(id, lock);
    }
    return lock;
  };

  const touch = (id: string) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) => {
        activity.set(id, { inFlight: activity.get(id)?.inFlight ?? 0, lastUsedAt: now });
      }),
    );

  /** Counted before the server is looked up, so the idle check can never stop one a call needs. */
  const withCall = <A, E, R>(id: string, effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      const current = activity.get(id) ?? { inFlight: 0, lastUsedAt: 0 };
      activity.set(id, { ...current, inFlight: current.inFlight + 1 });
      return effect.pipe(
        Effect.ensuring(
          Clock.currentTimeMillis.pipe(
            Effect.map((now) => {
              const latest = activity.get(id) ?? { inFlight: 1, lastUsedAt: now };
              activity.set(id, { inFlight: latest.inFlight - 1, lastUsedAt: now });
            }),
          ),
        ),
      );
    });

  const rememberTools = (connection: UpstreamConnection) =>
    Effect.gen(function* () {
      if (!startsOnDemand(connection.server)) return;
      const discoveredAt = yield* Clock.currentTimeMillis;
      savedTools.set(connection.server.id, {
        fingerprint: digestFingerprint(connection.fingerprint),
        discoveredAt,
        tools: connection.tools,
      });
      yield* toolCache.save(savedTools);
    });

  const currentStatuses = (): ReadonlyArray<GlobalMcpStatus> =>
    [...statuses.values()].sort((left, right) => left.id.localeCompare(right.id));

  // Every settings change reloads, so statuses are published only when something a client can
  // see differs; the timestamp alone would make each reload look like news.
  let lastPublished = "";
  const publishStatuses = () =>
    Effect.suspend(() => {
      const next = currentStatuses();
      const fingerprint = next
        .map(({ id, state, toolCount, errorMessage }) =>
          [id, state, toolCount, errorMessage ?? ""].join("\u0000"),
        )
        .join("\u0001");
      if (fingerprint === lastPublished) return Effect.void;
      lastPublished = fingerprint;
      return PubSub.publish(statusChanges, next);
    });

  const setStatus = (
    server: GlobalMcpServer,
    state: GlobalMcpStatus["state"],
    toolCount: number,
    failure?: unknown,
    output?: string,
  ) => {
    statuses.set(server.id, {
      id: server.id,
      displayName: server.displayName,
      state,
      toolCount,
      ...(failure === undefined ? {} : { errorMessage: errorMessage(failure, output) }),
      updatedAt: DateTime.toEpochMillis(DateTime.nowUnsafe()),
    });
  };

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

      // Two servers (or one server's `a-b` and `a_b`) can normalize to the same name. Neither
      // wins: serving the wrong server's tool is worse than serving neither.
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
      const forgotten = [...savedTools.keys()].filter((id) => !configuredIds.has(id));
      if (forgotten.length > 0) {
        for (const id of forgotten) savedTools.delete(id);
        yield* toolCache.save(savedTools);
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

        // A stdio server whose tools are known stays stopped until something calls one of them.
        const saved = savedTools.get(server.id);
        const now = yield* Clock.currentTimeMillis;
        if (
          forcedServerId !== server.id &&
          startsOnDemand(server) &&
          saved !== undefined &&
          saved.fingerprint === digestFingerprint(serverFingerprint(server)) &&
          now - saved.discoveredAt >= 0 &&
          now - saved.discoveredAt < MCP_TOOL_CACHE_MAX_AGE_MS
        ) {
          connections.set(server.id, {
            fingerprint: serverFingerprint(server),
            server,
            client: undefined,
            tools: saved.tools,
            output: () => "",
          });
          setStatus(server, "ready", saved.tools.length);
          continue;
        }

        setStatus(server, "connecting", 0);
        yield* publishStatuses();
        const result = yield* Effect.result(connect(server, events));
        if (Result.isFailure(result)) {
          setStatus(server, "error", 0, result.failure.cause, result.failure.output);
          continue;
        }
        connections.set(server.id, result.success);
        setStatus(server, "ready", result.success.tools.length);
        yield* touch(server.id);
        yield* rememberTools(result.success);
      }

      yield* rebuildCatalog();
    });

  // The Roblox settings' servers join the user's own; a user server with the same id wins.
  const readConfigured = settings.getSettings.pipe(
    Effect.map((current): Readonly<Record<string, GlobalMcpServer>> => ({
      ...roblox.managedServers(current),
      ...current.mcpServers,
    })),
    Effect.catch((cause) =>
      Effect.logWarning("failed to read global MCP settings", { cause }).pipe(
        Effect.as({} as Readonly<Record<string, GlobalMcpServer>>),
      ),
    ),
  );

  const reload = reloadSemaphore.withPermits(1)(
    readConfigured.pipe(Effect.flatMap((configured) => reloadUnlocked(configured))),
  );

  const reconnectServer: GlobalMcpManager["Service"]["reconnectServer"] = (id) =>
    reloadSemaphore.withPermits(1)(
      readConfigured.pipe(
        Effect.flatMap((configured) => reloadUnlocked(configured, id)),
        Effect.map(currentStatuses),
      ),
    );

  const getStatuses: GlobalMcpManager["Service"]["getStatuses"] = Effect.sync(currentStatuses);

  const getCatalog = Ref.get(catalogRef);

  /**
   * The running connection for a server, starting it first when only its saved tools were on offer.
   * Undefined means the server is not configured; a failure is why it would not start.
   */
  const running = Effect.fn("GlobalMcpManager.running")(function* (id: string) {
    const known = connections.get(id);
    if (known === undefined) return undefined;
    if (isRunning(known)) return known;
    return yield* startLockFor(id).withPermits(1)(
      Effect.gen(function* () {
        const dormant = connections.get(id);
        if (dormant === undefined) return undefined;
        if (isRunning(dormant)) return dormant;
        setStatus(dormant.server, "connecting", dormant.tools.length);
        yield* publishStatuses();
        const result = yield* Effect.result(connect(dormant.server, events));
        if (Result.isFailure(result)) {
          setStatus(
            dormant.server,
            "error",
            dormant.tools.length,
            result.failure.cause,
            result.failure.output,
          );
          yield* publishStatuses();
          return yield* result.failure;
        }
        const opened = result.success;
        const latest = connections.get(id);
        // The configuration changed, or a reconnect won, while this one was starting.
        if (latest === undefined || latest.fingerprint !== opened.fingerprint) {
          yield* closeConnection(opened);
          return undefined;
        }
        if (isRunning(latest)) {
          yield* closeConnection(opened);
          return latest;
        }
        connections.set(id, opened);
        setStatus(opened.server, "ready", opened.tools.length);
        yield* touch(id);
        if (toolsDiffer(dormant.tools, opened.tools)) {
          yield* rememberTools(opened);
          yield* rebuildCatalog();
        } else {
          yield* publishStatuses();
        }
        return opened;
      }),
    );
  });

  const notStarted = (error: GlobalMcpConnectionError) =>
    ({
      isError: true,
      content: [{ type: "text", text: errorMessage(error.cause, error.output) }],
      structuredContent: { error: { message: errorMessage(error.cause, error.output) } },
    }) satisfies McpCallResult;

  const callTool: GlobalMcpManager["Service"]["callTool"] = (input) =>
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({
        "mcp.thread_id": input.scope.thread?.threadId ?? "",
        "mcp.provider_session_id": input.scope.thread?.providerSessionId ?? "",
        "mcp.provider_instance_id": input.scope.thread?.providerInstanceId ?? "",
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
      return yield* withCall(
        entry.serverId,
        Effect.gen(function* () {
          const started = yield* Effect.result(running(entry.serverId));
          if (Result.isFailure(started)) return notStarted(started.failure);
          const connection = started.success;
          if (!connection) {
            return {
              isError: true,
              content: [{ type: "text", text: "MCP server is not connected." }],
            } satisfies McpCallResult;
          }
          const threadId = input.scope.thread?.threadId;
          const settled = yield* Effect.tryPromise({
            try: (signal) =>
              connection.client.callTool(
                {
                  name: entry.upstreamToolName,
                  arguments: input.arguments,
                  ...(threadId === undefined && input.meta === undefined
                    ? {}
                    : {
                        _meta: {
                          ...input.meta,
                          ...(threadId === undefined ? {} : { [THREAD_SCOPE_META_KEY]: threadId }),
                        },
                      }),
                },
                undefined,
                { signal, timeout: TOOL_CALL_TIMEOUT_MS, resetTimeoutOnProgress: true },
              ),
            catch: (cause) => new GlobalMcpConnectionError({ serverId: entry.serverId, cause }),
          }).pipe(Effect.result);
          if (Result.isFailure(settled)) {
            const failure = settled.failure.cause;
            const message = errorMessage(failure);
            if (isConnectionFailure(failure)) {
              setStatus(
                connection.server,
                "error",
                connection.tools.length,
                failure,
                connection.output(),
              );
              yield* publishStatuses();
            }
            return {
              isError: true,
              content: [{ type: "text", text: message }],
              structuredContent: { error: { message } },
            } satisfies McpCallResult;
          }
          return settled.success as McpCallResult;
        }),
      );
    });

  const callServerTool: GlobalMcpManager["Service"]["callServerTool"] = (input) =>
    withCall(
      input.serverId,
      Effect.gen(function* () {
        const started = yield* Effect.result(running(input.serverId));
        if (Result.isFailure(started)) return notStarted(started.failure);
        const connection = started.success;
        if (!connection) {
          return {
            isError: true,
            content: [{ type: "text", text: "MCP server is not connected." }],
          } satisfies McpCallResult;
        }
        const settled = yield* Effect.tryPromise({
          try: (signal) =>
            connection.client.callTool(
              { name: input.toolName, arguments: input.arguments },
              undefined,
              { signal, timeout: 15_000 },
            ),
          catch: (cause) => new GlobalMcpConnectionError({ serverId: input.serverId, cause }),
        }).pipe(Effect.result);
        if (Result.isFailure(settled)) {
          return {
            isError: true,
            content: [{ type: "text", text: errorMessage(settled.failure.cause) }],
          } satisfies McpCallResult;
        }
        return settled.success as McpCallResult;
      }),
    );

  /**
   * A server whose process exited, or whose remote connection dropped, leaves the catalog at once
   * and comes back with backoff, as when a Studio bridge restarts. Reconnect still works at any
   * point, and a configuration that changed meanwhile wins.
   */
  const recoverClosed = (closed: { readonly id: string; readonly client: Client }) =>
    Effect.gen(function* () {
      const lost = yield* reloadSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const connection = connections.get(closed.id);
          if (connection === undefined || connection.client !== closed.client) return false;
          connections.delete(closed.id);
          setStatus(
            connection.server,
            "error",
            0,
            new Error("The MCP server stopped."),
            connection.output(),
          );
          yield* rebuildCatalog();
          return true;
        }),
      );
      if (!lost) return;
      const attempt = reconnectAttempts.get(closed.id) ?? 0;
      const delay = RECONNECT_BACKOFF[attempt];
      if (delay === undefined) return;
      reconnectAttempts.set(closed.id, attempt + 1);
      yield* Effect.sleep(delay);
      yield* reloadSemaphore.withPermits(1)(
        Effect.gen(function* () {
          if (connections.has(closed.id)) return;
          const configured = yield* readConfigured;
          yield* reloadUnlocked(configured, closed.id);
        }),
      );
      // A connection that lasts a minute earns a fresh backoff budget.
      const recovered = connections.get(closed.id)?.client;
      if (recovered === undefined) return;
      yield* Effect.sleep(Duration.minutes(1));
      if (connections.get(closed.id)?.client === recovered) reconnectAttempts.delete(closed.id);
    });

  const refreshTools = (changed: { readonly id: string; readonly client: Client }) =>
    reloadSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const connection = connections.get(changed.id);
        if (
          connection === undefined ||
          !isRunning(connection) ||
          connection.client !== changed.client
        )
          return;
        const tools = yield* Effect.tryPromise({
          try: (signal) => discoverTools(connection.client, signal),
          catch: (cause) => new GlobalMcpConnectionError({ serverId: changed.id, cause }),
        }).pipe(Effect.option);
        if (tools._tag === "None") return;
        const refreshed = { ...connection, tools: tools.value };
        connections.set(changed.id, refreshed);
        setStatus(connection.server, "ready", tools.value.length);
        yield* rememberTools(refreshed);
        yield* rebuildCatalog();
      }),
    );

  yield* Queue.take(closedServers).pipe(
    Effect.flatMap((closed) => Effect.forkScoped(recoverClosed(closed))),
    Effect.forever,
    Effect.forkScoped,
  );
  yield* Queue.take(changedTools).pipe(
    Effect.flatMap(refreshTools),
    Effect.forever,
    Effect.forkScoped,
  );

  const stopIdle = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const [id, connection] of [...connections]) {
      if (!isRunning(connection) || !startsOnDemand(connection.server)) continue;
      const used = activity.get(id);
      if (used === undefined || used.inFlight > 0 || now - used.lastUsedAt < IDLE_STOP_AFTER_MS) {
        continue;
      }
      yield* startLockFor(id).withPermits(1)(
        Effect.gen(function* () {
          const current = connections.get(id);
          const latest = activity.get(id);
          if (
            current === undefined ||
            !isRunning(current) ||
            current.client !== connection.client ||
            (latest?.inFlight ?? 0) > 0
          ) {
            return;
          }
          // Dormant first, so a call arriving now waits on this lock and starts a fresh server.
          connections.set(id, { ...current, client: undefined });
          yield* closeConnection(current);
        }),
      );
    }
  });
  yield* stopIdle.pipe(
    Effect.andThen(Effect.sleep(IDLE_CHECK_INTERVAL)),
    Effect.forever,
    Effect.forkScoped,
  );

  const closeAll = reloadSemaphore.withPermits(1)(
    Effect.gen(function* () {
      for (const connection of connections.values()) yield* closeConnection(connection);
      connections.clear();
      statuses.clear();
      yield* Ref.set(catalogRef, emptyCatalog);
    }),
  );

  // Subscribed before the first load so a settings change made while servers are connecting
  // still triggers a reload afterwards.
  const settingsChanges = yield* settings.subscribeChanges;
  yield* settingsChanges.pipe(
    Stream.runForEach(() => reload),
    Effect.forkScoped,
  );
  // Server startup does not wait for every configured server to answer.
  yield* Effect.forkScoped(reload);
  yield* Effect.addFinalizer(() => closeAll);

  return GlobalMcpManager.of({
    reload,
    reconnectServer,
    getStatuses,
    getCatalog,
    callTool,
    callServerTool,
    streamChanges: Stream.fromPubSub(catalogChanges),
    streamStatusChanges: Stream.unwrap(
      PubSub.subscribe(statusChanges).pipe(
        Effect.map((subscription) =>
          Stream.concat(Stream.fromEffect(getStatuses), Stream.fromSubscription(subscription)),
        ),
      ),
    ),
  });
});

export const layer = Layer.effect(GlobalMcpManager, make);
