const MODEL_CACHE_DIRECTORY = "speech-models";

export interface ModelFileCache {
  readonly match: (key: string) => Promise<Response | undefined>;
  readonly put: (key: string, response: Response) => Promise<void>;
}

/**
 * Cache Storage throws on the desktop app's custom scheme, so downloaded model files live in the
 * origin private file system, which works there and in browsers. A writable only replaces the file
 * on close, so an interrupted download leaves an empty file, which reads as a miss.
 */
export async function openModelFileCache(): Promise<ModelFileCache | null> {
  let directory: FileSystemDirectoryHandle;
  try {
    const root = await navigator.storage.getDirectory();
    directory = await root.getDirectoryHandle(MODEL_CACHE_DIRECTORY, { create: true });
  } catch {
    return null;
  }

  return {
    match: async (key) => {
      try {
        const file = await (await directory.getFileHandle(encodeURIComponent(key))).getFile();
        if (file.size === 0) {
          return undefined;
        }
        return new Response(file, { headers: { "content-length": String(file.size) } });
      } catch {
        return undefined;
      }
    },
    put: async (key, response) => {
      const handle = await directory.getFileHandle(encodeURIComponent(key), { create: true });
      const writable = await handle.createWritable();
      if (response.body) {
        await response.body.pipeTo(writable);
        return;
      }
      await writable.write(await response.arrayBuffer());
      await writable.close();
    },
  };
}
