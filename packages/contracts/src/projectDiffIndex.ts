import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { OrchestrationV2CheckpointFileSummary } from "./orchestrationV2.ts";

/**
 * One completed run's checkpoint, newest first. `appRunOrdinal` is the turn
 * count that `getTurnDiff` takes, so a client can diff any entry directly.
 */
export const OrchestrationProjectDiffEntry = Schema.Struct({
  threadId: ThreadId,
  threadTitle: Schema.String,
  archivedAt: Schema.NullOr(IsoDateTime),
  runId: RunId,
  appRunOrdinal: PositiveInt,
  status: Schema.Literal("ready"),
  files: Schema.Array(OrchestrationV2CheckpointFileSummary),
  capturedAt: IsoDateTime,
});
export type OrchestrationProjectDiffEntry = typeof OrchestrationProjectDiffEntry.Type;

export const OrchestrationGetProjectDiffIndexInput = Schema.Struct({
  projectId: ProjectId,
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
});
export type OrchestrationGetProjectDiffIndexInput =
  typeof OrchestrationGetProjectDiffIndexInput.Type;

export const OrchestrationGetProjectDiffIndexResult = Schema.Struct({
  projectId: ProjectId,
  entries: Schema.Array(OrchestrationProjectDiffEntry),
});
export type OrchestrationGetProjectDiffIndexResult =
  typeof OrchestrationGetProjectDiffIndexResult.Type;

export class OrchestrationGetProjectDiffIndexError extends Schema.TaggedError<OrchestrationGetProjectDiffIndexError>()(
  "OrchestrationGetProjectDiffIndexError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
