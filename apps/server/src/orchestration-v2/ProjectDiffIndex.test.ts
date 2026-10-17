import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectDiffIndex from "./ProjectDiffIndex.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";

const layerTest = Layer.mergeAll(
  ProjectDiffIndex.layer,
  ProjectionStore.layer,
  ProjectStore.layer,
).pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-5" };
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 9, 17, 0, minute));

const createProject = (projectId: ProjectId) =>
  Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
    projects.apply({
      sequence: 0,
      eventId: EventId.make(`created:${projectId}`),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: DateTime.formatIso(at(0)),
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: projectId,
        workspaceRoot: `/work/${projectId}`,
        defaultModelSelection: null,
        scripts: [],
        createdAt: DateTime.formatIso(at(0)),
        updatedAt: DateTime.formatIso(at(0)),
      },
    }),
  );

const thread = (
  threadId: ThreadId,
  projectId: ProjectId,
  overrides: { readonly archivedAt?: DateTime.Utc; readonly deletedAt?: DateTime.Utc } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`created:${threadId}`),
  type: "thread.created",
  threadId,
  providerInstanceId,
  occurredAt: at(0),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: `Title of ${threadId}`,
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: overrides.archivedAt ?? null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: overrides.deletedAt ?? null,
  },
});

/** One run and its root-scope checkpoint, the way a finished turn leaves them. */
const checkpointedRun = (input: {
  readonly threadId: ThreadId;
  readonly ordinal: number;
  readonly capturedMinute: number;
  readonly runStatus?: OrchestrationV2Run["status"];
  readonly checkpointStatus?: "ready" | "missing" | "error" | "stale";
  readonly appRunOrdinal?: number | null;
  readonly files?: ReadonlyArray<{
    readonly path: string;
    readonly kind: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
}): ReadonlyArray<OrchestrationV2DomainEvent> => {
  const key = `${input.threadId}:${input.ordinal}`;
  const runId = RunId.make(`run:${key}`);
  const nodeId = NodeId.make(`node:${key}`);
  const scopeId = CheckpointScopeId.make(`scope:${key}`);
  const checkpointId = CheckpointId.make(`checkpoint:${key}`);
  const time = at(input.capturedMinute);
  return [
    {
      id: EventId.make(`run:${key}`),
      type: "run.created",
      threadId: input.threadId,
      occurredAt: time,
      payload: {
        id: runId,
        threadId: input.threadId,
        ordinal: input.ordinal,
        providerInstanceId,
        modelSelection,
        providerThreadId: null,
        userMessageId: MessageId.make(`message:${key}`),
        rootNodeId: nodeId,
        activeAttemptId: null,
        status: input.runStatus ?? "completed",
        requestedAt: time,
        startedAt: time,
        completedAt: time,
        checkpointId,
        contextHandoffId: null,
      },
    },
    {
      id: EventId.make(`scope:${key}`),
      type: "checkpoint-scope.created",
      threadId: input.threadId,
      occurredAt: time,
      payload: {
        id: scopeId,
        threadId: input.threadId,
        runId,
        nodeId,
        parentScopeId: null,
        providerThreadId: null,
        kind: "root_run",
        ordinalWithinParent: input.ordinal,
        advancesAppRunCount: true,
        cwd: "/repo",
        createdAt: time,
      },
    },
    {
      id: EventId.make(`checkpoint:${key}`),
      type: "checkpoint.captured",
      threadId: input.threadId,
      occurredAt: time,
      payload: {
        id: checkpointId,
        threadId: input.threadId,
        scopeId,
        runId,
        nodeId,
        parentCheckpointId: null,
        ordinalWithinScope: 1,
        appRunOrdinal: input.appRunOrdinal === undefined ? input.ordinal : input.appRunOrdinal,
        ref: CheckpointRef.make(`refs/t3/${key}`),
        status: input.checkpointStatus ?? "ready",
        files: input.files ?? [],
        capturedAt: time,
      },
    },
  ];
};

it.layer(layerTest)("ProjectDiffIndex", (it) => {
  it.effect("lists ready checkpoints of completed runs newest first", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const index = yield* ProjectDiffIndex.ProjectDiffIndex;
      const project = ProjectId.make("project:diffs");
      const otherProject = ProjectId.make("project:other");
      yield* createProject(project);
      yield* createProject(otherProject);

      const active = ThreadId.make("thread:active");
      const archived = ThreadId.make("thread:archived");
      const deleted = ThreadId.make("thread:deleted");
      const elsewhere = ThreadId.make("thread:elsewhere");
      const files = [{ path: "src/a.ts", kind: "modified", additions: 3, deletions: 1 }];
      const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
        thread(active, project),
        ...checkpointedRun({ threadId: active, ordinal: 1, capturedMinute: 1, files }),
        ...checkpointedRun({ threadId: active, ordinal: 2, capturedMinute: 4 }),
        // None of these can be diffed, so none may be listed.
        ...checkpointedRun({
          threadId: active,
          ordinal: 3,
          capturedMinute: 9,
          runStatus: "running",
        }),
        ...checkpointedRun({
          threadId: active,
          ordinal: 4,
          capturedMinute: 9,
          checkpointStatus: "stale",
        }),
        ...checkpointedRun({
          threadId: active,
          ordinal: 5,
          capturedMinute: 9,
          appRunOrdinal: null,
        }),
        thread(archived, project, { archivedAt: at(5) }),
        ...checkpointedRun({ threadId: archived, ordinal: 1, capturedMinute: 3 }),
        thread(deleted, project, { deletedAt: at(5) }),
        ...checkpointedRun({ threadId: deleted, ordinal: 1, capturedMinute: 8 }),
        thread(elsewhere, otherProject),
        ...checkpointedRun({ threadId: elsewhere, ordinal: 1, capturedMinute: 7 }),
      ];
      yield* Effect.forEach(events, projections.apply, { discard: true });

      const result = yield* index.getProjectDiffIndex({ projectId: project });
      assert.strictEqual(result.projectId, project);
      assert.deepEqual(
        result.entries.map((entry) => [entry.threadId, entry.appRunOrdinal, entry.archivedAt]),
        [
          [active, 2, null],
          [archived, 1, DateTime.formatIso(at(5))],
          [active, 1, null],
        ],
      );
      const [newest, , oldest] = result.entries;
      assert.strictEqual(newest?.threadTitle, "Title of thread:active");
      assert.strictEqual(newest?.runId, RunId.make("run:thread:active:2"));
      assert.strictEqual(newest?.capturedAt, DateTime.formatIso(at(4)));
      assert.deepEqual(oldest?.files, files);
      assert.strictEqual(oldest?.status, "ready");

      const limited = yield* index.getProjectDiffIndex({ projectId: project, limit: 1 });
      assert.deepEqual(
        limited.entries.map((entry) => entry.runId),
        [RunId.make("run:thread:active:2")],
      );
    }),
  );

  it.effect("is empty for a project without checkpoints", () =>
    Effect.gen(function* () {
      const index = yield* ProjectDiffIndex.ProjectDiffIndex;
      const project = ProjectId.make("project:empty");
      yield* createProject(project);
      assert.deepEqual((yield* index.getProjectDiffIndex({ projectId: project })).entries, []);
    }),
  );
});
