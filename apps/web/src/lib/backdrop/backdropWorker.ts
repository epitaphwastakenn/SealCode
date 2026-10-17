import type { BackdropLook } from "@t3tools/contracts";

import {
  applyBackdropEffects,
  edgeColors,
  hasPixelEffects,
  type BackdropPalette,
  type EdgeColors,
} from "./backdropEffects";
const MIN_STYLED_EDGE = 1920;

export interface BackdropWorkerRequest {
  id: number;
  image: Blob;
  look: BackdropLook;
  palette: BackdropPalette;
  /** Longest side, in pixels, the result is kept at. */
  maxEdge: number;
  seed: number;
}

export type BackdropWorkerResponse =
  | { id: number; blob: Blob; width: number; height: number; edges: EdgeColors }
  | { id: number; error: string };

// Requests queue up while a large image is being processed; only the newest is worth
// finishing, since the page already moved on from the others.
let newestId = 0;

async function renderBackdrop(request: BackdropWorkerRequest): Promise<BackdropWorkerResponse> {
  const bitmap = await createImageBitmap(request.image);
  try {
    if (request.id !== newestId) return { id: request.id, error: "superseded" };

    const longEdge = Math.max(bitmap.width, bitmap.height);
    // Dots, dither and TV lines are drawn at image pixels; a small image would be
    // stretched by the window afterwards and smear them, so it is enlarged first.
    const minEdge = hasPixelEffects(request.look) ? Math.min(MIN_STYLED_EDGE, request.maxEdge) : 0;
    const scale = Math.min(request.maxEdge, Math.max(minEdge, longEdge)) / longEdge;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No 2D canvas available");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);

    const pixels = context.getImageData(0, 0, width, height);
    const styled = hasPixelEffects(request.look)
      ? applyBackdropEffects(pixels, request.look, request.palette, request.seed)
      : pixels;
    // The fade color comes from what is on screen, effects included.
    const edges = edgeColors(styled);
    if (styled !== pixels) context.putImageData(new ImageData(styled.data, width, height), 0, 0);

    if (request.id !== newestId) return { id: request.id, error: "superseded" };
    return { id: request.id, blob: await encode(canvas), width, height, edges };
  } finally {
    bitmap.close();
  }
}

async function encode(canvas: OffscreenCanvas): Promise<Blob> {
  try {
    // Browsers without a WebP encoder answer with a PNG, which is also fine.
    return await canvas.convertToBlob({ type: "image/webp", quality: 0.92 });
  } catch {
    return await canvas.convertToBlob({ type: "image/png" });
  }
}

function reply(response: BackdropWorkerResponse) {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A dedicated worker has no target origin to give.
  self.postMessage(response);
}

self.addEventListener("message", (event: MessageEvent<BackdropWorkerRequest>) => {
  const request = event.data;
  newestId = Math.max(newestId, request.id);
  renderBackdrop(request).then(reply, (error: unknown) =>
    reply({ id: request.id, error: error instanceof Error ? error.message : String(error) }),
  );
});
