import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import packageJson from "../../package.json" with { type: "json" };
import {
  KNOWN_CAPABILITIES,
  STUDIO_EVENT_TYPES,
  STUDIO_PROTOCOL_VERSION,
  StudioLimits,
  type StudioCapability,
  type StudioEventType,
  type StudioRole,
} from "./protocol.ts";
import {
  peersOfPlace,
  resolveTarget,
  summarizePeers,
  type RoutablePeer,
  type RoutingErrorCode,
} from "./StudioRouter.ts";

export const STUDIO_BRIDGE_BUILD = packageJson.version;

export class StudioHelloRejected extends Schema.TaggedError<StudioHelloRejected>()(
  "StudioHelloRejected",
  {
    status: Schema.Number,
    code: Schema.Literals([
      "missing_fields",
      "protocol_mismatch",
      "invalid_role",
      "duplicate_instance_role",
    ]),
    fields: Schema.optional(Schema.Array(Schema.String)),
    expectedProtocol: Schema.optional(Schema.Number),
    actualProtocol: Schema.optional(Schema.Number),
  },
) {
  override get message(): string {
    switch (this.code) {
      case "missing_fields":
        return `The plugin's hello is missing ${(this.fields ?? []).join(", ")}.`;
      case "protocol_mismatch":
        return `The Studio plugin speaks protocol ${String(this.actualProtocol)} but SealCode expects ${String(this.expectedProtocol)}. Restart Studio to load the updated plugin.`;
      case "invalid_role":
        return "The plugin announced a role the bridge does not accept.";
      case "duplicate_instance_role":
        return "Another Studio window is already linked for this place.";
    }
  }
}

export class StudioSessionUnknown extends Schema.TaggedError<StudioSessionUnknown>()(
  "StudioSessionUnknown",
  {},
) {
  override get message(): string {
    return "This Studio session is not registered with the bridge; send hello again.";
  }
}

