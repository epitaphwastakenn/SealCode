import { execFile } from "node:child_process";
import * as NodeHTTP from "node:http";
import * as NodeHTTPS from "node:https";
import type { SubscriptionUsage, SubscriptionUsageWindow } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

const QUOTA_METHODS = [
  "RetrieveUserQuotaSummary",
  "GetUserStatus",
  "GetCommandModelConfigs",
] as const;
const QUOTA_PATH_PREFIX = "/exa.language_server_pb.LanguageServerService/";
const REQUEST_TIMEOUT_MS = 3_000;

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

function readResetTime(value: unknown): string | null {
  const timestamp = asRecord(value);
  if (timestamp) {
    const seconds = asFiniteNumber(timestamp.seconds);
    const nanos = asFiniteNumber(timestamp.nanos) ?? 0;
    if (seconds !== undefined) {
      const date = new Date(seconds * 1_000 + nanos / 1_000_000);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return readResetTime(timestamp.timestamp ?? timestamp.value);
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const milliseconds = value < 1_000_000_000_000 ? value * 1_000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function quotaGroupLabel(groupName: string, bucketName: string): string {
  const combined = `${groupName} ${bucketName}`.toLowerCase();
  if (combined.includes("gemini")) return "Gemini";
  if (combined.includes("claude") || combined.includes("gpt")) return "Claude + GPT";
  return groupName.trim() || "Antigravity";
}

function quotaWindowLabel(bucketName: string): {
  readonly label: string;
  readonly durationMins: number | null;
} {
  const lower = bucketName.toLowerCase();
  if (/(?:5\s*hour|5h|session)/.test(lower)) {
    return { label: "5 hour", durationMins: 5 * 60 };
  }
  if (/weekly|week/.test(lower)) {
    return { label: "Weekly", durationMins: 7 * 24 * 60 };
  }
  if (/monthly|month/.test(lower)) {
    return { label: "Monthly", durationMins: 30 * 24 * 60 };
  }
  return { label: bucketName.trim() || "Usage", durationMins: null };
}

function preferQuotaWindow(
  previous: SubscriptionUsageWindow | undefined,
  next: SubscriptionUsageWindow,
): SubscriptionUsageWindow {
  if (previous === undefined) return next;
  if (next.usedPercent > previous.usedPercent) {
    return next.resetsAt === null && previous.resetsAt !== null
      ? { ...next, resetsAt: previous.resetsAt }
      : next;
  }
  return previous.resetsAt === null && next.resetsAt !== null
    ? { ...previous, resetsAt: next.resetsAt }
    : previous;
}

function readRemainingFraction(bucket: Record<string, unknown>): number | undefined {
  const remaining = asRecord(bucket.remaining);
  const fraction = asFiniteNumber(remaining?.remainingFraction ?? bucket.remainingFraction);
  if (fraction === undefined) return undefined;
  return Math.min(1, Math.max(0, fraction));
}

function readBucketResetTime(bucket: Record<string, unknown>): string | null {
  const remaining = asRecord(bucket.remaining);
  return readResetTime(
    bucket.resetTime ??
      remaining?.resetTime ??
      bucket.resetAt ??
      remaining?.resetAt ??
      bucket.resetTimestamp ??
      bucket.reset,
  );
}

function readPlanName(payload: unknown): string | null {
  const root = asRecord(payload);
  const response = asRecord(root?.response) ?? root;
  const userStatus = asRecord(response?.userStatus) ?? response;
  const planValue = userStatus?.planName ?? userStatus?.plan;
  return typeof planValue === "string" && planValue.trim().length > 0 ? planValue.trim() : null;
}

function mapSummaryWindows(payload: unknown): {
  readonly plan: string | null;
  readonly windows: ReadonlyArray<SubscriptionUsageWindow>;
} {
  const root = asRecord(payload);
  const response = asRecord(root?.response) ?? root;
  const groups = Array.isArray(response?.groups) ? response.groups : [];
  const windows = new Map<string, SubscriptionUsageWindow>();
  for (const groupValue of groups) {
    const group = asRecord(groupValue);
    const groupName =
      (typeof group?.displayName === "string" && group.displayName) ||
      (typeof group?.name === "string" && group.name) ||
      (typeof group?.groupId === "string" && group.groupId) ||
      (typeof group?.id === "string" && group.id) ||
      "Antigravity";
    const buckets = Array.isArray(group?.buckets) ? group.buckets : [];
    for (const bucketValue of buckets) {
      const bucket = asRecord(bucketValue);
      if (!bucket) continue;
      const remainingFraction = readRemainingFraction(bucket);
      if (remainingFraction === undefined) continue;
      const bucketName =
        (typeof bucket.bucketId === "string" && bucket.bucketId) ||
        (typeof bucket.id === "string" && bucket.id) ||
        (typeof bucket.displayName === "string" && bucket.displayName) ||
        (typeof bucket.name === "string" && bucket.name) ||
        (typeof bucket.description === "string" && bucket.description) ||
        "Usage";
      const groupLabel = quotaGroupLabel(groupName, bucketName);
      const windowInfo = quotaWindowLabel(bucketName);
      const id = `antigravity-${groupLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${windowInfo.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const mappedWindow = {
        id,
        label: `${groupLabel} ${windowInfo.label}`,
        usedPercent: (1 - remainingFraction) * 100,
        windowDurationMins: windowInfo.durationMins,
        resetsAt: readBucketResetTime(bucket),
      } satisfies SubscriptionUsageWindow;
      windows.set(id, preferQuotaWindow(windows.get(id), mappedWindow));
    }
  }
  return {
    plan: readPlanName(payload),
    windows: [...windows.values()],
  };
}

function mapLegacyWindows(payload: unknown): {
  readonly plan: string | null;
  readonly windows: ReadonlyArray<SubscriptionUsageWindow>;
} {
  const root = asRecord(payload);
  const response = asRecord(root?.response) ?? root;
  const userStatus = asRecord(response?.userStatus) ?? response;
  const cascade = asRecord(userStatus?.cascadeModelConfigData);
  const configs = Array.isArray(cascade?.clientModelConfigs) ? cascade.clientModelConfigs : [];
  const lowest = new Map<string, { fraction: number; reset: string | null }>();
  for (const configValue of configs) {
    const config = asRecord(configValue);
    const quota = asRecord(config?.quotaInfo);
    const fraction = asFiniteNumber(quota?.remainingFraction);
    if (fraction === undefined) continue;
    const modelName =
      (typeof config?.model === "string" && config.model) ||
      (typeof config?.modelId === "string" && config.modelId) ||
      (typeof config?.modelName === "string" && config.modelName) ||
      (typeof config?.label === "string" && config.label) ||
      "";
    const group = quotaGroupLabel(modelName, modelName);
    const current = lowest.get(group);
    if (!current || fraction < current.fraction) {
      lowest.set(group, {
        fraction: Math.min(1, Math.max(0, fraction)),
        reset: readResetTime(
          quota?.resetTime ?? quota?.resetAt ?? quota?.resetTimestamp ?? quota?.reset,
        ),
      });
    }
  }
  const windows = [...lowest.entries()].map(([group, value]) => ({
    id: `antigravity-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-5-hour`,
    label: `${group} 5 hour`,
    usedPercent: (1 - value.fraction) * 100,
    windowDurationMins: 5 * 60,
    resetsAt: value.reset,
  }));
  return {
    plan: readPlanName(payload),
    windows,
  };
}

function mergeAntigravityUsage(
  usages: ReadonlyArray<SubscriptionUsage>,
  checkedAt: string,
): SubscriptionUsage | undefined {
  const windows = new Map<string, SubscriptionUsageWindow>();
  let plan: string | null = null;
  for (const usage of usages) {
    plan ??= usage.plan;
    for (const window of usage.windows) {
      windows.set(window.id, preferQuotaWindow(windows.get(window.id), window));
    }
  }
  if (windows.size === 0) return undefined;
  return { plan, windows: [...windows.values()], metrics: [], checkedAt };
}

/** Normalize Antigravity's internal quota summary or legacy status payload. */
export function mapAntigravitySubscriptionUsage(input: {
  readonly payload: unknown;
  readonly checkedAt: string;
}): SubscriptionUsage | undefined {
  const summary = mapSummaryWindows(input.payload);
  const mapped = summary.windows.length > 0 ? summary : mapLegacyWindows(input.payload);
  if (mapped.windows.length === 0) return undefined;
  return {
    plan: mapped.plan,
    windows: mapped.windows,
    metrics: [],
    checkedAt: input.checkedAt,
  };
}

function runProcessText(
  command: string,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { env: environment, windowsHide: true, timeout: 2_000 },
      (error, stdout) => {
        resolve(error ? undefined : stdout);
      },
    );
  });
}

interface ListeningEndpoint {
  readonly port: number;
  readonly pid: number | null;
}

function parseListeningEndpoints(output: string): ReadonlyArray<ListeningEndpoint> {
  const endpoints: Array<ListeningEndpoint> = [];
  for (const line of output.split(/\r?\n/)) {
    const windowsMatch = line.match(/^\s*TCP\s+[^\s]+:(\d+)\s+[^\s]+\s+LISTENING\s+(\d+)/i);
    const unixMatch = line.match(/^(?:\S+\s+)?(\d+).*:(\d+)\s+\(LISTEN\)/i);
    const port = Number(windowsMatch?.[1] ?? unixMatch?.[2]);
    const pid = Number(windowsMatch?.[2] ?? unixMatch?.[1]);
    if (Number.isInteger(port) && port > 0 && port < 65_536) {
      endpoints.push({ port, pid: Number.isInteger(pid) && pid > 0 ? pid : null });
    }
  }
  return endpoints;
}

interface AntigravityProcess {
  readonly pid: number;
  readonly csrfToken: string;
}

function parseAntigravityProcesses(output: string): ReadonlyArray<AntigravityProcess> {
  const processes: Array<AntigravityProcess> = [];
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("\t");
    if (separator <= 0) continue;
    const pid = Number(line.slice(0, separator).trim());
    const commandLine = line.slice(separator + 1).trim();
    if (!Number.isInteger(pid) || pid <= 0 || commandLine.length === 0) continue;
    const appDataDir = commandLine.match(/--app_data_dir(?:=|\s+)"?([^"\s]+)"?/i)?.[1];
    const isAntigravityLanguageServer =
      /(?:^|[\\/\s])language_server(?:\.exe)?(?:\s|$)/i.test(commandLine) &&
      appDataDir?.toLowerCase() === "antigravity";
    if (!isAntigravityLanguageServer) continue;
    const csrfToken = commandLine.match(/--csrf_token(?:=|\s+)"?([^"\s]+)"?/i)?.[1] ?? "";
    if (!csrfToken) continue;
    processes.push({ pid, csrfToken });
  }
  return processes;
}

async function findAntigravityProcesses(
  environment: NodeJS.ProcessEnv,
): Promise<ReadonlyArray<AntigravityProcess>> {
  if (process.platform === "win32") {
    const output = await runProcessText(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='language_server.exe' OR Name='agy.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }",
      ],
      environment,
    );
    return output ? parseAntigravityProcesses(output) : [];
  }
  const output = await runProcessText("ps", ["-ax", "-o", "pid=,command="], environment);
  return output ? parseAntigravityProcesses(output.replace(/^\s*(\d+)\s+(.+)$/gm, "$1\t$2")) : [];
}

async function findListeningEndpoints(
  environment: NodeJS.ProcessEnv,
): Promise<ReadonlyArray<ListeningEndpoint>> {
  const output =
    process.platform === "win32"
      ? await runProcessText("netstat", ["-ano", "-p", "tcp"], environment)
      : await runProcessText("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], environment);
  return output ? parseListeningEndpoints(output) : [];
}

function postJson(input: {
  readonly protocol: "http" | "https";
  readonly port: number;
  readonly method: (typeof QUOTA_METHODS)[number];
  readonly csrfToken: string;
}): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    const transport = input.protocol === "https" ? NodeHTTPS : NodeHTTP;
    const request = transport.request(
      {
        hostname: "127.0.0.1",
        port: input.port,
        path: `${QUOTA_PATH_PREFIX}${input.method}`,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
          ...(input.csrfToken ? { "X-Codeium-Csrf-Token": input.csrfToken } : {}),
        },
        ...(input.protocol === "https" ? { rejectUnauthorized: false } : {}),
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            resolve(undefined);
            return;
          }
          try {
            resolve(JSON.parse(body) as unknown);
          } catch {
            resolve(undefined);
          }
        });
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy());
    request.on("error", () => resolve(undefined));
    request.end(
      JSON.stringify({
        metadata: {
          ideName: "antigravity",
          extensionName: "antigravity",
          locale: "en",
        },
      }),
    );
  });
}

async function probePort(
  port: number,
  csrfToken: string,
  checkedAt: string,
): Promise<SubscriptionUsage | undefined> {
  for (const protocol of ["https", "http"] as const) {
    const usages: Array<SubscriptionUsage> = [];
    for (const method of QUOTA_METHODS) {
      const payload = await postJson({ protocol, port, method, csrfToken });
      if (!payload) continue;
      const usage = mapAntigravitySubscriptionUsage({ payload, checkedAt });
      if (usage) usages.push(usage);
    }
    const mergedUsage = mergeAntigravityUsage(usages, checkedAt);
    if (mergedUsage) return mergedUsage;
  }
  return undefined;
}

/**
 * Query Antigravity's loopback language-server quota service. This deliberately
 * does not launch `agy --print /usage`: that command is interactive and can
 * block on browser authentication when the CLI is signed out.
 */
export function probeAntigravitySubscriptionUsage(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly checkedAt: string;
}): Effect.Effect<SubscriptionUsage | undefined> {
  return Effect.tryPromise({
    try: async () => {
      const [processes, endpoints] = await Promise.all([
        findAntigravityProcesses(input.environment),
        findListeningEndpoints(input.environment),
      ]);
      const processTokens = new Map(
        processes.map((processInfo) => [processInfo.pid, processInfo.csrfToken]),
      );
      const candidates = endpoints
        .map((endpoint) => ({
          ...endpoint,
          csrfToken: endpoint.pid === null ? "" : processTokens.get(endpoint.pid),
        }))
        .filter(
          (endpoint): endpoint is ListeningEndpoint & { readonly csrfToken: string } =>
            endpoint.csrfToken !== undefined && endpoint.csrfToken.length > 0,
        );
      const results = await Promise.all(
        candidates.map((endpoint) => probePort(endpoint.port, endpoint.csrfToken, input.checkedAt)),
      );
      return results.find((usage): usage is SubscriptionUsage => usage !== undefined);
    },
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined));
}
