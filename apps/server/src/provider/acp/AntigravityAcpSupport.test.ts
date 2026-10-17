import * as NodeURL from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { AntigravitySettings, ProviderInstanceId } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { ServerConfig } from "../../config.ts";
import { makeAntigravityRuntimeFactory } from "./AntigravityAcpSupport.ts";

const script = NodeURL.fileURLToPath(
  new URL("../../../scripts/antigravity-acp-mock.mjs", import.meta.url),
);
const decodeSettings = Schema.decodeSync(AntigravitySettings);
const authorizationUrl =
  "https://accounts.google.com/o/oauth2/auth?state=test&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback";

describe("Antigravity ACP runtime", () => {
  it.effect(
    "isolates credentials, captures the login URL, and allows sign-in to take over ten minutes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const platform = yield* HostProcessPlatform;
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "sealcode-acp-support-" });
          const executable = path.join(
            dir,
            platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par",
          );
          const helper = path.join(
            dir,
            platform === "win32" ? "localharness_external.exe" : "localharness_external",
          );
          yield* fs.writeFileString(executable, "");
          yield* fs.writeFileString(helper, "");
          let receivedUrl = "";
          const loginStarted = yield* Deferred.make<void>();
          const completeLogin = yield* Deferred.make<void>();
          const factory = yield* makeAntigravityRuntimeFactory({
            instanceId: ProviderInstanceId.make("isolated-account"),
            config: decodeSettings({ acpBinaryPath: executable }),
            environment: {
              ...process.env,
              GEMINI_API_KEY: "not-for-acp",
              GOOGLE_API_KEY: "not-for-acp",
              ANTIGRAVITY_TEST_AUTH: authorizationUrl,
            },
          }).pipe(
            Effect.provide(ServerConfig.layerTest(dir, dir)),
            Effect.provideService(
              ChildProcessSpawner.ChildProcessSpawner,
              ChildProcessSpawner.make((command) => {
                if (command._tag !== "StandardCommand") return Effect.die("Unexpected pipeline");
                expect(command.command).toBe(executable);
                expect(command.options.extendEnv).toBe(false);
                expect(command.options.env).not.toHaveProperty("GEMINI_API_KEY");
                expect(command.options.env).not.toHaveProperty("GOOGLE_API_KEY");
                expect(command.options.env).toMatchObject({
                  AGY_ACP_FORCE_FILE_STORAGE: "1",
                  ANTIGRAVITY_HARNESS_PATH: helper,
                });
                return spawner.spawn(
                  ChildProcess.make("node", [script], { ...command.options, shell: false }),
                );
              }),
            ),
          );
          const missingLogin = yield* factory.makeRuntime({ cwd: dir }).pipe(Effect.flip);
          expect(missingLogin).toMatchObject({ detail: expect.stringContaining("Sign in") });
          const runtime = yield* factory.makeRuntime({
            cwd: dir,
            onAuthorizationUrl: (url) =>
              Effect.gen(function* () {
                receivedUrl = url;
                yield* Deferred.succeed(loginStarted, undefined);
                yield* Deferred.await(completeLogin);
              }),
          });
          const start = yield* runtime.start().pipe(Effect.forkChild);
          yield* Deferred.await(loginStarted);
          yield* TestClock.adjust("11 minutes");
          yield* Deferred.succeed(completeLogin, undefined);
          expect((yield* Fiber.join(start)).sessionId).toBe("acp-test-session");
          expect(receivedUrl).toBe(authorizationUrl);
          expect(
            yield* fs.readFileString(
              path.join(factory.profile, "antigravity-acp", "settings.json"),
            ),
          ).toBe('{"auth":{"type":"oauth-personal"}}');
        }).pipe(Effect.provide(NodeServices.layer)),
      ),
  );
});
