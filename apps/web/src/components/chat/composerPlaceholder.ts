import type { SessionPhase } from "../../types";

export const EMPTY_THREAD_COMPOSER_PLACEHOLDER = "Where should we work now?";
export const STARTED_THREAD_COMPOSER_PLACEHOLDER =
  "Ask anything, @tag files/folders, $use skills, or / for commands";
export const COLLAPSED_EMPTY_THREAD_COMPOSER_PLACEHOLDER = "Where should we work now?";
export const COLLAPSED_STARTED_THREAD_COMPOSER_PLACEHOLDER = "Ask anything...";

export function resolveComposerPromptPlaceholder(input: {
  readonly isComposerApprovalState: boolean;
  readonly approvalDetail: string | null | undefined;
  readonly hasPendingUserInput: boolean;
  readonly showPlanFollowUpPrompt: boolean;
  readonly hasProposedPlan: boolean;
  readonly projectSelectionRequired: boolean;
  readonly noProviderAvailable: boolean;
  readonly phase: SessionPhase;
  readonly conversationStarted: boolean;
}): string {
  if (input.isComposerApprovalState) {
    return input.approvalDetail ?? "Resolve this approval request to continue";
  }
  if (input.hasPendingUserInput) {
    return "Type your own answer, or leave this blank to use the selected option";
  }
  if (input.showPlanFollowUpPrompt && input.hasProposedPlan) {
    return "Add feedback to refine the plan, or leave this blank to implement it";
  }
  if (input.projectSelectionRequired) {
    return "Choose a project above to start a thread";
  }
  if (input.noProviderAvailable) {
    return "Enable a provider in Settings to send a message";
  }
  if (!input.conversationStarted) {
    return EMPTY_THREAD_COMPOSER_PLACEHOLDER;
  }
  if (input.phase === "disconnected") {
    return "Ask for follow-up changes or attach images";
  }
  return STARTED_THREAD_COMPOSER_PLACEHOLDER;
}

export function resolveCollapsedComposerPlaceholder(input: {
  readonly hasPendingUserInput: boolean;
  readonly pendingCustomAnswer: string;
  readonly prompt: string;
  readonly noProviderAvailable: boolean;
  readonly conversationStarted: boolean;
}): string {
  if (input.hasPendingUserInput) {
    return (
      input.pendingCustomAnswer ||
      "Type your own answer, or leave this blank to use the selected option"
    );
  }
  const trimmedPrompt = input.prompt.trim();
  if (trimmedPrompt.length > 0) {
    return trimmedPrompt;
  }
  if (input.noProviderAvailable) {
    return "Enable a provider in Settings";
  }
  return input.conversationStarted
    ? COLLAPSED_STARTED_THREAD_COMPOSER_PLACEHOLDER
    : COLLAPSED_EMPTY_THREAD_COMPOSER_PLACEHOLDER;
}
