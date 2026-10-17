import { describe, expect, it } from "vite-plus/test";

import {
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
