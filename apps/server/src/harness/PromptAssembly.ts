import { createHash } from "node:crypto";

import type { PromptAssemblyMetadata } from "@t3tools/contracts";

const STABLE_PREFIX_VERSION = 1;

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface PromptAssemblyInput {
  readonly stableInstructions?: string | undefined;
  readonly stableIdentity?: string | undefined;
  readonly dynamicInput: string;
  readonly stablePrefixVersion?: number | undefined;
}

export interface PromptAssemblyResult {
  readonly input: string;
  readonly stablePrefix: string;
  readonly dynamicInput: string;
  readonly metadata: PromptAssemblyMetadata;
}

/**
 * Keeps the stable part of the harness prompt explicit and hashable. Providers
 * that expose a real system/session prefix can use `stablePrefix`; providers
 * that only accept a single CLI prompt continue to receive the same wrapped
 * input through `input`.
 */
export function assemblePrompt(input: PromptAssemblyInput): PromptAssemblyResult {
  const stablePrefix = input.stableInstructions?.trim() ?? "";
  const dynamicInput = input.dynamicInput.trim();
  const stablePrefixVersion = input.stablePrefixVersion ?? STABLE_PREFIX_VERSION;
  const hashInput = `${stablePrefix}\0${input.stableIdentity?.trim() ?? ""}`;
  const metadata: PromptAssemblyMetadata = {
    ...(stablePrefix.length > 0 || input.stableIdentity
      ? { stablePrefixHash: hashText(hashInput) }
      : {}),
    stablePrefixVersion,
    cacheStatus: "not-reported",
  };

  return {
    input:
      stablePrefix.length === 0
        ? dynamicInput
        : `<sealcode_harness_instructions>\n${stablePrefix}\n</sealcode_harness_instructions>\n\n${dynamicInput}`,
    stablePrefix,
    dynamicInput,
    metadata,
  };
}

export function estimateUtf8Tokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, "utf8") / 4);
}

export function estimateInlineToolResultBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

export const __testing = { hashText };
