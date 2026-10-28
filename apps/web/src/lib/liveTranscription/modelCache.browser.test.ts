import { describe, expect, it } from "vite-plus/test";

import { openModelFileCache } from "./modelCache";

const MODEL_URL = "https://huggingface.co/onnx-community/whisper-small/resolve/main/onnx/test.onnx";

async function removeCachedFile(key: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("speech-models", { create: true });
  await directory.removeEntry(encodeURIComponent(key)).catch(() => undefined);
}

describe("openModelFileCache", () => {
  it("returns a stored model file across cache instances", async () => {
    await removeCachedFile(MODEL_URL);
    const writer = await openModelFileCache();
    await writer?.put(MODEL_URL, new Response(new Uint8Array([1, 2, 3, 4])));

    const reader = await openModelFileCache();
    const cached = await reader?.match(MODEL_URL);
    expect(cached?.headers.get("content-length")).toBe("4");
    expect(new Uint8Array((await cached?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("treats a download that never finished as a miss", async () => {
    await removeCachedFile(MODEL_URL);
    const cache = await openModelFileCache();
    const failing = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new Uint8Array([9, 9]));
        controller.error(new Error("connection lost"));
      },
    });
    await expect(cache?.put(MODEL_URL, new Response(failing))).rejects.toThrow();

    expect(await cache?.match(MODEL_URL)).toBeUndefined();
  });
});
