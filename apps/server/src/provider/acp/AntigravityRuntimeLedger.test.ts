// @effect-diagnostics preferSchemaOverJson:off -- The tests read and write the ledger file as plain JSON.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import { terminateOrphanedAntigravityRuntimes } from "./AntigravityOrphanedRuntimes.ts";
import { makeAntigravityRuntimeLedger, withRuntimeLedger } from "./AntigravityRuntimeLedger.ts";

const managed = "C:\\Users\\Dev\\.t3\\tools\\antigravity-acp";
const launcher = `${managed}\\win32-x64\\versions\\abc\\agy_acp_server.exe`;
const encoder = new TextEncoder();

const handle = (pid: number, stdout = "", exitCode = 0) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(pid),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(stdout)),
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });

/** Answers the process listing with one orphaned runtime (pid 30, parent 5 is gone). */
const processTable = (spawned: Array<string>) =>
  ChildProcessSpawner.make((command) => {
    const { command: executable, args } = command as unknown as {
      readonly command: string;
      readonly args: ReadonlyArray<string>;
    };
    spawned.push(`${executable} ${args.slice(0, 2).join(" ")}`);
    return Effect.succeed(
      executable === "powershell.exe"
        ? handle(1, `4|0|0|\r\n30|5|133000000000000000|${launcher}\r\n`)
        : handle(2),
    );
  });

const setup = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-agy-ledger-" });
  const filePath = path.join(directory, "antigravity-runtimes.json");
  const ledger = yield* makeAntigravityRuntimeLedger(filePath);
  const entries = fileSystem
    .readFileString(filePath)
    .pipe(Effect.map((raw) => (JSON.parse(raw) as { runtimes: Array<{ pid: number }> }).runtimes));
  return { fileSystem, filePath, ledger, entries };
});

describe("the Antigravity runtime ledger", () => {
  it.effect("lists a runtime from its start until its scope closes", () =>
    Effect.gen(function* () {
      const { ledger, entries } = yield* setup;
      const spawner = withRuntimeLedger(processTable([]), ledger);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* spawner.spawn({ command: "powershell.exe", args: [] } as never);
          expect((yield* entries).map((entry) => entry.pid)).toEqual([1]);
        }),
      );

      expect(yield* entries).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("only reports runtimes that an earlier server started", () =>
    Effect.gen(function* () {
      const { fileSystem, filePath, ledger } = yield* setup;
      expect(yield* ledger.leftByEarlierServers).toBeUndefined();

      yield* ledger.record(11);
      expect(yield* ledger.leftByEarlierServers).toEqual([]);

      yield* fileSystem.writeFileString(
        filePath,
        JSON.stringify({
          runtimes: [
            { pid: 11, owner: "1:this-server-is-someone-else" },
            { pid: 12, owner: "2:another" },
          ],
        }),
      );
      expect(yield* ledger.leftByEarlierServers).toEqual([11, 12]);

      yield* ledger.record(13);
      yield* ledger.settleEarlierServers;
      expect(yield* ledger.leftByEarlierServers).toEqual([]);
      yield* ledger.forget(13);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("terminateOrphanedAntigravityRuntimes", () => {
  it.effect("scans once to account for runtimes from before the ledger, then not again", () =>
    Effect.gen(function* () {
      const { ledger, entries } = yield* setup;
      const spawned: Array<string> = [];
      const run = terminateOrphanedAntigravityRuntimes(managed, ledger).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, processTable(spawned)),
      );

      yield* run;
      expect(spawned).toEqual(["powershell.exe -NoProfile -NonInteractive", "taskkill /PID 30"]);
      expect(yield* entries).toEqual([]);

      yield* run;
      expect(spawned).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("scans when an earlier server left a runtime running, but not for its own", () =>
    Effect.gen(function* () {
      const { fileSystem, filePath, ledger, entries } = yield* setup;
      const spawned: Array<string> = [];
      const run = terminateOrphanedAntigravityRuntimes(managed, ledger).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, processTable(spawned)),
      );
      yield* ledger.settleEarlierServers;
      yield* ledger.record(40);
      yield* run;
      expect(spawned).toEqual([]);

      yield* fileSystem.writeFileString(
        filePath,
        JSON.stringify({ runtimes: [{ pid: 30, owner: "1:earlier-server" }] }),
      );
      yield* run;
      expect(spawned).toHaveLength(2);
      expect(yield* entries).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the ledger when the process table could not be read", () =>
    Effect.gen(function* () {
      const { fileSystem, filePath, ledger, entries } = yield* setup;
      yield* fileSystem.writeFileString(
        filePath,
        JSON.stringify({ runtimes: [{ pid: 30, owner: "1:earlier-server" }] }),
      );
      const failing = ChildProcessSpawner.make(() => Effect.succeed(handle(1, "", 1)));
      yield* terminateOrphanedAntigravityRuntimes(managed, ledger).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, failing),
      );
      expect((yield* entries).map((entry) => entry.pid)).toEqual([30]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
