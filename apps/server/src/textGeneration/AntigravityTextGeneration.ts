/**
 * AntigravityTextGeneration — Text generation implementation for the Antigravity SDK runtime.
 *
 * @module AntigravityTextGeneration
 */

import { TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as TextGeneration from "./TextGeneration.ts";
import { makeUnsupportedTextGeneration } from "./UnsupportedTextGeneration.ts";
import type { AntigravityBridgeProcess } from "../provider/Layers/AntigravityBridgeProcess.ts";

export interface AntigravityTextGenerationOptions {
  readonly bridgeProcess?: AntigravityBridgeProcess;
  readonly pythonPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
}

export function makeAntigravityTextGeneration(
  options: AntigravityTextGenerationOptions = {},
): TextGeneration.TextGeneration["Service"] {
  const unsupported = makeUnsupportedTextGeneration("Antigravity SDK");

  const generateContextTransferSummary: TextGeneration.TextGeneration["Service"]["generateContextTransferSummary"] =
    Effect.fn("AntigravityTextGeneration.generateContextTransferSummary")(function (input) {
      return Effect.succeed({ summary: input.context.trim() });
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("AntigravityTextGeneration.generateThreadTitle")(function (input) {
      if (!options.bridgeProcess) {
        return Effect.succeed({ title: input.prompt.slice(0, 40) });
      }
      return options.bridgeProcess
        .sendRequest<{ text: string }>("completion.generate", {
          prompt: `Generate a short title (max 5 words) for this chat prompt:\n${input.prompt}`,
        })
        .pipe(
          Effect.map((res) => ({ title: res.text.trim() || input.prompt.slice(0, 40) })),
          Effect.catchAll(() => Effect.succeed({ title: input.prompt.slice(0, 40) })),
        );
    });

  return {
    ...unsupported,
    generateContextTransferSummary,
    generateThreadTitle,
  };
}
