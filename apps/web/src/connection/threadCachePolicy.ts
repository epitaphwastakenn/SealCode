// Thread snapshots are cached as one JSON string each. These limits keep the cache from
// growing (and being decoded on open) without bound; a miss falls back to the server snapshot.
export const THREAD_CACHE_MAX_ENTRIES = 8;
export const THREAD_CACHE_MAX_ENTRY_CHARS = 1_000_000;

const IDLE_ENCODE_TIMEOUT_MS = 2_000;
const OVERSIZED_MEMO_LIMIT = 64;

export interface ThreadCacheIndexEntry {
  readonly key: string;
  readonly lastUsedAt: number;
}

/** Keys to drop so that at most `maxEntries` remain, least recently used first. */
export function selectThreadCacheEvictions(
  entries: ReadonlyArray<ThreadCacheIndexEntry>,
  keep: string,
  maxEntries: number = THREAD_CACHE_MAX_ENTRIES,
): ReadonlyArray<string> {
  if (entries.length <= maxEntries) return [];
  return entries
    .toSorted((a, b) => {
      // The entry just written survives even when timestamps tie.
      if (a.key === keep) return -1;
      if (b.key === keep) return 1;
      return b.lastUsedAt - a.lastUsedAt;
    })
    .slice(maxEntries)
    .map((entry) => entry.key);
}

/** Runs `task` when the browser is idle, or shortly after where idle callbacks do not exist. */
export function runWhenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(task, { timeout: IDLE_ENCODE_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(task, 50);
  return () => clearTimeout(timer);
}

/**
 * Saves wait for an idle moment before encoding, so a delete or a newer save for the same
 * key can overtake them. A save only writes while its token is still the current one.
 */
export function makeThreadSaveTracker() {
  const current = new Map<string, object>();
  const oversized = new Map<string, number>();

  return {
    begin(key: string): object {
      const token = {};
      current.set(key, token);
      return token;
    },
    isCurrent: (key: string, token: object) => current.get(key) === token,
    finish(key: string, token: object) {
      if (current.get(key) === token) current.delete(key);
    },
    cancel(key: string) {
      current.delete(key);
      oversized.delete(key);
    },
    cancelWithPrefix(prefix: string) {
      for (const key of current.keys()) {
        if (key.startsWith(prefix)) current.delete(key);
      }
      for (const key of oversized.keys()) {
        if (key.startsWith(prefix)) oversized.delete(key);
      }
    },
    /** A thread only grows, so one that was too big stays skipped until it is rebuilt. */
    rememberOversized(key: string, snapshotSequence: number) {
      oversized.delete(key);
      oversized.set(key, snapshotSequence);
      if (oversized.size > OVERSIZED_MEMO_LIMIT) {
        const oldest = oversized.keys().next();
        if (!oldest.done) oversized.delete(oldest.value);
      }
    },
    isKnownOversized(key: string, snapshotSequence: number) {
      const recorded = oversized.get(key);
      return recorded !== undefined && snapshotSequence >= recorded;
    },
  };
}
