import { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import { PrimaryConnectionTarget } from "./model.ts";
import { describeOutdatedHost } from "./outdatedHostUpdate.ts";
import * as EnvironmentRegistry from "./registry.ts";
import * as ConnectionResolver from "./resolver.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-old"),
  label: "Build Mac",
  httpBaseUrl: "https://build.example.test",
  wsBaseUrl: "wss://build.example.test",
});

const descriptor = (protocol: number | undefined, serverVersion: string) =>
  ({
    environmentId: TARGET.environmentId,
    label: TARGET.label,
    platform: { os: "darwin", arch: "arm64" },
    serverVersion,
    ...(protocol === undefined ? {} : { orchestrationProtocolVersion: protocol }),
    capabilities: { repositoryIdentity: true, serverSelfUpdate: "boot-service" },
  }) satisfies ExecutionEnvironmentDescriptor;

describe("describeOutdatedHost", () => {
  it.effect("discovers a disabled outdated host without opening a normal session", () =>
    Effect.gen(function* () {
      const expected = descriptor(undefined, "0.0.45");
      const result = yield* describeOutdatedHost(TARGET.environmentId).pipe(
        Effect.provideService(
          EnvironmentRegistry.EnvironmentRegistry,
          EnvironmentRegistry.EnvironmentRegistry.of({
            entries: yield* SubscriptionRef.make<
              ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
            >(
              new Map([
                [TARGET.environmentId, { target: TARGET, profile: Option.none(), enabled: false }],
              ]),
            ),
          } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]),
        ),
        Effect.provideService(
          ConnectionResolver.ConnectionResolver,
          ConnectionResolver.ConnectionResolver.of({
            prepare: () => Effect.die(new Error("normal sessions reject this protocol")),
            prepareForUpdate: (entry) =>
              Effect.succeed({
                descriptor: expected,
                prepared: {
                  environmentId: entry.target.environmentId,
                  label: entry.target.label,
                  httpBaseUrl: TARGET.httpBaseUrl,
                  socketUrl: "wss://build.example.test/ws",
                  httpAuthorization: null,
                  target: TARGET,
                },
              }),
          }),
        ),
      );
      expect(result).toEqual(expected);
    }),
  );
});
