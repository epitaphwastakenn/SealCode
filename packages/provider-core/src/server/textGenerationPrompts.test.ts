import { describe, expect, it } from "vite-plus/test";

import {
  buildPromptSuggestionPrompt,
  PROMPT_SUGGESTION_ASSISTANT_MESSAGE_CHARS,
  PROMPT_SUGGESTION_USER_MESSAGE_CHARS,
} from "./textGenerationPrompts.ts";
import { normalizeCliError } from "./textGenerationUtils.ts";

describe("normalizeCliError", () => {
  it("does not expose CLI failure details in the public error message", () => {
    const result = normalizeCliError(
      "codex",
      "generateCommitMessage",
      new Error("request failed with access_token=secret-token"),
      "Failed to generate a commit message",
    );

    expect(result.detail).toBe("Failed to generate a commit message");
    expect(result.message).not.toContain("secret-token");
  });
});

describe("buildPromptSuggestionPrompt", () => {
  it("keeps the start of a long user message and the end of a long reply", () => {
    const { prompt } = buildPromptSuggestionPrompt({
      userMessage: `START${"u".repeat(10_000)}`,
      assistantMessage: `${"a".repeat(10_000)}FINISH`,
    });

    expect(prompt).toContain("START");
    expect(prompt).toContain("FINISH");
    expect(prompt).toContain("[truncated]");
    expect(prompt).toContain("[Earlier content truncated]");
    expect(prompt.length).toBeLessThan(
      PROMPT_SUGGESTION_USER_MESSAGE_CHARS + PROMPT_SUGGESTION_ASSISTANT_MESSAGE_CHARS + 1_500,
    );
  });

  it("passes short messages through whole", () => {
    const { prompt } = buildPromptSuggestionPrompt({
      userMessage: "Add a jump button.",
      assistantMessage: "Added it to the HUD.",
    });

    expect(prompt).toContain("Add a jump button.");
    expect(prompt).toContain("Added it to the HUD.");
    expect(prompt).not.toContain("truncated");
  });
});
