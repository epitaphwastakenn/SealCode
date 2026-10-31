import { shouldPreserveAssistantLineBreaks } from "@t3tools/shared/markdownPipeline";
import { type EnvironmentId, type RunId } from "@t3tools/contracts";
import { canForkProjectedAssistantItem } from "@t3tools/client-runtime/state/thread-workflows";
import { memo, use, useState } from "react";
import { type ChatMessage, type TurnDiffSummary } from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { ChatMarkdownAssetImage } from "./ChatMarkdownMedia";
import { ChevronDownIcon, GitForkIcon } from "lucide-react";
import { useAssetUrlState } from "../../assets/assetUrls";
import {
  buildTurnImagesPreview,
  turnImageTileCounts,
  type TurnImageResource,
} from "./turnImagesPreview";
import { Button } from "../ui/button";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { HtmlRenderFrame } from "./HtmlRenderFrame";
import { McpAppFrame } from "./McpAppFrame";
import { ChangedFilesCard } from "./ChangedFilesTree";
import { FileDiff } from "@pierre/diffs/react";
import { shouldRenderUnattributedDiffFallback } from "../../lib/checkpointAttribution";
import { useCheckpointDiff } from "../../lib/checkpointDiffState";
import {
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../../lib/diffRendering";
import { useFileContextMenuHandler } from "../../fileContextMenu";
import { useProject, useThreadShell } from "../../state/entities";
import { MessageCopyButton } from "./MessageCopyButton";
import { AssistantCitationSource } from "./AssistantCitationSource";
import { resolveAssistantMessageCopyState } from "./MessagesTimeline.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import { useV2ItemSupport } from "../../state/v2ItemSupport";
import { TimelineRowCtx, TimelineRowActivityCtx, type TimelineRow } from "./timelineRowContext";
import { MESSAGE_HEADING_LEVEL, MessageAuthorHeading } from "./TimelineRowParts";

export function AssistantTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const ctx = use(TimelineRowCtx);
  const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)");

  return (
    <>
      <div className="relative min-w-0 px-1 py-0.5">
        <MessageAuthorHeading>Harp</MessageAuthorHeading>
        {!row.showAssistantMeta && messageText.trim().length > 0 ? (
          <div
            aria-hidden
            className="mb-0.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground/70"
          >
            Agent response
          </div>
        ) : null}
        <div data-thread-find-text="true">
          <AssistantCitationSource
            messageId={row.message.id}
            {...(ctx.threadRef ? { threadRef: ctx.threadRef } : {})}
            itemKey={row.id}
            request={ctx.citationRequest}
            listRef={ctx.listRef}
          >
            <ChatMarkdown
              text={messageText}
              cwd={ctx.markdownCwd}
              threadRef={ctx.threadRef ?? undefined}
              isStreaming={Boolean(row.message.streaming)}
              lineBreaks={shouldPreserveAssistantLineBreaks(messageText)}
              skills={ctx.skills}
              headingLevelOffset={MESSAGE_HEADING_LEVEL}
              onUseArtifactTemplate={ctx.onUseArtifactTemplate}
              onRunShellCommand={ctx.onRunShellCommand}
              onImageExpand={ctx.onImageExpand}
            />
          </AssistantCitationSource>
        </div>
        {ctx.onOpenTurnDiff ? (
          <AssistantChangedFilesSection
            turnSummary={row.assistantTurnDiffSummary}
            routeThreadKey={ctx.routeThreadKey}
            resolvedTheme={ctx.resolvedTheme}
            onOpenTurnDiff={ctx.onOpenTurnDiff}
          />
        ) : null}
        {row.showAssistantMeta ? (
          <AssistantMessageMeta
            className="mt-1.5"
            projectedItem={row.projectedItem}
            message={row.message}
            showCopyButton={row.showAssistantCopyButton}
            copyStreaming={row.assistantCopyStreaming}
          />
        ) : null}
      </div>
    </>
  );
}

