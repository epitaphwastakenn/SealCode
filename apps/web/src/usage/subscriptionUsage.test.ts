import { describe, expect, it } from "vite-plus/test";

import {
  clampSubscriptionPercent,
  formatSubscriptionPercent,
  formatSubscriptionReset,
} from "./subscriptionUsage";

describe("subscription usage formatting", () => {
  it("clamps provider percentages before rendering", () => {
    expect(clampSubscriptionPercent(-2)).toBe(0);
    expect(clampSubscriptionPercent(42.4)).toBe(42.4);
    expect(clampSubscriptionPercent(120)).toBe(100);
    expect(formatSubscriptionPercent(42.4)).toBe("42%");
  });

  it("formats reset windows from the current time", () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    expect(formatSubscriptionReset("2026-08-09T12:45:00.000Z", now)).toBe("Resets in 45m");
    expect(formatSubscriptionReset("2026-08-10T14:00:00.000Z", now)).toBe("Resets in 2d");
    expect(formatSubscriptionReset(null, now)).toBe("Reset time unavailable");
  });
});
