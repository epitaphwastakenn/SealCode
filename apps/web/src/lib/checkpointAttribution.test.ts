import { describe, expect, it } from "vite-plus/test";

import {
  resolveCheckpointChangedFileCount,
  shouldRenderUnattributedDiffFallback,
} from "./checkpointAttribution";

describe("checkpointAttribution", () => {
  it("shows structured diffs whenever files were captured", () => {
    const withFiles = {
      files: [{ path: "src/a.ts" }],
      status: "stale" as const,
    };

    expect(shouldRenderUnattributedDiffFallback(withFiles)).toBe(false);
    expect(resolveCheckpointChangedFileCount(withFiles)).toBe(1);
    expect(
      shouldRenderUnattributedDiffFallback({
        files: [{ path: "src/a.ts" }],
      }),
    ).toBe(false);
  });

  it("keeps the raw-diff fallback for an empty summary that was never captured", () => {
    for (const status of ["error", "stale"] as const) {
      expect(shouldRenderUnattributedDiffFallback({ files: [], status })).toBe(true);
      expect(resolveCheckpointChangedFileCount({ files: [], status })).toBeNull();
    }
  });

  it("stays quiet while the checkpoint is still being captured", () => {
    expect(shouldRenderUnattributedDiffFallback({ files: [], status: "missing" })).toBe(false);
    expect(resolveCheckpointChangedFileCount({ files: [], status: "missing" })).toBeNull();
  });

  it("treats a verified empty diff as zero files, not a fallback", () => {
    expect(shouldRenderUnattributedDiffFallback({ files: [], status: "ready" })).toBe(false);
    expect(resolveCheckpointChangedFileCount({ files: [], status: "ready" })).toBe(0);
  });
});
