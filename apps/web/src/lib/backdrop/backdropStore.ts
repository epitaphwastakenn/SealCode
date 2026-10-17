// The backdrop image lives in this device's IndexedDB rather than in client
// settings: settings are small JSON synced through the desktop bridge, while a
// photo or GIF can be several megabytes.

const DATABASE_NAME = "sealcode-backdrop";
const STORE_NAME = "images";
const DATABASE_VERSION = 1;

/** Larger files make the window slow to paint and are rarely sharper on screen. */
export const MAX_BACKDROP_IMAGE_BYTES = 40 * 1024 * 1024;

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("Could not open the backdrop image store."));
    };
  });
  return databasePromise;
}

function run<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Backdrop image store failed."));
      }),
  );
}

export function saveBackdropImage(id: string, image: Blob): Promise<void> {
  return run("readwrite", (store) => store.put(image, id)).then(() => undefined);
}

export function loadBackdropImage(id: string): Promise<Blob | null> {
  return run<unknown>("readonly", (store) => store.get(id)).then((value) =>
    value instanceof Blob ? value : null,
  );
}

export function deleteBackdropImage(id: string): Promise<void> {
  return run("readwrite", (store) => store.delete(id)).then(() => undefined);
}

/** GIFs and animated WebP/PNG keep playing, so they cannot take pixel effects. */
export async function isAnimatedImage(image: Blob): Promise<boolean> {
  if (image.type === "image/gif") return true;
  if (image.type !== "image/webp" && image.type !== "image/png" && image.type !== "image/apng") {
    return false;
  }
  if (typeof ImageDecoder === "undefined") return image.type === "image/apng";
  try {
    const decoder = new ImageDecoder({ data: image.stream(), type: image.type });
    await decoder.tracks.ready;
    const animated = decoder.tracks.selectedTrack?.animated ?? false;
    decoder.close();
    return animated;
  } catch {
    return false;
  }
}
