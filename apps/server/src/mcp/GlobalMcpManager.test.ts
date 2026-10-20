// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type GlobalMcpServer,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { RobloxStudioConfig } from "../roblox/RobloxStudioConfig.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as GlobalMcpManager from "./GlobalMcpManager.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";

const fakeMcpServerScript = [
  'const readline = require("node:readline");',
  'const fs = require("node:fs");',
  'if (process.env.MCP_TEST_MARKER) fs.appendFileSync(process.env.MCP_TEST_MARKER, "start\\n");',
  'const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");',
  'readline.createInterface({ input: process.stdin }).on("line", (line) => {',
  "  const request = JSON.parse(line);",
  '  if (request.method === "initialize") {',
  '    send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } } });',
  '  } else if (request.method === "tools/list") {',
  '    send({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "get_state", title: "Get state", description: "Read fake state", inputSchema: { type: "object" }, annotations: { readOnlyHint: true }, _meta: { source: "test" } }] } });',
  '  } else if (request.method === "tools/call") {',
  '    send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "ok" }], structuredContent: { ok: true, meta: request.params._meta ?? null } } });',
  "    if (process.env.MCP_TEST_EXIT_AFTER_CALL) setTimeout(() => process.exit(0), 10);",
  '  } else if (request.method === "ping") {',
  '    send({ jsonrpc: "2.0", id: request.id, result: {} });',
  "  }",
  "});",
].join("\n");

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-1"),
  requestNamespace: "provider-session-1",
  thread: {
    threadId: ThreadId.make("thread-1"),
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(),
  issuedAt: 1,
};

