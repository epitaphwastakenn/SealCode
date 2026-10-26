import * as NodeSqlite from "node:sqlite";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const isNativeSessionId = Schema.is(Schema.String.check(Schema.isUUID(4)));
const decodeSessionMetadata = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ cwd: Schema.String })),
);

// The agent's own step enums. ERROR is what it records for a command that
// failed to run, so the model reads a killed command as a failed one.
const RUN_COMMAND_STEP = 21;
const STEP_RUNNING = 2;
const STEP_ERROR = 7;
const STEP_STATUS_FIELD = 4;

function readVarint(bytes: Uint8Array, offset: number) {
  let value = 0;
  let scale = 1;
  for (let index = offset; index < bytes.length && index < offset + 10; index++) {
    const byte = bytes[index]!;
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return { value, next: index + 1 };
    scale *= 128;
  }
  return undefined;
}

/**
 * The saved step is a protobuf whose top-level field 4 is its status. Returns a copy with that
 * status replaced, or undefined when the payload does not hold `expected` there.
 */
export function replaceAntigravityStepStatus(
  payload: Uint8Array,
  expected: number,
  status: number,
): Uint8Array | undefined {
  let offset = 0;
  while (offset < payload.length) {
    const key = readVarint(payload, offset);
    if (key === undefined) return undefined;
    const field = Math.floor(key.value / 8);
    offset = key.next;
    switch (key.value % 8) {
      case 0: {
        const value = readVarint(payload, offset);
        if (value === undefined) return undefined;
        if (field === STEP_STATUS_FIELD) {
          // Both statuses fit one byte, so the patch keeps every other byte in place.
          if (value.value !== expected || value.next !== offset + 1 || status > 0x7f) {
            return undefined;
          }
          const patched = Uint8Array.from(payload);
          patched[offset] = status;
          return patched;
        }
        offset = value.next;
        break;
      }
      case 1:
        offset += 8;
        break;
      case 2: {
        const length = readVarint(payload, offset);
        if (length === undefined) return undefined;
        offset = length.next + length.value;
        break;
      }
      case 5:
        offset += 4;
        break;
      default:
        return undefined;
    }
  }
  return undefined;
}

function settleOrphanedCommandSteps(filename: string) {
  const database = new NodeSqlite.DatabaseSync(filename);
  try {
    const hasSteps = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'steps'")
      .get();
    if (hasSteps === undefined) return 0;
    const running = database
      .prepare("SELECT idx, step_payload FROM steps WHERE step_type = ? AND status = ?")
      .all(RUN_COMMAND_STEP, STEP_RUNNING);
    const settledSteps = running.flatMap((row) => {
      const payload = row.step_payload;
      if (!(payload instanceof Uint8Array)) return [];
      const patched = replaceAntigravityStepStatus(payload, STEP_RUNNING, STEP_ERROR);
      return patched === undefined ? [] : [{ idx: row.idx ?? null, payload: patched }];
    });
    if (settledSteps.length === 0) return 0;
    const update = database.prepare(
      "UPDATE steps SET status = ?, step_payload = ? WHERE idx = ? AND status = ?",
    );
    let settled = 0;
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const step of settledSteps) {
        settled += Number(update.run(STEP_ERROR, step.payload, step.idx, STEP_RUNNING).changes);
      }
      database.exec("COMMIT");
    } catch (cause) {
      database.exec("ROLLBACK");
      throw cause;
    }
    return settled;
  } finally {
    database.close();
  }
}

/**
 * The agent holds `session/prompt` open while a background command runs, to wake the model with
 * its result. A command killed with its runtime (Stop, steering, a server restart) stays RUNNING
 * in the saved conversation, so after a resume every prompt waits for it forever once the reply
 * ends. Call before resuming or loading the session, when no live runtime owns it.
 */
export const settleOrphanedAntigravityCommands = Effect.fn("settleOrphanedAntigravityCommands")(
  function* (input: { readonly profileDirectory: string; readonly sessionId: string }) {
    if (!isNativeSessionId(input.sessionId)) return;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filename = path.join(
      input.profileDirectory,
      "antigravity-acp",
      "conversations",
      `${input.sessionId}.db`,
    );
    if (!(yield* fs.exists(filename))) return;
    const settled = yield* Effect.try(() => settleOrphanedCommandSteps(filename));
    if (settled > 0) {
      yield* Effect.logInfo("Settled Antigravity commands that died with their runtime.", {
        sessionId: input.sessionId,
        settled,
      });
    }
  },
  Effect.catch((cause) =>
    Effect.logWarning("Could not settle orphaned Antigravity commands.", { cause }),
  ),
);

/** Call after the process closes. The unique temporary cwd proves which session we own. */
export const removeAntigravitySessionFiles = Effect.fn("removeAntigravitySessionFiles")(
  function* (input: {
    readonly profileDirectory: string;
    readonly sessionId: string | undefined;
    readonly cwd: string;
  }) {
    if (input.sessionId === undefined || !isNativeSessionId(input.sessionId)) {
      return;
    }
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const acpDirectory = path.join(input.profileDirectory, "antigravity-acp");
    const base = path.join(acpDirectory, "conversations", input.sessionId);
    if (!(yield* fs.exists(`${base}.meta`))) {
      return;
    }
    const metadata = yield* fs
      .readFileString(`${base}.meta`)
      .pipe(Effect.flatMap(decodeSessionMetadata));
    if (metadata.cwd !== input.cwd) {
      return;
    }
    for (const suffix of [".db", ".db-wal", ".db-shm", ".db-journal", ".meta"]) {
      yield* fs.remove(`${base}${suffix}`, { force: true });
    }
    yield* fs.remove(path.join(acpDirectory, "brain", input.sessionId), {
      recursive: true,
      force: true,
    });
  },
  Effect.catch(() => Effect.logWarning("Could not remove temporary Antigravity session files.")),
);

/** Sweep only private runtimes before launch; Windows does not protect live extracted data files from deletion. */
export const removeAntigravityRuntimeTempDirs = Effect.fn("removeAntigravityRuntimeTempDirs")(
  function* (tempDirectory: string) {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(tempDirectory, { recursive: true, force: true });
  },
  Effect.catch(() =>
    Effect.logWarning("Could not remove leftover Antigravity runtime temp files."),
  ),
);
