import { describe, expect, it } from "vite-plus/test";

import { mapCursorPersonalUsage, mapCursorTeamSpendUsage } from "./cursorUsage.ts";

describe("Cursor team spend usage", () => {
  it("maps team spend totals to activity metrics", () => {
    const usage = mapCursorTeamSpendUsage({
      checkedAt: "2026-08-10T12:00:00.000Z",
      payload: {
        teamMemberSpend: [
          { spendCents: 125, fastPremiumRequests: 3, email: "one@example.com" },
          { spendCents: 275, fastPremiumRequests: 7, email: "two@example.com" },
        ],
        totalMembers: 2,
      },
    });

    expect(usage).toMatchObject({
      plan: "Cursor team usage",
      windows: [],
      metrics: [
        { id: "team-members", label: "Team members", value: "2" },
        { id: "cycle-spend", label: "Current cycle spend", value: "$4.00" },
        { id: "fast-premium-requests", label: "Fast premium requests", value: "10" },
      ],
    });
  });

  it("does not invent usage for an empty response", () => {
    expect(
      mapCursorTeamSpendUsage({
        checkedAt: "2026-08-10T12:00:00.000Z",
        payload: { teamMemberSpend: [] },
      }),
    ).toBeUndefined();
  });

  it("uses the API aggregate member count when spend rows are paginated", () => {
    const usage = mapCursorTeamSpendUsage({
      checkedAt: "2026-08-10T12:00:00.000Z",
      payload: {
        teamMemberSpend: [{ spendCents: 125, fastPremiumRequests: 3 }],
        totalMembers: 12,
      },
    });

    expect(usage?.metrics[0]).toEqual({
      id: "team-members",
      label: "Team members",
      value: "12",
    });
  });
});

describe("Cursor personal session usage", () => {
  it("maps the reported API and Included percentages with the billing reset", () => {
    const usage = mapCursorPersonalUsage({
      checkedAt: "2026-08-10T12:00:00.000Z",
      dashboard: {
        planUsage: {
          apiPercentUsed: 46.444,
          totalPercentUsed: 15.48,
          includedSpend: 23222,
          limit: 40000,
        },
      },
      planInfo: { planInfo: { planName: "Pro", billingCycleEnd: "1771077734000" } },
    });

    expect(usage).toMatchObject({
      plan: "Pro",
      windows: [
        {
          id: "cursor-api",
          label: "API",
          usedPercent: 46.444,
          windowDurationMins: null,
          resetsAt: "2026-02-14T14:02:14.000Z",
        },
        {
          id: "cursor-included",
          label: "Included",
          usedPercent: 15.48,
          windowDurationMins: null,
          resetsAt: "2026-02-14T14:02:14.000Z",
        },
      ],
      metrics: [],
    });
  });

  it("does not turn spend values into a fabricated percentage", () => {
    expect(
      mapCursorPersonalUsage({
        checkedAt: "2026-08-10T12:00:00.000Z",
        dashboard: { planUsage: { includedSpend: 5, limit: 100 } },
      }),
    ).toBeUndefined();
  });
});
