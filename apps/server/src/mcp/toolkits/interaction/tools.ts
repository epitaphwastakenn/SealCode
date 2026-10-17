import { TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInteractionBroker from "../../McpInteractionBroker.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  McpInteractionBroker.McpInteractionBroker,
];

export class McpInteractionToolError extends Schema.TaggedErrorClass<McpInteractionToolError>()(
  "McpInteractionToolError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

const uniqueIds = <T extends { readonly id: string }>(items: ReadonlyArray<T>): boolean =>
  new Set(items.map((item) => item.id)).size === items.length;

const uniqueLabels = <T extends { readonly label: string }>(
  items: ReadonlyArray<T>,
): boolean => new Set(items.map((item) => item.label)).size === items.length;

const InteractionQuestionOption = Schema.Struct({
  label: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
});

const InteractionQuestion = Schema.Struct({
  id: TrimmedNonEmptyString,
  header: TrimmedNonEmptyString,
  question: TrimmedNonEmptyString,
  options: Schema.Array(InteractionQuestionOption).pipe(
    Schema.check(
      Schema.isLengthBetween(2, 3),
      Schema.makeFilter(uniqueLabels, { expected: "options with unique labels" }),
    ),
  ),
});

export const RequestUserInputInput = Schema.Struct({
  questions: Schema.Array(InteractionQuestion).pipe(
    Schema.check(
      Schema.isLengthBetween(1, 3),
      Schema.makeFilter(uniqueIds, { expected: "questions with unique ids" }),
    ),
  ),
});
export type RequestUserInputInput = typeof RequestUserInputInput.Type;

export const RequestUserInputOutput = Schema.Struct({
  answers: Schema.Record(Schema.String, Schema.String),
});
export type RequestUserInputOutput = typeof RequestUserInputOutput.Type;

export const RequestUserInputTool = Tool.make("request_user_input", {
  description:
    "Ask the SealCode user one to three single-choice questions and wait for their answers. Use this tool from the sealcode-interaction MCP server whenever user input is needed. Do not use the native ask_question tool; it cannot surface questions in print mode. Each question must include two or three mutually exclusive options. The user may pick an option or type a custom answer. This call stays blocked until the user responds or the turn is cancelled.",
  parameters: RequestUserInputInput,
  success: RequestUserInputOutput,
  failure: McpInteractionToolError,
  dependencies,
})
  .annotate(Tool.Title, "Request SealCode user input")
  .annotate(Tool.OpenWorld, false);

export const InteractionToolkit = Toolkit.make(RequestUserInputTool);
