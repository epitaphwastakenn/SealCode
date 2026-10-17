import type {
  EnvironmentId,
  McpToolActivityMetadata,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  readonly globalEndpoint: string;
  readonly interactionEndpoint: string;
  readonly authorizationHeader: string;
}

export interface SealCodeMcpEndpoint {
  readonly name: "t3-code" | "sealcode-global";
  readonly url: string;
  readonly authorizationHeader: string;
}

export interface McpToolCatalogMapping {
  readonly canonicalName: string;
  readonly serverId: string;
  readonly serverDisplayName: string;
  readonly upstreamToolName: string;
}

export function makeSealCodeMcpEndpoints(
  session: McpProviderSessionConfig,
): ReadonlyArray<SealCodeMcpEndpoint> {
  return [
    {
      name: "t3-code",
      url: session.endpoint,
      authorizationHeader: session.authorizationHeader,
    },
    {
      name: "sealcode-global",
      url: session.globalEndpoint,
      authorizationHeader: session.authorizationHeader,
    },
  ];
}

const safeToolNamePart = (value: string): string => {
  const normalized = value.replace(/[^A-Za-z0-9_]/g, "_");
  return normalized.length > 0 ? normalized : "_";
};

const mcpToolCatalog = new Map<string, McpToolCatalogMapping>();

export function setMcpToolCatalog(entries: ReadonlyArray<McpToolCatalogMapping>): void {
  mcpToolCatalog.clear();
  for (const entry of entries) {
    mcpToolCatalog.set(entry.canonicalName, entry);
  }
}

export function clearMcpToolCatalog(): void {
  mcpToolCatalog.clear();
}

export function makeMcpToolActivityMetadata(input: {
  readonly providerToolName?: string | undefined;
  readonly serverId?: string | undefined;
  readonly serverDisplayName?: string | undefined;
  readonly upstreamToolName?: string | undefined;
  readonly canonicalToolName?: string | undefined;
  readonly callId?: string | undefined;
}): McpToolActivityMetadata | undefined {
  const providerToolName = input.providerToolName?.trim();
  const explicitCanonicalToolName = input.canonicalToolName?.trim();
  // Providers commonly qualify a gateway tool with their MCP server name,
  // producing values such as `mcp__sealcode_global__mcp__roblox_studio__get_state`.
  // The last marker is the canonical tool emitted by SealCode's gateway.
  const markerIndex = providerToolName?.toLowerCase().lastIndexOf("mcp__") ?? -1;
  const canonicalFromName = markerIndex >= 0 ? providerToolName?.slice(markerIndex) : undefined;
  const explicitCanonicalMarkerIndex =
    explicitCanonicalToolName?.toLowerCase().lastIndexOf("mcp__") ?? -1;
  const canonicalFromInput =
    explicitCanonicalMarkerIndex >= 0
      ? explicitCanonicalToolName?.slice(explicitCanonicalMarkerIndex)
      : undefined;
  const catalogCandidate = canonicalFromName ?? canonicalFromInput ?? explicitCanonicalToolName;
  const parts = catalogCandidate?.split("__") ?? [];
  const parsedServerId = parts.length >= 3 ? parts[1] : undefined;
  const parsedUpstreamToolName = parts.length >= 3 ? parts.slice(2).join("__") : undefined;
  const catalogEntry = catalogCandidate ? mcpToolCatalog.get(catalogCandidate) : undefined;
  const serverId =
    catalogEntry?.serverId || input.serverId?.trim() || parsedServerId;
  const upstreamToolName =
    catalogEntry?.upstreamToolName || input.upstreamToolName?.trim() || parsedUpstreamToolName;
  if (!serverId || !upstreamToolName) return undefined;
  const canonicalToolName =
    catalogEntry?.canonicalName ||
    canonicalFromName ||
    canonicalFromInput ||
    explicitCanonicalToolName ||
    `mcp__${safeToolNamePart(serverId)}__${safeToolNamePart(upstreamToolName)}`;
  return {
    serverId,
    ...(input.serverDisplayName?.trim() || catalogEntry?.serverDisplayName
      ? { serverDisplayName: input.serverDisplayName?.trim() || catalogEntry?.serverDisplayName }
      : {}),
    upstreamToolName,
    canonicalToolName,
    ...(providerToolName ? { providerToolName } : {}),
    ...(input.callId?.trim() ? { callId: input.callId.trim() } : {}),
  };
}

const sessionsByThread = new Map<ThreadId, McpProviderSessionConfig>();

export function setMcpProviderSession(config: McpProviderSessionConfig): void {
  sessionsByThread.set(config.threadId, config);
}

export function readMcpProviderSession(threadId: ThreadId): McpProviderSessionConfig | undefined {
  return sessionsByThread.get(threadId);
}

export function clearMcpProviderSession(threadId: ThreadId): void {
  sessionsByThread.delete(threadId);
}

export function clearAllMcpProviderSessions(): void {
  sessionsByThread.clear();
}
