import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ToolOutputImageStore from "../orchestration-v2/ToolOutputImageStore.ts";
import * as Sqlite from "./Sqlite.ts";
import * as ToolOutputImageBackfill from "./ToolOutputImageBackfill.ts";

// A 1x1 PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const toolItem = (id: string) => ({
  id,
  type: "dynamic_tool",
  status: "completed",
  output: {
    content: [
      { type: "text", text: "Captured the viewport." },
      { type: "image", mimeType: "image/png", data: PNG_BASE64 },
    ],
  },
});

it.effect("moves stored tool output images into files once, in projections and events", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const attachmentsDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-image-backfill-" });
    const images = yield* ToolOutputImageStore.make(attachmentsDir);

    const item = toolItem("item-1");
    const userMessage = JSON.stringify({
      id: "item-2",
      type: "user_message",
      attachments: [{ type: "image", mimeType: "image/png", data: PNG_BASE64 }],
    });
    yield* sql`
      INSERT INTO orchestration_v2_projection_turn_items (
        turn_item_id, thread_id, ordinal, type, status, updated_at, payload_json
      ) VALUES
        ('item-1', 'thread-1', 1, 'dynamic_tool', 'completed', '2026-10-01', ${JSON.stringify(item)}),
        ('item-2', 'thread-1', 2, 'user_message', 'completed', '2026-10-01', ${userMessage})
    `;
    for (const [eventId, version] of [
      ["event-1", 1],
      ["event-2", 2],
    ] as const) {
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          actor_kind, payload_json, metadata_json, application_event_version
        ) VALUES (
          ${eventId}, 'thread', 'thread-1', ${version}, 'turn-item.updated', '2026-10-01',
          'provider', ${JSON.stringify(item)}, '{}', 2
        )
      `;
    }

    assert.deepEqual(yield* ToolOutputImageBackfill.externalizeStoredImages(images), {
      rewrittenRows: 3,
    });

    const stored = (yield* fs.readDirectory(
      path.join(attachmentsDir, ToolOutputImageStore.TOOL_OUTPUT_IMAGES_DIRECTORY),
    )).filter((name) => !name.endsWith(".partial"));
    assert.lengthOf(stored, 1);
    const expected = {
      ...item,
      output: {
        content: [
          item.output.content[0],
          {
            type: "image",
            mimeType: "image/png",
            [ToolOutputImageStore.TOOL_OUTPUT_IMAGE_FILE_KEY]: stored[0],
          },
        ],
      },
    };
    const projections = yield* sql<{ readonly payload_json: string }>`
      SELECT payload_json FROM orchestration_v2_projection_turn_items ORDER BY ordinal
    `;
    assert.deepEqual(JSON.parse(projections[0]!.payload_json), expected);
    // Only tool items keep screenshots this way; a message's attachments stay as they are.
    assert.equal(projections[1]!.payload_json, userMessage);
    const events = yield* sql<{ readonly payload_json: string }>`
      SELECT payload_json FROM orchestration_events ORDER BY sequence
    `;
    for (const event of events) assert.deepEqual(JSON.parse(event.payload_json), expected);

    assert.deepEqual(yield* ToolOutputImageBackfill.externalizeStoredImages(images), {
      rewrittenRows: 0,
    });
  }).pipe(Effect.provide(Layer.merge(Sqlite.layerMemory, NodeServices.layer)), Effect.scoped),
);
