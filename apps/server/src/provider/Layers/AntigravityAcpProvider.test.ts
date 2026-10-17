import { describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as AcpErrors from "effect-acp/errors";
import { checkAntigravityAcpProvider } from "./AntigravityAcpProvider.ts";

const { probeUsage } = vi.hoisted(() => ({ probeUsage: vi.fn() }));
vi.mock("../antigravityUsage.ts", () => ({ probeAntigravitySubscriptionUsage: probeUsage }));

describe("Antigravity ACP usage snapshot", () => {
  it.effect("publishes account quotas even when the ACP session cannot start", () =>
    Effect.gen(function* () {
      const usage = { plan: "Google AI Pro", windows: [], checkedAt: "2026-09-06T12:00:00Z" };
      probeUsage.mockReturnValue(Effect.succeed(usage));
      const snapshot = yield* checkAntigravityAcpProvider({
        enabled: true,
        probe: true,
        executablePath: "/runtime/agy_acp_server.exe",
        harnessPath: "/runtime/localharness_external.exe",
        tokenPath: "/account-a/antigravity-acp/acp_token.json",
        profile: "/account-a",
        environment: {},
        platform: "win32",
        makeRuntime: () =>
          Effect.fail(
            new AcpErrors.AcpTransportError({
              detail: "ACP session failed",
              cause: undefined,
            }),
          ),
      }).pipe(Effect.provide(FileSystem.layerNoop({ exists: () => Effect.succeed(true) })));

      expect(probeUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          acpTokenPath: "/account-a/antigravity-acp/acp_token.json",
          environment: {},
          platform: "win32",
        }),
      );
      expect(snapshot.subscriptionUsage).toEqual(usage);
      expect(snapshot.auth.status).toBe("authenticated");
      expect(snapshot.status).toBe("warning");
    }),
  );
});
