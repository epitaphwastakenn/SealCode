import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import { cleanStaleCompileCaches } from "./DesktopCompileCache.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = 30 * DAY_MS;

describe("cleanStaleCompileCaches", () => {
  it.effect("removes idle caches of other Node versions and keeps everything else", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* TestClock.setTime(NOW_MS);
      const root = yield* fileSystem.makeTempDirectoryScoped();
      const make = Effect.fn("make")(function* (name: string, ageMs: number) {
        const directory = path.join(root, name);
        yield* fileSystem.makeDirectory(directory);
        yield* fileSystem.writeFileString(path.join(directory, "entry"), "cached");
        // utimes takes epoch seconds when given numbers.
        const touched = (NOW_MS - ageMs) / 1000;
        yield* fileSystem.utimes(directory, touched, touched);
        return directory;
      });
      const active = yield* make("v24.22.0-x64-31bda926", 60 * DAY_MS);
      const idle = yield* make("v24.21.0-x64-7bebda67", 8 * DAY_MS);
      const shared = yield* make("v22.1.0-x64-0a1b2c3d", 2 * DAY_MS);
      const unrelated = yield* make("backups", 60 * DAY_MS);

      yield* cleanStaleCompileCaches(active);

      assert.isTrue(yield* fileSystem.exists(active));
      assert.isFalse(yield* fileSystem.exists(idle));
      assert.isTrue(yield* fileSystem.exists(shared));
      assert.isTrue(yield* fileSystem.exists(unrelated));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does nothing when the compile cache is not enabled", () =>
    cleanStaleCompileCaches(undefined).pipe(Effect.provide(NodeServices.layer)),
  );
});
