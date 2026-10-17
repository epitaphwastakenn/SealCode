import { type ProviderInstanceId, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as McpInvocationContext from "./McpInvocationContext.ts";

export const MCP_INTERACTION_NO_ACTIVE_TURN =
  "No active Antigravity interaction turn matches this credential.";
export const MCP_INTERACTION_ALREADY_PENDING =
  "An interactive question is already pending for this turn.";
export const MCP_INTERACTION_CANCELLED = "The interactive question was cancelled.";

export interface McpInteractionQuestionOption {
  readonly label: string;
  readonly description: string;
}

export interface McpInteractionQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly options: ReadonlyArray<McpInteractionQuestionOption>;
}

export interface McpInteractionToolInput {
  readonly questions: ReadonlyArray<McpInteractionQuestion>;
}

export interface McpInteractionToolOutput {
  readonly answers: Readonly<Record<string, string>>;
}

export interface McpInteractionRegistration {
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly turnId: string;
}

export type McpInteractionHandler = (
  request: McpInteractionToolInput,
) => Effect.Effect<McpInteractionToolOutput, string>;

export interface McpInteractionInvokeInput {
  readonly scope: McpInvocationContext.McpInvocationScope;
  readonly questions: ReadonlyArray<McpInteractionQuestion>;
}

export interface McpInteractionBrokerShape {
  readonly register: (
    registration: McpInteractionRegistration,
    handler: McpInteractionHandler,
  ) => Effect.Effect<Effect.Effect<void>>;
  readonly invoke: (
    input: McpInteractionInvokeInput,
  ) => Effect.Effect<McpInteractionToolOutput, string>;
  readonly unregister: (registration: McpInteractionRegistration) => Effect.Effect<void>;
}

export class McpInteractionBroker extends Context.Service<
  McpInteractionBroker,
  McpInteractionBrokerShape
>()("t3/mcp/McpInteractionBroker") {}

interface RegistrationRecord {
  readonly registration: McpInteractionRegistration;
  readonly handler: McpInteractionHandler;
  readonly cancel: Deferred.Deferred<never, string>;
  readonly inFlight: boolean;
}

interface BrokerState {
  readonly records: ReadonlyMap<string, RegistrationRecord>;
}

const registrationKey = (input: {
  readonly threadId: string;
  readonly providerSessionId: string;
  readonly providerInstanceId: string;
}): string => `${input.threadId}\u0000${input.providerSessionId}\u0000${input.providerInstanceId}`;

const keyForRegistration = (registration: McpInteractionRegistration): string =>
  registrationKey(registration);

const keyForScope = (scope: McpInvocationContext.McpInvocationScope): string =>
  registrationKey(scope);

const matchesActiveTurn = (
  record: RegistrationRecord,
  scope: McpInvocationContext.McpInvocationScope,
): boolean =>
  record.registration.threadId === scope.threadId &&
  record.registration.providerSessionId === scope.providerSessionId &&
  record.registration.providerInstanceId === scope.providerInstanceId &&
  (scope.activeTurnId === undefined || scope.activeTurnId === record.registration.turnId);

const makeWithState = Effect.fn("McpInteractionBroker.make")(function* () {
  const state = yield* SynchronizedRef.make<BrokerState>({ records: new Map() });

  const takeRecord = (key: string) =>
    SynchronizedRef.modify(state, (current) => {
      const record = current.records.get(key);
      if (!record) return [undefined, current] as const;
      const records = new Map(current.records);
      records.delete(key);
      return [record, { records }] as const;
    });

  const cancelRecord = (record: RegistrationRecord | undefined) =>
    record ? Deferred.fail(record.cancel, MCP_INTERACTION_CANCELLED) : Effect.void;

  const unregisterByKey = (key: string) =>
    takeRecord(key).pipe(Effect.flatMap(cancelRecord));

  const register: McpInteractionBrokerShape["register"] = Effect.fn(
    "McpInteractionBroker.register",
  )(function* (registration, handler) {
    const cancel = yield* Deferred.make<never, string>();
    const key = keyForRegistration(registration);
    const previous = yield* SynchronizedRef.modify(state, (current) => {
      const existing = current.records.get(key);
      const records = new Map(current.records);
      records.set(key, {
        registration,
        handler,
        cancel,
        inFlight: false,
      });
      return [existing, { records }] as const;
    });
    yield* cancelRecord(previous);
    const unregister = Effect.suspend(() =>
      SynchronizedRef.modify(state, (current) => {
        const existing = current.records.get(key);
        if (!existing || existing.cancel !== cancel) {
          return [undefined, current] as const;
        }
        const records = new Map(current.records);
        records.delete(key);
        return [existing, { records }] as const;
      }).pipe(Effect.flatMap(cancelRecord)),
    );
    return yield* Effect.succeed(unregister);
  });

  const invoke: McpInteractionBrokerShape["invoke"] = Effect.fn("McpInteractionBroker.invoke")(
    function* (input) {
      const key = keyForScope(input.scope);
      type InvokeClaim = RegistrationRecord | "pending" | undefined;
      const record = yield* SynchronizedRef.modify(
        state,
        (current): readonly [InvokeClaim, BrokerState] => {
          const existing = current.records.get(key);
          if (!existing || !matchesActiveTurn(existing, input.scope)) {
            return [undefined, current];
          }
          if (existing.inFlight) {
            return ["pending", current];
          }
          const records = new Map(current.records);
          records.set(key, { ...existing, inFlight: true });
          return [existing, { records }];
        },
      );
      if (record === "pending") {
        return yield* Effect.fail(MCP_INTERACTION_ALREADY_PENDING);
      }
      if (!record) {
        return yield* Effect.fail(MCP_INTERACTION_NO_ACTIVE_TURN);
      }
      const clearInFlight = SynchronizedRef.update(state, (current) => {
        const existing = current.records.get(key);
        if (!existing || existing.cancel !== record.cancel || !existing.inFlight) {
          return current;
        }
        const records = new Map(current.records);
        records.set(key, { ...existing, inFlight: false });
        return { records };
      });
      return yield* record
        .handler({ questions: input.questions })
        .pipe(Effect.raceFirst(Deferred.await(record.cancel)), Effect.ensuring(clearInFlight));
    },
  );

  const unregister: McpInteractionBrokerShape["unregister"] = Effect.fn(
    "McpInteractionBroker.unregister",
  )(function* (registration) {
    yield* unregisterByKey(keyForRegistration(registration));
  });

  return McpInteractionBroker.of({ register, invoke, unregister });
});

let activeMcpInteractionBroker: McpInteractionBrokerShape | undefined;

const make = Effect.acquireRelease(
  makeWithState().pipe(
    Effect.tap((broker) =>
      Effect.sync(() => {
        activeMcpInteractionBroker = broker;
      }),
    ),
  ),
  (broker) =>
    Effect.sync(() => {
      if (activeMcpInteractionBroker === broker) {
        activeMcpInteractionBroker = undefined;
      }
    }),
);

export const layer = Layer.effect(McpInteractionBroker, make);

export const registerActiveInteraction = (
  registration: McpInteractionRegistration,
  handler: McpInteractionHandler,
): Effect.Effect<Effect.Effect<void>> =>
  activeMcpInteractionBroker
    ? activeMcpInteractionBroker.register(registration, handler)
    : Effect.succeed(Effect.void);

/** Exposed for tests. */
export const __testing = {
  make: makeWithState,
};
