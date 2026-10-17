import type { SubscriptionUsage, SubscriptionUsageMetric } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";

// Labels `opencode stats` prints; it has no machine-readable output.
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
  return (
    value
      // eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC.
      .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)|[()][0-2A-Z])/g, "")
      .replace(/[─-╿]/gu, " ")
  );
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

/** Local activity only: OpenCode reports no quota denominator for it, so it stays metrics. */
export function mapOpenCodeStats(input: {
  readonly stdout: string;
  readonly checkedAt: string;
}): SubscriptionUsage | undefined {
  const lines = stripAnsiAndBoxDrawing(input.stdout).split(/\r?\n/);
  const metrics: SubscriptionUsageMetric[] = [];
  for (const [id, label] of STATS_METRICS) {
    const value = metricValue(lines, label);
    if (value) metrics.push({ id, label, value });
  }
  return metrics.length === 0
    ? undefined
    : { plan: "OpenCode local activity", windows: [], metrics, checkedAt: input.checkedAt };
}

/** `undefined` when the CLI is missing or fails; usage must never block the health check. */
export const readOpenCodeActivityUsage = Effect.fn("readOpenCodeActivityUsage")(function* (input: {
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
}) {
  const runtime = yield* OpenCodeRuntime.OpenCodeRuntime;
  const result = yield* runtime
    .runOpenCodeCommand({
      binaryPath: input.binaryPath,
      args: ["stats", "--days", "30"],
      environment: input.environment,
    })
    .pipe(Effect.timeout("10 seconds"), Effect.option);
  if (result._tag === "None" || result.value.code !== 0) return undefined;
  return mapOpenCodeStats({
    stdout: `${result.value.stdout}\n${result.value.stderr}`,
    checkedAt: DateTime.formatIso(yield* DateTime.now),
  });
});
