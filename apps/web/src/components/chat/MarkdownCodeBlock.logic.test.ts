import { describe, expect, it } from "vite-plus/test";

import { isLargeCodeBlock, LARGE_CODE_HIGHLIGHT_THRESHOLD } from "./MarkdownCodeBlock.logic";

describe("isLargeCodeBlock", () => {
  it("highlights up to the threshold in render and defers anything longer", () => {
    expect(isLargeCodeBlock("x".repeat(LARGE_CODE_HIGHLIGHT_THRESHOLD))).toBe(false);
    expect(isLargeCodeBlock("x".repeat(LARGE_CODE_HIGHLIGHT_THRESHOLD + 1))).toBe(true);
    expect(isLargeCodeBlock("")).toBe(false);
  });
});
