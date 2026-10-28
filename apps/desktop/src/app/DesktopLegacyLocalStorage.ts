import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import {
  isMalformedDatabaseError,
  readChromiumLocalStorage,
  type ChromiumLocalStorageReadError,
} from "./chromiumLocalStorage.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

/** Reads the V1 profile without opening it in Chromium, even while V1 runs. */
export class DesktopLegacyLocalStorage extends Context.Service<
  DesktopLegacyLocalStorage,
  {
    readonly load: (userDataPath: string) => Effect.Effect<void>;
    readonly take: Effect.Effect<Option.Option<Readonly<Record<string, string>>>>;
    readonly complete: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopLegacyLocalStorage") {}

const MARKER_FILE_NAME = "v1-local-storage-imported";
// SealCode 1.x kept its profile in "sealcode"; the SealCode names cover installs
// that predate the fork.
const V1_PROFILE_NAMES = ["sealcode", "T3 Code (Alpha)", "t3code"];
// A profile untouched for this long is not being written, so a malformed database will not heal.
const QUIET_PROFILE_AGE_MS = 60 * 60 * 1000;

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const items = yield* Ref.make(Option.none<Readonly<Record<string, string>>>());
  const markerPath = yield* Ref.make(Option.none<string>());

  /** Newest file mtime in a directory; appending to a log leaves the directory's own mtime alone. */
  const newestFileMtime = Effect.fn("DesktopLegacyLocalStorage.newestFileMtime")(
    function* (directory: string) {
      let newest = 0;
      for (const name of yield* fs.readDirectory(directory)) {
        const info = yield* fs.stat(path.join(directory, name)).pipe(Effect.option);
        if (Option.isNone(info)) continue;
        const mtime = Option.match(info.value.mtime, {
          onNone: () => 0,
          onSome: (date) => date.getTime(),
        });
        newest = Math.max(newest, mtime);
      }
      return newest;
    },
    (effect, _directory) => effect.pipe(Effect.option),
  );

  const findV1LocalStorage = Effect.gen(function* () {
    let newest: { readonly directory: string; readonly mtime: number } | null = null;
    for (const name of V1_PROFILE_NAMES) {
      const directory = path.join(environment.appDataDirectory, name, "Local Storage", "leveldb");
      const mtime = yield* newestFileMtime(directory);
      if (Option.isNone(mtime)) continue;
      if (newest === null || mtime.value > newest.mtime) newest = { directory, mtime: mtime.value };
    }
    return newest;
  });

  const writeMarker = Effect.gen(function* () {
    const marker = yield* Ref.get(markerPath);
    if (Option.isNone(marker)) return;
    yield* fs
      .writeFileString(marker.value, "")
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not record the V1 Local Storage import", error),
        ),
      );
  });

  const handleReadFailure = Effect.fn("desktop.legacyLocalStorage.handleReadFailure")(function* (
    error: ChromiumLocalStorageReadError,
    profileMtime: number,
  ) {
    const quiet = (yield* Clock.currentTimeMillis) - profileMtime >= QUIET_PROFILE_AGE_MS;
    if (quiet && isMalformedDatabaseError(error)) {
      yield* Effect.logWarning("V1 Local Storage is unreadable; skipping the import", error);
      yield* writeMarker;
      return;
    }
    yield* Effect.logWarning("Could not read V1 Local Storage; will retry next launch", error);
  });

  const load = Effect.fn("desktop.legacyLocalStorage.load")(function* (userDataPath: string) {
    if (environment.isDevelopment) return;
    const marker = path.join(userDataPath, MARKER_FILE_NAME);
    if (yield* fs.exists(marker).pipe(Effect.orElseSucceed(() => true))) return;
    yield* Ref.set(markerPath, Option.some(marker));
    const profile = yield* findV1LocalStorage;
    if (profile === null) return yield* writeMarker;
    // SealCode 1.x wrote under its own origin; its entries win over T3 Code's.
    const origins = [
      ElectronProtocol.getDesktopUrl(false).replace(/\/$/, ""),
      ElectronProtocol.SEALCODE_V1_ORIGIN,
    ];
    const read = yield* Effect.forEach(origins, (origin) =>
      readChromiumLocalStorage(profile.directory, origin),
    ).pipe(
      Effect.map((maps) => Option.some(new Map(maps.flatMap((entries) => [...entries])))),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.catch((error) =>
        handleReadFailure(error, profile.mtime).pipe(Effect.as(Option.none())),
      ),
    );
    if (Option.isNone(read)) return;
    yield* Effect.logInfo("V1 Local Storage ready to import", {
      directory: profile.directory,
      keys: read.value.size,
    });
    yield* Ref.set(items, Option.some(Object.fromEntries(read.value)));
  });

  return DesktopLegacyLocalStorage.of({
    load,
    take: Ref.getAndSet(items, Option.none()),
    complete: writeMarker,
  });
});

export const layer = Layer.effect(DesktopLegacyLocalStorage, make);
