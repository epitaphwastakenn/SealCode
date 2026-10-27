import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/process";
import { beforeEach, vi } from "vite-plus/test";

import {
  decodeWindowsWrappedKey,
  resolveChromiumKeys,
  unwrapWindowsDpapiKey,
} from "./ChromiumKeys.ts";

const { getPassword } = vi.hoisted(() => ({ getPassword: vi.fn<() => string | null>() }));

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    getPassword = getPassword;
  },
}));

beforeEach(() => {
  getPassword.mockReset();
});

type CapturedCommand = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly options: {
    readonly stdin?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
  };
};

const layerHelper = (input: {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly stdoutStream?: Stream.Stream<Uint8Array>;
  readonly stderrStream?: Stream.Stream<Uint8Array>;
  readonly exitCode?: number;
  readonly spawnError?: PlatformError.PlatformError;
  readonly capture?: (command: CapturedCommand) => void;
}) =>
  Layer.mergeAll(
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) =>
        input.spawnError
          ? Effect.fail(input.spawnError)
          : Effect.succeed(
              ChildProcessSpawner.makeHandle({
                pid: ChildProcessSpawner.ProcessId(1),
                exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(input.exitCode ?? 0)),
                isRunning: Effect.succeed(false),
                kill: () => Effect.void,
                unref: Effect.succeed(Effect.void),
                stdin: Sink.drain,
                stdout: input.stdoutStream ?? Stream.encodeText(Stream.make(input.stdout ?? "")),
                stderr: input.stderrStream ?? Stream.encodeText(Stream.make(input.stderr ?? "")),
                all: Stream.empty,
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
              }),
            ).pipe(
              Effect.tap(() => Effect.sync(() => input.capture?.(command as CapturedCommand))),
            ),
      ),
    ),
  );

describe("macOS Chromium secrets", () => {
  const request = {
    platform: "darwin",
    keychainService: "Chrome Safe Storage",
    keychainAccount: "Chrome",
  } as const;
  const layerNoProcesses = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("must not spawn")),
  );

  it.effect("derives the cookie key from the keychain secret", () =>
    Effect.gen(function* () {
      getPassword.mockReturnValue("macos-secret");
      const keys = yield* resolveChromiumKeys(request);
      expect(keys.cbcV10?.toString("hex")).toBe("3df7306fb1eac353289565a2f6b64f74");
    }).pipe(Effect.provide(layerNoProcesses)),
  );

  it.effect("preserves a denied keychain approval", () =>
    Effect.gen(function* () {
      const denied = new Error("User denied access");
      getPassword.mockImplementation(() => {
        throw denied;
      });
      const error = yield* resolveChromiumKeys(request).pipe(Effect.flip);
      expect(error.reason).toBe("needsKeychainApproval");
      expect(error.cause).toBe(denied);
    }).pipe(Effect.provide(layerNoProcesses)),
  );
});

describe("Windows Chromium secrets", () => {
  it.effect("accepts only DPAPI-wrapped non-app-bound keys", () =>
    Effect.gen(function* () {
      const wrapped = Buffer.from("wrapped-key");
      const encoded = Buffer.concat([Buffer.from("DPAPI"), wrapped]).toString("base64");
      const localState = `{"os_crypt":{"encrypted_key":"${encoded}"}}`;
      expect(yield* decodeWindowsWrappedKey(localState)).toEqual(wrapped);

      const appBound = yield* decodeWindowsWrappedKey(
        `{"os_crypt":{"encrypted_key":"${encoded}","app_bound_encrypted_key":"present"}}`,
      ).pipe(Effect.flip);
      expect(appBound.reason).toBe("unsupportedPlatform");

      const malformed = yield* decodeWindowsWrappedKey(
        `{"os_crypt":{"encrypted_key":"${wrapped.toString("base64")}"}}`,
      ).pipe(Effect.flip);
      expect(malformed.reason).toBe("readFailed");
    }),
  );

  it.effect("unwraps the binary key through PowerShell without placing it in argv", () => {
    let captured: CapturedCommand | undefined;
    const wrapped = Buffer.from("wrapped-key");
    const key = Buffer.from("0123456789abcdef0123456789abcdef");
    return Effect.gen(function* () {
      expect(yield* unwrapWindowsDpapiKey(wrapped)).toEqual(key);
      expect(captured?.command).toBe(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      );
      expect(captured?.args).toContain("-NonInteractive");
      expect(captured?.args.join(" ")).not.toContain(wrapped.toString("base64"));
    }).pipe(
      Effect.provide(
        layerHelper({ stdout: key.toString("base64"), capture: (value) => (captured = value) }),
      ),
      Effect.provideService(HostProcess.Environment, { SystemRoot: "C:\\Windows" }),
    );
  });
});
