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

import type { RobloxStudioAlert } from "@t3tools/contracts";

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
  /** Tools the user switched off in the Studio panel. */
  readonly disabledTools: ReadonlyArray<string>;
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
  /** The panel's switches as the plugin sent them; sanitized here. */
  readonly toggles: unknown;
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
      /** Set when the play server should relay the request to one of its clients. */
      readonly logicalId?: string;
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

export interface StudioSelection {
  readonly instanceId: string;
  readonly placeName: string;
  readonly at: number;
  readonly count: number;
  readonly items: ReadonlyArray<{ readonly path: string; readonly className: string }>;
  readonly activeScript?: string;
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
  /** Playtest clients this play server relays for, by logical id. */
  readonly clients: Map<string, StudioPeer>;
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
const ERROR_ALERT_WINDOW_MS = 30_000;
const AGENT_ACTIVE_MS = 90_000;

const sanitizeToggles = (value: unknown): StudioToggles => {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    paused: record.paused === true,
    readOnly: record.readOnly === true,
    allowLuau: record.allowLuau !== false,
    disabledTools:
      typeof record.disabledTools === "object" && record.disabledTools !== null
        ? Object.entries(record.disabledTools as Record<string, unknown>)
            .filter(([name, off]) => off === true && name.length <= 64)
            .map(([name]) => name)
            .toSorted()
            .slice(0, 100)
        : [],
  };
};

