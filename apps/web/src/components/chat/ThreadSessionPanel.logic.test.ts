import type { GlobalMcpStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mcpStatusLabel, threadMcpServers } from "./ThreadSessionPanel.logic";

const status = (overrides: Partial<GlobalMcpStatus> & Pick<GlobalMcpStatus, "id">) =>
  ({ state: "ready", toolCount: 3, updatedAt: 1, ...overrides }) satisfies GlobalMcpStatus;

describe("threadMcpServers", () => {
  it("lists only the servers the thread is given, with their live state", () => {
    const servers = threadMcpServers(
      [
        status({ id: "github", displayName: "GitHub" }),
        status({ id: "blender", state: "connecting" }),
      ],
      [
        status({ id: "blender", displayName: "Blender", state: "error", errorMessage: "exited" }),
        status({ id: "github", displayName: "GitHub" }),
        status({ id: "studio", displayName: "Roblox Studio (SealCode)" }),
      ],
    );
    expect(servers.map((server) => [server.id, server.state])).toEqual([
      ["blender", "error"],
      ["github", "ready"],
    ]);
  });

  it("leaves out disabled servers and shows nothing before the thread's list arrives", () => {
    expect(threadMcpServers([status({ id: "off", state: "disabled", toolCount: 0 })], [])).toEqual(
      [],
    );
    expect(threadMcpServers(undefined, [status({ id: "github" })])).toEqual([]);
  });
});

describe("mcpStatusLabel", () => {
  it("counts tools only once a server is ready", () => {
    expect(mcpStatusLabel(status({ id: "a", toolCount: 1 }))).toBe("1 tool");
    expect(mcpStatusLabel(status({ id: "a", toolCount: 12 }))).toBe("12 tools");
    expect(mcpStatusLabel(status({ id: "a", state: "connecting" }))).toBe("Connecting");
  });
});
