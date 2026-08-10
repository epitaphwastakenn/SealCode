import { describe, expect, it } from "vite-plus/test";

import { mapCommandCodeSubscriptionUsage } from "./commandCodeUsage.ts";

describe("CommandCode subscription usage", () => {
  it("maps rolling windows and the plan credit window", () => {
    const usage = mapCommandCodeSubscriptionUsage({
      checkedAt: "2026-08-10T12:00:00.000Z",
      credits: {
        credits: { monthlyCredits: 7.5 },
        windowLimits: {
          fiveHour: { used: 1, cap: 3, resetAt: 1_760_000_000 },
          weekly: { used: 3, cap: 6, resetAt: 1_760_100_000 },
        },
      },
      subscription: {
        data: {
          planId: "individual-go",
          currentPeriodStart: "2026-08-01T00:00:00.000Z",
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        },
      },
    });

    expect(usage?.plan).toBe("CommandCode Go");
    expect(usage?.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ["5 hour", (1 / 3) * 100],
      ["Weekly", 50],
      ["Monthly", 25],
    ]);
    expect(usage?.windows[2]?.resetsAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("returns no usage when the provider supplies no usable window", () => {
    expect(
      mapCommandCodeSubscriptionUsage({
        checkedAt: "2026-08-10T12:00:00.000Z",
        credits: { credits: { monthlyCredits: 5 } },
        subscription: { data: { planId: "unknown" } },
      }),
    ).toBeUndefined();
  });
});
