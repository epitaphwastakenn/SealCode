import {
  ConnectionTransientError,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ConnectionCatalogDocument, Persistence } from "@t3tools/client-runtime/platform";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { afterEach, vi } from "vite-plus/test";

import { makeThreadProjectionFixture } from "../test-fixtures";
import * as ConnectionStorage from "./storage";
import { THREAD_CACHE_MAX_ENTRY_CHARS } from "./threadCachePolicy";

const emptyCatalog = {
  schemaVersion: 1,
  targets: [],
  profiles: [],
  credentials: [],
  disabledEnvironmentIds: [],
} as const;
const decodeCatalog = Schema.decodeUnknownSync(Schema.fromJsonString(ConnectionCatalogDocument));
const encodeCatalog = Schema.encodeSync(Schema.fromJsonString(ConnectionCatalogDocument));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConnectionStorage.makeCatalogStore", () => {
  it.effect("quarantines malformed catalogs and starts from an empty document", () =>
    Effect.gen(function* () {
      const writes: string[] = [];
      const quarantined: string[] = [];
      const store = yield* ConnectionStorage.makeCatalogStore({
        read: Effect.succeed("{not-json"),
        write: (raw) => Effect.sync(() => writes.push(raw)),
        quarantine: (raw) => Effect.sync(() => quarantined.push(raw)),
      });

      expect(yield* store.read).toEqual(emptyCatalog);
      expect(quarantined).toEqual(["{not-json"]);
      expect(writes).toHaveLength(1);
      expect(decodeCatalog(writes[0]!)).toEqual(emptyCatalog);
    }),
  );

  it.effect("does not hide catalog read failures", () =>
    Effect.gen(function* () {
      const failure = new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "permission denied",
      });
      const store = yield* ConnectionStorage.makeCatalogStore({
        read: Effect.fail(failure),
        write: () => Effect.void,
      });

      expect(yield* Effect.flip(store.read)).toBe(failure);
    }),
  );
});

const fixedHandle = (database: IDBDatabase) => ({
  get: Effect.succeed(database),
  invalidate: () => Effect.void,
});

describe("ConnectionStorage.makeCatalogBackend", () => {
  it.effect("fails IndexedDB writes whose commit aborts", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", {});
      const transaction = Object.assign(new EventTarget(), {
        error: null as DOMException | null,
        objectStore: () => ({
          put: () => {
            // A failed commit aborts the transaction without an "error" event.
            queueMicrotask(() => {
              transaction.error = new DOMException("Quota exceeded", "QuotaExceededError");
              transaction.dispatchEvent(new Event("abort"));
            });
          },
        }),
      });
      const backend = ConnectionStorage.makeCatalogBackend(
        fixedHandle({ transaction: () => transaction } as unknown as IDBDatabase),
      );

      const error = yield* backend.write("{}").pipe(Effect.flip);

      expect(error.message).toContain("QuotaExceededError");
    }),
  );
});

describe("IndexedDB connection recovery", () => {
  it.effect("reopens after a forced close and finalizes the current connection", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", {});
      const makeDatabase = () =>
        Object.assign(new EventTarget(), {
          close: vi.fn(),
          transaction: () => ({
            objectStore: () => ({
              get: () => {
                const request = Object.assign(new EventTarget(), {
                  result: undefined,
                  error: null,
                });
                queueMicrotask(() => request.dispatchEvent(new Event("success")));
                return request;
              },
            }),
          }),
        }) as unknown as IDBDatabase;
      const first = makeDatabase();
      const second = makeDatabase();
      const databases = [first, second];
      let openCount = 0;
      const open = vi.fn(() => {
        const request = Object.assign(new EventTarget(), {
          result: databases[openCount++],
          error: null,
        });
        queueMicrotask(() => request.dispatchEvent(new Event("success")));
        return request;
      });
      vi.stubGlobal("indexedDB", { open });

      yield* Effect.gen(function* () {
        const cache = yield* Persistence.EnvironmentCacheStore;
        const environmentId = EnvironmentId.make("env");
        const threadId = ThreadId.make("thread");
        expect(Option.isNone(yield* cache.loadThread(environmentId, threadId))).toBe(true);
        expect(open).toHaveBeenCalledTimes(1);

        first.dispatchEvent(new Event("close"));
        const recovered = yield* Effect.all(
          [cache.loadThread(environmentId, threadId), cache.loadThread(environmentId, threadId)],
          { concurrency: 2 },
        );
        expect(recovered.every(Option.isNone)).toBe(true);
        expect(open).toHaveBeenCalledTimes(2);
      }).pipe(Effect.provide(ConnectionStorage.layer));

      expect(first.close).not.toHaveBeenCalled();
      expect(second.close).toHaveBeenCalledOnce();
    }),
  );
});

