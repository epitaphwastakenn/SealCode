import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";

export interface WindowsProcessEntry {
  readonly pid: number;
  readonly parentPid: number;
  /** Creation time as a Windows file time; 0 when Windows does not report it. */
  readonly createdAt: number;
  readonly executablePath: string | null;
}

const LIST_PROCESSES_COMMAND =
  'Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { $created = if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }; Write-Output "$($_.ProcessId)|$($_.ParentProcessId)|$created|$($_.ExecutablePath)" }';

const normalizeWindowsPath = (value: string) =>
  value.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();

export function parseWindowsProcessList(output: string): ReadonlyArray<WindowsProcessEntry> {
  return output.split(/\r?\n/g).flatMap((line) => {
    const [pidRaw, parentRaw, createdRaw, ...pathParts] = line.trim().split("|");
    const pid = Number(pidRaw);
    const parentPid = Number(parentRaw);
    const createdAt = Number(createdRaw);
    const executablePath = pathParts.join("|");
    return Number.isInteger(pid) && pid > 0 && Number.isInteger(parentPid)
      ? [
          {
            pid,
            parentPid,
            createdAt: Number.isFinite(createdAt) ? createdAt : 0,
            executablePath: executablePath === "" ? null : executablePath,
          },
        ]
      : [];
  });
}

/**
 * Roots of runtime trees started from `managedDirectory` whose launcher is gone. A process still
 * owned by a live parent is left alone: its parent predates it, so the parent started it. A dead
 * parent's pid can be reused by a later process, which then postdates the runtime.
 */
export function selectOrphanedRuntimeRoots(
  processes: ReadonlyArray<WindowsProcessEntry>,
  managedDirectory: string,
): ReadonlyArray<number> {
  const prefix = `${normalizeWindowsPath(managedDirectory)}\\`;
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const isRuntime = (entry: WindowsProcessEntry) =>
    entry.executablePath !== null && normalizeWindowsPath(entry.executablePath).startsWith(prefix);
  return processes.flatMap((entry) => {
    if (!isRuntime(entry)) return [];
    const parent = byPid.get(entry.parentPid);
    const ownedByLiveParent =
      parent !== undefined && parent.pid !== entry.pid && parent.createdAt <= entry.createdAt;
    return ownedByLiveParent ? [] : [entry.pid];
  });
}

/**
 * Windows has no process group to signal, and the runtime is spawned detached, so a server that
 * is killed (the desktop app ends its backend with TerminateProcess, and crashes do the same)
 * leaves the whole tree running: a launcher, the agent server and its harness, holding hundreds
 * of megabytes and the unpacked runtime files. Only one server owns a T3 home, so any runtime
 * from its managed directory that no live process owns is a leftover of an earlier server.
 */
export const terminateOrphanedAntigravityRuntimes = Effect.fn(
  "terminateOrphanedAntigravityRuntimes",
)(
  function* (managedDirectory: string) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const listing = yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", LIST_PROCESSES_COMMAND],
            { shell: false, stderr: "ignore" },
          ),
        );
        const [stdout, exitCode] = yield* Effect.all(
          [collectUint8StreamText({ stream: child.stdout, maxBytes: 4_194_304 }), child.exitCode],
          { concurrency: "unbounded" },
        );
        return Number(exitCode) === 0 && !stdout.truncated ? stdout.text : undefined;
      }),
    );
    // A partial table could make a live owner look dead.
    if (listing === undefined) {
      return yield* Effect.logWarning(
        "Could not list processes to find leftover Antigravity runtimes.",
      );
    }
    const roots = selectOrphanedRuntimeRoots(parseWindowsProcessList(listing), managedDirectory);
    for (const pid of roots) {
      const exitCode = yield* Effect.scoped(
        spawner
          .spawn(
            ChildProcess.make("taskkill", ["/PID", String(pid), "/T", "/F"], {
              shell: false,
              stdout: "ignore",
              stderr: "ignore",
            }),
          )
          .pipe(Effect.flatMap((child) => child.exitCode)),
      );
      yield* Effect.logInfo("Stopped a leftover Antigravity runtime from an earlier server.", {
        pid,
        exitCode: Number(exitCode),
      });
    }
  },
  Effect.timeoutOption("20 seconds"),
  Effect.catchCause((cause) =>
    Effect.logWarning("Could not stop leftover Antigravity runtimes.", { cause }),
  ),
  Effect.asVoid,
);
