export function shouldRenderUnattributedDiffFallback(input: {
  readonly files: readonly unknown[];
  readonly fileAttribution?: "known" | "unknown" | undefined;
}): boolean {
  return input.files.length === 0 && input.fileAttribution === "unknown";
}

export function resolveCheckpointChangedFileCount(input: {
  readonly files: readonly unknown[];
  readonly fileAttribution?: "known" | "unknown" | undefined;
}): number | null {
  if (input.files.length > 0) {
    return input.files.length;
  }
  return input.fileAttribution === "known" ? 0 : null;
}
