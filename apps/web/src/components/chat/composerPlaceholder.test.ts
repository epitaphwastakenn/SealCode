import { describe, expect, it } from "vite-plus/test";

import {
  COLLAPSED_EMPTY_THREAD_COMPOSER_PLACEHOLDER,
  COLLAPSED_STARTED_THREAD_COMPOSER_PLACEHOLDER,
  EMPTY_THREAD_COMPOSER_PLACEHOLDER,
  STARTED_THREAD_COMPOSER_PLACEHOLDER,
  resolveCollapsedComposerPlaceholder,
  resolveComposerPromptPlaceholder,
} from "./composerPlaceholder";

describe("resolveComposerPromptPlaceholder", () => {
  it("asks where to work on an empty thread", () => {
    expect(
      resolveComposerPromptPlaceholder({
        isComposerApprovalState: false,
        approvalDetail: null,
        hasPendingUserInput: false,
        showPlanFollowUpPrompt: false,
        hasProposedPlan: false,
        projectSelectionRequired: false,
        noProviderAvailable: false,
        phase: "disconnected",
        conversationStarted: false,
      }),
    ).toBe(EMPTY_THREAD_COMPOSER_PLACEHOLDER);
  });

  it("keeps the follow-up prompt after a conversation has started", () => {
    expect(
      resolveComposerPromptPlaceholder({
        isComposerApprovalState: false,
        approvalDetail: null,
        hasPendingUserInput: false,
        showPlanFollowUpPrompt: false,
        hasProposedPlan: false,
        projectSelectionRequired: false,
        noProviderAvailable: false,
        phase: "disconnected",
        conversationStarted: true,
      }),
    ).toBe("Ask for follow-up changes or attach images");
    expect(
      resolveComposerPromptPlaceholder({
        isComposerApprovalState: false,
        approvalDetail: null,
        hasPendingUserInput: false,
        showPlanFollowUpPrompt: false,
        hasProposedPlan: false,
        projectSelectionRequired: false,
        noProviderAvailable: false,
        phase: "ready",
        conversationStarted: true,
      }),
    ).toBe(STARTED_THREAD_COMPOSER_PLACEHOLDER);
  });
});

describe("resolveCollapsedComposerPlaceholder", () => {
  it("asks where to work when the collapsed composer is empty", () => {
    expect(
      resolveCollapsedComposerPlaceholder({
        hasPendingUserInput: false,
        pendingCustomAnswer: "",
        prompt: "  ",
        noProviderAvailable: false,
        conversationStarted: false,
      }),
    ).toBe(COLLAPSED_EMPTY_THREAD_COMPOSER_PLACEHOLDER);
  });

  it("keeps the short ask-anything copy after a conversation has started", () => {
    expect(
      resolveCollapsedComposerPlaceholder({
        hasPendingUserInput: false,
        pendingCustomAnswer: "",
        prompt: "",
        noProviderAvailable: false,
        conversationStarted: true,
      }),
    ).toBe(COLLAPSED_STARTED_THREAD_COMPOSER_PLACEHOLDER);
  });
});
