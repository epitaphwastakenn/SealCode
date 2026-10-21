import { EnvironmentId } from "@t3tools/contracts";
import { createRef, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";

import { ReasoningTraceContent, SimpleWorkEntryRow } from "./TimelineWorkEntryRow";
import { TimelineRowActivityCtx, TimelineRowCtx, WorkGroupViewCtx } from "./timelineRowContext";

function renderContent(content: ReactNode) {
  return renderToStaticMarkup(
    <TimelineRowCtx
      value={{
        citationRequest: null,
        listRef: createRef(),
        timestampFormat: "locale",
        routeThreadKey: "reasoning-preview-regression",
        threadRef: null,
        markdownCwd: undefined,
        resolvedTheme: "light",
        workspaceRoot: undefined,
        skills: [],
        runs: [],
        activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
        onRevertToTurnCount: () => {},
        onUseArtifactTemplate: () => {},
        onSendAppMessage: undefined,
        onAppFullscreenChange: () => {},
        onRunShellCommand: undefined,
        findActive: false,
        onImageExpand: () => {},
        onOpenTurnDiff: () => {},
        onOpenThread: () => {},
        workflowOpening: null,
        onForkFromRun: async () => {},
        onRollbackCheckpoint: () => {},
        onToggleTurnFold: () => {},
        onToggleAttemptFold: () => {},
        onFileOpen: () => {},
        onFileDownload: () => {},
        openPullRequest: () => {},
        onToggleWorkGroup: () => {},
        onToggleWorkEntry: () => {},
        onCancelWorktreeSetup: null,
        retryableWorkspacePreparationRunIds: new Set(),
        onRetryWorkspacePreparation: null,
        onWorktreeSetupWorkLocally: null,
        onOpenWorktreeSetupTerminal: null,
        workGroupViewState: { scrollPositions: new Map(), expandedEntries: new Set() },
      }}
    >
      <TimelineRowActivityCtx
        value={{
          isWorking: false,
          isCompacting: false,
          isRevertingCheckpoint: false,
          activeTurnInProgress: false,
          awaitingUser: false,
          isPreparingWorktree: false,
          latestRunId: null,
          backgroundWorktreeSetup: null,
        }}
      >
        {content}
      </TimelineRowActivityCtx>
    </TimelineRowCtx>,
  );
}

it("renders the entire expanded reasoning trace, including content beyond the preview", () => {
  const detail = `Opening paragraph.\n\n${"plain **fragment** ".repeat(10_000)}\n\nFinal reasoning conclusion.`;
  const html = renderContent(<ReasoningTraceContent entries={[reasoningEntry(detail)]} />);

  expect(html).toContain("Opening paragraph.");
  expect(html.match(/<strong>fragment<\/strong>/g)).toHaveLength(10_000);
  expect(html).toContain("Final reasoning conclusion.");
});

function reasoningEntry(detail: string) {
  return {
    id: "reasoning-full-trace",
    createdAt: "2026-10-21T00:00:00.000Z",
    label: "Thought",
    tone: "thinking" as const,
    itemType: "reasoning" as const,
    toolLifecycleStatus: "completed" as const,
    detail,
  };
}

it("renders a compact reasoning row from a bounded prefix of a huge trace", () => {
  const prefix = "Opening **reasoning** with `code`.\n\n";
  const detail = `${prefix}${"plain **fragment** ".repeat(10_000)}\n\nFinal reasoning conclusion.`;
  const html = renderContent(
    <SimpleWorkEntryRow workEntry={reasoningEntry(detail)} workspaceRoot={undefined} />,
  );
  expect(html).toContain("Opening reasoning with code.");
  const visibleText = html.replace(/<[^>]*>/g, "");
  expect(visibleText).not.toContain("Final reasoning conclusion.");
  expect(visibleText.length).toBeLessThan(3_000);
});

it("renders full reasoning when the row is expanded", () => {
  const detail = `Opening paragraph.\n\n${"plain **fragment** ".repeat(10_000)}\n\nFinal reasoning conclusion.`;
  const entry = reasoningEntry(detail);
  const html = renderContent(
    <WorkGroupViewCtx
      value={{
        state: { scrollPositions: new Map(), expandedEntries: new Set([entry.id]) },
        onToggleEntry: () => {},
      }}
    >
      <SimpleWorkEntryRow workEntry={entry} workspaceRoot={undefined} />
    </WorkGroupViewCtx>,
  );
  expect(html.match(/<strong>fragment<\/strong>/g)).toHaveLength(10_000);
  expect(html.replace(/<[^>]*>/g, "")).toContain("Final reasoning conclusion.");
});

it.each([
  ["completed", "Thought"],
  ["inProgress", "Thinking"],
] as const)("keeps the empty %s reasoning fallback", (toolLifecycleStatus, fallback) => {
  const html = renderContent(
    <SimpleWorkEntryRow
      workEntry={{ ...reasoningEntry(""), toolLifecycleStatus }}
      workspaceRoot={undefined}
    />,
  );
  expect(html.replace(/<[^>]*>/g, "")).toContain(fallback);
});
