import { type AppBackdrop, DEFAULT_BACKDROP_LOOK } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { backdropProcessKey } from "./preparedBackdrop";

function backdrop(change: Partial<AppBackdrop> = {}): AppBackdrop {
  return {
    ...DEFAULT_BACKDROP_LOOK,
    imageId: "image-1",
    imageName: "",
    animated: false,
    x: 50,
    y: 50,
    zoom: 100,
    style: null,
    ...change,
  };
}

describe("backdropProcessKey", () => {
  it("ignores the theme when the look has no duotone", () => {
    expect(backdropProcessKey(backdrop(), "light")).toBe(backdropProcessKey(backdrop(), "dark"));
  });

  it("follows the theme once the duotone takes its colors", () => {
    const duotone = backdrop({ duotone: 60 });

    expect(backdropProcessKey(duotone, "light")).not.toBe(backdropProcessKey(duotone, "dark"));
  });

  it("keeps animated images out of the worker whatever the theme", () => {
    const animated = backdrop({ animated: true, duotone: 60 });

    expect(backdropProcessKey(animated, "light")).toBe(backdropProcessKey(animated, "dark"));
  });

  it("still changes with the image and with the effects that run in the worker", () => {
    const base = backdropProcessKey(backdrop(), "dark");

    expect(backdropProcessKey(backdrop({ imageId: "image-2" }), "dark")).not.toBe(base);
    expect(backdropProcessKey(backdrop({ posterize: 40 }), "dark")).not.toBe(base);
  });

  it("does not rerun the worker for effects drawn in CSS", () => {
    const base = backdropProcessKey(backdrop(), "dark");

    expect(backdropProcessKey(backdrop({ blur: 12, strength: 40 }), "dark")).toBe(base);
  });
});
