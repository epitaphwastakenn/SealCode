import { DatabaseSync } from "node:sqlite";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type {
  SubscriptionUsage,
  SubscriptionUsageMetric,
  SubscriptionUsageWindow,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

const CURSOR_USAGE_BASE_URL = "https://api2.cursor.sh";
const CURSOR_REQUEST_TIMEOUT_MS = 5_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readResetTime(value: unknown): string | null {
  const numeric = asFiniteNumber(value);
  if (numeric !== undefined && numeric > 0) {
    const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const text = asNonEmptyString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstString(...values: ReadonlyArray<unknown>): string | undefined {
  for (const value of values) {
    const result = asNonEmptyString(value);
    if (result) return result;
  }
  return undefined;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function readSpendRatioPercent(used: unknown, limit: unknown): number | undefined {
  const usedValue = asFiniteNumber(used);
  const limitValue = asFiniteNumber(limit);
  if (usedValue === undefined || limitValue === undefined || limitValue <= 0) {
    return undefined;
  }
  return clampPercent((usedValue / limitValue) * 100);
}

function readNestedSpendPercent(
  record: Record<string, unknown> | undefined,
  poolKeys: ReadonlyArray<string>,
): number | undefined {
  if (!record) return undefined;
  const direct = readSpendRatioPercent(record.used ?? record.spend, record.limit);
  if (direct !== undefined) return direct;
  for (const key of poolKeys) {
    const nested = asRecord(record[key]);
    const value = readSpendRatioPercent(
      nested?.used ?? nested?.spend ?? nested?.includedSpend,
      nested?.limit,
    );
    if (value !== undefined) return value;
  }
  return undefined;
}

function readPercentValue(value: unknown, remaining: boolean): number | undefined {
  const numeric = asFiniteNumber(value);
  if (numeric === undefined || !Number.isFinite(numeric)) return undefined;
  return clampPercent(remaining ? 100 - numeric : numeric);
}

function readReportedPercent(
  record: Record<string, unknown> | undefined,
  usedKeys: ReadonlyArray<string>,
  remainingKeys: ReadonlyArray<string>,
): number | undefined {
  if (!record) return undefined;
  for (const key of usedKeys) {
    const value = readPercentValue(record[key], false);
    if (value !== undefined) return value;
  }
  for (const key of remainingKeys) {
    const value = readPercentValue(record[key], true);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readPoolPercent(
  record: Record<string, unknown> | undefined,
  poolKeys: ReadonlyArray<string>,
  usedKeys: ReadonlyArray<string>,
  remainingKeys: ReadonlyArray<string>,
): number | undefined {
  const direct = readReportedPercent(record, usedKeys, remainingKeys);
  if (direct !== undefined) return direct;
  for (const key of poolKeys) {
    const nested = asRecord(record?.[key]);
    const value = readReportedPercent(
      nested,
      ["percentUsed", "usedPercent", "percentageUsed"],
      ["percentRemaining", "remainingPercent"],
    );
    if (value !== undefined) return value;
  }
  return undefined;
}

function readCursorResetAt(
  dashboard: Record<string, unknown> | undefined,
  planUsage: Record<string, unknown> | undefined,
  planInfo: Record<string, unknown> | undefined,
): string | null {
  return readResetTime(
    planUsage?.billingCycleEnd ??
      planUsage?.resetAt ??
      planUsage?.resetTime ??
      dashboard?.billingCycleEnd ??
      dashboard?.resetAt ??
      dashboard?.resetTime ??
      planInfo?.billingCycleEnd ??
      planInfo?.resetAt ??
      planInfo?.resetTime,
  );
}

function addWindow(
  windows: Map<string, SubscriptionUsageWindow>,
  input: {
    readonly id: string;
    readonly label: string;
    readonly usedPercent: number | undefined;
    readonly resetsAt: string | null;
  },
): void {
  if (input.usedPercent === undefined) return;
  windows.set(input.id, {
    id: input.id,
    label: input.label,
    usedPercent: input.usedPercent,
    windowDurationMins: null,
    resetsAt: input.resetsAt,
  });
}

function readPlanName(
  dashboard: Record<string, unknown> | undefined,
  planUsage: Record<string, unknown> | undefined,
  planInfo: Record<string, unknown> | undefined,
  auth: Record<string, unknown> | undefined,
  summary: Record<string, unknown> | undefined,
): string | null {
  return (
    firstString(
      dashboard?.planName,
      dashboard?.plan,
      dashboard?.membershipType,
      dashboard?.subscriptionType,
      planUsage?.planName,
      planUsage?.plan,
      planInfo?.planName,
      planInfo?.plan,
      auth?.planName,
      auth?.plan,
      auth?.membershipType,
      summary?.planName,
      summary?.plan,
    ) ?? null
  );
}

function collectLegacyQuotaWindows(
  root: Record<string, unknown> | undefined,
  resetsAt: string | null,
  windows: Map<string, SubscriptionUsageWindow>,
): void {
  if (!root) return;
  const api = asRecord(root.api) ?? asRecord(root.apiUsage) ?? asRecord(root.apiPool);
  const included =
    asRecord(root.included) ?? asRecord(root.includedUsage) ?? asRecord(root.includedPool);
  if (!windows.has("cursor-api")) {
    addWindow(windows, {
      id: "cursor-api",
      label: "API",
      usedPercent: readPoolPercent(
        api,
        ["api", "usage"],
        ["percentUsed", "usedPercent", "percentageUsed"],
        ["percentRemaining", "remainingPercent"],
      ),
      resetsAt,
    });
  }
  if (!windows.has("cursor-included")) {
    addWindow(windows, {
      id: "cursor-included",
      label: "Included",
      usedPercent: readPoolPercent(
        included,
        ["included", "usage"],
        ["percentUsed", "usedPercent", "percentageUsed"],
        ["percentRemaining", "remainingPercent"],
      ),
      resetsAt,
    });
  }
}

function readIncludedSpendPercent(
  planUsage: Record<string, unknown> | undefined,
  planInfo: Record<string, unknown> | undefined,
): number | undefined {
  const spend = asFiniteNumber(planUsage?.includedSpend);
  if (spend === undefined) return undefined;
  const limit =
    asFiniteNumber(planUsage?.limit) ?? asFiniteNumber(planInfo?.includedAmountCents);
  if (limit !== undefined && limit > 0) {
    return clampPercent((spend / limit) * 100);
  }
  const remaining = asFiniteNumber(planUsage?.remaining);
  if (remaining !== undefined && spend + remaining > 0) {
    return clampPercent((spend / (spend + remaining)) * 100);
  }
  return undefined;
}

/** Normalize Cursor's personal period-usage response into real quota bars. */
export function mapCursorPersonalUsage(input: {
  readonly dashboard?: unknown;
  readonly planInfo?: unknown;
  readonly auth?: unknown;
  readonly summary?: unknown;
  readonly checkedAt: string;
}): SubscriptionUsage | undefined {
  const dashboard = asRecord(input.dashboard);
  const planUsage = asRecord(dashboard?.planUsage);
  const planInfoResponse = asRecord(input.planInfo);
  const planInfo = asRecord(planInfoResponse?.planInfo) ?? planInfoResponse;
  const auth = asRecord(input.auth);
  const summary = asRecord(input.summary);
  const resetsAt = readCursorResetAt(dashboard, planUsage, planInfo);
  const windows = new Map<string, SubscriptionUsageWindow>();

  addWindow(windows, {
    id: "cursor-api",
    label: "API",
    usedPercent:
      readPoolPercent(
        planUsage,
        ["api", "apiUsage", "apiPool"],
        ["apiPercentUsed", "apiUsagePercent", "apiUsedPercent"],
        ["apiPercentRemaining", "apiUsagePercentRemaining", "apiRemainingPercent"],
      ) ??
      readSpendRatioPercent(planUsage?.apiSpend, planUsage?.apiLimit) ??
      readNestedSpendPercent(planUsage, ["api", "apiUsage", "apiPool"]),
    resetsAt,
  });
  addWindow(windows, {
    id: "cursor-included",
    label: "Included",
    usedPercent:
      readPoolPercent(
        planUsage,
        ["included", "includedUsage", "includedPool"],
        ["totalPercentUsed", "autoPercentUsed", "includedPercentUsed", "includedUsagePercent"],
        ["totalPercentRemaining", "includedPercentRemaining", "includedUsagePercentRemaining"],
      ) ??
      readIncludedSpendPercent(planUsage, planInfo) ??
      readNestedSpendPercent(planUsage, ["included", "includedUsage", "includedPool"]),
    resetsAt,
  });

  if (!windows.has("cursor-api") || !windows.has("cursor-included")) {
    collectLegacyQuotaWindows(auth, resetsAt, windows);
    collectLegacyQuotaWindows(summary, resetsAt, windows);
  }

  if (windows.size === 0) return undefined;
  return {
    plan: readPlanName(dashboard, planUsage, planInfo, auth, summary),
    windows: [...windows.values()],
    metrics: [],
    checkedAt: input.checkedAt,
  };
}

interface CursorAuthTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
}

function decodeStoredToken(value: unknown): string | undefined {
  const raw =
    typeof value === "string"
      ? value
      : value instanceof Uint8Array
        ? Buffer.from(value).toString("utf8")
        : undefined;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "string") return asNonEmptyString(parsed);
      const record = asRecord(parsed);
      return firstString(
        record?.accessToken,
        record?.access_token,
        record?.refreshToken,
        record?.refresh_token,
      );
    } catch {
      return undefined;
    }
  }
  return trimmed;
}

function readCursorStateValue(filePath: string, key: string): string | undefined {
  if (!NodeFS.existsSync(filePath)) return undefined;
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(filePath, { readOnly: true });
    const statement = database.prepare("SELECT value FROM ItemTable WHERE key = ? LIMIT 1");
    const row = statement.get(key) as { readonly value?: unknown } | undefined;
    return decodeStoredToken(row?.value);
  } catch {
    return undefined;
  } finally {
    database?.close();
  }
}

function readCursorAuthJsonTokens(filePath: string): {
  readonly accessToken?: string;
  readonly refreshToken?: string;
} {
  if (!NodeFS.existsSync(filePath)) return {};
  try {
    const parsed = asRecord(JSON.parse(NodeFS.readFileSync(filePath, "utf8")));
    const accessToken = firstString(parsed?.accessToken, parsed?.access_token);
    const refreshToken = firstString(parsed?.refreshToken, parsed?.refresh_token);
    return {
      ...(accessToken ? { accessToken } : {}),
      ...(refreshToken ? { refreshToken } : {}),
    };
  } catch {
    return {};
  }
}

function resolveCursorAuthPaths(environment: NodeJS.ProcessEnv): {
  readonly stateDatabasePaths: ReadonlyArray<string>;
  readonly authJsonPaths: ReadonlyArray<string>;
} {
  const home = environment.USERPROFILE?.trim() || environment.HOME?.trim() || NodeOS.homedir();
  const appData = environment.APPDATA?.trim();
  const stateDatabasePaths: Array<string> = [];
  const authJsonPaths: Array<string> = [];
  if (appData) {
    stateDatabasePaths.push(
      NodePath.join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
    );
    authJsonPaths.push(NodePath.join(appData, "Cursor", "auth.json"));
  }
  if (process.platform !== "win32") {
    const configRoot =
      process.platform === "darwin"
        ? NodePath.join(home, "Library", "Application Support")
        : NodePath.join(home, ".config");
    stateDatabasePaths.push(
      NodePath.join(configRoot, "Cursor", "User", "globalStorage", "state.vscdb"),
    );
    authJsonPaths.push(NodePath.join(configRoot, "Cursor", "auth.json"));
  }
  return { stateDatabasePaths, authJsonPaths };
}

function readCursorAuth(environment: NodeJS.ProcessEnv): CursorAuthTokens | undefined {
  const paths = resolveCursorAuthPaths(environment);
  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  for (const filePath of paths.stateDatabasePaths) {
    accessToken ??= readCursorStateValue(filePath, "cursorAuth/accessToken");
    refreshToken ??= readCursorStateValue(filePath, "cursorAuth/refreshToken");
    if (accessToken && refreshToken) return { accessToken, refreshToken };
  }
  for (const filePath of paths.authJsonPaths) {
    const tokens = readCursorAuthJsonTokens(filePath);
    accessToken ??= tokens.accessToken;
    refreshToken ??= tokens.refreshToken;
    if (accessToken && refreshToken) return { accessToken, refreshToken };
  }
  return accessToken ? { accessToken, ...(refreshToken ? { refreshToken } : {}) } : undefined;
}

interface CursorHttpResponse {
  readonly status: number;
  readonly payload?: unknown;
}

async function requestCursorUsage(
  path: string,
  token: string,
  method: "GET" | "POST",
): Promise<CursorHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CURSOR_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${CURSOR_USAGE_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(method === "POST"
          ? {
              "Content-Type": "application/json",
              "Connect-Protocol-Version": "1",
            }
          : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
      signal: controller.signal,
    });
    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      payload = undefined;
    }
    return { status: response.status, ...(payload !== undefined ? { payload } : {}) };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshCursorAccessToken(refreshToken: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CURSOR_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${CURSOR_USAGE_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB",
        refresh_token: refreshToken,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const payload = asRecord((await response.json()) as unknown);
    return firstString(payload?.access_token, payload?.accessToken);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCursorPersonalUsage(token: string): Promise<{
  readonly dashboard?: unknown;
  readonly planInfo?: unknown;
  readonly auth?: unknown;
  readonly summary?: unknown;
  readonly unauthorized: boolean;
}> {
  const [dashboard, planInfo, auth, summary] = await Promise.all([
    requestCursorUsage("/aiserver.v1.DashboardService/GetCurrentPeriodUsage", token, "POST"),
    requestCursorUsage("/aiserver.v1.DashboardService/GetPlanInfo", token, "POST"),
    requestCursorUsage("/auth/usage", token, "GET"),
    requestCursorUsage("/api/usage/summary", token, "GET"),
  ]);
  return {
    ...(dashboard.payload !== undefined ? { dashboard: dashboard.payload } : {}),
    ...(planInfo.payload !== undefined ? { planInfo: planInfo.payload } : {}),
    ...(auth.payload !== undefined ? { auth: auth.payload } : {}),
    ...(summary.payload !== undefined ? { summary: summary.payload } : {}),
    unauthorized: [dashboard, auth, summary].every(
      (response) => response.status === 401 || response.status === 403,
    ),
  };
}

/** Read Cursor's existing local login and query its personal usage pools. */
export function probeCursorSubscriptionUsage(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly checkedAt: string;
}): Effect.Effect<SubscriptionUsage | undefined> {
  return Effect.tryPromise({
    try: async () => {
      const auth = readCursorAuth(input.environment);
      if (!auth) return undefined;
      let response = await fetchCursorPersonalUsage(auth.accessToken);
      if (response.unauthorized && auth.refreshToken) {
        const refreshedAccessToken = await refreshCursorAccessToken(auth.refreshToken);
        if (refreshedAccessToken) {
          response = await fetchCursorPersonalUsage(refreshedAccessToken);
        }
      }
      if (response.unauthorized) return undefined;
      return mapCursorPersonalUsage({ ...response, checkedAt: input.checkedAt });
    },
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined));
}

/**
 * Retained as a pure compatibility mapper for callers that already have a
 * Cursor team-spend payload. The provider no longer calls the team-admin
 * endpoint; personal usage comes from the signed-in Cursor session above.
 */
export function mapCursorTeamSpendUsage(input: {
  readonly payload: unknown;
  readonly checkedAt: string;
}): SubscriptionUsage | undefined {
  const root = asRecord(input.payload);
  const members = Array.isArray(root?.teamMemberSpend) ? root.teamMemberSpend : [];
  const totalMembers = asFiniteNumber(root?.totalMembers);
  const spendCents = members.reduce((total, memberValue) => {
    const member = asRecord(memberValue);
    return total + (asFiniteNumber(member?.spendCents) ?? 0);
  }, 0);
  const fastPremiumRequests = members.reduce((total, memberValue) => {
    const member = asRecord(memberValue);
    return total + (asFiniteNumber(member?.fastPremiumRequests) ?? 0);
  }, 0);
  const memberCount = totalMembers ?? (members.length > 0 ? members.length : undefined);
  if (memberCount === undefined && members.length === 0) return undefined;
  const metrics: Array<SubscriptionUsageMetric> = [];
  if (memberCount !== undefined) {
    metrics.push({ id: "team-members", label: "Team members", value: String(memberCount) });
  }
  if (members.some((value) => asFiniteNumber(asRecord(value)?.spendCents) !== undefined)) {
    metrics.push({
      id: "cycle-spend",
      label: "Current cycle spend",
      value: `$${(spendCents / 100).toFixed(2)}`,
    });
  }
  if (members.some((value) => asFiniteNumber(asRecord(value)?.fastPremiumRequests) !== undefined)) {
    metrics.push({
      id: "fast-premium-requests",
      label: "Fast premium requests",
      value: String(fastPremiumRequests),
    });
  }
  return metrics.length === 0
    ? undefined
    : { plan: "Cursor team usage", windows: [], metrics, checkedAt: input.checkedAt };
}
