import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionThreadSessionRepository } from "../Services/ProjectionThreadSessions.ts";
import { ProjectionThreadSessionRepositoryLive } from "./ProjectionThreadSessions.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionThreadSessionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadSessionRepository", (it) => {
  it.effect("upserts against the multi-provider session schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repository = yield* ProjectionThreadSessionRepository;
      const threadId = ThreadId.make("thread-multi-provider");

      yield* sql`DROP TABLE projection_thread_sessions`;
      yield* sql`
        CREATE TABLE projection_thread_sessions (
          thread_id TEXT NOT NULL,
          status TEXT NOT NULL,
          provider_name TEXT,
          provider_instance_id TEXT NOT NULL,
          runtime_mode TEXT NOT NULL,
          active_turn_id TEXT,
          last_error TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (thread_id, provider_instance_id)
        )
      `;

      yield* repository.upsert({
        threadId,
        status: "ready",
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-08-09T20:00:00.000Z",
      });
      yield* repository.upsert({
        threadId,
        status: "running",
        providerName: "antigravity",
        providerInstanceId: ProviderInstanceId.make("antigravity"),
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-08-09T20:01:00.000Z",
      });

      const current = yield* repository.getByThreadId({ threadId });
      assert.equal(current._tag, "Some");
      if (current._tag === "Some") {
        assert.equal(current.value.providerInstanceId, "antigravity");
        assert.equal(current.value.status, "running");
      }
    }),
  );
});