const togglesKey = (toggles: StudioToggles): string =>
  `${String(toggles.paused)}/${String(toggles.readOnly)}/${String(toggles.allowLuau)}/${toggles.disabledTools.join(",")}`;

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
    /** Drops every session of a place whose Studio window was closed (it never says bye). */
    readonly forgetPlace: (placeName: string) => Effect.Effect<number>;
    /** The play server registers a player's client, which it relays requests to. */
    readonly registerClient: (input: {
      readonly sessionToken: string;
      readonly logicalId: string;
      readonly playerName: string;
    }) => Effect.Effect<
      { readonly assignedRole: StudioRole },
      StudioSessionUnknown | StudioHelloRejected
    >;
    readonly unregisterClient: (input: {
      readonly sessionToken: string;
      readonly logicalId: string;
    }) => Effect.Effect<void>;
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
    /** What the user last had selected in the edit window of each connected place. */
    readonly selections: Effect.Effect<ReadonlyArray<StudioSelection>>;
    readonly events: Stream.Stream<StudioEvent>;
    /** Studio went away unexpectedly or mid-task, or a playtest printed an error. */
    readonly alerts: Stream.Stream<RobloxStudioAlert>;
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
  const selections = new Map<string, StudioSelection>();
  let lifecycle: StudioLifecycle = { state: "stopped", pluginUpdated: false };
  let agentLinked = false;
  let lastToolAt = 0;
  let lastRejection: string | undefined;
  const eventsHub = yield* PubSub.sliding<StudioEvent>(256);
  const alertsHub = yield* PubSub.sliding<RobloxStudioAlert>(64);
  // Playtest errors are folded per place so a script erroring every frame sends one alert.
  const errorWindows = new Map<string, { at: number; folded: number }>();
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

  const allPeers = (): StudioPeer[] =>
    [...sessions.values()].flatMap((session) => [
      session.peer,
      ...[...session.clients.values()].map((client) => ({
        ...client,
        lastSeenAt: session.peer.lastSeenAt,
      })),
    ]);

  /** The peer of this session (itself or a relayed client) that a request targets. */
  const servingPeer = (session: Session, request: Pending): StudioPeer | undefined => {
    const candidates = [session.peer, ...session.clients.values()];
    return candidates.find(
      (peer) =>
        peer.role === request.role &&
        peersOfPlace([peer], request.instanceId, resolveAlias).length > 0,
    );
  };

  const servesPending = (session: Session, request: Pending): boolean =>
    servingPeer(session, request) !== undefined;

  /** Fails requests that nobody left can serve, as when a peer or client goes away. */
  const failUnservable = (heldBy: Session | undefined, role?: string) =>
    Effect.gen(function* () {
      const remaining = [...sessions.values()];
      for (const request of [...pending.values()]) {
        const heldHere =
          heldBy !== undefined &&
          request.claimedBy === heldBy.peer.pluginSessionId &&
          (role === undefined || request.role === role);
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
    });

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
  const dropSession = (session: Session, reason: "bye" | "lost" | "replaced" = "bye") =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const midTask = [...pending.values()].some(
        (request) => request.claimedBy === session.peer.pluginSessionId,
      );
      // Closing Studio on purpose is not news; losing it, or losing it while the agent works, is.
      if (session.peer.role === "edit" && (reason === "lost" || (reason === "bye" && midTask))) {
        yield* PubSub.publish(alertsHub, {
          kind: "disconnected" as const,
          instanceId: session.peer.instanceId,
          placeName: session.peer.placeName,
          message: midTask
            ? "Roblox Studio disconnected while the agent was using it."
            : "Roblox Studio stopped answering SealCode.",
          count: 1,
          at: now,
        });
      }
      yield* Effect.logInfo("Studio peer disconnected", {
        role: session.peer.role,
        instanceId: session.peer.instanceId,
      });
      sessions.delete(session.peer.pluginSessionId);
      byToken.delete(session.token);
      selections.delete(session.peer.pluginSessionId);
      session.clients.clear();
      if (session.waiter !== undefined) yield* Deferred.succeed(session.waiter, undefined);
      yield* failUnservable(session);
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
        yield* dropSession(other, "replaced");
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
        clients: new Map(),
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
      const target = servingPeer(session, request);
      request.claimedBy = session.peer.pluginSessionId;
      request.delivered = true;
      session.claimed.add(request.id);
      messages.push({
        kind: "request",
        requestId: request.id,
        endpoint: request.endpoint,
        data: request.data,
        meta: request.meta,
        ...(target !== undefined && target !== session.peer
          ? { logicalId: target.pluginSessionId }
          : {}),
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
        if (type === "selection_changed" && session.peer.role === "edit") {
          const items = Array.isArray(rest.items)
            ? rest.items.flatMap((item) =>
                typeof item === "object" &&
                item !== null &&
                typeof (item as { path?: unknown }).path === "string"
                  ? [
                      {
                        path: String((item as { path: string }).path).slice(0, 300),
                        className: String((item as { className?: unknown }).className ?? "").slice(
                          0,
                          60,
                        ),
                      },
                    ]
                  : [],
              )
            : [];
          selections.set(session.peer.pluginSessionId, {
            instanceId: session.peer.instanceId,
            placeName: session.peer.placeName,
            at: now,
            count: typeof rest.count === "number" ? rest.count : items.length,
            items: items.slice(0, 20),
            ...(typeof rest.activeScript === "string"
              ? { activeScript: rest.activeScript.slice(0, 300) }
              : {}),
          });
        }
        if (
          type === "log_error" &&
          session.peer.role !== "edit" &&
          typeof rest.message === "string"
        ) {
          const key = session.peer.instanceId;
          const window = errorWindows.get(key);
          if (window !== undefined && now - window.at < ERROR_ALERT_WINDOW_MS) {
            window.folded += 1;
          } else {
            yield* PubSub.publish(alertsHub, {
              kind: "playtest_error" as const,
              instanceId: session.peer.instanceId,
              placeName: session.peer.placeName,
              message: rest.message.slice(0, 500),
              count: 1 + (window?.folded ?? 0),
              at: now,
            });
            errorWindows.set(key, { at: now, folded: 0 });
          }
        }
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

  const forgetPlace: StudioBridge["Service"]["forgetPlace"] = (placeName) =>
    Effect.gen(function* () {
      const wanted = placeName
        .trim()
        .replace(/\.rbxlx?$/iu, "")
        .toLowerCase();
      let dropped = 0;
      for (const session of [...sessions.values()]) {
        const name = session.peer.placeName
          .trim()
          .replace(/\.rbxlx?$/iu, "")
          .toLowerCase();
        if (name === wanted) {
          yield* dropSession(session, "lost");
          dropped += 1;
        }
      }
      return dropped;
    });

  const clientNumber = (role: string): number => Number(/^client-(\d+)$/.exec(role)?.[1] ?? 0);

  const registerClient: StudioBridge["Service"]["registerClient"] = (input) =>
    Effect.gen(function* () {
      const session = byToken.get(input.sessionToken);
      if (session === undefined) return yield* new StudioSessionUnknown();
      if (session.peer.role !== "server" || input.logicalId.trim() === "") {
        return yield* new StudioHelloRejected({ status: 400, code: "invalid_role" });
      }
      const now = yield* Clock.currentTimeMillis;
      touch(session, now);
      const existing = session.clients.get(input.logicalId);
      if (existing !== undefined) return { assignedRole: existing.role };
      // The lowest client number not already used in this place.
      const taken = new Set(
        peersOfPlace(allPeers(), session.peer.instanceId, resolveAlias)
          .map((peer) => clientNumber(peer.role))
          .filter((n) => n > 0),
      );
      let n = 1;
      while (taken.has(n)) n += 1;
      const role: StudioRole = `client-${n}`;
      session.clients.set(input.logicalId, {
        ...session.peer,
        pluginSessionId: input.logicalId,
        role,
        placeName: session.peer.placeName,
        dataModelName: input.playerName.slice(0, 100),
        isRunning: true,
        connectedAt: now,
        lastSeenAt: now,
      });
      yield* Effect.logInfo("Studio playtest client connected", {
        role,
        instanceId: session.peer.instanceId,
      });
      yield* refreshStatuses;
      yield* changed;
      return { assignedRole: role };
    });

  const unregisterClient: StudioBridge["Service"]["unregisterClient"] = (input) =>
    Effect.gen(function* () {
      const session = byToken.get(input.sessionToken);
      const client = session?.clients.get(input.logicalId);
      if (session === undefined || client === undefined) return;
      session.clients.delete(input.logicalId);
      yield* Effect.logInfo("Studio playtest client disconnected", {
        role: client.role,
        instanceId: client.instanceId,
      });
      yield* failUnservable(session, client.role);
      yield* refreshStatuses;
      yield* changed;
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
        yield* dropSession(session, "lost");
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
    forgetPlace,
    registerClient,
    unregisterClient,
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
    selections: Effect.sync(() =>
      [...selections.entries()].flatMap(([sessionId, selection]) => {
        const live = sessions.get(sessionId);
        return live === undefined ? [] : [{ ...selection, instanceId: live.peer.instanceId }];
      }),
    ),
    events: Stream.fromPubSub(eventsHub),
    alerts: Stream.fromPubSub(alertsHub),
    changes: Stream.fromPubSub(changesHub),
  });
});

export const layer = Layer.effect(StudioBridge, make);
