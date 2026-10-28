import type {
  EnvironmentId,
  ServerProvider,
  SubscriptionUsageMetric,
  SubscriptionUsageWindow,
} from "@t3tools/contracts";
import type { LimitPresentations } from "@t3tools/shared/usageLimits";

import { formatProviderDriverKindLabel } from "../providerModels";

export function clampSubscriptionPercent(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function formatSubscriptionPercent(value: number): string {
  return `${Math.round(clampSubscriptionPercent(value))}%`;
}

export function formatSubscriptionReset(
  resetsAt: SubscriptionUsageWindow["resetsAt"],
  now = new Date(),
): string {
  if (!resetsAt) return "Reset time unavailable";
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) return "Reset time unavailable";

  const remainingMs = reset.getTime() - now.getTime();
  if (remainingMs <= 0) return "Resetting";

  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `Resets in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `Resets in ${hours}h`;
  const days = Math.ceil(hours / 24);
  return `Resets in ${days}d`;
}

export interface SubscriptionUsageEntry {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly provider: ServerProvider;
  readonly plan: string | null;
  readonly checkedAt: string;
  readonly windows: ReadonlyArray<SubscriptionUsageWindow>;
  readonly metrics: ReadonlyArray<SubscriptionUsageMetric>;
  /** Set when the provider reported nothing and the limits view does not explain why. */
  readonly unavailableReason: string | null;
}

/**
 * Drivers whose subscription state Harp reads itself. For the rest, the limits view already
 * explains an empty state, so a card here would only repeat it.
 */
const SELF_REPORTED_DRIVERS: ReadonlySet<string> = new Set([
  "antigravity",
  "commandcode",
  "cursor",
  "opencode",
]);

export function subscriptionUnavailableReason(provider: ServerProvider): string | null {
  if (provider.availability === "unavailable") {
    return provider.unavailableReason ?? "This provider is unavailable in the current environment.";
  }
  if (!provider.enabled || provider.status === "disabled") {
    return "This provider is disabled in Harp settings. Enable it to read account usage.";
  }
  if (!provider.installed) {
    return "The provider CLI is not installed or could not be found on this environment.";
  }
  if (provider.status === "error" && provider.message?.trim()) {
    return provider.message.trim();
  }
  switch (provider.driver) {
    case "antigravity":
      return provider.auth.status === "unauthenticated"
        ? "Sign in with Google in Settings > Providers, then refresh account usage."
        : "Antigravity did not return account quota data. Refresh to try again.";
    case "commandcode":
      return "CommandCode quota is unavailable. Sign in through the CommandCode CLI and refresh.";
    case "opencode":
      return "OpenCode did not return local session statistics. Run OpenCode once, then refresh.";
    case "cursor":
      return "Cursor's signed-in session could not be read or has expired. Sign in to Cursor (or run `agent login`), then refresh.";
    default:
      return null;
  }
}

/**
 * What a provider's subscription report adds to the limits view. Quota windows the limits view
 * already draws are dropped so the same percentage never appears twice; activity metrics and
 * providers only Harp can read stay.
 */
export function subscriptionUsageEntry(
  provider: ServerProvider,
  environmentId: EnvironmentId,
  environmentLabel: string,
): SubscriptionUsageEntry | null {
  const usage = provider.subscriptionUsage;
  const limitsShowWindows = (provider.usageLimits?.windows.length ?? 0) > 0;
  const windows = limitsShowWindows ? [] : (usage?.windows ?? []);
  const metrics = usage?.metrics ?? [];
  const base = {
    environmentId,
    environmentLabel,
    provider,
    plan: usage?.plan ?? null,
    checkedAt: usage?.checkedAt ?? provider.checkedAt,
    windows,
    metrics,
  };
  if (windows.length > 0 || metrics.length > 0) return { ...base, unavailableReason: null };
  if (provider.usageLimits !== undefined || !SELF_REPORTED_DRIVERS.has(provider.driver)) {
    return null;
  }
  return {
    ...base,
    unavailableReason: usage
      ? "The provider did not return any active quota windows."
      : subscriptionUnavailableReason(provider),
  };
}

export function collectSubscriptionUsageEntries(
  presentations: LimitPresentations,
  options: {
    readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
    readonly hiddenDrivers: ReadonlySet<ServerProvider["driver"]>;
  },
): ReadonlyArray<SubscriptionUsageEntry> {
  const entries: SubscriptionUsageEntry[] = [];
  for (const [environmentId, presentation] of presentations) {
    if (options.selectedEnvironmentIds && !options.selectedEnvironmentIds.has(environmentId)) {
      continue;
    }
    for (const provider of presentation.serverConfig?.providers ?? []) {
      if (!provider.enabled || options.hiddenDrivers.has(provider.driver)) continue;
      const entry = subscriptionUsageEntry(
        provider,
        environmentId,
        presentation.entry.target.label,
      );
      if (entry) entries.push(entry);
    }
  }
  return entries.toSorted((left, right) => {
    const leftHasData = left.unavailableReason === null;
    const rightHasData = right.unavailableReason === null;
    if (leftHasData !== rightHasData) return leftHasData ? -1 : 1;
    return providerEntryName(left.provider).localeCompare(providerEntryName(right.provider));
  });
}

export function providerEntryName(provider: ServerProvider): string {
  return provider.displayName?.trim() || formatProviderDriverKindLabel(provider.driver);
}
