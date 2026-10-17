import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import {
  appendResolvedContextReferences,
  parseContextReferences,
  resolveContextReferences,
} from "./ContextReferences.ts";

const workspaceEntriesLayer = WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer));
const workspaceFileSystemLayer = WorkspaceFileSystem.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(workspaceEntriesLayer),
);
const testLayer = Layer.mergeAll(
  WorkspacePaths.layer,
  workspaceEntriesLayer,
  workspaceFileSystemLayer,
  VcsProcess.layer,
).pipe(Layer.provideMerge(NodeServices.layer));

describe("context references", () => {
  it("parses explicit file references and line ranges", () => {
    expect(parseContextReferences("@file:src/app.ts:2-4")).toEqual([
      { kind: "file", target: "src/app.ts", startLine: 1, endLine: 3 },
    ]);
  });

  it.effect("resolves files and indexed folder contents without leaving the workspace", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-context-" });
      yield* fileSystem.makeDirectory(path.join(root, "src", "nested"), { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(root, "src", "nested", "app.ts"),
        "one\ntwo\nthree\n",
      );

      const resolved = yield* resolveContextReferences(
        root,
        "@folder:src @file:src/nested/app.ts:2",
      );
      expect(resolved[0]?.content).toContain("nested/app.ts");
      expect(resolved[1]?.content).toBe("two");

      const error = yield* resolveContextReferences(root, "@file:../outside.txt").pipe(Effect.flip);
      expect(error.message).toContain("outside the workspace");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("deduplicates references and preserves a bounded prompt section", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-context-" });
      yield* fileSystem.writeFileString(path.join(root, "readme.md"), "hello");

      const resolved = yield* resolveContextReferences(root, "@file:readme.md @file:readme.md");
      expect(resolved).toHaveLength(1);
      expect(appendResolvedContextReferences("prompt", resolved)).toContain("readme.md");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects binary files instead of decoding them into prompt text", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-context-" });
      yield* fileSystem.writeFile(path.join(root, "image.bin"), new Uint8Array([0, 1, 2, 3]));

      const error = yield* resolveContextReferences(root, "@file:image.bin").pipe(Effect.flip);
      expect(error.message).toContain("Unable to read context file");
    }).pipe(Effect.provide(testLayer)),
  );
});
