import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { expect } from "vite-plus/test";

import { settleOrphanedAntigravityCommands } from "./AntigravitySessionFiles.ts";

const SESSION_ID = "51e9e582-01b8-4e34-915a-46e5e50344c2";
const RUN_COMMAND = 21;
const PLANNER_RESPONSE = 15;
const RUNNING = 2;
const DONE = 3;
const ERROR = 7;

const varint = (input: number) => {
  const bytes: Array<number> = [];
  let value = input;
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
  return bytes;
};
const varintField = (field: number, value: number) => [...varint(field * 8), ...varint(value)];
const bytesField = (field: number, bytes: ReadonlyArray<number>) => [
  ...varint(field * 8 + 2),
  ...varint(bytes.length),
  ...bytes,
];
const text = (value: string) => [...new TextEncoder().encode(value)];

// Shaped like the agent's saved steps: the metadata message ahead of the
// top-level status carries a field 4 of its own, which must stay as it is.
const stepPayload = (type: number, status: number) =>
  Uint8Array.from([
    ...varintField(1, type),
    ...bytesField(5, [...varintField(4, RUNNING), ...bytesField(1, text("call_2769356"))]),
    ...varintField(4, status),
    ...bytesField(20, text(SESSION_ID)),
  ]);

const writeConversation = (
  filename: string,
  steps: ReadonlyArray<{ idx: number; type: number; status: number; payloadStatus: number }>,
) => {
  const database = new NodeSqlite.DatabaseSync(filename);
  try {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec(
      "CREATE TABLE `steps` (`idx` integer,`step_type` integer NOT NULL DEFAULT 0,`status` integer NOT NULL DEFAULT 0,`has_subtrajectory` numeric NOT NULL DEFAULT false,`metadata` blob,`error_details` blob,`permissions` blob,`task_details` blob,`render_info` blob,`step_payload` blob,`step_format` integer NOT NULL DEFAULT 0,PRIMARY KEY (`idx`))",
    );
    const insert = database.prepare(
      "INSERT INTO steps (idx, step_type, status, step_payload) VALUES (?, ?, ?, ?)",
    );
    for (const step of steps) {
      insert.run(step.idx, step.type, step.status, stepPayload(step.type, step.payloadStatus));
    }
  } finally {
    database.close();
  }
};

const readSteps = (filename: string) => {
  const database = new NodeSqlite.DatabaseSync(filename, { readOnly: true });
  try {
    return database
      .prepare("SELECT idx, status, step_payload FROM steps ORDER BY idx")
      .all()
      .map((row) => ({
        idx: row.idx,
        status: row.status,
        payload: Uint8Array.from(row.step_payload as Uint8Array),
      }));
  } finally {
    database.close();
  }
};

const makeProfile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const profileDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-antigravity-steps-" });
  const conversations = path.join(profileDirectory, "antigravity-acp", "conversations");
  yield* fs.makeDirectory(conversations, { recursive: true });
  return { fs, profileDirectory, conversations, path };
});

it.layer(NodeServices.layer)("settleOrphanedAntigravityCommands", (it) => {
  it.effect("marks a command its dead runtime left running as failed", () =>
    Effect.gen(function* () {
      const { profileDirectory, conversations, path } = yield* makeProfile;
      const filename = path.join(conversations, `${SESSION_ID}.db`);
      writeConversation(filename, [
        { idx: 0, type: RUN_COMMAND, status: RUNNING, payloadStatus: RUNNING },
        { idx: 1, type: RUN_COMMAND, status: DONE, payloadStatus: DONE },
        { idx: 2, type: PLANNER_RESPONSE, status: RUNNING, payloadStatus: RUNNING },
        // A row whose saved step disagrees with its status column is not ours to guess at.
        { idx: 3, type: RUN_COMMAND, status: RUNNING, payloadStatus: DONE },
      ]);

      yield* settleOrphanedAntigravityCommands({ profileDirectory, sessionId: SESSION_ID });

      expect(readSteps(filename)).toEqual([
        { idx: 0, status: ERROR, payload: stepPayload(RUN_COMMAND, ERROR) },
        { idx: 1, status: DONE, payload: stepPayload(RUN_COMMAND, DONE) },
        { idx: 2, status: RUNNING, payload: stepPayload(PLANNER_RESPONSE, RUNNING) },
        { idx: 3, status: RUNNING, payload: stepPayload(RUN_COMMAND, DONE) },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("never creates a conversation or follows an unsafe session id", () =>
    Effect.gen(function* () {
      const { fs, profileDirectory, conversations, path } = yield* makeProfile;

      yield* settleOrphanedAntigravityCommands({ profileDirectory, sessionId: SESSION_ID });
      yield* settleOrphanedAntigravityCommands({ profileDirectory, sessionId: "../../outside" });

      expect(yield* fs.readDirectory(conversations)).toEqual([]);
      expect(yield* fs.exists(path.join(profileDirectory, "outside.db"))).toBe(false);
    }).pipe(Effect.scoped),
  );
});
