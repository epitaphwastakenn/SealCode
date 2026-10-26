import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import type { ToolOutputImageStoreShape } from "../orchestration-v2/ToolOutputImageStore.ts";

// Keys per discovery read. Payloads are read one at a time: a screenshot row is
// hundreds of kilobytes, so a page of them would be a long read.
const SCAN_WINDOW = 500;

// Only the image blocks are rewritten, so the item is never decoded against its schema.
const ItemJson = Schema.fromJsonString(Schema.Unknown);
const decodeItemJson = Schema.decodeUnknownOption(ItemJson);
const decodeItem = (json: string) =>
  Option.map(decodeItemJson(json), (item) => item as OrchestrationV2TurnItem);
const encodeItem = Schema.encodeSync(ItemJson);

/**
 * Before tool output images were stored as files, every screenshot an agent
 * took stayed in the database as base64, in the projection row and in each
 * turn-item event. Moves those into files and leaves the same reference new
 * items get. Rows another writer changed meanwhile are left for their own
 * update, which already stores images as files. Safe to rerun.
 */
export const externalizeStoredImages = Effect.fn("ToolOutputImageBackfill.externalizeStoredImages")(
  function* (images: ToolOutputImageStoreShape, betweenPages: Effect.Effect<void> = Effect.void) {
    const sql = yield* SqlClient.SqlClient;
    let rewrittenRows = 0;

    const rewrite = Effect.fn("ToolOutputImageBackfill.rewrite")(function* (
      payloadJson: string,
      update: (next: string) => Effect.Effect<unknown, SqlError.SqlError>,
    ) {
      const parsed = decodeItem(payloadJson);
      if (Option.isNone(parsed)) return;
      const next = yield* images.externalize(parsed.value);
      if (next === parsed.value) return;
      yield* update(encodeItem(next));
      rewrittenRows++;
    });

    const projectionEnd = yield* sql<{ readonly last: number | null }>`
      SELECT max(rowid) AS last FROM orchestration_v2_projection_turn_items
    `.pipe(NodeSqliteClient.readOnly);
    for (let from = 0; from < (projectionEnd[0]?.last ?? 0); from += SCAN_WINDOW) {
      const keys = yield* sql<{ readonly row_id: number }>`
        SELECT rowid AS row_id FROM orchestration_v2_projection_turn_items
        WHERE rowid > ${from} AND rowid <= ${from + SCAN_WINDOW}
          AND type = 'dynamic_tool'
          AND instr(payload_json, '"type":"image"') > 0
          AND instr(payload_json, '"data":"') > 0
      `.pipe(NodeSqliteClient.readOnly);
      for (const { row_id } of keys) {
        const rows = yield* sql<{ readonly payload_json: string }>`
          SELECT payload_json FROM orchestration_v2_projection_turn_items WHERE rowid = ${row_id}
        `.pipe(NodeSqliteClient.readOnly);
        const payload = rows[0]?.payload_json;
        if (payload === undefined) continue;
        yield* rewrite(
          payload,
          (next) => sql`
            UPDATE orchestration_v2_projection_turn_items SET payload_json = ${next}
            WHERE rowid = ${row_id} AND payload_json = ${payload}
          `,
        );
        yield* betweenPages;
      }
      yield* betweenPages;
    }

    const eventsEnd = yield* sql<{ readonly last: number | null }>`
      SELECT max(sequence) AS last FROM orchestration_events
    `.pipe(NodeSqliteClient.readOnly);
    for (let from = 0; from < (eventsEnd[0]?.last ?? 0); from += SCAN_WINDOW) {
      const keys = yield* sql<{ readonly sequence: number }>`
        SELECT sequence FROM orchestration_events
        WHERE sequence > ${from} AND sequence <= ${from + SCAN_WINDOW}
          AND event_type = 'turn-item.updated'
          AND instr(payload_json, '"type":"image"') > 0
          AND instr(payload_json, '"data":"') > 0
      `.pipe(NodeSqliteClient.readOnly);
      for (const { sequence } of keys) {
        const rows = yield* sql<{ readonly payload_json: string }>`
          SELECT payload_json FROM orchestration_events WHERE sequence = ${sequence}
        `.pipe(NodeSqliteClient.readOnly);
        const payload = rows[0]?.payload_json;
        if (payload === undefined) continue;
        // Events are never updated otherwise, so the item only gets smaller.
        yield* rewrite(
          payload,
          (next) => sql`
            UPDATE orchestration_events SET payload_json = ${next} WHERE sequence = ${sequence}
          `,
        );
        yield* betweenPages;
      }
      yield* betweenPages;
    }

    return { rewrittenRows };
  },
);
