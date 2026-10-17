import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS projection_thread_message_search USING fts5(
      message_id UNINDEXED,
      thread_id UNINDEXED,
      role UNINDEXED,
      text,
      created_at UNINDEXED
    )
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS projection_thread_message_search_insert
    AFTER INSERT ON projection_thread_messages
    BEGIN
      INSERT INTO projection_thread_message_search(message_id, thread_id, role, text, created_at)
      VALUES (NEW.message_id, NEW.thread_id, NEW.role, NEW.text, NEW.created_at);
    END
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS projection_thread_message_search_update
    AFTER UPDATE ON projection_thread_messages
    BEGIN
      DELETE FROM projection_thread_message_search WHERE message_id = OLD.message_id;
      INSERT INTO projection_thread_message_search(message_id, thread_id, role, text, created_at)
      VALUES (NEW.message_id, NEW.thread_id, NEW.role, NEW.text, NEW.created_at);
    END
  `;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS projection_thread_message_search_delete
    AFTER DELETE ON projection_thread_messages
    BEGIN
      DELETE FROM projection_thread_message_search WHERE message_id = OLD.message_id;
    END
  `;

  yield* sql`
    INSERT INTO projection_thread_message_search(message_id, thread_id, role, text, created_at)
    SELECT message_id, thread_id, role, text, created_at
    FROM projection_thread_messages
    WHERE message_id NOT IN (
      SELECT message_id FROM projection_thread_message_search
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS harness_memory (
      memory_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      project_id TEXT,
      memory_key TEXT NOT NULL,
      memory_value TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(scope, project_id, memory_key)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_memory_scope_project
    ON harness_memory(scope, project_id, updated_at)
  `;
});
