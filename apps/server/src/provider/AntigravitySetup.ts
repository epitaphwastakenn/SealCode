import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeStreamPromises from "node:stream/promises";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import {
  ProviderSetupError,
  type ProviderSetupInput,
  type ProviderSetupState,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import type { AntigravityRuntimeFactory } from "./acp/AntigravityAcpSupport.ts";
import { antigravityErrorMessage } from "./acp/AntigravityAcpSupport.ts";
import { resolveAntigravityReleaseAsset } from "./antigravityRelease.ts";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const installations = new Map<string, Promise<void>>();

export function installAntigravityRuntime(
  directory: string,
  platform: NodeJS.Platform,
  arch: string,
) {
  const active = installations.get(directory);
  if (active) return active;
  const install = (async () => {
    const asset = resolveAntigravityReleaseAsset(platform, arch);
    if (!asset) throw new Error(`Antigravity ACP does not support ${platform}/${arch}.`);
    if (NodeFS.existsSync(directory)) {
      for (const file of [asset.executable, asset.harness]) {
        if ((await NodeFSP.stat(NodePath.join(directory, file.name))).size !== file.bytes)
          throw new Error(
            `The installed ${file.name} is invalid. Remove the managed runtime directory and install again.`,
          );
      }
      return;
    }
    await NodeFSP.mkdir(NodePath.dirname(directory), { recursive: true });
    const staging = await NodeFSP.mkdtemp(NodePath.join(NodePath.dirname(directory), ".install-"));
    const archive = NodePath.join(staging, "runtime.zip");
    const extracted = NodePath.join(staging, "runtime");
    try {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`Antigravity download failed: HTTP ${response.status}.`);
      if (!response.body) throw new Error("Antigravity download returned an empty response.");
      const hash = NodeCrypto.createHash("sha256");
      let bytes = 0;
      await NodeStreamPromises.pipeline(
        response.body,
        async function* (chunks) {
          for await (const chunk of chunks) {
            bytes += chunk.byteLength;
            hash.update(chunk);
            yield chunk;
          }
        },
        NodeFS.createWriteStream(archive),
      );
      if (bytes !== asset.archiveBytes || hash.digest("hex") !== asset.sha256)
        throw new Error("Antigravity download checksum did not match the official release.");
      await NodeFSP.mkdir(extracted);
      await execFile("tar", ["-xf", archive, "-C", extracted], { windowsHide: true });
      for (const file of [asset.executable, asset.harness]) {
        const target = NodePath.join(extracted, file.name);
        if ((await NodeFSP.stat(target)).size !== file.bytes)
          throw new Error(`Antigravity archive contains an invalid ${file.name}.`);
        if (platform !== "win32") await NodeFSP.chmod(target, 0o755);
      }
      await NodeFSP.rename(extracted, directory);
    } finally {
      await NodeFSP.rm(staging, { recursive: true, force: true });
    }
  })().finally(() => installations.delete(directory));
  installations.set(directory, install);
  return install;
}

export function validateAntigravityCallback(authorizationUrl: string, callbackUrl: string): URL {
  const auth = new URL(authorizationUrl);
  const redirect = new URL(auth.searchParams.get("redirect_uri") ?? "");
  const callback = new URL(callbackUrl);
  if (
    auth.origin !== "https://accounts.google.com" ||
    redirect.protocol !== "http:" ||
    redirect.hostname !== "127.0.0.1" ||
    callback.origin !== redirect.origin ||
    callback.pathname !== redirect.pathname ||
    !auth.searchParams.get("state") ||
    callback.searchParams.get("state") !== auth.searchParams.get("state") ||
    !callback.searchParams.get("code")
  ) {
    throw new Error("Paste the complete Google return URL for the current sign-in attempt.");
  }
  return callback;
}

