import {
  buildEnvironmentCaptureCommand,
  listLoginShellCandidates,
  setWindowsPath,
} from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

type EnvironmentPatch = Record<string, string>;

interface ShellEnvironmentConfig {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly path: Path.Path;
  readonly windowsCache: { readonly directory: string; readonly path: string };
  readonly runInBackground: (effect: Effect.Effect<void>) => Effect.Effect<void>;
}

const DesktopShellEnvironmentProbe = Schema.Literals([
  "login-shell",
  "launchctl-path",
  "powershell-profile",
]);
type DesktopShellEnvironmentProbe = typeof DesktopShellEnvironmentProbe.Type;

const desktopShellEnvironmentCommandFields = {
  probe: DesktopShellEnvironmentProbe,
  executable: Schema.String,
  argumentCount: Schema.Number,
};

export class DesktopShellEnvironmentCommandError extends Schema.TaggedError<DesktopShellEnvironmentCommandError>()(
  "DesktopShellEnvironmentCommandError",
  {
    ...desktopShellEnvironmentCommandFields,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop shell environment ${this.probe} probe (${this.executable}) failed.`;
  }
}

export class DesktopShellEnvironmentCommandTimeoutError extends Schema.TaggedError<DesktopShellEnvironmentCommandTimeoutError>()(
  "DesktopShellEnvironmentCommandTimeoutError",
  {
    ...desktopShellEnvironmentCommandFields,
    timeoutMs: Schema.Number,
  },
) {
  override get message(): string {
    return `Desktop shell environment ${this.probe} probe (${this.executable}) timed out after ${this.timeoutMs}ms.`;
  }
}

export class DesktopShellEnvironment extends Context.Service<
  DesktopShellEnvironment,
  {
    // Reuses the installation result; false leaves server hydration enabled.
    readonly installIntoProcess: Effect.Effect<boolean>;
    // Completes once the profile probe that follows a cached install has finished.
    readonly backgroundRefresh: Effect.Effect<void>;
  }
>()("@t3tools/desktop/shell/DesktopShellEnvironment") {}

const LOGIN_SHELL_ENV_NAMES = [
  "PATH",
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SSH_AUTH_SOCK",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "XDG_CONFIG_HOME",
  "XDG_CURRENT_DESKTOP",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_DESKTOP",
  "XDG_SESSION_TYPE",
  "WAYLAND_DISPLAY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "__MISE_DIFF",
] as const;
const WINDOWS_PROFILE_ENV_NAMES = ["PATH", "FNM_DIR", "FNM_MULTISHELL_PATH"] as const;
const WINDOWS_SHELL_CACHE_FILE = "shell-environment.json";
const WindowsShellCache = Schema.Struct({
  version: Schema.Literal(1),
  environment: Schema.Record(Schema.String, Schema.String),
});
const decodeWindowsShellCache = Schema.decodeUnknownOption(
  Schema.fromJsonString(WindowsShellCache),
);
const encodeWindowsShellCache = Schema.encodeSync(Schema.fromJsonString(WindowsShellCache));
const LOCALE_ENV_NAMES = ["LANG", "LC_ALL", "LC_CTYPE"] as const;
const FALLBACK_LC_CTYPE = "en_US.UTF-8";
const WINDOWS_SHELL_CANDIDATES = ["pwsh.exe", "powershell.exe"] as const;
const OPTIONAL_WINDOWS_SHELLS: ReadonlySet<string> = new Set(["pwsh.exe"]);
const LOGIN_SHELL_TIMEOUT = Duration.seconds(5);
const LAUNCHCTL_TIMEOUT = Duration.seconds(2);
const PROCESS_TERMINATE_GRACE = Duration.seconds(1);

const trimNonEmpty = (value: string | null | undefined): Option.Option<string> =>
  Option.fromNullishOr(value).pipe(
    Option.map((entry) => entry.trim()),
    Option.filter((entry) => entry.length > 0),
  );

const pathDelimiter = (platform: NodeJS.Platform) => (platform === "win32" ? ";" : ":");

const readEnvPath = (env: NodeJS.ProcessEnv): Option.Option<string> =>
  trimNonEmpty(env.PATH ?? env.Path ?? env.path);

const normalizeRuntimeDir = (value: string): string => value.replace(/\/+$/u, "");

const linuxRuntimeDirCandidates = (
  env: NodeJS.ProcessEnv,
  uid: number | undefined,
): ReadonlyArray<string> => {
  const candidates: string[] = [];
  const fromEnv = trimNonEmpty(env.XDG_RUNTIME_DIR);
  if (Option.isSome(fromEnv)) {
    candidates.push(normalizeRuntimeDir(fromEnv.value));
  }
  if (uid !== undefined) {
    candidates.push(`/run/user/${uid}`);
  }
  return candidates.filter((candidate) => candidate.length > 0);
};

const pathComparisonKey = (entry: string, platform: NodeJS.Platform) => {
  const normalized = entry.trim().replace(/^"+|"+$/g, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
};

const sanitizePathEntry = (entry: string, platform: NodeJS.Platform) =>
  platform === "win32" ? entry.replaceAll('"', "") : entry;

const mergePaths = (
  platform: NodeJS.Platform,
  values: ReadonlyArray<Option.Option<string>>,
): Option.Option<string> => {
  const delimiter = pathDelimiter(platform);
  const entries: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (Option.isNone(value)) continue;

    for (const entry of value.value.split(delimiter)) {
      const sanitized = sanitizePathEntry(entry.trim(), platform);
      if (sanitized.length === 0) continue;

      const key = pathComparisonKey(sanitized, platform);
      if (key.length === 0 || seen.has(key)) continue;

      seen.add(key);
      entries.push(sanitized);
    }
  }

  return entries.length > 0 ? Option.some(entries.join(delimiter)) : Option.none();
};

const knownWindowsCliDirs = (env: NodeJS.ProcessEnv): ReadonlyArray<string> => [
  ...trimNonEmpty(env.APPDATA).pipe(
    Option.match({
      onNone: () => [],
      onSome: (value) => [`${value}\\npm`],
    }),
  ),
  ...trimNonEmpty(env.LOCALAPPDATA).pipe(
    Option.match({
      onNone: () => [],
      onSome: (value) => [`${value}\\Programs\\nodejs`, `${value}\\Volta\\bin`, `${value}\\pnpm`],
    }),
  ),
  ...trimNonEmpty(env.USERPROFILE).pipe(
    Option.match({
      onNone: () => [],
      onSome: (value) => [`${value}\\.local\\bin`, `${value}\\.bun\\bin`, `${value}\\scoop\\shims`],
    }),
  ),
];

const startMarker = (name: string) => `__T3CODE_ENV_${name}_START__`;
const endMarker = (name: string) => `__T3CODE_ENV_${name}_END__`;

const executableName = (command: string): string => command.split(/[\\/]/u).at(-1) ?? command;

const logShellEnvironmentCommandError = (
  error: DesktopShellEnvironmentCommandError | DesktopShellEnvironmentCommandTimeoutError,
) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      component: "desktop-shell-environment",
      error,
    }),
  );

const captureWindowsEnvironmentCommand = (names: ReadonlyArray<string>) =>
  [
    "$ErrorActionPreference = 'Stop'",
    ...names.flatMap((name) => {
      return [
        `Write-Output '${startMarker(name)}'`,
        `$value = [Environment]::GetEnvironmentVariable('${name}')`,
        "if ($null -ne $value -and $value.Length -gt 0) { Write-Output $value }",
        `Write-Output '${endMarker(name)}'`,
      ];
    }),
  ].join("; ");

const extractEnvironment = (output: string, names: ReadonlyArray<string>): EnvironmentPatch => {
  const environment: EnvironmentPatch = {};

  for (const name of names) {
    const start = output.indexOf(startMarker(name));
    if (start === -1) continue;

    const valueStart = start + startMarker(name).length;
    const end = output.indexOf(endMarker(name), valueStart);
    if (end === -1) continue;

    const value = output
      .slice(valueStart, end)
      .replace(/^\r?\n/, "")
      .replace(/\r?\n$/, "");
    if (value.length > 0) {
      environment[name] = value;
    }
  }

  return environment;
};

const runCommandOutput = Effect.fn("desktop.shellEnvironment.runCommandOutput")(function* (input: {
  readonly probe: DesktopShellEnvironmentProbe;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly timeout: Duration.Duration;
  readonly shell?: boolean;
}): Effect.fn.Return<string, never, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(input.command, input.args, {
          shell: input.shell ?? false,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          killSignal: "SIGTERM",
          forceKillAfter: PROCESS_TERMINATE_GRACE,
        }),
      );
      return yield* Effect.all([Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode], {
        concurrency: 2,
      });
    }),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopShellEnvironmentCommandError({
          probe: input.probe,
          executable: executableName(input.command),
          argumentCount: input.args.length,
          cause,
        }),
    ),
    Effect.filterOrFail(
      ([, exitCode]) => exitCode === 0,
      ([, exitCode]) =>
        new DesktopShellEnvironmentCommandError({
          probe: input.probe,
          executable: executableName(input.command),
          argumentCount: input.args.length,
          cause: { exitCode },
        }),
    ),
    Effect.map(([stdout]) => stdout),
    Effect.catchTags({
      DesktopShellEnvironmentCommandError: (error) =>
        logShellEnvironmentCommandError(error).pipe(Effect.as("")),
    }),
    Effect.timeoutOption(input.timeout),
  );
  if (Option.isSome(output)) {
    return output.value;
  }

  const error = new DesktopShellEnvironmentCommandTimeoutError({
    probe: input.probe,
    executable: executableName(input.command),
    argumentCount: input.args.length,
    timeoutMs: Duration.toMillis(input.timeout),
  });
  yield* logShellEnvironmentCommandError(error);
  return "";
});

const readLoginShellEnvironment = (
  shell: string,
  names: ReadonlyArray<string>,
): Effect.Effect<EnvironmentPatch, never, ChildProcessSpawner.ChildProcessSpawner> =>
  names.length === 0
    ? Effect.succeed({})
    : runCommandOutput({
        probe: "login-shell",
        command: shell,
        args: ["-ilc", buildEnvironmentCaptureCommand(shell, names)],
        timeout: LOGIN_SHELL_TIMEOUT,
      }).pipe(Effect.map((output) => extractEnvironment(output, names)));

const readLaunchctlPath = runCommandOutput({
  probe: "launchctl-path",
  command: "/bin/launchctl",
  args: ["getenv", "PATH"],
  timeout: LAUNCHCTL_TIMEOUT,
}).pipe(Effect.map(trimNonEmpty));

// Only an install that is positively absent is skipped; an unreadable entry still gets a try.
const isOnPath = Effect.fn("desktop.shellEnvironment.isOnPath")(function* (
  name: string,
  config: Pick<ShellEnvironmentConfig, "env" | "path">,
): Effect.fn.Return<boolean, never, FileSystem.FileSystem> {
  const fileSystem = yield* FileSystem.FileSystem;
  for (const entry of readEnvPath(config.env).pipe(
    Option.map((value) => value.split(";")),
    Option.getOrElse(() => [] as string[]),
  )) {
    const directory = sanitizePathEntry(entry.trim(), "win32");
    if (directory.length === 0) continue;
    if (
      yield* fileSystem
        .exists(config.path.join(directory, name))
        .pipe(Effect.orElseSucceed(() => true))
    ) {
      return true;
    }
  }
  return false;
});

const readWindowsProfileEnvironment = Effect.fn(
  "desktop.shellEnvironment.readWindowsProfileEnvironment",
)(function* (
  config: Pick<ShellEnvironmentConfig, "env" | "path">,
): Effect.fn.Return<
  EnvironmentPatch,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> {
  const args = [
    "-NoLogo",
    "-NonInteractive",
    "-Command",
    captureWindowsEnvironmentCommand(WINDOWS_PROFILE_ENV_NAMES),
  ];

  for (const command of WINDOWS_SHELL_CANDIDATES) {
    if (OPTIONAL_WINDOWS_SHELLS.has(command) && !(yield* isOnPath(command, config))) continue;
    const output = yield* runCommandOutput({
      probe: "powershell-profile",
      command,
      args,
      timeout: LOGIN_SHELL_TIMEOUT,
    });
    const environment = extractEnvironment(output, WINDOWS_PROFILE_ENV_NAMES);
    if (Object.keys(environment).length > 0) {
      return environment;
    }
  }

  return {};
});

const applyWindowsProfileEnvironment = (
  env: NodeJS.ProcessEnv,
  profile: EnvironmentPatch,
): void => {
  const mergedPath = mergePaths("win32", [
    trimNonEmpty(profile.PATH),
    trimNonEmpty(knownWindowsCliDirs(env).join(";")),
    readEnvPath(env),
  ]);

  if (Option.isSome(mergedPath)) {
    setWindowsPath(env, mergedPath.value);
  }
  if (!env.FNM_DIR && profile.FNM_DIR) {
    env.FNM_DIR = profile.FNM_DIR;
  }
  if (!env.FNM_MULTISHELL_PATH && profile.FNM_MULTISHELL_PATH) {
    env.FNM_MULTISHELL_PATH = profile.FNM_MULTISHELL_PATH;
  }
};

const readWindowsShellCache = Effect.fn("desktop.shellEnvironment.readWindowsShellCache")(
  function* (
    cachePath: string,
  ): Effect.fn.Return<Option.Option<EnvironmentPatch>, never, FileSystem.FileSystem> {
    const fileSystem = yield* FileSystem.FileSystem;
    const contents = yield* fileSystem
      .readFileString(cachePath)
      .pipe(Effect.orElseSucceed(() => ""));
    return decodeWindowsShellCache(contents).pipe(
      Option.map(({ environment }) => {
        const profile: EnvironmentPatch = {};
        for (const name of WINDOWS_PROFILE_ENV_NAMES) {
          const value = environment[name];
          if (value !== undefined && value.length > 0) profile[name] = value;
        }
        return profile;
      }),
      Option.filter((profile) => profile.PATH !== undefined),
    );
  },
);

const writeWindowsShellCache = Effect.fn("desktop.shellEnvironment.writeWindowsShellCache")(
  function* (
    cache: ShellEnvironmentConfig["windowsCache"],
    profile: EnvironmentPatch,
  ): Effect.fn.Return<void, never, FileSystem.FileSystem> {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(cache.directory, { recursive: true }).pipe(
      Effect.andThen(
        fileSystem.writeFileString(
          cache.path,
          encodeWindowsShellCache({ version: 1, environment: profile }),
        ),
      ),
      Effect.catch((error) =>
        Effect.logWarning("Could not cache the PowerShell profile environment.", error),
      ),
    );
  },
);

// A cached environment is applied immediately and the profile is probed again in the background: a slow profile must not hold the launch.
const installWindowsEnvironment = Effect.fn("desktop.shellEnvironment.installWindowsEnvironment")(
  function* (
    config: ShellEnvironmentConfig,
  ): Effect.fn.Return<
    boolean,
    never,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
  > {
    const fileSystem = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const probe = readWindowsProfileEnvironment(config).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    const cached = yield* readWindowsShellCache(config.windowsCache.path);
    if (Option.isSome(cached)) {
      applyWindowsProfileEnvironment(config.env, cached.value);
      yield* config.runInBackground(
        probe.pipe(
          Effect.flatMap((profile) =>
            profile.PATH === undefined
              ? Effect.void
              : Effect.sync(() => applyWindowsProfileEnvironment(config.env, profile)).pipe(
                  Effect.andThen(writeWindowsShellCache(config.windowsCache, profile)),
                  Effect.provideService(FileSystem.FileSystem, fileSystem),
                ),
          ),
        ),
      );
      return true;
    }

    const profile = yield* probe;
    applyWindowsProfileEnvironment(config.env, profile);
    if (profile.PATH === undefined) return false;
    yield* writeWindowsShellCache(config.windowsCache, profile);
    return true;
  },
);

const installPosixEnvironment = Effect.fn("desktop.shellEnvironment.installPosixEnvironment")(
  function* (
    config: ShellEnvironmentConfig,
  ): Effect.fn.Return<
    void,
    never,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
  > {
    const fileSystem = yield* FileSystem.FileSystem;
    const shellEnvironment: EnvironmentPatch = {};

    for (const shell of listLoginShellCandidates(config.platform, config.env.SHELL)) {
      Object.assign(
        shellEnvironment,
        yield* readLoginShellEnvironment(shell, LOGIN_SHELL_ENV_NAMES),
      );
      if (shellEnvironment.PATH) break;
    }

    const launchctlPath =
      config.platform === "darwin" && !shellEnvironment.PATH
        ? yield* readLaunchctlPath
        : Option.none<string>();
    const mergedPath = mergePaths(config.platform, [
      trimNonEmpty(shellEnvironment.PATH).pipe(Option.orElse(() => launchctlPath)),
      readEnvPath(config.env),
    ]);

    if (Option.isSome(mergedPath)) {
      config.env.PATH = mergedPath.value;
    }
    if (!config.env.SSH_AUTH_SOCK && shellEnvironment.SSH_AUTH_SOCK) {
      config.env.SSH_AUTH_SOCK = shellEnvironment.SSH_AUTH_SOCK;
    }

    const shellPreferredEnvNames = [
      "DBUS_SESSION_BUS_ADDRESS",
      "XDG_CURRENT_DESKTOP",
      "XDG_SESSION_DESKTOP",
      "XDG_SESSION_TYPE",
      // Forward mise's PATH delta too, or mise x can rebuild PATH into a recursive same-named wrapper.
      "__MISE_DIFF",
    ] as const;
    for (const name of shellPreferredEnvNames) {
      if (shellEnvironment[name]) {
        config.env[name] = shellEnvironment[name];
      }
    }

    for (const name of [
      "DISPLAY",
      "HOMEBREW_PREFIX",
      "HOMEBREW_CELLAR",
      "HOMEBREW_REPOSITORY",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_RUNTIME_DIR",
      "WAYLAND_DISPLAY",
      // Shell CA settings are required by Node/OpenSSL builds without bundled roots for registry TLS.
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "NODE_EXTRA_CA_CERTS",
    ] as const) {
      if (!config.env[name] && shellEnvironment[name]) {
        config.env[name] = shellEnvironment[name];
      }
    }

    // Hydrate locale variables together; inherited LC_ALL can override LANG or LC_CTYPE.
    if (
      config.platform === "darwin" &&
      LOCALE_ENV_NAMES.every((name) => Option.isNone(trimNonEmpty(config.env[name])))
    ) {
      for (const name of LOCALE_ENV_NAMES) {
        const value = trimNonEmpty(shellEnvironment[name]);
        if (Option.isSome(value)) {
          config.env[name] = value.value;
        }
      }

      // launchd lacks locale; UTF-8 LC_CTYPE fixes pbcopy's MacRoman decoding without changing C formatting or collation.
      if (LOCALE_ENV_NAMES.every((name) => Option.isNone(trimNonEmpty(config.env[name])))) {
        config.env.LC_CTYPE = FALLBACK_LC_CTYPE;
      }
    }

    if (
      config.platform === "linux" &&
      Option.isNone(trimNonEmpty(config.env.DBUS_SESSION_BUS_ADDRESS))
    ) {
      for (const runtimeDir of linuxRuntimeDirCandidates(config.env, process.getuid?.())) {
        const dbusSessionBusPath = `${runtimeDir}/bus`;
        const busExists = yield* fileSystem
          .exists(dbusSessionBusPath)
          .pipe(Effect.orElseSucceed(() => false));
        if (busExists) {
          config.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${dbusSessionBusPath}`;
          break;
        }
      }
    }
  },
);

