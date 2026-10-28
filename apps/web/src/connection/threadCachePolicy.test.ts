import { describe, expect, it } from "vite-plus/test";

import {
  makeThreadSaveTracker,
  selectThreadCacheEvictions,
  THREAD_CACHE_MAX_ENTRIES,
} from "./threadCachePolicy";

const entry = (key: string, lastUsedAt: number) => ({ key, lastUsedAt });

describe("selectThreadCacheEvictions", () => {
  it("keeps everything while the cache fits", () => {
    const entries = Array.from({ length: THREAD_CACHE_MAX_ENTRIES }, (_, i) => entry(`k${i}`, i));
    expect(selectThreadCacheEvictions(entries, "k0")).toEqual([]);
  });

  it("evicts the least recently used entries first", () => {
    const entries = [entry("a", 5), entry("b", 1), entry("c", 9), entry("d", 3)];
    expect(selectThreadCacheEvictions(entries, "c", 2)).toEqual(["d", "b"]);
  });

  it("never evicts the entry that was just written, even on a timestamp tie", () => {
    const entries = [entry("old", 7), entry("fresh", 7), entry("older", 7)];
    expect(selectThreadCacheEvictions(entries, "fresh", 1)).not.toContain("fresh");
    expect(selectThreadCacheEvictions(entries, "fresh", 1)).toHaveLength(2);
  });
});

describe("makeThreadSaveTracker", () => {
  it("lets a newer save, a cancel or a finish end the older token", () => {
    const tracker = makeThreadSaveTracker();
    const first = tracker.begin("env:a");
    expect(tracker.isCurrent("env:a", first)).toBe(true);

    const second = tracker.begin("env:a");
    expect(tracker.isCurrent("env:a", first)).toBe(false);
    expect(tracker.isCurrent("env:a", second)).toBe(true);

    tracker.cancel("env:a");
    expect(tracker.isCurrent("env:a", second)).toBe(false);
  });

  it("cancels every pending save of an environment and leaves the others", () => {
    const tracker = makeThreadSaveTracker();
    const mine = tracker.begin("env-1:a");
    const other = tracker.begin("env-2:a");
    tracker.cancelWithPrefix("env-1:");
    expect(tracker.isCurrent("env-1:a", mine)).toBe(false);
    expect(tracker.isCurrent("env-2:a", other)).toBe(true);
  });

  it("skips a thread known to be oversized until its sequence regresses", () => {
    const tracker = makeThreadSaveTracker();
    tracker.rememberOversized("env:a", 100);
    expect(tracker.isKnownOversized("env:a", 100)).toBe(true);
    expect(tracker.isKnownOversized("env:a", 140)).toBe(true);
    expect(tracker.isKnownOversized("env:a", 40)).toBe(false);

    tracker.cancel("env:a");
    expect(tracker.isKnownOversized("env:a", 140)).toBe(false);
  });
});
