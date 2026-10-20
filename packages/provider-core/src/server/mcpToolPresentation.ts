import {
  COMPUTER_USE_MCP_SERVER_NAME,
  type ToolActivityIcon,
  type ToolActivitySource,
} from "@t3tools/contracts";
import { resolveT3McpToolDefinition } from "@t3tools/shared/t3McpToolPresentation";
import { COMPUTER_USE_TOOL_SOURCE } from "@t3tools/shared/toolActivity";

export function normalizeMcpText(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/gu, " ");
  return text.length > 0 && text.length <= maxLength ? text : undefined;
}

export function normalizeMcpHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.href.length <= 4096
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** The MCP server SealCode attaches to proxy the user's configured MCP servers. */
const GLOBAL_GATEWAY_SERVER = "sealcode-global";

export function mcpToolPresentation(input: {
  readonly toolName?: unknown;
  readonly serverName?: unknown;
  readonly title?: unknown;
  readonly serverDisplayName?: unknown;
  readonly iconUrl?: unknown;
  readonly iconUrlDark?: unknown;
  readonly source?: unknown;
}): {
  readonly title?: string;
  readonly toolIcon?: ToolActivityIcon;
  readonly toolSource?: ToolActivitySource;
} {
  const source =
    typeof input.source === "object" && input.source !== null ? input.source : undefined;
  const qualified =
    typeof input.toolName === "string" ? /^mcp__(.+?)__(.+)$/i.exec(input.toolName) : null;
  let server = normalizeMcpText(input.serverName ?? qualified?.[1] ?? input.serverDisplayName);
  let tool = normalizeMcpText(qualified?.[2] ?? input.toolName);
  let serverDisplayName = input.serverDisplayName;
  if (server?.toLowerCase() === GLOBAL_GATEWAY_SERVER) {
    // The gateway names each tool `mcp__<server>__<tool>`, so a client that qualifies it with
    // the gateway's own name reports the upstream server inside the tool name, and one that
    // reports the server separately leaves it in the tool name or in `qualified`.
    const upstream =
      /^mcp__(.+?)__(.+)$/i.exec(tool ?? "") ??
      (qualified?.[1]?.toLowerCase() === GLOBAL_GATEWAY_SERVER ? null : qualified);
    if (upstream) {
      server = normalizeMcpText(upstream[1]);
      tool = normalizeMcpText(upstream[2]);
      // A name the provider supplies describes the gateway, not the upstream server.
      serverDisplayName = undefined;
    }
  }
  if (server && tool && resolveT3McpToolDefinition(`${server}.${tool}`)) return {};
  if (server?.toLowerCase() === COMPUTER_USE_MCP_SERVER_NAME && tool) {
    return {
      title: normalizeMcpText(input.title) ?? tool.replace(/[_-]+/gu, " "),
      toolSource: COMPUTER_USE_TOOL_SOURCE,
    };
  }
  const title =
    normalizeMcpText(input.title) ??
    (server && tool ? normalizeMcpText(tool.replace(/[_-]+/gu, " ")) : undefined);
  if (!server) return title ? { title } : {};
  const name =
    normalizeMcpText(serverDisplayName) ??
    normalizeMcpText(source && Reflect.get(source, "name")) ??
    normalizeMcpText(server.replace(/[_-]+/gu, " ")) ??
    server;
  const logoUrl =
    normalizeMcpHttpUrl(input.iconUrl) ??
    normalizeMcpHttpUrl(source && Reflect.get(source, "logoUrl"));
  const logoUrlDark =
    normalizeMcpHttpUrl(input.iconUrlDark) ??
    normalizeMcpHttpUrl(source && Reflect.get(source, "logoUrlDark"));
  const icon = logoUrl
    ? { _tag: "themed-logo" as const, logoUrl, ...(logoUrlDark ? { logoUrlDark } : {}) }
    : undefined;
  return {
    ...(title ? { title } : {}),
    ...(icon ? { toolIcon: icon } : {}),
    toolSource: {
      key: `mcp:${server.toLowerCase()}`,
      name,
      kind: "integration",
      ...(icon ? { icon } : {}),
    },
  };
}
