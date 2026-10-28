import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import {
  CLAUDE_FULL_PROBE_TTL_MS,
  makeClaudeCapabilitiesResolver,
  type ClaudeFullProbeResult,
} from "./ClaudeCapabilitiesResolver.ts";
import type { ClaudeAuthStatusProbe, ClaudeCapabilitiesProbe } from "./ClaudeProvider.ts";

const fullCapabilities = (overrides: Readonly<Record<string, unknown>> = {}) =>
  ({
    email: "me@example.com",
    workspaceId: "org-1",
    subscriptionType: "Claude Max",
    tokenSource: "claude.ai",
    apiKeySource: "none",
    apiProvider: "firstParty",
    slashCommands: [{ name: "review", description: "Review a change" }],
    usage: { rate_limits_available: true, rate_limits: { five_hour: { utilization: 12 } } },
    usageCheckedAt: "1970-01-01T00:00:00.000Z",
    ...overrides,
  }) as unknown as ClaudeCapabilitiesProbe;

const signedIn = (overrides: Partial<ClaudeAuthStatusProbe> = {}): ClaudeAuthStatusProbe => ({
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  email: "me@example.com",
  subscriptionType: "max",
  ...overrides,
});

const setup = (options?: {
  readonly auth?: ClaudeAuthStatusProbe | undefined;
  readonly filePath?: string;
  readonly fullResult?: ClaudeFullProbeResult;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "claude-probe-" });
    const filePath = options?.filePath ?? path.join(directory, "claude-probe", "claude.json");
    const fullProbes = yield* Ref.make(0);
    const authChecks = yield* Ref.make(0);
    const auth = yield* Ref.make<ClaudeAuthStatusProbe | undefined>(
      options && "auth" in options ? options.auth : signedIn(),
    );
    const make = makeClaudeCapabilitiesResolver({
      filePath,
      cacheKey: "claude\0home\0state",
      probeInFull: Ref.update(fullProbes, (count) => count + 1).pipe(
        Effect.as(
          options?.fullResult ??
            ({ _tag: "fresh", capabilities: fullCapabilities() } as ClaudeFullProbeResult),
        ),
      ),
      probeAuthStatus: Ref.update(authChecks, (count) => count + 1).pipe(
        Effect.andThen(Ref.get(auth)),
      ),
      readWorkspaceId: Effect.succeed("org-1"),
    });
    return { resolver: yield* make, make, filePath, fullProbes, authChecks, auth };
  });

const hour = CLAUDE_FULL_PROBE_TTL_MS;

