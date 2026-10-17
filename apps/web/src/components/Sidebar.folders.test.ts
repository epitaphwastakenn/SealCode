import { describe, expect, it } from "vite-plus/test";

import { legacyProjectCwdPreferenceKey } from "../uiStateStore";
import {
  buildSidebarFolderLayout,
  groupSidebarThreadsByFolder,
  planSidebarFolderHeaders,
  type SidebarFolderLayout,
} from "./Sidebar.logic";

const thread = (id: string, projectId: string | null) => ({
  id,
  environmentId: "env",
  projectId,
});

const layout = (collapsed: readonly string[] = []): SidebarFolderLayout => ({
  folderKeyByProject: new Map([
    ["env:api", "folder-api"],
    ["env:web", "folder-web"],
  ]),
  order: ["folder-web", "folder-api"],
  collapsed: new Set(collapsed),
});

describe("sidebar project folders", () => {
  it("groups threads by folder order and keeps each folder's thread order", () => {
    const grouped = groupSidebarThreadsByFolder(
      [thread("a1", "api"), thread("loose", null), thread("w1", "web"), thread("a2", "api")],
      layout(),
    );
    expect(grouped.map((entry) => entry.id)).toEqual(["w1", "a1", "a2", "loose"]);
  });

  it("anchors a collapsed folder's header to the next visible row", () => {
    const grouped = groupSidebarThreadsByFolder(
      [thread("w1", "web"), thread("a1", "api"), thread("loose", null)],
      layout(["folder-web"]),
    );
    const plan = planSidebarFolderHeaders({
      groupedThreads: grouped,
      layout: layout(["folder-web"]),
      keyOf: (entry) => entry.id,
      isVisible: (entry) => entry.id !== "w1",
    });
    expect(plan.before.get("a1")).toEqual(["folder-web", "folder-api"]);
    expect(plan.trailing).toEqual([]);
    expect(plan.threadCount.get("folder-web")).toBe(1);
  });

  it("keeps trailing headers when every following row is hidden", () => {
    const grouped = groupSidebarThreadsByFolder(
      [thread("w1", "web"), thread("a1", "api")],
      layout(["folder-api"]),
    );
    const plan = planSidebarFolderHeaders({
      groupedThreads: grouped,
      layout: layout(["folder-api"]),
      keyOf: (entry) => entry.id,
      isVisible: (entry) => entry.id === "w1",
    });
    expect(plan.before.get("w1")).toEqual(["folder-web"]);
    expect(plan.trailing).toEqual(["folder-api"]);
  });
});

describe("buildSidebarFolderLayout", () => {
  const group = (projectKey: string, physicalProjectKey: string, workspaceRoot: string) => ({
    projectKey,
    memberProjects: [{ physicalProjectKey, workspaceRoot }],
    memberProjectRefs: [{ environmentId: "env", projectId: `${projectKey}-id` }],
  });
  const groups = [
    group("alpha", "alpha-physical", "/repo/alpha"),
    group("beta", "beta-physical", "/repo/beta"),
    group("gamma", "gamma-physical", "/repo/gamma"),
  ] as unknown as Parameters<typeof buildSidebarFolderLayout>[0]["projectGroups"];
  const build = (overrides: Partial<Parameters<typeof buildSidebarFolderLayout>[0]> = {}) =>
    buildSidebarFolderLayout({
      projectGroups: groups,
      pinnedProjectKeys: [],
      projectExpandedById: {},
      projectOrder: [],
      ...overrides,
    });

  it("leads with pinned projects and ignores pins for projects that are gone", () => {
    expect(build({ pinnedProjectKeys: ["gamma", "missing", "beta"] }).order).toEqual([
      "gamma",
      "beta",
      "alpha",
    ]);
  });

  it("lets a manual drag order win, whichever key it was recorded under", () => {
    expect(build({ projectOrder: ["gamma-physical", "alpha"] }).order).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });

  it("honors collapse state saved under the project, physical or legacy path key", () => {
    const layout = build({
      projectExpandedById: {
        alpha: false,
        "beta-physical": false,
        [legacyProjectCwdPreferenceKey("/repo/gamma")]: false,
      },
    });
    expect([...layout.collapsed].toSorted()).toEqual(["alpha", "beta", "gamma"]);
    expect(build({ projectExpandedById: { alpha: true } }).collapsed.size).toBe(0);
  });

  it("maps every member project to its folder", () => {
    expect(build().folderKeyByProject.get("env:beta-id")).toBe("beta");
  });
});
