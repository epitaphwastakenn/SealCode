import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodePath from "node:path";
import type { SubscriptionUsage, SubscriptionUsageWindow } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

const QUOTA_METHODS = [
  "RetrieveUserQuotaSummary",
  "GetUserStatus",
  "GetCommandModelConfigs",
] as const;
const QUOTA_PATH_PREFIX = "/exa.language_server_pb.LanguageServerService/";
const REQUEST_TIMEOUT_MS = 3_000;
const CLOUD_REQUEST_TIMEOUT_MS = 10_000;
const ANTIGRAVITY_CREDENTIAL_TARGET = "gemini:antigravity";
const ANTIGRAVITY_API_ORIGIN = "https://daily-cloudcode-pa.googleapis.com";
const ANTIGRAVITY_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANTIGRAVITY_USER_AGENT = "antigravity/windows/amd64";
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000;

const WINDOWS_CREDENTIAL_SCRIPT = String.raw`
using namespace System.Runtime.InteropServices

$source = @'
using System;
using System.Runtime.InteropServices;

public static class SealCodeCredentialManager {
  [StructLayout(LayoutKind.Sequential)]
  public struct Credential {
    public UInt32 Flags;
    public UInt32 Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);

  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr credential);
}
'@

Add-Type -TypeDefinition $source
$credentialPointer = [IntPtr]::Zero
if ([SealCodeCredentialManager]::CredRead("gemini:antigravity", 1, 0, [ref]$credentialPointer)) {
  try {
    $credential = [Marshal]::PtrToStructure($credentialPointer, [type][SealCodeCredentialManager+Credential])
    $bytes = [byte[]]::new($credential.CredentialBlobSize)
    [Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $credential.CredentialBlobSize)
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
  } finally {
    [SealCodeCredentialManager]::CredFree($credentialPointer)
  }
}
`;

interface AntigravityCredentials {
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly expiresAt: number | null;
  readonly oauthClient?: AntigravityOAuthClient;
}

interface AntigravityOAuthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

interface JsonResponse {
  readonly status: number;
  readonly payload: unknown;
}

