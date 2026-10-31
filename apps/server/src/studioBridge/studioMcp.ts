import * as Effect from "effect/Effect";

import { STUDIO_BRIDGE_BUILD } from "./StudioBridge.ts";
import { parseStudioControlsMeta, studioControlsMetaKey } from "./studioControls.ts";
import type { StudioToolContext, StudioToolDefinition } from "./StudioTools.ts";
import type { StudioToolResult } from "./toolResult.ts";

/** Lets the bridge tell which Harp thread a call came from, as GlobalMcpManager sends it. */
const THREAD_META_KEY = "sealcode/threadId";

const PROTOCOL_VERSIONS: ReadonlyArray<string> = ["2025-06-18", "2025-03-26", "2024-11-05"];

const annotationsFor = (tool: StudioToolDefinition) => ({
  title: tool.title,
  readOnlyHint: tool.risk === "read",
  destructiveHint: tool.risk === "irreversible",
  idempotentHint: tool.risk === "read",
  openWorldHint: false,
});

export type McpReply =
  | { readonly kind: "json"; readonly body: unknown }
  | { readonly kind: "accepted" };

/**
 * The small JSON-RPC subset Harp's tool gateway uses (initialize, ping, tools/list,
 * tools/call). No session state: the gateway is the only client and every call stands alone.
 */
export const handleMcpMessage = (
  message: unknown,
  tools: {
    readonly list: ReadonlyArray<StudioToolDefinition>;
    readonly call: (
      name: string,
      args: Record<string, unknown>,
      context: StudioToolContext,
    ) => Effect.Effect<StudioToolResult>;
  },
  onLinked: Effect.Effect<void>,
): Effect.Effect<McpReply> =>
  Effect.gen(function* () {
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      return {
        kind: "json",
        body: rpcError(null, -32600, "A JSON-RPC request object is required."),
      };
    }
    const { id, method, params } = message as {
      readonly id?: unknown;
      readonly method?: unknown;
      readonly params?: unknown;
    };
    if (typeof method !== "string") {
      return { kind: "json", body: rpcError(id, -32600, "A JSON-RPC method is required.") };
    }
    const reply = (result: unknown): McpReply => ({
      kind: "json",
      body: { jsonrpc: "2.0", id: id ?? null, result },
    });
    const record =
      typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
    switch (method) {
      case "initialize": {
        yield* onLinked;
        const requested = record.protocolVersion;
        return reply({
          protocolVersion:
            typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested)
              ? requested
              : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "Harp Studio", version: STUDIO_BRIDGE_BUILD },
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        yield* onLinked;
        return reply({
          tools: tools.list.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: annotationsFor(tool),
          })),
        });
      case "tools/call": {
        if (typeof record.name !== "string") {
          return { kind: "json", body: rpcError(id, -32602, "tools/call requires a tool name.") };
        }
        const args =
          typeof record.arguments === "object" &&
          record.arguments !== null &&
          !Array.isArray(record.arguments)
            ? (record.arguments as Record<string, unknown>)
            : {};
        const meta =
          typeof record._meta === "object" && record._meta !== null
            ? (record._meta as Record<string, unknown>)
            : {};
        const threadId =
          typeof meta[THREAD_META_KEY] === "string" ? meta[THREAD_META_KEY] : undefined;
        const controls = parseStudioControlsMeta(meta[studioControlsMetaKey]);
        return reply(yield* tools.call(record.name, args, { threadId, controls }));
      }
      default:
        return id === undefined
          ? { kind: "accepted" }
          : { kind: "json", body: rpcError(id, -32601, "Method not found.") };
    }
  });

const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});
