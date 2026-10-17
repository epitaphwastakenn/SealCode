import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeAntigravityTextGeneration } from "./AntigravityTextGeneration.ts";

describe("AntigravityTextGeneration", () => {
  it.effect("generates context transfer summary and thread title fallback", () =>
    Effect.gen(function* () {
      const textGen = makeAntigravityTextGeneration();

      const summary = yield* textGen.generateContextTransferSummary({
        context: "Previous conversation about refactoring.",
      });
      assert.equal(summary.summary, "Previous conversation about refactoring.");

      const title = yield* textGen.generateThreadTitle({
        prompt: "Help me debug this TypeScript effect",
      });
      assert.isTrue(title.title.length > 0);
    }),
  );
});
