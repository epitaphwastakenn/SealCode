import type { SubscriptionUsageWindow } from "@t3tools/contracts";

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
