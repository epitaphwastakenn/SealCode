import {
  worktreeSetupStageLabel,
  type WorktreeSetupSnapshot,
  type WorktreeSetupStage,
} from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleIcon,
  LaptopIcon,
  MinusIcon,
  TerminalIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { DisclosureChevron } from "~/components/ui/disclosure-chevron";
import { Spinner } from "~/components/ui/spinner";
import { MiddleTruncate } from "../ui/middle-truncate";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";
import { ActivityShimmerOverlay } from "./TimelineRowParts";
import { WorkLogRow } from "./WorkLog";

interface WorktreeSetupCardProps {
  snapshot: WorktreeSetupSnapshot;
  onCancel: (() => void) | null;
  onWorkLocally: (() => void) | null;
  onOpenTerminal: (() => void) | null;
}

function stageElapsedMs(stage: WorktreeSetupStage, nowMs: number): number | null {
  if (!stage.startedAt) return null;
  const start = Date.parse(stage.startedAt);
  const end = stage.endedAt ? Date.parse(stage.endedAt) : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function useNowWhile(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active]);
  return nowMs;
}

function StageIcon({ status }: { status: WorktreeSetupStage["status"] }) {
  const className = "size-4 shrink-0";
  switch (status) {
    case "done":
      return <CheckIcon aria-hidden className={className} />;
    case "running":
      return <Spinner size="md" className="shrink-0" />;
    case "failed":
      return <XIcon aria-hidden className={className} />;
    case "warning":
      return <CircleAlertIcon aria-hidden className={className} />;
    case "skipped":
      return <MinusIcon aria-hidden className={className} />;
    case "pending":
      return <CircleIcon aria-hidden className={className} />;
  }
}

function stageRowClassName(status: WorktreeSetupStage["status"]): string {
  switch (status) {
    case "failed":
      return "text-error-foreground";
    case "warning":
      return "text-warning-foreground";
    case "pending":
      return "text-muted-foreground";
    case "running":
    case "skipped":
    case "done":
      return "text-secondary-label";
  }
}

function headerLabel(snapshot: WorktreeSetupSnapshot): string {
  switch (snapshot.phase) {
    case "running":
      return "Setting up worktree…";
    case "done":
      return snapshot.stages.some((stage) => stage.status === "failed")
        ? "Worktree ready, setup script failed"
        : "Worktree ready";
    case "failed":
      return "Worktree setup failed";
    case "cancelled":
      return "Worktree setup cancelled";
  }
}

function SetupHeaderRow({
  snapshot,
  totalElapsed,
}: {
  snapshot: WorktreeSetupSnapshot;
  totalElapsed: number | null;
}) {
  const running = snapshot.phase === "running";
  const failed = snapshot.phase === "failed";
  const finishedWithFailedStage =
    snapshot.phase === "done" && snapshot.stages.some((stage) => stage.status === "failed");
  const text = headerLabel(snapshot);
  const tone = failed
    ? "text-error-foreground"
    : finishedWithFailedStage
      ? "text-warning-foreground"
      : "text-secondary-label";
  return (
    <div className={cn("flex min-h-6 min-w-0 items-center gap-1.5 px-0.5 pb-2 text-sm", tone)}>
      <span
        ref={running ? observeVisibleAnimation : undefined}
        className="relative min-w-0 shrink overflow-hidden whitespace-nowrap"
      >
        <span className="block truncate">{text}</span>
        {running ? <ActivityShimmerOverlay tone="brand">{text}</ActivityShimmerOverlay> : null}
      </span>
      {totalElapsed !== null ? (
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatDuration(totalElapsed)}
        </span>
      ) : null}
    </div>
  );
}

function StageRow({
  stage,
  nowMs,
  scriptName,
}: {
  stage: WorktreeSetupStage;
  nowMs: number;
  scriptName: string | null;
}) {
  const elapsed = stageElapsedMs(stage, nowMs);
  const label =
    stage.id === "setup-script" && scriptName ? scriptName : worktreeSetupStageLabel(stage.id);
  const running = stage.status === "running";
  const trailing =
    stage.status === "pending"
      ? null
      : stage.status === "skipped"
        ? (stage.detail ?? "skipped")
        : stage.id === "checkout" && running && stage.percent !== null
          ? `${stage.percent}%`
          : stage.detail;
  return (
    <WorkLogRow
      data-worktree-setup-stage={stage.id}
      data-worktree-setup-status={stage.status}
      icon={
        <span className="text-icon-muted">
          <StageIcon status={stage.status} />
        </span>
      }
      label={
        <span
          ref={running ? observeVisibleAnimation : undefined}
          className={cn("relative block truncate", stageRowClassName(stage.status))}
        >
          {label}
          {running ? <ActivityShimmerOverlay>{label}</ActivityShimmerOverlay> : null}
        </span>
      }
      trailing={
        <>
          {trailing ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
              {trailing}
            </span>
          ) : null}
          {elapsed !== null && stage.status !== "skipped" && stage.status !== "pending" ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatDuration(elapsed)}
            </span>
          ) : null}
        </>
      }
    />
  );
}

const OUTPUT_TAIL_LINES = 4;
const OUTPUT_TAIL_SLOTS = Array.from({ length: OUTPUT_TAIL_LINES }, (_, slot) => slot);