function AssistantForkButton({
  projectedItem,
}: {
  readonly projectedItem: NonNullable<Extract<TimelineRow, { kind: "message" }>["projectedItem"]>;
}) {
  const ctx = use(TimelineRowCtx);
  const [busy, setBusy] = useState(false);
  const support = useV2ItemSupport({
    environmentId: ctx.activeThreadEnvironmentId,
    sourceThreadId: projectedItem.sourceThreadId,
    sourceItemId: projectedItem.sourceItemId,
  });
  const canFork = canForkProjectedAssistantItem({
    projectedItem,
    capabilities: support.providerSession?.capabilities,
  });

  const onForkFromRun = ctx.onForkFromRun;
  if (!canFork || onForkFromRun === undefined || projectedItem.item.runId === null) return null;
  const runId = projectedItem.item.runId;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onForkFromRun({ sourceThreadId: projectedItem.sourceThreadId, runId }).finally(
                () => setBusy(false),
              );
            }}
            aria-label="Fork from this response"
          />
        }
      >
        <GitForkIcon className={cn("size-3", busy && "animate-pulse")} />
      </TooltipTrigger>
      <TooltipPopup side="top">Fork from this response</TooltipPopup>
    </Tooltip>
  );
}

export function AssistantMetaTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "assistant-meta" }>;
}) {
  return (
    <div className="px-1">
      <AssistantMessageMeta
        className="mt-0.5"
        projectedItem={row.projectedItem}
        message={row.message}
        showCopyButton={row.showAssistantCopyButton}
        copyStreaming={row.assistantCopyStreaming}
        alwaysVisible
      />
    </div>
  );
}

function AssistantMessageMeta({
  className,
  projectedItem,
  message,
  showCopyButton,
  copyStreaming,
  alwaysVisible = false,
}: {
  className?: string;
  projectedItem?: Extract<TimelineRow, { kind: "message" }>["projectedItem"];
  message: ChatMessage;
  showCopyButton: boolean;
  copyStreaming: boolean;
  alwaysVisible?: boolean;
}) {
  const ctx = use(TimelineRowCtx);

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs tabular-nums transition-opacity duration-200",
        alwaysVisible
          ? "opacity-100"
          : "opacity-0 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover/assistant:opacity-100",
        className,
      )}
    >
      {projectedItem && projectedItem.item.status !== "completed" ? (
        <span className="rounded-full border border-border/70 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground">
          {projectedItem.item.status}
        </span>
      ) : null}
      <AssistantCopyButton
        message={message}
        showCopyButton={showCopyButton}
        streaming={copyStreaming}
      />
      {projectedItem?.item.type === "assistant_message" ? (
        <AssistantForkButton projectedItem={projectedItem} />
      ) : null}
      {!message.streaming && (
        <Tooltip>
          <TooltipTrigger render={<p className="text-muted-foreground text-xs tabular-nums" />}>
            {formatDayAwareTimestamp(message.updatedAt, ctx.timestampFormat)}
          </TooltipTrigger>
          <TooltipPopup>
            {formatChatTimestampTooltip(message.updatedAt, ctx.timestampFormat)}
          </TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}

function AssistantCopyButton({
  message,
  showCopyButton,
  streaming,
}: {
  message: ChatMessage;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const assistantCopyState = resolveAssistantMessageCopyState({
    text: message.text ?? null,
    showCopyButton,
    streaming,
  });

  if (!assistantCopyState.visible) {
    return null;
  }

  return <MessageCopyButton text={assistantCopyState.text ?? ""} variant="ghost" />;
}

export function ProposedPlanTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "proposed-plan" }>;
}) {
  const ctx = use(TimelineRowCtx);

  return (
    <div className="min-w-0 px-1 py-0.5">
      <ProposedPlanCard
        planMarkdown={row.proposedPlan.planMarkdown}
        environmentId={ctx.activeThreadEnvironmentId}
        threadRef={ctx.threadRef ?? undefined}
        cwd={ctx.markdownCwd}
        workspaceRoot={ctx.workspaceRoot}
        findActive={ctx.findActive}
      />
    </div>
  );
}

/**
 * Screenshots an agent's tool took (Studio captures, browser shots), shown in the conversation
 * itself so the user follows what the agent sees without opening the work log.
 */
export function ToolImagesTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "tool-images" }>;
}) {
  const ctx = use(TimelineRowCtx);
  return (
    <div className="flex min-w-0 flex-wrap gap-2 px-1">
      {row.images.map((resource) => (
        <ChatMarkdownAssetImage
          key={`${resource.itemId}:${String(resource.index)}`}
          environmentId={ctx.activeThreadEnvironmentId}
          resource={resource}
          alt="Screenshot from the agent's tool"
          maxHeightRem={row.images.length === 1 ? 20 : 12}
          onImageExpand={ctx.onImageExpand}
        />
      ))}
    </div>
  );
}

