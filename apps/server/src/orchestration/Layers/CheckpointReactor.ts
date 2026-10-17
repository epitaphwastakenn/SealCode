import {
  CommandId,
  type CheckpointRef,
  EventId,
  isToolLifecycleItemType,
  MessageId,
  type ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type ProviderRuntimeEvent,
  type VcsStatusLocalResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Stream from "effect/Stream";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";

import { parseTurnDiffFilesFromUnifiedDiff } from "../../checkpointing/Diffs.ts";
import {
  checkpointRefForThreadTurn,
  resolveThreadWorkspaceCwd,
  workspacePathKey,
} from "../../checkpointing/Utils.ts";
import { WorkspaceTurnChangeTracker } from "../../checkpointing/WorkspaceTurnChangeTracker.ts";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { CheckpointReactor, type CheckpointReactorShape } from "../Services/CheckpointReactor.ts";
import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import type { CheckpointStoreError } from "../../checkpointing/Errors.ts";
import type { OrchestrationDispatchError } from "../Errors.ts";
import { isGitRepository } from "../../git/Utils.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as WorkspaceEntries from "../../workspace/WorkspaceEntries.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

type ReactorInput =
  | {
      readonly source: "runtime";
      readonly event: ProviderRuntimeEvent;
    }
  | {
      readonly source: "domain";
      readonly event: OrchestrationEvent;
    };

function toTurnId(value: string | undefined): TurnId | null {
  return value === undefined ? null : TurnId.make(String(value));
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

function checkpointStatusFromRuntime(status: string | undefined): "ready" | "missing" | "error" {
  switch (status) {
    case "failed":
      return "error";
    case "cancelled":
    case "interrupted":
      return "missing";
    case "completed":
    default:
      return "ready";
  }
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;
  const serverEventId = randomUUID.pipe(Effect.map(EventId.make));
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const checkpointStore = yield* CheckpointStore.CheckpointStore;
  const receiptBus = yield* RuntimeReceiptBus;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
  const finalizedCheckpointKeys = new Set<string>();
  const abortedTurnKeys = new Set<string>();
  const withheldTurnKeys = new Set<string>();
  const workspaceTurnChangeTracker = new WorkspaceTurnChangeTracker();

  const appendRevertFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly turnCount: number;
    readonly detail: string;
    readonly createdAt: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("checkpoint-revert-failure"),
      activityId: serverEventId,
    }).pipe(
      Effect.flatMap(({ commandId, activityId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: activityId,
            tone: "error",
            kind: "checkpoint.revert.failed",
            summary: "Checkpoint revert failed",
            payload: {
              turnCount: input.turnCount,
              detail: input.detail,
            },
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const appendCaptureFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly detail: string;
    readonly createdAt: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("checkpoint-capture-failure"),
      activityId: serverEventId,
    }).pipe(
      Effect.flatMap(({ commandId, activityId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: activityId,
            tone: "error",
            kind: "checkpoint.capture.failed",
            summary: "Checkpoint capture failed",
            payload: {
              detail: input.detail,
            },
            turnId: input.turnId,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const resolveSessionRuntimeForThread = Effect.fn("resolveSessionRuntimeForThread")(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<Option.Option<{ readonly threadId: ThreadId; readonly cwd: string }>> {
    const sessions = yield* providerService.listSessions();
    const session = sessions.find((entry) => entry.threadId === threadId);
    return session?.cwd
      ? Option.some({ threadId: session.threadId, cwd: session.cwd })
      : Option.none();
  });

  const resolveThreadDetail = Effect.fn("resolveThreadDetail")(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadDetailById(threadId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const resolveThreadProjects = Effect.fn("resolveThreadProjects")(function* (
    projectId: ProjectId,
  ) {
    const project = yield* projectionSnapshotQuery
      .getProjectShellById(projectId)
      .pipe(Effect.map(Option.getOrUndefined));
    return project ? [project] : [];
  });

  const resolveCheckpointRestorePlan = Effect.fn("resolveCheckpointRestorePlan")(
    (input: {
      readonly thread: {
        readonly id: ThreadId;
        readonly checkpoints: ReadonlyArray<{
          readonly checkpointTurnCount: number;
          readonly files: ReadonlyArray<{ readonly path: string }>;
          readonly fileAttribution?: "known" | "unknown" | undefined;
        }>;
      };
      readonly cwd: string;
      readonly turnCount: number;
    }) =>
      Effect.gen(function* () {
        const staleCheckpoints = input.thread.checkpoints.filter(
          (checkpoint) => checkpoint.checkpointTurnCount > input.turnCount,
        );
        if (staleCheckpoints.length === 0) {
          return { paths: [] };
        }

        const attributedPaths = Array.from(
          new Set(
            staleCheckpoints.flatMap((checkpoint) => checkpoint.files.map((file) => file.path)),
          ),
        ).toSorted();
        const attributionIsKnown = staleCheckpoints.every(
          (checkpoint) => checkpoint.fileAttribution === "known",
        );

        const sessions = yield* providerService.listSessions();
        const activeOtherSession = sessions.find(
          (session) =>
            session.threadId !== input.thread.id &&
            (session.status === "running" || session.status === "connecting") &&
            session.cwd !== undefined &&
            workspacePathKey(session.cwd) === workspacePathKey(input.cwd),
        );
        if (activeOtherSession) {
          return {
            conflict:
              "Checkpoint revert was blocked because another agent is actively using this workspace. Stop or finish the other turn before reverting.",
          };
        }

        const snapshot = yield* projectionSnapshotQuery.getSnapshot();
        const projectRootById = new Map(
          snapshot.projects.map((project) => [project.id, project.workspaceRoot]),
        );
        const otherWorkspaceThreads = snapshot.threads.filter((thread) => {
          if (thread.id === input.thread.id) return false;
          const threadCwd =
            thread.worktreePath ?? projectRootById.get(thread.projectId) ?? undefined;
          return (
            threadCwd !== undefined && workspacePathKey(threadCwd) === workspacePathKey(input.cwd)
          );
        });

        if (!attributionIsKnown) {
          return otherWorkspaceThreads.length === 0
            ? {}
            : {
                conflict:
                  "Checkpoint revert was blocked because this workspace has another thread and the target checkpoint does not have reliable file attribution.",
              };
        }

        const attributedPathSet = new Set(attributedPaths);
        for (const thread of otherWorkspaceThreads) {
          if (thread.latestTurn !== null && thread.checkpoints.length === 0) {
            return {
              conflict:
                "Checkpoint revert was blocked because another thread has completed work without a checkpoint attribution.",
            };
          }
          for (const checkpoint of thread.checkpoints) {
            if (checkpoint.fileAttribution !== "known") {
              return {
                conflict:
                  "Checkpoint revert was blocked because another thread has an unattributed checkpoint in this workspace.",
              };
            }
            const overlappingPath = checkpoint.files
              .map((file) => file.path)
              .find((filePath) => attributedPathSet.has(filePath));
            if (overlappingPath !== undefined) {
              return {
                conflict: `Checkpoint revert was blocked because another thread also changed '${overlappingPath}'.`,
              };
            }
          }
        }

        return { paths: attributedPaths };
      }),
  );

  const isGitWorkspace = (cwd: string) => isGitRepository(cwd);

  // Resolves the workspace CWD for checkpoint operations, preferring the
  // active provider session CWD and falling back to the thread/project config.
  // Returns undefined when no CWD can be determined or the workspace is not
  // a git repository.
  const resolveCheckpointCwd = Effect.fn("resolveCheckpointCwd")(function* (input: {
    readonly threadId: ThreadId;
    readonly thread: { readonly projectId: ProjectId; readonly worktreePath: string | null };
    readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly workspaceRoot: string }>;
    readonly preferSessionRuntime: boolean;
  }): Effect.fn.Return<string | undefined> {
    const fromSession = yield* resolveSessionRuntimeForThread(input.threadId);
    const fromThread = resolveThreadWorkspaceCwd({
      thread: input.thread,
      projects: input.projects,
    });

    const cwd = input.preferSessionRuntime
      ? (Option.match(fromSession, {
          onNone: () => undefined,
          onSome: (runtime) => runtime.cwd,
        }) ?? fromThread)
      : (fromThread ??
        Option.match(fromSession, {
          onNone: () => undefined,
          onSome: (runtime) => runtime.cwd,
        }));

    if (!cwd) {
      return undefined;
    }
    if (!isGitWorkspace(cwd)) {
      return undefined;
    }
    return cwd;
  });

  // Shared tail for both capture paths: creates the git checkpoint ref, diffs
  // it against the previous turn, then dispatches the domain events to update
  // the orchestration read model.
  const captureAndDispatchCheckpoint = Effect.fn("captureAndDispatchCheckpoint")(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
    readonly thread: {
      readonly messages: ReadonlyArray<{
        readonly id: MessageId;
        readonly role: string;
        readonly turnId: TurnId | null;
      }>;
    };
    readonly cwd: string;
    readonly turnCount: number;
    readonly status: "ready" | "missing" | "error";
    readonly assistantMessageId: MessageId | undefined;
    readonly filePaths?: ReadonlyArray<string>;
    readonly createdAt: string;
  }) {
    const fromTurnCount = Math.max(0, input.turnCount - 1);
    const fromCheckpointRef = checkpointRefForThreadTurn(input.threadId, fromTurnCount);
    const targetCheckpointRef = checkpointRefForThreadTurn(input.threadId, input.turnCount);

    const fromCheckpointExists = yield* checkpointStore.hasCheckpointRef({
      cwd: input.cwd,
      checkpointRef: fromCheckpointRef,
    });
    if (!fromCheckpointExists) {
      yield* Effect.logWarning("checkpoint capture missing pre-turn baseline", {
        threadId: input.threadId,
        turnId: input.turnId,
        fromTurnCount,
      });
    }

    yield* checkpointStore.captureCheckpoint({
      cwd: input.cwd,
      checkpointRef: targetCheckpointRef,
    });

    // Refresh the workspace entry index so the @-mention file picker
    // reflects files created or deleted during this turn.
    yield* workspaceEntries.refresh(input.cwd);

    const fileSummary = yield* checkpointStore
      .diffCheckpoints({
        cwd: input.cwd,
        fromCheckpointRef,
        toCheckpointRef: targetCheckpointRef,
        fallbackFromToHead: false,
        ignoreWhitespace: false,
        ...(input.filePaths === undefined ? {} : { paths: input.filePaths }),
      })
      .pipe(
        Effect.map((diff) => ({
          files: parseTurnDiffFilesFromUnifiedDiff(diff).map((file) => ({
            path: file.path,
            kind: "modified" as const,
            additions: file.additions,
            deletions: file.deletions,
          })),
          fileAttribution: "known" as const,
        })),
        Effect.tapError((error) =>
          appendCaptureFailureActivity({
            threadId: input.threadId,
            turnId: input.turnId,
            detail: `Checkpoint captured, but turn diff summary is unavailable: ${error.message}`,
            createdAt: input.createdAt,
          }),
        ),
        Effect.catch((error) =>
          Effect.logWarning("failed to derive checkpoint file summary", {
            threadId: input.threadId,
            turnId: input.turnId,
            turnCount: input.turnCount,
            detail: error.message,
          }).pipe(
            Effect.as({
              files: [],
              fileAttribution: "unknown" as const,
            }),
          ),
        ),
      );

    const assistantMessageId =
      input.thread.messages
        .toReversed()
        .find((entry) => entry.role === "assistant" && entry.turnId === input.turnId)?.id ??
      (input.assistantMessageId !== undefined &&
      input.thread.messages.some((entry) => entry.id === input.assistantMessageId)
        ? input.assistantMessageId
        : MessageId.make(`assistant:${input.threadId}:${input.turnId}`));

    yield* orchestrationEngine.dispatch({
      type: "thread.turn.diff.complete",
      commandId: yield* serverCommandId("checkpoint-turn-diff-complete"),
      threadId: input.threadId,
      turnId: input.turnId,
      completedAt: input.createdAt,
      checkpointRef: targetCheckpointRef,
      status: input.status,
      files: fileSummary.files,
      fileAttribution: fileSummary.fileAttribution,
      assistantMessageId,
      checkpointTurnCount: input.turnCount,
      createdAt: input.createdAt,
    });
    yield* receiptBus.publish({
      type: "checkpoint.diff.finalized",
      threadId: input.threadId,
      turnId: input.turnId,
      checkpointTurnCount: input.turnCount,
      checkpointRef: targetCheckpointRef,
      status: input.status,
      createdAt: input.createdAt,
    });
    yield* receiptBus.publish({
      type: "turn.processing.quiesced",
      threadId: input.threadId,
      turnId: input.turnId,
      checkpointTurnCount: input.turnCount,
      createdAt: input.createdAt,
    });

    yield* orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: yield* serverCommandId("checkpoint-captured-activity"),
      threadId: input.threadId,
      activity: {
        id: EventId.make(yield* randomUUID),
        tone: "info",
        kind: "checkpoint.captured",
        summary: "Checkpoint captured",
        payload: {
          turnCount: input.turnCount,
          status: input.status,
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  // Captures a real git checkpoint when a turn completes via a runtime event.
  const captureCheckpointFromTurnCompletion = Effect.fn("captureCheckpointFromTurnCompletion")(
    function* (input: {
      readonly event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>;
      readonly filePaths?: ReadonlyArray<string>;
    }) {
      const event = input.event;
      const turnId = toTurnId(event.turnId);
      if (!turnId) {
        return;
      }

      const checkpointKey = `${event.threadId}:${turnId}`;
      if (abortedTurnKeys.has(checkpointKey)) {
        return;
      }
      if (withheldTurnKeys.has(checkpointKey)) {
        return;
      }
      if (finalizedCheckpointKeys.has(checkpointKey)) {
        return;
      }

      const thread = yield* resolveThreadDetail(event.threadId);
      if (!thread) {
        return;
      }

      // When a primary turn is active, only that turn may produce completion checkpoints.
      if (thread.session?.activeTurnId && !sameId(thread.session.activeTurnId, turnId)) {
        withheldTurnKeys.add(checkpointKey);
        return;
      }

      // Only skip if a real (non-placeholder) checkpoint already exists for this turn.
      // ProviderRuntimeIngestion may insert placeholder entries with status "missing"
      // before this reactor runs; those must not prevent real git capture.
      if (
        thread.checkpoints.some(
          (checkpoint) => checkpoint.turnId === turnId && checkpoint.status !== "missing",
        )
      ) {
        return;
      }

      const projects = yield* resolveThreadProjects(thread.projectId);
      const checkpointCwd = yield* resolveCheckpointCwd({
        threadId: thread.id,
        thread,
        projects,
        preferSessionRuntime: true,
      });
      if (!checkpointCwd) {
        return;
      }

      // A missing path attribution means the runtime did not provide a usable
      // start/status trail for this turn. Preserve the old full-capture path
      // only when no other active session is using this workspace; otherwise
      // withholding the diff is safer than publishing a merged snapshot.
      if (input.filePaths === undefined) {
        const activeSessions = yield* providerService.listSessions();
        const conflictingSession = activeSessions.find(
          (session) =>
            session.threadId !== event.threadId &&
            (session.status === "running" || session.status === "connecting") &&
            session.cwd !== undefined &&
            workspacePathKey(session.cwd) === workspacePathKey(checkpointCwd),
        );
        if (conflictingSession) {
          withheldTurnKeys.add(checkpointKey);
          yield* appendCaptureFailureActivity({
            threadId: event.threadId,
            turnId,
            detail:
              "Diff capture was withheld because another active turn is using the same workspace and its changed files could not be attributed safely. Use isolated worktrees for overlapping or opaque edits.",
            createdAt: event.createdAt,
          });
          return;
        }
      }

      // If a placeholder checkpoint exists for this turn, reuse its turn count
      // instead of incrementing past it.
      const existingPlaceholder = thread.checkpoints.find(
        (checkpoint) => checkpoint.turnId === turnId && checkpoint.status === "missing",
      );
      const currentTurnCount = thread.checkpoints.reduce(
        (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
        0,
      );
      const nextTurnCount = existingPlaceholder
        ? existingPlaceholder.checkpointTurnCount
        : currentTurnCount + 1;

      yield* captureAndDispatchCheckpoint({
        threadId: thread.id,
        turnId,
        thread,
        cwd: checkpointCwd,
        turnCount: nextTurnCount,
        status: checkpointStatusFromRuntime(event.payload.state),
        assistantMessageId: undefined,
        ...(input.filePaths === undefined ? {} : { filePaths: input.filePaths }),
        createdAt: event.createdAt,
      });
      finalizedCheckpointKeys.add(checkpointKey);
    },
  );

  const ensurePreTurnBaselineFromTurnStart = Effect.fn("ensurePreTurnBaselineFromTurnStart")(
    function* (event: Extract<ProviderRuntimeEvent, { type: "turn.started" }>) {
      const turnId = toTurnId(event.turnId);
      if (!turnId) {
        return;
      }

      const thread = yield* resolveThreadDetail(event.threadId);
      if (!thread) {
        return;
      }

      const projects = yield* resolveThreadProjects(thread.projectId);
      const checkpointCwd = yield* resolveCheckpointCwd({
        threadId: thread.id,
        thread,
        projects,
        preferSessionRuntime: false,
      });
      if (!checkpointCwd) {
        return;
      }

      const currentTurnCount = thread.checkpoints.reduce(
        (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
        0,
      );
      const baselineCheckpointRef = checkpointRefForThreadTurn(thread.id, currentTurnCount);
      const baselineExists = yield* checkpointStore.hasCheckpointRef({
        cwd: checkpointCwd,
        checkpointRef: baselineCheckpointRef,
      });
      if (baselineExists) {
        return;
      }

      yield* checkpointStore.captureCheckpoint({
        cwd: checkpointCwd,
        checkpointRef: baselineCheckpointRef,
      });
      yield* receiptBus.publish({
        type: "checkpoint.baseline.captured",
        threadId: thread.id,
        checkpointTurnCount: currentTurnCount,
        checkpointRef: baselineCheckpointRef,
        createdAt: event.createdAt,
      });
    },
  );

  const refreshLocalStatusAtCwd = Effect.fn("refreshLocalStatusAtCwd")(function* (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | undefined;
    readonly cwd: string;
  }) {
    return yield* vcsStatusBroadcaster.refreshLocalStatus(input.cwd).pipe(
      Effect.map((local) => Option.some({ cwd: input.cwd, local })),
      Effect.catch((error) =>
        Effect.logWarning("failed to refresh local git status for checkpoint attribution", {
          threadId: input.threadId,
          turnId: input.turnId ?? null,
          cwd: input.cwd,
          detail: error.message,
        }).pipe(
          Effect.as(Option.none<{ readonly cwd: string; readonly local: VcsStatusLocalResult }>()),
        ),
      ),
    );
  });

  const refreshLocalGitStatusFromTurnCompletion = Effect.fn(
    "refreshLocalGitStatusFromTurnCompletion",
  )(function* (event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>) {
    const sessionRuntime = yield* resolveSessionRuntimeForThread(event.threadId);
    if (Option.isNone(sessionRuntime)) {
      return Option.none<{ readonly cwd: string; readonly local: VcsStatusLocalResult }>();
    }

    const refreshed = yield* refreshLocalStatusAtCwd({
      threadId: event.threadId,
      turnId: event.turnId,
      cwd: sessionRuntime.value.cwd,
    });
    if (Option.isSome(refreshed)) {
      yield* followWorktreeBranchDrift({
        threadId: event.threadId,
        cwd: sessionRuntime.value.cwd,
        local: refreshed.value.local,
      });
    }
    return refreshed;
  });

  // A `git checkout` run inside a thread's dedicated worktree (by an agent or
  // the user) bypasses T3's commands, so the thread's recorded branch goes
  // stale. Since #4460 the client only attributes PR state to a thread when
  // the checked-out branch equals the recorded one, so stale metadata silently
  // orphans the thread's PR. Follow the drift here: adopt the checked-out
  // branch as the thread's branch, but only when the worktree belongs to
  // exactly this thread — for shared cwds the strict matching is the point.
  const followWorktreeBranchDrift = Effect.fn("followWorktreeBranchDrift")(function* (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly local: VcsStatusLocalResult;
  }) {
    // Detached HEAD has no branch to adopt; a temporary placeholder checkout
    // means the first-turn auto-rename is still in flight — don't race it.
    const checkedOutBranch = input.local.refName;
    if (checkedOutBranch === null || isTemporaryWorktreeBranch(checkedOutBranch)) {
      return;
    }

    yield* Effect.gen(function* () {
      const thread = yield* projectionSnapshotQuery
        .getThreadShellById(input.threadId)
        .pipe(Effect.map(Option.getOrUndefined));
      if (
        !thread ||
        thread.branch === null ||
        thread.branch === checkedOutBranch ||
        thread.worktreePath === null ||
        thread.worktreePath !== input.cwd ||
        isTemporaryWorktreeBranch(thread.branch)
      ) {
        return;
      }

      const shell = yield* projectionSnapshotQuery.getShellSnapshot();
      const worktreeIsShared = shell.threads.some(
        (other) => other.id !== thread.id && other.worktreePath === thread.worktreePath,
      );
      if (worktreeIsShared) {
        return;
      }

      // expectedBranch makes this a compare-and-swap in the decider: if the
      // recorded branch moved between our read and the dispatch (rename,
      // concurrent drift-follow), the stale update is dropped.
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: yield* serverCommandId("worktree-branch-drift"),
        threadId: thread.id,
        branch: checkedOutBranch,
        expectedBranch: thread.branch,
      });
      yield* Effect.logInfo("thread branch followed worktree checkout", {
        threadId: thread.id,
        previousBranch: thread.branch,
        branch: checkedOutBranch,
      });
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("failed to follow worktree branch drift", {
          threadId: input.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );
  });

  const resolveTrackedWorkspaceCwd = Effect.fn("resolveTrackedWorkspaceCwd")(function* (input: {
    readonly threadId: ThreadId;
    readonly preferSessionRuntime: boolean;
  }) {
    const thread = yield* resolveThreadDetail(input.threadId);
    if (!thread) {
      return undefined;
    }
    const projects = yield* resolveThreadProjects(thread.projectId);
    return yield* resolveCheckpointCwd({
      threadId: input.threadId,
      thread,
      projects,
      preferSessionRuntime: input.preferSessionRuntime,
    });
  });

  const trackRuntimeTurnStart = Effect.fn("trackRuntimeTurnStart")(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.started" }>,
  ) {
    const turnId = toTurnId(event.turnId);
    if (!turnId) {
      return;
    }

    const cwd = yield* resolveTrackedWorkspaceCwd({
      threadId: event.threadId,
      preferSessionRuntime: true,
    });
    if (!cwd) {
      return;
    }

    const local = yield* refreshLocalStatusAtCwd({
      threadId: event.threadId,
      turnId,
      cwd,
    });
    if (Option.isSome(local)) {
      workspaceTurnChangeTracker.startTurn(
        workspacePathKey(cwd),
        `${event.threadId}:${turnId}`,
        local.value.local.workingTree.files,
      );
    }
  });

  const observeToolCompletionForTurn = Effect.fn("observeToolCompletionForTurn")(function* (
    event: Extract<ProviderRuntimeEvent, { type: "item.completed" }>,
  ) {
    if (!isToolLifecycleItemType(event.payload.itemType) || !event.turnId) {
      return;
    }

    const cwd = yield* resolveTrackedWorkspaceCwd({
      threadId: event.threadId,
      preferSessionRuntime: true,
    });
    if (!cwd) {
      return;
    }

    const local = yield* refreshLocalStatusAtCwd({
      threadId: event.threadId,
      turnId: event.turnId,
      cwd,
    });
    if (Option.isSome(local)) {
      workspaceTurnChangeTracker.observeStatus(
        workspacePathKey(cwd),
        `${event.threadId}:${event.turnId}`,
        local.value.local.workingTree.files,
      );
    }
  });

  const recordProviderTurnDiff = Effect.fn("recordProviderTurnDiff")(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.diff.updated" }>,
  ) {
    if (!event.turnId) {
      return;
    }

    const cwd = yield* resolveTrackedWorkspaceCwd({
      threadId: event.threadId,
      preferSessionRuntime: true,
    });
    if (!cwd) {
      return;
    }

    workspaceTurnChangeTracker.recordProviderDiff(
      workspacePathKey(cwd),
      `${event.threadId}:${event.turnId}`,
      parseTurnDiffFilesFromUnifiedDiff(event.payload.unifiedDiff).map((file) => file.path),
    );
  });

  const discardAbortedTurn = Effect.fn("discardAbortedTurn")(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.aborted" }>,
  ) {
    const turnId = toTurnId(event.turnId);
    if (!turnId) {
      return;
    }

    const turnKey = `${event.threadId}:${turnId}`;
    abortedTurnKeys.add(turnKey);
    const cwd = yield* resolveTrackedWorkspaceCwd({
      threadId: event.threadId,
      preferSessionRuntime: true,
    });
    if (cwd) {
      workspaceTurnChangeTracker.abortTurn(workspacePathKey(cwd), turnKey);
    }
  });

  const ensurePreTurnBaselineFromDomainTurnStart = Effect.fn(
    "ensurePreTurnBaselineFromDomainTurnStart",
  )(function* (
    event: Extract<
      OrchestrationEvent,
      { type: "thread.turn-start-requested" | "thread.message-sent" }
    >,
  ) {
    if (event.type === "thread.message-sent") {
      if (
        event.payload.role !== "user" ||
        event.payload.streaming ||
        event.payload.turnId !== null
      ) {
        return;
      }
    }

    const threadId = event.payload.threadId;
    const thread = yield* resolveThreadDetail(threadId);
    if (!thread) {
      return;
    }

    const projects = yield* resolveThreadProjects(thread.projectId);
    const checkpointCwd = yield* resolveCheckpointCwd({
      threadId,
      thread,
      projects,
      preferSessionRuntime: false,
    });
    if (!checkpointCwd) {
      return;
    }

    const currentTurnCount = thread.checkpoints.reduce(
      (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
      0,
    );
    const baselineCheckpointRef = checkpointRefForThreadTurn(threadId, currentTurnCount);
    const baselineExists = yield* checkpointStore.hasCheckpointRef({
      cwd: checkpointCwd,
      checkpointRef: baselineCheckpointRef,
    });
    if (baselineExists) {
      return;
    }

    yield* checkpointStore.captureCheckpoint({
      cwd: checkpointCwd,
      checkpointRef: baselineCheckpointRef,
    });
    yield* receiptBus.publish({
      type: "checkpoint.baseline.captured",
      threadId,
      checkpointTurnCount: currentTurnCount,
      checkpointRef: baselineCheckpointRef,
      createdAt: event.occurredAt,
    });
  });

  const handleRevertRequested = Effect.fn("handleRevertRequested")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.checkpoint-revert-requested" }>,
  ) {
    const now = DateTime.formatIso(yield* DateTime.now);

    const thread = yield* resolveThreadDetail(event.payload.threadId);
    if (!thread) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: "Thread was not found in read model.",
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const sessionRuntime = yield* resolveSessionRuntimeForThread(event.payload.threadId);
    if (Option.isNone(sessionRuntime)) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: "No active provider session with workspace cwd is bound to this thread.",
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }
    if (!isGitWorkspace(sessionRuntime.value.cwd)) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: "Checkpoints are unavailable because this project is not a git repository.",
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const currentTurnCount = thread.checkpoints.reduce(
      (maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount),
      0,
    );

    if (event.payload.turnCount > currentTurnCount) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: `Checkpoint turn count ${event.payload.turnCount} exceeds current turn count ${currentTurnCount}.`,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const targetCheckpointRef =
      event.payload.turnCount === 0
        ? checkpointRefForThreadTurn(event.payload.threadId, 0)
        : thread.checkpoints.find(
            (checkpoint) => checkpoint.checkpointTurnCount === event.payload.turnCount,
          )?.checkpointRef;

    if (!targetCheckpointRef) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: `Checkpoint ref for turn ${event.payload.turnCount} is unavailable in read model.`,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const restorePlan = yield* resolveCheckpointRestorePlan({
      thread,
      cwd: sessionRuntime.value.cwd,
      turnCount: event.payload.turnCount,
    });
    if ("conflict" in restorePlan) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: restorePlan.conflict,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const restored = yield* checkpointStore.restoreCheckpoint({
      cwd: sessionRuntime.value.cwd,
      checkpointRef: targetCheckpointRef,
      fallbackToHead: event.payload.turnCount === 0,
      ...(restorePlan.paths === undefined ? {} : { paths: restorePlan.paths }),
    });
    if (!restored) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: `Filesystem checkpoint is unavailable for turn ${event.payload.turnCount}.`,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    // Refresh the workspace entry index so the @-mention file picker
    // reflects the reverted filesystem state.
    yield* workspaceEntries.refresh(sessionRuntime.value.cwd);

    const rolledBackTurns = Math.max(0, currentTurnCount - event.payload.turnCount);
    if (rolledBackTurns > 0) {
      yield* providerService.rollbackConversation({
        threadId: sessionRuntime.value.threadId,
        numTurns: rolledBackTurns,
      });
    }

    const staleCheckpointRefs: Array<CheckpointRef> = [];
    for (const checkpoint of thread.checkpoints) {
      if (checkpoint.checkpointTurnCount > event.payload.turnCount) {
        staleCheckpointRefs.push(checkpoint.checkpointRef);
      }
    }

    if (staleCheckpointRefs.length > 0) {
      yield* checkpointStore.deleteCheckpointRefs({
        cwd: sessionRuntime.value.cwd,
        checkpointRefs: staleCheckpointRefs,
      });
    }

    yield* orchestrationEngine
      .dispatch({
        type: "thread.revert.complete",
        commandId: yield* serverCommandId("checkpoint-revert-complete"),
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        createdAt: now,
      })
      .pipe(
        Effect.catch((error) =>
          appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: error.message,
            createdAt: now,
          }),
        ),
        Effect.asVoid,
      );
  });

  const processDomainEvent = Effect.fn("processDomainEvent")(function* (event: OrchestrationEvent) {
    if (event.type === "thread.turn-start-requested" || event.type === "thread.message-sent") {
      yield* ensurePreTurnBaselineFromDomainTurnStart(event);
      return;
    }

    if (event.type === "thread.checkpoint-revert-requested") {
      yield* handleRevertRequested(event).pipe(
        Effect.catch((error) =>
          Effect.flatMap(nowIso, (createdAt) =>
            appendRevertFailureActivity({
              threadId: event.payload.threadId,
              turnCount: event.payload.turnCount,
              detail: error.message,
              createdAt,
            }),
          ),
        ),
      );
      return;
    }
  });

  const processRuntimeEvent = Effect.fn("processRuntimeEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    if (event.type === "turn.started") {
      yield* ensurePreTurnBaselineFromTurnStart(event);
      yield* trackRuntimeTurnStart(event);
      return;
    }

    if (event.type === "turn.diff.updated") {
      yield* recordProviderTurnDiff(event);
      return;
    }

    if (event.type === "item.completed") {
      yield* observeToolCompletionForTurn(event);
      return;
    }

    if (event.type === "turn.aborted") {
      yield* discardAbortedTurn(event);
      return;
    }

    if (event.type === "turn.completed") {
      const turnId = toTurnId(event.turnId);
      const refreshed = yield* refreshLocalGitStatusFromTurnCompletion(event);
      const cwd = Option.isSome(refreshed)
        ? refreshed.value.cwd
        : yield* resolveTrackedWorkspaceCwd({
            threadId: event.threadId,
            preferSessionRuntime: true,
          });
      const resolution =
        cwd !== undefined && turnId !== null
          ? Option.isSome(refreshed)
            ? workspaceTurnChangeTracker.finishTurn(
                workspacePathKey(cwd),
                `${event.threadId}:${turnId}`,
                refreshed.value.local.workingTree.files,
              )
            : workspaceTurnChangeTracker.finishTurnWithoutStatus(
                workspacePathKey(cwd),
                `${event.threadId}:${turnId}`,
              )
          : ({ kind: "unknown", paths: [] } as const);

      if (resolution.kind === "ambiguous") {
        withheldTurnKeys.add(`${event.threadId}:${turnId ?? "unknown"}`);
        yield* appendCaptureFailureActivity({
          threadId: event.threadId,
          turnId,
          detail: `Diff capture was withheld because concurrent turns changed overlapping or un-attributable files (${resolution.paths.join(", ") || "path attribution unavailable"}). Use isolated worktrees for overlapping or opaque edits.`,
          createdAt: event.createdAt,
        });
        return;
      }

      yield* captureCheckpointFromTurnCompletion({
        event,
        ...(resolution.kind === "owned" && resolution.paths.length > 0
          ? { filePaths: resolution.paths }
          : {}),
      }).pipe(
        Effect.catch((error) =>
          Effect.flatMap(nowIso, (createdAt) =>
            appendCaptureFailureActivity({
              threadId: event.threadId,
              turnId,
              detail: error.message,
              createdAt,
            }).pipe(Effect.catch(() => Effect.void)),
          ),
        ),
      );
      return;
    }
  });

  const processInput = (
    input: ReactorInput,
  ): Effect.Effect<
    void,
    CheckpointStoreError | OrchestrationDispatchError | PlatformError.PlatformError,
    never
  > =>
    input.source === "domain" ? processDomainEvent(input.event) : processRuntimeEvent(input.event);

  const processInputSafely = (input: ReactorInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("checkpoint reactor failed to process input", {
          source: input.source,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const start: CheckpointReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.turn-start-requested" &&
          event.type !== "thread.message-sent" &&
          event.type !== "thread.checkpoint-revert-requested"
        ) {
          return Effect.void;
        }
        return worker.enqueue({ source: "domain", event });
      }),
    );

    yield* forkParked(
      Stream.runForEach(providerService.streamEvents, (event) => {
        if (
          event.type !== "turn.started" &&
          event.type !== "turn.aborted" &&
          event.type !== "turn.completed" &&
          event.type !== "turn.diff.updated" &&
          event.type !== "item.completed"
        ) {
          return Effect.void;
        }
        return worker.enqueue({ source: "runtime", event });
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies CheckpointReactorShape;
});

export const CheckpointReactorLive = Layer.effect(CheckpointReactor, make);
