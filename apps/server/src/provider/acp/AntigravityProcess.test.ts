import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import { preserveAntigravityCleanup, stopAntigravityWorker } from "./AntigravityProcess.ts";

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile }));

describe("Antigravity extraction cleanup", () => {
  it("targets the owned parent's same-executable workers, never the parent tree", async () => {
    execFile.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));
    await stopAntigravityWorker(123);
    const [file, args, options] = execFile.mock.lastCall!;
    expect(file).toBe("powershell.exe");
    expect(options.windowsHide).toBe(true);
    expect(args.at(-1)).toContain("ParentProcessId = 123");
    expect(args.at(-1)).toContain("Where-Object ExecutablePath -EQ $executable");
    expect(args.at(-1)).toContain("taskkill.exe /PID $worker.ProcessId /T /F");
    expect(args.at(-1)).not.toContain("taskkill.exe /PID 123");
    expect(args.at(-1)).toContain("$parent.WaitForExit(30000)");
  });

  it.effect("closes stdin and awaits exit before releasing the process scope", () =>
    Effect.gen(function* () {
      const exited = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
      const eof = yield* Deferred.make<void>();
      let referenced = true;
      let forced = false;
      let released = false;
      const fiber = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              forced = referenced;
              released = true;
            }),
          );
          yield* preserveAntigravityCleanup(
            ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(123),
              isRunning: Effect.succeed(true),
              exitCode: Deferred.await(exited),
              stdin: Sink.onExit(Sink.drain, () => Deferred.succeed(eof, undefined)),
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              kill: () => Effect.die("Must not kill the extraction parent"),
              unref: Effect.sync(() => {
                referenced = false;
                return Effect.void;
              }),
            }),
          );
        }),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(eof);
      expect(released).toBe(false);
      yield* Deferred.succeed(exited, ChildProcessSpawner.ExitCode(0));
      yield* Fiber.join(fiber);
      expect(released).toBe(true);
      expect(forced).toBe(false);
    }),
  );
});
