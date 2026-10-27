import {
  type DesktopSshEnvironmentTarget,
  EnvironmentId,
  type OrchestrationV2ShellSnapshot,
  type ServerConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scheduler from "effect/Scheduler";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ClientCapabilities from "../platform/capabilities.ts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  type ConnectionCatalogEntry,
  type ConnectionRegistration,
  type ConnectionRoute,
  PrimaryConnectionRegistration,
  SshConnectionProfile,
  SshConnectionRegistration,
  type ConnectionCredential,
  type ConnectionProfile,
} from "./catalog.ts";
import * as Connectivity from "./connectivity.ts";
import * as ConnectionCredentialStore from "./credentialStore.ts";
import * as ConnectionDriver from "./driver.ts";
import type { RouteCheck } from "./driver.ts";
import { connectionRouteId, connectionRouteKind } from "./routes.ts";
import {
  ConnectionTransientError,
  ConnectionBlockedError,
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  SshConnectionTarget,
  type ConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./model.ts";
import * as Persistence from "../platform/persistence.ts";
import * as ConnectionProfileStore from "./profileStore.ts";
import * as EnvironmentRegistry from "./registry.ts";
import {
  PullRequestRoutingPermissions,
  makePullRequestRoutingPermissions,
} from "./pullRequestRoutingPermissions.ts";
import * as RpcSession from "../rpc/session.ts";
import * as EnvironmentSupervisor from "./supervisor.ts";
import * as ConnectionWakeups from "./wakeups.ts";
import { runDesktopCommitWithReconnectObserver } from "../state/server.ts";
import { v2ShellSnapshot } from "../state/orchestrationV2TestFixtures.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const SECOND_TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-2"),
  label: "Second environment",
  httpBaseUrl: "https://environment-2.example.test",
  wsBaseUrl: "wss://environment-2.example.test",
});

const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: "wss://environment.example.test/ws",
  httpAuthorization: null,
  target: TARGET,
};

const BEARER_TARGET = new BearerConnectionTarget({
  environmentId: EnvironmentId.make("environment-bearer"),
  label: "Bearer environment",
  connectionId: "bearer-connection",
});
const BEARER_PROFILE = new BearerConnectionProfile({
  connectionId: BEARER_TARGET.connectionId,
  environmentId: BEARER_TARGET.environmentId,
  label: BEARER_TARGET.label,
  httpBaseUrl: "https://bearer.example.test",
  wsBaseUrl: "wss://bearer.example.test",
});
const BEARER_CREDENTIAL = new BearerConnectionCredential({
  token: "bearer-token",
});

const SSH_TARGET: DesktopSshEnvironmentTarget = {
  alias: "test",
  hostname: "test.example.test",
  username: "developer",
  port: 22,
};
const SSH_CONNECTION = new SshConnectionTarget({
  environmentId: EnvironmentId.make("environment-ssh"),
  label: "SSH environment",
  connectionId: "ssh-connection",
});
const SSH_PROFILE = new SshConnectionProfile({
  connectionId: SSH_CONNECTION.connectionId,
  environmentId: SSH_CONNECTION.environmentId,
  label: SSH_CONNECTION.label,
  target: SSH_TARGET,
});

const CACHED_SNAPSHOT: OrchestrationV2ShellSnapshot = {
  ...v2ShellSnapshot,
  snapshotSequence: 1,
};

interface SessionControl {
  readonly closed: Deferred.Deferred<never, ConnectionTransientError>;
}

