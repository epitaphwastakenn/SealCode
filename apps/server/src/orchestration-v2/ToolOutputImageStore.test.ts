import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { NodeId, ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { toolOutputImages } from "@t3tools/shared/toolOutput";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  make,
  storedToolOutputImageFile,
  TOOL_OUTPUT_IMAGES_DIRECTORY,
} from "./ToolOutputImageStore.ts";

const PNG = Buffer.alloc(3_000, 7);
const JPEG = Buffer.alloc(2_000, 9);
const now = DateTime.makeUnsafe("2026-10-06T00:00:00.000Z");

function toolItem(output: unknown): OrchestrationV2TurnItem {
  return {
    id: TurnItemId.make("turn-item:shot"),
    threadId: ThreadId.make("thread:shot"),
    runId: null,
    nodeId: NodeId.make("node:shot"),
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "dynamic_tool",
    toolName: "roblox.capture_screenshot",
    input: {},
    output,
  };
}

const outputOf = (item: OrchestrationV2TurnItem) =>
  item.type === "dynamic_tool" ? item.output : undefined;

describe("ToolOutputImageStore", () => {
  it.effect("moves shown screenshots into files and keeps them in order", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const attachmentsDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-tool-img-" });
      const store = yield* make(attachmentsDir);
      const caption = { type: "text", text: '{"width":1600}' };
      const item = toolItem({
        content: [
          caption,
          { type: "image", data: PNG.toString("base64"), mimeType: "image/png" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: JPEG.toString("base64") },
          },
        ],
      });

      const stored = yield* store.externalize(item);
      const output = outputOf(stored) as { content: ReadonlyArray<unknown> };

      assert.deepEqual(output.content[0], caption);
      assert.notInclude(JSON.stringify(output), PNG.toString("base64").slice(0, 64));
      assert.deepEqual(
        toolOutputImages(output).map((image) => image.mimeType),
        ["image/png", "image/jpeg"],
      );
      const files = output.content.slice(1).map(storedToolOutputImageFile);
      const directory = path.join(attachmentsDir, TOOL_OUTPUT_IMAGES_DIRECTORY);
      assert.deepEqual(
        Buffer.from(yield* fileSystem.readFile(path.join(directory, files[0]!))),
        PNG,
      );
      assert.deepEqual(
        Buffer.from(yield* fileSystem.readFile(path.join(directory, files[1]!))),
        JPEG,
      );

      // A tool item is updated many times; each image is still one file.
      yield* store.externalize(item);
      assert.lengthOf(yield* fileSystem.readDirectory(directory), 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves items without inline images untouched", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const attachmentsDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-tool-img-" });
      const store = yield* make(attachmentsDir);
      const item = toolItem({ content: [{ type: "text", text: "done" }] });
      assert.strictEqual(yield* store.externalize(item), item);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it("only trusts file names the store writes", () => {
    const name = `${"a".repeat(64)}.png`;
    assert.equal(storedToolOutputImageFile({ t3ImageFile: name }), name);
    assert.isUndefined(storedToolOutputImageFile({ t3ImageFile: "../../secrets.png" }));
    assert.isUndefined(storedToolOutputImageFile({ t3ImageFile: `${"a".repeat(64)}.svg` }));
  });
});
