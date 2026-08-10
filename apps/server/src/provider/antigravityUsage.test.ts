import { describe, expect, it } from "vite-plus/test";

import { mapAntigravitySubscriptionUsage } from "./antigravityUsage.ts";

describe("Antigravity subscription usage", () => {
  it("maps quota-summary groups into model family windows", () => {
    const usage = mapAntigravitySubscriptionUsage({
      checkedAt: "2026-08-10T12:00:00.000Z",
      payload: {
        response: {
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  bucketId: "gemini-5h",
                  remaining: { remainingFraction: 0.75 },
                  resetTime: { seconds: "1786381200" },
                },
                { bucketId: "gemini-5h", remaining: { remainingFraction: 0.6 } },
                { bucketId: "gemini-weekly", remaining: { remainingFraction: 0.5 } },
              ],
            },
            {
              displayName: "Claude and GPT models",
              buckets: [{ bucketId: "claude-weekly", remaining: { remainingFraction: 0.2 } }],
            },
          ],
        },
      },
    });

    expect(usage?.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ["Gemini 5 hour", 40],
      ["Gemini Weekly", 50],
      ["Claude + GPT Weekly", 80],
    ]);
    expect(usage?.windows[0]?.resetsAt).toBe("2026-08-10T17:00:00.000Z");
  });

  it("maps the legacy model-config payload when summary groups are absent", () => {
    const usage = mapAntigravitySubscriptionUsage({
      checkedAt: "2026-08-10T12:00:00.000Z",
      payload: {
        userStatus: {
          planName: "AI Pro",
          cascadeModelConfigData: {
            clientModelConfigs: [
              { model: "gemini-3.6-flash", quotaInfo: { remainingFraction: 0.9 } },
              { model: "claude-sonnet", quotaInfo: { remainingFraction: 0.4 } },
            ],
          },
        },
      },
    });

    expect(usage?.plan).toBe("AI Pro");
    expect(usage?.windows.map((window) => window.id)).toEqual(
      expect.arrayContaining(["antigravity-gemini-5-hour", "antigravity-claude-gpt-5-hour"]),
    );
    expect(usage?.windows.map((window) => window.usedPercent)).toEqual(
      expect.arrayContaining([expect.closeTo(10), expect.closeTo(60)]),
    );
  });
});