const makeHarness = Effect.fn("TestEnvironmentRegistry.makeHarness")(function* (
  initialTargets: ReadonlyArray<ConnectionTarget>,
  initialProfiles: ReadonlyArray<ConnectionProfile> = [],
  initialCredentials: ReadonlyArray<readonly [string, ConnectionCredential]> = [],
  options?: {
    readonly prepareError?: ConnectionBlockedError;
    readonly beforeSessionConnect?: (environmentId: EnvironmentId) => Effect.Effect<void>;
    readonly beforeRegistrationRegister?: (
      registration: ConnectionRegistration,
    ) => Effect.Effect<void, Persistence.ConnectionPersistenceError>;
    readonly beforeRegistrationRemove?: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<void, Persistence.ConnectionPersistenceError>;
    readonly checkRoute?: (route: ConnectionRoute) => RouteCheck;
    readonly prepareRoute?: (target: ConnectionTarget) => ConnectionBlockedError | undefined;
    readonly beforePrepareRoute?: (
      target: ConnectionTarget,
    ) => Effect.Effect<ConnectionBlockedError | undefined>;
    readonly initialDisabled?: ReadonlyArray<EnvironmentId>;
    readonly directEndpoints?: ServerConfig["directEndpoints"];
  },
) {
  const storedTargets = yield* Ref.make<ReadonlyArray<ConnectionTarget>>(initialTargets);
  const shellCache = yield* Ref.make(new Map([[TARGET.environmentId, CACHED_SNAPSHOT]]));
  const cacheClears = yield* Ref.make<ReadonlyArray<EnvironmentId>>([]);
  const ownedDataClears = yield* Ref.make<ReadonlyArray<EnvironmentId>>([]);
  const sessions = yield* Ref.make<ReadonlyArray<SessionControl>>([]);
  const releasedSessions = yield* Ref.make(0);
  const storedProfiles = yield* Ref.make(
    new Map(initialProfiles.map((profile) => [profile.connectionId, profile])),
  );
  const profileReadCount = yield* Ref.make(0);
  const storedCredentials = yield* Ref.make(new Map(initialCredentials));
  const disconnectedSshTargets = yield* Ref.make<ReadonlyArray<DesktopSshEnvironmentTarget>>([]);

  const storedDisabled = yield* Ref.make<ReadonlySet<EnvironmentId>>(
    new Set(options?.initialDisabled ?? []),
  );
  const targetStore = Persistence.ConnectionTargetStore.of({
    list: Ref.get(storedTargets),
    listDisabled: Ref.get(storedDisabled).pipe(Effect.map((ids) => [...ids])),
  });
  const registrationStore = Persistence.ConnectionRegistrationStore.of({
    register: (registration, routes) =>
      Effect.gen(function* () {
        yield* options?.beforeRegistrationRegister?.(registration) ?? Effect.void;
        yield* Ref.update(storedTargets, (current) =>
          replaceRoutes(current, registration.target.environmentId, routes),
        );
        switch (registration._tag) {
          case "BearerConnectionRegistration":
          case "SshConnectionRegistration":
            yield* Ref.update(storedProfiles, (current) => {
              const next = new Map(current);
              next.set(registration.profile.connectionId, registration.profile);
              return next;
            });
            yield* Ref.update(storedCredentials, (current) => {
              const next = new Map(current);
              next.set(registration.target.connectionId, registration.credential);
              return next;
            });
            return;
        }
      }),
    setRoutes: (environmentId, routes) =>
      Ref.update(storedTargets, (current) => replaceRoutes(current, environmentId, routes)),
    remove: (environmentId) =>
      Effect.gen(function* () {
        yield* options?.beforeRegistrationRemove?.(environmentId) ?? Effect.void;
        const removed = (yield* Ref.get(storedTargets)).filter(
          (target) => target.environmentId === environmentId,
        );
        yield* Ref.update(storedTargets, (current) =>
          current.filter((target) => target.environmentId !== environmentId),
        );
        for (const target of removed) {
          if (target._tag === "BearerConnectionTarget" || target._tag === "SshConnectionTarget") {
            yield* Ref.update(storedProfiles, (current) => {
              const next = new Map(current);
              next.delete(target.connectionId);
              return next;
            });
            yield* Ref.update(storedCredentials, (current) => {
              const next = new Map(current);
              next.delete(target.connectionId);
              return next;
            });
          }
        }
      }),
    setEnabled: (environmentId, enabled) =>
      Ref.update(storedDisabled, (current) => {
        const next = new Set(current);
        if (enabled) {
          next.delete(environmentId);
        } else {
          next.add(environmentId);
        }
        return next;
      }),
  });
  const cacheStore = Persistence.EnvironmentCacheStore.of({
    loadShell: (environmentId) =>
      Ref.get(shellCache).pipe(
        Effect.map((cache) => Option.fromUndefinedOr(cache.get(environmentId))),
      ),
    saveShell: (environmentId, snapshot) =>
      Ref.update(shellCache, (current) => {
        const next = new Map(current);
        next.set(environmentId, snapshot);
        return next;
      }),
    loadThread: (_environmentId, _threadId) => Effect.succeedNone,
    saveThread: (_environmentId, _thread) => Effect.void,
    removeThread: (_environmentId, _threadId) => Effect.void,
    loadServerConfig: () => Effect.succeedNone,
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeedNone,
    saveVcsRefs: () => Effect.void,
    removeVcsRefs: () => Effect.void,
    clearVcsRefs: () => Effect.void,
    clear: (environmentId) =>
      Ref.update(shellCache, (current) => {
        const next = new Map(current);
        next.delete(environmentId);
        return next;
      }).pipe(
        Effect.andThen(
          Ref.update(cacheClears, (environmentIds) => [...environmentIds, environmentId]),
        ),
      ),
  });
  const ownedDataCleanup = Persistence.EnvironmentOwnedDataCleanup.of({
    clear: (environmentId) =>
      Ref.update(ownedDataClears, (environmentIds) => [...environmentIds, environmentId]),
  });
  const networkStatus = yield* SubscriptionRef.make<"unknown" | "offline" | "online">("online");
  const connectivity = Connectivity.Connectivity.of({
    status: SubscriptionRef.get(networkStatus),
    changes: SubscriptionRef.changes(networkStatus),
  });
  const profileStore = ConnectionProfileStore.ConnectionProfileStore.of({
    get: (connectionId) =>
      Ref.update(profileReadCount, (count) => count + 1).pipe(
        Effect.andThen(Ref.get(storedProfiles)),
        Effect.map((current) => Option.fromUndefinedOr(current.get(connectionId))),
      ),
    put: (profile) =>
      Ref.update(storedProfiles, (current) => {
        const next = new Map(current);
        next.set(profile.connectionId, profile);
        return next;
      }),
    remove: (connectionId) =>
      Ref.update(storedProfiles, (current) => {
        const next = new Map(current);
        next.delete(connectionId);
        return next;
      }),
  });
  const credentialStore = ConnectionCredentialStore.ConnectionCredentialStore.of({
    get: (connectionId) =>
      Ref.get(storedCredentials).pipe(
        Effect.map((current) => Option.fromUndefinedOr(current.get(connectionId))),
      ),
    put: (connectionId, credential) =>
      Ref.update(storedCredentials, (current) => {
        const next = new Map(current);
        next.set(connectionId, credential);
        return next;
      }),
    remove: (connectionId) =>
      Ref.update(storedCredentials, (current) => {
        const next = new Map(current);
        next.delete(connectionId);
        return next;
      }),
  });
  const sshGateway = ClientCapabilities.SshEnvironmentGateway.of({
    provision: () => Effect.die(new Error("SSH provisioning is not used.")),
    prepare: () => Effect.die(new Error("SSH preparation is not used.")),
    disconnect: (target) => Ref.update(disconnectedSshTargets, (current) => [...current, target]),
  });
  const connectedRoutes = yield* Ref.make<ReadonlyArray<string>>([]);
  const checkRoute = (route: ConnectionRoute) =>
    Effect.succeed(options?.checkRoute?.(route) ?? "unchecked");
  const connectRoute = (entry: ConnectionCatalogEntry, route: ConnectionRoute) =>
    Effect.gen(function* () {
      const target = route.target;
      const credential =
        target._tag === "BearerConnectionTarget"
          ? yield* credentialStore.get(target.connectionId)
          : Option.none();
      const prepared: PreparedConnection = {
        ...PREPARED,
        environmentId: target.environmentId,
        label: target.label,
        httpAuthorization: Option.isSome(credential)
          ? { _tag: "Bearer", token: credential.value.token }
          : null,
        target,
      };
      if (options?.prepareError) return yield* options.prepareError;
      const heldError = options?.beforePrepareRoute
        ? yield* options.beforePrepareRoute(target)
        : undefined;
      if (heldError !== undefined) return yield* heldError;
      const routeError = options?.prepareRoute?.(target);
      if (routeError !== undefined) return yield* routeError;
      yield* Ref.update(connectedRoutes, (current) => [...current, connectionRouteId(target)]);
      yield* options?.beforeSessionConnect?.(target.environmentId) ?? Effect.void;
      const closed = yield* Deferred.make<never, ConnectionTransientError>();
      yield* Ref.update(sessions, (current) => [...current, { closed }]);
      const session = yield* Effect.acquireRelease(
        Effect.succeed({
          client: {} as RpcSession.RpcSession["client"],
          initialConfig:
            options?.directEndpoints === undefined
              ? Effect.die(new Error("Config is not used by registry tests."))
              : Effect.succeed({ directEndpoints: options.directEndpoints } as ServerConfig),
          subscribeServerConfig: () =>
            Stream.die(new Error("Config is not used by registry tests.")),
          ready: Effect.void,
          probe: Effect.void,
          closed: Deferred.await(closed),
        } satisfies RpcSession.RpcSession),
        () => Ref.update(releasedSessions, (count) => count + 1),
      );
      yield* session.ready;
      return { prepared, session };
    });
  const driver = ConnectionDriver.ConnectionDriver.of({
    connect: (entry, reportProgress) =>
      reportProgress({ stage: "preparing" }).pipe(
        Effect.andThen(
          ConnectionDriver.connectOverRoutes(entry, checkRoute, (route) =>
            connectRoute(entry, route),
          ),
        ),
      ),
    checkRoute: (_entry, route) => checkRoute(route),
    preflight: (_entry, route) =>
      checkRoute(route).pipe(Effect.map((check) => check === "answered")),
  });

  const layerCache = Layer.succeed(Persistence.EnvironmentCacheStore, cacheStore);
  const layer = EnvironmentRegistry.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Persistence.ConnectionTargetStore, targetStore),
        Layer.succeed(Persistence.ConnectionRegistrationStore, registrationStore),
        Layer.succeed(ConnectionProfileStore.ConnectionProfileStore, profileStore),
        Layer.succeed(ConnectionCredentialStore.ConnectionCredentialStore, credentialStore),
        Layer.succeed(ClientCapabilities.SshEnvironmentGateway, sshGateway),
        Layer.succeed(Connectivity.Connectivity, connectivity),
        Layer.succeed(
          ConnectionWakeups.ConnectionWakeups,
          ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.never }),
        ),
        Layer.succeed(ConnectionDriver.ConnectionDriver, driver),
        layerCache,
        Layer.succeed(Persistence.EnvironmentOwnedDataCleanup, ownedDataCleanup),
      ),
    ),
  );

  return {
    layer,
    storedTargets,
    shellCache,
    cacheClears,
    ownedDataClears,
    sessions,
    releasedSessions,
    storedProfiles,
    profileReadCount,
    storedCredentials,
    storedDisabled,
    disconnectedSshTargets,
    networkStatus,
    connectedRoutes,
  };
});

