import type { VcsStatusLocalResult } from "@t3tools/contracts";

type WorkingTreeFile = VcsStatusLocalResult["workingTree"]["files"][number];

export type WorkspaceTurnChangeResolution =
  | {
      readonly kind: "owned";
      readonly paths: ReadonlyArray<string>;
    }
  | {
      readonly kind: "ambiguous";
      readonly paths: ReadonlyArray<string>;
    }
  | {
      readonly kind: "unknown";
      readonly paths: ReadonlyArray<string>;
    };

interface TrackedTurn {
  readonly startSnapshot: ReadonlyMap<string, string>;
  readonly claimedPaths: Set<string>;
}

interface WorkspaceState {
  readonly activeTurns: Map<string, TrackedTurn>;
  readonly owners: Map<string, string>;
  readonly ambiguousPaths: Set<string>;
  lastSnapshot: Map<string, string>;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function snapshot(files: ReadonlyArray<WorkingTreeFile>): Map<string, string> {
  return new Map(
    files.map((file) => [normalizePath(file.path), `${file.insertions}:${file.deletions}`]),
  );
}

function changedPaths(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): ReadonlyArray<string> {
  const paths = new Set<string>([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).toSorted();
}

function claimPath(state: WorkspaceState, turnKey: string, path: string): void {
  const currentOwner = state.owners.get(path);
  if (currentOwner === undefined) {
    state.owners.set(path, turnKey);
    state.activeTurns.get(turnKey)?.claimedPaths.add(path);
  } else if (currentOwner === turnKey) {
    state.activeTurns.get(turnKey)?.claimedPaths.add(path);
  } else {
    state.ambiguousPaths.add(path);
    state.activeTurns.get(turnKey)?.claimedPaths.add(path);
  }
}

function markAmbiguousPath(state: WorkspaceState, path: string): void {
  state.ambiguousPaths.add(path);
  for (const turn of state.activeTurns.values()) {
    turn.claimedPaths.add(path);
  }
}

export class WorkspaceTurnChangeTracker {
  readonly #workspaces = new Map<string, WorkspaceState>();

  #finishTrackedTurn(
    workspaceKey: string,
    turnKey: string,
    state: WorkspaceState,
  ): WorkspaceTurnChangeResolution {
    const turn = state.activeTurns.get(turnKey);
    if (turn === undefined) {
      return { kind: "unknown", paths: [] };
    }

    const ownedPaths = [...turn.claimedPaths].toSorted();
    const ambiguousPaths = ownedPaths.filter((path) => state.ambiguousPaths.has(path));
    state.activeTurns.delete(turnKey);
    if (state.activeTurns.size === 0) {
      this.#workspaces.delete(workspaceKey);
    }

    return ambiguousPaths.length > 0
      ? { kind: "ambiguous", paths: ambiguousPaths }
      : { kind: "owned", paths: ownedPaths };
  }

  startTurn(workspaceKey: string, turnKey: string, files: ReadonlyArray<WorkingTreeFile>): void {
    const currentSnapshot = snapshot(files);
    let state = this.#workspaces.get(workspaceKey);
    if (state === undefined) {
      state = {
        activeTurns: new Map(),
        owners: new Map(),
        ambiguousPaths: new Set(),
        lastSnapshot: currentSnapshot,
      };
      this.#workspaces.set(workspaceKey, state);
    } else {
      state.lastSnapshot = currentSnapshot;
    }

    state.activeTurns.set(turnKey, {
      startSnapshot: currentSnapshot,
      claimedPaths: new Set(),
    });
  }

  observeStatus(
    workspaceKey: string,
    turnKey: string,
    files: ReadonlyArray<WorkingTreeFile>,
  ): void {
    const state = this.#workspaces.get(workspaceKey);
    const turn = state?.activeTurns.get(turnKey);
    if (state === undefined || turn === undefined) {
      return;
    }

    const currentSnapshot = snapshot(files);
    const changed = changedPaths(state.lastSnapshot, currentSnapshot);
    if (state.activeTurns.size > 1 && changed.length > 1) {
      for (const path of changed) {
        if (state.owners.get(path) === undefined) {
          markAmbiguousPath(state, path);
        }
      }
    } else {
      for (const path of changed) {
        claimPath(state, turnKey, path);
      }
    }
    state.lastSnapshot = currentSnapshot;
  }

  recordProviderDiff(workspaceKey: string, turnKey: string, paths: ReadonlyArray<string>): void {
    const state = this.#workspaces.get(workspaceKey);
    if (state === undefined || !state.activeTurns.has(turnKey)) {
      return;
    }

    for (const rawPath of paths) {
      claimPath(state, turnKey, normalizePath(rawPath));
    }
  }

  finishTurn(
    workspaceKey: string,
    turnKey: string,
    files: ReadonlyArray<WorkingTreeFile>,
  ): WorkspaceTurnChangeResolution {
    const state = this.#workspaces.get(workspaceKey);
    const turn = state?.activeTurns.get(turnKey);
    if (state === undefined || turn === undefined) {
      return {
        kind: state?.activeTurns.size ? "ambiguous" : "unknown",
        paths: [],
      };
    }

    const currentSnapshot = snapshot(files);
    const changedSinceLastSnapshot = new Set(changedPaths(state.lastSnapshot, currentSnapshot));
    for (const path of changedSinceLastSnapshot) {
      if (state.ambiguousPaths.has(path)) {
        turn.claimedPaths.add(path);
        continue;
      }
      const currentOwner = state.owners.get(path);
      if (currentOwner === turnKey) {
        continue;
      }
      if (currentOwner === undefined && state.activeTurns.size === 1) {
        claimPath(state, turnKey, path);
      } else {
        markAmbiguousPath(state, path);
      }
    }

    for (const path of changedPaths(turn.startSnapshot, currentSnapshot)) {
      if (state.ambiguousPaths.has(path)) {
        turn.claimedPaths.add(path);
        continue;
      }
      const currentOwner = state.owners.get(path);
      if (currentOwner === turnKey || currentOwner !== undefined) {
        // A path already attributed to another active turn was present in the
        // final snapshot before this turn finished; it is not this turn's
        // change unless it changed again during the final refresh above.
        continue;
      }
      if (state.activeTurns.size === 1) {
        claimPath(state, turnKey, path);
      } else {
        markAmbiguousPath(state, path);
      }
    }
    state.lastSnapshot = currentSnapshot;
    return this.#finishTrackedTurn(workspaceKey, turnKey, state);
  }

  finishTurnWithoutStatus(workspaceKey: string, turnKey: string): WorkspaceTurnChangeResolution {
    const state = this.#workspaces.get(workspaceKey);
    if (state === undefined || !state.activeTurns.has(turnKey)) {
      return {
        kind: state?.activeTurns.size ? "ambiguous" : "unknown",
        paths: [],
      };
    }
    return this.#finishTrackedTurn(workspaceKey, turnKey, state);
  }

  abortTurn(workspaceKey: string, turnKey: string): void {
    const state = this.#workspaces.get(workspaceKey);
    if (state === undefined) {
      return;
    }
    state.activeTurns.delete(turnKey);
    if (state.activeTurns.size === 0) {
      this.#workspaces.delete(workspaceKey);
    }
  }
}