describe("IndexedDB connection closed without a close event", () => {
  it.effect("reopens and retries the failing operation once", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", {});
      const closing = Object.assign(new EventTarget(), {
        close: vi.fn(),
        transaction: () => {
          // Chromium force-closed this connection; this tab never saw "close".
          throw new DOMException("The database connection is closing.", "InvalidStateError");
        },
      }) as unknown as IDBDatabase;
      const fresh = Object.assign(new EventTarget(), {
        close: vi.fn(),
        transaction: () => ({
          objectStore: () => ({
            get: () => {
              const request = Object.assign(new EventTarget(), { result: undefined, error: null });
              queueMicrotask(() => request.dispatchEvent(new Event("success")));
              return request;
            },
          }),
        }),
      }) as unknown as IDBDatabase;
      const databases = [closing, fresh];
      let openCount = 0;
      const open = vi.fn(() => {
        const request = Object.assign(new EventTarget(), {
          result: databases[openCount++],
          error: null,
        });
        queueMicrotask(() => request.dispatchEvent(new Event("success")));
        return request;
      });
      vi.stubGlobal("indexedDB", { open });

      yield* Effect.gen(function* () {
        const cache = yield* Persistence.EnvironmentCacheStore;
        const loaded = yield* cache.loadThread(EnvironmentId.make("env"), ThreadId.make("thread"));
        expect(Option.isNone(loaded)).toBe(true);
        expect(open).toHaveBeenCalledTimes(2);
      }).pipe(Effect.provide(ConnectionStorage.layer));
    }),
  );
});

describe("browser GitHub routing permissions", () => {
  it.effect("revokes across runtimes before storage events and resists stale catalog writes", () =>
    Effect.gen(function* () {
      const values = new Map<string, string>();
      const localStorage: Storage = {
        get length() {
          return values.size;
        },
        key: (index) => [...values.keys()][index] ?? null,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
        removeItem: (key) => {
          values.delete(key);
        },
        clear: () => {
          values.clear();
        },
      };
      const firstBrowser = Object.assign(new EventTarget(), { localStorage });
      const secondBrowser = Object.assign(new EventTarget(), { localStorage });
      const first = ConnectionStorage.makeBrowserPullRequestRoutingPermissions(firstBrowser);
      const second = ConnectionStorage.makeBrowserPullRequestRoutingPermissions(secondBrowser);
      const entry = {
        target: new PrimaryConnectionTarget({
          environmentId: EnvironmentId.make("first"),
          label: "First",
          httpBaseUrl: "http://localhost:3000",
          wsBaseUrl: "ws://localhost:3000",
        }),
        profile: Option.none(),
        enabled: true,
      };
      const other = {
        ...entry,
        target: new PrimaryConnectionTarget({
          ...entry.target,
          environmentId: EnvironmentId.make("second"),
        }),
      };
      expect(yield* first.get(entry)).toBe("off");
      yield* first.set(entry, "read-write");
      expect(yield* second.get(entry)).toBe("read-write");
      const oldPermissions = Option.getOrThrow(yield* Stream.runHead(first.changes));
      const staleCatalog = yield* ConnectionStorage.makeCatalogStore({
        read: Effect.succeed(
          encodeCatalog({ ...emptyCatalog, githubRoutingPermissions: oldPermissions }),
        ),
        write: () => Effect.void,
      });
      yield* staleCatalog.read;
      const listening = yield* Deferred.make<void>();
      const revoked = yield* Deferred.make<void>();
      yield* second.changes.pipe(
        Stream.runForEach((permissions) =>
          Deferred.succeed(permissions.length > 0 ? listening : revoked, undefined),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(listening);

      yield* first.set(entry, "off");
      expect(yield* second.get(entry)).toBe("off");
      secondBrowser.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
      yield* Deferred.await(revoked);
      yield* second.set(other, "read");
      yield* staleCatalog.update((document) => ({ ...document, accountId: "updated" }));
      expect(yield* second.get(entry)).toBe("off");
      expect(yield* first.get(other)).toBe("read");
      expect(
        yield* ConnectionStorage.makeBrowserPullRequestRoutingPermissions(firstBrowser).get(entry),
      ).toBe("off");

      yield* first.set(entry, "read-write");
      yield* second.forget(entry.target.environmentId);
      expect(yield* first.get(entry)).toBe("off");
      expect(yield* first.get(other)).toBe("read");
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("Storage unavailable");
      });
      expect(yield* first.set(entry, "read-write").pipe(Effect.flip)).toBeInstanceOf(
        ConnectionTransientError,
      );
      expect(yield* second.get(entry)).toBe("off");
    }).pipe(Effect.scoped),
  );
});

