import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const GlobalMcpTransport = Schema.Literals(["stdio", "streamable-http", "sse"]);
export type GlobalMcpTransport = typeof GlobalMcpTransport.Type;

export const McpServerId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z0-9][a-z0-9_-]*$/),
);
export type McpServerId = typeof McpServerId.Type;

export const McpSecretField = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  value: Schema.String,
  sensitive: Schema.Boolean,
  valueRedacted: Schema.optionalKey(Schema.Boolean),
});
export type McpSecretField = typeof McpSecretField.Type;

export const GlobalMcpServer = Schema.Struct({
  id: McpServerId,
  displayName: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  enabled: Schema.Boolean,
  transport: GlobalMcpTransport,
  command: Schema.optionalKey(TrimmedString),
  args: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  cwd: Schema.optionalKey(TrimmedString),
  url: Schema.optionalKey(TrimmedString),
  env: Schema.Array(McpSecretField).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  headers: Schema.Array(McpSecretField).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type GlobalMcpServer = typeof GlobalMcpServer.Type;

export const GlobalMcpServerStatusState = Schema.Literals([
  "disabled",
  "connecting",
  "ready",
  "error",
  "stopped",
]);
export type GlobalMcpServerStatusState = typeof GlobalMcpServerStatusState.Type;

export const GlobalMcpStatus = Schema.Struct({
  id: McpServerId,
  state: GlobalMcpServerStatusState,
  toolCount: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  errorMessage: Schema.optionalKey(Schema.String),
  updatedAt: Schema.Number,
});
export type GlobalMcpStatus = typeof GlobalMcpStatus.Type;

export const GlobalMcpServerMap = Schema.Record(McpServerId, GlobalMcpServer);
export type GlobalMcpServerMap = typeof GlobalMcpServerMap.Type;

export const GlobalMcpStatusUpdatedEvent = Schema.Struct({
  type: Schema.Literal("mcp.status.updated"),
  statuses: Schema.Array(GlobalMcpStatus),
});
export type GlobalMcpStatusUpdatedEvent = typeof GlobalMcpStatusUpdatedEvent.Type;

export const validateGlobalMcpServerMap = (servers: GlobalMcpServerMap): string | undefined => {
  const seenIds = new Set<string>();
  for (const [mapId, server] of Object.entries(servers)) {
    if (mapId !== server.id) {
      return `MCP server map key '${mapId}' does not match server id '${server.id}'.`;
    }
    if (seenIds.has(server.id)) {
      return `MCP server id '${server.id}' is duplicated.`;
    }
    seenIds.add(server.id);

    const validateFields = (kind: "environment variable" | "header", fields: ReadonlyArray<McpSecretField>) => {
      const names = new Set<string>();
      for (const field of fields) {
        if (names.has(field.name)) {
          return `MCP server '${server.id}' has duplicate ${kind} '${field.name}'.`;
        }
        names.add(field.name);
      }
      return undefined;
    };

    const envError = validateFields("environment variable", server.env);
    if (envError) return envError;
    const headerError = validateFields("header", server.headers);
    if (headerError) return headerError;

    if (server.transport === "stdio") {
      if (!server.command?.trim()) {
        return `MCP server '${server.id}' requires a command for stdio transport.`;
      }
      if (server.url !== undefined) {
        return `MCP server '${server.id}' cannot define url for stdio transport.`;
      }
      if (server.headers.length > 0) {
        return `MCP server '${server.id}' cannot define headers for stdio transport.`;
      }
    } else {
      if (!server.url?.trim()) {
        return `MCP server '${server.id}' requires a url for ${server.transport} transport.`;
      }
      if (server.command !== undefined) {
        return `MCP server '${server.id}' cannot define command for ${server.transport} transport.`;
      }
      if (server.args.length > 0 || server.cwd !== undefined) {
        return `MCP server '${server.id}' cannot define stdio fields for ${server.transport} transport.`;
      }
      if (server.env.length > 0) {
        return `MCP server '${server.id}' cannot define environment variables for ${server.transport} transport.`;
      }
    }
  }
  return undefined;
};
