import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AntigravitySettings, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { AntigravityDriver } from "./AntigravityDriver.ts";
const BackgroundPolicyMockLayer = Layer.mock(BackgroundPolicy.BackgroundPolicy)({
  reportClientActivity: () => Effect.void,
  removeRpcClient: () => Effect.void,
  reportHostPowerState: () => Effect.void,
  snapshot: Effect.succeed({} as any),
  streamChanges: Stream.empty,
  subscribe: Effect.succeed({ latest: {} as any, changes: Stream.empty }),
  hasDemand: () => Effect.succeed(true),
  shouldRunScopeWork: () => Effect.succeed(true),
  shouldRunOpportunisticWork: Effect.succeed(true),
});

const mockSpawner = ChildProcessSpawner.make(() =>
  Effect.succeed({
    pid: ChildProcessSpawner.ProcessId(123),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    stdout: Stream.empty,
    stderr: Stream.empty,
  } as any),
);

const testLayer = ServerConfig.layerTest(process.cwd(), process.cwd()).pipe(
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, mockSpawner)),
  Layer.provideMerge(BackgroundPolicyMockLayer),
  Layer.provideMerge(NodeServices.layer),
);

describe("AntigravityDriver", () => {
  it.effect("migrates saved CLI settings to an ACP provider instance", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();

      const instance = yield* AntigravityDriver.create({
        instanceId: ProviderInstanceId.make("antigravity"),
        displayName: "Antigravity",
        accentColor: undefined,
        environment: [],
        enabled: true,
        config: Schema.decodeSync(AntigravitySettings)({
          enabled: true,
          runtime: "cli",
          binaryPath: "agy",
          sdkPythonPath: "",
          customModels: [],
        }),
      }).pipe(
        Effect.provideService(HostProcessPlatform, "win32"),
        Effect.provideService(Scope.Scope, scope),
      );

      assert.equal(instance.driverKind, "antigravity");
      assert.isDefined(instance.adapter);
      assert.isDefined(instance.snapshot);
      const snapshot = yield* instance.snapshot.getSnapshot;
      assert.equal(snapshot.enabled, true);
      assert.isTrue(Schema.is(ServerProvider)(snapshot));

      yield* Scope.close(scope, Exit.void);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("creates an SDK provider instance when runtime is 'sdk'", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();

      const instance = yield* AntigravityDriver.create({
        instanceId: ProviderInstanceId.make("antigravity_sdk"),
        displayName: "Antigravity SDK",
        accentColor: undefined,
        environment: [{ name: "GEMINI_API_KEY", value: "test-api-key", sensitive: false }],
        enabled: true,
        config: Schema.decodeSync(AntigravitySettings)({
          enabled: true,
          runtime: "sdk",
          binaryPath: "agy",
          sdkPythonPath: "",
          customModels: ["custom-gemini"],
        }),
      }).pipe(
        Effect.provideService(HostProcessPlatform, "win32"),
        Effect.provideService(Scope.Scope, scope),
      );

      assert.equal(instance.driverKind, "antigravity");
      assert.isDefined(instance.adapter);
      assert.isDefined(instance.snapshot);
      const snapshot = yield* instance.snapshot.getSnapshot;
      assert.equal(snapshot.enabled, true);
      assert.isTrue(Schema.is(ServerProvider)(snapshot));

      yield* Scope.close(scope, Exit.void);
    }).pipe(Effect.provide(testLayer)),
  );
});
