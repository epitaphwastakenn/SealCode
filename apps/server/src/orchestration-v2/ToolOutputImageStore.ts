import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import {
  MAX_TOOL_OUTPUT_IMAGE_BASE64_LENGTH,
  readToolOutputImage,
  toolOutputImageBlocks,
} from "@t3tools/shared/toolOutput";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";

import * as ServerConfig from "../config.ts";

export const TOOL_OUTPUT_IMAGES_DIRECTORY = "tool-output-images";
/** The field a stored image block carries in place of its base64 body. */
export const TOOL_OUTPUT_IMAGE_FILE_KEY = "t3ImageFile";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const STORED_FILE_NAME = /^[0-9a-f]{64}\.(?:png|jpg|gif|webp)$/;

/** The stored file a block points at, when it is a name this store could have written. */
export function storedToolOutputImageFile(block: unknown): string | undefined {
  const file = Predicate.isObject(block) ? block[TOOL_OUTPUT_IMAGE_FILE_KEY] : undefined;
  return typeof file === "string" && STORED_FILE_NAME.test(file) ? file : undefined;
}

/** Replaces the given blocks where `toolOutputImageBlocks` found them, keeping their order. */
export function replaceToolOutputImageBlocks(
  output: unknown,
  replacements: ReadonlyMap<unknown, unknown>,
): unknown {
  if (replacements.size === 0) return output;
  const replace = (block: unknown) => replacements.get(block) ?? block;
  if (Array.isArray(output)) return output.map(replace);
  if (Predicate.isObject(output) && Array.isArray(output.content)) {
    return { ...output, content: output.content.map(replace) };
  }
  return replace(output);
}

export interface ToolOutputImageStoreShape {
  /** Moves the images a tool item shows into files, leaving a reference in the item. */
  readonly externalize: (item: OrchestrationV2TurnItem) => Effect.Effect<OrchestrationV2TurnItem>;
}

/**
 * Screenshots are hundreds of kilobytes of base64, and every update of a tool item is written to
 * the event log again and to the projection, by a SQLite writer that blocks the server while it
 * works. The default keeps them inline so tests and tools without a T3 home need nothing.
 */
export const ToolOutputImageStore = Context.Reference<ToolOutputImageStoreShape>(
  "t3/orchestration-v2/ToolOutputImageStore",
  { defaultValue: () => ({ externalize: Effect.succeed }) },
);

export const make = Effect.fn("ToolOutputImageStore.make")(function* (attachmentsDir: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const directory = path.join(attachmentsDir, TOOL_OUTPUT_IMAGES_DIRECTORY);

  // Content-addressed, so the repeated updates of one item write each image once.
  const store = Effect.fn("ToolOutputImageStore.store")(function* (mimeType: string, data: string) {
    const extension = EXTENSION_BY_MIME[mimeType];
    if (extension === undefined) return undefined;
    const bytes = Buffer.from(data, "base64");
    const name = `${Hex.encode(yield* crypto.digest("SHA-256", bytes))}.${extension}`;
    const filePath = path.join(directory, name);
    if (!(yield* fileSystem.exists(filePath))) {
      yield* fileSystem.makeDirectory(directory, { recursive: true });
      // A crash mid-write must not leave a truncated file under the final name.
      const partial = `${filePath}.${(yield* crypto.randomUUIDv4()).slice(0, 8)}.partial`;
      yield* fileSystem.writeFile(partial, bytes);
      yield* fileSystem.rename(partial, filePath);
    }
    return name;
  });

  const externalize = Effect.fn("ToolOutputImageStore.externalize")(
    function* (item: OrchestrationV2TurnItem) {
      if (item.type !== "dynamic_tool" || typeof item.output !== "object" || item.output === null) {
        return item;
      }
      const replacements = new Map<unknown, unknown>();
      for (const block of toolOutputImageBlocks(item.output)) {
        const image = readToolOutputImage(block);
        if (image?.data === undefined || image.data.length > MAX_TOOL_OUTPUT_IMAGE_BASE64_LENGTH) {
          continue;
        }
        const name = yield* store(image.mimeType, image.data);
        if (name === undefined) continue;
        replacements.set(block, {
          type: "image",
          mimeType: image.mimeType,
          [TOOL_OUTPUT_IMAGE_FILE_KEY]: name,
        });
      }
      if (replacements.size === 0) return item;
      return { ...item, output: replaceToolOutputImageBlocks(item.output, replacements) };
    },
    (effect, item) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Kept tool output images inline; they could not be stored.", {
            cause,
          }).pipe(Effect.as(item)),
        ),
      ),
  );

  return { externalize } satisfies ToolOutputImageStoreShape;
});

export const layer = Layer.effect(
  ToolOutputImageStore,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return yield* make(config.attachmentsDir);
  }),
);
