import type { AssetResource, EnvironmentId } from "@t3tools/contracts";

import type { ExpandedImagePreview } from "./ExpandedImagePreview";

export type TurnImageResource = Extract<AssetResource, { readonly _tag: "tool-output-image" }>;

export const turnImageTileLimit = 8;

export function turnImageTileCounts(imageCount: number) {
  const shown = Math.min(imageCount, turnImageTileLimit);
  return { shown, hidden: imageCount - shown };
}

export function buildTurnImagesPreview(
  environmentId: EnvironmentId,
  images: ReadonlyArray<TurnImageResource>,
  index: number,
): ExpandedImagePreview {
  return {
    images: images.map((resource, position) => ({
      src: null,
      name: "Screenshot",
      actionsSource: {
        kind: "image",
        name: `Screenshot ${position + 1}`,
        src: null,
        asset: { environmentId, resource },
      },
    })),
    index,
    filmstrip: true,
  };
}
