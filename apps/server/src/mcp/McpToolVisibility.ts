import type { ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { McpThreadCaller } from "./McpInvocationContext.ts";

export interface McpToolVisibilityShape {
  /** Global MCP servers whose tools this thread's agent does not get. */
  readonly hiddenServers: (
    thread: Pick<McpThreadCaller, "threadId">,
  ) => Effect.Effect<ReadonlySet<string>>;
  /** The same, for a thread that does not exist yet, such as a draft in this project. */
  readonly hiddenServersForProject: (projectId: ProjectId) => Effect.Effect<ReadonlySet<string>>;
}

/** Every thread sees every server unless a feature scopes its own servers, as Roblox Studio does. */
export const McpToolVisibility = Context.Reference<McpToolVisibilityShape>(
  "t3/mcp/McpToolVisibility",
  {
    defaultValue: () => ({
      hiddenServers: () => Effect.succeed(new Set<string>()),
      hiddenServersForProject: () => Effect.succeed(new Set<string>()),
    }),
  },
);
