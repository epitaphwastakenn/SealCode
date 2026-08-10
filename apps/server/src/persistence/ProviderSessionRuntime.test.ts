import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ProviderSessionRuntime from "./ProviderSessionRuntime.ts";
import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";

const layer = it.layer(
  ProviderSessionRuntime.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProviderSessionRuntimeRepository", (it) => {
  it.effect("upserts against the multi-provider runtime schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
      const threadId = ThreadId.make("thread-runtime-multi-provider");

      yield* sql`DROP TABLE provider_session_runtime`;
      yield* sql`
        CREATE TABLE provider_session_runtime (
          thread_id TEXT NOT NULL,
          provider_name TEXT NOT NULL,
          provider_instance_id TEXT NOT NULL,
          adapter_key TEXT NOT NULL,
          runtime_mode TEXT NOT NULL,
          status TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          resume_cursor_json TEXT,
          runtime_payload_json TEXT,
          PRIMARY KEY (thread_id, provider_instance_id)
        )
      `;

      yield* repository.upsert({
        threadId,
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        adapterKey: "codex",
        runtimeMode: "full-access",
        status: "stopped",
        lastSeenAt: "2026-08-09T20:00:00.000Z",
        resumeCursor: null,
        runtimePayload: null,
      });
      yield* repository.upsert({
        threadId,
        providerName: "antigravity",
        providerInstanceId: ProviderInstanceId.make("antigravity"),
        adapterKey: "antigravity",
        runtimeMode: "full-access",
        status: "running",
        lastSeenAt: "2026-08-09T20:01:00.000Z",
        resumeCursor: null,
        runtimePayload: null,
      });

      const current = yield* repository.getByThreadId({ threadId });
      assert.equal(current._tag, "Some");
      if (current._tag === "Some") {
        assert.equal(current.value.providerInstanceId, ProviderInstanceId.make("antigravity"));
        assert.equal(current.value.status, "running");
      }
    }),
  );
});
