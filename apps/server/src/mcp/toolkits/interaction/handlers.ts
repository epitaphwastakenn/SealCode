import * as Effect from "effect/Effect";

import * as McpInteractionBroker from "../../McpInteractionBroker.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { InteractionToolkit, McpInteractionToolError } from "./tools.ts";

const asToolError = (error: unknown): McpInteractionToolError =>
  new McpInteractionToolError({
    detail:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : McpInteractionBroker.MCP_INTERACTION_CANCELLED,
  });

const toolEffect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(asToolError));

const handlers = {
  request_user_input: (input) =>
    toolEffect(
      Effect.gen(function* () {
        const invocation = yield* McpInvocationContext.McpInvocationContext;
        const broker = yield* McpInteractionBroker.McpInteractionBroker;
        return yield* broker.invoke({
          scope: invocation,
          questions: input.questions,
        });
      }),
    ),
} satisfies Parameters<typeof InteractionToolkit.toLayer>[0];

export const InteractionToolkitHandlersLive = InteractionToolkit.toLayer(handlers);