export function TurnImagesTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "turn-images" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const collapsed = useUiStateStore(
    (store) =>
      store.timelineCollapsedGalleryRunIdsByThread[ctx.routeThreadKey]?.includes(row.runId) ??
      false,
  );
  const setCollapsed = useUiStateStore((store) => store.setTimelineGalleryCollapsed);
  const { shown, hidden } = turnImageTileCounts(row.images.length);
  const openViewer = (index: number) =>
    ctx.onImageExpand(buildTurnImagesPreview(ctx.activeThreadEnvironmentId, row.images, index));

  return (
    <div className="min-w-0 px-1">
      <Button
        type="button"
        size="xs"
        variant="ghost-muted"
        aria-expanded={!collapsed}
        data-scroll-anchor-ignore
        onClick={() => setCollapsed(ctx.routeThreadKey, row.runId, !collapsed)}
      >
        <ChevronDownIcon
          className={cn(
            "size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none",
            collapsed && "-rotate-90",
          )}
        />
        Screenshots
        <span className="text-2xs tabular-nums">{row.images.length}</span>
      </Button>
      {collapsed ? null : (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {row.images.slice(0, shown).map((resource, index) => (
            <TurnImageTile
              key={`${resource.itemId}:${String(resource.index)}`}
              environmentId={ctx.activeThreadEnvironmentId}
              resource={resource}
              label={`Open screenshot ${index + 1} of ${row.images.length}`}
              single={row.images.length === 1}
              overflow={index === shown - 1 ? hidden : 0}
              onOpen={() => openViewer(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TurnImageTile({
  environmentId,
  resource,
  label,
  single,
  overflow,
  onOpen,
}: {
  environmentId: EnvironmentId;
  resource: TurnImageResource;
  label: string;
  single: boolean;
  overflow: number;
  onOpen: () => void;
}) {
  const assetUrl = useAssetUrlState(environmentId, resource);
  const [failed, setFailed] = useState(false);
  const unavailable = assetUrl._tag === "Failure" || failed;

  return (
    <button
      type="button"
      aria-label={label}
      onClick={onOpen}
      className={cn(
        "relative shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        single ? "h-44 w-72" : "h-20 w-32",
      )}
    >
      {unavailable ? (
        <span className="flex size-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
          Image unavailable
        </span>
      ) : assetUrl._tag === "Success" ? (
        <img
          src={assetUrl.url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : null}
      {overflow > 0 ? (
        <span className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm font-medium tabular-nums text-foreground">
          +{overflow}
        </span>
      ) : null}
    </button>
  );
}

export function HtmlRenderTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "html-render" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const { onAppFullscreenChange } = ctx;
  const onFullscreenChange = (fullscreen: boolean) => onAppFullscreenChange(row.id, fullscreen);

  if (ctx.renderHtmlRender) {
    return <div className="min-w-0 px-1">{ctx.renderHtmlRender(row)}</div>;
  }
  return (
    <div className="min-w-0 px-1">
      <HtmlRenderFrame
        key={row.htmlRender.attachmentId}
        environmentId={ctx.activeThreadEnvironmentId}
        htmlRender={row.htmlRender}
        threadRef={ctx.threadRef ?? undefined}
        onFullscreenChange={onFullscreenChange}
      />
    </div>
  );
}

export function McpAppTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "mcp-app" }> }) {
  const ctx = use(TimelineRowCtx);
  const { awaitingUser } = use(TimelineRowActivityCtx);

  return (
    <div className="min-w-0 px-1">
      <McpAppFrame
        key={row.mcpApp.attachmentId}
        environmentId={ctx.activeThreadEnvironmentId}
        threadId={row.sourceThreadId}
        conversationThreadId={ctx.threadRef?.threadId ?? row.sourceThreadId}
        itemId={row.itemId}
        revision={row.revision}
        app={row.mcpApp}
        onSendMessage={ctx.onSendAppMessage}
        awaitingUser={awaitingUser}
        onFullscreenChange={(fullscreen) => ctx.onAppFullscreenChange(row.id, fullscreen)}
      />
    </div>
  );
}

/** Subscribes directly to the UI state store for expand/collapse state,
 *  so toggling re-renders only this component — not the entire list. */
const AssistantChangedFilesSection = memo(function AssistantChangedFilesSection({
  turnSummary,
  routeThreadKey,
  resolvedTheme,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary | undefined;
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  displayThreadKey?: string;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
}) {
  if (!turnSummary) return null;
  const checkpointFiles = turnSummary.files;
  if (shouldRenderUnattributedDiffFallback(turnSummary)) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-xs text-muted-foreground">
        <span>Changed files could not be attributed safely to this turn.</span>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => onOpenTurnDiff(turnSummary.runId)}
        >
          Open raw diff
        </Button>
      </div>
    );
  }
  if (checkpointFiles.length === 0) return null;

  return (
    <AssistantChangedFilesSectionInner
      turnSummary={turnSummary}
      checkpointFiles={checkpointFiles}
      routeThreadKey={routeThreadKey}
      resolvedTheme={resolvedTheme}
      onOpenTurnDiff={onOpenTurnDiff}
    />
  );
});

function AssistantChangedFilesSectionInner({
  turnSummary,
  checkpointFiles,
  routeThreadKey,
  resolvedTheme,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary;
  checkpointFiles: TurnDiffSummary["files"];
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  displayThreadKey?: string;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
}) {
  const ctx = use(TimelineRowCtx);
  const activity = use(TimelineRowActivityCtx);
  const persistedExpanded = useUiStateStore(
    (store) => store.threadChangedFilesExpandedById[routeThreadKey]?.[turnSummary.runId],
  );
  const setExpanded = useUiStateStore((store) => store.setThreadChangedFilesExpanded);
  const allDirectoriesExpanded = persistedExpanded ?? false;

  const thread = useThreadShell(ctx.threadRef);
  const activeProject = useProject(
    thread && thread.projectId
      ? { environmentId: thread.environmentId, projectId: thread.projectId }
      : null,
  );
  const onFileContextMenu = useFileContextMenuHandler(ctx.activeThreadEnvironmentId);

  const showInlineDiff = ctx.diffPresentation === "inline";
  const checkpointDiff = useCheckpointDiff(
    {
      environmentId: ctx.threadRef?.environmentId ?? null,
      threadId: ctx.threadRef?.threadId ?? null,
      fromTurnCount: Math.max(0, turnSummary.checkpointTurnCount - 1),
      toTurnCount: turnSummary.checkpointTurnCount,
      ignoreWhitespace: ctx.diffIgnoreWhitespace,
      cacheScope: `chat-turn:${turnSummary.runId}`,
    },
    { enabled: showInlineDiff },
  );
  const inlinePatch = getRenderablePatch(
    checkpointDiff.data?.diff,
    `chat-turn:${turnSummary.runId}`,
  );

  if (showInlineDiff) {
    return (
      <>
        {checkpointDiff.isPending ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Loading inline diff…</p>
        ) : null}
        {inlinePatch?.kind === "files" ? (
          <div className="mt-2 max-h-[32rem] space-y-2 overflow-auto rounded-xl border border-border/60 bg-code p-1">
            {inlinePatch.files.map((fileDiff) => (
              <FileDiff
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
        ) : null}
        {inlinePatch?.kind === "raw" ? (
          <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-code p-3 text-xs text-code-foreground">
            {inlinePatch.text}
          </pre>
        ) : null}
      </>
    );
  }

  return (
    <ChangedFilesCard
      runId={turnSummary.runId}
      files={checkpointFiles}
      allDirectoriesExpanded={allDirectoriesExpanded}
      resolvedTheme={resolvedTheme}
      onToggleAllDirectories={() =>
        setExpanded(routeThreadKey, turnSummary.runId, !allDirectoriesExpanded)
      }
      onOpenTurnDiff={onOpenTurnDiff}
      onReviewTurnDiff={ctx.onReviewTurnDiff}
      reviewDisabled={activity.isWorking}
      onFileContextMenu={(filePath, event) =>
        onFileContextMenu(
          {
            environmentId: ctx.activeThreadEnvironmentId,
            filePath,
            workspaceRoot: ctx.workspaceRoot,
            repositoryRoot:
              thread?.worktreePath == null
                ? activeProject?.repositoryIdentity?.rootPath
                : undefined,
          },
          event,
        )
      }
    />
  );
}
