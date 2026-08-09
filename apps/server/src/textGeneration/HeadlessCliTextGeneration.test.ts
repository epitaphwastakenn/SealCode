import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { makeHeadlessCliTextGeneration } from "./HeadlessCliTextGeneration.ts";

describe("makeHeadlessCliTextGeneration", () => {
  it.effect(
    "transfers the coordinator's structured context without starting a second CLI session",
    () =>
      Effect.gen(function* () {
        const textGeneration = makeHeadlessCliTextGeneration({
          binaryPath: "agy",
          environment: {},
          provider: ProviderDriverKind.make("antigravity"),
          providerName: "Antigravity",
          protocol: "antigravity",
          platform: "win32",
        });

        const result = yield* textGeneration.generateContextTransferSummary({
          cwd: process.cwd(),
          context: "Objective: Preserve the active task.",
          modelSelection: {
            instanceId: ProviderInstanceId.make("antigravity"),
            model: "gemini-3.6-flash",
          },
        });

        expect(result).toEqual({ summary: "Objective: Preserve the active task." });
      }),
  );
});
