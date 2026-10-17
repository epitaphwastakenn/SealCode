import { it, expect } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";

vi.mock("./config.ts", () => ({
  sharedServerCommandFlags: {},
  resolveServerConfig: () => Effect.succeed({ desktopBootstrapToken: "test" }),
}));
vi.mock("../server.ts", () => ({ runServer: Effect.never }));
import { desktopOwnerDisconnected } from "./server.ts";

it.effect("releases the desktop backend when its owner closes stdin", () =>
  Effect.gen(function* () {
    const listening = yield* Deferred.make<void>();
    let released = false;
    const resume = vi.spyOn(process.stdin, "resume").mockImplementation(() => {
      Deferred.doneUnsafe(listening, Exit.void);
      return process.stdin;
    });
    try {
      const fiber = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              released = true;
            }),
          );
          yield* Effect.raceFirst(Effect.never, desktopOwnerDisconnected);
        }),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(listening);
      process.stdin.emit("end");
      yield* Fiber.join(fiber);
      expect(released).toBe(true);
    } finally {
      resume.mockRestore();
    }
  }),
);
