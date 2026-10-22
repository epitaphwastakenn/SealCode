import { describe, expect, it, vi } from "vite-plus/test";
import type { RuntimeMode } from "@t3tools/contracts";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let projectRemoved = false;
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree",
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
  };
  let threadShells: ReadonlyArray<Record<string, unknown>> = [];
  let routeTarget: unknown = null;
  let runtimeModeSource: "environment" | "project" = "environment";
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
  } | null = null;
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} }],
    },
    navigate: vi.fn(async (request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
    }),
  };
  const draftStore = {
    getComposerDraft: vi.fn((): Record<string, unknown> => ({})),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() => null),
    getDraftThread: vi.fn(() => null),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    setLogicalProjectDraftThreadId: vi.fn(),
    setModelSelection: vi.fn(),
    setRuntimeMode: vi.fn(),
  };

  return {
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    draftStore,
    get projectFileRead() {
      return projectFileRead;
    },
    get projectRemoved() {
      return projectRemoved;
    },
    get threadShells() {
      return threadShells;
    },
    get routeTarget() {
      return routeTarget;
    },
    get runtimeModeSource() {
      return runtimeModeSource;
    },
    configureProjectRuntimeMode(mode: RuntimeMode) {
      targetSettings = { ...targetSettings, defaultRuntimeMode: mode };
      runtimeModeSource = "project";
    },
    viewing(nextRouteTarget: unknown, nextThreadShells: ReadonlyArray<Record<string, unknown>>) {
      routeTarget = nextRouteTarget;
      threadShells = nextThreadShells;
    },
    removeProject() {
      projectRemoved = true;
    },
    get targetSettings() {
      return targetSettings;
    },
    reset(
      nextStoredDraft: typeof storedDraft,
      workspaceDefaults = {
        envMode: "local" as "local" | "worktree",
        startFromOrigin: false,
      },
    ) {
      storedDraft = nextStoredDraft;
      projectRemoved = false;
      threadShells = [];
      routeTarget = null;
      runtimeModeSource = "environment";
      targetSettings = {
        defaultThreadEnvMode: workspaceDefaults.envMode,
        newWorktreesStartFromOrigin: workspaceDefaults.startFromOrigin,
        defaultModelSelection: null,
        defaultRuntimeMode: "full-access",
      };
      router.state.location.href = "/";
      router.navigate.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      draftStore.setModelSelection.mockClear();
      draftStore.setRuntimeMode.mockClear();
      draftStore.getComposerDraft.mockReset();
      draftStore.getComposerDraft.mockReturnValue({});
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    router,
  };
});

const testServerConfigs = () =>
  new Map([
    [
      "environment-primary",
      {
        settings: {
          ...testState.targetSettings,
          newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin,
        },
      },
    ],
    ["environment-ssh", { settings: testState.targetSettings }],
  ]);

vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: { get: () => testServerConfigs() },
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin }
      : testServerConfigs(),
}));
vi.mock("@t3tools/client-runtime/environment", () => ({
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
}));
vi.mock("@t3tools/contracts", () => ({
  DEFAULT_RUNTIME_MODE: "default",
  DEFAULT_SERVER_SETTINGS: {},
}));
vi.mock("@t3tools/shared/projectSettings", () => ({
  resolveProjectSettings: (
    settings: Record<string, unknown>,
    _projectId: unknown,
    _project: unknown,
    projectFile?: { defaultThreadEnvMode?: "local" | "worktree" } | null,
  ) => ({
    settings:
      projectFile === undefined
        ? settings
        : {
            ...settings,
            defaultThreadEnvMode:
              settings.defaultThreadEnvMode ?? projectFile?.defaultThreadEnvMode ?? "local",
          },
    sources: {
      defaultModelSelection: "environment",
      defaultThreadEnvMode: "environment",
      defaultRuntimeMode: testState.runtimeModeSource,
    },
    overrides: {},
  }),
  resolveNewThreadEnvMode: (input: {
    projectSettings: { settings: { defaultThreadEnvMode: "local" | "worktree" } };
  }) => input.projectSettings.settings.defaultThreadEnvMode,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => testState.router,
}));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../components/Sidebar.logic", () => ({ orderItemsByPreferredIds: () => [] }));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(() => null, {
    getState: () => testState.draftStore,
  });
  return {
    composerDraftHasUserContent: () => false,
    markPromotedDraftThreadByRef: vi.fn(),
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => testState.projectFileRead,
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => {
  const project = {
    id: "project-remote",
    environmentId: "environment-ssh",
    workspaceRoot: "/remote/project",
    defaultThreadEnvMode: null,
    defaultModelSelection: null,
  };
  return {
    readProject: () => (testState.projectRemoved ? null : project),
    readProjects: () => (testState.projectRemoved ? [] : [project]),
    readThreadShell: (ref: { readonly threadId: string }) =>
      testState.threadShells.find((thread) => thread.id === ref.threadId) ?? null,
    readThreadShells: () => testState.threadShells,
    useProjects: () => [],
    useThread: () => null,
  };
});
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: "primary-settings",
}));
vi.mock("../threadRoutes", () => ({ resolveThreadRouteTarget: () => testState.routeTarget }));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import { useNewThreadHandler } from "./useHandleNewThread";

