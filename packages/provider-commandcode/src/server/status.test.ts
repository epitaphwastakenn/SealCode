// @effect-diagnostics nodeBuiltinImport:off - the fixtures lay out a fake npm install on disk.
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { CommandCodeSettings } from "../settings.ts";
import { makeFakeCommandCode } from "./fakeCommandCode.testkit.ts";
import { checkCommandCodeProviderStatus, type CommandCodeStatusOptions } from "./status.ts";

const settings = Schema.decodeSync(CommandCodeSettings);

const MODEL_LIST = `Available models  ·  2 models

Open Source

deepseek/deepseek-v4-flash           fast hybrid-attention reasoning (default)

Meta

meta/muse-spark-1.2-contributor      Muse Spark 1.2 at ~95% off
`;

const MODEL_REFERENCE = `| Id (use EXACTLY this) | Name | Context | Efforts | $/1M in/out | Best for |
|---|---|---|---|---|---|
| \`deepseek/deepseek-v4-flash\` | DeepSeek V4 Flash (latest) | 1M | off, high, max | $0.14/$0.28 | fast |
| \`meta/muse-spark-1.2-contributor\` | Muse Spark 1.2 Contributor | 1.05M | — | $0.1/$0.2 | cheap |
`;

const billing = (
  respond: (path: string, authorization: string | undefined) => Response,
): HttpClient.HttpClient =>
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        respond(new URL(request.url).pathname, request.headers["authorization"]),
      ),
    ),
  );

const noNetwork = HttpClient.make(() => Effect.die("status must not call the network here"));

const check = Effect.fnUntraced(function* (
  config: Parameters<typeof settings>[0],
  options: {
    readonly home?: string;
    readonly http?: HttpClient.HttpClient;
    readonly status?: CommandCodeStatusOptions;
  } = {},
) {
  const environment = yield* HostProcess.Environment;
  const home = options.home ?? "/commandcode-test-no-home";
  return yield* checkCommandCodeProviderStatus(
    settings(config),
    { ...environment, USERPROFILE: home, HOME: home },
    undefined,
    options.status,
  ).pipe(Effect.provideService(HttpClient.HttpClient, options.http ?? noNetwork));
});