export class StudioRoutingError extends Schema.TaggedError<StudioRoutingError>()(
  "StudioRoutingError",
  {
    code: Schema.String,
    detail: Schema.String,
    instances: Schema.Array(Schema.Unknown),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export class StudioRequestTimeout extends Schema.TaggedError<StudioRequestTimeout>()(
  "StudioRequestTimeout",
  {
    endpoint: Schema.String,
    delivered: Schema.Boolean,
    timeoutMs: Schema.Number,
  },
) {
  override get message(): string {
    return this.delivered
      ? `Studio took the request but did not answer within ${String(Math.round(this.timeoutMs / 1000))} s. It may have been applied: read the target back before repeating a write.`
      : `Studio did not pick up the request within ${String(Math.round(this.timeoutMs / 1000))} s, so nothing ran. It is safe to retry.`;
  }
}

export class StudioPeerDisconnected extends Schema.TaggedError<StudioPeerDisconnected>()(
  "StudioPeerDisconnected",
  {
    endpoint: Schema.String,
    delivered: Schema.Boolean,
    role: Schema.String,
  },
) {
  override get message(): string {
    return this.delivered
      ? `The Studio ${this.role} peer disconnected after taking the request; it may have been applied. Read the target back before repeating a write.`
      : `The Studio ${this.role} peer disconnected before the request ran.`;
  }
}

export type StudioRequestError = StudioRoutingError | StudioRequestTimeout | StudioPeerDisconnected;

export interface StudioToggles {
  readonly paused: boolean;
  readonly readOnly: boolean;
  readonly allowLuau: boolean;
}

export interface StudioHelloInput {
  readonly protocol: number;
  readonly build: string;
  readonly pluginSessionId: string;
  readonly instanceId: string;
  readonly role: string;
  readonly placeId: number;
  readonly gameId: number;
  readonly placeName: string;
  readonly dataModelName: string;
  readonly isRunning: boolean;
  readonly studioVersion: string;
  readonly pluginHash: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly toggles: StudioToggles;
}

export interface StudioPeer extends RoutablePeer {
  readonly pluginSessionId: string;
  readonly gameId: number;
  readonly dataModelName: string;
  readonly build: string;
  readonly studioVersion: string;
  readonly pluginHash: string;
  readonly capabilities: ReadonlyArray<StudioCapability>;
  readonly toggles: StudioToggles;
  readonly connectedAt: number;
  readonly lastSeenAt: number;
}

export interface StudioRequestMeta {
  readonly tool: string;
  readonly summary?: string | undefined;
  readonly threadId?: string | undefined;
}

export type DownstreamMessage =
  | {
      readonly kind: "request";
      readonly requestId: string;
      readonly endpoint: string;
      readonly data: unknown;
      readonly meta: StudioRequestMeta;
    }
  | { readonly kind: "status"; readonly status: unknown }
  | {
      readonly kind: "notify";
      readonly level: "info" | "warning" | "error";
      readonly title: string;
      readonly body?: string;
    };

export interface StudioEvent {
  readonly type: StudioEventType;
  readonly instanceId: string;
  readonly role: StudioRole;
  readonly placeName: string;
  readonly at: number;
  /** Text inside comes from the place and is data, never instructions. */
  readonly payload: Record<string, unknown>;
}

export interface StudioActivity {
  readonly requestId: string;
  readonly tool: string;
  readonly endpoint: string;
  readonly instanceId: string;
  readonly role: string;
  readonly startedAt: number;
  readonly durationMs?: number;
  readonly outcome: "pending" | "ok" | "error" | "timeout" | "disconnected";
}

export interface StudioLifecycle {
  readonly state: "stopped" | "starting" | "running" | "failed";
  readonly port?: number;
  readonly error?: string;
  readonly pluginPath?: string;
  /** Hash of the plugin code SealCode installed this run. */
  readonly pluginHash?: string;
  /** The installed plugin file was replaced this run: Studios already open run the old copy. */
  readonly pluginUpdated: boolean;
  readonly pluginProblem?: string;
}

export interface StudioBridgeSnapshot {
  readonly build: string;
  readonly protocol: number;
  readonly lifecycle: StudioLifecycle;
  readonly peers: ReadonlyArray<StudioPeer>;
  readonly pendingRequests: number;
  readonly agentLinked: boolean;
  /** The plugin changed this run and some Studio has not loaded the new copy yet. */
  readonly pluginReloadNeeded: boolean;
  readonly lastRejection?: string;
  readonly recentActivity: ReadonlyArray<StudioActivity>;
}

interface Session {
  peer: StudioPeer;
  readonly token: string;
  waiter: Deferred.Deferred<void> | undefined;
  pollGeneration: number;
  readonly outbox: DownstreamMessage[];
  lastStatus: string;
  readonly claimed: Set<string>;
}

interface Pending {
  readonly id: string;
  instanceId: string;
  readonly role: StudioRole;
  readonly endpoint: string;
  readonly data: unknown;
  readonly meta: StudioRequestMeta;
  readonly deferred: Deferred.Deferred<unknown, StudioPeerDisconnected>;
  claimedBy: string | undefined;
  delivered: boolean;
}

const MAX_ACTIVITY = 50;
const AGENT_ACTIVE_MS = 90_000;

const sanitizeToggles = (value: unknown): StudioToggles => {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    paused: record.paused === true,
    readOnly: record.readOnly === true,
    allowLuau: record.allowLuau !== false,
  };
};

const togglesKey = (toggles: StudioToggles): string =>
  `${String(toggles.paused)}/${String(toggles.readOnly)}/${String(toggles.allowLuau)}`;

const statusKey = (status: {
  readonly agentLinked: boolean;
  readonly agentActive: boolean;
  readonly pluginUpdated: boolean;
  readonly pluginOutdated: boolean;
  readonly peers: ReadonlyArray<{ readonly role: string; readonly isRunning: boolean }>;
}): string =>
  [
    status.agentLinked,
    status.agentActive,
    status.pluginUpdated,
    status.pluginOutdated,
    ...status.peers.map((peer) => `${peer.role}:${String(peer.isRunning)}`),
  ].join("|");

export class StudioBridge extends Context.Service<
  StudioBridge,
  {
    readonly hello: (input: StudioHelloInput) => Effect.Effect<
      {
        readonly sessionToken: string;
        readonly assignedRole: StudioRole;
        readonly instanceId: string;
        readonly serverBuild: string;
        readonly protocol: number;
      },
      StudioHelloRejected
    >;
    /** Answers with pending work at once, or waits up to `waitSeconds` for some. */
    readonly poll: (input: {
      readonly sessionToken: string;
      /** Requests the plugin holds: claimed requests missing here were lost in transit. */
      readonly inFlight: ReadonlyArray<string>;
      readonly waitSeconds: number;
      readonly toggles?: unknown;
    }) => Effect.Effect<ReadonlyArray<DownstreamMessage>, StudioSessionUnknown>;
    readonly respond: (input: {
      readonly requestId: string;
      readonly payload: unknown;
    }) => Effect.Effect<"accepted" | "already_settled" | "unknown">;
    readonly postEvents: (input: {
      readonly sessionToken: string;
      readonly events: ReadonlyArray<unknown>;
    }) => Effect.Effect<number, StudioSessionUnknown>;
    readonly bye: (sessionToken: string) => Effect.Effect<void>;
    /** Sends one endpoint call to the peer the routing picks and waits for its answer. */
    readonly request: (input: {
      readonly instanceId?: string | undefined;
      readonly target?: string | undefined;
      readonly defaultRole?: StudioRole | undefined;
      readonly endpoint: string;
      readonly data: unknown;
      readonly timeoutMs?: number | undefined;
      readonly meta: StudioRequestMeta;
    }) => Effect.Effect<
      { readonly payload: unknown; readonly peer: StudioPeer },
      StudioRequestError
    >;
    readonly peers: Effect.Effect<ReadonlyArray<StudioPeer>>;
    /** Peers of one place, through aliases and the numeric place id. */
    readonly peersOf: (instanceId: string) => Effect.Effect<ReadonlyArray<StudioPeer>>;
    readonly resolve: (input: {
      readonly instanceId?: string | undefined;
      readonly target?: string | undefined;
      readonly defaultRole?: StudioRole | undefined;
    }) => Effect.Effect<StudioPeer, StudioRoutingError>;
    readonly notify: (input: {
      readonly instanceId: string;
      readonly level: "info" | "warning" | "error";
      readonly title: string;
      readonly body?: string;
    }) => Effect.Effect<void>;
    /** The MCP endpoint saw SealCode's tool gateway. */
    readonly markAgentLinked: Effect.Effect<void>;
    readonly setLifecycle: (lifecycle: StudioLifecycle) => Effect.Effect<void>;
    /** Drops every session, as when the listener stops. */
    readonly reset: Effect.Effect<void>;
    readonly snapshot: Effect.Effect<StudioBridgeSnapshot>;
    readonly events: Stream.Stream<StudioEvent>;
    /** Emits whenever peers, lifecycle or activity change. */
    readonly changes: Stream.Stream<void>;
  }
>()("t3/studioBridge/StudioBridge") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const sessions = new Map<string, Session>();
  const byToken = new Map<string, Session>();
  const pending = new Map<string, Pending>();
  const tombstones = new Map<string, number>();
  const aliases = new Map<string, { readonly to: string; at: number }>();
  const activity: StudioActivity[] = [];
  let lifecycle: StudioLifecycle = { state: "stopped", pluginUpdated: false };
  let agentLinked = false;
  let lastToolAt = 0;
  let lastRejection: string | undefined;
  const eventsHub = yield* PubSub.sliding<StudioEvent>(256);
  const changesHub = yield* PubSub.sliding<void>(16);

  const randomId = crypto.randomUUIDv4().pipe(Effect.orDie);
  const randomToken = crypto.randomBytes(24).pipe(
    Effect.orDie,
    Effect.map((bytes) => Buffer.from(bytes).toString("base64url")),
  );
  const changed = PubSub.publish(changesHub, undefined).pipe(Effect.asVoid);

  const resolveAlias = (id: string): string => {
    let current = id;
    for (let hops = 0; hops < 8; hops += 1) {
      const next = aliases.get(current);
      if (next === undefined) return current;
      current = next.to;
    }
    return current;
  };

  const allPeers = (): StudioPeer[] => [...sessions.values()].map((session) => session.peer);

  const servesPending = (session: Session, request: Pending): boolean =>
    session.peer.role === request.role &&
    peersOfPlace([session.peer], request.instanceId, resolveAlias).length > 0;

  const wake = (session: Session) =>
    session.waiter === undefined
      ? Effect.void
      : Deferred.succeed(session.waiter, undefined).pipe(Effect.asVoid);

  const recordActivity = (entry: StudioActivity) => {
    const index = activity.findIndex((item) => item.requestId === entry.requestId);
    if (index >= 0) activity[index] = entry;
    else {
      activity.unshift(entry);
      if (activity.length > MAX_ACTIVITY) activity.length = MAX_ACTIVITY;
    }
  };

  const remember = (requestId: string, now: number) => {
    tombstones.set(requestId, now);
    if (tombstones.size > StudioLimits.maxTombstones) {
      const oldest = tombstones.keys().next().value;
      if (oldest !== undefined) tombstones.delete(oldest);
    }
  };

  /** Removes a session; requests it held or that nobody else can serve fail. */
  const dropSession = (session: Session) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("Studio peer disconnected", {
        role: session.peer.role,
        instanceId: session.peer.instanceId,
      });
      sessions.delete(session.peer.pluginSessionId);
      byToken.delete(session.token);
      if (session.waiter !== undefined) yield* Deferred.succeed(session.waiter, undefined);
      const remaining = [...sessions.values()];
      for (const request of [...pending.values()]) {
        const heldHere = request.claimedBy === session.peer.pluginSessionId;
        const servable = remaining.some((other) => servesPending(other, request));
        if (heldHere || !servable) {
          pending.delete(request.id);
          yield* Deferred.fail(
            request.deferred,
            new StudioPeerDisconnected({
              endpoint: request.endpoint,
              delivered: request.delivered && heldHere,
              role: request.role,
            }),
          );
        }
      }
      yield* refreshStatuses;
      yield* changed;
    });

  const statusFor = (session: Session, now: number) => ({
    serverBuild: STUDIO_BRIDGE_BUILD,
    protocol: STUDIO_PROTOCOL_VERSION,
    agentLinked,
    agentActive: now - lastToolAt < AGENT_ACTIVE_MS,
    pluginUpdated: lifecycle.pluginUpdated,
    // The file on disk is newer than the copy this Studio loaded: reopening the place fixes it.
    pluginOutdated:
      lifecycle.pluginHash !== undefined && session.peer.pluginHash !== lifecycle.pluginHash,
    peers: peersOfPlace(allPeers(), session.peer.instanceId, resolveAlias).map((peer) => ({
      role: peer.role,
      isRunning: peer.isRunning,
    })),
  });

  /** Queues a status message for every session whose status text changed. */
  const refreshStatuses = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const session of sessions.values()) {
      const status = statusFor(session, now);
      const text = statusKey(status);
      if (text === session.lastStatus) continue;
      session.lastStatus = text;
      const existing = session.outbox.findIndex((message) => message.kind === "status");
      if (existing >= 0) session.outbox.splice(existing, 1);
      session.outbox.push({ kind: "status", status });
      yield* wake(session);
    }
  });

  const hello: StudioBridge["Service"]["hello"] = (input) =>
    Effect.gen(function* () {
      const missing = (
        [
          ["pluginSessionId", input.pluginSessionId],
          ["instanceId", input.instanceId],
          ["role", input.role],
        ] as const
      )
        .filter(([, value]) => typeof value !== "string" || value.trim() === "")
        .map(([name]) => name);
      if (missing.length > 0) {
        return yield* new StudioHelloRejected({
          status: 400,
          code: "missing_fields",
          fields: missing,
        });
      }
      if (input.protocol !== STUDIO_PROTOCOL_VERSION) {
        lastRejection = `A Studio plugin with protocol ${String(input.protocol)} (build ${input.build}) was refused; this SealCode speaks protocol ${String(STUDIO_PROTOCOL_VERSION)}.`;
        yield* changed;
        return yield* new StudioHelloRejected({
          status: 426,
          code: "protocol_mismatch",
          expectedProtocol: STUDIO_PROTOCOL_VERSION,
          actualProtocol: input.protocol,
        });
      }
      // Client DataModels cannot make HTTP calls; they reach the bridge through the play server.
      if (input.role !== "edit" && input.role !== "server") {
        return yield* new StudioHelloRejected({ status: 400, code: "invalid_role" });
      }
      const role: StudioRole = input.role;
      const now = yield* Clock.currentTimeMillis;
      const instanceId = resolveAlias(input.instanceId.trim());

      for (const other of [...sessions.values()]) {
        if (other.peer.pluginSessionId === input.pluginSessionId) continue;
        if (other.peer.role !== role) continue;
        if (peersOfPlace([other.peer], instanceId, resolveAlias).length === 0) continue;
        const idle =
          other.waiter === undefined &&
          now - other.peer.lastSeenAt > StudioLimits.duplicateTakeoverMs;
        if (!idle) {
          return yield* new StudioHelloRejected({ status: 409, code: "duplicate_instance_role" });
        }
        yield* dropSession(other);
      }

      const capabilities = input.capabilities.filter((capability): capability is StudioCapability =>
        (KNOWN_CAPABILITIES as ReadonlyArray<string>).includes(capability),
      );
      const existing = sessions.get(input.pluginSessionId);
      const peer: StudioPeer = {
        pluginSessionId: input.pluginSessionId,
        instanceId,
        role,
        placeId: Number.isFinite(input.placeId) ? input.placeId : 0,
        gameId: Number.isFinite(input.gameId) ? input.gameId : 0,
        placeName: input.placeName.slice(0, 200),
        dataModelName: input.dataModelName.slice(0, 200),
        isRunning: input.isRunning,
        build: input.build.slice(0, 64),
        studioVersion: input.studioVersion.slice(0, 64),
        pluginHash: input.pluginHash.slice(0, 64),
        capabilities,
        toggles: sanitizeToggles(input.toggles),
        connectedAt: existing?.peer.connectedAt ?? now,
        lastSeenAt: now,
      };

      if (existing !== undefined) {
        const previousId = existing.peer.instanceId;
        existing.peer = peer;
        if (previousId !== instanceId) {
          // Publishing turns `anon:` into `place:`; calls naming the old id keep working.
          aliases.set(previousId, { to: instanceId, at: now });
          for (const request of pending.values()) {
            if (request.instanceId === previousId) request.instanceId = instanceId;
          }
        }
        yield* refreshStatuses;
        yield* changed;
        return {
          sessionToken: existing.token,
          assignedRole: role,
          instanceId,
          serverBuild: STUDIO_BRIDGE_BUILD,
          protocol: STUDIO_PROTOCOL_VERSION,
        };
      }

      const session: Session = {
        peer,
        token: yield* randomToken,
        waiter: undefined,
        pollGeneration: 0,
        outbox: [],
        lastStatus: "",
        claimed: new Set(),
      };
      sessions.set(peer.pluginSessionId, session);
      byToken.set(session.token, session);
      yield* Effect.logInfo("Studio peer connected", {
        role,
        instanceId,
        build: peer.build,
        studioVersion: peer.studioVersion,
      });
      yield* refreshStatuses;
      yield* changed;
      return {
        sessionToken: session.token,
        assignedRole: role,
        instanceId,
        serverBuild: STUDIO_BRIDGE_BUILD,
        protocol: STUDIO_PROTOCOL_VERSION,
      };
    });

  const collect = (session: Session): DownstreamMessage[] => {
    const messages = session.outbox.splice(0, session.outbox.length);
    for (const request of pending.values()) {
      if (messages.length >= StudioLimits.maxRequestsPerPoll) break;
      if (request.claimedBy !== undefined || !servesPending(session, request)) continue;
      request.claimedBy = session.peer.pluginSessionId;
      request.delivered = true;
      session.claimed.add(request.id);
      messages.push({
        kind: "request",
        requestId: request.id,
        endpoint: request.endpoint,
        data: request.data,
        meta: request.meta,
      });
    }
    return messages;
  };

  const touch = (session: Session, now: number, toggles?: unknown) => {
    session.peer = {
      ...session.peer,
      lastSeenAt: now,
      ...(toggles === undefined ? {} : { toggles: sanitizeToggles(toggles) }),
    };
  };

  const poll: StudioBridge["Service"]["poll"] = (input) =>
    Effect.gen(function* () {
      const session = byToken.get(input.sessionToken);
      if (session === undefined) return yield* new StudioSessionUnknown();
      const now = yield* Clock.currentTimeMillis;
      const togglesBefore = togglesKey(session.peer.toggles);
      touch(session, now, input.toggles);
      if (togglesKey(session.peer.toggles) !== togglesBefore) yield* changed;

      const held = new Set(input.inFlight);
      for (const id of [...session.claimed]) {
        const request = pending.get(id);
        if (request === undefined) session.claimed.delete(id);
        else if (!held.has(id)) {
          request.claimedBy = undefined;
          request.delivered = false;
          session.claimed.delete(id);
        }
      }

      const ready = collect(session);
      if (ready.length > 0) return ready;

      // A newer poll from the same plugin replaces this one, which then answers empty so a
      // dead connection never swallows requests.
      if (session.waiter !== undefined) yield* Deferred.succeed(session.waiter, undefined);
      const waiter = yield* Deferred.make<void>();
      session.waiter = waiter;
      session.pollGeneration += 1;
      const generation = session.pollGeneration;
      const wait = Math.min(Math.max(input.waitSeconds, 0), StudioLimits.pollWaitSeconds);
      yield* Deferred.await(waiter).pipe(Effect.timeoutOption(Duration.seconds(wait)));
      if (session.pollGeneration !== generation || byToken.get(input.sessionToken) !== session) {
        return [];
      }
      session.waiter = undefined;
      touch(session, yield* Clock.currentTimeMillis);
      return collect(session);
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          const session = byToken.get(input.sessionToken);
          if (session !== undefined) session.waiter = undefined;
        }),
      ),
    );

  const respond: StudioBridge["Service"]["respond"] = (input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const request = pending.get(input.requestId);
      if (request === undefined) {
        return tombstones.has(input.requestId) ? "already_settled" : "unknown";
      }
      pending.delete(request.id);
      remember(request.id, now);
      for (const session of sessions.values()) session.claimed.delete(request.id);
      yield* Deferred.succeed(request.deferred, input.payload);
      return "accepted";
    });

  const postEvents: StudioBridge["Service"]["postEvents"] = (input) =>
    Effect.gen(function* () {
      const session = byToken.get(input.sessionToken);
      if (session === undefined) return yield* new StudioSessionUnknown();
      const now = yield* Clock.currentTimeMillis;
      touch(session, now);
      let accepted = 0;
      for (const raw of input.events.slice(0, StudioLimits.maxEventsPerBatch)) {
        if (typeof raw !== "object" || raw === null) continue;
        const { type, ...rest } = raw as Record<string, unknown>;
        if (!(STUDIO_EVENT_TYPES as ReadonlyArray<unknown>).includes(type)) continue;
        yield* PubSub.publish(eventsHub, {
          type: type as StudioEventType,
          instanceId: session.peer.instanceId,
          role: session.peer.role,
          placeName: session.peer.placeName,
          at: now,
          payload: rest,
        });
        accepted += 1;
      }
      return accepted;
    });

  const bye: StudioBridge["Service"]["bye"] = (token) =>
    Effect.gen(function* () {
      const session = byToken.get(token);
      if (session !== undefined) yield* dropSession(session);
    });

  const resolve: StudioBridge["Service"]["resolve"] = (input) =>
    Effect.gen(function* () {
      const peers = allPeers();
      const route = resolveTarget({ peers, resolveAlias, ...input });
      if (route._tag === "RoutingFailed") {
        return yield* new StudioRoutingError({
          code: route.code satisfies RoutingErrorCode,
          detail: route.message,
          instances: [...route.instances],
        });
      }
      const peer = peers.find(
        (candidate) => candidate.instanceId === route.instanceId && candidate.role === route.role,
      );
      if (peer === undefined) {
        return yield* new StudioRoutingError({
          code: "no_studio_connected",
          detail: "The Studio peer went away while the call was routed.",
          instances: [...summarizePeers(peers)],
        });
      }
      return peer;
    });

  const request: StudioBridge["Service"]["request"] = (input) =>
    Effect.gen(function* () {
      const peer = yield* resolve(input);
      const id = yield* randomId;
      const startedAt = yield* Clock.currentTimeMillis;
      const timeoutMs = Math.min(
        Math.max(input.timeoutMs ?? StudioLimits.defaultRequestTimeoutMs, 1000),
        StudioLimits.maxRequestTimeoutMs,
      );
      const deferred = yield* Deferred.make<unknown, StudioPeerDisconnected>();
      const entry: Pending = {
        id,
        instanceId: peer.instanceId,
        role: peer.role,
        endpoint: input.endpoint,
        data: input.data,
        meta: input.meta,
        deferred,
        claimedBy: undefined,
        delivered: false,
      };
      pending.set(id, entry);
      lastToolAt = startedAt;
      recordActivity({
        requestId: id,
        tool: input.meta.tool,
        endpoint: input.endpoint,
        instanceId: peer.instanceId,
        role: peer.role,
        startedAt,
        outcome: "pending",
      });
      yield* refreshStatuses;
      for (const session of sessions.values()) {
        if (servesPending(session, entry)) yield* wake(session);
      }
      yield* changed;

      const finish = (outcome: StudioActivity["outcome"]) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          lastToolAt = now;
          recordActivity({
            requestId: id,
            tool: input.meta.tool,
            endpoint: input.endpoint,
            instanceId: peer.instanceId,
            role: peer.role,
            startedAt,
            durationMs: now - startedAt,
            outcome,
          });
          yield* changed;
        });

      const outcome = yield* Deferred.await(deferred).pipe(
        Effect.timeoutOption(Duration.millis(timeoutMs)),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            pending.delete(id);
          }),
        ),
        Effect.tapError(() => finish("disconnected")),
      );
      if (Option.isNone(outcome)) {
        const current = pending.get(id);
        pending.delete(id);
        yield* finish("timeout");
        return yield* new StudioRequestTimeout({
          endpoint: input.endpoint,
          delivered: current?.delivered ?? true,
          timeoutMs,
        });
      }
      const payload = outcome.value;
      const failed =
        typeof payload === "object" &&
        payload !== null &&
        ("error" in payload || (payload as { success?: unknown }).success === false);
      yield* finish(failed ? "error" : "ok");
      return { payload, peer };
    });

  const sweep = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    for (const session of [...sessions.values()]) {
      if (
        session.waiter === undefined &&
        now - session.peer.lastSeenAt > StudioLimits.staleAfterMs
      ) {
        yield* dropSession(session);
      }
    }
    for (const [id, at] of tombstones) {
      if (now - at > StudioLimits.tombstoneTtlMs) tombstones.delete(id);
    }
    for (const [from, alias] of aliases) {
      const live = [...sessions.values()].some((session) => session.peer.instanceId === alias.to);
      if (live) alias.at = now;
      else if (now - alias.at > StudioLimits.aliasTtlMs) aliases.delete(from);
    }
    // The agent's "active" flag decays without any new event.
    yield* refreshStatuses;
  });
  yield* sweep.pipe(Effect.repeat(Schedule.spaced(Duration.seconds(5))), Effect.forkScoped);

  const reset = Effect.gen(function* () {
    for (const session of [...sessions.values()]) yield* dropSession(session);
  });

  return StudioBridge.of({
    hello,
    poll,
    respond,
    postEvents,
    bye,
    request,
    resolve,
    peers: Effect.sync(allPeers),
    peersOf: (instanceId) =>
      Effect.sync(() => [...peersOfPlace(allPeers(), instanceId, resolveAlias)] as StudioPeer[]),
    notify: (input) =>
      Effect.gen(function* () {
        const target = [...sessions.values()].find(
          (session) =>
            session.peer.role === "edit" &&
            peersOfPlace([session.peer], input.instanceId, resolveAlias).length > 0,
        );
        if (target === undefined) return;
        target.outbox.push({
          kind: "notify",
          level: input.level,
          title: input.title.slice(0, 200),
          ...(input.body === undefined ? {} : { body: input.body.slice(0, 2000) }),
        });
        yield* wake(target);
      }),
    markAgentLinked: Effect.gen(function* () {
      if (agentLinked) return;
      agentLinked = true;
      yield* refreshStatuses;
      yield* changed;
    }),
    setLifecycle: (next) =>
      Effect.gen(function* () {
        lifecycle = next;
        if (next.state !== "running") agentLinked = false;
        yield* refreshStatuses;
        yield* changed;
      }),
    reset,
    snapshot: Effect.sync(() => ({
      build: STUDIO_BRIDGE_BUILD,
      protocol: STUDIO_PROTOCOL_VERSION,
      lifecycle,
      peers: allPeers(),
      pendingRequests: pending.size,
      agentLinked,
      pluginReloadNeeded:
        lifecycle.pluginUpdated &&
        (sessions.size === 0 ||
          allPeers().some(
            (peer) =>
              lifecycle.pluginHash !== undefined && peer.pluginHash !== lifecycle.pluginHash,
          )),
      ...(lastRejection === undefined ? {} : { lastRejection }),
      recentActivity: [...activity],
    })),
    events: Stream.fromPubSub(eventsHub),
    changes: Stream.fromPubSub(changesHub),
  });
});

export const layer = Layer.effect(StudioBridge, make);
