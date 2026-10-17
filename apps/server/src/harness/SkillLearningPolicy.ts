export interface SkillLearningSignal {
  readonly toolCallCount: number;
  readonly completedWorkflow: boolean;
  readonly hadFailure: boolean;
  readonly userCorrected: boolean;
  readonly repeatedGuidanceCount: number;
}

export type SkillLearningTrigger =
  | "multi-step-workflow"
  | "corrected-failure"
  | "repeated-guidance"
  | undefined;

export function skillLearningTrigger(signal: SkillLearningSignal): SkillLearningTrigger {
  if (signal.toolCallCount >= 5 || signal.completedWorkflow) return "multi-step-workflow";
  if (signal.hadFailure && signal.userCorrected) return "corrected-failure";
  if (signal.repeatedGuidanceCount >= 2) return "repeated-guidance";
  return undefined;
}

export const __testing = { skillLearningTrigger };
