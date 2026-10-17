import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { withSubscriptionUsageFromLimits } from "./subscriptionUsage.ts";

const checkedAt = "2026-10-17T12:00:00.000Z";

const provider = (driver: string, overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(driver),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt,
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

const weekly = {
  id: "weekly",
  kind: "weekly",
  label: "Weekly",
  usedPercent: 42,
  windowDurationMins: 10_080,
  resetsAt: "2026-10-20T00:00:00.000Z",
} as const;

describe("withSubscriptionUsageFromLimits", () => {
  it("reports a driver's limits windows as subscription usage", () => {
    const result = withSubscriptionUsageFromLimits(
      provider("commandcode", {
        usageLimits: {
          checkedAt: "2026-10-17T11:59:00.000Z",
          windows: [weekly, { id: "monthly", kind: "monthly", label: "Monthly", usedPercent: 10 }],
        },
      }),
    );

    expect(result.subscriptionUsage).toEqual({
      plan: null,
      windows: [
        {
          id: "weekly",
          label: "Weekly",
          usedPercent: 42,
          windowDurationMins: 10_080,
          resetsAt: "2026-10-20T00:00:00.000Z",
        },
        {
          id: "monthly",
          label: "Monthly",
          usedPercent: 10,
          windowDurationMins: null,
          resetsAt: null,
        },
      ],
      metrics: [],
      checkedAt: "2026-10-17T11:59:00.000Z",
    });
  });

  it("names the OpenCode Go plan from its window ids and keeps the driver's activity metrics", () => {
    const result = withSubscriptionUsageFromLimits(
      provider("opencode", {
        usageLimits: { checkedAt, windows: [{ ...weekly, id: "go_weekly" }] },
        subscriptionUsage: {
          plan: "OpenCode local activity",
          windows: [],
          metrics: [{ id: "sessions", label: "Sessions", value: "12" }],
          checkedAt,
        },
      }),
    );

    expect(result.subscriptionUsage?.plan).toBe("OpenCode Go");
    expect(result.subscriptionUsage?.windows.map((window) => window.id)).toEqual(["go_weekly"]);
    expect(result.subscriptionUsage?.metrics).toEqual([
      { id: "sessions", label: "Sessions", value: "12" },
    ]);
  });

  it("keeps activity-only usage when the account reports no quota", () => {
    const activity = {
      plan: "OpenCode local activity",
      windows: [],
      metrics: [{ id: "sessions", label: "Sessions", value: "3" }],
      checkedAt,
    };
    const result = withSubscriptionUsageFromLimits(
      provider("opencode", {
        usageLimits: { checkedAt, windows: [], unavailable: { reason: "unsupported" } },
        subscriptionUsage: activity,
      }),
    );

    expect(result.subscriptionUsage).toEqual(activity);
  });

  it("reports nothing when there are no windows and no metrics", () => {
    const unavailable = provider("cursor", {
      usageLimits: { checkedAt, windows: [], unavailable: { reason: "probeFailed" } },
    });

    expect(withSubscriptionUsageFromLimits(unavailable)).toBe(unavailable);
  });

  it("leaves drivers with their own limits view untouched", () => {
    const claude = provider("claudeAgent", { usageLimits: { checkedAt, windows: [weekly] } });

    expect(withSubscriptionUsageFromLimits(claude)).toBe(claude);
  });
});
