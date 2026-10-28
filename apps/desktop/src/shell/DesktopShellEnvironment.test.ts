// @effect-diagnostics nodeBuiltinImport:off -- The process fixture runs real shell commands with isolated config files.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeOS from "node:os";
import { vi } from "vite-plus/test";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopShellEnvironment from "./DesktopShellEnvironment.ts";

vi.mock("node:os", { spy: true });

const textEncoder = new TextEncoder();

function envOutput(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .flatMap(([name, value]) => [
      `__T3CODE_ENV_${name}_START__`,
      value,
      `__T3CODE_ENV_${name}_END__`,
    ])
    .join("\n");
}

function makeProcess(output: string, exitCode = 0): ChildProcessSpawner.ChildProcessHandle {
  const stdout = output.length === 0 ? Stream.empty : Stream.make(textEncoder.encode(output));
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout,
    stderr: Stream.empty,
    all: stdout,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
}

function withProcessEnv<A, E, R>(
  env: NodeJS.ProcessEnv,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env;
      process.env = env;
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        process.env = previous;
      }),
  );
}

function runShellEnvironment(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly userShell?: string;
  readonly handler: (
    command: ChildProcess.Command,
  ) => string | { output: string; exitCode: number };
  readonly failure?: PlatformError.PlatformError;
  readonly stateDir?: string;
  readonly gate?: Deferred.Deferred<void>;
  readonly after?: (
    shellEnvironment: DesktopShellEnvironment.DesktopShellEnvironment["Service"],
    stateDir: string,
  ) => Effect.Effect<void, never, FileSystem.FileSystem>;
}) {
  const layerSpawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      if (input.failure !== undefined) return Effect.fail(input.failure);
      const result = input.handler(command);
      const handle =
        typeof result === "string"
          ? makeProcess(result)
          : makeProcess(result.output, result.exitCode);
      return input.gate === undefined
        ? Effect.succeed(handle)
        : Deferred.await(input.gate).pipe(Effect.as(handle));
    }),
  );

  const program = (stateDir: string) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const layerEnvironment = Layer.succeed(
        DesktopEnvironment.DesktopEnvironment,
        DesktopEnvironment.DesktopEnvironment.of({
          platform: input.platform,
          stateDir,
          path,
        } as DesktopEnvironment.DesktopEnvironment["Service"]),
      );
      return yield* Effect.gen(function* () {
        const shellEnvironment = yield* DesktopShellEnvironment.DesktopShellEnvironment;
        const prepared = yield* shellEnvironment.installIntoProcess;
        assert.equal(yield* shellEnvironment.installIntoProcess, prepared);
        if (input.after) yield* input.after(shellEnvironment, stateDir);
        return prepared;
      }).pipe(
        Effect.provide(
          DesktopShellEnvironment.layer.pipe(
            Layer.provide(Layer.mergeAll(layerEnvironment, NodeServices.layer, layerSpawner)),
          ),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer));

  // The state directory is made before process.env is swapped: tmpdir() reads it.
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const stateDir = input.stateDir ?? (yield* fileSystem.makeTempDirectoryScoped());
    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        vi.spyOn(NodeOS, "userInfo").mockReturnValue({
          ...NodeOS.userInfo(),
          shell: input.userShell ?? null,
        }),
      ),
      () => withProcessEnv(input.env, program(stateDir)),
      (spy) => Effect.sync(() => spy.mockRestore()),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
}