export const makeAntigravitySetup = Effect.fn("makeAntigravitySetup")(function* (options: {
  makeRuntime: AntigravityRuntimeFactory;
  runtimeDirectory: string;
  tokenPath: string;
  profile: string;
  platform: NodeJS.Platform;
  arch: string;
  manualInstallation: boolean;
  stopSessions: Effect.Effect<void, unknown>;
  refresh: Effect.Effect<unknown>;
}) {
  const owner = yield* Scope.Scope;
  let state: ProviderSetupState = { phase: "idle", authorizationUrl: null, message: null };
  let flow: Fiber.Fiber<void, never> | undefined;
  const run = (
    phase: "installing" | "signing-in",
    effect: Effect.Effect<void, unknown, Scope.Scope>,
  ) =>
    Effect.gen(function* () {
      state = {
        phase,
        authorizationUrl: null,
        message:
          phase === "installing"
            ? "Downloading the official Antigravity runtime…"
            : "Starting Google sign-in…",
      };
      flow = yield* effect.pipe(
        Effect.scoped,
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            Effect.sync(() => {
              state = {
                phase: "error",
                authorizationUrl: null,
                message: antigravityErrorMessage(cause),
              };
            }),
          onSuccess: () =>
            Effect.gen(function* () {
              state = {
                phase: "ready",
                authorizationUrl: null,
                message:
                  phase === "installing"
                    ? "Runtime installed. Sign in with Google to continue."
                    : "Google sign-in complete.",
              };
              yield* options.refresh;
            }),
        }),
        Effect.forkIn(owner),
      );
      return state;
    });
  return (input: ProviderSetupInput): Effect.Effect<ProviderSetupState, ProviderSetupError> =>
    Effect.gen(function* () {
      if (input.action === "status") return state;
      if (input.action === "callback") {
        if (state.phase !== "signing-in" || !state.authorizationUrl || !input.callbackUrl)
          throw new Error("There is no pending Google sign-in.");
        const url = validateAntigravityCallback(state.authorizationUrl, input.callbackUrl);
        yield* Effect.tryPromise(async () => {
          const response = await fetch(url, { redirect: "manual" });
          if (response.status >= 400)
            throw new Error(`Google sign-in callback failed: HTTP ${response.status}.`);
          await response.body?.cancel();
        });
        return state;
      }
      if (input.action === "cancel" || input.action === "logout") {
        if (state.phase === "installing") throw new Error("Wait for installation to finish.");
        if (flow) yield* Fiber.interrupt(flow);
        if (input.action === "logout") {
          yield* options.stopSessions;
          yield* Effect.tryPromise(() => NodeFSP.rm(options.tokenPath, { force: true }));
          yield* options.refresh;
        }
        state = {
          phase: "idle",
          authorizationUrl: null,
          message: input.action === "logout" ? "Signed out." : "Sign-in cancelled.",
        };
        return state;
      }
      if (state.phase === "installing" || state.phase === "signing-in")
        throw new Error("An Antigravity setup operation is already running.");
      if (input.action === "install") {
        if (options.manualInstallation)
          throw new Error("Clear the ACP executable setting to use managed installation.");
        return yield* run(
          "installing",
          Effect.tryPromise(() =>
            installAntigravityRuntime(options.runtimeDirectory, options.platform, options.arch),
          ),
        );
      }
      return yield* run(
        "signing-in",
        Effect.gen(function* () {
          yield* options.stopSessions;
          const runtime = yield* options.makeRuntime({
            cwd: options.profile,
            onAuthorizationUrl: (url) =>
              Effect.sync(() => {
                const auth = new URL(url);
                if (auth.origin !== "https://accounts.google.com")
                  throw new Error("Antigravity returned an unexpected sign-in URL.");
                state = {
                  phase: "signing-in",
                  authorizationUrl: url,
                  message: "Open Google sign-in and complete it in your browser.",
                };
              }),
          });
          yield* runtime.start();
        }),
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.fail(new ProviderSetupError({ message: Cause.pretty(cause) })),
      ),
    );
});
