import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import { McpHarnessStore, McpHarnessStoreLive } from "./McpHarnessStore.ts";

const makeTestLayer = (calls: Array<{ readonly kind: string; readonly input: unknown }>) => {
  const workspaceEntries = Layer.succeed(
    WorkspaceEntries.WorkspaceEntries,
    WorkspaceEntries.WorkspaceEntries.of({
      browse: () => Effect.die("unused"),
      list: () => Effect.die("unused"),
      search: () => Effect.die("unused"),
      refresh: () => Effect.void,
      searchContents: (input) => {
        calls.push({ kind: "search", input });
        return Effect.succeed({
          matches: [
            {
              path: "result.ts",
              lineNumber: 4,
              lineContent: "const needle = true;",
              matchRanges: [{ start: 6, end: 12 }],
            },
          ],
          truncated: false,
        });
      },
    }),
  );
  const workspaceFileSystem = Layer.succeed(
    WorkspaceFileSystem.WorkspaceFileSystem,
    WorkspaceFileSystem.WorkspaceFileSystem.of({
      readFile: (input) => {
        calls.push({ kind: "read", input });
        return Effect.succeed({
          relativePath: input.relativePath,
          contents: "bounded file contents",
          byteLength: 21,
          truncated: false,
        });
      },
      writeFile: () => Effect.die("unused"),
    }),
  );

  return McpHarnessStoreLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-harness-store-test-" }),
        SqlitePersistenceMemory,
        workspaceEntries,
        workspaceFileSystem,
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
};

it.effect("uses the shared persistence service for memory", () => {
  const calls: Array<{ readonly kind: string; readonly input: unknown }> = [];
  return Effect.gen(function* () {
    const store = yield* McpHarnessStore;
    yield* store.upsertMemory({ key: "preference", value: "concise output" });
    expect(yield* store.listMemory({})).toMatchObject([
      { scope: "user", key: "preference", value: "concise output" },
    ]);
  }).pipe(Effect.provide(makeTestLayer(calls)));
});

it.effect("delegates workflow file access to bounded workspace services", () => {
  const calls: Array<{ readonly kind: string; readonly input: unknown }> = [];
  return Effect.gen(function* () {
    const store = yield* McpHarnessStore;
    const result = yield* store.executeWorkflow({
      threadId: ThreadId.make("thread-1"),
      workspaceRoot: process.cwd(),
      definition: {
        operations: [
          { id: "read", kind: "file-read", input: { path: "README.md" } },
          { id: "search", kind: "workspace-search", input: { path: "apps", query: "needle" } },
        ],
        output: "search",
      },
    });

    expect(result.output).toMatchObject([{ line: "const needle = true;" }]);
    expect(calls).toMatchObject([
      { kind: "read", input: { relativePath: "README.md" } },
      { kind: "search", input: { query: "needle", limit: 200 } },
    ]);
  }).pipe(Effect.provide(makeTestLayer(calls)));
});
