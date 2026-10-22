import { RefreshIcon } from "~/components/ui/refresh-icon";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { isElectron } from "../env";
import { NoProjectsHero } from "../components/NoProjectsHero";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { RouteInset } from "../components/RouteInset";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import { resolveChatIndexLanding } from "../lib/chatIndexLanding";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import {
  readProject,
  readThreadShell,
  readThreadShells,
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }

  return <IndexDraftLanding />;
}

/**
 * `/` should never be a dead glass pane. Restore the last open thread when it
 * still exists, otherwise land in a composer — a new draft for the latest
 * project, or a scratch chat when no project has been added yet.
 */
function IndexDraftLanding() {
  const navigate = useNavigate();
  const projects = useProjects();
  const threads = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const router = useRouter();
  // Read at effect time: this page stays mounted while a navigation away from
  // "/" is still loading, but the router already points at the new location.
  const isStillOnIndex = useEffectEvent(() => router.state.location.pathname === "/");
  const lastOpenThreadRoute = useUiStateStore((state) => state.lastOpenThreadRoute);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftIds = useMemo(
    () => new Set(Object.keys(draftThreadsByThreadKey)),
    [draftThreadsByThreadKey],
  );
  const startedKeyRef = useRef<string | null>(null);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const scratchTargetEnvironmentId = scratchEnvironmentId(primaryEnvironmentId);

  const mostRecentProject = useMemo(
    () =>
      bootstrapped
        ? (sortScopedProjectsForSidebar(projects, threads, "updated_at")[0] ?? null)
        : null,
    [bootstrapped, projects, threads],
  );

  const landing = useMemo(() => {
    if (!bootstrapped) {
      return null;
    }
    return resolveChatIndexLanding({
      lastOpenThreadRoute,
      threads,
      draftIds,
      mostRecentProject:
        mostRecentProject === null
          ? null
          : { environmentId: mostRecentProject.environmentId, id: mostRecentProject.id },
    });
  }, [bootstrapped, draftIds, lastOpenThreadRoute, mostRecentProject, threads]);

  useEffect(() => {
    // Starting a draft after the user has left would replace the page they picked.
    // A failed start waits for the retry button instead of looping.
    if (landing === null || startState.failed || !isStillOnIndex()) {
      return;
    }
    if (landing.kind === "scratch" && scratchTargetEnvironmentId === null) {
      return;
    }
    if (
      landing.kind === "new-draft" &&
      readProject(scopeProjectRef(landing.environmentId, landing.projectId)) === null
    ) {
      return;
    }
    const landingKey = `${startState.retryRequest}:${JSON.stringify(landing)}:${scratchTargetEnvironmentId}`;
    if (startedKeyRef.current === landingKey) {
      return;
    }
    startedKeyRef.current = landingKey;

    const run = async () => {
      if (landing.kind === "server") {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams({
            environmentId: landing.environmentId,
            threadId: landing.threadId,
          }),
          replace: true,
        });
        return;
      }
      if (landing.kind === "draft") {
        await navigate({
          to: "/draft/$draftId",
          params: buildDraftThreadRouteParams(DraftId.make(landing.draftId)),
          replace: true,
        });
        return;
      }
      if (landing.kind === "new-draft") {
        const opened = await handleNewThread(
          scopeProjectRef(landing.environmentId, landing.projectId),
          { replace: true },
        );
        if (opened === null) {
          startedKeyRef.current = null;
          setStartState((state) => ({ ...state, retryRequest: state.retryRequest + 1 }));
        }
        return;
      }
      if (scratchTargetEnvironmentId === null) {
        return;
      }
      // openScratchProject reports its own failure toast.
      const project = await openScratchProject(scratchTargetEnvironmentId);
      if (project === null) {
        throw new Error("Could not open a scratch chat.");
      }
      await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        replace: true,
      });
    };

    void run().catch(() => {
      startedKeyRef.current = null;
      setStartState((state) => ({ ...state, failed: true }));
    });
  }, [
    handleNewThread,
    landing,
    navigate,
    openScratchProject,
    scratchTargetEnvironmentId,
    startState.failed,
    startState.retryRequest,
  ]);

  if (!bootstrapped) {
    return null;
  }
  // Scratch is the last resort: without a scratch-capable environment, or once
  // it has failed, the hero lets the user pick a project or retry by hand.
  if (landing === null || landing.kind !== "scratch") {
    return startState.failed ? (
      <DraftStartError
        onRetry={() => {
          startedKeyRef.current = null;
          setStartState((state) => ({
            failed: false,
            retryRequest: state.retryRequest + 1,
          }));
        }}
      />
    ) : null;
  }
  return scratchTargetEnvironmentId === null || startState.failed ? <NoProjectsHero /> : null;
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <RouteInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>Couldn’t open a thread</EmptyTitle>
          <EmptyDescription>
            Try opening the last workspace again, or start a new chat.
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry}>
              <RefreshIcon size="md" />
              Try again
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </RouteInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  beforeLoad: () => {
    const lastOpenThreadRoute = useUiStateStore.getState().lastOpenThreadRoute;
    if (lastOpenThreadRoute?.kind === "server") {
      const environmentId = EnvironmentId.make(lastOpenThreadRoute.environmentId);
      const threadId = ThreadId.make(lastOpenThreadRoute.threadId);
      // Before the shells load the stored route is all we have. Once they have,
      // a vanished thread must not bounce "/" back to a thread that no longer exists.
      const shellsLoaded = readThreadShells().length > 0;
      if (!shellsLoaded || readThreadShell(scopeThreadRef(environmentId, threadId)) !== null) {
        throw redirect({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId },
          replace: true,
        });
      }
    }
    if (lastOpenThreadRoute?.kind === "draft") {
      const draftId = DraftId.make(lastOpenThreadRoute.draftId);
      if (useComposerDraftStore.getState().getDraftSession(draftId) !== null) {
        throw redirect({
          to: "/draft/$draftId",
          params: { draftId },
          replace: true,
        });
      }
    }
  },
  component: ChatIndexRouteView,
});
