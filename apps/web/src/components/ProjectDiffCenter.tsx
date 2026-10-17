import { useMemo, useState, useEffect } from "react";
import { FileDiff, RefreshCw, TriangleAlert } from "lucide-react";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type { EnvironmentId, OrchestrationProjectDiffEntry, ProjectId } from "@t3tools/contracts";
import { useTheme } from "../hooks/useTheme";
import { useClientSettings } from "../hooks/useSettings";
import { useEnvironmentQuery } from "../state/query";
import { orchestrationEnvironment } from "../state/orchestration";
import { useCheckpointDiff } from "../lib/checkpointDiffState";
import { getRenderablePatch, resolveDiffThemeName, resolveFileDiffPath } from "../lib/diffRendering";
import {
  resolveCheckpointChangedFileCount,
  shouldRenderUnattributedDiffFallback,
} from "../lib/checkpointAttribution";
import { formatShortTimestamp } from "../timestampFormat";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { DiffPanelLoadingState, DiffPanelShell } from "./DiffPanelShell";

interface ProjectDiffCenterProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

function entryKey(entry: OrchestrationProjectDiffEntry): string {
  return `${entry.threadId}:${entry.turnId}`;
}

export function ProjectDiffCenter({ environmentId, projectId }: ProjectDiffCenterProps) {
  const { resolvedTheme } = useTheme();
  const settings = useClientSettings();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const index = useEnvironmentQuery(
    orchestrationEnvironment.projectDiffIndex({
      environmentId,
      input: { projectId, limit: 100 },
    }),
  );
  const entries = index.data?.entries ?? [];
  const selectedEntry = useMemo(
    () =>
      entries.find((entry) => entryKey(entry) === selectedKey) ??
      entries[0] ??
      null,
    [entries, selectedKey],
  );

  useEffect(() => {
    if (selectedEntry === null) {
      setSelectedKey(null);
      return;
    }
    const nextKey = entryKey(selectedEntry);
    if (nextKey !== selectedKey) {
      setSelectedKey(nextKey);
    }
  }, [selectedEntry, selectedKey]);

  const checkpointDiff = useCheckpointDiff(
    {
      environmentId,
      threadId: selectedEntry?.threadId ?? null,
      fromTurnCount:
        selectedEntry === null ? null : Math.max(0, selectedEntry.checkpointTurnCount - 1),
      toTurnCount: selectedEntry?.checkpointTurnCount ?? null,
      ignoreWhitespace: true,
      cacheScope: selectedEntry === null ? "project-diff-center" : `project-diff:${entryKey(selectedEntry)}`,
    },
    { enabled: selectedEntry !== null },
  );
  const renderablePatch = useMemo(
    () =>
      getRenderablePatch(
        checkpointDiff.data?.diff,
        selectedEntry === null ? "project-diff-center" : `project-diff:${entryKey(selectedEntry)}`,
      ),
    [checkpointDiff.data?.diff, selectedEntry],
  );

  const header = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <FileDiff className="size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Project Diff Center</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {entries.length} checkpoint{entries.length === 1 ? "" : "s"} across this project
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh project diffs"
        onClick={index.refresh}
        disabled={index.isPending}
      >
        <RefreshCw className={cn("size-3.5", index.isPending && "animate-spin")} />
      </Button>
    </>
  );

  return (
    <DiffPanelShell mode="embedded" header={header}>
      {index.error ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-destructive">
          {index.error}
        </div>
      ) : index.isPending && index.data === null ? (
        <DiffPanelLoadingState label="Loading project diffs" />
      ) : entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-muted-foreground">
          <FileDiff className="size-6 opacity-50" />
          <p>No completed checkpoint diffs in this project yet.</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="max-h-56 min-h-0 w-full shrink-0 overflow-auto border-b border-border/70 md:max-h-none md:w-64 md:border-r md:border-b-0">
            {entries.map((entry) => {
              const key = entryKey(entry);
              const selected = key === (selectedEntry === null ? null : entryKey(selectedEntry));
              const fileCount = resolveCheckpointChangedFileCount(entry);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedKey(key)}
                  className={cn(
                    "flex w-full items-start gap-2 border-b border-border/50 px-3 py-2.5 text-left transition-colors hover:bg-accent/40",
                    selected && "bg-accent/70",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      entry.status === "error"
                        ? "bg-destructive"
                        : entry.status === "missing"
                          ? "bg-warning"
                          : "bg-success",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium">{entry.threadTitle}</span>
                      {entry.archivedAt !== null ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground">Archived</span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-1.5 text-[10px] text-muted-foreground">
                      <span>Turn {entry.checkpointTurnCount}</span>
                      <span>{formatShortTimestamp(entry.completedAt, settings.timestampFormat)}</span>
                      {fileCount !== null ? <span>{fileCount} files</span> : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-auto">
            {selectedEntry && shouldRenderUnattributedDiffFallback(selectedEntry) ? (
              <div className="flex items-center gap-2 border-b border-border/70 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                <TriangleAlert className="size-3.5 shrink-0 text-amber-500" />
                This checkpoint has unverified file attribution; review it as a raw turn diff.
              </div>
            ) : null}
            {checkpointDiff.error ? (
              <p className="p-3 text-xs text-destructive">{checkpointDiff.error}</p>
            ) : checkpointDiff.isPending ? (
              <DiffPanelLoadingState label="Loading selected checkpoint diff" />
            ) : renderablePatch?.kind === "files" ? (
              <div className="space-y-2 bg-code p-1">
                {renderablePatch.files.map((fileDiff) => (
                  <PierreFileDiff
                    key={resolveFileDiffPath(fileDiff)}
                    fileDiff={fileDiff}
                    options={{
                      collapsed: false,
                      diffStyle: "unified",
                      theme: resolveDiffThemeName(resolvedTheme),
                    }}
                  />
                ))}
              </div>
            ) : renderablePatch?.kind === "raw" ? (
              <pre className="m-2 overflow-auto rounded-lg border border-border/60 bg-code p-3 text-xs text-code-foreground">
                {renderablePatch.text}
              </pre>
            ) : (
              <p className="p-3 text-xs text-muted-foreground">No patch is available for this checkpoint.</p>
            )}
          </div>
        </div>
      )}
    </DiffPanelShell>
  );
}

export default ProjectDiffCenter;
