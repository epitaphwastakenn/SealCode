import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type RobloxStudioSettings } from "@t3tools/contracts";

import {
  BLENDER_MCP_SERVER_ID,
  blenderExecutableFor,
  isRobloxProjectListing,
  managedServersFor,
  OFFICIAL_SERVER_ID,
  STUDIO_BRIDGE_SERVER_ID,
  type RobloxStudioEnvironment,
} from "./RobloxStudioConfig.ts";

const environment: RobloxStudioEnvironment = {
  studioBridge: { port: 58760, mcpToken: "token" },
  officialMcpPath: "C:\\Users\\me\\AppData\\Local\\Roblox\\mcp.bat",
  studioInstalled: true,
  blenderJobsRoot: "/state/blender-jobs",
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

  it("points the Harp mode at the in-server bridge's MCP endpoint, with its token as a secret", () => {
    const servers = managedServersFor(
      withRoblox({ mode: "sealcode", officialMcpAlongside: false }),
      environment,
    );
    expect(Object.keys(servers)).toEqual([STUDIO_BRIDGE_SERVER_ID]);
    expect(servers[STUDIO_BRIDGE_SERVER_ID]).toMatchObject({
      transport: "streamable-http",
      url: "http://127.0.0.1:58760/mcp",
      headers: [{ name: "Authorization", value: "Bearer token", sensitive: true }],
    });
  });

  it("runs Roblox's own MCP alone, or beside Harp's bridge when asked", () => {
    expect(Object.keys(managedServersFor(withRoblox({ mode: "official" }), environment))).toEqual([
      OFFICIAL_SERVER_ID,
    ]);
    expect(
      Object.keys(
        managedServersFor(
          withRoblox({ mode: "sealcode", officialMcpAlongside: true }),
          environment,
        ),
      ),
    ).toEqual([STUDIO_BRIDGE_SERVER_ID, OFFICIAL_SERVER_ID]);
    expect(
      Object.keys(
        managedServersFor(withRoblox({ mode: "off", officialMcpAlongside: true }), environment),
      ),
    ).toEqual([]);
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
});

describe("blenderExecutableFor", () => {
  it("prefers the configured Blender over the one found", () => {
    expect(blenderExecutableFor(DEFAULT_SERVER_SETTINGS.robloxStudio, environment)).toBe(
      "C:\\Blender\\blender.exe",
    );
    expect(
      blenderExecutableFor(
        { ...DEFAULT_SERVER_SETTINGS.robloxStudio, blenderExecutable: "D:\\b\\blender.exe" },
        environment,
      ),
    ).toBe("D:\\b\\blender.exe");
  });
});

describe("isRobloxProjectListing", () => {
  it("recognizes Rojo projects, places, Roblox tooling and the .sealcode-roblox marker", () => {
    for (const entry of [
      "default.project.json",
      "game.rbxl",
      "Place.rbxlx",
      "wally.toml",
      "rokit.toml",
      ".sealcode-roblox",
    ]) {
      expect(isRobloxProjectListing(["README.md", entry])).toBe(true);
    }
    expect(isRobloxProjectListing(["package.json", "tsconfig.json", "src"])).toBe(false);
  });
});
