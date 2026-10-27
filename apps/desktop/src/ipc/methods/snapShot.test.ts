import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopSnapShot from "../../snapShot/DesktopSnapShot.ts";
import { setupSnapShot } from "./snapShot.ts";

describe("window capture IPC", () => {
  it.effect("allows capture setup only from the trusted main renderer", () => {
    const actions: string[] = [];
    return Effect.gen(function* () {
      yield* setupSnapShot.handler("allow-screen-recording", { sender: { id: 7 } });
      assert.deepEqual(actions, ["allow-screen-recording"]);
      const rejected = yield* Effect.exit(
        setupSnapShot.handler("allow-accessibility", { sender: { id: 8 } }),
      );
      assert(Exit.isFailure(rejected));
      assert.deepEqual(actions, ["allow-screen-recording"]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ElectronWindow.ElectronWindow, {
            main: Effect.succeedSome({ webContents: { id: 7 } }),
          } as ElectronWindow.ElectronWindow["Service"]),
          Layer.succeed(DesktopSnapShot.DesktopSnapShot, {
            setup: (action: string) =>
              Effect.sync(() => {
                actions.push(action);
              }),
          } as unknown as DesktopSnapShot.DesktopSnapShot["Service"]),
        ),
      ),
    );
  });
});
