import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  clampSubscriptionPercent,
  collectSubscriptionUsageEntries,
  formatSubscriptionPercent,
  formatSubscriptionReset,
  subscriptionUsageEntry,
} from "./subscriptionUsage";

const environmentId = EnvironmentId.make("environment-local");

function provider(driver: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-09T12:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

const quotaWindow = {
  id: "five_hour",
  label: "5 hours",
  usedPercent: 40,
  windowDurationMins: 300,
  resetsAt: null,
};

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

describe("subscription usage entries", () => {
  it("drops quota windows the limits view already draws and keeps activity metrics", () => {
    const entry = subscriptionUsageEntry(
      provider("codex", {
        usageLimits: {
          checkedAt: "2026-08-09T12:00:00.000Z",
          windows: [{ id: "primary", kind: "session", label: "5h", usedPercent: 40 }],
        },
        subscriptionUsage: {
          plan: "Pro",
          windows: [quotaWindow],
          metrics: [{ id: "sessions", label: "Sessions", value: "12" }],
          checkedAt: "2026-08-09T12:00:00.000Z",
        },
      }),
      environmentId,
      "Local",
    );
    expect(entry?.windows).toEqual([]);
    expect(entry?.metrics).toHaveLength(1);
    expect(entry?.plan).toBe("Pro");
  });

  it("shows its own windows when the limits view reports none", () => {
    const entry = subscriptionUsageEntry(
      provider("commandcode", {
        subscriptionUsage: {
          plan: null,
          windows: [quotaWindow],
          metrics: [],
          checkedAt: "2026-08-09T12:00:00.000Z",
        },
      }),
      environmentId,
      "Local",
    );
    expect(entry?.windows).toEqual([quotaWindow]);
    expect(entry?.unavailableReason).toBeNull();
  });

  it("explains an empty report only for providers Harp reads itself", () => {
    const antigravity = subscriptionUsageEntry(
      provider("antigravity", { auth: { status: "unauthenticated" } }),
      environmentId,
      "Local",
    );
    expect(antigravity?.unavailableReason).toContain("Sign in with Google");
    expect(subscriptionUsageEntry(provider("grok"), environmentId, "Local")).toBeNull();
    expect(
      subscriptionUsageEntry(
        provider("cursor", { usageLimits: { checkedAt: "2026-08-09T12:00:00.000Z", windows: [] } }),
        environmentId,
        "Local",
      ),
    ).toBeNull();
  });

  it("skips disabled providers and hidden drivers and lists reported usage first", () => {
    const presentations = new Map([
      [
        environmentId,
        {
          entry: { target: { label: "Local" } },
          serverConfig: {
            providers: [
              provider("opencode"),
              provider("commandcode", {
                subscriptionUsage: {
                  plan: null,
                  windows: [quotaWindow],
                  metrics: [],
                  checkedAt: "2026-08-09T12:00:00.000Z",
                },
              }),
              provider("antigravity", { enabled: false }),
            ],
          },
        },
      ],
    ]);
    const entries = collectSubscriptionUsageEntries(presentations, {
      selectedEnvironmentIds: null,
      hiddenDrivers: new Set(),
    });
    expect(entries.map((entry) => entry.provider.driver)).toEqual(["commandcode", "opencode"]);
    expect(
      collectSubscriptionUsageEntries(presentations, {
        selectedEnvironmentIds: null,
        hiddenDrivers: new Set([ProviderDriverKind.make("opencode")]),
      }).map((entry) => entry.provider.driver),
    ).toEqual(["commandcode"]);
  });
});
