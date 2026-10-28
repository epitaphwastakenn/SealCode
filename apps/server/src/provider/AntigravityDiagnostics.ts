// @effect-diagnostics nodeBuiltinImport:off - the report streams large files through SHA-256 and reads OS network settings.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeDns from "node:dns";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";

import { sanitizeAcpStderrExcerpt } from "@t3tools/provider-acp/server/stderr";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import packageJson from "../../package.json" with { type: "json" };
import { makeAntigravityAcpRuntime } from "./acp/AntigravityAcpSupport.ts";
import { antigravityNetworkFailure } from "./AntigravityAuth.ts";
import {
  buildAntigravityAcpSpawnInput,
  prepareAntigravityProfile,
} from "./antigravityAuthSupport.ts";
import {
  agentProxyUrl,
  ANTIGRAVITY_GOOGLE_HOSTS,
  formatSkew,
  probeTls,
  resolveHost,
  type TlsResult,
} from "./antigravityNetworkChecks.ts";
import { resolveAntigravityReleaseAsset } from "./antigravityRelease.ts";
import { systemCaCertificates } from "./antigravityTrust.ts";

const AGENT_TEST_TIMEOUT_MS = 150_000;
/** A saved login Google rejects at once: an unknown client and a made-up refresh token. */
const INVALID_LOGIN = `{"client_id":"sealcode-diagnostics.apps.googleusercontent.com","client_secret":"sealcode-diagnostics","refresh_token":"sealcode-diagnostics-invalid-token","token_uri":"https://oauth2.googleapis.com/token","scopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/userinfo.email","https://www.googleapis.com/auth/aicode"]}`;
const OUTPUT_TAIL_CHARS = 12_000;
const NETWORK_VARIABLES = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "GRPC_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
];
const VPN_INTERFACE =
  /vpn|\btap\b|\btun\d*\b|wireguard|\bwg\d+|tailscale|zerotier|openvpn|nord|expressvpn|proton|cisco|anyconnect|fortinet|globalprotect|pangp|warp|cloudflare|hamachi|radmin|wintun/i;

export interface AntigravityInstallationInfo {
  readonly executablePath: string;
  readonly harnessPath: string;
  readonly version: string | null;
  readonly managedVersionDirectory: string | null;
  readonly unpackedDirectory?: string;
}

export interface AntigravityDiagnosticsInput {
  readonly platform: NodeJS.Platform;
  readonly stateDir: string;
  readonly profileDirectory: string;
  /** The environment Harp starts the agent with, so the report mirrors its network path. */
  readonly processEnvironment: NodeJS.ProcessEnv;
  readonly agentEnvironment: NodeJS.ProcessEnv;
  readonly installation: AntigravityInstallationInfo | { readonly error: string };
  /** Raw stderr of recent sign-in attempts, redacted here; only the server has it. */
  readonly recentSignInOutput?: string;
  readonly runAgentTest?: boolean;
}

