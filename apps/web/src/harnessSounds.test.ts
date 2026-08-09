import { describe, expect, it } from "vite-plus/test";

import { resolveHarnessSoundEvent, type HarnessSoundSnapshot } from "./harnessSounds";

const base: HarnessSoundSnapshot = {
  threadKey: "local:thread-1",
  completedAt: null,
  error: null,
  approvalRequestId: null,
  questionRequestId: null,
};

describe("resolveHarnessSoundEvent", () => {
  it.each([
    [{ ...base, error: "provider failed" }, "error"],
    [{ ...base, approvalRequestId: "approval-1" }, "permission"],
    [{ ...base, questionRequestId: "question-1" }, "question"],
    [{ ...base, completedAt: "2026-08-09T00:00:00.000Z" }, "finished"],
  ] as const)("maps a new harness state to %s", (current, expected) => {
    expect(resolveHarnessSoundEvent(base, current)).toBe(expected);
  });

  it("does not play for state restored while switching threads", () => {
    expect(
      resolveHarnessSoundEvent(base, {
        ...base,
        threadKey: "local:thread-2",
        completedAt: "2026-08-09T00:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("does not replay unchanged state", () => {
    const current = { ...base, approvalRequestId: "approval-1" };
    expect(resolveHarnessSoundEvent(current, current)).toBeNull();
  });
});