function routesOf(targets: ReadonlyArray<ConnectionTarget>, environmentId: EnvironmentId) {
  return targets.filter((target) => target.environmentId === environmentId);
}

function hasRoutes(targets: ReadonlyArray<ConnectionTarget>, environmentId: EnvironmentId) {
  return routesOf(targets, environmentId).length > 0;
}

function replaceRoutes(
  current: ReadonlyArray<ConnectionTarget>,
  environmentId: EnvironmentId,
  routes: ReadonlyArray<ConnectionTarget>,
): ReadonlyArray<ConnectionTarget> {
  const firstIndex = current.findIndex((target) => target.environmentId === environmentId);
  const others = current.filter((target) => target.environmentId !== environmentId);
  const insertAt =
    firstIndex === -1
      ? others.length
      : current.slice(0, firstIndex).filter((target) => target.environmentId !== environmentId)
          .length;
  return [...others.slice(0, insertAt), ...routes, ...others.slice(insertAt)];
}

function awaitConnectionState(
  registry: EnvironmentRegistry.EnvironmentRegistry["Service"],
  environmentId: EnvironmentId,
  predicate: (state: SupervisorConnectionState) => boolean,
) {
  return Effect.gen(function* () {
    const current = yield* registry.state(environmentId);
    if (predicate(current)) {
      return current;
    }
    return yield* registry
      .stateChanges(environmentId)
      .pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow));
  });
}

