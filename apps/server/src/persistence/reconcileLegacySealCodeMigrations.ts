import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import ProjectionThreadsPinned from "./Migrations/036_ProjectionThreadsPinned.ts";
import ProjectionTurnsKeysetIndex from "./Migrations/037_ProjectionTurnsKeysetIndex.ts";
import ProjectionProjectFaviconPath from "./Migrations/040_ProjectionProjectFaviconPath.ts";
import AuthSessionClientConnection from "./Migrations/041_AuthSessionClientConnection.ts";
import ProjectionThreadLinkedPullRequest from "./Migrations/042_ProjectionThreadLinkedPullRequest.ts";
import ProjectionThreadsUnsettledAt from "./Migrations/043_ProjectionThreadsUnsettledAt.ts";

// Harp 1.x recorded its own migrations under ids that main assigns to other
// schema. The migrator skips every recorded id regardless of name, so main's
// columns and indexes for those ids never existed and later migrations fail
// against them. Main's migrations at these ids only add what is missing, so
// running them over a Harp database is safe.
const LEGACY_SEALCODE_MIGRATIONS = [
  {
    id: 36,
    legacyName: "MultiProviderThreadSessions",
    name: "ProjectionThreadsPinned",
    run: ProjectionThreadsPinned,
  },
  {
    id: 37,
    legacyName: "ProjectionThreadSessionEventSequence",
    name: "ProjectionTurnsKeysetIndex",
    run: ProjectionTurnsKeysetIndex,
  },
  {
    id: 40,
    legacyName: "ProjectionThreadsPinnedRepair",
    name: "ProjectionProjectFaviconPath",
    run: ProjectionProjectFaviconPath,
  },
  {
    id: 41,
    legacyName: "HarnessEfficiency",
    name: "AuthSessionClientConnection",
    run: AuthSessionClientConnection,
  },
  {
    id: 42,
    legacyName: "CheckpointFileAttribution",
    name: "ProjectionThreadLinkedPullRequest",
    run: ProjectionThreadLinkedPullRequest,
  },
  {
    id: 43,
    legacyName: "CheckpointFileAttributionKnown",
    name: "ProjectionThreadsUnsettledAt",
    run: ProjectionThreadsUnsettledAt,
  },
] as const;

// Harp 1.x kept one row per provider instance in these tables. Main keys
// them by thread alone and upserts with ON CONFLICT (thread_id), which fails
// outright against the composite key, so keep each thread's latest row.
const LEGACY_COMPOSITE_KEY_TABLES = [
  { table: "provider_session_runtime", latestColumn: "last_seen_at" },
  { table: "projection_thread_sessions", latestColumn: "updated_at" },
] as const;

const rekeyLegacyCompositeTable = Effect.fn("rekeyLegacyCompositeTable")(function* (input: {
  readonly table: string;
  readonly latestColumn: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{
    readonly name: string;
    readonly type: string;
    readonly notnull: number;
    readonly dflt_value: string | null;
    readonly pk: number;
  }>`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(${input.table})`;
  const keyColumns = columns.filter((column) => column.pk > 0).map((column) => column.name);
  if (keyColumns.length <= 1 || !keyColumns.includes("thread_id")) return false;
  const indexes = yield* sql<{ readonly sql: string }>`
    SELECT sql FROM sqlite_master
    WHERE type = 'index' AND tbl_name = ${input.table} AND sql IS NOT NULL
  `;
  const rebuilt = `${input.table}_sealcode_rekey`;
  const definitions = columns.map((column) =>
    [
      `"${column.name}"`,
      column.type,
      column.name === "thread_id" ? "PRIMARY KEY" : "",
      column.notnull && column.name !== "thread_id" ? "NOT NULL" : "",
      column.dflt_value === null ? "" : `DEFAULT ${column.dflt_value}`,
    ]
      .filter((part) => part.length > 0)
      .join(" "),
  );
  const columnList = columns.map((column) => `"${column.name}"`).join(", ");
  yield* sql.unsafe(`CREATE TABLE "${rebuilt}" (${definitions.join(", ")})`);
  yield* sql.unsafe(`
    INSERT INTO "${rebuilt}" (${columnList})
    SELECT ${columnList} FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY thread_id ORDER BY "${input.latestColumn}" DESC
      ) AS sealcode_rank
      FROM "${input.table}"
    )
    WHERE sealcode_rank = 1
  `);
  yield* sql.unsafe(`DROP TABLE "${input.table}"`);
  yield* sql.unsafe(`ALTER TABLE "${rebuilt}" RENAME TO "${input.table}"`);
  for (const index of indexes) yield* sql.unsafe(index.sql);
  return true;
});

export const reconcileLegacySealCodeMigrations = Effect.fn("reconcileLegacySealCodeMigrations")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const tables = yield* sql`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
        `;
        if (tables.length === 0) return [];
        const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id BETWEEN 36 AND 43
        `;
        const recordedNames = new Map(history.map((row) => [row.migration_id, row.name]));
        const executed: Array<readonly [number, string]> = [];
        if (recordedNames.get(36) === "MultiProviderThreadSessions") {
          for (const table of LEGACY_COMPOSITE_KEY_TABLES) {
            yield* rekeyLegacyCompositeTable(table);
          }
        }
        for (const migration of LEGACY_SEALCODE_MIGRATIONS) {
          if (recordedNames.get(migration.id) !== migration.legacyName) continue;
          yield* migration.run;
          yield* sql`
            UPDATE effect_sql_migrations SET name = ${migration.name}
            WHERE migration_id = ${migration.id} AND name = ${migration.legacyName}
          `;
          executed.push([migration.id, migration.name]);
        }
        return executed;
      }),
    );
  },
);
