import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";

// The shape Harp 1.x left behind: its own names at main's ids 36, 37 and
// 40–43, and per-provider-instance rows keyed by (thread_id, instance).
const seedSealCodeDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations({ toMigrationInclusive: 39 });
  yield* sql`UPDATE effect_sql_migrations SET name = 'MultiProviderThreadSessions' WHERE migration_id = 36`;
  yield* sql`UPDATE effect_sql_migrations SET name = 'ProjectionThreadSessionEventSequence' WHERE migration_id = 37`;
  yield* sql`
    INSERT INTO effect_sql_migrations (migration_id, name) VALUES
      (40, 'ProjectionThreadsPinnedRepair'),
      (41, 'HarnessEfficiency'),
      (42, 'CheckpointFileAttribution'),
      (43, 'CheckpointFileAttributionKnown')
  `;
  yield* sql`DROP TABLE provider_session_runtime`;
  yield* sql`
    CREATE TABLE provider_session_runtime (
      thread_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      adapter_key TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      status TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resume_cursor_json TEXT,
      runtime_payload_json TEXT,
      PRIMARY KEY (thread_id, provider_instance_id)
    )
  `;
  yield* sql`CREATE INDEX idx_provider_session_runtime_status ON provider_session_runtime(status)`;
  yield* sql`
    INSERT INTO provider_session_runtime
      (thread_id, provider_name, provider_instance_id, adapter_key, status, last_seen_at)
    VALUES
      ('thread-a', 'codex', 'codex', 'codex', 'stopped', '2026-08-01T00:00:00.000Z'),
      ('thread-a', 'claudeAgent', 'claudeAgent', 'claudeAgent', 'stopped', '2026-08-02T00:00:00.000Z'),
      ('thread-b', 'codex', 'codex', 'codex', 'stopped', '2026-08-03T00:00:00.000Z')
  `;
});

describe("Harp 1.x upgrade", () => {
  it.effect("runs main's schema for ids Harp reused and keeps one session per thread", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedSealCodeDatabase;

      const executed = yield* runMigrations();
      assert.deepStrictEqual(executed.slice(0, 6), [
        [36, "ProjectionThreadsPinned"],
        [37, "ProjectionTurnsKeysetIndex"],
        [40, "ProjectionProjectFaviconPath"],
        [41, "AuthSessionClientConnection"],
        [42, "ProjectionThreadLinkedPullRequest"],
        [43, "ProjectionThreadsUnsettledAt"],
      ]);
      assert.deepStrictEqual(yield* runMigrations(), []);

      const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        history.map((row) => [row.migration_id, row.name] as const),
        migrationManifest,
      );
      const projectColumns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('projection_projects')
      `;
      assert.include(
        projectColumns.map((column) => column.name),
        "favicon_path",
      );

      const keyColumns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('provider_session_runtime') WHERE pk > 0
      `;
      assert.deepStrictEqual(
        keyColumns.map((column) => column.name),
        ["thread_id"],
      );
      assert.deepStrictEqual(
        yield* sql`
          SELECT thread_id, provider_instance_id FROM provider_session_runtime ORDER BY thread_id
        `,
        [
          { thread_id: "thread-a", provider_instance_id: "claudeAgent" },
          { thread_id: "thread-b", provider_instance_id: "codex" },
        ],
      );
      assert.lengthOf(
        yield* sql`
          SELECT name FROM sqlite_master
          WHERE type = 'index' AND name = 'idx_provider_session_runtime_status'
        `,
        1,
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