const installShellEnvironment = (
  config: ShellEnvironmentConfig,
): Effect.Effect<
  boolean,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> => {
  if (config.platform === "win32") {
    return installWindowsEnvironment(config);
  }
  if (config.platform === "darwin" || config.platform === "linux") {
    return installPosixEnvironment(config).pipe(Effect.as(true));
  }
  return Effect.succeed(false);
};

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scope = yield* Scope.Scope;
  const backgroundFiber = yield* Ref.make(Option.none<Fiber.Fiber<void>>());
  const installIntoProcess: DesktopShellEnvironment["Service"]["installIntoProcess"] =
    yield* Effect.cached(
      installShellEnvironment({
        env: process.env,
        platform: environment.platform,
        path: environment.path,
        windowsCache: {
          directory: environment.stateDir,
          path: environment.path.join(environment.stateDir, WINDOWS_SHELL_CACHE_FILE),
        },
        runInBackground: (effect) =>
          Effect.forkIn(effect, scope).pipe(
            Effect.flatMap((fiber) => Ref.set(backgroundFiber, Option.some(fiber))),
          ),
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.withSpan("desktop.shellEnvironment.installIntoProcess"),
      ),
    );

  return DesktopShellEnvironment.of({
    installIntoProcess,
    backgroundRefresh: Ref.get(backgroundFiber).pipe(
      Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: Fiber.join })),
    ),
  });
});

export const layer = Layer.effect(DesktopShellEnvironment, make);
