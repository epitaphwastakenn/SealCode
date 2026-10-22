import { describe, expect, it } from "@effect/vitest";
import { mcpToolPresentation } from "./mcpToolPresentation.ts";

describe("mcpToolPresentation", () => {
  it.each([
    "javascript:alert(1)",
    "file:///tmp/logo.png",
    "not a URL",
    "https://example.com/" + "x".repeat(4096),
  ])("ignores an invalid logo %s", (iconUrl) => {
    expect(
      mcpToolPresentation({
        serverName: "weather",
        toolName: "get_weather",
        iconUrl,
        title: "x".repeat(161),
      }),
    ).toEqual({
      title: "get weather",
      toolSource: { key: "mcp:weather", name: "weather", kind: "integration" },
    });
  });

  it("titles SealCode's Studio tools from their arguments, through the global gateway too", () => {
    const studioSource = { key: "mcp:studio", name: "Roblox Studio", kind: "integration" };
    expect(
      mcpToolPresentation({
        toolName: "mcp__sealcode-global__mcp__studio__get_script_source",
        arguments: { path: 'game.ServerScriptService["Main Loop"]' },
      }),
    ).toEqual({ title: "Read script Main Loop", toolSource: studioSource });
    expect(
      mcpToolPresentation({
        serverName: "studio",
        toolName: "playtest",
        arguments: { action: "start", mode: "run" },
      }),
    ).toEqual({ title: "Playtest start run", toolSource: studioSource });
    expect(mcpToolPresentation({ toolName: "mcp__studio__get_place_info" })).toEqual({
      title: "Read place info",
      toolSource: studioSource,
    });
  });
});
