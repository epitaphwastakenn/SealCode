import type { ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { makeUnsupportedTextGeneration } from "./UnsupportedTextGeneration.ts";
import * as TextGeneration from "./TextGeneration.ts";

export interface HeadlessCliTextGenerationOptions {
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly provider: ProviderDriverKind;
  readonly providerName: string;
  readonly protocol: "antigravity" | "commandcode";
  readonly platform: NodeJS.Platform;
}

export function makeHeadlessCliTextGeneration(
  options: HeadlessCliTextGenerationOptions,
): TextGeneration.TextGeneration["Service"] {
  const unsupported = makeUnsupportedTextGeneration(options.providerName);
  const generateContextTransferSummary: TextGeneration.TextGeneration["Service"]["generateContextTransferSummary"] =
    Effect.fn(`${options.providerName}TextGeneration.generateContextTransferSummary`)(
      function (input) {
        // Headless CLIs own their authentication and interactive lifecycle. Starting a
        // second invisible print session for a handoff can trigger OAuth and leave the
        // active turn failed. The coordinator already supplies a bounded, structured
        // context snapshot, so pass that snapshot through unchanged.
        return Effect.succeed({ summary: input.context.trim() });
      },
    );

  return { ...unsupported, generateContextTransferSummary };
}