describe("DesktopShellEnvironment", () => {
  it.effect("rejects PATH output from a failed shell and tries the next candidate", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { SHELL: "/bin/failing", PATH: "/usr/bin" };
      const commands: string[] = [];

      yield* runShellEnvironment({
        env,
        platform: "linux",
        userShell: "/usr/local/bin/fish",
        handler: (command) => {
          if (command._tag !== "StandardCommand") return "";
          commands.push(command.command);
          return command.command === "/bin/failing"
            ? { output: envOutput({ PATH: "/failed/bin" }), exitCode: 7 }
            : envOutput({ PATH: "/home/test/.local/bin:/usr/bin" });
        },
      }).pipe(Effect.provide(Logger.layer([])));

      assert.deepEqual(commands, ["/bin/failing", "/usr/local/bin/fish"]);
      assert.equal(env.PATH, "/home/test/.local/bin:/usr/bin");
    }),
  );

  it.effect("hydrates PATH and missing SSH_AUTH_SOCK from the login shell on macOS", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/Users/test/.local/bin:/usr/bin",
      };
      const commands: ChildProcess.Command[] = [];

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: (command) => {
          commands.push(command);
          return envOutput({
            PATH: "/opt/homebrew/bin:/usr/bin",
            SSH_AUTH_SOCK: "/tmp/secretive.sock",
            HOMEBREW_PREFIX: "/opt/homebrew",
          });
        },
      });

      assert.equal(commands.length, 1);
      assert.equal(commands[0]?._tag === "StandardCommand" ? commands[0].command : "", "/bin/zsh");
      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin:/Users/test/.local/bin");
      assert.equal(env.SSH_AUTH_SOCK, "/tmp/secretive.sock");
      assert.equal(env.HOMEBREW_PREFIX, "/opt/homebrew");
    }),
  );

  it.effect("does not mix login-shell locale categories into an inherited locale", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        LANG: "en_US.UTF-8",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: () =>
          envOutput({
            PATH: "/opt/homebrew/bin:/usr/bin",
            LC_ALL: "de_DE.UTF-8",
          }),
      });

      assert.equal(env.LANG, "en_US.UTF-8");
      assert.equal(env.LC_ALL, undefined);
    }),
  );

  it.effect("falls back to a UTF-8 LC_CTYPE when no locale is available on macOS", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: () => envOutput({ PATH: "/opt/homebrew/bin:/usr/bin" }),
      });

      assert.equal(env.LANG, undefined);
      assert.equal(env.LC_ALL, undefined);
      assert.equal(env.LC_CTYPE, "en_US.UTF-8");
    }),
  );

  it.effect("hydrates missing CA trust variables from the login shell", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        SSL_CERT_DIR: "/etc/ssl/certs",
      };

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: () =>
          envOutput({
            PATH: "/opt/zerobrew/bin:/usr/bin",
            SSL_CERT_FILE: "/opt/zerobrew/etc/ca-certificates/cacert.pem",
            SSL_CERT_DIR: "/opt/zerobrew/etc/ca-certificates",
            NODE_EXTRA_CA_CERTS: "/Users/me/corp-root.pem",
          }),
      });

      assert.equal(env.SSL_CERT_FILE, "/opt/zerobrew/etc/ca-certificates/cacert.pem");
      assert.equal(env.SSL_CERT_DIR, "/etc/ssl/certs");
      assert.equal(env.NODE_EXTRA_CA_CERTS, "/Users/me/corp-root.pem");
    }),
  );

  it.effect("keeps mise's PATH record with the login shell PATH", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/bash",
        PATH: "/usr/bin",
      };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        handler: () =>
          envOutput({
            PATH: "/home/me/.local/bin:/mise/installs/claude/latest:/mise/shims",
            __MISE_DIFF: "mise-diff",
          }),
      });

      assert.equal(env.__MISE_DIFF, "mise-diff");
    }),
  );

  it.effect("falls back to launchctl PATH on macOS when shell probing does not return one", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/opt/homebrew/bin/nu",
        PATH: "/usr/bin",
      };
      const commands: string[] = [];

      yield* runShellEnvironment({
        env,
        platform: "darwin",
        handler: (command) => {
          if (command._tag !== "StandardCommand") return "";
          commands.push(command.command);
          return command.command === "/bin/launchctl" ? "/opt/homebrew/bin:/usr/bin" : "";
        },
      });

      assert.deepEqual(commands, ["/opt/homebrew/bin/nu", "/bin/zsh", "/bin/launchctl"]);
      assert.equal(env.PATH, "/opt/homebrew/bin:/usr/bin");
    }),
  );

  describe("on Windows", () => {
    const windowsEnv = (): NodeJS.ProcessEnv => ({
      PATH: "C:\\Windows\\System32",
      APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\testuser\\AppData\\Local",
      USERPROFILE: "C:\\Users\\testuser",
    });
    const knownDirs = [
      "C:\\Users\\testuser\\AppData\\Roaming\\npm",
      "C:\\Users\\testuser\\AppData\\Local\\Programs\\nodejs",
      "C:\\Users\\testuser\\AppData\\Local\\Volta\\bin",
      "C:\\Users\\testuser\\AppData\\Local\\pnpm",
      "C:\\Users\\testuser\\.local\\bin",
      "C:\\Users\\testuser\\.bun\\bin",
      "C:\\Users\\testuser\\scoop\\shims",
    ];
    const cachedProfile = envOutput({
      PATH: "C:\\Cached\\Node;C:\\Windows\\System32",
      FNM_DIR: "C:\\Cached\\fnm",
    });
    const readCache = (stateDir: string) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        return JSON.parse(yield* fileSystem.readFileString(`${stateDir}/shell-environment.json`));
      });

    it.effect("loads PowerShell profile environment and caches it", () =>
      Effect.gen(function* () {
        const env = windowsEnv();
        const commands: string[] = [];

        const prepared = yield* runShellEnvironment({
          env,
          platform: "win32",
          handler: (command) => {
            if (command._tag !== "StandardCommand") return "";
            commands.push(command.command);
            return envOutput({
              PATH: 'C:\\Profile\\Node;C:";C:\\Windows\\System32',
              FNM_DIR: "C:\\Users\\testuser\\AppData\\Roaming\\fnm",
              FNM_MULTISHELL_PATH: "C:\\Users\\testuser\\AppData\\Local\\fnm_multishells\\123",
            });
          },
          after: (_shellEnvironment, stateDir) =>
            readCache(stateDir).pipe(
              Effect.map((cache) => {
                assert.equal(cache.version, 1);
                assert.equal(cache.environment.PATH, 'C:\\Profile\\Node;C:";C:\\Windows\\System32');
                assert.equal(
                  cache.environment.FNM_DIR,
                  "C:\\Users\\testuser\\AppData\\Roaming\\fnm",
                );
              }),
              Effect.orDie,
            ),
        });

        assert.isTrue(prepared);
        // One PowerShell process: the -NoProfile probe only repeated the inherited PATH.
        assert.deepEqual(commands, ["powershell.exe"]);
        assert.equal(
          env.PATH,
          ["C:\\Profile\\Node", "C:", "C:\\Windows\\System32", ...knownDirs].join(";"),
        );
        assert.equal(env.FNM_DIR, "C:\\Users\\testuser\\AppData\\Roaming\\fnm");
        assert.equal(
          env.FNM_MULTISHELL_PATH,
          "C:\\Users\\testuser\\AppData\\Local\\fnm_multishells\\123",
        );
      }),
    );

    it.effect(
      "leaves Windows preparation incomplete and uncached when the profile probe fails",
      () =>
        Effect.gen(function* () {
          const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };
          let calls = 0;
          const prepared = yield* runShellEnvironment({
            env,
            platform: "win32",
            handler: () => {
              calls++;
              return { output: "", exitCode: 1 };
            },
            after: (_shellEnvironment, stateDir) =>
              Effect.gen(function* () {
                const fileSystem = yield* FileSystem.FileSystem;
                assert.isFalse(
                  yield* fileSystem.exists(`${stateDir}/shell-environment.json`).pipe(Effect.orDie),
                );
              }),
          }).pipe(Effect.provide(Logger.layer([])));
          assert.isFalse(prepared);
          assert.equal(calls, 1);
          assert.equal(env.PATH, "C:\\Windows\\System32");
        }),
    );

    it.effect("replaces a Path-spelled Windows PATH instead of adding a second key", () =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { Path: "C:\\Windows\\System32" };

        yield* runShellEnvironment({
          env,
          platform: "win32",
          handler: () => envOutput({ PATH: "C:\\Shell\\Bin" }),
        });

        assert.deepEqual(env, { PATH: "C:\\Shell\\Bin;C:\\Windows\\System32" });
      }),
    );

    it.effect("tries pwsh.exe only when it is on PATH", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const pwshDir = yield* fileSystem.makeTempDirectoryScoped();
        yield* fileSystem.writeFileString(path.join(pwshDir, "pwsh.exe"), "");

        const withoutPwsh: string[] = [];
        yield* runShellEnvironment({
          env: windowsEnv(),
          platform: "win32",
          handler: (command) => {
            if (command._tag === "StandardCommand") withoutPwsh.push(command.command);
            return envOutput({ PATH: "C:\\Profile" });
          },
        });
        assert.deepEqual(withoutPwsh, ["powershell.exe"]);

        const withPwsh: string[] = [];
        yield* runShellEnvironment({
          env: { ...windowsEnv(), PATH: `${pwshDir};C:\\Windows\\System32` },
          platform: "win32",
          handler: (command) => {
            if (command._tag !== "StandardCommand") return "";
            withPwsh.push(command.command);
            return command.command === "pwsh.exe" ? "" : envOutput({ PATH: "C:\\Profile" });
          },
        });
        assert.deepEqual(withPwsh, ["pwsh.exe", "powershell.exe"]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

    it.effect(
      "applies the cached environment without waiting for the profile, then refreshes it",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const stateDir = yield* fileSystem.makeTempDirectoryScoped();
          yield* runShellEnvironment({
            env: windowsEnv(),
            platform: "win32",
            stateDir,
            handler: () => cachedProfile,
          });

          const gate = yield* Deferred.make<void>();
          const commands: string[] = [];
          const env = windowsEnv();
          const pathBeforeRefresh: string[] = [];
          const prepared = yield* runShellEnvironment({
            env,
            platform: "win32",
            stateDir,
            gate,
            handler: (command) => {
              if (command._tag === "StandardCommand") commands.push(command.command);
              return envOutput({ PATH: "C:\\Fresh\\Tools;C:\\Windows\\System32" });
            },
            after: (shellEnvironment) =>
              Effect.gen(function* () {
                // The probe is still blocked: only the cache can have shaped PATH so far.
                pathBeforeRefresh.push(env.PATH ?? "");
                yield* Deferred.succeed(gate, undefined);
                yield* shellEnvironment.backgroundRefresh;
              }),
          });

          assert.isTrue(prepared);
          assert.equal(
            pathBeforeRefresh[0],
            ["C:\\Cached\\Node", "C:\\Windows\\System32", ...knownDirs].join(";"),
          );
          assert.equal(env.FNM_DIR, "C:\\Cached\\fnm");
          assert.deepEqual(commands, ["powershell.exe"]);
          assert.equal(
            env.PATH,
            ["C:\\Fresh\\Tools", "C:\\Windows\\System32", ...knownDirs, "C:\\Cached\\Node"].join(
              ";",
            ),
          );
          const cache = JSON.parse(
            yield* fileSystem.readFileString(`${stateDir}/shell-environment.json`),
          );
          assert.equal(cache.environment.PATH, "C:\\Fresh\\Tools;C:\\Windows\\System32");
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

    it.effect("keeps the cache when the background refresh finds nothing", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const stateDir = yield* fileSystem.makeTempDirectoryScoped();
        yield* runShellEnvironment({
          env: windowsEnv(),
          platform: "win32",
          stateDir,
          handler: () => cachedProfile,
        });
        const before = yield* fileSystem.readFileString(`${stateDir}/shell-environment.json`);

        const env = windowsEnv();
        const prepared = yield* runShellEnvironment({
          env,
          platform: "win32",
          stateDir,
          handler: () => ({ output: "", exitCode: 1 }),
          after: (shellEnvironment) => shellEnvironment.backgroundRefresh,
        }).pipe(Effect.provide(Logger.layer([])));

        assert.isTrue(prepared);
        assert.include(env.PATH ?? "", "C:\\Cached\\Node");
        assert.equal(
          yield* fileSystem.readFileString(`${stateDir}/shell-environment.json`),
          before,
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

    it.effect("probes synchronously when the cache is unreadable", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const stateDir = yield* fileSystem.makeTempDirectoryScoped();
        yield* fileSystem.writeFileString(`${stateDir}/shell-environment.json`, "{not json");

        const env = windowsEnv();
        const prepared = yield* runShellEnvironment({
          env,
          platform: "win32",
          stateDir,
          handler: () => envOutput({ PATH: "C:\\Profile\\Node" }),
        });

        assert.isTrue(prepared);
        assert.include(env.PATH ?? "", "C:\\Profile\\Node");
        const cache = JSON.parse(
          yield* fileSystem.readFileString(`${stateDir}/shell-environment.json`),
        );
        assert.equal(cache.environment.PATH, "C:\\Profile\\Node");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  });

  it.effect("prefers login-shell desktop session hints over inherited values on linux", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        SHELL: "/bin/zsh",
        PATH: "/usr/bin",
        XDG_CURRENT_DESKTOP: "wrong-launcher",
        XDG_SESSION_DESKTOP: "wrong-launcher",
      };

      yield* runShellEnvironment({
        env,
        platform: "linux",
        handler: () =>
          envOutput({
            PATH: "/home/linuxbrew/.linuxbrew/bin:/usr/bin",
            XDG_CURRENT_DESKTOP: "KDE",
            XDG_SESSION_DESKTOP: "KDE",
            XDG_SESSION_TYPE: "wayland",
          }),
      });

      assert.equal(env.XDG_CURRENT_DESKTOP, "KDE");
      assert.equal(env.XDG_SESSION_DESKTOP, "KDE");
      assert.equal(env.XDG_SESSION_TYPE, "wayland");
    }),
  );
});
