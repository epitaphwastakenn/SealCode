import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { McpThreadCaller } from "./McpInvocationContext.ts";

export interface McpToolVisibilityShape {
  /** Global MCP servers whose tools this thread's agent does not get. */
  readonly hiddenServers: (
    thread: Pick<McpThreadCaller, "threadId">,
  ) => Effect.Effect<ReadonlySet<string>>;
}

/** Every thread sees every server unless a feature scopes its own servers, as Roblox Studio does. */
export const McpToolVisibility = Context.Reference<McpToolVisibilityShape>(
  "t3/mcp/McpToolVisibility",
  { defaultValue: () => ({ hiddenServers: () => Effect.succeed(new Set<string>()) }) },
);
