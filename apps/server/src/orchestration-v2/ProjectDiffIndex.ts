import {
  IsoDateTime,
  OrchestrationV2CheckpointFileSummary,
  PositiveInt,
  ProjectId,
  RunId,
  ThreadId,
  type OrchestrationGetProjectDiffIndexInput,
  type OrchestrationGetProjectDiffIndexResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const DEFAULT_LIMIT = 100;

export class ProjectDiffIndexError extends Schema.TaggedError<ProjectDiffIndexError>()(
  "ProjectDiffIndexError",
  {
    operation: Schema.Literals(["query", "decode"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Project diff index ${this.operation} failed.`;
  }
}

const IndexRequest = Schema.Struct({ projectId: ProjectId, limit: Schema.Int });
const IndexRow = Schema.Struct({
  threadId: ThreadId,
  threadTitle: Schema.String,
  archivedAt: Schema.NullOr(IsoDateTime),
  runId: RunId,
  appRunOrdinal: PositiveInt,
  files: Schema.fromJsonString(Schema.Array(OrchestrationV2CheckpointFileSummary)),
  capturedAt: IsoDateTime,
});

export class ProjectDiffIndex extends Context.Service<
  ProjectDiffIndex,
  {
    readonly getProjectDiffIndex: (
      input: OrchestrationGetProjectDiffIndexInput,
    ) => Effect.Effect<OrchestrationGetProjectDiffIndexResult, ProjectDiffIndexError>;
  }
>()("t3/orchestration-v2/ProjectDiffIndex") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // `getTurnDiff` only answers for ready checkpoints of completed runs, so the
  // index lists exactly those and every entry can be opened.
  const indexRows = SqlSchema.findAll({
    Request: IndexRequest,
    Result: IndexRow,
    execute: ({ projectId, limit }) => sql`
      SELECT
        threads.thread_id AS "threadId",
        threads.title AS "threadTitle",
        threads.archived_at AS "archivedAt",
        checkpoints.run_id AS "runId",
        checkpoints.app_run_ordinal AS "appRunOrdinal",
        json_extract(checkpoints.payload_json, '$.files') AS files,
        checkpoints.captured_at AS "capturedAt"
      FROM orchestration_v2_projection_checkpoints AS checkpoints
      INNER JOIN orchestration_v2_projection_threads AS threads
        ON threads.thread_id = checkpoints.thread_id
      INNER JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      INNER JOIN orchestration_v2_projection_runs AS runs
        ON runs.run_id = checkpoints.run_id
      WHERE threads.project_id = ${projectId}
        AND threads.deleted_at IS NULL
        AND projects.deleted_at IS NULL
        AND checkpoints.status = 'ready'
        AND checkpoints.app_run_ordinal IS NOT NULL
        AND runs.status = 'completed'
      ORDER BY checkpoints.captured_at DESC, checkpoints.checkpoint_id ASC
      LIMIT ${limit}
    `,
  });

  const getProjectDiffIndex: ProjectDiffIndex["Service"]["getProjectDiffIndex"] = Effect.fn(
    "ProjectDiffIndex.getProjectDiffIndex",
  )(function* (input) {
    const entries = yield* sql
      .withTransaction(
        indexRows({ projectId: input.projectId, limit: input.limit ?? DEFAULT_LIMIT }),
      )
      .pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(
          (cause) =>
            new ProjectDiffIndexError({
              operation: Schema.isSchemaError(cause) ? "decode" : "query",
              cause,
            }),
        ),
      );
    return {
      projectId: input.projectId,
      entries: entries.map((entry) => ({ ...entry, status: "ready" as const })),
    };
  });

  return ProjectDiffIndex.of({ getProjectDiffIndex });
});

export const layer = Layer.effect(ProjectDiffIndex, make);
