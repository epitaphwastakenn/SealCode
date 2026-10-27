import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

const { registerSchemesMock } = vi.hoisted(() => ({ registerSchemesMock: vi.fn() }));

vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: registerSchemesMock,
  },
}));

import * as DesktopPreReadyPlatform from "./DesktopPreReadyPlatform.ts";

describe("DesktopPreReadyPlatform", () => {
  it.effect(
    "acquires a synchronous pre-ready layer before an asynchronous Clerk-shaped layer",
    () =>
      Effect.gen(function* () {
        class ClerkShaped extends Context.Service<ClerkShaped, { readonly ready: true }>()(
          "@t3tools/desktop/app/DesktopPreReadyPlatform.test/ClerkShaped",
        ) {}

        const events: Array<string> = [];
        registerSchemesMock.mockReset();
        registerSchemesMock.mockImplementation(() => {
          events.push("pre-ready");
        });

        const layerClerkShaped = Layer.effect(
          ClerkShaped,
          Effect.promise(() => Promise.resolve()).pipe(
            Effect.map(() => {
              events.push("clerk");
              return { ready: true as const };
            }),
          ),
        );

        const layerRuntime = layerClerkShaped.pipe(
          Layer.flatMap((clerkContext) => Layer.succeedContext(clerkContext)),
          Layer.provideMerge(DesktopPreReadyPlatform.layer),
        );

        const result = yield* ClerkShaped.pipe(Effect.provide(layerRuntime));

        assert.deepEqual(result, { ready: true });
        assert.deepEqual(events, ["pre-ready", "clerk"]);
        assert.equal(registerSchemesMock.mock.calls.length, 1);
      }),
  );
});
