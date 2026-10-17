import { describe, expect, it } from "vite-plus/test";

import { skillLearningTrigger } from "./SkillLearningPolicy.ts";

describe("skillLearningTrigger", () => {
  it("requires a meaningful multi-step workflow", () => {
    expect(skillLearningTrigger({
      toolCallCount: 4,
      completedWorkflow: false,
      hadFailure: false,
      userCorrected: false,
      repeatedGuidanceCount: 0,
    })).toBeUndefined();
    expect(skillLearningTrigger({
      toolCallCount: 5,
      completedWorkflow: false,
      hadFailure: false,
      userCorrected: false,
      repeatedGuidanceCount: 0,
    })).toBe("multi-step-workflow");
  });

  it("detects corrected failures and repeated guidance", () => {
    expect(skillLearningTrigger({
      toolCallCount: 1,
      completedWorkflow: false,
      hadFailure: true,
      userCorrected: true,
      repeatedGuidanceCount: 0,
    })).toBe("corrected-failure");
    expect(skillLearningTrigger({
      toolCallCount: 1,
      completedWorkflow: false,
      hadFailure: false,
      userCorrected: false,
      repeatedGuidanceCount: 2,
    })).toBe("repeated-guidance");
  });
});