describe("EnvironmentRegistry", () => {
  it.effect("replays connected state when arming a desktop commit observer", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([TARGET]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );

        const commits = yield* Ref.make(0);
        const result = yield* runDesktopCommitWithReconnectObserver(
          registry.stateChanges(TARGET.environmentId),
          Ref.update(commits, (count) => count + 1).pipe(
            Effect.andThen(Effect.fail("commit refused")),
          ),
        ).pipe(Effect.flip, Effect.timeout("1 second"));

        expect(result).toBe("commit refused");
        expect(yield* Ref.get(commits)).toBe(1);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("does not acquire a session after the registry scope has already closed", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([TARGET]);
      const registryScope = yield* Scope.make();
      const context = yield* Layer.build(harness.layer).pipe(Scope.provide(registryScope));
      const registry = Context.get(context, EnvironmentRegistry.EnvironmentRegistry);
      const dispatcher = new Scheduler.MixedScheduler("sync", () => () => {}).makeDispatcher();
      const scheduler: Scheduler.Scheduler = {
        executionMode: "sync",
        shouldYield: () => false,
        makeDispatcher: () => dispatcher,
      };

      yield* Scope.close(registryScope, Exit.void);
      yield* registry.start.pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
      dispatcher.flush();

      expect(yield* Ref.get(harness.sessions)).toHaveLength(0);
      expect(yield* Ref.get(harness.releasedSessions)).toBe(0);
    }),
  );

  it.effect("starts persisted environments independently", () =>
    Effect.gen(function* () {
      const bothLoadsStarted = yield* Deferred.make<void>();
      const releaseLoads = yield* Deferred.make<void>();
      const loadCount = yield* Ref.make(0);
      const harness = yield* makeHarness([TARGET, SECOND_TARGET], [], [], {
        beforeSessionConnect: () =>
          Ref.updateAndGet(loadCount, (count) => count + 1).pipe(
            Effect.tap((count) =>
              count === 2 ? Deferred.succeed(bothLoadsStarted, undefined) : Effect.void,
            ),
            Effect.andThen(Deferred.await(releaseLoads)),
          ),
      });

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const start = yield* Effect.forkChild(registry.start);

        yield* Deferred.await(bothLoadsStarted).pipe(Effect.timeout("1 second"));
        yield* Deferred.succeed(releaseLoads, undefined);
        yield* Fiber.join(start);

        expect(yield* Ref.get(loadCount)).toBe(2);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("does not expose a persisted environment as disconnected while it starts", () =>
    Effect.gen(function* () {
      const connectionStarted = yield* Deferred.make<void>();
      const finishConnection = yield* Deferred.make<void>();
      const harness = yield* makeHarness([TARGET], [], [], {
        beforeSessionConnect: () =>
          Deferred.succeed(connectionStarted, undefined).pipe(
            Effect.andThen(Deferred.await(finishConnection)),
          ),
      });

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        expect((yield* registry.state(TARGET.environmentId)).phase).toBe("connecting");

        yield* Deferred.await(connectionStarted);
        expect((yield* registry.state(TARGET.environmentId)).phase).toBe("connecting");
        yield* Deferred.succeed(finishConnection, undefined);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("preserves cached data on connection failure and clears it on explicit removal", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([TARGET]);
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        const controls = yield* Ref.get(harness.sessions);
        expect(controls).toHaveLength(1);
        const active = controls[0];
        expect(active).toBeDefined();
        expect((yield* Ref.get(harness.shellCache)).get(TARGET.environmentId)).toEqual(
          CACHED_SNAPSHOT,
        );

        const retryFiber = yield* Effect.forkChild(
          awaitConnectionState(
            registry,
            TARGET.environmentId,
            (state) => state.phase === "backoff",
          ),
        );
        yield* Effect.yieldNow;
        yield* Deferred.fail(
          active!.closed,
          new ConnectionTransientError({
            reason: "transport",
            detail: "Disconnected.",
          }),
        );
        yield* Fiber.join(retryFiber);
        expect((yield* Ref.get(harness.shellCache)).get(TARGET.environmentId)).toEqual(
          CACHED_SNAPSHOT,
        );

        yield* registry.remove(TARGET.environmentId);
        expect(hasRoutes(yield* Ref.get(harness.storedTargets), TARGET.environmentId)).toBe(false);
        expect((yield* Ref.get(harness.shellCache)).has(TARGET.environmentId)).toBe(false);
        expect(yield* Ref.get(harness.cacheClears)).toEqual([TARGET.environmentId]);
        expect((yield* SubscriptionRef.get(registry.entries)).has(TARGET.environmentId)).toBe(
          false,
        );
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("switching an SSH environment off tears down its managed backend", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([SSH_CONNECTION], [SSH_PROFILE]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          SSH_CONNECTION.environmentId,
          (state) => state.phase === "connected",
        );

        yield* registry.setEnabled(SSH_CONNECTION.environmentId, false);
        yield* awaitConnectionState(
          registry,
          SSH_CONNECTION.environmentId,
          (state) => state.phase === "available",
        );

        expect(yield* Ref.get(harness.disconnectedSshTargets)).toEqual([SSH_TARGET]);
        expect(hasRoutes(yield* Ref.get(harness.storedTargets), SSH_CONNECTION.environmentId)).toBe(
          true,
        );
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("a replaced platform bearer wakes a supervisor blocked on the old one", () =>
    Effect.gen(function* () {
      let storedCredentials: Ref.Ref<Map<string, ConnectionCredential>> | undefined;
      const harness = yield* makeHarness([], [], [], {
        beforePrepareRoute: (target) =>
          target._tag !== "BearerConnectionTarget" || storedCredentials === undefined
            ? // @effect-diagnostics-next-line effectSucceedWithVoid:off - Admission checks return an optional blocker, so absence must be undefined.
              Effect.succeed(undefined)
            : Ref.get(storedCredentials).pipe(
                Effect.map((current) =>
                  current.get(target.connectionId)?.token === "old-bearer"
                    ? new ConnectionBlockedError({ reason: "authentication", detail: "revoked" })
                    : undefined,
                ),
              ),
      });
      storedCredentials = harness.storedCredentials;

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = (token: string) =>
          new BearerConnectionRegistration({
            target: BEARER_TARGET,
            profile: BEARER_PROFILE,
            credential: new BearerConnectionCredential({ token }),
          });
        yield* registry.reconcilePlatform([registration("old-bearer")]);
        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "blocked",
        );

        yield* registry.reconcilePlatform([registration("new-bearer")]);

        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("a replaced platform bearer reaches a connected session's HTTP requests", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = (token: string) =>
          new BearerConnectionRegistration({
            target: BEARER_TARGET,
            profile: BEARER_PROFILE,
            credential: new BearerConnectionCredential({ token }),
          });
        const preparedToken = registry.run(
          BEARER_TARGET.environmentId,
          EnvironmentSupervisor.EnvironmentSupervisor.pipe(
            Effect.flatMap((supervisor) => SubscriptionRef.get(supervisor.prepared)),
            Effect.map((prepared) =>
              Option.isSome(prepared) && prepared.value.httpAuthorization?._tag === "Bearer"
                ? prepared.value.httpAuthorization.token
                : null,
            ),
          ),
        );
        yield* registry.reconcilePlatform([registration("old-bearer")]);
        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        expect(yield* preparedToken).toBe("old-bearer");

        yield* registry.reconcilePlatform([registration("new-bearer")]);

        expect(yield* preparedToken).toBe("new-bearer");
        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("a bearer replaced while an attempt is in flight retries with the new one", () =>
    Effect.gen(function* () {
      const attemptStarted = yield* Deferred.make<void>();
      const releaseFirstAttempt = yield* Deferred.make<void>();
      const attempts = yield* Ref.make(0);
      const harness = yield* makeHarness([], [], [], {
        beforePrepareRoute: (target) =>
          target._tag !== "BearerConnectionTarget"
            ? // @effect-diagnostics-next-line effectSucceedWithVoid:off - Admission checks return an optional blocker, so absence must be undefined.
              Effect.succeed(undefined)
            : Ref.updateAndGet(attempts, (count) => count + 1).pipe(
                Effect.flatMap((count) =>
                  count === 1
                    ? Deferred.succeed(attemptStarted, undefined).pipe(
                        Effect.andThen(Deferred.await(releaseFirstAttempt)),
                        Effect.as(
                          new ConnectionBlockedError({
                            reason: "authentication",
                            detail: "revoked",
                          }),
                        ),
                      )
                    : // @effect-diagnostics-next-line effectSucceedWithVoid:off - Admission checks return an optional blocker, so absence must be undefined.
                      Effect.succeed(undefined),
                ),
              ),
      });

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = (token: string) =>
          new BearerConnectionRegistration({
            target: BEARER_TARGET,
            profile: BEARER_PROFILE,
            credential: new BearerConnectionCredential({ token }),
          });
        yield* registry.reconcilePlatform([registration("old-bearer")]);
        yield* Deferred.await(attemptStarted).pipe(Effect.timeout("1 second"));

        yield* registry
          .stateChanges(BEARER_TARGET.environmentId)
          .pipe(Stream.runDrain, Effect.forkScoped({ startImmediately: true }));
        yield* Effect.yieldNow;
        yield* registry.reconcilePlatform([registration("new-bearer")]);
        yield* Deferred.succeed(releaseFirstAttempt, undefined);

        yield* awaitConnectionState(
          registry,
          BEARER_TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        expect(yield* Ref.get(attempts)).toBeGreaterThanOrEqual(2);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("starts platform environments without persisting or removing them", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.registerPlatform(new PrimaryConnectionRegistration({ target: TARGET }));
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );

        expect(hasRoutes(yield* Ref.get(harness.storedTargets), TARGET.environmentId)).toBe(false);
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target,
        ).toEqual(TARGET);

        const error = yield* Effect.flip(registry.remove(TARGET.environmentId));
        expect(error._tag).toBe("PlatformEnvironmentRemovalError");
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target,
        ).toEqual(TARGET);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("does not reacquire a runtime while its registration is being removed", () =>
    Effect.gen(function* () {
      const removalStarted = yield* Deferred.make<void>();
      const continueRemoval = yield* Deferred.make<void>();
      const harness = yield* makeHarness([TARGET], [], [], {
        beforeRegistrationRemove: () =>
          Deferred.succeed(removalStarted, undefined).pipe(
            Effect.andThen(Deferred.await(continueRemoval)),
          ),
      });

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );

        const removal = yield* Effect.forkChild(registry.remove(TARGET.environmentId));
        yield* Deferred.await(removalStarted);

        const stateLookup = yield* Effect.forkChild(
          Effect.flip(registry.state(TARGET.environmentId)),
        );
        yield* Effect.yieldNow;
        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);

        yield* Deferred.succeed(continueRemoval, undefined);
        yield* Fiber.join(removal);
        const error = yield* Fiber.join(stateLookup);
        expect(error._tag).toBe("EnvironmentNotRegisteredError");
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("platform refreshes preserve unsupported state for the same endpoint", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = new PrimaryConnectionRegistration({ target: TARGET });
        yield* registry.registerPlatform(registration);
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        const error = new ConnectionBlockedError({
          reason: "unsupported",
          detail: "Use a compatible client.",
        });
        yield* registry.setCompatibility(TARGET.environmentId, error);
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "available",
        );
        yield* registry.registerPlatform(registration);
        yield* registry.reconcilePlatform([registration]);
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId),
        ).toMatchObject({ enabled: true, unsupportedReason: error.message });
        yield* registry.registerPlatform(
          new PrimaryConnectionRegistration({
            target: new PrimaryConnectionTarget({ ...TARGET, label: "Renamed" }),
          }),
        );
        expect(yield* registry.state(TARGET.environmentId)).toMatchObject({
          desired: false,
          phase: "available",
        });
        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
        yield* registry.registerPlatform(
          new PrimaryConnectionRegistration({
            target: new PrimaryConnectionTarget({
              ...TARGET,
              httpBaseUrl: "https://changed.example.test",
            }),
          }),
        );
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)
            ?.unsupportedReason,
        ).toBeUndefined();
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("keeps one session per environment across concurrent registrations and retries", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = new PrimaryConnectionRegistration({ target: TARGET });
        yield* Effect.all(
          Array.from({ length: 5 }, () => registry.registerPlatform(registration)),
          { concurrency: "unbounded", discard: true },
        );
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );

        yield* Effect.all(
          [
            ...Array.from({ length: 5 }, () => registry.registerPlatform(registration)),
            ...Array.from({ length: 5 }, () => registry.retryNow(TARGET.environmentId)),
            registry.reconcilePlatform([registration]),
          ],
          { concurrency: "unbounded", discard: true },
        );
        for (let attempt = 0; attempt < 100; attempt += 1) {
          yield* Effect.yieldNow;
        }

        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
        expect(yield* Ref.get(harness.releasedSessions)).toBe(0);
        expect(yield* registry.state(TARGET.environmentId)).toMatchObject({
          phase: "connected",
          generation: 1,
        });
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("retains a healthy runtime when the platform repeats an identical registration", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([]);
      let failWrites = false;
      const permissions = yield* makePullRequestRoutingPermissions({
        read: Effect.succeed([]),
        write: () =>
          failWrites
            ? Effect.fail(
                new ConnectionTransientError({
                  reason: "remote-unavailable",
                  detail: "Storage unavailable",
                }),
              )
            : Effect.void,
      });
      const entry = { target: TARGET, profile: Option.none(), enabled: true };

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const registration = new PrimaryConnectionRegistration({ target: TARGET });
        yield* registry.registerPlatform(registration);
        yield* awaitConnectionState(
          registry,
          TARGET.environmentId,
          (state) => state.phase === "connected",
        );
        yield* permissions.set(entry, "read-write");

        yield* registry.registerPlatform(registration);

        expect(yield* Ref.get(harness.sessions)).toHaveLength(1);
        expect(yield* permissions.get(entry)).toBe("read-write");

        const changedTarget = new PrimaryConnectionTarget({
          ...TARGET,
          httpBaseUrl: "https://changed.example.test",
        });
        failWrites = true;
        yield* registry.registerPlatform(
          new PrimaryConnectionRegistration({ target: changedTarget }),
        );
        expect(
          (yield* SubscriptionRef.get(registry.entries)).get(TARGET.environmentId)?.target,
        ).toEqual(TARGET);
        yield* registry.reconcilePlatform([]);
        expect((yield* SubscriptionRef.get(registry.entries)).has(TARGET.environmentId)).toBe(true);

        failWrites = false;
        yield* registry.registerPlatform(
          new PrimaryConnectionRegistration({ target: changedTarget }),
        );
        expect(yield* permissions.get(entry)).toBe("off");
        yield* registry.registerPlatform(registration);
        expect(yield* permissions.get(entry)).toBe("off");
        yield* permissions.set(entry, "read-write");
        yield* registry.reconcilePlatform([]);
        yield* registry.registerPlatform(registration);
        expect(yield* permissions.get(entry)).toBe("off");
      }).pipe(
        Effect.provide(harness.layer),
        Effect.provideService(PullRequestRoutingPermissions, permissions),
        Effect.scoped,
      );
    }),
  );

  it.effect("removes all owned SSH state only on explicit removal", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness(
        [SSH_CONNECTION],
        [SSH_PROFILE],
        [
          [
            SSH_CONNECTION.connectionId,
            new BearerConnectionCredential({ token: "temporary-token" }),
          ],
        ],
      );

      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* registry.remove(SSH_CONNECTION.environmentId);

        expect((yield* Ref.get(harness.storedProfiles)).has(SSH_CONNECTION.connectionId)).toBe(
          false,
        );
        expect((yield* Ref.get(harness.storedCredentials)).has(SSH_CONNECTION.connectionId)).toBe(
          false,
        );
        expect(yield* Ref.get(harness.disconnectedSshTargets)).toEqual([SSH_TARGET]);
      }).pipe(Effect.provide(harness.layer));
    }),
  );
});

describe("EnvironmentRegistry routes", () => {
  const LAN_TARGET = new BearerConnectionTarget({
    environmentId: EnvironmentId.make("environment-lan"),
    label: "LAN environment",
    connectionId: "bearer:lan",
  });
  const LAN_PROFILE = new BearerConnectionProfile({
    connectionId: LAN_TARGET.connectionId,
    environmentId: LAN_TARGET.environmentId,
    label: LAN_TARGET.label,
    httpBaseUrl: "http://192.168.1.10:3773/",
    wsBaseUrl: "ws://192.168.1.10:3773/",
  });
  it.effect(
    "adding a saved SSH host again replaces its route, whatever id it was saved under",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness([SSH_CONNECTION], [SSH_PROFILE]);
        yield* Effect.gen(function* () {
          const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
          const again = new SshConnectionTarget({
            ...SSH_CONNECTION,
            connectionId: "ssh-connection-new-id",
          });
          yield* registry.register(
            new SshConnectionRegistration({
              target: again,
              profile: new SshConnectionProfile({
                ...SSH_PROFILE,
                connectionId: again.connectionId,
              }),
              credential: BEARER_CREDENTIAL,
            }),
          );

          expect(
            routesOf(yield* Ref.get(harness.storedTargets), SSH_CONNECTION.environmentId),
          ).toEqual([again]);
        }).pipe(Effect.provide(harness.layer), Effect.scoped);
      }),
  );

  it.effect("saves the Tailscale mark when the server reports a learned address as tailnet", () =>
    Effect.gen(function* () {
      const httpBaseUrl = "http://100.101.102.103:3773/";
      const learnedId = `learned:${LAN_TARGET.environmentId}:http://100.101.102.103:3773@${LAN_TARGET.connectionId}`;
      const learned = new BearerConnectionTarget({ ...LAN_TARGET, connectionId: learnedId });
      const learnedProfile = new BearerConnectionProfile({
        connectionId: learnedId,
        environmentId: LAN_TARGET.environmentId,
        label: LAN_TARGET.label,
        httpBaseUrl,
        wsBaseUrl: "ws://100.101.102.103:3773/",
        learned: true,
      });
      const harness = yield* makeHarness(
        [LAN_TARGET, learned],
        [LAN_PROFILE, learnedProfile],
        [[LAN_TARGET.connectionId, BEARER_CREDENTIAL]],
        {
          directEndpoints: [
            { kind: "lan", httpBaseUrl: LAN_PROFILE.httpBaseUrl },
            { kind: "tailnet", httpBaseUrl },
          ],
        },
      );
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        yield* registry.start;
        yield* SubscriptionRef.changes(registry.entries).pipe(
          Stream.map((entries) => entries.get(LAN_TARGET.environmentId)?.alternateRoutes?.[0]),
          Stream.filter((route) => route !== undefined && connectionRouteKind(route) === "tailnet"),
          Stream.runHead,
        );
        expect((yield* Ref.get(harness.storedProfiles)).get(learnedId)).toMatchObject({
          network: "tailscale",
          learned: true,
          httpBaseUrl,
        });
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );

  it.effect("drops a learned route whose profile was not saved instead of duplicating it", () =>
    Effect.gen(function* () {
      const learnedId = `learned:${LAN_TARGET.environmentId}:100.64.0.9:3773@${LAN_TARGET.connectionId}`;
      const learned = new BearerConnectionTarget({ ...LAN_TARGET, connectionId: learnedId });
      const harness = yield* makeHarness(
        [LAN_TARGET, learned, learned],
        [LAN_PROFILE],
        [[LAN_TARGET.connectionId, BEARER_CREDENTIAL]],
      );
      yield* Effect.gen(function* () {
        const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
        const entry = (yield* SubscriptionRef.get(registry.entries)).get(LAN_TARGET.environmentId);
        expect(entry?.target).toEqual(LAN_TARGET);
        expect(entry?.alternateRoutes ?? []).toEqual([]);
      }).pipe(Effect.provide(harness.layer), Effect.scoped);
    }),
  );
});
