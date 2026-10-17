import { TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";

/**
 * CommandCode only has a print mode that runs the full agent with the user's
 * account and tools. Naming a thread or writing a commit message is not worth
 * a billed agent run that can read the workspace, so choose another model for
 * those helpers.
 */
export const makeUnsupportedCommandCodeTextGeneration = (): ProviderTextGeneration => {
  const unsupported = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail:
          "CommandCode does not provide application text generation. Choose another provider for this model.",
      }),
    );
  return {
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
    generateReviewGuide: () => unsupported("generateReviewGuide"),
  };
};
