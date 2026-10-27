import {
  EnvironmentId,
  ProjectId,
  DEFAULT_SERVER_SETTINGS,
  type ServerConfig,
  ProviderInstanceId,
  ScheduledTaskId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { resolveSettingsScope, type SettingsScopeSearch } from "./settingsScope";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  scheduledTaskDefaultModel,
  matchesScheduledTaskScope,
  scheduleFromDraft,
  taskToDraft,
} from "./scheduledTasksSettings.logic";

const laptopId = EnvironmentId.make("laptop");
const serverId = EnvironmentId.make("server");
const environments = [
  { environmentId: laptopId, label: "Laptop" },
  { environmentId: serverId, label: "Server" },
];

function member(id: string, environmentId: EnvironmentId): SidebarProjectGroupMember {
  return {
    id: ProjectId.make(id),
    environmentId,
    title: "SealCode",
    workspaceRoot: `/repos/${id}`,
    physicalProjectKey: `${environmentId}:/repos/${id}`,
    environmentLabel:
      environments.find((environment) => environment.environmentId === environmentId)?.label ??
      null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

const first = member("first", laptopId);
const second = member("second", laptopId);
const third = member("third", serverId);
const other = member("other", serverId);

function group(
  projectKey: string,
  members: readonly SidebarProjectGroupMember[],
): SidebarProjectSnapshot {
  return {
    ...members[0]!,
    projectKey,
    displayName: projectKey,
    memberProjects: members,
    memberProjectRefs: members.map((project) => ({
      environmentId: project.environmentId,
      projectId: project.id,
    })),
    groupedProjectCount: members.length,
    environmentPresence: "mixed",
    allRemoteMembersAreDesktopLocal: false,
    allRemoteMembersAreWsl: false,
    remoteEnvironmentLabels: [],
  };
}

const sameIdElsewhere = member("first", serverId);
const groups = [group("t3code", [first, second, third]), group("other", [other, sameIdElsewhere])];
const tasks = [first, second, third, other, sameIdElsewhere].map((project, index) => ({
  id: `task-${index}`,
  environmentId: project.environmentId,
  projectId: project.id,
}));

describe("scheduled task settings scope", () => {
  it.each<{ search: SettingsScopeSearch; expected: string[] }>([
    { search: {}, expected: ["task-0", "task-1", "task-2", "task-3", "task-4"] },
    { search: { machine: laptopId }, expected: ["task-0", "task-1"] },
    { search: { project: "t3code" }, expected: ["task-0", "task-1", "task-2"] },
    { search: { project: "t3code", machine: serverId }, expected: ["task-2"] },
    { search: { project: "t3code", checkout: second.physicalProjectKey }, expected: ["task-1"] },
    { search: { project: "missing" }, expected: [] },
    { search: { machine: "removed" }, expected: [] },
    { search: { project: "t3code", checkout: "removed" }, expected: [] },
    { search: { project: "other", machine: laptopId }, expected: [] },
  ])("lists only matching tasks for $search", ({ search, expected }) => {
    const scope = resolveSettingsScope(search, groups, environments);
    expect(
      tasks
        .filter((task) => matchesScheduledTaskScope(scope, task.environmentId, task.projectId))
        .map((task) => task.id),
    ).toEqual(expected);
  });

  it("keeps tasks with removed projects manageable at environment scope", () => {
    const removedProject = ProjectId.make("removed");
    expect(
      matchesScheduledTaskScope(
        resolveSettingsScope({}, groups, environments),
        laptopId,
        removedProject,
      ),
    ).toBe(true);
    expect(
      matchesScheduledTaskScope(
        resolveSettingsScope({ project: "t3code" }, groups, environments),
        laptopId,
        removedProject,
      ),
    ).toBe(false);
  });
});

const legacyTask: ScheduledTask = {
  id: ScheduledTaskId.make("legacy-task"),
  title: "Review issues",
  prompt: "Review open issues",
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
  projectId: ProjectId.make("project"),
  threadId: null,
  workspaceStrategy: { type: "worktree", baseRef: "release" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-09-17T00:00:00.000Z",
  updatedAt: "2026-09-17T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
};

describe("editing scheduled task branch settings", () => {
  it("keeps an omitted origin flag on the local base branch", () => {
    const draft = taskToDraft(legacyTask);
    expect(draft.baseRef).toBe("release");
    expect(draft.startFromOrigin).toBe(false);
  });
});

describe("saved webhook scheduled tasks", () => {
  const webhookTask: ScheduledTask = {
    ...legacyTask,
    enabled: false,
    schedule: { type: "webhook" },
  };

  it("opens as a paused daily schedule so saving moves it to a supported trigger", () => {
    const draft = taskToDraft(webhookTask);
    expect(draft.scheduleMode).toBe("fixed");
    expect(draft.enabled).toBe(false);
    expect(scheduleFromDraft(draft)).toEqual({ type: "fixed_time", timeOfDay: "09:00" });
  });
});

describe("scheduled task model defaults", () => {
  const instanceId = ProviderInstanceId.make("codex");
  const projectId = ProjectId.make("project");
  const environmentSelection = {
    instanceId,
    model: "environment-model",
    options: [{ id: "reasoning", value: "high" }],
  };
  const projectSelection = { instanceId, model: "project-model" };
  const config = {
    settings: { ...DEFAULT_SERVER_SETTINGS, defaultModelSelection: environmentSelection },
    providers: [
      {
        instanceId,
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
        models: [
          { slug: "first-model", name: "First", isCustom: false, capabilities: null },
          {
            slug: "catalog-default",
            name: "Default",
            isDefault: true,
            isCustom: false,
            capabilities: null,
          },
          { slug: "environment-model", name: "Environment", isCustom: false, capabilities: null },
          { slug: "project-model", name: "Project", isCustom: false, capabilities: null },
        ],
      },
    ],
  } as unknown as ServerConfig;
  const resolve = (
    value: ServerConfig,
    project: { id: typeof projectId; defaultModelSelection?: typeof projectSelection } | null,
  ) =>
    scheduledTaskDefaultModel(
      value.settings,
      project,
      deriveProviderInstanceEntries(value.providers),
    );
  it("uses the advertised default instead of catalog order when no default is configured", () => {
    expect(
      resolve({ ...config, settings: { ...config.settings, defaultModelSelection: null } }, null),
    ).toEqual({ instanceId, model: "catalog-default" });
  });
  it("falls back to the environment default when the project provider is unavailable", () => {
    expect(
      resolve(config, {
        id: projectId,
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("unavailable"),
          model: "missing",
        },
      }),
    ).toEqual(environmentSelection);
  });
});
