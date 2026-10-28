import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLegacyLocalStorage from "./DesktopLegacyLocalStorage.ts";

const MARKER_FILE_NAME = "v1-local-storage-imported";
const NOW_MS = 3 * 60 * 60 * 1000;

// A database whose MANIFEST holds no valid records: LevelDB format errors never heal.
const writeMalformedProfile = Effect.fn("writeMalformedProfile")(function* (
  appDataDirectory: string,
  lastWrittenMs: number,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(appDataDirectory, "sealcode", "Local Storage", "leveldb");
  yield* fileSystem.makeDirectory(directory, { recursive: true });
  yield* fileSystem.writeFileString(path.join(directory, "CURRENT"), "MANIFEST-000001\n");
  yield* fileSystem.writeFileString(path.join(directory, "MANIFEST-000001"), "not a log");
  // utimes takes epoch seconds when given numbers.
  const lastWritten = lastWrittenMs / 1000;
  for (const name of ["CURRENT", "MANIFEST-000001"]) {
    yield* fileSystem.utimes(path.join(directory, name), lastWritten, lastWritten);
  }
});

const loadLegacyLocalStorage = Effect.fn("loadLegacyLocalStorage")(function* (
  appDataDirectory: string,
  userDataPath: string,
) {
  const layerEnvironment = Layer.succeed(
    DesktopEnvironment.DesktopEnvironment,
    DesktopEnvironment.DesktopEnvironment.of({
      isDevelopment: false,
      appDataDirectory,
    } as DesktopEnvironment.DesktopEnvironment["Service"]),
  );
  const legacy = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage.pipe(
    Effect.provide(
      DesktopLegacyLocalStorage.layer.pipe(
        Layer.provide(Layer.mergeAll(layerEnvironment, NodeServices.layer)),
      ),
    ),
    Effect.tap((service) => service.load(userDataPath)),
  );
  return yield* legacy.take;
});

const scenario = Effect.fn("scenario")(function* (lastWrittenMs: number) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const appDataDirectory = yield* fileSystem.makeTempDirectoryScoped();
  const userDataPath = yield* fileSystem.makeTempDirectoryScoped();
  yield* TestClock.setTime(NOW_MS);
  yield* writeMalformedProfile(appDataDirectory, lastWrittenMs);
  const taken = yield* loadLegacyLocalStorage(appDataDirectory, userDataPath).pipe(
    Effect.provide(Logger.layer([])),
  );
  const markerWritten = yield* fileSystem.exists(path.join(userDataPath, MARKER_FILE_NAME));
  return { taken, markerWritten } as const;
});

describe("DesktopLegacyLocalStorage", () => {
  it.effect("stops retrying a malformed profile that nothing is writing", () =>
    Effect.gen(function* () {
      const { taken, markerWritten } = yield* scenario(0);
      assert.isTrue(Option.isNone(taken));
      assert.isTrue(markerWritten);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("retries next launch while the profile may still be written", () =>
    Effect.gen(function* () {
      const { taken, markerWritten } = yield* scenario(NOW_MS - 60_000);
      assert.isTrue(Option.isNone(taken));
      assert.isFalse(markerWritten);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("records the import when no V1 profile exists", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const appDataDirectory = yield* fileSystem.makeTempDirectoryScoped();
      const userDataPath = yield* fileSystem.makeTempDirectoryScoped();
      const taken = yield* loadLegacyLocalStorage(appDataDirectory, userDataPath);
      assert.isTrue(Option.isNone(taken));
      assert.isTrue(yield* fileSystem.exists(path.join(userDataPath, MARKER_FILE_NAME)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
