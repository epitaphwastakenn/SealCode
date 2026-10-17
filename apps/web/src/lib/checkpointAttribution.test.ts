import { describe, expect, it } from "vite-plus/test";

import {
  resolveCheckpointChangedFileCount,
  shouldRenderUnattributedDiffFallback,
} from "./checkpointAttribution";

describe("checkpointAttribution", () => {
  it("shows structured diffs whenever files were captured", () => {
    const withFiles = {
      files: [{ path: "src/a.ts" }],
      fileAttribution: "unknown" as const,
    };

    expect(shouldRenderUnattributedDiffFallback(withFiles)).toBe(false);
    expect(resolveCheckpointChangedFileCount(withFiles)).toBe(1);
    expect(
      shouldRenderUnattributedDiffFallback({
        files: [{ path: "src/a.ts" }],
      }),
    ).toBe(false);
  });

  it("keeps the raw-diff fallback for a failed empty summary", () => {
    expect(
      shouldRenderUnattributedDiffFallback({
        files: [],
        fileAttribution: "unknown",
      }),
    ).toBe(true);
    expect(
      resolveCheckpointChangedFileCount({
        files: [],
        fileAttribution: "unknown",
      }),
    ).toBeNull();
  });

  it("treats a verified empty diff as zero files, not a fallback", () => {
    expect(
      shouldRenderUnattributedDiffFallback({
        files: [],
        fileAttribution: "known",
      }),
    ).toBe(false);
    expect(
      resolveCheckpointChangedFileCount({
        files: [],
        fileAttribution: "known",
      }),
    ).toBe(0);
  });
});