describe.each([
  ["new", null],
  [
    "reusable",
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    },
  ],
])("useNewThreadHandler with a %s draft", (_, draft) => {
  it("abandons a delayed draft open when the user navigates elsewhere", async () => {
    testState.reset(draft);
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("abandons a delayed draft open when the project is removed meanwhile", async () => {
    testState.reset(draft);
    const pendingOpen = useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.removeProject();
    testState.completeProjectFileRead(null);

    await expect(pendingOpen).resolves.toBeNull();
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("seeds the draft with the target project's last-used settings, not its workspace", async () => {
    testState.reset(draft);
    const lastUsedSelection = {
      instanceId: "codex",
      model: "gpt-6.1-sol",
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    testState.viewing(null, [
      {
        id: "thread-last-used",
        environmentId: "environment-ssh",
        projectId: "project-remote",
        modelSelection: lastUsedSelection,
        runtimeMode: "auto",
        interactionMode: "plan",
        branch: "feature/last-used",
        worktreePath: "/remote/project/.worktrees/last-used",
        updatedAt: "2026-10-21T10:00:00.000Z",
      },
    ]);
    const pendingOpen = useNewThreadHandler()({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenLastCalledWith(
      "remote-project",
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        runtimeMode: "auto",
        interactionMode: "plan",
        branch: null,
        worktreePath: null,
        envMode: "local",
      }),
    );
    expect(testState.draftStore.setModelSelection).toHaveBeenLastCalledWith(
      expect.any(String),
      lastUsedSelection,
      expect.anything(),
    );
  });

  it("does not carry the viewed thread's settings into a different project", async () => {
    testState.reset(draft);
    testState.viewing(
      {
        kind: "server",
        threadRef: { environmentId: "environment-primary", threadId: "thread-other-project" },
      },
      [
        {
          id: "thread-other-project",
          environmentId: "environment-primary",
          projectId: "project-other",
          modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5", options: [] },
          runtimeMode: "approval-required",
          interactionMode: "plan",
          branch: null,
          worktreePath: null,
          updatedAt: "2026-10-21T10:00:00.000Z",
        },
      ],
    );
    const pendingOpen = useNewThreadHandler()({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.draftStore.setModelSelection).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ interactionMode: "plan" }),
    );
  });
});

describe("useNewThreadHandler runtime mode precedence", () => {
  const lastUsedThread = {
    id: "thread-last-used",
    environmentId: "environment-ssh",
    projectId: "project-remote",
    modelSelection: { instanceId: "codex", model: "gpt-6.1-sol", options: [] },
    runtimeMode: "auto",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    updatedAt: "2026-10-21T10:00:00.000Z",
  };
  const openTarget = async () => {
    const pendingOpen = useNewThreadHandler()({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);
    testState.completeProjectFileRead(null);
    await pendingOpen;
  };

  it("lets a project-configured runtime mode win over the last used one", async () => {
    testState.reset(null);
    testState.configureProjectRuntimeMode("approval-required");
    testState.viewing(null, [lastUsedThread]);
    await openTarget();

    expect(testState.draftStore.setRuntimeMode).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenLastCalledWith(
      "remote-project",
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ runtimeMode: "approval-required" }),
    );
  });

  it("keeps the runtime mode a reused draft already picked", async () => {
    testState.reset({
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    });
    testState.draftStore.getComposerDraft.mockReturnValue({ runtimeMode: "approval-required" });
    testState.viewing(null, [lastUsedThread]);
    await openTarget();

    expect(testState.draftStore.setRuntimeMode).not.toHaveBeenCalled();
  });

  it("writes the last used runtime mode where the composer reads it", async () => {
    testState.reset(null);
    testState.viewing(null, [lastUsedThread]);
    await openTarget();

    expect(testState.draftStore.setRuntimeMode).toHaveBeenCalledWith("draft-delayed", "auto");
  });
});
