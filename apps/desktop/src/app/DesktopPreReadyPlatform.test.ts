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
    "acquires a synchronous pre-ready layer before an asynchronous app-links-shaped layer",
    () =>
      Effect.gen(function* () {
        class AppLinksShaped extends Context.Service<AppLinksShaped, { readonly ready: true }>()(
          "@t3tools/desktop/app/DesktopPreReadyPlatform.test/AppLinksShaped",
        ) {}

        const events: Array<string> = [];
        registerSchemesMock.mockReset();
        registerSchemesMock.mockImplementation(() => {
          events.push("pre-ready");
        });

        const layerAppLinksShaped = Layer.effect(
          AppLinksShaped,
          Effect.promise(() => Promise.resolve()).pipe(
            Effect.map(() => {
              events.push("app-links");
              return { ready: true as const };
            }),
          ),
        );

        const layerRuntime = layerAppLinksShaped.pipe(
          Layer.flatMap((appLinksContext) => Layer.succeedContext(appLinksContext)),
          Layer.provideMerge(DesktopPreReadyPlatform.layer),
        );

        const result = yield* AppLinksShaped.pipe(Effect.provide(layerRuntime));

        assert.deepEqual(result, { ready: true });
        assert.deepEqual(events, ["pre-ready", "app-links"]);
        assert.equal(registerSchemesMock.mock.calls.length, 1);
      }),
  );
});
