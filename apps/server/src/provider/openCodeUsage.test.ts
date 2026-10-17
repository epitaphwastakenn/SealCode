import { describe, expect, it } from "vite-plus/test";

import {
  mapOpenCodeGoSubscriptionUsage,
  mapOpenCodeStats,
  mergeOpenCodeSubscriptionUsage,
} from "./openCodeUsage.ts";

describe("OpenCode GO subscription usage", () => {
  it("maps the rolling, weekly, and monthly account quotas", () => {
    const usage = mapOpenCodeGoSubscriptionUsage({
      checkedAt: "2026-08-12T19:00:00.000Z",
      payload: {
        usage: {
          rolling: {
            status: "ok",
            percent: 18.5,
            resetsAt: "2026-08-12T21:56:18.573Z",
          },
          weekly: {
            status: "ok",
            percent: 42,
            resetsAt: "2026-08-17T00:00:00.573Z",
          },
          monthly: {
            status: "ok",
            percent: 73,
            resetsAt: "2026-09-02T18:45:48.573Z",
          },
        },
      },
    });

    expect(usage).toEqual({
      plan: "OpenCode GO",
      windows: [
        {
          id: "opencode-go-five-hour",
          label: "5 Hour",
          usedPercent: 18.5,
          windowDurationMins: 300,
          resetsAt: "2026-08-12T21:56:18.573Z",
        },
        {
          id: "opencode-go-weekly",
          label: "Weekly",
          usedPercent: 42,
          windowDurationMins: 10_080,
          resetsAt: "2026-08-17T00:00:00.573Z",
        },
        {
          id: "opencode-go-monthly",
          label: "Monthly",
          usedPercent: 73,
          windowDurationMins: null,
          resetsAt: "2026-09-02T18:45:48.573Z",
        },
      ],
      metrics: [],
      checkedAt: "2026-08-12T19:00:00.000Z",
    });
  });

  it("rejects partial payloads instead of displaying incomplete quotas", () => {
    expect(
      mapOpenCodeGoSubscriptionUsage({
        checkedAt: "2026-08-12T19:00:00.000Z",
        payload: {
          usage: {
            rolling: { percent: 10, resetsAt: "2026-08-12T21:00:00.000Z" },
            weekly: { percent: 20, resetsAt: "2026-08-17T00:00:00.000Z" },
          },
        },
      }),
    ).toBeUndefined();
  });

  it("keeps local activity as metadata when GO quotas are available", () => {
    const goUsage = mapOpenCodeGoSubscriptionUsage({
      checkedAt: "2026-08-12T19:00:00.000Z",
      payload: {
        usage: {
          rolling: { percent: 10, resetsAt: "2026-08-12T21:00:00.000Z" },
          weekly: { percent: 20, resetsAt: "2026-08-17T00:00:00.000Z" },
          monthly: { percent: 30, resetsAt: "2026-09-02T18:00:00.000Z" },
        },
      },
    });
    const localActivity = mapOpenCodeStats({
      checkedAt: "2026-08-12T19:00:00.000Z",
      stdout: "Sessions 12\nMessages 48",
    });

    expect(mergeOpenCodeSubscriptionUsage(goUsage, localActivity)?.metrics).toEqual([
      { id: "sessions", label: "Sessions", value: "12" },
      { id: "messages", label: "Messages", value: "48" },
    ]);
  });
});

describe("OpenCode stats usage", () => {
  it("maps the CLI overview section without inventing a quota percentage", () => {
    const usage = mapOpenCodeStats({
      checkedAt: "2026-08-10T12:00:00.000Z",
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
│Avg Cost/Day                                      $0.18  │
│Avg Tokens/Session                                1.4K  │
│Median Tokens/Session                             1.2K  │
│Input                                           12.3K  │
│Output                                           4.2K  │
│Cache Read                                      10.0K  │
│Cache Write                                      2.0K  │
└────────────────────────────────────────────────────────┘
`,
    });

    expect(usage?.plan).toBe("OpenCode local activity");
    expect(usage?.windows).toEqual([]);
    expect(usage?.metrics).toEqual([
      { id: "sessions", label: "Sessions", value: "12" },
      { id: "messages", label: "Messages", value: "48" },
      { id: "days", label: "Days", value: "7" },
      { id: "total-cost", label: "Total Cost", value: "$1.25" },
      { id: "average-cost-per-day", label: "Avg Cost/Day", value: "$0.18" },
      { id: "average-tokens-per-session", label: "Avg Tokens/Session", value: "1.4K" },
      { id: "median-tokens-per-session", label: "Median Tokens/Session", value: "1.2K" },
      { id: "input", label: "Input", value: "12.3K" },
      { id: "output", label: "Output", value: "4.2K" },
      { id: "cache-read", label: "Cache Read", value: "10.0K" },
      { id: "cache-write", label: "Cache Write", value: "2.0K" },
    ]);
  });

  it("returns no usage for command failures or empty output", () => {
    expect(
      mapOpenCodeStats({ checkedAt: "2026-08-10T12:00:00.000Z", stdout: "unknown command" }),
    ).toBeUndefined();
  });

  it("accepts colon-delimited labels after removing cursor-control ANSI", () => {
    const usage = mapOpenCodeStats({
      checkedAt: "2026-08-10T12:00:00.000Z",
      stdout: "\u001b[?25lSessions: 2\u001b[?25h\nReasoning = 640",
    });

    expect(usage?.metrics).toEqual([
      { id: "sessions", label: "Sessions", value: "2" },
      { id: "reasoning", label: "Reasoning", value: "640" },
    ]);
  });
});
