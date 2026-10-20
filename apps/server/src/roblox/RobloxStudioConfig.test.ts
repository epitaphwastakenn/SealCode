import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type RobloxStudioSettings } from "@t3tools/contracts";

import {
  BLENDER_MCP_SERVER_ID,
  isRobloxProjectListing,
  managedServersFor,
  OFFICIAL_SERVER_ID,
  ROQER_SERVER_ID,
  runSettingsFor,
  STUDIO_BRIDGE_SERVER_ID,
  type RobloxStudioEnvironment,
} from "./RobloxStudioConfig.ts";

const environment: RobloxStudioEnvironment = {
  roqer: {
    root: "/roqer",
    hostEntry: "/roqer/host/main.mjs",
    bridgeEntry: "/roqer/bridge/dist/index.mjs",
    pluginPath: "/roqer/plugin/MCPPlugin.rbxmx",
    agentRoot: "/roqer/agent",
    version: "3.0.3",
    commit: undefined,
    skills: 30,
  },
  studioBridge: { port: 58760, mcpToken: "token" },
  roqerProblem: undefined,
  nodeCommand: "/bin/node",
  officialMcpPath: "C:\\Users\\me\\AppData\\Local\\Roblox\\mcp.bat",
  studioInstalled: true,
  blenderJobsRoot: "/state/roqer/blender-jobs",
  detectedBlender: "C:\\Blender\\blender.exe",
  detectedBlenderMcp: undefined,
};

const withRoblox = (patch: Partial<RobloxStudioSettings>) => ({
  robloxStudio: { ...DEFAULT_SERVER_SETTINGS.robloxStudio, ...patch },
});

describe("managedServersFor", () => {
  it("runs nothing while the Roblox settings are off", () => {
    expect(managedServersFor(withRoblox({ mode: "off", blenderMcp: true }), environment)).toEqual(
      {},
    );
  });

  it("runs Roqer's host with the bundle, and the saved Open Cloud values in its environment", () => {
    const servers = managedServersFor(
      withRoblox({ mode: "roqer", openCloudApiKey: "key", creatorGroupId: "42" }),
      environment,
    );
    expect(Object.keys(servers)).toEqual([ROQER_SERVER_ID]);
    const roqer = servers[ROQER_SERVER_ID];
    expect(roqer?.command).toBe("/bin/node");
    expect(roqer?.args).toEqual([
      "/roqer/host/main.mjs",
      "--bridge",
      "/roqer/bridge/dist/index.mjs",
      "--plugin",
      "/roqer/plugin/MCPPlugin.rbxmx",
      "--agent",
      "/roqer/agent",
    ]);
    expect(roqer?.env).toEqual([
      { name: "ELECTRON_RUN_AS_NODE", value: "1", sensitive: false },
      { name: "ROBLOX_OPEN_CLOUD_API_KEY", value: "key", sensitive: true },
      { name: "ROBLOX_CREATOR_GROUP_ID", value: "42", sensitive: false },
    ]);
  });

  it("points the SealCode mode at the in-server bridge's MCP endpoint, with its token as a secret", () => {
    const servers = managedServersFor(
      withRoblox({ mode: "sealcode", officialMcpAlongside: true }),
      environment,
    );
    expect(Object.keys(servers).toSorted()).toEqual([OFFICIAL_SERVER_ID, STUDIO_BRIDGE_SERVER_ID]);
    expect(servers[STUDIO_BRIDGE_SERVER_ID]).toMatchObject({
      transport: "streamable-http",
      url: "http://127.0.0.1:58760/mcp",
      headers: [{ name: "Authorization", value: "Bearer token", sensitive: true }],
    });
  });

  it("hands Roqer the Blender it was given, or the one found", () => {
    const found = managedServersFor(
      withRoblox({ mode: "roqer", blenderWorker: true }),
      environment,
    );
    expect(found[ROQER_SERVER_ID]?.args.slice(-4)).toEqual([
      "--blender",
      "C:\\Blender\\blender.exe",
      "--blender-jobs",
      "/state/roqer/blender-jobs",
    ]);
    const chosen = managedServersFor(
      withRoblox({ mode: "roqer", blenderWorker: true, blenderExecutable: "D:\\b\\blender.exe" }),
      environment,
    );
    expect(chosen[ROQER_SERVER_ID]?.args).toContain("D:\\b\\blender.exe");
  });

  it("runs Roblox's own MCP alone, or beside Roqer when asked", () => {
    expect(Object.keys(managedServersFor(withRoblox({ mode: "official" }), environment))).toEqual([
      OFFICIAL_SERVER_ID,
    ]);
    expect(
      Object.keys(
        managedServersFor(withRoblox({ mode: "roqer", officialMcpAlongside: true }), environment),
      ),
    ).toEqual([ROQER_SERVER_ID, OFFICIAL_SERVER_ID]);
    expect(
      managedServersFor(withRoblox({ mode: "official" }), {
        ...environment,
        officialMcpPath: undefined,
      }),
    ).toEqual({});
  });

  it("starts a Blender MCP from its detected install, a configured command, or uvx", () => {
    const blender = (patch: Partial<RobloxStudioSettings>, detected?: string) =>
      managedServersFor(withRoblox({ mode: "official", blenderMcp: true, ...patch }), {
        ...environment,
        detectedBlenderMcp: detected,
      })[BLENDER_MCP_SERVER_ID];
    expect(blender({})).toMatchObject({ command: "uvx", args: ["blender-mcp"] });
    expect(blender({}, "C:\\mcp-for-blender.exe")).toMatchObject({
      command: "C:\\mcp-for-blender.exe",
      args: [],
    });
    expect(blender({ blenderMcpCommand: "my-blender", blenderMcpArgs: ["--x"] })).toMatchObject({
      command: "my-blender",
      args: ["--x"],
    });
  });

  it("does not start Roqer without its bundle or a Node runtime", () => {
    expect(
      managedServersFor(withRoblox({ mode: "roqer" }), { ...environment, roqer: undefined }),
    ).toEqual({});
    expect(
      managedServersFor(withRoblox({ mode: "roqer" }), { ...environment, nodeCommand: undefined }),
    ).toEqual({});
  });
});

describe("isRobloxProjectListing", () => {
  it("recognizes Rojo projects, places, Roblox tooling and the .roqer marker", () => {
    for (const entry of [
      "default.project.json",
      "game.rbxl",
      "Place.rbxlx",
      "wally.toml",
      "rokit.toml",
      ".roqer",
    ]) {
      expect(isRobloxProjectListing(["README.md", entry])).toBe(true);
    }
    expect(isRobloxProjectListing(["package.json", "tsconfig.json", "src"])).toBe(false);
  });
});

describe("runSettingsFor", () => {
  it("says how playtests, Rojo projects and Blender apply to this run", () => {
    const text = runSettingsFor({
      roblox: { ...DEFAULT_SERVER_SETTINGS.robloxStudio, autoPlaytest: false, blenderMcp: true },
      environment,
      rojoProjects: ["E:\\Game\\default.project.json"],
    });
    expect(text).toContain("Automatic playtesting is disabled");
    expect(text).toContain("`E:\\Game\\default.project.json`");
    expect(text).toContain("mcp__blender__execute_blender_code");
    expect(text).not.toContain("`blender` tool");
  });
});
