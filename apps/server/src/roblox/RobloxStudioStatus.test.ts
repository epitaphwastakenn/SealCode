import { describe, expect, it } from "@effect/vitest";

import { parseBridgeStatus } from "./RobloxStudioStatus.ts";

describe("parseBridgeStatus", () => {
  it("reads the host's report of the bridge, the plugin and the connected places", () => {
    expect(
      parseBridgeStatus({
        bridge: {
          state: "running",
          version: "3.0.3",
          restarts: 1,
          pluginUpdated: true,
          pluginRejected: "Studio plugin v3.0.2 (main) does not match MCP server v3.0.3",
          recentLog: ["ignored"],
        },
        http: {
          reachable: true,
          pluginConnected: true,
          instances: [
            { instanceId: "abc", role: "edit", placeName: "Obby", placeId: 12, isRunning: false },
            { role: "edit" },
          ],
        },
        warning: "Another bridge owns the port.",
      }),
    ).toEqual({
      state: "running",
      version: "3.0.3",
      restarts: 1,
      pluginUpdated: true,
      pluginRejected: "Studio plugin v3.0.2 (main) does not match MCP server v3.0.3",
      pluginConnected: true,
      places: [
        { instanceId: "abc", role: "edit", placeId: 12, placeName: "Obby", isRunning: false },
      ],
      warning: "Another bridge owns the port.",
    });
  });

  it("returns nothing for an answer that is not the host's", () => {
    expect(parseBridgeStatus({ error: "nope" })).toBeUndefined();
    expect(parseBridgeStatus("text")).toBeUndefined();
  });
});
