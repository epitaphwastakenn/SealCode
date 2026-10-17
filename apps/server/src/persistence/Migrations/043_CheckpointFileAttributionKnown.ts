import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_turns
    SET checkpoint_file_attribution = 'known'
    WHERE checkpoint_file_attribution = 'unknown'
      AND checkpoint_files_json IS NOT NULL
      AND checkpoint_files_json != '[]'
  `;
});