it.layer(NodeServices.layer)("CommandCode status", (it) => {
  it.effect("does not run the CLI while disabled", () =>
    Effect.gen(function* () {
      const snapshot = yield* check({
        enabled: false,
        binaryPath: "/definitely-missing/commandcode",
      });
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.models.map((model) => model.slug)).toContain("deepseek/deepseek-v4-flash");
    }),
  );

  it.effect("gives host-local install and login guidance for a missing binary", () =>
    Effect.gen(function* () {
      const snapshot = yield* check({
        enabled: true,
        binaryPath: "/definitely-missing/commandcode",
      });
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("commandcode login");
      expect(snapshot.message).toContain("this Harp server host");
    }),
  );

  it.effect("reports an installed CLI that fails its version check", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeCommandCode({ version: "oops", versionExitCode: 2 });
      const snapshot = yield* check({ enabled: true, binaryPath: fake.binaryPath });
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("failed to run");
    }).pipe(Effect.scoped),
  );

  it.effect("lists the CLI's models with names and efforts from its bundled catalog", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const fake = yield* makeFakeCommandCode({ version: "1.17.0", modelList: MODEL_LIST });
      const reference = NodePath.join(
        fake.directory,
        "node_modules",
        "command-code",
        "dist",
        "bundled",
        "command-code-knowledge",
        "reference",
      );
      yield* fileSystem.makeDirectory(reference, { recursive: true });
      yield* fileSystem.writeFileString(NodePath.join(reference, "models.md"), MODEL_REFERENCE);

      const snapshot = yield* check({
        enabled: true,
        binaryPath: fake.binaryPath,
        customModels: ["acme/private-model"],
      });

      expect(snapshot.status).toBe("ready");
      expect(snapshot.version).toBe("1.17.0");
      expect(snapshot.auth.status).toBe("unknown");
      expect(snapshot.models.map((model) => [model.slug, model.name, model.isCustom])).toEqual([
        ["deepseek/deepseek-v4-flash", "DeepSeek V4 Flash (latest)", false],
        ["meta/muse-spark-1.2-contributor", "Muse Spark 1.2 Contributor", false],
        ["acme/private-model", "acme/private-model", true],
      ]);
      const efforts = snapshot.models[0]?.capabilities?.optionDescriptors?.[0];
      expect(efforts?.type === "select" && efforts.options.map((option) => option.id)).toEqual([
        "off",
        "high",
        "max",
      ]);
      expect(snapshot.models[1]?.capabilities?.optionDescriptors).toEqual([]);
      expect(snapshot.usageLimits).toBeUndefined();
      expect((yield* fake.invocations).length).toBe(0);
    }).pipe(Effect.scoped),
  );

  it.effect("prefers the CLI's cached remote catalog over its bundled one", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const fake = yield* makeFakeCommandCode({
        modelList: `${MODEL_LIST}moonshotai/kimi-k3.1-pro             frontier reasoning
`,
      });
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "commandcode-home-" });
      const cache = NodePath.join(home, ".commandcode", "cache", "model-catalog", "v1");
      yield* fileSystem.makeDirectory(cache, { recursive: true });
      yield* fileSystem.writeFileString(
        NodePath.join(cache, "catalog-test.json"),
        JSON.stringify({
          fetchedAt: 1,
          body: {
            data: [
              {
                id: "moonshotai/Kimi-K3.1-Pro",
                name: "Kimi K3.1 Pro",
                reasoningEfforts: ["low", "high", "max"],
              },
            ],
          },
        }),
      );

      const snapshot = yield* check({ enabled: true, binaryPath: fake.binaryPath }, { home });

      const kimi = snapshot.models.find((model) => model.slug === "moonshotai/kimi-k3.1-pro");
      expect(kimi?.name).toBe("Kimi K3.1 Pro");
      const efforts = kimi?.capabilities?.optionDescriptors?.[0];
      expect(efforts?.type === "select" && efforts.options.map((option) => option.id)).toEqual([
        "low",
        "high",
        "max",
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("reads the version from the installed package instead of starting the CLI", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const fake = yield* makeFakeCommandCode({ version: "1.17.0", modelList: MODEL_LIST });
      const packageDirectory = NodePath.join(fake.directory, "node_modules", "command-code");
      yield* fileSystem.makeDirectory(packageDirectory, { recursive: true });
      yield* fileSystem.writeFileString(
        NodePath.join(packageDirectory, "package.json"),
        JSON.stringify({ name: "command-code", version: "9.9.9" }),
      );

      const unattended = yield* check(
        { enabled: true, binaryPath: fake.binaryPath },
        { status: { reason: "interval" } },
      );
      expect(unattended.version).toBe("9.9.9");
      expect(unattended.status).toBe("ready");
      expect(yield* fake.probes).toEqual(["--list-models"]);

      const requested = yield* check(
        { enabled: true, binaryPath: fake.binaryPath },
        { status: { reason: "requested" } },
      );
      expect(requested.version).toBe("1.17.0");
      expect(yield* fake.probes).toEqual(["--list-models", "--version", "--list-models"]);
    }).pipe(Effect.scoped),
  );

  it.effect("lists models once per CLI version unless a refresh is requested", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const fake = yield* makeFakeCommandCode({ version: "1.17.0", modelList: MODEL_LIST });
      const modelListCachePath = NodePath.join(
        yield* fileSystem.makeTempDirectoryScoped({ prefix: "commandcode-cache-" }),
        "commandcode-models",
        "commandcode.json",
      );
      const config = { enabled: true, binaryPath: fake.binaryPath };
      const slugs = (snapshot: { readonly models: ReadonlyArray<{ readonly slug: string }> }) =>
        snapshot.models.map((model) => model.slug);

      const first = yield* check(config, { status: { reason: "startup", modelListCachePath } });
      const second = yield* check(config, { status: { reason: "interval", modelListCachePath } });
      expect(slugs(second)).toEqual(slugs(first));
      expect(slugs(first)).toContain("meta/muse-spark-1.2-contributor");
      expect((yield* fake.probes).filter((probe) => probe === "--list-models")).toHaveLength(1);

      yield* check(config, { status: { reason: "requested", modelListCachePath } });
      expect((yield* fake.probes).filter((probe) => probe === "--list-models")).toHaveLength(2);
    }).pipe(Effect.scoped),
  );

  it.effect("lists models again for a new CLI version and never saves an empty list", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const modelListCachePath = NodePath.join(
        yield* fileSystem.makeTempDirectoryScoped({ prefix: "commandcode-cache-" }),
        "commandcode.json",
      );
      const empty = yield* makeFakeCommandCode({ version: "1.17.0", modelList: "" });
      yield* check(
        { enabled: true, binaryPath: empty.binaryPath },
        { status: { reason: "interval", modelListCachePath } },
      );
      yield* check(
        { enabled: true, binaryPath: empty.binaryPath },
        { status: { reason: "interval", modelListCachePath } },
      );
      expect((yield* empty.probes).filter((probe) => probe === "--list-models")).toHaveLength(2);

      const older = yield* makeFakeCommandCode({ version: "1.17.0", modelList: MODEL_LIST });
      const newer = yield* makeFakeCommandCode({ version: "1.18.0", modelList: MODEL_LIST });
      yield* check(
        { enabled: true, binaryPath: older.binaryPath },
        { status: { reason: "interval", modelListCachePath } },
      );
      yield* check(
        { enabled: true, binaryPath: newer.binaryPath },
        { status: { reason: "interval", modelListCachePath } },
      );
      expect((yield* older.probes).filter((probe) => probe === "--list-models")).toHaveLength(1);
      expect((yield* newer.probes).filter((probe) => probe === "--list-models")).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the built-in models when the CLI lists none", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeCommandCode({ modelList: "" });
      const snapshot = yield* check({ enabled: true, binaryPath: fake.binaryPath });
      expect(snapshot.status).toBe("ready");
      expect(snapshot.models.map((model) => model.slug)).toContain("claude-sonnet-5");
    }).pipe(Effect.scoped),
  );

  it.effect("reads quota with the CLI's own credential", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const fake = yield* makeFakeCommandCode();
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "commandcode-home-" });
      yield* fileSystem.makeDirectory(NodePath.join(home, ".commandcode"), { recursive: true });
      yield* fileSystem.writeFileString(
        NodePath.join(home, ".commandcode", "auth.json"),
        JSON.stringify({ apiKey: "test-key" }),
      );
      const seen: Array<string | undefined> = [];
      const http = billing((path, authorization) => {
        seen.push(authorization);
        return Response.json(
          path.endsWith("credits")
            ? {
                credits: { monthlyCredits: 5 },
                windowLimits: { fiveHour: { used: 1, cap: 4, resetAt: 1_760_000_000 } },
              }
            : { data: { planId: "individual-go" } },
        );
      });

      const snapshot = yield* check({ enabled: true, binaryPath: fake.binaryPath }, { home, http });

      expect(seen).toEqual(["Bearer test-key", "Bearer test-key"]);
      expect(
        snapshot.usageLimits?.windows.map((window) => [window.id, window.usedPercent]),
      ).toEqual([
        ["five_hour", 25],
        ["monthly", 50],
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the provider ready when the billing API is down", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const fake = yield* makeFakeCommandCode();
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "commandcode-home-" });
      yield* fileSystem.makeDirectory(NodePath.join(home, ".commandcode"), { recursive: true });
      yield* fileSystem.writeFileString(
        NodePath.join(home, ".commandcode", "auth.json"),
        JSON.stringify({ apiKey: "test-key" }),
      );

      const snapshot = yield* check(
        { enabled: true, binaryPath: fake.binaryPath },
        { home, http: billing(() => new Response("down", { status: 503 })) },
      );

      expect(snapshot.status).toBe("ready");
      expect(snapshot.usageLimits?.unavailable?.reason).toBe("probeFailed");
    }).pipe(Effect.scoped),
  );
});
