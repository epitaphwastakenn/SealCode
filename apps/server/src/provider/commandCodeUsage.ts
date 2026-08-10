import { readFile } from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { SubscriptionUsage, SubscriptionUsageWindow } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

const COMMAND_CODE_API_BASE_URL = "https://api.commandcode.ai";
const COMMAND_CODE_CREDITS_PATH = "/alpha/billing/credits";
const COMMAND_CODE_SUBSCRIPTION_PATH = "/alpha/billing/subscriptions";
const REQUEST_TIMEOUT_MS = 5_000;

const PLAN_CREDIT_LIMITS: Readonly<Record<string, number>> = {
  "individual-go": 10,
  "individual-goat": 70,
  "individual-pro": 30,
  "individual-pro-v1": 80,
  "individual-provider": 15,
  "individual-max": 150,
  "individual-ultra": 300,
  "teams-pro": 40,
};

interface CommandCodeWindowPayload {
  readonly used?: unknown;
  readonly cap?: unknown;
  readonly resetAt?: unknown;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readResetTime(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const milliseconds = value < 1_000_000_000_000 ? value * 1_000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapRollingWindow(input: {
  readonly id: string;
  readonly label: string;
  readonly durationMins: number;
  readonly payload: unknown;
}): SubscriptionUsageWindow | undefined {
  const payload = asRecord(input.payload) as CommandCodeWindowPayload | undefined;
  const used = asFiniteNumber(payload?.used);
  const cap = asFiniteNumber(payload?.cap);
  if (used === undefined || cap === undefined || cap <= 0) return undefined;

  return {
    id: input.id,
    label: input.label,
    usedPercent: Math.min(100, Math.max(0, (used / cap) * 100)),
    windowDurationMins: input.durationMins,
    resetsAt: readResetTime(payload?.resetAt),
  };
}

function readCommandCodePlanLabel(planId: string | undefined): string | null {
  if (!planId) return null;
  const labels: Readonly<Record<string, string>> = {
    "individual-go": "Go",
    "individual-goat": "GOAT",
    "individual-pro": "Pro",
    "individual-pro-v1": "Pro",
    "individual-provider": "Provider",
    "individual-max": "Max",
    "individual-ultra": "Ultra",
    "teams-pro": "Teams Pro",
  };
  return labels[planId] ? `CommandCode ${labels[planId]}` : `CommandCode ${planId}`;
}

function readSubscriptionData(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  const data = asRecord(record?.data);
  return data ?? record;
}

/**
 * Normalize CommandCode's documented billing response into SealCode's
 * provider-neutral quota windows. This function is intentionally pure so the
 * wire shape stays covered without making tests depend on a live account.
 */
export function mapCommandCodeSubscriptionUsage(input: {
  readonly credits: unknown;
  readonly subscription: unknown;
  readonly checkedAt: string;
}): SubscriptionUsage | undefined {
  const credits = asRecord(input.credits);
  const windowLimits = asRecord(credits?.windowLimits);
  const windows = [
    mapRollingWindow({
      id: "commandcode-five-hour",
      label: "5 hour",
      durationMins: 5 * 60,
      payload: windowLimits?.fiveHour,
    }),
    mapRollingWindow({
      id: "commandcode-weekly",
      label: "Weekly",
      durationMins: 7 * 24 * 60,
      payload: windowLimits?.weekly,
    }),
  ].filter((window): window is SubscriptionUsageWindow => window !== undefined);

  const subscription = readSubscriptionData(input.subscription);
  const planId = typeof subscription?.planId === "string" ? subscription.planId.trim() : undefined;
  const monthlyCredits = asFiniteNumber(asRecord(credits?.credits)?.monthlyCredits);
  const monthlyLimit = planId ? PLAN_CREDIT_LIMITS[planId] : undefined;
  if (monthlyCredits !== undefined && monthlyLimit !== undefined && monthlyLimit > 0) {
    const periodStart = readResetTime(subscription?.currentPeriodStart);
    const periodEnd = readResetTime(subscription?.currentPeriodEnd);
    const start = periodStart ? Date.parse(periodStart) : Number.NaN;
    const end = periodEnd ? Date.parse(periodEnd) : Number.NaN;
    const durationMins =
      Number.isFinite(start) && Number.isFinite(end) && end >= start
        ? Math.round((end - start) / 60_000)
        : 30 * 24 * 60;
    windows.push({
      id: "commandcode-monthly",
      label: "Monthly",
      usedPercent: Math.min(
        100,
        Math.max(0, ((monthlyLimit - monthlyCredits) / monthlyLimit) * 100),
      ),
      windowDurationMins: durationMins,
      resetsAt: periodEnd,
    });
  }

  if (windows.length === 0) return undefined;
  return {
    plan: readCommandCodePlanLabel(planId),
    windows,
    metrics: [],
    checkedAt: input.checkedAt,
  };
}

function commandCodeAuthPath(environment: NodeJS.ProcessEnv): string {
  const home = environment.USERPROFILE ?? environment.HOME ?? NodeOS.homedir();
  return NodePath.join(home, ".commandcode", "auth.json");
}

async function readApiKey(environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(commandCodeAuthPath(environment), "utf8")) as unknown;
    const auth = asRecord(parsed);
    const apiKey = auth?.apiKey;
    return typeof apiKey === "string" && apiKey.trim().length > 0 ? apiKey.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function fetchJson(url: string, apiKey: string): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch CommandCode quota using the same local credential the CLI uses. */
export function probeCommandCodeSubscriptionUsage(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly checkedAt: string;
}): Effect.Effect<SubscriptionUsage | undefined> {
  return Effect.tryPromise({
    try: async () => {
      const apiKey = await readApiKey(input.environment);
      if (!apiKey) return undefined;
      const [credits, subscription] = await Promise.all([
        fetchJson(`${COMMAND_CODE_API_BASE_URL}${COMMAND_CODE_CREDITS_PATH}`, apiKey),
        fetchJson(`${COMMAND_CODE_API_BASE_URL}${COMMAND_CODE_SUBSCRIPTION_PATH}`, apiKey),
      ]);
      if (!credits || !subscription) return undefined;
      return mapCommandCodeSubscriptionUsage({
        credits,
        subscription,
        checkedAt: input.checkedAt,
      });
    },
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined));
}
