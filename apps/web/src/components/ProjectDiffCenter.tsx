import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useResolvedAppearance } from "../hooks/useTheme";
import { useClientSettings } from "../hooks/useSettings";
import { useCheckpointDiff } from "../lib/checkpointDiffState";
import { orchestrationEnvironment } from "../state/orchestration";
import { useEnvironmentQuery } from "../state/query";
import {
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import {
  resolveCheckpointChangedFileCount,
  shouldRenderUnattributedDiffFallback,
} from "../lib/checkpointAttribution";
import { formatShortTimestamp } from "../timestampFormat";
import { cn } from "../lib/utils";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { RefreshIcon } from "./ui/refresh-icon";
import { StatusDot } from "./ui/status-dot";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  DiffPanelEmpty,
  DiffPanelError,
  DiffPanelLoadingState,
  DiffPanelShell,
} from "./DiffPanelShell";

interface ProjectDiffCenterProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

/** One completed checkpoint of one thread, as the center lists it. */
export interface ProjectDiffEntry {
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly archivedAt: string | null;
  readonly runId: ThreadCheckpointSummary["runId"];
  readonly checkpointTurnCount: number;
  readonly status: ThreadCheckpointSummary["status"];
  readonly files: ThreadCheckpointSummary["files"];
  readonly completedAt: string;
}

interface ProjectDiffIndexState {
  readonly entries: readonly ProjectDiffEntry[];
  readonly isPending: boolean;
  readonly error: string | null;
  /** False while no query can answer for this project. */
  readonly available: boolean;
  readonly refresh: () => void;
}

const NO_ENTRIES: readonly ProjectDiffEntry[] = [];
const INDEX_LIMIT = 100;

/** The only place the center asks for its list: the server's newest-first checkpoint index. */
function useProjectDiffIndex(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ProjectDiffIndexState {
  const query = useEnvironmentQuery(
    orchestrationEnvironment.projectDiffIndex({
      environmentId,
      input: { projectId, limit: INDEX_LIMIT },
    }),
  );
  const entries =
    query.data === null
      ? NO_ENTRIES
      : query.data.entries.map((entry): ProjectDiffEntry => ({
          threadId: entry.threadId,
          threadTitle: entry.threadTitle,
          archivedAt: entry.archivedAt,
          runId: entry.runId,
          checkpointTurnCount: entry.appRunOrdinal,
          status: entry.status,
          files: entry.files,
          completedAt: entry.capturedAt,
        }));
  return {
    entries,
    isPending: query.isPending,
    error: query.error,
    available: true,
    refresh: query.refresh,
  };
}

function entryKey(entry: ProjectDiffEntry): string {
  return `${entry.threadId}:${entry.runId}`;
}

export function ProjectDiffCenter({ environmentId, projectId }: ProjectDiffCenterProps) {
  const resolvedTheme = useResolvedAppearance();
  const settings = useClientSettings();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const index = useProjectDiffIndex(environmentId, projectId);
  const entries = index.entries;
  const selectedEntry =
    entries.find((entry) => entryKey(entry) === selectedKey) ?? entries[0] ?? null;

  const checkpointDiff = useCheckpointDiff(
    {
      environmentId,
      threadId: selectedEntry?.threadId ?? null,
      fromTurnCount:
        selectedEntry === null ? null : Math.max(0, selectedEntry.checkpointTurnCount - 1),
      toTurnCount: selectedEntry?.checkpointTurnCount ?? null,
      ignoreWhitespace: true,
      cacheScope:
        selectedEntry === null ? "project-diff-center" : `project-diff:${entryKey(selectedEntry)}`,
    },
    { enabled: selectedEntry !== null },
  );
  const renderablePatch = getRenderablePatch(
    checkpointDiff.data?.diff,
    selectedEntry === null ? "project-diff-center" : `project-diff:${entryKey(selectedEntry)}`,
  );

  const countLabel =
    index.isPending && entries.length === 0
      ? null
      : `${entries.length} checkpoint${entries.length === 1 ? "" : "s"}`;

  const header = (
    <>
      <span className="min-w-0 flex-1 truncate px-1 text-xs tabular-nums text-muted-foreground">
        {countLabel}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Refresh project diffs"
              onClick={index.refresh}
              disabled={index.isPending || !index.available}
            />
          }
        >
          <RefreshIcon size="sm" refreshing={index.isPending} />
        </TooltipTrigger>
        <TooltipPopup side="top">
          {index.isPending ? "Refreshing project diffs…" : "Refresh project diffs"}
        </TooltipPopup>
      </Tooltip>
    </>
  );

  return (
    <DiffPanelShell header={header}>
      {!index.available ? (
        <DiffPanelEmpty
          title="Project diffs are not available yet"
          description="This server cannot list checkpoints across a project. Open a thread's Diff panel to review its checkpoints."
        />
      ) : index.error ? (
        <DiffPanelError
          title="Couldn't load project diffs"
          message={index.error}
          onRetry={index.refresh}
        />
      ) : index.isPending && entries.length === 0 ? (
        <DiffPanelLoadingState label="Loading project diffs" />
      ) : entries.length === 0 ? (
        <DiffPanelEmpty title="No completed checkpoint diffs in this project yet." />
      ) : (
        <div className="@container/project-diffs flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col @min-[40rem]/project-diffs:flex-row">
            <div className="flex max-h-56 min-h-0 w-full shrink-0 flex-col gap-0.5 overflow-auto border-b border-border p-2 @min-[40rem]/project-diffs:max-h-none @min-[40rem]/project-diffs:w-64 @min-[40rem]/project-diffs:border-r @min-[40rem]/project-diffs:border-b-0">
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
                      "flex w-full shrink-0 items-start gap-2 rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
                      selected ? "bg-row-selected" : "hover:bg-row-hover",
                    )}
                  >
                    <StatusDot
                      tone={
                        entry.status === "error"
                          ? "error"
                          : entry.status === "missing"
                            ? "warning"
                            : "success"
                      }
                      className="mt-1.25"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{entry.threadTitle}</span>
                        {entry.archivedAt !== null ? (
                          <Badge size="sm" variant="secondary">
                            Archived
                          </Badge>
                        ) : null}
                      </span>
                      <span className="flex flex-wrap gap-x-1.5 text-2xs tabular-nums text-secondary-label">
                        <span>Turn {entry.checkpointTurnCount}</span>
                        <span>
                          {formatShortTimestamp(entry.completedAt, settings.timestampFormat)}
                        </span>
                        {fileCount !== null ? (
                          <span>
                            {fileCount} file{fileCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-background">
              {selectedEntry && shouldRenderUnattributedDiffFallback(selectedEntry) ? (
                <Alert variant="warning" className="m-2">
                  <TriangleAlertIcon />
                  <AlertDescription>
                    This checkpoint has unverified file attribution; review it as a raw turn diff.
                  </AlertDescription>
                </Alert>
              ) : null}
              {checkpointDiff.error ? (
                <DiffPanelError
                  title="Couldn't load this checkpoint diff"
                  message={checkpointDiff.error}
                />
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
                <pre className="m-2 overflow-auto rounded-lg bg-code p-2.5 text-xs text-code-foreground">
                  {renderablePatch.text}
                </pre>
              ) : (
                <DiffPanelEmpty title="No patch available for this checkpoint" />
              )}
            </div>
          </div>
        </div>
      )}
    </DiffPanelShell>
  );
}

export default ProjectDiffCenter;
