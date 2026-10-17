import type {
  ServerProvider,
  SubscriptionUsage,
  SubscriptionUsageWindow,
} from "@t3tools/contracts";

/**
 * Drivers whose account quota SealCode reports in `subscriptionUsage`. The
 * others (Claude, Codex) have their own limits view and no extra account data.
 */
const SUBSCRIPTION_USAGE_DRIVERS: ReadonlySet<string> = new Set([
  "antigravity",
  "commandcode",
  "cursor",
  "opencode",
]);

/** Window ids OpenCode Go reports; they are the only way to tell a Go account from a Zen key. */
const OPENCODE_GO_WINDOW_PREFIX = "go_";

function planFromLimits(provider: ServerProvider): string | null {
  const windows = provider.usageLimits?.windows ?? [];
  return provider.driver === "opencode" &&
    windows.some((window) => window.id.startsWith(OPENCODE_GO_WINDOW_PREFIX))
    ? "OpenCode Go"
    : null;
}

/**
 * Quota windows come from the provider's own `usageLimits` probe, so the
 * account endpoint is queried once and both views agree. A driver can still
 * attach `metrics` (activity with no quota denominator) itself; they are kept.
 */
export function withSubscriptionUsageFromLimits(provider: ServerProvider): ServerProvider {
  if (!SUBSCRIPTION_USAGE_DRIVERS.has(provider.driver)) return provider;
  const reported = provider.subscriptionUsage;
  const limits = provider.usageLimits;
  const windows: ReadonlyArray<SubscriptionUsageWindow> =
    reported !== undefined && reported.windows.length > 0
      ? reported.windows
      : (limits?.windows ?? []).map((window) => ({
          id: window.id,
          label: window.label,
          usedPercent: window.usedPercent,
          windowDurationMins: window.windowDurationMins ?? null,
          resetsAt: window.resetsAt ?? null,
        }));
  const metrics = reported?.metrics ?? [];
  if (windows.length === 0 && metrics.length === 0) return provider;
  const subscriptionUsage: SubscriptionUsage = {
    plan: planFromLimits(provider) ?? reported?.plan ?? null,
    windows,
    metrics,
    checkedAt: reported?.checkedAt ?? limits?.checkedAt ?? provider.checkedAt,
  };
  return { ...provider, subscriptionUsage };
}
