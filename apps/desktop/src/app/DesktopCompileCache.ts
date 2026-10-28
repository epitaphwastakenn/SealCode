// @effect-diagnostics nodeBuiltinImport:off -- Node owns the compile cache location.
import * as NodeModule from "node:module";

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

// Node keeps one directory per Node version beside the active one (see compileCache.ts).
const VERSION_DIRECTORY = /^v\d+\.\d+\.\d+-/;
// Another install sharing the temp folder may run a different Node; only long-idle caches go.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Undefined when the cache is off, for example under a runtime without module.enableCompileCache. */
export const activeCompileCacheDirectory = (): string | undefined =>
  NodeModule.getCompileCacheDir?.();

/** Removes compile caches of other Node versions that nothing has written to for a week. */
export const cleanStaleCompileCaches = Effect.fn("desktop.compileCache.cleanStale")(function* (
  activeDirectory: string | undefined,
): Effect.fn.Return<void, never, FileSystem.FileSystem | Path.Path> {
  if (activeDirectory === undefined) return;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.dirname(activeDirectory);
  const active = path.basename(activeDirectory);
  const now = yield* Clock.currentTimeMillis;

  const names = yield* fileSystem
    .readDirectory(root)
    .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
  yield* Effect.forEach(
    names.filter((name) => name !== active && VERSION_DIRECTORY.test(name)),
    (name) => {
      const directory = path.join(root, name);
      return Effect.gen(function* () {
        const info = yield* fileSystem.stat(directory);
        const modifiedAt = Option.match(info.mtime, {
          onNone: () => now,
          onSome: (date) => date.getTime(),
        });
        if (info.type !== "Directory" || now - modifiedAt < STALE_AFTER_MS) return;
        yield* fileSystem.remove(directory, { recursive: true, force: true });
        yield* Effect.logInfo("Removed a stale compile cache", { directory });
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not remove a stale compile cache", { directory, error }),
        ),
      );
    },
    { discard: true },
  );
});