function OutputTail({ lines, failed }: { lines: ReadonlyArray<string>; failed: boolean }) {
  const rows = OUTPUT_TAIL_SLOTS.map((slot) => ({
    slot,
    line: lines[lines.length - OUTPUT_TAIL_LINES + slot] ?? "",
  }));
  return (
    <pre
      className={cn(
        "mb-1 ms-7 overflow-hidden rounded-lg p-2.5 font-mono text-2xs leading-relaxed select-text",
        failed ? "bg-error-surface text-error-foreground" : "bg-code text-code-foreground",
      )}
    >
      {rows.map(({ slot, line }) => (
        <div key={slot} className="truncate whitespace-pre">
          {line.length === 0 ? "\u00a0" : line}
        </div>
      ))}
    </pre>
  );
}

function SetupDetails({ snapshot }: { snapshot: WorktreeSetupSnapshot }) {
  return (
    <dl className="mt-1 mb-1.5 ms-7 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {snapshot.branch ? (
        <>
          <dt className="text-foreground">Branch</dt>
          <dd className="min-w-0 font-mono">
            <MiddleTruncate value={snapshot.branch} className="flex" />
          </dd>
        </>
      ) : null}
      {snapshot.baseRef ? (
        <>
          <dt className="text-foreground">Base</dt>
          <dd className="min-w-0 font-mono">
            <MiddleTruncate value={snapshot.baseRef} className="flex" />
          </dd>
        </>
      ) : null}
      {snapshot.worktreePath ? (
        <>
          <dt className="text-foreground">Path</dt>
          <dd className="min-w-0 font-mono">
            <MiddleTruncate value={snapshot.worktreePath} className="flex" />
          </dd>
        </>
      ) : null}
      {snapshot.setupScript ? (
        <>
          <dt className="text-foreground">Setup</dt>
          <dd className="truncate font-mono">{snapshot.setupScript.command}</dd>
        </>
      ) : null}
    </dl>
  );
}

function CollapsedSummaryRow({
  snapshot,
  totalElapsed,
}: {
  snapshot: WorktreeSetupSnapshot;
  totalElapsed: number | null;
}) {
  const status: WorktreeSetupStage["status"] =
    snapshot.phase === "failed" || snapshot.phase === "cancelled"
      ? "failed"
      : snapshot.stages.some((stage) => stage.id === "setup-script" && stage.status === "failed")
        ? "failed"
        : "done";
  const label = headerLabel(snapshot);
  return (
    <WorkLogRow
      data-worktree-setup-stage="summary"
      data-worktree-setup-status={status}
      icon={
        <span className="text-icon-muted">
          <StageIcon status={status} />
        </span>
      }
      label={<span className={stageRowClassName(status)}>{label}</span>}
      trailing={
        totalElapsed !== null ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatDuration(totalElapsed)}
          </span>
        ) : null
      }
    />
  );
}

export function WorktreeSetupCard({
  snapshot,
  onCancel,
  onWorkLocally,
  onOpenTerminal,
  embedded = false,
}: WorktreeSetupCardProps & {
  embedded?: boolean;
}) {
  const running = snapshot.phase === "running";
  const nowMs = useNowWhile(running);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const totalElapsed = (() => {
    const start = Date.parse(snapshot.startedAt);
    const end = snapshot.endedAt ? Date.parse(snapshot.endedAt) : nowMs;
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
  })();
  const setupStage = snapshot.stages.find((stage) => stage.id === "setup-script");
  const showTerminal = onOpenTerminal && setupStage && setupStage.status !== "pending";
  const collapsed = embedded && !running;
  const showHeader = !embedded && !running && snapshot.phase !== "done";
  const showTail =
    setupStage !== undefined &&
    (setupStage.status === "failed" ||
      (setupStage.status === "running" && setupStage.tail.length > 0));

  return (
    <section
      aria-label="Worktree setup"
      data-worktree-setup-phase={snapshot.phase}
      className="group/worktree-setup"
    >
      {showHeader ? <SetupHeaderRow snapshot={snapshot} totalElapsed={totalElapsed} /> : null}
      {collapsed ? (
        <CollapsedSummaryRow snapshot={snapshot} totalElapsed={totalElapsed} />
      ) : (
        <div className={showHeader ? "pt-1.5" : undefined}>
          {snapshot.stages.map((stage) => (
            <div key={stage.id}>
              <StageRow
                stage={stage}
                nowMs={nowMs}
                scriptName={snapshot.setupScript?.name ?? null}
              />
              {stage.id === "setup-script" && showTail ? (
                <OutputTail lines={stage.tail} failed={stage.status === "failed"} />
              ) : null}
            </div>
          ))}
        </div>
      )}

      {snapshot.phase === "failed" && snapshot.error ? (
        <p className="mt-1 ms-7 text-xs text-muted-foreground">{snapshot.error}</p>
      ) : null}

      <div className="mt-0.5 ms-6 flex flex-wrap items-center gap-0.5">
        <span
          className={cn(
            !detailsOpen &&
              "opacity-0 group-focus-within/worktree-setup:opacity-100 group-hover/worktree-setup:opacity-100 pointer-coarse:opacity-100",
          )}
        >
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <DisclosureChevron open={detailsOpen} />
            Details
          </Button>
        </span>
        {showTerminal ? (
          <Button type="button" size="xs" variant="ghost-muted" onClick={onOpenTerminal}>
            <TerminalIcon aria-hidden />
            Open terminal
          </Button>
        ) : null}
        {onWorkLocally && running ? (
          <Button type="button" size="xs" variant="ghost-muted" onClick={onWorkLocally}>
            <LaptopIcon aria-hidden />
            Work locally
          </Button>
        ) : null}
        {onCancel && running ? (
          <Button type="button" size="xs" variant="ghost-muted" onClick={onCancel}>
            <XIcon aria-hidden />
            Cancel
          </Button>
        ) : null}
      </div>
      {detailsOpen ? <SetupDetails snapshot={snapshot} /> : null}
    </section>
  );
}
