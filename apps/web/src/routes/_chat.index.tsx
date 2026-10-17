import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { LinkIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { openCommandPalette } from "../commandPaletteBus";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { resolveChatIndexLanding } from "../lib/chatIndexLanding";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import { primaryServerProvidersAtom } from "../state/server";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { APP_DISPLAY_NAME } from "~/branding";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { cn, newProjectId } from "~/lib/utils";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments } = useEnvironments();

  if (authGateState.status === "hosted-static" && environments.length === 0) {
    return <HostedStaticOnboardingState />;
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
  const lastOpenThreadRoute = useUiStateStore((state) => state.lastOpenThreadRoute);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftIds = useMemo(
    () => new Set(Object.keys(draftThreadsByThreadKey)),
    [draftThreadsByThreadKey],
  );
  const startedKeyRef = useRef<string | null>(null);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });
  const createScratchThread = useCreateScratchThread();

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
    if (landing === null) {
      return;
    }
    const landingKey = `${startState.retryRequest}:${JSON.stringify(landing)}`;
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
        await handleNewThread(scopeProjectRef(landing.environmentId, landing.projectId), {
          replace: true,
        });
        return;
      }
      await createScratchThread();
    };

    void run().catch(() => {
      startedKeyRef.current = null;
      setStartState((state) => ({ ...state, failed: true }));
    });
  }, [createScratchThread, handleNewThread, landing, navigate, startState.retryRequest]);

  if (!bootstrapped) {
    return null;
  }
  if (landing !== null && landing.kind !== "scratch") {
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
  return startState.failed ? (
    <NoProjectsHero
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

function useCreateScratchThread() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();

  return useCallback(async () => {
    if (primaryEnvironmentId === null) {
      throw new Error("Connect a local environment before starting a scratch chat.");
    }
    const projectId = newProjectId();
    const result = await createProject({
      environmentId: primaryEnvironmentId,
      input: {
        projectId,
        title: "No project",
        workspaceRoot: "~/.sealcode/scratch",
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: resolveDefaultProviderModelSelection(providers, null),
      },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) {
        return;
      }
      const error = squashAtomCommandFailure(result);
      throw error instanceof Error ? error : new Error("Could not create scratch chat.");
    }
    await handleNewThread(scopeProjectRef(primaryEnvironmentId, projectId), { replace: true });
  }, [createProject, handleNewThread, primaryEnvironmentId, providers]);
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle className="text-foreground text-xl">Couldn’t open a thread</EmptyTitle>
          <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
            Try opening the last workspace again, or start a new chat.
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry}>
              <RotateCcwIcon className="size-4" />
              Try again
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

function NoProjectsHero({ onRetry }: { readonly onRetry?: () => void }) {
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);
  const createScratchThread = useCreateScratchThread();
  const [scratchError, setScratchError] = useState<string | null>(null);
  const [creatingScratch, setCreatingScratch] = useState(false);
  const startScratch = useCallback(async () => {
    if (creatingScratch) return;
    setCreatingScratch(true);
    setScratchError(null);
    try {
      await createScratchThread();
    } catch (error) {
      setScratchError(error instanceof Error ? error.message : "Could not open scratch chat.");
      setCreatingScratch(false);
    }
  }, [createScratchThread, creatingScratch]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <Empty className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-2xl sm:text-3xl">
                Where should we work now?
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                Start a scratch chat immediately, or add a project when the agent should work in a
                repository.
              </EmptyDescription>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    if (onRetry) {
                      onRetry();
                      return;
                    }
                    void startScratch();
                  }}
                  disabled={creatingScratch}
                >
                  <PlusIcon className="size-4" />
                  {creatingScratch ? "Starting…" : "New scratch chat"}
                </Button>
                <Button size="sm" onClick={openAddProject}>
                  <PlusIcon className="size-4" />
                  Add project
                </Button>
              </div>
              {scratchError ? (
                <p className="mt-3 text-center text-xs text-destructive">{scratchError}</p>
              ) : null}
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  beforeLoad: () => {
    const lastOpenThreadRoute = useUiStateStore.getState().lastOpenThreadRoute;
    if (lastOpenThreadRoute?.kind === "server") {
      throw redirect({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: EnvironmentId.make(lastOpenThreadRoute.environmentId),
          threadId: ThreadId.make(lastOpenThreadRoute.threadId),
        },
        replace: true,
      });
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

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "border-b border-border px-3 py-2 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5 sm:py-3",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </header>

        <Empty className="flex-1">
          <div className="w-full max-w-xl rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                <LinkIcon className="size-5" />
              </div>
              <EmptyTitle className="text-foreground text-xl">
                Connect an environment to get started
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm leading-relaxed text-muted-foreground/78">
                {cloudEnabled
                  ? "Sign in to T3 Connect to connect a linked environment through its managed tunnel, or add a reachable backend manually."
                  : "Add a reachable backend manually to start working from this browser."}
              </EmptyDescription>
              <div className="mt-6 flex justify-center">
                <Button render={<Link to="/settings/connections" />} size="sm">
                  <PlusIcon className="size-4" />
                  {cloudEnabled ? "Open Connections" : "Add environment"}
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
