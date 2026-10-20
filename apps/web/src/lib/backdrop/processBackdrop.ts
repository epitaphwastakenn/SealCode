import type { BackdropLook } from "@t3tools/contracts";

import type { BackdropPalette, EdgeColors } from "./backdropEffects";
import type { BackdropWorkerRequest, BackdropWorkerResponse } from "./backdropWorker";

export type { BackdropPalette, EdgeColors } from "./backdropEffects";

/** Longest side, in pixels, a styled backdrop image is kept at: enough for a large window. */
export const BACKDROP_MAX_EDGE = 2560;

export interface ProcessedBackdrop {
  /** An object URL; hand it to `revokeBackdropUrl` once nothing shows it. */
  url: string;
  width: number;
  height: number;
  edges: EdgeColors;
}

/**
 * "live" is what the window shows and "prefetch" an image about to be shown;
 * a request only replaces older ones in its own lane, so warming the next
 * image never cancels the one on screen.
 */
export type BackdropLane = "live" | "prefetch";

interface Pending {
  lane: BackdropLane;
  resolve: (result: ProcessedBackdrop) => void;
  reject: (error: Error) => void;
}

// Fixed, so the same look on the same image is the same grain and glitch every time
// rather than shimmering as an unrelated slider moves.
const SEED = 0x5ea1c0de;

let worker: Worker | null = null;
let lastId = 0;
const pending = new Map<number, Pending>();

function abortError() {
  return new DOMException("A newer backdrop request replaced this one", "AbortError");
}

function failAll(error: Error, lane?: BackdropLane) {
  for (const [id, request] of pending) {
    if (lane !== undefined && request.lane !== lane) continue;
    pending.delete(id);
    request.reject(error);
  }
}

function sharedWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./backdropWorker.ts", import.meta.url), { type: "module" });
  created.addEventListener("message", (event: MessageEvent<BackdropWorkerResponse>) => {
    const response = event.data;
    // Answers to requests that were replaced find nobody waiting, and no URL is made.
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if ("error" in response) {
      request.reject(new Error(response.error));
      return;
    }
    request.resolve({
      url: URL.createObjectURL(response.blob),
      width: response.width,
      height: response.height,
      edges: response.edges,
    });
  });
  created.addEventListener("error", (event) => {
    // A worker that failed to load or crashed is replaced on the next request.
    created.terminate();
    if (worker === created) worker = null;
    failAll(new Error(event.message || "The backdrop worker failed"));
  });
  worker = created;
  return created;
}

/**
 * The image styled with the look's pixel effects and shrunk to `BACKDROP_MAX_EDGE`,
 * done off the main thread. Only the latest request of a lane wins: starting another
 * rejects the one in flight with an `AbortError`, which callers can ignore.
 */
export function processBackdropImage(
  image: Blob,
  look: BackdropLook,
  palette: BackdropPalette,
  lane: BackdropLane = "live",
): Promise<ProcessedBackdrop> {
  const id = ++lastId;
  failAll(abortError(), lane);
  return new Promise((resolve, reject) => {
    pending.set(id, { lane, resolve, reject });
    try {
      const request: BackdropWorkerRequest = {
        id,
        image,
        look,
        palette,
        maxEdge: BACKDROP_MAX_EDGE,
        seed: SEED,
      };
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A Worker has no target origin to give.
      sharedWorker().postMessage(request);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function revokeBackdropUrl(url: string): void {
  URL.revokeObjectURL(url);
}
