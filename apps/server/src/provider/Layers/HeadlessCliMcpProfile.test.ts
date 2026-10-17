// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { createHeadlessCliMcpProfile } from "./HeadlessCliMcpProfile.ts";

const session = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("commandcode"),
  endpoint: "http://127.0.0.1:3773/mcp",
  globalEndpoint: "http://127.0.0.1:3773/mcp/global",
  interactionEndpoint: "http://127.0.0.1:3773/mcp/interaction",
  authorizationHeader: "Bearer test-token",
};

describe("headless CLI MCP profiles", () => {
  it("writes CommandCode url and transport entries without touching the base profile", async () => {
    const baseHome = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "sealcode-headless-auth-"),
    );
    await NodeFSP.mkdir(NodePath.join(baseHome, ".commandcode"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(baseHome, ".commandcode", "auth.json"),
      "commandcode-auth",
      "utf8",
    );
    const profile = await createHeadlessCliMcpProfile("commandcode", session, {
      PATH: "test-path",
      HOME: baseHome,
      USERPROFILE: baseHome,
    });
    try {
      const config = JSON.parse(
        await NodeFSP.readFile(`${profile.root}/.commandcode/mcp.json`, "utf8"),
      ) as {
        mcpServers: Record<
          string,
          { transport: string; url: string; headers: Record<string, string> }
        >;
      };
      expect(config.mcpServers["sealcode-global"]).toEqual({
        transport: "http",
        url: session.globalEndpoint,
        headers: { Authorization: session.authorizationHeader },
      });
      expect(config.mcpServers["sealcode-interaction"]).toBeUndefined();
      expect(profile.environment.HOME).toBe(profile.root);
      expect(profile.environment.USERPROFILE).toBe(profile.root);
      expect(await NodeFSP.readFile(`${profile.root}/.commandcode/auth.json`, "utf8")).toBe(
        "commandcode-auth",
      );
    } finally {
      await profile.cleanup();
      await NodeFSP.rm(baseHome, { recursive: true, force: true });
    }
  });
});
