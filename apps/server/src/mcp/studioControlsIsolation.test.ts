import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

it.effect("gives agents no tool that changes a thread's Studio controls", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/u, "$1"));
    const entries = yield* fs.readDirectory(directory, { recursive: true });
    const sources = entries.filter((entry) => /\.tsx?$/u.test(entry) && !/\.test\./u.test(entry));
    expect(sources.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const entry of sources) {
      const text = yield* fs.readFileString(path.join(directory, entry));
      if (text.includes("thread.studio-controls.set")) offenders.push(entry);
    }
    expect(offenders).toEqual([]);
  }).pipe(Effect.provide(NodeServices.layer)),
);