function makeFakeThreadDatabase() {
  const stores = new Map<string, Map<string, unknown>>();
  const storeFor = (name: string) => {
    let store = stores.get(name);
    if (store === undefined) {
      store = new Map();
      stores.set(name, store);
    }
    return store;
  };
  const database = Object.assign(new EventTarget(), {
    close: vi.fn(),
    transaction: () => {
      const transaction = Object.assign(new EventTarget(), { error: null });
      let pending = 0;
      let completed = false;
      const settle = () =>
        queueMicrotask(() => {
          if (pending === 0 && !completed) {
            completed = true;
            transaction.dispatchEvent(new Event("complete"));
          }
        });
      const request = (run: () => unknown) => {
        const req = Object.assign(new EventTarget(), { result: undefined as unknown, error: null });
        pending += 1;
        queueMicrotask(() => {
          req.result = run();
          req.dispatchEvent(new Event("success"));
          pending -= 1;
          settle();
        });
        return req;
      };
      const objectStore = (name: string) => {
        const store = storeFor(name);
        return {
          get: (key: string) => request(() => store.get(key)),
          put: (value: unknown, key: string) =>
            request(() => {
              store.set(key, value);
              return key;
            }),
          delete: (target: string | { lower: string; upper: string }) =>
            request(() => {
              if (typeof target === "string") {
                store.delete(target);
                return;
              }
              for (const key of store.keys()) {
                if (key >= target.lower && key <= target.upper) store.delete(key);
              }
            }),
          openCursor: () => {
            // Read lazily: the cursor sees writes queued earlier in the same transaction.
            let keys: Array<string> | undefined;
            let position = 0;
            const req = Object.assign(new EventTarget(), {
              result: null as unknown,
              error: null,
            });
            const step = () => {
              pending += 1;
              queueMicrotask(() => {
                keys ??= [...store.keys()].toSorted();
                const key = keys[position++];
                req.result =
                  key === undefined ? null : { key, value: store.get(key), continue: step };
                req.dispatchEvent(new Event("success"));
                pending -= 1;
                settle();
              });
            };
            step();
            return req;
          },
        };
      };
      return Object.assign(transaction, { objectStore });
    },
  }) as unknown as IDBDatabase;
  const open = vi.fn(() => {
    const req = Object.assign(new EventTarget(), { result: database, error: null });
    queueMicrotask(() => req.dispatchEvent(new Event("success")));
    return req;
  });
  vi.stubGlobal("window", {});
  vi.stubGlobal("indexedDB", { open });
  vi.stubGlobal("IDBKeyRange", {
    bound: (lower: string, upper: string) => ({ lower, upper }),
  });
  return { thread: storeFor("thread"), index: storeFor("thread-index") };
}

function stubIdleCallbacks(mode: "immediate" | "manual") {
  const queued: Array<() => void> = [];
  let onQueued: (() => void) | undefined;
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    if (mode === "immediate") {
      callback();
    } else {
      queued.push(callback);
      onQueued?.();
    }
    return queued.length;
  });
  vi.stubGlobal("cancelIdleCallback", () => {});
  return {
    nextQueued: () =>
      new Promise<void>((resolve) => {
        onQueued = resolve;
      }),
    flush: () => queued.splice(0).forEach((callback) => callback()),
  };
}

const threadSnapshot = (id: string, title = "Thread") => {
  const fixture = makeThreadProjectionFixture();
  const threadId = ThreadId.make(id);
  return {
    snapshotSequence: 1,
    projection: {
      ...fixture,
      thread: {
        ...fixture.thread,
        id: threadId,
        title,
        lineage: { ...fixture.thread.lineage, rootThreadId: threadId },
      },
    },
  };
};

