import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import type { McpThreadCaller } from "./McpInvocationContext.ts";

export type McpCallPolicyResult =
  | { readonly _tag: "Allow"; readonly meta?: Readonly<Record<string, unknown>> }
  | { readonly _tag: "Refuse"; readonly message: string };

export interface McpCallPolicyShape {
  readonly forCall: (input: {
    readonly thread: Pick<McpThreadCaller, "threadId">;
    readonly serverId: string;
  }) => Effect.Effect<McpCallPolicyResult>;
}

export const McpCallPolicy = Context.Reference<McpCallPolicyShape>("t3/mcp/McpCallPolicy", {
  defaultValue: () => ({ forCall: () => Effect.succeed({ _tag: "Allow" }) }),
});
