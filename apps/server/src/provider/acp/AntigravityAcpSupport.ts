import * as NodeCrypto from "node:crypto";
import { HostProcessExecutablePath, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import type { AntigravitySettings, ProviderInstanceId, RuntimeMode } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as AcpErrors from "effect-acp/errors";
import type * as AcpSchema from "effect-acp/schema";
import { ServerConfig } from "../../config.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { preserveAntigravityCleanup } from "./AntigravityProcess.ts";

export const ANTIGRAVITY_ACP_DEFAULT_MODEL = "antigravity-default";
export const AUTH_PREFIX = "Open the following link to authenticate the ACP server: ";
export const AUTH_MARKER = "__SEALCODE_ANTIGRAVITY_AUTH_URL__";
export function antigravityErrorMessage(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof AcpErrors.AcpTransportError
    ? (error.detail ?? error.message)
    : Cause.pretty(cause);
}
export const authRequired = () =>
  new AcpErrors.AcpTransportError({
    detail: "Sign in to Antigravity in Settings > Providers before continuing.",
    cause: undefined,
  });
export type AntigravityRuntime = AcpSessionRuntime.AcpSessionRuntime["Service"];
export type AntigravityRuntimeFactory = (input: {
  cwd: string;
  resumeSessionId?: string;
  mcpServers?: ReadonlyArray<AcpSchema.McpServer>;
  onAuthorizationUrl?: (url: string) => Effect.Effect<void>;
}) => Effect.Effect<AntigravityRuntime, AcpErrors.AcpError, Scope.Scope>;

export function antigravityModels(options: ReadonlyArray<AcpSchema.SessionConfigOption>) {
  const model = options.find((option) => option.id === "model");
  return model?.type === "select"
    ? model.options.flatMap((entry) => ("value" in entry ? [entry] : entry.options))
    : [];
}

export const selectAntigravityModel = Effect.fn("selectAntigravityModel")(function* (
  runtime: AntigravityRuntime,
  model: string | undefined,
) {
  const options = yield* runtime.getConfigOptions;
  const config = options.find((option) => option.id === "model");
  const current = config?.type === "select" ? config.currentValue : undefined;
  const requested = !model || model === ANTIGRAVITY_ACP_DEFAULT_MODEL ? current : model;
  if (requested && !antigravityModels(options).some((option) => option.value === requested)) {
    return yield* AcpErrors.AcpRequestError.invalidParams(
      `Antigravity model '${requested}' is unavailable for this account. Select an available model.`,
    );
  }
  if (requested && requested !== current) yield* runtime.setModel(requested);
  return requested;
});

export const antigravityPermissionMode = (mode: RuntimeMode) =>
  mode === "full-access" ? "yolo" : mode === "auto-accept-edits" ? "auto_edit" : "default";

export const makeAntigravityRuntimeFactory = Effect.fn("makeAntigravityRuntimeFactory")(
  function* (input: {
    instanceId: ProviderInstanceId;
    config: AntigravitySettings;
    environment: NodeJS.ProcessEnv;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const platform = yield* HostProcessPlatform;
    const node = yield* HostProcessExecutablePath;
    const server = yield* ServerConfig;
    const profile = path.join(
      server.stateDir,
      "providers",
      "antigravity",
      NodeCrypto.createHash("sha256").update(input.instanceId).digest("hex"),
    );
    const runtimeDirectory = path.join(
      server.stateDir,
      "providers",
      "antigravity",
      "runtime",
      "1.1.1",
    );
    const executablePath =
      input.config.acpBinaryPath ||
      path.join(
        runtimeDirectory,
        platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par",
      );
    const harnessPath = path.join(
      path.dirname(executablePath),
      platform === "win32" ? "localharness_external.exe" : "localharness_external",
    );
    const tokenPath = path.join(profile, "antigravity-acp", "acp_token.json");
    const helper = `process.stderr.on("error",()=>process.exit(0)).write("${AUTH_MARKER}"+JSON.stringify(process.argv[1])+"\\n",()=>process.exit(0))`;
    const browserCommand = [node.replaceAll("\\", "/"), "-e", helper, "--", "%s"]
      .map((value) => `'${value.replaceAll("'", `'"'"'`)}'`)
      .join(" ");
    const environment = Object.fromEntries(
      Object.entries(input.environment).filter(
        ([key]) =>
          ![
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "GOOGLE_CLOUD_PROJECT",
            "GOOGLE_CLOUD_LOCATION",
            "GOOGLE_CLOUD_QUOTA_PROJECT",
            "GOOGLE_GENAI_USE_VERTEXAI",
            "GCLOUD_PROJECT",
            "CLOUDSDK_CORE_PROJECT",
            "AGY_ACP_CCPA_PROJECT",
            "AGY_ACP_ENABLE_OAUTH",
            "GEMINI_HOME",
            "AGY_ACP_FORCE_FILE_STORAGE",
            "ANTIGRAVITY_HARNESS_PATH",
            "BROWSER",
            "PYTHONUNBUFFERED",
            "ELECTRON_RUN_AS_NODE",
          ].includes(key.toUpperCase()),
      ),
    );
    const makeRuntime: AntigravityRuntimeFactory = (options) =>
      Effect.gen(function* () {
        if (!(yield* fs.exists(executablePath)) || !(yield* fs.exists(harnessPath))) {
          return yield* new AcpErrors.AcpTransportError({
            detail: "Install the Antigravity ACP runtime in Settings > Providers.",
            cause: undefined,
          });
        }
        if (!options.onAuthorizationUrl && !(yield* fs.exists(tokenPath)))
          return yield* authRequired();
        yield* fs.makeDirectory(path.dirname(tokenPath), { recursive: true });
        yield* fs.writeFileString(
          path.join(path.dirname(tokenPath), "settings.json"),
          JSON.stringify({ auth: { type: "oauth-personal" } }),
        );
        const failure = yield* Deferred.make<never, AcpErrors.AcpError>();
        const receiveUrl = (url: string) =>
          options.onAuthorizationUrl
            ? options.onAuthorizationUrl(url)
            : Deferred.fail(failure, authRequired()).pipe(Effect.asVoid);
        const handleAuthLine = (line: string) => {
          if (line.startsWith(AUTH_PREFIX))
            return receiveUrl(line.slice(AUTH_PREFIX.length).trim());
          if (line.startsWith(AUTH_MARKER)) {
            return Effect.try({
              try: () => JSON.parse(line.slice(AUTH_MARKER.length)) as string,
              catch: () => authRequired(),
            }).pipe(
              Effect.flatMap(receiveUrl),
              Effect.catch((error) => Deferred.fail(failure, error).pipe(Effect.asVoid)),
            );
          }
          return Effect.void;
        };
        const runtime = yield* AcpSessionRuntime.make({
          ...options,
          spawn: {
            command: executablePath,
            args: platform === "linux" ? ["--uid="] : [],
            cwd: options.cwd,
            extendEnv: false,
            env: {
              ...environment,
              GEMINI_HOME: profile,
              AGY_ACP_FORCE_FILE_STORAGE: "1",
              BROWSER: browserCommand,
              PYTHONUNBUFFERED: "1",
              ELECTRON_RUN_AS_NODE: "1",
              ANTIGRAVITY_HARNESS_PATH: harnessPath,
            },
          },
          clientInfo: { name: "sealcode", version: "0.0.32" },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          authMethodId: "oauth-personal",
          resumeMethod: "resume",
          cancelBehavior: "wait-for-prompt",
          initializeTimeout: "90 seconds",
          ...(options.onAuthorizationUrl ? {} : { authenticateTimeout: "30 seconds" as const }),
          sessionNewTimeout: "30 seconds",
          transformStdout: (stdout) =>
            stdout.pipe(
              Stream.decodeText(),
              Stream.splitLines,
              Stream.mapEffect((line) => handleAuthLine(line).pipe(Effect.as(line))),
              Stream.filter(
                (line) => !line.startsWith(AUTH_PREFIX) && !line.startsWith(AUTH_MARKER),
              ),
              Stream.map((line) => new TextEncoder().encode(`${line}\n`)),
            ),
          onStderr: (() => {
            let pending = "";
            return (chunk: string) => {
              const lines = (pending + chunk).split("\n");
              pending = lines.pop() ?? "";
              return Effect.forEach(lines, handleAuthLine, { discard: true });
            };
          })(),
        }).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            platform === "win32"
              ? ChildProcessSpawner.make((command) => Effect.gen(function* () {
                  const child = yield* spawner.spawn(command);
                  yield* preserveAntigravityCleanup(child);
                  return child;
                }))
              : spawner,
          ),
        );
        return {
          ...runtime,
          start: () => Effect.raceFirst(runtime.start(), Deferred.await(failure)),
        };
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof AcpErrors.AcpTransportError ||
          cause instanceof AcpErrors.AcpRequestError ||
          cause instanceof AcpErrors.AcpSpawnError
            ? cause
            : new AcpErrors.AcpTransportError({
                detail: "Could not start Antigravity ACP.",
                cause,
              }),
        ),
      );
    return {
      makeRuntime,
      executablePath,
      harnessPath,
      runtimeDirectory,
      tokenPath,
      profile,
      platform,
    };
  },
);
