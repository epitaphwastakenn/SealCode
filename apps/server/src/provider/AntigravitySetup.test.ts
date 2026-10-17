import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { makeAntigravitySetup, validateAntigravityCallback } from "./AntigravitySetup.ts";

const instanceId = ProviderInstanceId.make("antigravity");
const auth =
  "https://accounts.google.com/o/oauth2/auth?state=expected&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback";
const callback = "http://127.0.0.1:12345/callback?state=expected&code=test";

describe("Antigravity setup", () => {
  it("accepts only the matching loopback callback and OAuth state", () => {
    expect(validateAntigravityCallback(auth, callback).href).toBe(callback);
    for (const value of [
      callback.replace("12345", "80"),
      callback.replace("expected", "stale"),
      callback.replace("/callback", "/other"),
      callback.replace("127.0.0.1", "example.com"),
    ]) {
      expect(() => validateAntigravityCallback(auth, value)).toThrow();
    }
    expect(() =>
      validateAntigravityCallback(auth.replace("accounts.google.com", "example.com"), callback),
    ).toThrow();
  });
  it.effect(
    "keeps sign-in pending until completion or cancellation and rejects overlapping login",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const closed = yield* Deferred.make<void>();
          const setup = yield* makeAntigravitySetup({
            makeRuntime: (input) =>
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined));
                yield* input.onAuthorizationUrl!(auth);
                yield* Deferred.succeed(started, undefined);
                return yield* Effect.never;
              }),
            runtimeDirectory: "unused",
            tokenPath: "unused",
            profile: "unused",
            platform: "win32",
            arch: "x64",
            manualInstallation: true,
            stopSessions: Effect.void,
            refresh: Effect.void,
          });
          expect((yield* setup({ instanceId, action: "login" })).phase).toBe("signing-in");
          yield* Deferred.await(started);
          expect((yield* setup({ instanceId, action: "status" })).authorizationUrl).toBe(auth);
          expect(
            (yield* setup({ instanceId, action: "login" }).pipe(Effect.flip)).message,
          ).toContain("already running");
          expect((yield* setup({ instanceId, action: "cancel" })).phase).toBe("idle");
          yield* Deferred.await(closed);
          expect(
            (yield* setup({ instanceId, action: "install" }).pipe(Effect.flip)).message,
          ).toContain("Clear the ACP executable");
        }).pipe(Effect.provide(NodeServices.layer)),
      ),
  );
});
