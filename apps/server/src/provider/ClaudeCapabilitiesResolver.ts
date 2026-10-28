import { ServerProviderSlashCommand } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import type { ProviderCheckReason } from "@t3tools/provider-core/server/managedProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import type { ClaudeAuthStatusProbe, ClaudeCapabilitiesProbe } from "./ClaudeProvider.ts";

/** A full Claude Code session probe is held to this rate unless someone asks for it. */
export const CLAUDE_FULL_PROBE_TTL_MS = 60 * 60_000;
/** A refresh the user asked for still reuses a probe that finished this recently. */
const REQUESTED_REUSE_MS = 60_000;
const MAX_PERSISTED_WORKSPACES = 16;

const OptionalText = Schema.optionalKey(Schema.String);

const PersistedCapabilities = Schema.Struct({
  email: OptionalText,
  workspaceId: OptionalText,
  subscriptionType: OptionalText,
  tokenSource: OptionalText,
  apiKeySource: OptionalText,
  apiProvider: OptionalText,
  slashCommands: Schema.Array(ServerProviderSlashCommand),
  usage: Schema.optionalKey(
    Schema.Struct({
      rate_limits_available: Schema.Boolean,
      rate_limits: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
  usageCheckedAt: OptionalText,
});

const PersistedMachine = Schema.Struct({
  probedAt: Schema.String,
  cliVersion: Schema.NullOr(Schema.String),
  capabilities: PersistedCapabilities,
});

const PersistedWorkspace = Schema.Struct({
  probedAt: Schema.String,
  cliVersion: Schema.NullOr(Schema.String),
  slashCommands: Schema.Array(ServerProviderSlashCommand),
});

const PersistedClaudeProbes = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  cacheKey: Schema.String,
  machine: Schema.optionalKey(PersistedMachine),
  workspaces: Schema.optionalKey(Schema.Record(Schema.String, PersistedWorkspace)),
});
type PersistedClaudeProbes = typeof PersistedClaudeProbes.Type;

const decodePersistedProbes = Schema.decodeUnknownOption(
  Schema.fromJsonString(PersistedClaudeProbes),
);

export type ClaudeFullProbeResult =
  | { readonly _tag: "fresh"; readonly capabilities: ClaudeCapabilitiesProbe }
  | { readonly _tag: "fallback"; readonly capabilities: ClaudeCapabilitiesProbe };

export interface ClaudeCapabilitiesResolver<E> {
  /**
   * The account and capabilities behind a status check. Only an explicit refresh, a stale or
   * missing record outside startup, or a CLI that cannot report auth cheaply starts a Claude
   * Code session; everything else is `claude auth status` plus the last full probe.
   */
  readonly resolve: (
    reason: ProviderCheckReason,
    cliVersion: string | null,
  ) => Effect.Effect<ClaudeCapabilitiesProbe | undefined, E>;
  /** Makes the next resolve and workspace lookup probe in full. */
  readonly invalidate: Effect.Effect<void>;
  readonly workspaceSlashCommands: (
    cwd: string,
    cliVersion: string | null,
  ) => Effect.Effect<ReadonlyArray<ServerProviderSlashCommand> | undefined>;
  readonly recordWorkspaceSlashCommands: (
    cwd: string,
    cliVersion: string | null,
    slashCommands: ReadonlyArray<ServerProviderSlashCommand>,
  ) => Effect.Effect<void>;
  /** Claude Code sessions are 500 MB each; run them one at a time. */
  readonly exclusive: <A, E2, R>(effect: Effect.Effect<A, E2, R>) => Effect.Effect<A, E2, R>;
}

interface ResolverState {
  readonly data: PersistedClaudeProbes;
  readonly invalidated: boolean;
}

/** An unreported email cannot tell accounts apart; a plan appearing or vanishing can. */
const isSameAccount = (
  known: Pick<ClaudeCapabilitiesProbe, "email" | "subscriptionType">,
  auth: ClaudeAuthStatusProbe,
): boolean =>
  (known.email === undefined ||
    auth.email === undefined ||
    known.email.toLowerCase() === auth.email.toLowerCase()) &&
  Boolean(known.subscriptionType) === Boolean(auth.subscriptionType);

const nowMs = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));

const isCurrent = (
  entry: { readonly probedAt: string; readonly cliVersion: string | null },
  cliVersion: string | null,
  now: number,
  maxAgeMs: number,
): boolean => {
  const age = now - Date.parse(entry.probedAt);
  return entry.cliVersion === cliVersion && age >= 0 && age < maxAgeMs;
};