describe("thread snapshot cache bounds", () => {
  const environmentId = EnvironmentId.make("env-cache");

  it.effect("keeps only the most recently used threads", () =>
    Effect.gen(function* () {
      const stored = makeFakeThreadDatabase();
      stubIdleCallbacks("immediate");

      yield* Effect.gen(function* () {
        const cache = yield* Persistence.EnvironmentCacheStore;
        for (let i = 0; i < 8; i++) {
          yield* cache.saveThread(environmentId, threadSnapshot(`thread-${i}`));
          yield* TestClock.adjust("1 millis");
        }
        // Opening thread-0 again makes it the newest, so thread-1 is the next to go.
        const reopened = yield* cache.loadThread(environmentId, ThreadId.make("thread-0"));
        expect(Option.isSome(reopened)).toBe(true);
        yield* TestClock.adjust("1 millis");
        yield* cache.saveThread(environmentId, threadSnapshot("thread-8"));
        yield* TestClock.adjust("1 millis");
        yield* cache.saveThread(environmentId, threadSnapshot("thread-9"));

        const kept = [0, 3, 4, 5, 6, 7, 8, 9].map((i) => `env-cache:thread-${i}`);
        expect([...stored.thread.keys()].toSorted()).toEqual(kept.toSorted());
        expect([...stored.index.keys()].toSorted()).toEqual(kept.toSorted());
      }).pipe(Effect.provide(ConnectionStorage.layer));
    }),
  );

  it.effect("does not cache a thread over the size cap and drops its older copy", () =>
    Effect.gen(function* () {
      const stored = makeFakeThreadDatabase();
      stubIdleCallbacks("immediate");

      yield* Effect.gen(function* () {
        const cache = yield* Persistence.EnvironmentCacheStore;
        yield* cache.saveThread(environmentId, threadSnapshot("big"));
        expect(stored.thread.size).toBe(1);

        yield* cache.saveThread(
          environmentId,
          threadSnapshot("big", "x".repeat(THREAD_CACHE_MAX_ENTRY_CHARS)),
        );

        expect(stored.thread.size).toBe(0);
        expect(stored.index.size).toBe(0);
        const loaded = yield* cache.loadThread(environmentId, ThreadId.make("big"));
        expect(Option.isNone(loaded)).toBe(true);
      }).pipe(Effect.provide(ConnectionStorage.layer));
    }),
  );

  it.effect("writes a pending save only once the idle callback runs", () =>
    Effect.gen(function* () {
      const stored = makeFakeThreadDatabase();
      const idle = stubIdleCallbacks("manual");

      yield* Effect.gen(function* () {
        const cache = yield* Persistence.EnvironmentCacheStore;
        const queued = idle.nextQueued();
        const save = yield* cache
          .saveThread(environmentId, threadSnapshot("closing"))
          .pipe(Effect.forkChild);
        yield* Effect.promise(() => queued);
        expect(stored.thread.size).toBe(0);

        idle.flush();
        yield* Fiber.join(save);

        expect([...stored.thread.keys()]).toEqual(["env-cache:closing"]);
      }).pipe(Effect.provide(ConnectionStorage.layer));
    }),
  );

  it.effect("lets a delete cancel a save that is still waiting for idle time", () =>
    Effect.gen(function* () {
      const stored = makeFakeThreadDatabase();
      const idle = stubIdleCallbacks("manual");

      yield* Effect.gen(function* () {
        const cache = yield* Persistence.EnvironmentCacheStore;
        const queued = idle.nextQueued();
        const save = yield* cache
          .saveThread(environmentId, threadSnapshot("closing"))
          .pipe(Effect.forkChild);
        yield* Effect.promise(() => queued);

        yield* cache.removeThread(environmentId, ThreadId.make("closing"));
        idle.flush();
        yield* Fiber.join(save);

        expect(stored.thread.size).toBe(0);
        expect(stored.index.size).toBe(0);
      }).pipe(Effect.provide(ConnectionStorage.layer));
    }),
  );

  it.effect("clears one environment's threads and index entries", () =>
    Effect.gen(function* () {
      const stored = makeFakeThreadDatabase();
      stubIdleCallbacks("immediate");

      yield* Effect.gen(function* () {
        const cache = yield* Persistence.EnvironmentCacheStore;
        yield* cache.saveThread(environmentId, threadSnapshot("a"));
        yield* cache.saveThread(EnvironmentId.make("env-other"), threadSnapshot("b"));

        yield* cache.clear(environmentId);

        expect([...stored.thread.keys()]).toEqual(["env-other:b"]);
        expect([...stored.index.keys()]).toEqual(["env-other:b"]);
      }).pipe(Effect.provide(ConnectionStorage.layer));
    }),
  );
});
