import type { SubscriptionUsage, SubscriptionUsageMetric } from "@t3tools/contracts";

const STATS_METRICS = [
  ["sessions", "Sessions"],
  ["messages", "Messages"],
  ["days", "Days"],
  ["total-cost", "Total Cost"],
  ["average-cost-per-day", "Avg Cost/Day"],
  ["average-tokens-per-session", "Avg Tokens/Session"],
  ["median-tokens-per-session", "Median Tokens/Session"],
  ["input", "Input"],
  ["output", "Output"],
  ["reasoning", "Reasoning"],
  ["cache-read", "Cache Read"],
  ["cache-write", "Cache Write"],
] as const;

function stripAnsiAndBoxDrawing(value: string): string {
  return value
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)|[()][0-2A-Z])/g, "")
    .replace(/[\u2500-\u257f]/gu, " ");
}

function metricValue(lines: ReadonlyArray<string>, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`^\\s*${escapedLabel}(?:\\s*[:=]\\s*|\\s+)(.+?)\\s*$`, "i");
  for (const line of lines) {
    const match = expression.exec(line);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

/** Parse the stable labels printed by `opencode stats`. */
export function mapOpenCodeStats(input: {
  readonly stdout: string;
  readonly checkedAt: string;
}): SubscriptionUsage | undefined {
  const lines = stripAnsiAndBoxDrawing(input.stdout).split(/\r?\n/);
  const metrics: Array<SubscriptionUsageMetric> = [];
  for (const [id, label] of STATS_METRICS) {
    const value = metricValue(lines, label);
    if (value) metrics.push({ id, label, value });
  }

  if (metrics.length === 0) return undefined;
  return {
    plan: "OpenCode local activity",
    windows: [],
    metrics,
    checkedAt: input.checkedAt,
  };
}
