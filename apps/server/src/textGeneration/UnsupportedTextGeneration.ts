import { TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as TextGeneration from "./TextGeneration.ts";

export function makeUnsupportedTextGeneration(
  providerName: string,
): TextGeneration.TextGeneration["Service"] {
  const unsupported = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: `${providerName} is available for chat sessions but does not expose SealCode's auxiliary text-generation API.`,
      }),
    );
  return {
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
    describeImages: () => unsupported("describeImages"),
    generateContextTransferSummary: () => unsupported("generateContextTransferSummary"),
  };
}
