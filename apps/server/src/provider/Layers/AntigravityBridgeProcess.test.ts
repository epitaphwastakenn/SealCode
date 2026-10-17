import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";

import {
  makeAntigravityBridgeProcess,
  resolveDefaultPythonCommand,
  resolveBridgeScriptPath,
} from "./AntigravityBridgeProcess.ts";

describe("AntigravityBridgeProcess", () => {
  it("resolves default Python command and bridge script path", () => {
    const cmd = resolveDefaultPythonCommand();
    assert.isTrue(cmd === "python" || cmd === "python3");

    const script = resolveBridgeScriptPath();
    assert.isTrue(script.endsWith("bridge.py"));

    const bundledScript = resolveBridgeScriptPath(
      new URL("../../../../dist/bin.mjs", import.meta.url).href,
    ).replaceAll("\\", "/");
    assert.isTrue(bundledScript.endsWith("/dist/provider/antigravity/bridge.py"));
  });

  it.effect("fails promptly when the configured Python runtime is unavailable", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const error = yield* makeAntigravityBridgeProcess({
        pythonPath: "sealcode-missing-python-runtime",
      }).pipe(
        Effect.flatMap((bridge) => bridge.probe()),
        Effect.provideService(Scope.Scope, scope),
        Effect.flip,
      );

      assert.include(error.message, "Antigravity bridge");

      yield* Scope.close(scope, Effect.void);
    }),
  );
});
