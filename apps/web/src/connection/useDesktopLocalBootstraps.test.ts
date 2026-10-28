import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { desktopLocalBootstrapsAtom } from "./useDesktopLocalBootstraps";

const wsl: DesktopEnvironmentBootstrap = {
  id: "wsl:default",
  label: "WSL",
  runningDistro: "Ubuntu",
  httpBaseUrl: "http://127.0.0.1:4000",
  wsBaseUrl: "ws://127.0.0.1:4000",
  bootstrapToken: "bootstrap-1",
};

function mountWithBridge() {
  let entries: DesktopEnvironmentBootstrap[] = [];
  let notify: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const reads = vi.fn(() => entries.map((entry) => ({ ...entry })));
  vi.stubGlobal("window", {
    desktopBridge: {
      getLocalEnvironmentBootstraps: reads,
      onLocalEnvironmentBootstrapsChanged: (listener: () => void) => {
        notify = listener;
        return unsubscribe;
      },
    },
  });
  // Node removal runs on the registry's scheduler; flushing it runs the atom's finalizers.
  const scheduled: Array<() => void> = [];
  const registry = AtomRegistry.make({
    scheduleTask: (task) => {
      scheduled.push(task);
      return () => {};
    },
  });
  const release = registry.mount(desktopLocalBootstrapsAtom);
  return {
    registry,
    reads,
    unsubscribe,
    publish: (next: DesktopEnvironmentBootstrap[]) => {
      entries = next;
      notify?.();
    },
    unmount: () => {
      release();
      for (const task of scheduled.splice(0)) task();
    },
  };
}

describe("useDesktopLocalBootstraps", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("re-reads on the shell's change notification and never on a timer", () => {
    vi.useFakeTimers();
    const { registry, reads, publish } = mountWithBridge();
    expect(registry.get(desktopLocalBootstrapsAtom)).toEqual([]);
    expect(reads).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * 60_000);
    expect(reads).toHaveBeenCalledTimes(1);

    publish([wsl]);
    expect(registry.get(desktopLocalBootstrapsAtom)).toEqual([wsl]);
    expect(reads).toHaveBeenCalledTimes(2);

    publish([]);
    expect(registry.get(desktopLocalBootstrapsAtom)).toEqual([]);
  });

  it("keeps the same snapshot when a notification finds nothing new", () => {
    const { registry, publish } = mountWithBridge();
    publish([wsl]);
    const snapshot = registry.get(desktopLocalBootstrapsAtom);

    publish([wsl]);
    expect(registry.get(desktopLocalBootstrapsAtom)).toBe(snapshot);
  });

  it("stops listening when the last reader leaves", () => {
    const { unsubscribe, unmount } = mountWithBridge();
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
