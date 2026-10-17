import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";

type CheckpointAttributionInput = {
  readonly files: readonly unknown[];
  readonly status?: ThreadCheckpointSummary["status"] | undefined;
};

/**
 * A checkpoint that never captured its files (error or stale ref) cannot tell
 * "nothing changed" from "changes we could not attribute", so the timeline
 * offers the raw diff instead of an empty file list. A `missing` checkpoint is
 * still being captured and stays quiet.
 */
export function shouldRenderUnattributedDiffFallback(input: CheckpointAttributionInput): boolean {
  return input.files.length === 0 && (input.status === "error" || input.status === "stale");
}

export function resolveCheckpointChangedFileCount(
  input: CheckpointAttributionInput,
): number | null {
  if (input.files.length > 0) {
    return input.files.length;
  }
  return input.status === "ready" ? 0 : null;
}
