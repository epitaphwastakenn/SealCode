# Antigravity ACP extraction cleanup investigation

Verified on Windows on 2026-09-06 against the official `agy_acp_server_1.1.1` executable.

## Cause

The executable uses PyInstaller's two-process onefile layout. Its parent extracts
`_MEI...`, waits for the Python worker, deletes the extraction, and exits. One real
extraction measured **1,250,259,477 bytes** (about 1.16 GiB). PyInstaller documents
that terminating the parent prevents cleanup; terminating only the worker allows
the parent to clean up even after a crash:
https://pyinstaller.org/en/stable/feature-notes.html#onefile-mode-and-temporary-directory-cleanup

SealCode's ACP runtime launches through `ChildProcessSpawner`. On Windows that
spawner's scope finalizer uses `taskkill /PID <parent> /T /F`. This kills the cleanup
parent. Merely changing SIGTERM to another Node signal does not fix Windows
termination. A real initialize/EOF probe also remained alive after stdin closed;
terminating its Python worker subtree allowed the parent to remove the complete
extraction and exit. EOF alone is therefore insufficient for this release.

Historical validation caused the same problem. The September 5 validation log
records `native-acp-smoke.mjs` using `taskkill /T /F`, and a Python authentication
probe using `p.terminate(); p.wait(timeout=10)`. The latter kills just the parent,
orphaning the worker. A later revision changed it to a forced tree kill, which
still prevents extraction cleanup.

The previously reported worker was independently observed as PID 45988, parent
PID 31732 (already absent), with this actual executable path:
`C:\Users\User\AppData\Local\Temp\sealcode-agy-validation-JEmZkc\.antigravity-runtime\1.1.1\agy_acp_server.exe`.
It was left untouched. This attributes that validation process to SealCode, but
does not attribute every historical `_MEI` folder to SealCode; other installations
also use the executable.

## Launch and shutdown paths

| Path | Behavior |
| --- | --- |
| Health/model refresh | `AntigravityAcpProvider` starts a short-lived real runtime inside `Effect.scoped`; periodic status demand can repeat this. |
| Sign-in, sign-in cancellation, logout | `AntigravitySetup` scopes the runtime; cancellation interrupts the flow; logout also stops sessions. |
| Thread connection | `AntigravityAcpAdapter.startSession` retains one runtime and provider session identity per thread. |
| Disconnect/restart | `stopSession` closes the runtime scope; replacing an existing session stops the old scope first. |
| Turn cancellation | `session/cancel` waits for the prompt; it does not normally replace the runtime or extraction. |
| Turn completion/failure | Existing event draining and settlement remain unchanged. |
| Initialization/session failure | The failed start closes its scope, now using the same cleanup-preserving shutdown. |
| Worker crash | The surviving onefile parent can clean up; verified with a real worker termination. |
| Client network disconnection | Does not itself mean provider shutdown; the server retains its sessions. |
| Normal Windows desktop exit/restart | Desktop closes backend stdin and awaits exit before its forced-kill fallback. The backend races desktop stdin EOF against its server lifetime so provider finalizers can run. |
| Backend/app forced tree termination | Finalizers can be bypassed and `_MEI` can still remain. No cleanup guarantee is claimed for this case. |

## Contained mitigation

- `AntigravityProcess.ts` opts Windows Antigravity out of generic forced parent
  termination, closes stdin, and allows one second for ordinary exit. If the
  executable remains alive, a hidden PowerShell helper targets only children of
  the captured PID with the same executable path, terminates those worker trees,
  and waits for the extraction parent to exit. During early cancellation it can
  wait up to 90 seconds for the worker to appear, plus 30 seconds for cleanup.
  Failure is logged; the provider finalizer never deliberately kills the cleanup
  parent as a fallback.
- `AntigravityAcpSupport.ts` installs this behavior only on Windows Antigravity's
  existing spawner boundary. Shared ACP, session identity, event drains, and
  settlement code are unchanged.
- `DesktopBackendManager.ts` and `cli/server.ts` add the Windows stdin EOF shutdown
  handshake. Desktop allows up to 120 seconds before its existing forced-kill
  fallback. Other platforms and WSL's stdin bootstrap keep their prior behavior.

No existing Temp directories were deleted, no running user applications were
terminated, and no periodic cleanup or `_MEI` deletion was added. Validation must
use scoped runtimes with this shutdown policy; do not reuse historical ad hoc
probes that kill the onefile parent.

## Files changed

- `apps/server/src/provider/acp/AntigravityProcess.ts`
- `apps/server/src/provider/acp/AntigravityProcess.test.ts`
- `apps/server/src/provider/acp/AntigravityAcpSupport.ts`
- `apps/server/src/cli/server.ts`
- `apps/server/src/cli/server.test.ts`
- `apps/desktop/src/backend/DesktopBackendManager.ts`
- `apps/desktop/src/backend/DesktopBackendManager.test.ts`
- `docs/user/providers-antigravity.md`
- `docs/internals/antigravity-acp-temp-cleanup.md`

## Validation

Current source was tested using the existing validation installation's dependencies
because this checkout's dependency links are broken. Test resolution mapped
workspace modules to this checkout; the Node mock subprocesses needed the same
dependency mapping. No repository-wide check was run.

- Six repeated real sign-in/start/stop cycles passed in two batches. The recorded
  three-cycle batch measured 1,250,259,477 bytes per active extraction and zero
  `_MEI` directories and owned provider processes after each stop.
- Real cancellation before initialize and real worker-crash cycles passed with
  zero remaining extractions/processes.
- A real authenticated adapter start reached an upstream `session/new: Internal
  error`. Its failed-start cleanup left no extraction or provider process. This
  did **not** verify successful authenticated chat, resume, or restart.
- 58 focused tests passed: 41 process cleanup, desktop EOF, setup, and adapter
  tests plus 17 shared ACP tests;
  session identity, cancellation, and event draining have mocked regression
  coverage. Desktop exit has unit coverage, not an installed Electron exit test.
- Scoped TypeScript checking passed for the process helper, Antigravity factory,
  desktop backend manager, and corresponding process/desktop tests. The broader
  CLI import graph remains blocked by unrelated dependency/type errors. Scoped
  lint passed for the new helper and CLI/desktop changes.

Local evidence is under `.t3/acp-lifecycle-verification/`: `raw.out`, `raw.err`,
`cycles/results.ndjson`, `real.out`, `real2.out`, `edges.out`, `authenticated.err`,
`typecheck-process.log`, and `core-tests.log`. The isolated `_MEI` baseline and final
count were both zero. Global Temp counts were not used for attribution because
the user was concurrently deleting old folders.

## Remaining limits

This is a Windows mitigation for the pinned executable, not an upstream EOF fix.
Normal shutdown can take longer, especially if stopped during extraction. A full
forced tree kill, backend crash, power loss, timeout, or worker-discovery failure
can still leave processes or extractions. Custom Windows executables without this
onefile worker layout are not covered by worker termination. The installed app
was not rebuilt, replaced, or restarted; these source changes require a new build.
