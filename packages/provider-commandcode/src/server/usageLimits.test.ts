import { describe, expect, it } from "@effect/vitest";

import { commandCodeUsageLimits } from "./usageLimits.ts";

const checkedAt = "2026-08-10T12:00:00.000Z";

describe("commandCodeUsageLimits", () => {
  it("maps the rolling windows and the plan's monthly credits", () => {
    const limits = commandCodeUsageLimits({
      checkedAt,
      credits: {
        credits: { monthlyCredits: 7.5 },
        windowLimits: {
          fiveHour: { used: 1, cap: 3, resetAt: 1_760_000_000 },
          weekly: { used: "3", cap: "6", resetAt: "2026-08-17T00:00:00.000Z" },
        },
      },
      subscription: {
        planId: "individual-go",
        currentPeriodStart: "2026-08-01T00:00:00.000Z",
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      },
    });

    expect(limits.windows.map((window) => [window.id, window.kind, window.usedPercent])).toEqual([
      ["five_hour", "session", (1 / 3) * 100],
      ["weekly", "weekly", 50],
      ["monthly", "monthly", 25],
    ]);
    // Epoch seconds and milliseconds both become ISO times.
    expect(limits.windows[0]?.resetsAt).toBe("2025-10-09T08:53:20.000Z");
    expect(limits.windows[2]).toMatchObject({
      resetsAt: "2026-09-01T00:00:00.000Z",
      windowDurationMins: 31 * 24 * 60,
    });
  });

  it("reports no windows when the account has nothing metered", () => {
    expect(
      commandCodeUsageLimits({
        checkedAt,
        credits: { credits: { monthlyCredits: 5 } },
        subscription: { planId: "unknown" },
      }).windows,
    ).toEqual([]);
  });
});