let refreshedAccessToken:
  | {
      readonly refreshToken: string;
      readonly accessToken: string;
      readonly expiresAt: number;
    }
  | undefined;

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

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readCredentialExpiry(value: unknown): number | null {
  const numeric = asFiniteNumber(value);
  if (numeric !== undefined) {
    return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  }
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/** Normalize the credential shapes used by Antigravity's keyring and OAuth file. */
export function parseAntigravityCredentials(payload: unknown): AntigravityCredentials | undefined {
  const root = asRecord(payload);
  const token = asRecord(root?.token) ?? root;
  if (!token) return undefined;
  const accessToken = asNonEmptyString(token.access_token);
  const refreshToken = asNonEmptyString(token.refresh_token);
  const clientId = asNonEmptyString(token.client_id);
  const clientSecret = asNonEmptyString(token.client_secret);
  if (!accessToken && !refreshToken) return undefined;
  return {
    accessToken,
    refreshToken,
    expiresAt: readCredentialExpiry(token.expiry ?? token.expiry_date),
    ...(clientId && clientSecret ? { oauthClient: { clientId, clientSecret } } : {}),
  };
}

/** Read the OAuth client embedded in the configured official `agy` executable. */
export function extractAntigravityOAuthClient(
  binary: Uint8Array,
): AntigravityOAuthClient | undefined {
  const contents = Buffer.from(binary).toString("latin1");
  const clientIds = [...contents.matchAll(/\d{10,}-[a-z0-9]+\.apps\.googleusercontent\.com/g)].map(
    ([clientId]) => clientId,
  );
  const clientId = clientIds.find((candidate) => candidate.startsWith("1071"));
  const clientSecret = contents.match(/GOCSPX-[A-Za-z0-9_-]{28}/)?.[0];
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
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
  if (/(?:(?:5|five)\s*hour|5h|session)/.test(lower)) {
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

export function isAntigravityQuotaExhausted(usage: SubscriptionUsage | undefined): boolean {
  return (
    usage?.windows.some(
      (window) =>
        (window.windowDurationMins === 5 * 60 || /5 hour/i.test(window.label)) &&
        window.usedPercent >= 100,
    ) ?? false
  );
}

export function isAntigravityQuotaErrorMessage(message: string): boolean {
  return /(?:5[- ]hour usage limit|5 hour limit|quota (?:exhausted|exceeded)|resource_exhausted|(?:^|\D)429(?:\D|$))/i.test(
    message,
  );
}

function runProcessText(
  command: string,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
  timeout = 2_000,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    NodeChildProcess.execFile(
      command,
      [...args],
      { env: environment, windowsHide: true, timeout },
      (error, stdout) => {
        resolve(error ? undefined : stdout);
      },
    );
  });
}

function parseCredentialText(value: string | undefined): AntigravityCredentials | undefined {
  if (!value) return undefined;
  try {
    return parseAntigravityCredentials(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

async function readAntigravityCredentials(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  acpTokenPath?: string,
): Promise<AntigravityCredentials | undefined> {
  if (acpTokenPath) {
    try {
      return parseCredentialText(await NodeFSP.readFile(acpTokenPath, "utf8"));
    } catch {
      return undefined;
    }
  }
  const keyringPayload =
    platform === "win32"
      ? await runProcessText(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_CREDENTIAL_SCRIPT],
          environment,
          5_000,
        )
      : platform === "darwin"
        ? await runProcessText(
            "security",
            ["find-generic-password", "-s", ANTIGRAVITY_CREDENTIAL_TARGET, "-w"],
            environment,
          )
        : undefined;
  const keyringCredentials = parseCredentialText(keyringPayload);
  if (keyringCredentials) return keyringCredentials;

  const home = environment.HOME ?? environment.USERPROFILE;
  if (!home) return undefined;
  try {
    return parseCredentialText(
      await NodeFSP.readFile(NodePath.join(home, ".gemini", "oauth_creds.json"), "utf8"),
    );
  } catch {
    return undefined;
  }
}

async function resolveAntigravityBinaryPath(
  binaryPath: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  if (NodePath.isAbsolute(binaryPath) || /[\\/]/.test(binaryPath)) return binaryPath;
  const located =
    platform === "win32"
      ? await runProcessText("where.exe", [binaryPath], environment)
      : await runProcessText("which", [binaryPath], environment);
  return located
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

async function resolveAntigravityOAuthClient(
  binaryPath: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<AntigravityOAuthClient | undefined> {
  const clientId = asNonEmptyString(environment.AGY_CLIENT_ID);
  const clientSecret = asNonEmptyString(environment.AGY_CLIENT_SECRET);
  if (clientId && clientSecret) return { clientId, clientSecret };

  const resolvedPath = await resolveAntigravityBinaryPath(binaryPath, environment, platform);
  if (!resolvedPath) return undefined;
  try {
    return extractAntigravityOAuthClient(await NodeFSP.readFile(resolvedPath));
  } catch {
    return undefined;
  }
}

function postRemoteJson(input: {
  readonly url: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}): Promise<JsonResponse | undefined> {
  return new Promise((resolve) => {
    const request = NodeHttps.request(
      input.url,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(input.body).toString(),
          ...input.headers,
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          let payload: unknown;
          try {
            payload = body.length > 0 ? (JSON.parse(body) as unknown) : undefined;
          } catch {
            payload = undefined;
          }
          resolve({ status: response.statusCode ?? 0, payload });
        });
      },
    );
    request.setTimeout(CLOUD_REQUEST_TIMEOUT_MS, () => request.destroy());
    request.on("error", () => resolve(undefined));
    request.end(input.body);
  });
}

function postAntigravityApi(
  path: string,
  accessToken: string,
  body: unknown,
): Promise<JsonResponse | undefined> {
  return postRemoteJson({
    url: `${ANTIGRAVITY_API_ORIGIN}${path}`,
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": ANTIGRAVITY_USER_AGENT,
    },
  });
}

async function refreshAntigravityAccessToken(input: {
  readonly refreshToken: string;
  readonly oauthClient?: AntigravityOAuthClient | undefined;
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly now: number;
}): Promise<string | undefined> {
  const oauthClient =
    input.oauthClient ??
    (await resolveAntigravityOAuthClient(input.binaryPath, input.environment, input.platform));
  if (!oauthClient) return undefined;
  const body = new URLSearchParams({
    client_id: oauthClient.clientId,
    client_secret: oauthClient.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
  }).toString();
  const response = await postRemoteJson({
    url: ANTIGRAVITY_TOKEN_URL,
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const payload = asRecord(response?.payload);
  const accessToken = response?.status === 200 ? asNonEmptyString(payload?.access_token) : null;
  if (!accessToken) return undefined;
  const expiresIn = asFiniteNumber(payload?.expires_in) ?? 3_600;
  refreshedAccessToken = {
    refreshToken: input.refreshToken,
    accessToken,
    expiresAt: input.now + expiresIn * 1_000,
  };
  return accessToken;
}

async function getAntigravityAccessToken(input: {
  readonly credentials: AntigravityCredentials;
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly now: number;
}): Promise<string | undefined> {
  if (
    input.credentials.refreshToken &&
    refreshedAccessToken?.refreshToken === input.credentials.refreshToken &&
    refreshedAccessToken.expiresAt > input.now + ACCESS_TOKEN_EXPIRY_SKEW_MS
  ) {
    return refreshedAccessToken.accessToken;
  }
  if (
    input.credentials.accessToken &&
    (input.credentials.expiresAt === null ||
      input.credentials.expiresAt > input.now + ACCESS_TOKEN_EXPIRY_SKEW_MS)
  ) {
    return input.credentials.accessToken;
  }
  return input.credentials.refreshToken
    ? refreshAntigravityAccessToken({
        refreshToken: input.credentials.refreshToken,
        oauthClient: input.credentials.oauthClient,
        binaryPath: input.binaryPath,
        environment: input.environment,
        platform: input.platform,
        now: input.now,
      })
    : undefined;
}

function readTierName(payload: unknown): string | null {
  const root = asRecord(payload);
  for (const value of [root?.paidTier, root?.currentTier]) {
    const tier = asRecord(value);
    const label =
      asNonEmptyString(tier?.name) ?? asNonEmptyString(tier?.id) ?? asNonEmptyString(value);
    if (label) return label;
  }
  return null;
}

async function fetchAntigravityCloudUsage(
  accessToken: string,
  checkedAt: string,
): Promise<{ readonly unauthorized: boolean; readonly usage?: SubscriptionUsage }> {
  const loadResponse = await postAntigravityApi("/v1internal:loadCodeAssist", accessToken, {
    metadata: { ideType: "ANTIGRAVITY" },
  });
  if (loadResponse?.status === 401) return { unauthorized: true };
  if (loadResponse?.status !== 200) return { unauthorized: false };
  const load = asRecord(loadResponse.payload);
  const project = asNonEmptyString(load?.cloudaicompanionProject);
  const quotaResponse = await postAntigravityApi(
    "/v1internal:retrieveUserQuotaSummary",
    accessToken,
    project ? { project } : {},
  );
  if (quotaResponse?.status === 401) return { unauthorized: true };
  if (quotaResponse?.status !== 200) return { unauthorized: false };
  const usage = mapAntigravitySubscriptionUsage({ payload: quotaResponse.payload, checkedAt });
  return usage
    ? {
        unauthorized: false,
        usage: { ...usage, plan: readTierName(loadResponse.payload) ?? usage.plan },
      }
    : { unauthorized: false };
}

async function probeAntigravityCloudUsage(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly binaryPath: string;
  readonly checkedAt: string;
  readonly platform: NodeJS.Platform;
  readonly acpTokenPath?: string;
}): Promise<SubscriptionUsage | undefined> {
  const credentials = await readAntigravityCredentials(
    input.environment,
    input.platform,
    input.acpTokenPath,
  );
  if (!credentials || (input.acpTokenPath && !credentials.oauthClient)) return undefined;
  const now = Date.parse(input.checkedAt);
  const accessToken = await getAntigravityAccessToken({
    credentials,
    binaryPath: input.binaryPath,
    environment: input.environment,
    platform: input.platform,
    now,
  });
  if (!accessToken) return undefined;
  let result = await fetchAntigravityCloudUsage(accessToken, input.checkedAt);
  if (result.unauthorized && credentials.refreshToken) {
    const refreshed = await refreshAntigravityAccessToken({
      refreshToken: credentials.refreshToken,
      oauthClient: credentials.oauthClient,
      binaryPath: input.binaryPath,
      environment: input.environment,
      platform: input.platform,
      now,
    });
    if (refreshed) result = await fetchAntigravityCloudUsage(refreshed, input.checkedAt);
  }
  return result.usage;
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
  platform: NodeJS.Platform,
): Promise<ReadonlyArray<AntigravityProcess>> {
  if (platform === "win32") {
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
  platform: NodeJS.Platform,
): Promise<ReadonlyArray<ListeningEndpoint>> {
  const output =
    platform === "win32"
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
    const transport = input.protocol === "https" ? NodeHttps : NodeHttp;
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

/** Query Antigravity's cloud quota API using its saved login, then its local service. */
export function probeAntigravitySubscriptionUsage(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly binaryPath: string;
  readonly checkedAt: string;
  readonly platform: NodeJS.Platform;
  readonly acpTokenPath?: string;
}): Effect.Effect<SubscriptionUsage | undefined> {
  return Effect.tryPromise({
    try: async () => {
      const cloudUsage = await probeAntigravityCloudUsage(input);
      // ACP credentials belong to one provider instance. Never substitute a
      // different account from the CLI keyring or a running IDE's local service.
      if (cloudUsage || input.acpTokenPath) return cloudUsage;

      const [processes, endpoints] = await Promise.all([
        findAntigravityProcesses(input.environment, input.platform),
        findListeningEndpoints(input.environment, input.platform),
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
