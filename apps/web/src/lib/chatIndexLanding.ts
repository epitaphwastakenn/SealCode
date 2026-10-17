import { sortThreads } from "./threadSort";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import type { LastOpenThreadRoute } from "../uiStateStore";

export type ChatIndexLandingThread = {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestUserMessageAt?: string | null;
};

export type ChatIndexLandingProject = {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
};

export type ChatIndexLandingTarget =
  | { readonly kind: "server"; readonly environmentId: EnvironmentId; readonly threadId: ThreadId }
  | { readonly kind: "draft"; readonly draftId: string }
  | {
      readonly kind: "new-draft";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
    }
  | { readonly kind: "scratch" };

export function resolveChatIndexLanding(input: {
  readonly lastOpenThreadRoute: LastOpenThreadRoute | null;
  readonly threads: readonly ChatIndexLandingThread[];
  readonly draftIds: ReadonlySet<string>;
  readonly mostRecentProject: ChatIndexLandingProject | null;
}): ChatIndexLandingTarget {
  const lastOpen = input.lastOpenThreadRoute;
  if (lastOpen?.kind === "server") {
    const existing = findThread(input.threads, lastOpen.environmentId, lastOpen.threadId);
    if (existing) {
      return {
        kind: "server",
        environmentId: existing.environmentId,
        threadId: existing.id,
      };
    }
  }
  if (lastOpen?.kind === "draft" && input.draftIds.has(lastOpen.draftId)) {
    return { kind: "draft", draftId: lastOpen.draftId };
  }

  const latestOpenThread =
    sortThreads(
      input.threads.filter((thread) => thread.archivedAt === null),
      "updated_at",
    )[0] ?? null;
  if (latestOpenThread) {
    return {
      kind: "server",
      environmentId: latestOpenThread.environmentId,
      threadId: latestOpenThread.id,
    };
  }

  if (input.mostRecentProject) {
    return {
      kind: "new-draft",
      environmentId: input.mostRecentProject.environmentId,
      projectId: input.mostRecentProject.id,
    };
  }

  return { kind: "scratch" };
}

export function lastOpenThreadRouteMatchesServerThread(
  route: LastOpenThreadRoute | null,
  environmentId: string,
  threadId: string,
): boolean {
  return (
    route?.kind === "server" &&
    route.environmentId === environmentId &&
    route.threadId === threadId
  );
}

export function lastOpenThreadRouteMatchesDraft(
  route: LastOpenThreadRoute | null,
  draftId: string,
): boolean {
  return route?.kind === "draft" && route.draftId === draftId;
}

function findThread(
  threads: readonly ChatIndexLandingThread[],
  environmentId: string,
  threadId: string,
): ChatIndexLandingThread | null {
  return (
    threads.find((thread) => thread.environmentId === environmentId && thread.id === threadId) ??
    null
  );
}
