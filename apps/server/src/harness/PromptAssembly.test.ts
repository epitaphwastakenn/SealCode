import { describe, expect, it } from "vite-plus/test";

import { assemblePrompt, estimateUtf8Tokens } from "./PromptAssembly.ts";

describe("assemblePrompt", () => {
  it("keeps the stable prefix hash independent from dynamic turn content", () => {
    const first = assemblePrompt({ stableInstructions: "Rules", dynamicInput: "first" });
    const second = assemblePrompt({ stableInstructions: "Rules", dynamicInput: "second" });
    expect(first.metadata.stablePrefixHash).toBe(second.metadata.stablePrefixHash);
    expect(first.input).toContain("<sealcode_harness_instructions>");
    expect(first.input).toContain("first");
  });

  it("changes the hash when stable instructions change", () => {
    expect(assemblePrompt({ stableInstructions: "A", dynamicInput: "x" }).metadata.stablePrefixHash)
      .not.toBe(assemblePrompt({ stableInstructions: "B", dynamicInput: "x" }).metadata.stablePrefixHash);
  });

  it("invalidates the stable hash when the provider identity changes", () => {
    expect(assemblePrompt({ stableInstructions: "A", stableIdentity: "codex:gpt-5.4", dynamicInput: "x" }).metadata.stablePrefixHash)
      .not.toBe(assemblePrompt({ stableInstructions: "A", stableIdentity: "claudeAgent:sonnet", dynamicInput: "x" }).metadata.stablePrefixHash);
  });

  it("keeps estimates separate and deterministic", () => {
    expect(estimateUtf8Tokens("1234")).toBe(1);
    expect(estimateUtf8Tokens("12345")).toBe(2);
  });
});
