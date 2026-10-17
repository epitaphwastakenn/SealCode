import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import { type ChatAttachment, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";

import * as TextGenerationOperations from "./textGenerationOperations.ts";

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4-mini",
} as ModelSelection;
const image = {
  type: "image",
  id: "image-1",
  name: "screen.png",
  mimeType: "image/png",
  sizeBytes: 12,
} as unknown as ChatAttachment;

describe("fromRunner describeImages", () => {
  it.effect("asks the runner to read the attachments and trims the description", () =>
    Effect.gen(function* () {
      const requests: Array<TextGenerationOperations.Request<never>> = [];
      const generation = TextGenerationOperations.fromRunner("Test", ((request: never) => {
        requests.push(request);
        return Effect.succeed({ description: "  a red button  " });
      }) as unknown as TextGenerationOperations.Runner);
      const described = yield* generation.describeImages!({
        cwd: "/work",
        message: "what is wrong here?",
        attachments: [image],
        modelSelection,
      });
      expect(described.description).toBe("a red button");
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        operation: "describeImages",
        cwd: "/work",
        attachments: [image],
        modelSelection,
      });
      expect(requests[0]!.prompt).toContain("what is wrong here?");
    }),
  );

  it.effect("refuses a request that carries no image", () =>
    Effect.gen(function* () {
      const generation = TextGenerationOperations.fromRunner("Test", (() =>
        Effect.die("the runner must not run")) as unknown as TextGenerationOperations.Runner);
      const error = yield* generation.describeImages!({
        cwd: "/work",
        message: "hi",
        attachments: [],
        modelSelection,
      }).pipe(Effect.flip);
      expect(error.operation).toBe("describeImages");
    }),
  );
});
