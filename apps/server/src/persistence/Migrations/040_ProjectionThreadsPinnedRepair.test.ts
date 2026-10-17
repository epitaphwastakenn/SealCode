import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationManifest, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("040_ProjectionThreadsPinnedRepair", (it) => {
  it.effect("repairs databases where migration 36 did not add pinned_at", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 39 });
      yield* sql`ALTER TABLE projection_threads DROP COLUMN pinned_at`;
      yield* runMigrations({ toMigrationInclusive: 40 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(columns.some((column) => column.name === "pinned_at"));
      assert.deepStrictEqual(
        migrationManifest.find(([id]) => id === 40),
        [40, "ProjectionThreadsPinnedRepair"],
      );
    }),
  );
});
