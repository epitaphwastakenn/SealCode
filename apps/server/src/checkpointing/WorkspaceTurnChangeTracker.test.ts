import { describe, expect, it } from "vite-plus/test";

import { WorkspaceTurnChangeTracker } from "./WorkspaceTurnChangeTracker.ts";

function files(...paths: ReadonlyArray<string>) {
  return paths.map((path) => ({ path, insertions: 1, deletions: 0 }));
}

describe("WorkspaceTurnChangeTracker", () => {
  it("attributes a single turn's observed changes", () => {
    const tracker = new WorkspaceTurnChangeTracker();

    tracker.startTurn("workspace", "thread-a:turn-1", files());
    tracker.observeStatus("workspace", "thread-a:turn-1", files("src/a.ts"));

    expect(tracker.finishTurn("workspace", "thread-a:turn-1", files("src/a.ts"))).toEqual({
      kind: "owned",
      paths: ["src/a.ts"],
    });
  });

  it("keeps disjoint concurrent changes attributable to their turns", () => {
    const tracker = new WorkspaceTurnChangeTracker();

    tracker.startTurn("workspace", "thread-a:turn-1", files());
    tracker.startTurn("workspace", "thread-b:turn-1", files());
    tracker.observeStatus("workspace", "thread-a:turn-1", files("src/a.ts"));
    tracker.observeStatus("workspace", "thread-b:turn-1", files("src/a.ts", "src/b.ts"));

    expect(
      tracker.finishTurn("workspace", "thread-a:turn-1", files("src/a.ts", "src/b.ts")),
    ).toEqual({ kind: "owned", paths: ["src/a.ts"] });
    expect(
      tracker.finishTurn("workspace", "thread-b:turn-1", files("src/a.ts", "src/b.ts")),
    ).toEqual({ kind: "owned", paths: ["src/b.ts"] });
  });

  it("withholds a path claimed by two concurrent turns", () => {
    const tracker = new WorkspaceTurnChangeTracker();

    tracker.startTurn("workspace", "thread-a:turn-1", files());
    tracker.startTurn("workspace", "thread-b:turn-1", files());
    tracker.recordProviderDiff("workspace", "thread-a:turn-1", ["src/shared.ts"]);
    tracker.recordProviderDiff("workspace", "thread-b:turn-1", ["src/shared.ts"]);

    expect(tracker.finishTurn("workspace", "thread-a:turn-1", files("src/shared.ts"))).toEqual({
      kind: "ambiguous",
      paths: ["src/shared.ts"],
    });
  });

  it("withholds un-attributed changes when another turn is active", () => {
    const tracker = new WorkspaceTurnChangeTracker();

    tracker.startTurn("workspace", "thread-a:turn-1", files());
    tracker.startTurn("workspace", "thread-b:turn-1", files());

    expect(tracker.finishTurn("workspace", "thread-a:turn-1", files("src/unknown.ts"))).toEqual({
      kind: "ambiguous",
      paths: ["src/unknown.ts"],
    });
    expect(tracker.finishTurn("workspace", "thread-b:turn-1", files("src/unknown.ts"))).toEqual({
      kind: "ambiguous",
      paths: ["src/unknown.ts"],
    });
  });

  it("withholds multiple changes observed in one concurrent status snapshot", () => {
    const tracker = new WorkspaceTurnChangeTracker();

    tracker.startTurn("workspace", "thread-a:turn-1", files());
    tracker.startTurn("workspace", "thread-b:turn-1", files());
    tracker.observeStatus("workspace", "thread-a:turn-1", files("src/a.ts", "src/b.ts"));

    expect(
      tracker.finishTurn("workspace", "thread-a:turn-1", files("src/a.ts", "src/b.ts")),
    ).toEqual({ kind: "ambiguous", paths: ["src/a.ts", "src/b.ts"] });
    expect(
      tracker.finishTurn("workspace", "thread-b:turn-1", files("src/a.ts", "src/b.ts")),
    ).toEqual({ kind: "ambiguous", paths: ["src/a.ts", "src/b.ts"] });
  });

  it("preserves provider-attributed paths when the final status refresh fails", () => {
    const tracker = new WorkspaceTurnChangeTracker();

    tracker.startTurn("workspace", "thread-a:turn-1", files());
    tracker.recordProviderDiff("workspace", "thread-a:turn-1", ["src/a.ts"]);

    expect(tracker.finishTurnWithoutStatus("workspace", "thread-a:turn-1")).toEqual({
      kind: "owned",
      paths: ["src/a.ts"],
    });
  });
});
