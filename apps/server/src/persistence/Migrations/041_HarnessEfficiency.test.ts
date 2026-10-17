import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_HarnessEfficiency", (it) => {
  it.effect("indexes projected messages and keeps the FTS projection in sync", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* runMigrations({ toMigrationInclusive: 41 });

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          attachments_json,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          'message-search-1',
          'thread-search-1',
          'turn-search-1',
          'assistant',
          'cache stable prompt assembly',
          NULL,
          0,
          '2026-08-12T00:00:00.000Z',
          '2026-08-12T00:00:00.000Z'
        )
      `;

      const initial = yield* sql<{ readonly messageId: string }>`
        SELECT message_id AS "messageId"
        FROM projection_thread_message_search
        WHERE projection_thread_message_search MATCH 'assembly'
      `;
      assert.deepStrictEqual(initial.map((row) => row.messageId), ["message-search-1"]);

      yield* sql`
        UPDATE projection_thread_messages
        SET text = 'bounded session search'
        WHERE message_id = 'message-search-1'
      `;
      const afterUpdate = yield* sql`
        SELECT message_id
        FROM projection_thread_message_search
        WHERE projection_thread_message_search MATCH 'assembly'
      `;
      assert.strictEqual(afterUpdate.length, 0);

      yield* sql`
        DELETE FROM projection_thread_messages WHERE message_id = 'message-search-1'
      `;
      const afterDelete = yield* sql`
        SELECT message_id
        FROM projection_thread_message_search
        WHERE projection_thread_message_search MATCH 'bounded'
      `;
      assert.strictEqual(afterDelete.length, 0);
    }),
  );
});
