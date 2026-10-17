import { RefreshIcon } from "~/components/ui/refresh-icon";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { LinkIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { isElectron } from "../env";
import { NoProjectsHero } from "../components/NoProjectsHero";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
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
import { APP_DISPLAY_NAME } from "~/branding";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedStaticOnboardingState />;
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
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
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
    </SidebarInset>
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

function HostedStaticOnboardingState() {
  const cloudEnabled = hasCloudPublicConfig();
  const localEnvironmentOff = isLocalEnvironmentDisabled();
  const description = localEnvironmentOff
    ? "The local environment is turned off. Connect a remote environment, or turn the local environment back on in Connections."
    : cloudEnabled
      ? "Enable T3 Connect on that machine, then open Connections here to sign in with the same account. You can also add the machine using a pairing link."
      : "Open Connections and add that machine using its pairing link. This app must be able to reach it.";

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </WorkspacePageHeader>

        <Empty className="flex-1">
          <div className="w-full max-w-xl rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                <LinkIcon className="size-5" />
              </div>
              <EmptyTitle>Connect to a computer running SealCode</EmptyTitle>
              <EmptyDescription>
                This app connects to SealCode running on your computer or a server. Start the
                SealCode desktop app or command-line server on that machine and keep it running.
              </EmptyDescription>
              <EmptyDescription>{description}</EmptyDescription>
              <div className="mt-6 flex justify-center">
                <Button render={<Link to="/settings/connections" />} size="sm">
                  <PlusIcon className="size-4" />
                  Open Connections
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
