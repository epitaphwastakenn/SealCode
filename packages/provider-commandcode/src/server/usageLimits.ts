/**
 * Quota comes from the same billing endpoints and local credential the CLI
 * uses. The credential is read here and never logged or stored.
 */
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";

const API_BASE_URL = "https://api.commandcode.ai";
const REQUEST_TIMEOUT = "5 seconds";

/** Credits included in a monthly plan, which the billing API reports only as the amount left. */
const PLAN_MONTHLY_CREDITS: Readonly<Record<string, number>> = {
  "individual-go": 10,
  "individual-goat": 70,
  "individual-pro": 30,
  "individual-pro-v1": 80,
  "individual-provider": 15,
  "individual-max": 150,
  "individual-ultra": 300,
  "teams-pro": 40,
};

// Leaves stay `Unknown`: the API sends numbers as numbers or strings and times as epoch or ISO.
const Window = Schema.Struct({
  used: Schema.optional(Schema.Unknown),
  cap: Schema.optional(Schema.Unknown),
  resetAt: Schema.optional(Schema.Unknown),
});
const Credits = Schema.Struct({
  credits: Schema.optional(Schema.Struct({ monthlyCredits: Schema.optional(Schema.Unknown) })),
  windowLimits: Schema.optional(
    Schema.Struct({ fiveHour: Schema.optional(Window), weekly: Schema.optional(Window) }),
  ),
});
const Subscription = Schema.Struct({
  planId: Schema.optional(Schema.Unknown),
  currentPeriodStart: Schema.optional(Schema.Unknown),
  currentPeriodEnd: Schema.optional(Schema.Unknown),
});
const SubscriptionResponse = Schema.Union([Schema.Struct({ data: Subscription }), Subscription]);
const AuthFile = Schema.Struct({ apiKey: Schema.optional(Schema.String) });
const decodeAuthFile = Schema.decodeUnknownEffect(Schema.fromJsonString(AuthFile));

function finiteNumber(value: unknown): number | undefined {
  if (Predicate.isNumber(value) && Number.isFinite(value)) return value;
  if (!Predicate.isString(value) || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Epoch seconds, epoch milliseconds, or an ISO string. */
function parseTime(value: unknown): DateTime.Utc | undefined {
  const input =
    Predicate.isNumber(value) && Number.isFinite(value) && value > 0
      ? value < 1_000_000_000_000
        ? value * 1_000
        : value
      : Predicate.isString(value) && value.trim().length > 0
        ? value
        : undefined;
  return input === undefined ? undefined : Option.getOrUndefined(DateTime.make(input));
}

function rollingWindow(
  id: string,
  kind: ServerProviderUsageWindow["kind"],
  label: string,
  durationMins: number,
  window: typeof Window.Type | undefined,
): ReadonlyArray<ServerProviderUsageWindow> {
  const used = finiteNumber(window?.used);
  const cap = finiteNumber(window?.cap);
  if (used === undefined || cap === undefined || cap <= 0) return [];
  const resetsAt = parseTime(window?.resetAt);
  return [
    {
      id,
      kind,
      label,
      usedPercent: clampPercent((used / cap) * 100),
      windowDurationMins: durationMins,
      ...(resetsAt === undefined ? {} : { resetsAt: DateTime.formatIso(resetsAt) }),
    },
  ];
}

export function commandCodeUsageLimits(input: {
  readonly credits: typeof Credits.Type;
  readonly subscription: typeof Subscription.Type;
  readonly checkedAt: string;
}): ServerProviderUsageLimits {
  const { credits, subscription } = input;
  const windows = [
    ...rollingWindow("five_hour", "session", "5 hour", 5 * 60, credits.windowLimits?.fiveHour),
    ...rollingWindow("weekly", "weekly", "Weekly", 7 * 24 * 60, credits.windowLimits?.weekly),
  ];
  const planId = Predicate.isString(subscription.planId) ? subscription.planId.trim() : undefined;
  const remaining = finiteNumber(credits.credits?.monthlyCredits);
  const included = planId === undefined ? undefined : PLAN_MONTHLY_CREDITS[planId];
  if (remaining !== undefined && included !== undefined && included > 0) {
    const periodStart = parseTime(subscription.currentPeriodStart);
    const periodEnd = parseTime(subscription.currentPeriodEnd);
    const periodMillis =
      periodStart !== undefined && periodEnd !== undefined
        ? DateTime.toEpochMillis(periodEnd) - DateTime.toEpochMillis(periodStart)
        : -1;
    windows.push({
      id: "monthly",
      kind: "monthly",
      label: "Monthly",
      usedPercent: clampPercent(((included - remaining) / included) * 100),
      windowDurationMins: periodMillis >= 0 ? Math.round(periodMillis / 60_000) : 30 * 24 * 60,
      ...(periodEnd === undefined ? {} : { resetsAt: DateTime.formatIso(periodEnd) }),
    });
  }
  return makeUsageLimits({ checkedAt: input.checkedAt, windows });
}

/** `undefined` when no one is signed in, so a snapshot shows no quota rather than a failed probe. */
export const readCommandCodeUsageLimits = Effect.fn("readCommandCodeUsageLimits")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const home =
    environment.USERPROFILE?.trim() ||
    environment.HOME?.trim() ||
    (yield* HostProcess.HomeDirectory);
  const apiKey = yield* fileSystem
    .readFileString(path.join(home, ".commandcode", "auth.json"))
    .pipe(
      Effect.flatMap(decodeAuthFile),
      Effect.map((auth) => auth.apiKey?.trim() || undefined),
      Effect.orElseSucceed(() => undefined),
    );
  if (apiKey === undefined) return undefined;
  const client = yield* HttpClient.HttpClient;
  const get = <S extends Schema.Top>(route: string, schema: S) =>
    client
      .execute(
        HttpClientRequest.get(`${API_BASE_URL}${route}`).pipe(
          HttpClientRequest.bearerToken(apiKey),
          HttpClientRequest.acceptJson,
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      );
  return yield* Effect.all(
    [
      get("/alpha/billing/credits", Credits),
      get("/alpha/billing/subscriptions", SubscriptionResponse),
    ],
    { concurrency: 2 },
  ).pipe(
    Effect.map(([credits, response]) =>
      commandCodeUsageLimits({
        credits,
        subscription: "data" in response ? response.data : response,
        checkedAt,
      }),
    ),
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.orElseSucceed(() =>
      makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "CommandCode could not read usage limits.",
      }),
    ),
  );
});
