import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  DEFAULT_SERVER_SETTINGS,
  GlobalMcpServerMap,
  ServerSettings,
  ServerSettingsPatch,
  validateGlobalMcpServerMap,
} from "@t3tools/contracts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const decodeServerMap = Schema.decodeUnknownSync(GlobalMcpServerMap);

const stdioServer = {
  id: "roblox-studio",
  displayName: "Roblox Studio",
  enabled: true,
  transport: "stdio",
  command: "cmd.exe",
  args: ["/c", "mcp.bat"],
  env: [],
  headers: [],
} as const;

describe("global MCP settings", () => {
  it("defaults the registry to an empty map", () => {
    expect(DEFAULT_SERVER_SETTINGS.mcpServers).toEqual({});
    expect(decodeServerSettings({}).mcpServers).toEqual({});
    expect(decodeServerSettingsPatch({}).mcpServers).toBeUndefined();
  });

  it("requires the transport-specific connection fields", () => {
    expect(validateGlobalMcpServerMap(decodeServerMap({ "roblox-studio": stdioServer }))).toBeUndefined();
    expect(
      validateGlobalMcpServerMap(
        decodeServerMap({
          "roblox-studio": (() => {
            const { command: _command, ...server } = stdioServer;
            return { ...server, url: "https://example.test/mcp" };
          })(),
        }),
      ),
    ).toContain("requires a command");
    expect(
      validateGlobalMcpServerMap(
        decodeServerMap({
          "roblox-studio": (() => {
            const { command: _command, ...server } = stdioServer;
            return { ...server, transport: "sse" };
          })(),
        }),
      ),
    ).toContain("requires a url");
    expect(
      validateGlobalMcpServerMap(
        decodeServerMap({
          "roblox-studio": {
            ...stdioServer,
            headers: [{ name: "Authorization", value: "token", sensitive: true }],
          },
        }),
      ),
    ).toContain("cannot define headers");
    expect(
      validateGlobalMcpServerMap(
        decodeServerMap({
          "remote-server": {
            id: "remote-server",
            displayName: "Remote server",
            enabled: true,
            transport: "streamable-http",
            url: "https://example.test/mcp",
            args: [],
            env: [{ name: "TOKEN", value: "secret", sensitive: true }],
            headers: [],
          },
        }),
      ),
    ).toContain("cannot define environment variables");
  });

  it("rejects duplicate environment variables and headers", () => {
    const server = decodeServerMap({
      "roblox-studio": {
        ...stdioServer,
        env: [
          { name: "ROBLOX_TOKEN", value: "one", sensitive: true },
          { name: "ROBLOX_TOKEN", value: "two", sensitive: true },
        ],
      },
    });
    expect(validateGlobalMcpServerMap(server)).toContain("duplicate environment variable");

    const headerServer = decodeServerMap({
      "roblox-studio": {
        ...stdioServer,
        headers: [
          { name: "Authorization", value: "one", sensitive: true },
          { name: "Authorization", value: "two", sensitive: true },
        ],
      },
    });
    expect(validateGlobalMcpServerMap(headerServer)).toContain("duplicate header");
  });
});
