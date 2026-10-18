import type { GlobalMcpStatus } from "@t3tools/contracts";

/**
 * The thread-scoped query names which servers this thread's agent is given
 * (Roblox servers stay out of other projects); the live stream, which covers
 * every server, keeps their states current between queries.
 */
export function threadMcpServers(
  scoped: ReadonlyArray<GlobalMcpStatus> | undefined,
  live: ReadonlyArray<GlobalMcpStatus> | undefined,
): ReadonlyArray<GlobalMcpStatus> {
  if (scoped === undefined) return [];
  const liveById = new Map((live ?? []).map((status) => [status.id, status] as const));
  return scoped
    .map((status) => liveById.get(status.id) ?? status)
    .filter((status) => status.state !== "disabled")
    .sort((left, right) =>
      (left.displayName ?? left.id).localeCompare(right.displayName ?? right.id),
    );
}

export function mcpStatusLabel(status: GlobalMcpStatus): string {
  switch (status.state) {
    case "ready":
      return `${status.toolCount} ${status.toolCount === 1 ? "tool" : "tools"}`;
    case "connecting":
      return "Connecting";
    case "error":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "disabled":
      return "Off";
  }
}
