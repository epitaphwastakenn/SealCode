import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("043_CheckpointFileAttributionKnown", (it) => {
  it.effect("repairs the unknown default so captured checkpoint files stay visible", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 42 });
      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json,
          checkpoint_file_attribution
        )
        VALUES (
          'thread-1',
          'turn-1',
          'completed',
          '2026-08-12T00:00:00.000Z',
          '2026-08-12T00:00:01.000Z',
          '2026-08-12T00:00:02.000Z',
          1,
          'checkpoint-1',
          'ready',
          '[{"path":"src/a.ts","kind":"modified","additions":1,"deletions":0}]',
          'unknown'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 43 });

      const rows = yield* sql<{ readonly fileAttribution: string }>`
        SELECT checkpoint_file_attribution AS "fileAttribution"
        FROM projection_turns
        WHERE turn_id = 'turn-1'
      `;
      assert.strictEqual(rows[0]?.fileAttribution, "known");
    }),
  );

  it.effect("leaves empty unknown summaries unknown so revert stays conservative", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 42 });
      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json,
          checkpoint_file_attribution
        )
        VALUES (
          'thread-2',
          'turn-2',
          'completed',
          '2026-08-12T00:00:00.000Z',
          '2026-08-12T00:00:01.000Z',
          '2026-08-12T00:00:02.000Z',
          1,
          'checkpoint-2',
          'ready',
          '[]',
          'unknown'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 43 });

      const rows = yield* sql<{ readonly fileAttribution: string }>`
        SELECT checkpoint_file_attribution AS "fileAttribution"
        FROM projection_turns
        WHERE turn_id = 'turn-2'
      `;
      assert.strictEqual(rows[0]?.fileAttribution, "unknown");
    }),
  );
});