/** Drops credentials, emails, sign-in links and the home directory from anything quoted. */
export function redactDiagnosticText(text: string, homeDirectory: string): string {
  return sanitizeAcpStderrExcerpt(text, homeDirectory)
    .split(homeDirectory.replaceAll("\\", "/"))
    .join("~")
    .replace(/\b(ya29\.|1\/\/)[\w.-]+/g, "[redacted]")
    .replace(
      /(["']?(?:access_token|refresh_token|id_token|client_secret|api_key|apiKey)["']?\s*[:=]\s*)["']?[^"',\s}]+/gi,
      "$1[redacted]",
    )
    .replace(/\[redacted\]["']/g, "[redacted]")
    .replace(/\bAIza[\w-]{30,}/g, "[redacted]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[credentials]@");
}

const run = (command: string, args: ReadonlyArray<string>) =>
  new Promise<string>((resolve) => {
    NodeChildProcess.execFile(
      command,
      [...args],
      { timeout: 10_000, windowsHide: true, encoding: "utf8" },
      (error, stdout) => resolve(error ? `failed: ${error.message.split("\n")[0]}` : stdout),
    );
  });

const sha256File = (file: string) =>
  new Promise<string>((resolve) => {
    const hash = NodeCrypto.createHash("sha256");
    NodeFS.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .once("error", (error) => resolve(`unreadable (${error.message})`))
      .once("end", () => resolve(hash.digest("hex")));
  });

const fileSummary = async (file: string) => {
  try {
    const stat = await NodeFS.promises.stat(file);
    return { bytes: stat.size, sha256: await sha256File(file) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const readText = (file: string) =>
  NodeFS.promises.readFile(file, "utf8").then(
    (text) => text,
    () => undefined,
  );

const ms = (value: number | undefined) => (value === undefined ? "-" : `${value} ms`);

const describeTls = (result: TlsResult) => {
  if (result.error !== undefined) {
    const done = [
      result.connectMs !== undefined ? `TCP ${ms(result.connectMs)}` : undefined,
      result.tlsMs !== undefined ? `TLS ${ms(result.tlsMs)}` : undefined,
    ].filter(Boolean);
    return `FAILED at ${result.failedAt}: ${result.error}${done.length ? ` (after ${done.join(", ")})` : ""}`;
  }
  return [
    `TCP ${ms(result.connectMs)}`,
    `TLS ${ms(result.tlsMs)}`,
    `HTTP ${result.httpStatus} in ${ms(result.httpMs)}`,
    result.trusted ? "certificate trusted" : `certificate NOT trusted (${result.trustError})`,
    result.interceptedBy === undefined
      ? "issued by Google"
      : `INTERCEPTED: issued by "${result.interceptedBy}"`,
  ].join(", ");
};

const environmentSection = (environment: NodeJS.ProcessEnv, homeDirectory: string) => {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(environment)) {
    if (!NETWORK_VARIABLES.includes(key.toUpperCase())) continue;
    lines.push(`  ${key}=${redactDiagnosticText(value ?? "", homeDirectory)}`);
  }
  return lines.length > 0 ? lines : ["  (none)"];
};

const networkSettingsSection = async (platform: NodeJS.Platform) => {
  const lines: string[] = [];
  const interfaces = Object.entries(NodeOS.networkInterfaces()).flatMap(([name, entries]) => {
    const active = (entries ?? []).filter((entry) => !entry.internal);
    if (active.length === 0) return [];
    const ipv4 = active.some((entry) => entry.family === "IPv4");
    const globalIpv6 = active.some(
      (entry) => entry.family === "IPv6" && !/^(fe80|fc|fd)/i.test(entry.address),
    );
    return [
      `  ${name}: ${
        [ipv4 ? "IPv4" : undefined, globalIpv6 ? "global IPv6" : undefined]
          .filter(Boolean)
          .join(" + ") || "link-local only"
      }${
        /teredo|6to4|isatap/i.test(name)
          ? "  <- IPv6 tunnel, often the broken IPv6 path"
          : VPN_INTERFACE.test(name)
            ? "  <- looks like a VPN"
            : ""
      }`,
    ];
  });
  lines.push("Network adapters (addresses omitted):", ...interfaces);
  lines.push(`DNS servers: ${NodeDns.getServers().join(", ") || "unknown"}`);
  if (platform === "win32") {
    const winhttp = await run("netsh", ["winhttp", "show", "proxy"]);
    lines.push(
      "WinHTTP proxy:",
      ...winhttp
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^Current WinHTTP/i.test(line))
        .map((line) => `  ${line}`),
    );
    const internet = await run("reg", [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
    ]);
    const proxyValues = internet
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) =>
        /^(ProxyEnable|ProxyServer|ProxyOverride|AutoConfigURL|AutoDetect)\s/i.test(line),
      )
      .map((line) => `  ${line.replace(/\s+REG_\w+\s+/, " = ")}`);
    lines.push("Windows (WinINet) proxy:", ...(proxyValues.length ? proxyValues : ["  (not set)"]));
  }
  return lines;
};

const hostSection = async (host: string) => {
  const dns = await resolveHost(host);
  const lines = [
    `${host}`,
    `  DNS IPv4: ${typeof dns.ipv4 === "string" ? `FAILED ${dns.ipv4}` : dns.ipv4.join(", ") || "none"}`,
    `  DNS IPv6: ${typeof dns.ipv6 === "string" ? `FAILED ${dns.ipv6}` : dns.ipv6.join(", ") || "none"}`,
  ];
  const skews: number[] = [];
  const [ipv4, ipv6] = await Promise.all(
    ([4, 6] as const).map(async (family) => {
      const addresses = family === 4 ? dns.ipv4 : dns.ipv6;
      if (typeof addresses === "string" || addresses.length === 0) return "no address";
      const result = await probeTls(host, { address: addresses[0]!, family });
      if (result.clockSkewMs !== undefined) skews.push(result.clockSkewMs);
      return describeTls(result);
    }),
  );
  lines.push(`  IPv4: ${ipv4}`, `  IPv6: ${ipv6}`);
  return { lines, skews };
};

interface AgentTestResult {
  readonly lines: ReadonlyArray<string>;
  readonly output: string;
}

/**
 * Starts the real agent on a throwaway profile whose saved login is invalid. A healthy agent
 * asks Google to refresh it, is told the client is unknown, and shows a sign-in link; a broken
 * network shows up as a transport error or as silence.
 */
const agentTest = Effect.fn("AntigravityDiagnostics.agentTest")(function* (
  input: AntigravityDiagnosticsInput & { readonly installation: AntigravityInstallationInfo },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  // Real elapsed time even under a test clock: this timeline is what the report is for.
  const started = performance.now();
  const timeline: string[] = [];
  const mark = (event: string) => {
    timeline.push(`  ${String(Math.round(performance.now() - started)).padStart(7)} ms  ${event}`);
  };
  let output = "";
  let sawOutput = false;
  const linkShown = yield* Deferred.make<void>();
  const tempRoot = path.join(input.stateDir, "antigravity-tmp");
  yield* fs.makeDirectory(tempRoot, { recursive: true });
  const root = yield* Effect.acquireRelease(
    fs.makeTempDirectory({ directory: tempRoot, prefix: "diag-" }),
    (directory) =>
      fs.remove(directory, { recursive: true, force: true }).pipe(
        // The killed agent can hold its unpacked files for a moment on Windows.
        Effect.retry({ times: 20, schedule: Schedule.spaced("250 millis") }),
        Effect.ignore,
      ),
  );
  const profileDirectory = path.join(root, "p");
  const acpDirectory = path.join(profileDirectory, "antigravity-acp");
  yield* fs.makeDirectory(acpDirectory, { recursive: true });
  yield* fs.writeFileString(path.join(acpDirectory, "acp_token.json"), INVALID_LOGIN);
  const profile = yield* prepareAntigravityProfile({
    profileDirectory,
    baseEnv: input.processEnvironment,
    platform: input.platform,
    userHome: path.join(root, "home"),
    tempDirectory: path.join(root, "t"),
  });
  mark("launching the agent");
  const result = yield* Effect.gen(function* () {
    const runtime = yield* makeAntigravityAcpRuntime({
      childProcessSpawner: spawner,
      cwd: root,
      clientInfo: { name: "t3-code-diagnostics", version: packageJson.version },
      mcpServers: [],
      authMethod: "oauth-personal",
      spawn: buildAntigravityAcpSpawnInput({
        installation: input.installation,
        profile,
        cwd: root,
        baseEnv: input.agentEnvironment,
        runtimeTempDirectory: path.join(root, "t"),
      }),
      onStderrText: (text) => {
        if (!sawOutput) {
          sawOutput = true;
          mark("first output");
        }
        output = `${output}${text}`.slice(-OUTPUT_TAIL_CHARS);
      },
      onInitialized: () => Effect.sync(() => mark("answered initialize")),
      onAuthorizationUrl: () =>
        Effect.sync(() => mark("showed a Google sign-in link")).pipe(
          Effect.andThen(Deferred.succeed(linkShown, undefined)),
          Effect.asVoid,
        ),
    });
    return yield* Effect.raceFirst(
      runtime.start().pipe(Effect.asVoid),
      Deferred.await(linkShown),
    ).pipe(
      Effect.timeoutOrElse({
        duration: AGENT_TEST_TIMEOUT_MS,
        orElse: () => Effect.fail("timeout" as const),
      }),
      Effect.exit,
    );
  }).pipe(Effect.scoped);
  mark("stopped the agent");
  const selfUnpacked = yield* fs.readDirectory(path.join(root, "t")).pipe(
    Effect.map((entries) => entries.some((entry) => entry.startsWith("_MEI"))),
    Effect.orElseSucceed(() => false),
  );
  if (selfUnpacked) mark("(the agent unpacked itself into the temp folder)");
  const reachedGoogle = /invalid_client|RefreshError|OAuth client was not found/i.test(output);
  const lines = [...timeline];
  if (Exit.isSuccess(result)) {
    lines.push(
      reachedGoogle
        ? "  RESULT: OK. The agent reached Google over HTTPS and got the expected rejection."
        : "  RESULT: the agent showed a sign-in link without asking Google first.",
    );
  } else {
    const failure = antigravityNetworkFailure(result.cause);
    const timedOut = Cause.findErrorOption(result.cause);
    lines.push(
      failure !== undefined
        ? `  RESULT: FAILED. The agent could not talk to Google (${failure}).`
        : timedOut._tag === "Some" && timedOut.value === "timeout"
          ? `  RESULT: FAILED. No answer in ${AGENT_TEST_TIMEOUT_MS / 1000} s (${
              timeline.some((line) => line.includes("answered initialize"))
                ? "the agent started but did not finish talking to Google"
                : "the agent never finished starting"
            }).`
          : `  RESULT: FAILED. ${Cause.pretty(result.cause).split("\n")[0]}`,
    );
  }
  return { lines, output } satisfies AgentTestResult;
});

/** A plain-text report a user can send to whoever helps them. It never contains credentials. */
export const runAntigravityDiagnostics = Effect.fn("runAntigravityDiagnostics")(function* (
  input: AntigravityDiagnosticsInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const arch = yield* HostProcess.Architecture;
  const redact = (text: string) => redactDiagnosticText(text, home);
  const report: string[] = [
    "Harp Antigravity diagnostics",
    `Generated: ${DateTime.formatIso(yield* DateTime.now)} (this computer's clock)`,
    "",
    "== Versions ==",
    `Harp: ${packageJson.version}`,
    `System: ${NodeOS.type()} ${NodeOS.release()} ${arch}, Node ${process.versions.node}`,
  ];

  const release = resolveAntigravityReleaseAsset(input.platform, arch);
  if ("error" in input.installation) {
    report.push(`Antigravity runtime: NOT AVAILABLE (${input.installation.error})`);
  } else {
    const installation = input.installation;
    report.push(
      `Antigravity runtime: ${installation.version ?? "unknown version"} at ${redact(
        installation.managedVersionDirectory ?? installation.executablePath,
      )}`,
    );
    report.push(
      installation.unpackedDirectory === undefined
        ? "  launch: unpacks itself into the temp folder on every start"
        : `  launch: unpacked once at ${redact(installation.unpackedDirectory)}`,
    );
    for (const [label, file, expected] of [
      ["agent", installation.executablePath, release?.executable.bytes],
      ["harness", installation.harnessPath, release?.harness.bytes],
    ] as const) {
      const summary = yield* Effect.promise(() => fileSummary(file));
      report.push(
        "error" in summary
          ? `  ${label}: MISSING or unreadable (${redact(summary.error)})`
          : `  ${label}: ${summary.bytes} bytes${
              expected !== undefined && installation.managedVersionDirectory !== null
                ? summary.bytes === expected
                  ? " (matches the pinned release)"
                  : ` (EXPECTED ${expected}: the install is damaged; remove it and install again)`
                : ""
            }, SHA-256 ${summary.sha256}`,
      );
    }
  }
  if (release !== null)
    report.push(`Pinned release: ${release.version}, archive SHA-256 ${release.sha256}`);

  report.push("", "== Antigravity profile ==");
  const acpDirectory = path.join(input.profileDirectory, "antigravity-acp");
  const token = yield* fs.stat(path.join(acpDirectory, "acp_token.json")).pipe(Effect.option);
  report.push(
    `Profile: ${redact(input.profileDirectory)}`,
    `Saved Google login: ${
      token._tag === "Some"
        ? `present (${token.value.size} bytes, modified ${token.value.mtime._tag === "Some" ? token.value.mtime.value.toISOString() : "unknown"})`
        : "none"
    }`,
    `Profile settings: ${redact((yield* Effect.promise(() => readText(path.join(acpDirectory, "settings.json"))))?.trim() ?? "missing")}`,
    `Windows certificate store: ${input.platform === "win32" ? `${systemCaCertificates().length} certificates` : "n/a"}`,
  );
  if (input.platform === "win32") {
    // Leftover agents from a crash keep files under ~/.gemini locked and use memory.
    for (const image of ["agy_acp_server.exe", "localharness_external.exe"]) {
      const listed = yield* Effect.promise(() =>
        run("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"]),
      );
      const count = listed.split(/\r?\n/).filter((line) => line.startsWith(`"${image}"`)).length;
      report.push(`Running ${image}: ${count}`);
    }
  }

  report.push("", "== Proxy and VPN ==", "Environment of Harp:");
  report.push(...environmentSection(input.processEnvironment, home));
  report.push("Environment Harp gives the agent:");
  report.push(...environmentSection(input.agentEnvironment, home));
  report.push(...(yield* Effect.promise(() => networkSettingsSection(input.platform))));

  report.push("", "== Google hosts (direct, per address family) ==");
  const hostResults = yield* Effect.promise(() =>
    Promise.all(ANTIGRAVITY_GOOGLE_HOSTS.map(hostSection)),
  );
  const skews = hostResults.flatMap((result) => result.skews);
  for (const result of hostResults) report.push(...result.lines);

  const proxyUrl = agentProxyUrl(input.agentEnvironment);
  report.push("", "== Through the agent's proxy ==");
  if (proxyUrl === undefined) {
    report.push("  The agent connects directly (no HTTP proxy in its environment).");
  } else {
    report.push(`  Proxy: ${redact(proxyUrl)}`);
    for (const host of ["oauth2.googleapis.com", "cloudcode-pa.googleapis.com"]) {
      const result = yield* Effect.promise(() => probeTls(host, { proxyUrl }));
      if (result.clockSkewMs !== undefined) skews.push(result.clockSkewMs);
      report.push(`  ${host}: ${describeTls(result)}`);
    }
  }

  report.push("", "== Clock ==");
  if (skews.length === 0) {
    report.push("  Could not read Google's time.");
  } else {
    const median = [...skews].sort((left, right) => left - right)[Math.floor(skews.length / 2)]!;
    report.push(
      `  This computer is ${formatSkew(median)}${Math.abs(median) > 5 * 60_000 ? "  <- WRONG CLOCK: breaks HTTPS and Google sign-in" : ""}.`,
    );
  }

  report.push("", "== Agent test ==");
  if (input.runAgentTest === false) {
    report.push("  Skipped.");
  } else if ("error" in input.installation) {
    report.push("  Skipped: the runtime is not available.");
  } else {
    const installation = input.installation;
    const test = yield* agentTest({ ...input, installation }).pipe(
      Effect.scoped,
      Effect.catchCause((cause) =>
        Effect.succeed({
          lines: [`  Could not run the agent: ${redact(Cause.pretty(cause).split("\n")[0] ?? "")}`],
          output: "",
        }),
      ),
    );
    report.push(...test.lines);
    if (test.output.trim()) {
      report.push("  Agent output (last lines):", ...indent(redact(test.output)));
    }
  }

  report.push("", "== Recent sign-in output ==");
  report.push(
    ...(input.recentSignInOutput === undefined
      ? ["  (only in reports made from Harp's settings)"]
      : input.recentSignInOutput.trim()
        ? indent(redact(input.recentSignInOutput))
        : ["  (no sign-in attempt since Harp started)"]),
  );
  return `${report.join("\n")}\n`;
});

const indent = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-80)
    .map((line) => `    ${line.slice(0, 400)}`);