function capabilitiesFromPersisted(
  persisted: typeof PersistedCapabilities.Type,
): ClaudeCapabilitiesProbe {
  return {
    email: persisted.email,
    workspaceId: persisted.workspaceId,
    subscriptionType: persisted.subscriptionType,
    tokenSource: persisted.tokenSource,
    apiKeySource: persisted.apiKeySource,
    apiProvider: persisted.apiProvider,
    slashCommands: persisted.slashCommands,
    ...(persisted.usage
      ? {
          // The record only needs the fields the usage converter reads.
          usage: persisted.usage as unknown as NonNullable<ClaudeCapabilitiesProbe["usage"]>,
          ...(persisted.usageCheckedAt ? { usageCheckedAt: persisted.usageCheckedAt } : {}),
        }
      : {}),
  };
}

function persistableCapabilities(
  capabilities: ClaudeCapabilitiesProbe,
): typeof PersistedCapabilities.Type {
  return {
    ...(capabilities.email ? { email: capabilities.email } : {}),
    ...(capabilities.workspaceId ? { workspaceId: capabilities.workspaceId } : {}),
    ...(capabilities.subscriptionType ? { subscriptionType: capabilities.subscriptionType } : {}),
    ...(capabilities.tokenSource ? { tokenSource: capabilities.tokenSource } : {}),
    ...(capabilities.apiKeySource ? { apiKeySource: capabilities.apiKeySource } : {}),
    ...(capabilities.apiProvider ? { apiProvider: capabilities.apiProvider } : {}),
    slashCommands: capabilities.slashCommands,
    ...(capabilities.usage
      ? {
          usage: {
            rate_limits_available: capabilities.usage.rate_limits_available,
            rate_limits: capabilities.usage.rate_limits as Record<string, unknown> | null,
          },
          ...(capabilities.usageCheckedAt ? { usageCheckedAt: capabilities.usageCheckedAt } : {}),
        }
      : {}),
  };
}