describe("GlobalMcpManager", () => {
  it.effect("reuses one stdio process, discovers tools, calls them, and reconnects", () => {
    const markerPath = NodePath.join(
      NodeOS.tmpdir(),
      `sealcode-mcp-manager-${NodeCrypto.randomUUID()}.log`,
    );
    const server: GlobalMcpServer = {
      id: "roblox-studio",
      displayName: "Roblox Studio",
      enabled: true,
      transport: "stdio",
      command: process.execPath,
      args: ["-e", fakeMcpServerScript],
      env: [{ name: "MCP_TEST_MARKER", value: markerPath, sensitive: false }],
      headers: [],
    };
    const layer = GlobalMcpManager.layer.pipe(
      Layer.provideMerge(
        ServerSettingsService.layerTest({
          mcpServers: { [server.id]: server },
        }),
      ),
    );

    return Effect.gen(function* () {
      const manager = yield* GlobalMcpManager.GlobalMcpManager;
      yield* manager.reload;
      const initialStatuses = yield* manager.getStatuses;
      expect(initialStatuses).toMatchObject([
        { id: "roblox-studio", state: "ready", toolCount: 1 },
      ]);

      const catalog = yield* manager.getCatalog;
      expect([...catalog.byCanonicalName.keys()]).toEqual(["mcp__roblox_studio__get_state"]);
      expect(catalog.tools[0]?.tool.annotations).toEqual({ readOnlyHint: true });

      const result = yield* manager.callTool({
        scope,
        canonicalToolName: "mcp__roblox_studio__get_state",
        arguments: {},
      });
      expect(result).toMatchObject({
        content: [{ type: "text", text: "ok" }],
        structuredContent: {
          ok: true,
          meta: { [GlobalMcpManager.THREAD_SCOPE_META_KEY]: "thread-1" },
        },
      });

      yield* manager.reload;
      expect(NodeFS.readFileSync(markerPath, "utf8").trim().split(/\r?\n/u)).toHaveLength(1);

      expect(yield* manager.reconnectServer("roblox-studio")).toMatchObject([
        { id: "roblox-studio", state: "ready", toolCount: 1 },
      ]);
      expect(NodeFS.readFileSync(markerPath, "utf8").trim().split(/\r?\n/u)).toHaveLength(2);

      const serverSettings = yield* ServerSettingsService;
      yield* serverSettings.updateSettings({
        mcpServers: { [server.id]: { ...server, enabled: false } },
      });
      yield* manager.reload;
      expect(yield* manager.getCatalog).toMatchObject({ tools: [] });
      expect(yield* manager.getStatuses).toMatchObject([
        { id: "roblox-studio", state: "disabled", toolCount: 0 },
      ]);

      yield* serverSettings.updateSettings({ mcpServers: {} });
      yield* manager.reload;
      expect(yield* manager.getCatalog).toMatchObject({ tools: [] });
      expect(yield* manager.getStatuses).toEqual([]);

      const collidingServer: GlobalMcpServer = {
        ...server,
        id: "roblox_studio",
        displayName: "Roblox Studio duplicate",
      };
      yield* serverSettings.updateSettings({
        mcpServers: {
          [server.id]: server,
          [collidingServer.id]: collidingServer,
        },
      });
      yield* manager.reload;
      expect(yield* manager.getCatalog).toMatchObject({ tools: [] });
      expect(yield* manager.getStatuses).toEqual([
        expect.objectContaining({ id: "roblox_studio", state: "error" }),
        expect.objectContaining({ id: "roblox-studio", state: "error" }),
      ]);
    }).pipe(
      Effect.provide(layer),
      Effect.ensuring(
        Effect.sync(() => {
          NodeFS.rmSync(markerPath, { force: true });
        }),
      ),
    );
  });

  const fakeServer = (id: string, markerPath: string, extraEnv: GlobalMcpServer["env"] = []) =>
    ({
      id,
      displayName: id,
      enabled: true,
      transport: "stdio",
      command: process.execPath,
      args: ["-e", fakeMcpServerScript],
      env: [{ name: "MCP_TEST_MARKER", value: markerPath, sensitive: false }, ...extraEnv],
      headers: [],
    }) satisfies GlobalMcpServer;

  const withManagedServers = (managed: Readonly<Record<string, GlobalMcpServer>>) =>
    Layer.succeed(RobloxStudioConfig, {
      ...RobloxStudioConfig.defaultValue(),
      managedServers: () => managed,
    });

  it.effect("serves the Roblox settings' servers beside the user's, and a user server wins", () => {
    const markerPath = NodePath.join(
      NodeOS.tmpdir(),
      `sealcode-mcp-managed-${NodeCrypto.randomUUID()}.log`,
    );
    const managed = {
      ...fakeServer("studio", markerPath),
      displayName: "Roblox Studio (SealCode)",
    };
    const layer = GlobalMcpManager.layer.pipe(
      Layer.provideMerge(ServerSettingsService.layerTest({ mcpServers: {} })),
      Layer.provide(withManagedServers({ studio: managed })),
    );
    return Effect.gen(function* () {
      const manager = yield* GlobalMcpManager.GlobalMcpManager;
      yield* manager.reload;
      expect(yield* manager.getStatuses).toMatchObject([
        { id: "studio", displayName: "Roblox Studio (SealCode)", state: "ready", toolCount: 1 },
      ]);
      expect((yield* manager.getCatalog).tools[0]?.serverDisplayName).toBe(
        "Roblox Studio (SealCode)",
      );

      const serverSettings = yield* ServerSettingsService;
      yield* serverSettings.updateSettings({
        mcpServers: { studio: { ...managed, displayName: "Mine" } },
      });
      yield* manager.reload;
      expect((yield* manager.getCatalog).tools[0]?.serverDisplayName).toBe("Mine");
    }).pipe(
      Effect.provide(layer),
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(markerPath, { force: true }))),
    );
  });

  // Live clock: the recovery waits out its real one-second backoff.
  it.live("brings back a stdio server that exits on its own", () => {
    const markerPath = NodePath.join(
      NodeOS.tmpdir(),
      `sealcode-mcp-recover-${NodeCrypto.randomUUID()}.log`,
    );
    const server = fakeServer("studio", markerPath, [
      { name: "MCP_TEST_EXIT_AFTER_CALL", value: "1", sensitive: false },
    ]);
    const layer = GlobalMcpManager.layer.pipe(
      Layer.provideMerge(ServerSettingsService.layerTest({ mcpServers: { [server.id]: server } })),
    );
    const awaitState = (manager: GlobalMcpManager.GlobalMcpManager["Service"], state: string) =>
      manager.streamStatusChanges.pipe(
        Stream.filter((statuses) => statuses.some((status) => status.state === state)),
        Stream.runHead,
      );
    return Effect.gen(function* () {
      const manager = yield* GlobalMcpManager.GlobalMcpManager;
      yield* manager.reload;
      yield* manager.callTool({
        scope,
        canonicalToolName: "mcp__studio__get_state",
        arguments: {},
      });
      yield* awaitState(manager, "error");
      expect(yield* manager.getCatalog).toMatchObject({ tools: [] });

      yield* awaitState(manager, "ready");
      expect((yield* manager.getCatalog).tools.map((entry) => entry.canonicalName)).toEqual([
        "mcp__studio__get_state",
      ]);
      expect(NodeFS.readFileSync(markerPath, "utf8").trim().split(/\r?\n/u)).toHaveLength(2);
    }).pipe(
      Effect.provide(layer),
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(markerPath, { force: true }))),
    );
  });
});
