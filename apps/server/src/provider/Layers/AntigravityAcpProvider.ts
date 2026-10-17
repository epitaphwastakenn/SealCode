import type { ServerProviderModel, SubscriptionUsage } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import {
  antigravityModels,
  antigravityErrorMessage,
  ANTIGRAVITY_ACP_DEFAULT_MODEL,
  type AntigravityRuntimeFactory,
} from "../acp/AntigravityAcpSupport.ts";
import { buildServerProvider } from "../providerSnapshot.ts";
import { probeAntigravitySubscriptionUsage } from "../antigravityUsage.ts";

export const checkAntigravityAcpProvider = Effect.fn("checkAntigravityAcpProvider")(
  function* (input: {
    enabled: boolean;
    makeRuntime: AntigravityRuntimeFactory;
    executablePath: string;
    harnessPath: string;
    tokenPath: string;
    profile: string;
    environment: NodeJS.ProcessEnv;
    platform: NodeJS.Platform;
    probe?: boolean;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const capabilities = createModelCapabilities({ optionDescriptors: [], vision: true });
    const fallback: ServerProviderModel[] = [
      {
        slug: ANTIGRAVITY_ACP_DEFAULT_MODEL,
        name: "Antigravity account default",
        isCustom: false,
        isDefault: true,
        capabilities,
      },
    ];
    let installed = false;
    let signedIn = false;
    let subscriptionUsage: SubscriptionUsage | undefined;
    const build = (models: ReadonlyArray<ServerProviderModel>, ready: boolean, message: string) =>
      buildServerProvider({
        enabled: input.enabled,
        checkedAt,
        presentation: {
          displayName: "Antigravity",
          showInteractionModeToggle: false,
          requiresNewThreadForModelChange: false,
        },
        models,
        probe: {
          installed,
          version: null,
          status: ready ? "ready" : "warning",
          auth: {
            status:
              ready || subscriptionUsage
                ? "authenticated"
                : signedIn
                  ? "unknown"
                  : "unauthenticated",
          },
          ...(subscriptionUsage ? { subscriptionUsage } : {}),
          message,
        },
      });
    return yield* Effect.gen(function* () {
      installed = (yield* fs.exists(input.executablePath)) && (yield* fs.exists(input.harnessPath));
      signedIn = yield* fs.exists(input.tokenPath);
      if (!installed)
        return build(fallback, false, "Install the official ACP runtime in Settings > Providers.");
      if (!signedIn)
        return build(
          fallback,
          false,
          "Sign in with Google in Settings > Providers. No API key is required.",
        );
      if (!input.probe || !input.enabled)
        return build(fallback, false, "Checking Antigravity account access…");
      subscriptionUsage = yield* probeAntigravitySubscriptionUsage({
        environment: input.environment,
        platform: input.platform,
        binaryPath: input.executablePath,
        acpTokenPath: input.tokenPath,
        checkedAt,
      });
      return yield* Effect.gen(function* () {
        const runtime = yield* input.makeRuntime({ cwd: input.profile });
        yield* runtime.start();
        const options = yield* runtime.getConfigOptions;
        const model = options.find((option) => option.id === "model");
        const current = model?.type === "select" ? model.currentValue : undefined;
        const models = antigravityModels(options).map((option) => ({
          slug: option.value,
          name: option.name,
          isCustom: false,
          isDefault: option.value === current,
          capabilities,
        }));
        return build(
          models.length ? models : fallback,
          true,
          "Connected through the official Antigravity ACP agent.",
        );
      }).pipe(Effect.scoped);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed(build(fallback, false, antigravityErrorMessage(cause))),
      ),
    );
  },
);
