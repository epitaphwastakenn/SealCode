import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { ChildProcessSpawner } from "effect/unstable/process";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);

// The onefile parent owns _MEI cleanup. Killing it (including taskkill /T)
// leaks the extraction. Only terminate its same-executable Python worker.
export const stopAntigravityWorker = (pid: number) =>
  execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `
$ErrorActionPreference = 'Stop'
$parent = Get-Process -Id ${pid}
$executable = $parent.Path
$deadline = [DateTime]::UtcNow.AddSeconds(90)
while (-not $parent.WaitForExit(100)) {
  $workers = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${pid}" |
    Where-Object ExecutablePath -EQ $executable)
  if ($workers.Count -gt 0) {
    foreach ($worker in $workers) {
      & taskkill.exe /PID $worker.ProcessId /T /F
      if ($LASTEXITCODE -ne 0) { throw 'Antigravity worker termination failed' }
    }
    if (-not $parent.WaitForExit(30000)) { throw 'Antigravity extraction cleanup timed out' }
    break
  }
  if ([DateTime]::UtcNow -gt $deadline) { throw 'Antigravity worker startup timed out' }
}
`,
    ],
    { windowsHide: true },
  );

export const preserveAntigravityCleanup = Effect.fn("preserveAntigravityCleanup")(function* (
  child: ChildProcessSpawner.ChildProcessHandle,
) {
  // Disable the generic scope finalizer's force-kill of the onefile parent,
  // including when worker shutdown fails. Keep the failure visible in logs.
  yield* child.unref;
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      if (!(yield* child.isRunning)) return;
      yield* Stream.run(Stream.empty, child.stdin);
      const exited = yield* child.exitCode.pipe(Effect.timeoutOption("1 second"));
      if (Option.isNone(exited)) {
        yield* Effect.tryPromise(() => stopAntigravityWorker(child.pid));
        yield* child.exitCode;
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Antigravity shutdown failed; preserving the extraction cleanup process", {
          pid: child.pid,
          cause,
        }),
      ),
    ),
  );
});