it.effect("opens without a Claude Code session when a probe was saved earlier", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const first = yield* setup();
      yield* first.resolver.resolve("requested", "2.1.0");
      assert.strictEqual(yield* Ref.get(first.fullProbes), 1);

      // A new process, three hours later, finds the saved record.
      yield* TestClock.adjust(hour * 3);
      const second = yield* setup({ filePath: first.filePath });
      const capabilities = yield* second.resolver.resolve("startup", "2.1.0");

      assert.strictEqual(yield* Ref.get(second.fullProbes), 0);
      assert.strictEqual(capabilities?.email, "me@example.com");
      assert.strictEqual(capabilities?.slashCommands[0]?.name, "review");
      assert.strictEqual(capabilities?.usage?.rate_limits_available, true);
      assert.strictEqual(capabilities?.workspaceId, "org-1");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("starts a session at most once an hour for unattended refreshes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { resolver, fullProbes } = yield* setup();
      yield* resolver.resolve("interval", "2.1.0");
      yield* TestClock.adjust(hour / 2);
      yield* resolver.resolve("interval", "2.1.0");
      yield* resolver.resolve("settings", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 1);

      yield* TestClock.adjust(hour);
      yield* resolver.resolve("interval", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 2);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("probes again for a requested refresh, but not twice in a minute", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { resolver, fullProbes } = yield* setup();
      yield* resolver.resolve("interval", "2.1.0");
      yield* TestClock.adjust("2 minutes");
      yield* resolver.resolve("requested", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 2);

      yield* TestClock.adjust("10 seconds");
      yield* resolver.resolve("requested", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 2);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("reports auth without a session on a first start, then fills in later", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { resolver, fullProbes } = yield* setup();
      const first = yield* resolver.resolve("startup", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 0);
      assert.strictEqual(first?.email, "me@example.com");
      assert.strictEqual(first?.subscriptionType, "max");
      assert.deepStrictEqual(first?.slashCommands, []);
      assert.strictEqual(first?.usage, undefined);

      const later = yield* resolver.resolve("interval", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 1);
      assert.strictEqual(later?.slashCommands[0]?.name, "review");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("falls back to a session when the CLI cannot report auth or is signed out", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { resolver, fullProbes, auth } = yield* setup({ auth: undefined });
      yield* resolver.resolve("startup", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 1);

      yield* Ref.set(auth, signedIn({ loggedIn: false }));
      yield* resolver.resolve("startup", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 2);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("does not lend another account's usage or commands to a new login", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { resolver, fullProbes, auth } = yield* setup();
      yield* resolver.resolve("requested", "2.1.0");
      yield* Ref.set(auth, signedIn({ email: "other@example.com" }));

      const atStartup = yield* resolver.resolve("startup", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 1);
      assert.strictEqual(atStartup?.email, "other@example.com");
      assert.strictEqual(atStartup?.usage, undefined);

      yield* resolver.resolve("interval", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 2);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("treats a new CLI version or an invalidation as stale", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { resolver, fullProbes } = yield* setup();
      yield* resolver.resolve("interval", "2.1.0");
      yield* resolver.resolve("interval", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 1);

      yield* resolver.resolve("interval", "2.2.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 2);

      yield* resolver.invalidate;
      yield* resolver.resolve("startup", "2.2.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 3);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps a fallback result out of the saved record", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { resolver, fullProbes } = yield* setup({
        fullResult: { _tag: "fallback", capabilities: fullCapabilities({ usage: undefined }) },
      });
      yield* resolver.resolve("interval", "2.1.0");
      yield* resolver.resolve("interval", "2.1.0");
      assert.strictEqual(yield* Ref.get(fullProbes), 2);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("ignores a saved record written for another binary or account home", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const first = yield* setup();
      yield* first.resolver.resolve("requested", "2.1.0");

      const saved = yield* fileSystem.readFileString(first.filePath);
      yield* fileSystem.writeFileString(
        first.filePath,
        saved.replace("claude\\u0000home\\u0000state", "other"),
      );
      const second = yield* setup({ filePath: first.filePath });
      const capabilities = yield* second.resolver.resolve("startup", "2.1.0");
      assert.deepStrictEqual(capabilities?.slashCommands, []);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("remembers a workspace's commands for an hour and across restarts", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const first = yield* setup();
      const commands = [{ name: "deploy" }];
      assert.isUndefined(yield* first.resolver.workspaceSlashCommands("/repo", "2.1.0"));
      yield* first.resolver.recordWorkspaceSlashCommands("/repo", "2.1.0", commands);

      const second = yield* setup({ filePath: first.filePath });
      assert.deepStrictEqual(
        yield* second.resolver.workspaceSlashCommands("/repo", "2.1.0"),
        commands,
      );
      assert.isUndefined(yield* second.resolver.workspaceSlashCommands("/repo", "2.2.0"));
      assert.isUndefined(yield* second.resolver.workspaceSlashCommands("/elsewhere", "2.1.0"));

      yield* TestClock.adjust(hour + 1);
      assert.isUndefined(yield* second.resolver.workspaceSlashCommands("/repo", "2.1.0"));
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("drops remembered workspaces when asked for a fresh scan", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { resolver } = yield* setup();
      yield* resolver.recordWorkspaceSlashCommands("/repo", "2.1.0", [{ name: "deploy" }]);
      yield* resolver.invalidate;
      assert.isUndefined(yield* resolver.workspaceSlashCommands("/repo", "2.1.0"));
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