export const makeClaudeCapabilitiesResolver = Effect.fn("makeClaudeCapabilitiesResolver")(
  function* <E>(input: {
    readonly filePath: string;
    readonly cacheKey: string;
    readonly probeInFull: Effect.Effect<ClaudeFullProbeResult, E>;
    readonly probeAuthStatus: Effect.Effect<ClaudeAuthStatusProbe | undefined>;
    readonly readWorkspaceId: Effect.Effect<string | undefined>;
  }): Effect.fn.Return<ClaudeCapabilitiesResolver<E>, never, FileSystem.FileSystem | Path.Path> {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const loaded = yield* fileSystem.readFileString(input.filePath).pipe(
      Effect.map((raw) => decodePersistedProbes(raw.trim())),
      Effect.orElseSucceed(() => undefined),
    );
    const loadedData =
      loaded && loaded._tag === "Some" && loaded.value.cacheKey === input.cacheKey
        ? loaded.value
        : undefined;
    const stateRef = yield* Ref.make<ResolverState>({
      data: loadedData ?? { schemaVersion: 1, cacheKey: input.cacheKey },
      invalidated: false,
    });
    const probeLock = yield* Semaphore.make(1);
    const persistLock = yield* Semaphore.make(1);

    const persist = persistLock.withPermits(1)(
      Ref.get(stateRef).pipe(
        Effect.flatMap(({ data }) =>
          writeFileStringAtomically({
            filePath: input.filePath,
            contents: `${JSON.stringify(data)}\n`,
          }),
        ),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.ignore({ log: true }),
      ),
    );

    const capabilitiesFromAuth = Effect.fn("ClaudeCapabilitiesResolver.capabilitiesFromAuth")(
      function* (known: ClaudeCapabilitiesProbe | undefined) {
        const auth = yield* input.probeAuthStatus;
        if (!auth?.loggedIn) return undefined;
        const account = known && isSameAccount(known, auth) ? known : undefined;
        const workspaceId = (yield* input.readWorkspaceId) ?? account?.workspaceId;
        return {
          email: auth.email ?? account?.email,
          workspaceId,
          subscriptionType: account?.subscriptionType ?? auth.subscriptionType,
          // Anything but "none" counts as signed in; the record keeps the SDK's own wording.
          tokenSource: account?.tokenSource ?? auth.authMethod ?? "unknown",
          apiKeySource: account?.apiKeySource,
          apiProvider: auth.apiProvider ?? account?.apiProvider,
          slashCommands: account?.slashCommands ?? [],
          ...(account?.usage
            ? {
                usage: account.usage,
                ...(account.usageCheckedAt ? { usageCheckedAt: account.usageCheckedAt } : {}),
              }
            : {}),
        } satisfies ClaudeCapabilitiesProbe;
      },
    );

    const runInFull = (cliVersion: string | null, seenProbedAt: string | undefined) =>
      probeLock.withPermits(1)(
        Effect.gen(function* () {
          // A probe that finished while this one waited already answers it.
          const state = yield* Ref.get(stateRef);
          const machine = state.data.machine;
          if (
            machine &&
            machine.probedAt !== seenProbedAt &&
            !state.invalidated &&
            machine.capabilities.usage &&
            machine.cliVersion === cliVersion
          ) {
            return capabilitiesFromPersisted(machine.capabilities);
          }
          const result = yield* input.probeInFull;
          // A fallback reuses the last good account; it must not stand in for a probe.
          if (result._tag === "fresh") {
            const probedAt = DateTime.formatIso(yield* DateTime.now);
            yield* Ref.update(stateRef, (current) => ({
              invalidated: false,
              data: {
                ...current.data,
                machine: {
                  probedAt,
                  cliVersion,
                  capabilities: persistableCapabilities(result.capabilities),
                },
              },
            }));
            yield* persist;
          }
          return result.capabilities;
        }),
      );

    const resolve: ClaudeCapabilitiesResolver<E>["resolve"] = Effect.fn(
      "ClaudeCapabilitiesResolver.resolve",
    )(function* (reason, cliVersion) {
      const now = yield* nowMs;
      const state = yield* Ref.get(stateRef);
      const machine = state.data.machine;
      const maxAge = reason === "requested" ? REQUESTED_REUSE_MS : CLAUDE_FULL_PROBE_TTL_MS;
      const current =
        machine !== undefined &&
        !state.invalidated &&
        machine.capabilities.usage !== undefined &&
        isCurrent(machine, cliVersion, now, maxAge);
      // The app opening is not a reason to start a Claude Code session, whatever the record's age.
      if (current || (reason === "startup" && !state.invalidated)) {
        const known = machine ? capabilitiesFromPersisted(machine.capabilities) : undefined;
        const cheap = yield* capabilitiesFromAuth(known);
        // The record belongs to another account, so it has nothing to say about this one.
        const otherAccount = known?.usage !== undefined && cheap?.usage === undefined;
        if (cheap && (reason === "startup" || !otherAccount)) return cheap;
      }
      return yield* runInFull(cliVersion, machine?.probedAt);
    });

    const invalidate = Ref.update(stateRef, (current) => {
      const { workspaces: _workspaces, ...data } = current.data;
      return { invalidated: true, data };
    });

    const workspaceSlashCommands: ClaudeCapabilitiesResolver<E>["workspaceSlashCommands"] =
      Effect.fn("ClaudeCapabilitiesResolver.workspaceSlashCommands")(function* (cwd, cliVersion) {
        const now = yield* nowMs;
        const entry = (yield* Ref.get(stateRef)).data.workspaces?.[cwd];
        return entry && isCurrent(entry, cliVersion, now, CLAUDE_FULL_PROBE_TTL_MS)
          ? entry.slashCommands
          : undefined;
      });

    const recordWorkspaceSlashCommands: ClaudeCapabilitiesResolver<E>["recordWorkspaceSlashCommands"] =
      Effect.fn("ClaudeCapabilitiesResolver.recordWorkspaceSlashCommands")(
        function* (cwd, cliVersion, slashCommands) {
          const probedAt = DateTime.formatIso(yield* DateTime.now);
          yield* Ref.update(stateRef, (current) => {
            const kept = Object.entries(current.data.workspaces ?? {})
              .filter(([key]) => key !== cwd)
              .toSorted(([, left], [, right]) => left.probedAt.localeCompare(right.probedAt))
              .slice(-(MAX_PERSISTED_WORKSPACES - 1));
            return {
              ...current,
              data: {
                ...current.data,
                workspaces: Object.fromEntries([
                  ...kept,
                  [cwd, { probedAt, cliVersion, slashCommands }],
                ]),
              },
            };
          });
          yield* persist;
        },
      );

    return {
      resolve,
      invalidate,
      workspaceSlashCommands,
      recordWorkspaceSlashCommands,
      exclusive: probeLock.withPermits(1),
    } satisfies ClaudeCapabilitiesResolver<E>;
  },
);
