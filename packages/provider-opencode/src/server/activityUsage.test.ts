import { describe, expect, it } from "vite-plus/test";

import { mapOpenCodeStats } from "./activityUsage.ts";

const checkedAt = "2026-10-17T12:00:00.000Z";

describe("mapOpenCodeStats", () => {
  it("maps the CLI tables to activity metrics without inventing a quota", () => {
    const usage = mapOpenCodeStats({
      checkedAt,
      stdout: `
┌────────────────────────────────────────────────────────┐
│                       OVERVIEW                         │
├────────────────────────────────────────────────────────┤
│Sessions                                           12  │
│Messages                                           48  │
│Days                                                7  │
└────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│                    COST & TOKENS                       │
├────────────────────────────────────────────────────────┤
│Total Cost                                       $1.25  │
│Avg Tokens/Session                                1.4K  │
│Cache Read                                      10.0K  │
└────────────────────────────────────────────────────────┘
`,
    });

    expect(usage).toEqual({
      plan: "OpenCode local activity",
      windows: [],
      metrics: [
        { id: "sessions", label: "Sessions", value: "12" },
        { id: "messages", label: "Messages", value: "48" },
        { id: "days", label: "Days", value: "7" },
        { id: "total-cost", label: "Total Cost", value: "$1.25" },
        { id: "average-tokens-per-session", label: "Avg Tokens/Session", value: "1.4K" },
        { id: "cache-read", label: "Cache Read", value: "10.0K" },
      ],
      checkedAt,
    });
  });

  it("accepts colon-delimited labels after removing cursor-control ANSI", () => {
    const usage = mapOpenCodeStats({
      checkedAt,
      stdout: "\u001b[?25lSessions: 2\u001b[?25h\nReasoning = 640",
    });

    expect(usage?.metrics).toEqual([
      { id: "sessions", label: "Sessions", value: "2" },
      { id: "reasoning", label: "Reasoning", value: "640" },
    ]);
  });

  it("returns nothing for output without a known label", () => {
    expect(mapOpenCodeStats({ checkedAt, stdout: "unknown command" })).toBeUndefined();
  });
});
