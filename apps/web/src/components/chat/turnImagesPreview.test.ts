import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { expandedImageKey } from "./ExpandedImagePreview";
import {
  buildTurnImagesPreview,
  turnImageTileCounts,
  turnImageTileLimit,
  type TurnImageResource,
} from "./turnImagesPreview";

const environmentId = EnvironmentId.make("environment-local");
const resource = (itemId: string, index: number): TurnImageResource => ({
  _tag: "tool-output-image",
  threadId: ThreadId.make("thread"),
  itemId: TurnItemId.make(itemId),
  index,
});

describe("buildTurnImagesPreview", () => {
  it("lists every shot as an asset-only item and opens at the clicked one", () => {
    const images = [resource("a", 0), resource("a", 1), resource("b", 0)];
    const preview = buildTurnImagesPreview(environmentId, images, 2);

    expect(preview.index).toBe(2);
    expect(preview.filmstrip).toBe(true);
    expect(preview.images.map((item) => item.src)).toEqual([null, null, null]);
    expect(preview.images.map((item) => item.actionsSource?.asset?.resource)).toEqual(images);
    expect(preview.images.map((item) => item.actionsSource?.name)).toEqual([
      "Screenshot 1",
      "Screenshot 2",
      "Screenshot 3",
    ]);
    expect(new Set(preview.images.map((item) => item.actionsSource?.asset?.environmentId))).toEqual(
      new Set([environmentId]),
    );
  });

  it("keys the dialog by the shot that was opened", () => {
    const images = [resource("a", 0), resource("a", 1)];

    expect(expandedImageKey(buildTurnImagesPreview(environmentId, images, 0))).not.toBe(
      expandedImageKey(buildTurnImagesPreview(environmentId, images, 1)),
    );
  });
});

describe("turnImageTileCounts", () => {
  it("shows every tile up to the limit and counts the rest", () => {
    expect(turnImageTileCounts(1)).toEqual({ shown: 1, hidden: 0 });
    expect(turnImageTileCounts(turnImageTileLimit)).toEqual({
      shown: turnImageTileLimit,
      hidden: 0,
    });
    expect(turnImageTileCounts(turnImageTileLimit + 5)).toEqual({
      shown: turnImageTileLimit,
      hidden: 5,
    });
  });
});
