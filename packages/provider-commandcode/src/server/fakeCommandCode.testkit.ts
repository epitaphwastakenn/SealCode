// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - synchronous fixture writer shared by status and adapter tests.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

export interface FakeCommandCodeRun {
  /** Written to stdout, one JSON line each. */
  readonly frames?: ReadonlyArray<unknown>;
  readonly stderr?: string;
  readonly exitCode?: number;
  /** Stay alive after the frames, as a turn does while the model works. */
  readonly hang?: boolean;
}

export interface FakeCommandCodeOptions {
  /** The n-th print-mode invocation plays the n-th run; the last one repeats. */
  readonly runs?: ReadonlyArray<FakeCommandCodeRun>;
  readonly version?: string;
  readonly versionExitCode?: number;
  readonly modelList?: string;
}

export interface FakeCommandCodeInvocation {
  readonly args: ReadonlyArray<string>;
  readonly stdin: string;
}

const SOURCE = `
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const config = JSON.parse(readFileSync(process.env.FAKE_CONFIG, "utf8"));
if (args.includes("--version") || args.includes("--list-models")) {
  appendFileSync(process.env.FAKE_PROBE_LOG, args.filter((arg) => arg !== "--no-auto-update").join(" ") + "\\n");
}
if (args.includes("--version")) {
  process.stdout.write(config.version + "\\n");
  process.exitCode = config.versionExitCode;
} else if (args.includes("--list-models")) {
  process.stdout.write(config.modelList);
} else {
  let stdin = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) stdin += chunk;
  const log = process.env.FAKE_LOG;
  const previous = existsSync(log) ? readFileSync(log, "utf8").split("\\n").filter(Boolean).length : 0;
  appendFileSync(log, JSON.stringify({ args, stdin }) + "\\n");
  const run = config.runs[Math.min(previous, config.runs.length - 1)];
  for (const frame of run.frames ?? []) process.stdout.write(JSON.stringify(frame) + "\\n");
  if (run.stderr) process.stderr.write(run.stderr);
  process.exitCode = run.exitCode ?? 0;
  if (run.hang) setInterval(() => {}, 1000);
}
`;

/** A `commandcode` launcher in a scoped temp directory, with a log of what it was run with. */
export const makeFakeCommandCode = Effect.fn("makeFakeCommandCode")(function* (
  options: FakeCommandCodeOptions = {},
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "commandcode-fake-" });
  const configPath = NodePath.join(directory, "config.json");
  const logPath = NodePath.join(directory, "invocations.jsonl");
  const probeLogPath = NodePath.join(directory, "probes.log");
  NodeFS.writeFileSync(
    configPath,
    JSON.stringify({
      runs: options.runs ?? [{}],
      version: options.version ?? "1.17.0",
      versionExitCode: options.versionExitCode ?? 0,
      modelList: options.modelList ?? "",
    }),
    "utf8",
  );
  const binaryPath = writeFakeCli({
    directory,
    name: "commandcode",
    source: SOURCE,
    env: { FAKE_CONFIG: configPath, FAKE_LOG: logPath, FAKE_PROBE_LOG: probeLogPath },
  });
  const invocations = Effect.sync((): ReadonlyArray<FakeCommandCodeInvocation> => {
    if (!NodeFS.existsSync(logPath)) return [];
    return NodeFS.readFileSync(logPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as FakeCommandCodeInvocation);
  });
  /** Status probes (`--version`, `--list-models`), which `invocations` leaves out. */
  const probes = Effect.sync((): ReadonlyArray<string> => {
    if (!NodeFS.existsSync(probeLogPath)) return [];
    return NodeFS.readFileSync(probeLogPath, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
  });
  return { directory, binaryPath, invocations, probes };
});
