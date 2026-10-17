import type {
  SubscriptionUsage,
  SubscriptionUsageMetric,
  SubscriptionUsageWindow,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const REQUEST_TIMEOUT_MS = 5_000;
const OpenCodeGoUsageWindowPayload = Schema.Struct({
  percent: Schema.Number,
  resetsAt: Schema.String,
});
const OpenCodeGoUsagePayload = Schema.Struct({
  usage: Schema.Struct({
    rolling: OpenCodeGoUsageWindowPayload,
    weekly: OpenCodeGoUsageWindowPayload,
    monthly: OpenCodeGoUsageWindowPayload,
  }),
});
const OpenCodeAuthFile = Schema.Struct({
  "opencode-go": Schema.optional(
    Schema.Struct({
      type: Schema.Literal("api"),
      key: Schema.String,
    }),
  ),
});
const decodeOpenCodeGoUsage = Schema.decodeUnknownOption(OpenCodeGoUsagePayload);
const decodeOpenCodeAuthJson = Schema.decodeUnknownOption(Schema.fromJsonString(OpenCodeAuthFile));
type OpenCodeGoUsageWindowPayload = typeof OpenCodeGoUsageWindowPayload.Type;
type OpenCodeAuthFile = typeof OpenCodeAuthFile.Type;

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

function mapOpenCodeGoWindow(input: {
  readonly id: string;
  readonly label: string;
  readonly durationMins: number | null;
  readonly payload: OpenCodeGoUsageWindowPayload;
}): SubscriptionUsageWindow {
  return {
    id: input.id,
    label: input.label,
    usedPercent: Math.min(100, Math.max(0, input.payload.percent)),
    windowDurationMins: input.durationMins,
    resetsAt: input.payload.resetsAt,
  };
}

/** Normalize OpenCode GO's authenticated usage response into quota bars. */
export function mapOpenCodeGoSubscriptionUsage(input: {
  readonly payload: unknown;
  readonly checkedAt: string;
}): SubscriptionUsage | undefined {
  const decoded = Option.getOrUndefined(decodeOpenCodeGoUsage(input.payload));
  if (!decoded) return undefined;
  const { usage } = decoded;
  const windows = [
    mapOpenCodeGoWindow({
      id: "opencode-go-five-hour",
      label: "5 Hour",
      durationMins: 5 * 60,
      payload: usage.rolling,
    }),
    mapOpenCodeGoWindow({
      id: "opencode-go-weekly",
      label: "Weekly",
      durationMins: 7 * 24 * 60,
      payload: usage.weekly,
    }),
    mapOpenCodeGoWindow({
      id: "opencode-go-monthly",
      label: "Monthly",
      durationMins: null,
      payload: usage.monthly,
    }),
  ];

  return {
    plan: "OpenCode GO",
    windows,
    metrics: [],
    checkedAt: input.checkedAt,
  };
}

function readApiKeyFromAuth(auth: OpenCodeAuthFile): string | undefined {
  const key = auth["opencode-go"]?.key.trim();
  return key || undefined;
}

function readApiKeyFromAuthJson(value: string): string | undefined {
  return Option.match(decodeOpenCodeAuthJson(value), {
    onNone: () => undefined,
    onSome: readApiKeyFromAuth,
  });
}

const readOpenCodeGoApiKey = Effect.fn("readOpenCodeGoApiKey")(function* (
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<string | undefined, never, FileSystem.FileSystem | Path.Path> {
  const environmentKey = environment.OPENCODE_API_KEY?.trim();
  if (environmentKey) return environmentKey;

  const inlineAuth = environment.OPENCODE_AUTH_CONTENT;
  if (inlineAuth) {
    const parsed = decodeOpenCodeAuthJson(inlineAuth);
    if (Option.isSome(parsed)) return readApiKeyFromAuth(parsed.value);
    // OpenCode falls through to auth.json when inline auth is invalid.
  }

  const home = environment.USERPROFILE ?? environment.HOME;
  if (!home) return undefined;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dataRoot = environment.XDG_DATA_HOME ?? path.join(home, ".local", "share");
  return yield* fileSystem.readFileString(path.join(dataRoot, "opencode", "auth.json")).pipe(
    Effect.map(readApiKeyFromAuthJson),
    Effect.catchCause(() => Effect.void.pipe(Effect.as(undefined))),
  );
});

const fetchOpenCodeGoUsage = Effect.fn("fetchOpenCodeGoUsage")(function* (
  apiKey: string,
): Effect.fn.Return<unknown | undefined, never, HttpClient.HttpClient> {
  const httpClient = yield* HttpClient.HttpClient;
  return yield* HttpClientRequest.get(OPENCODE_GO_USAGE_URL).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(apiKey),
    httpClient.execute,
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.json),
    Effect.timeout(REQUEST_TIMEOUT_MS),
    Effect.catchCause(() => Effect.void.pipe(Effect.as(undefined))),
  );
});

/** Fetch OpenCode GO quota using the same credential as the OpenCode CLI. */
export function probeOpenCodeGoSubscriptionUsage(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly checkedAt: string;
}): Effect.Effect<
  SubscriptionUsage | undefined,
  never,
  FileSystem.FileSystem | HttpClient.HttpClient | Path.Path
> {
  return Effect.gen(function* () {
    const apiKey = yield* readOpenCodeGoApiKey(input.environment);
    if (!apiKey) return undefined;
    const payload = yield* fetchOpenCodeGoUsage(apiKey);
    if (!payload) return undefined;
    return mapOpenCodeGoSubscriptionUsage({ payload, checkedAt: input.checkedAt });
  });
}

export function mergeOpenCodeSubscriptionUsage(
  goUsage: SubscriptionUsage | undefined,
  localActivity: SubscriptionUsage | undefined,
): SubscriptionUsage | undefined {
  if (!goUsage) return localActivity;
  return {
    ...goUsage,
    metrics: localActivity?.metrics ?? [],
  };
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
