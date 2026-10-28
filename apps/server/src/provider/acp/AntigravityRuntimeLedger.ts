// @effect-diagnostics nodeBuiltinImport:off -- The owner id is fixed once at module load, before any Effect runtime exists.
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ChildProcessSpawner } from "effect/process";

const LedgerFile = Schema.Struct({
  runtimes: Schema.Array(Schema.Struct({ pid: Schema.Number, owner: Schema.String })),
});
const ledgerFileJson = Schema.fromJsonString(LedgerFile);
const decodeLedgerFile = Schema.decodeUnknownOption(ledgerFileJson);
const encodeLedgerFile = Schema.encodeSync(ledgerFileJson);

/** Names this server process. A pid alone repeats across restarts. */
const OWNER = `${process.pid}:${NodeCrypto.randomUUID()}`;

// Every ledger in the process edits the same few files; one lock keeps their writes whole.
const ledgerLock = Semaphore.makeUnsafe(1);

/**
 * The agent runtimes this server started and has not yet seen exit. Windows ends the backend with
 * TerminateProcess and the runtimes outlive it, so an entry still here at the next start marks a
 * server that died with a runtime running. Without one there is nothing to look for, and the
 * process table scan that finds orphans can be skipped.
 */
export interface AntigravityRuntimeLedger {
  readonly record: (pid: number) => Effect.Effect<void>;
  readonly forget: (pid: number) => Effect.Effect<void>;
  /**
   * Runtimes started by earlier servers, or undefined when no ledger exists yet (every runtime
   * from before the ledger is then unaccounted for).
   */
  readonly leftByEarlierServers: Effect.Effect<ReadonlyArray<number> | undefined>;
  /** Drops earlier servers' entries and creates the ledger if it is missing. */
  readonly settleEarlierServers: Effect.Effect<void>;
}

export const makeAntigravityRuntimeLedger = Effect.fn("makeAntigravityRuntimeLedger")(function* (
  filePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const read = fileSystem.readFileString(filePath).pipe(
    Effect.map((raw) => decodeLedgerFile(raw)),
    // A corrupt ledger cannot say what is outstanding, so it is treated as missing.
    Effect.orElseSucceed(() => Option.none<typeof LedgerFile.Type>()),
  );
  const write = (runtimes: typeof LedgerFile.Type.runtimes) =>
    writeFileStringAtomically({
      filePath,
      contents: `${encodeLedgerFile({ runtimes })}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.ignore({ log: true }),
    );
  const edit = (
    change: (runtimes: typeof LedgerFile.Type.runtimes) => typeof LedgerFile.Type.runtimes,
  ) =>
    ledgerLock.withPermits(1)(
      read.pipe(
        Effect.flatMap((current) =>
          write(change(Option.isSome(current) ? current.value.runtimes : [])),
        ),
      ),
    );

  return {
    record: (pid) =>
      edit((runtimes) => [...runtimes.filter((entry) => entry.pid !== pid), { pid, owner: OWNER }]),
    forget: (pid) => edit((runtimes) => runtimes.filter((entry) => entry.pid !== pid)),
    leftByEarlierServers: ledgerLock.withPermits(1)(
      read.pipe(
        Effect.map((current) =>
          Option.isNone(current)
            ? undefined
            : current.value.runtimes
                .filter((entry) => entry.owner !== OWNER)
                .map((entry) => entry.pid),
        ),
      ),
    ),
    settleEarlierServers: edit((runtimes) => runtimes.filter((entry) => entry.owner === OWNER)),
  } satisfies AntigravityRuntimeLedger;
});

/** Spawns through `spawner`, listing each child in the ledger from its start until its scope closes. */
export const withRuntimeLedger = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  ledger: AntigravityRuntimeLedger,
): ChildProcessSpawner.ChildProcessSpawner["Service"] =>
  ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      const started = yield* Ref.make<number | undefined>(undefined);
      // Registered before the spawn so it runs after the spawner has ended the process.
      yield* Effect.addFinalizer(() =>
        Ref.get(started).pipe(
          Effect.flatMap((pid) => (pid === undefined ? Effect.void : ledger.forget(pid))),
        ),
      );
      const handle = yield* spawner.spawn(command);
      const pid = Number(handle.pid);
      yield* ledger.record(pid);
      yield* Ref.set(started, pid);
      return handle;
    }),
  );
