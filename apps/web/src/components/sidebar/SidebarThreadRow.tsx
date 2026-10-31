import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { ThreadTerminalStatusButton } from "../ThreadStatusIndicators";
import { discardComposerDraft } from "../../lib/discardComposerDraft";
import { useSupportsMultiplePullRequests } from "~/hooks/useSupportsMultiplePullRequests";
import { resolveThreadCurrentPullRequestLink } from "@t3tools/client-runtime/thread-pull-requests";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { resolveSettledThreadTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import { type EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import {
  formatWorkingDurationLabel,
  resolveThreadProviderStack,
} from "@t3tools/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { presentThreadState } from "@t3tools/shared/statusPresentation";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentMachineKind,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  ArrowRightLeftIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  GitBranchIcon,
  MessageCircleQuestionIcon,
  PencilLineIcon,
  PinIcon,
  PinOffIcon,
  ShieldQuestionIcon,
  TerminalIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { useUiStateStore } from "../../uiStateStore";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { vcsEnvironment } from "../../state/vcs";
import { useEnvironmentQuery } from "../../state/query";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { formatRelativeTimeLabel, parseTimestampDate } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { cn } from "~/lib/utils";
import { textDirection } from "~/textDirection";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import {
  animateSidebarLayoutChanges,
  hasUnseenCompletion,
  resolveSidebarRowAccessibility,
  type SidebarDropVerb,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
  shouldRecedeSidebarThread,
  resolveWorkingStartedAt,
  useRetainedValue,
  useSidebarRowSubscriptionLease,
  setFileDragActive,
} from "../Sidebar.logic";
import { resolveLocalCheckoutBranchMismatch } from "../BranchToolbar.logic";
import {
  ThreadPullRequestBadgeControl,
  ThreadPullRequestsMiniList,
  ThreadWorktreeIndicator,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
  terminalStatusFromRunningIds,
  type TerminalStatusIndicator,
  useLinkedThreadPullRequest,
  ThreadSearchPullRequestNumber,
} from "../ThreadStatusIndicators";
import { useThreadShell } from "../../state/entities";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { ThreadSearchMatchExcerpt } from "../ThreadSearchMatch";
import { makeWorkspaceFileDropHandlers } from "../chat/workspaceFileDrop";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { useThreadRunningTerminalIds } from "../../state/terminalSessions";
import { Badge } from "../ui/badge";
import { InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MiddleTruncate } from "../ui/middle-truncate";
import { useThreadHasUnsentDraft } from "../../composerDraftStore";
import { SidebarRowAction, SidebarRowActionSlot } from "./SidebarRowAction";

// The fields thread rows show. Provider status pushes refresh `checkedAt`,
// status and auth on every provider; leaving those out keeps each
// environment's map, and every memoized row, stable across them.
export type SidebarProviderEntry = Pick<
  ProviderInstanceEntry,
  | "instanceId"
  | "driverKind"
  | "enabled"
  | "displayName"
  | "accentColor"
  | "acpRegistryAgentId"
  | "acpRegistryIconUrl"
  | "models"
>;
function compactSidebarTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

// Subscribes to the minute tick itself, so only the label re-renders each
// minute. The minute is passed as the clock so it is the formatter's input.
function RelativeTimeLabel(props: { timestamp: string | null }) {
  const nowMinute = useNowMinute();
  return props.timestamp === null
    ? null
    : compactSidebarTimeLabel(
        formatRelativeTimeLabel(props.timestamp, Date.parse(`${nowMinute}:00.000Z`)),
      );
}

function threadTimeTimestamp(thread: SidebarThreadSummary): string {
  return thread.latestUserMessageAt ?? thread.updatedAt;
}

function JumpHintBadge(props: { label: string }) {
  return (
    <Kbd aria-hidden className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2">
      {props.label}
    </Kbd>
  );
}

// Self-ticking via a text-node write, so working rows never commit through
// React once a second.
function WorkingDuration(props: { startedAt: string | null }) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
  // Mount time is close enough for the first frame; the interval keeps it current.
  const [mountedMs] = useState(() => Date.now());
  const textRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    const update = () => {
      if (textRef.current) {
        textRef.current.textContent = formatWorkingDurationLabel(Date.now() - startedMs);
      }
    };
    update();
    const id = window.setInterval(update, 1_000);
    return () => window.clearInterval(id);
  }, [startedMs]);
  if (Number.isNaN(startedMs)) return null;
  return (
    <span ref={textRef} className="tabular-nums">
      {formatWorkingDurationLabel(mountedMs - startedMs)}
    </span>
  );
}

function terminalProcessLabel(count: number): string {
  return `${count} terminal ${count === 1 ? "process" : "processes"} running`;
}

function SidebarProviderStack(props: {
  thread: SidebarThreadSummary;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
}) {
  const stack = resolveThreadProviderStack(props.thread);
  const currentInstanceId = stack[stack.length - 1]!;
  const currentEntry = props.providerEntryByInstanceId.get(currentInstanceId) ?? null;
  if (currentEntry === null) return null;
  const showInstanceBadge = shouldShowInstanceBadge(
    currentEntry,
    props.providerEntryByInstanceId.values(),
  );
  const current = (
    <ProviderInstanceIcon
      driverKind={currentEntry.driverKind}
      displayName={currentEntry.displayName}
      accentColor={currentEntry.accentColor}
      acpRegistryAgentId={currentEntry.acpRegistryAgentId}
      acpRegistryIconUrl={currentEntry.acpRegistryIconUrl}
      showBadge={showInstanceBadge}
      size="compact"
      iconClassName="opacity-60"
    />
  );
  if (stack.length === 1) {
    return <span className="inline-flex shrink-0 items-center">{current}</span>;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {stack.slice(0, -1).map((instanceId) => {
        const entry = props.providerEntryByInstanceId.get(instanceId);
        if (entry === undefined) return null;
        return (
          <ProviderInstanceIcon
            key={instanceId}
            driverKind={entry.driverKind}
            displayName={entry.displayName}
            acpRegistryAgentId={entry.acpRegistryAgentId}
            acpRegistryIconUrl={entry.acpRegistryIconUrl}
            iconClassName="size-3 opacity-35 grayscale"
          />
        );
      })}
      <span className="relative z-10 inline-flex items-center">{current}</span>
    </span>
  );
}

function SidebarThreadTooltip({
  thread,
  project,
  projectDisplayName,
  environmentLabel,
  environmentMachine,
  providerEntry,
  providerEntryByInstanceId,
  showInstanceBadge,
  modelInstanceId,
  modelLabel,
  branchMismatch,
  terminalStatus,
  terminalProcessCount,
}: {
  thread: SidebarThreadSummary;
  project: ProjectFaviconProject | null;
  projectDisplayName: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  providerEntry: SidebarProviderEntry | null;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  showInstanceBadge: boolean;
  modelInstanceId: string;
  modelLabel: string;
  branchMismatch: {
    threadBranch: string;
    currentBranch: string;
  } | null;
  terminalStatus: TerminalStatusIndicator | null;
  terminalProcessCount: number;
}) {
  const driverKind = providerEntry?.driverKind ?? null;
  const previousProviderNames = thread.providerInstanceHistory
    .filter((instanceId) => instanceId !== modelInstanceId)
    .map((instanceId) => providerEntryByInstanceId.get(instanceId)?.displayName ?? instanceId);
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(thread.environmentId);
  return (
    <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
      <ThreadHoverCard
        title={thread.title}
        footer={
          supportsMultiplePullRequests && thread.pullRequests.length > 0 ? (
            <div className="border-t border-border/50 pt-2 pl-0.5 text-xs text-muted-foreground">
              <ThreadPullRequestsMiniList pullRequests={thread.pullRequests} />
            </div>
          ) : null
        }
      >
        {projectDisplayName ? (
          <div className="flex min-w-0 items-center gap-2">
            {project ? <ProjectFavicon project={project} className="size-3 shrink-0" /> : null}
            <div className="min-w-0 truncate text-foreground">{projectDisplayName}</div>
          </div>
        ) : null}
        {environmentLabel ? (
          <div className="flex min-w-0 items-center gap-2">
            <EnvironmentMachineIcon
              kind={environmentMachine}
              className="size-3 shrink-0 stroke-muted-foreground"
            />
            <div className="min-w-0 truncate text-foreground">{environmentLabel}</div>
          </div>
        ) : null}
        {thread.branch ? (
          <div className="flex min-w-0 items-center gap-2">
            <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
            <MiddleTruncate value={thread.branch} className="flex" />
          </div>
        ) : null}
        {branchMismatch ? (
          <div className="flex min-w-0 items-start gap-2 text-warning-foreground">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
            <div className="min-w-0 flex-1 wrap-break-word">
              You're currently checked out on another branch.
            </div>
          </div>
        ) : null}
        {driverKind ? (
          <div className="flex min-w-0 items-center gap-2">
            <ProviderInstanceIcon
              driverKind={driverKind}
              displayName={
                providerEntry?.displayName ?? thread.runtime?.providerName ?? modelInstanceId
              }
              accentColor={providerEntry?.accentColor}
              acpRegistryAgentId={providerEntry?.acpRegistryAgentId}
              acpRegistryIconUrl={providerEntry?.acpRegistryIconUrl}
              showBadge={showInstanceBadge && providerEntry?.accentColor !== undefined}
              badgeContent="none"
              badgeClassName="h-2 min-w-2 px-0"
              iconClassName="size-3 shrink-0 grayscale opacity-60"
            />
            <div className="min-w-0 truncate text-foreground">
              {showInstanceBadge && providerEntry
                ? `${modelLabel} · ${providerEntry.displayName}`
                : modelLabel}
            </div>
          </div>
        ) : null}
        {previousProviderNames.length > 0 ? (
          <div className="flex min-w-0 items-center gap-2">
            <ArrowRightLeftIcon className="size-3 shrink-0 stroke-muted-foreground" />
            <div className="min-w-0 truncate text-foreground">
              Handed off from {previousProviderNames.join(", ")}
            </div>
          </div>
        ) : null}
        {terminalStatus ? (
          <div className="flex min-w-0 items-center gap-2">
            <TerminalIcon
              aria-hidden
              className={cn("size-3 shrink-0", terminalStatus.colorClass)}
            />
            <div className="min-w-0 truncate text-foreground">
              {terminalProcessLabel(terminalProcessCount)}
            </div>
          </div>
        ) : null}
        {thread.runtime?.lastError ? (
          <div
            className={cn(
              "flex min-w-0 items-center gap-2",
              thread.runtime.lastErrorClass === "usage_limit"
                ? "text-warning-foreground"
                : "text-error-foreground",
            )}
          >
            <CircleAlertIcon className="size-3 shrink-0 stroke-current" />
            <div className="min-w-0 truncate">
              {thread.runtime.lastErrorClass === "usage_limit"
                ? "Usage limit reached"
                : "Error occurred"}
            </div>
          </div>
        ) : null}
      </ThreadHoverCard>
    </ThreadHoverCardPopup>
  );
}

type SortableThreadRowBag = Pick<
  ReturnType<typeof useSortable>,
  "listeners" | "setNodeRef" | "transform" | "transition" | "isDragging"
>;

export const draftPenClassName = "size-3 shrink-0 text-sidebar-muted-foreground";

// useSortable memoizes on its `disabled` object, so a fresh one per render
// re-renders every row and marker on each sidebar update.
export const SIDEBAR_SORTABLE_DRAG_DISABLED = { draggable: true } as const;
const SIDEBAR_SORTABLE_DRAG_ENABLED = { draggable: false } as const;

// Takes the row's props rather than a render function: a closure from the
// sidebar body is new on every sidebar render, which rebuilt the bag and
// re-rendered every memoized row with it.
export function SortableThreadRow(
  props: Omit<SidebarThreadRowProps, "sortable"> & {
    sortableId: string;
    sortableDisabled: boolean;
    contextDrag: boolean;
  },
) {
  const { sortableId, sortableDisabled, contextDrag, ...rowProps } = props;
  const canOperateThread = useEnvironmentScope(
    rowProps.thread.environmentId,
    AuthOrchestrationOperateScope,
  );
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    disabled:
      sortableDisabled || !canOperateThread
        ? SIDEBAR_SORTABLE_DRAG_DISABLED
        : SIDEBAR_SORTABLE_DRAG_ENABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // dnd-kit memoizes each field but not the bag, so the memoized row would
  // rerender on every shell update without this.
  const bag = {
    listeners,
    setNodeRef,
    transform: contextDrag ? null : transform,
    transition: contextDrag && isDragging ? "transform 150ms ease-out" : transition,
    isDragging: isDragging && !contextDrag,
  };
  // The sidebar arranges rows from quiet shells, which hold still while a
  // thread streams; reading the live shell here re-renders only this row.
  const thread =
    useThreadShell(scopeThreadRef(rowProps.thread.environmentId, rowProps.thread.id)) ??
    rowProps.thread;
  // Keyed by variant so a card/slim switch remounts the row.
  return <SidebarThreadRow key={rowProps.variant} {...rowProps} thread={thread} sortable={bag} />;
}
export type SidebarSweepAction = "settle" | "unsettle" | "unsnooze";
const dropVerbBadge: Record<SidebarDropVerb, ReactNode> = {
  pin: (
    <>
      <PinIcon aria-hidden className="size-3" />
      Pin
    </>
  ),
  unpin: (
    <>
      <PinOffIcon aria-hidden className="size-3" />
      Unpin
    </>
  ),
  settle: (
    <>
      <CircleCheckIcon aria-hidden className="size-3" />
      Settle
    </>
  ),
  unsettle: (
    <>
      <Undo2Icon aria-hidden className="size-3" />
      Un-settle
    </>
  ),
  wake: (
    <>
      <AlarmClockOffIcon aria-hidden className="size-3" />
      Wake
    </>
  ),
};

type SidebarThreadRowProps = {
  thread: SidebarThreadSummary;
  variant: "card" | "slim";
  // Folder-grouped inbox rows use a one-line presentation so the sidebar stays
  // dense without changing the full pinned/working card treatment.
  compact: boolean;
  variantAction: SidebarSweepAction;
  settlementSupported: boolean;
  snoozeSupported: boolean;
  pinningSupported: boolean;
  isPinned: boolean;
  sortable?: SortableThreadRowBag | undefined;
  dropVerb: SidebarDropVerb | null;
  dragOverPinned: boolean;
  sweepAction: SidebarSweepAction | null;
  snoozeWakeLabelText: string | null;
  wokeAt: string | null;
  isActive: boolean;
  // Set on the active row only; scrolls it into view when a reveal is owed.
  revealRef?: ((row: HTMLElement, threadKey: string) => void) | undefined;
  // Unlike isActive, never true for the ancestor standing in for an open
  // subagent: drafts and PR clicks care about which composer is on screen.
  isRouteThread: boolean;
  openPullRequestsInRightPanel: boolean;
  jumpLabel: string | null;
  currentEnvironmentId: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  scratchMachineLabel: string | null;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  timestampFormat: TimestampFormat;
  onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  onThreadActivate: (threadRef: ScopedThreadRef) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancelRename: () => void;
  isRenaming: boolean;
  renamingTitle: string;
  onContextMenu: (threadRef: ScopedThreadRef, position: { x: number; y: number }) => void;
  onSettle: (threadRef: ScopedThreadRef) => void;
  onActionSweepStart: (
    threadRef: ScopedThreadRef,
    action: SidebarSweepAction,
    event: PointerEvent,
  ) => void;
  onUnsettle: (threadRef: ScopedThreadRef) => void;
  onUnsnooze: (threadRef: ScopedThreadRef) => void;
  onUnpin: (threadRef: ScopedThreadRef) => void;
  onAcknowledgeWoke: (threadRef: ScopedThreadRef, visitedAt: string) => void;
  onFileDropThreads?: ((threadRef: ScopedThreadRef, files: File[]) => void) | undefined;
};

// Mounted only while renaming, so each rename starts uncommitted.
function ThreadRenameInput(props: {
  title: string;
  onTitleChange: (title: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  // Enter and Escape blur the input as it unmounts; that blur must not commit again.
  const settledRef = useRef(false);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      settledRef.current = true;
      props.onCommit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      settledRef.current = true;
      props.onCancel();
    }
  };
  return (
    <Input
      autoFocus
      nativeInput
      size="compact"
      value={props.title}
      dir="auto"
      aria-label="Thread title"
      onChange={(event) => props.onTitleChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (!settledRef.current) props.onCommit();
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1"
    />
  );
}

type TopStatusIcon = "working" | "waiting" | "approval" | "input" | "failed" | "woke" | "done";

type TopStatus = { label: string; icon: TopStatusIcon; className: string };

const topStatusGlyphs = {
  working: CircleDashedIcon,
  waiting: CircleDotDashedIcon,
  approval: ShieldQuestionIcon,
  input: MessageCircleQuestionIcon,
  failed: CircleAlertIcon,
  woke: AlarmClockIcon,
  done: CircleCheckIcon,
} as const;

function resolveTopStatus(input: {
  thread: SidebarThreadSummary;
  status: ReturnType<typeof resolveSidebarThreadStatus>;
  isWoke: boolean;
  isUnread: boolean;
}): TopStatus | null {
  switch (input.status) {
    case "working":
      return {
        label:
          input.thread.goal?.status === "active" ? "Goal" : presentThreadState("working").label,
        icon: "working",
        className: "text-info-foreground",
      };
    case "waiting":
      return { label: "Waiting", icon: "waiting", className: "text-muted-foreground" };
    case "approval":
      return {
        label: presentThreadState("needs-approval").label,
        icon: "approval",
        className: "text-warning-foreground",
      };
    case "input":
      return {
        label: presentThreadState("needs-input").label,
        icon: "input",
        className: "text-brand",
      };
    case "limited":
      return { label: "Limited", icon: "failed", className: "text-warning-foreground" };
    case "failed":
      return {
        label: presentThreadState("failed").label,
        icon: "failed",
        className: "text-error-foreground",
      };
  }
  if (input.isWoke) return { label: "Woke", icon: "woke", className: "text-warning-foreground" };
  if (input.isUnread) {
    return {
      label: presentThreadState("completed").label,
      icon: "done",
      className: "text-success-foreground",
    };
  }
  return null;
}

const SidebarThreadRow = memo(function SidebarThreadRow(props: SidebarThreadRowProps) {
  const {
    isRenaming,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onAcknowledgeWoke,
    onFileDropThreads,
    onRenameTitleChange,
    onSettle,
    onActionSweepStart,
    onStartRename,
    onThreadActivate,
    onThreadClick,
    onUnsettle,
    onUnsnooze,
    onUnpin,
    openPullRequestsInRightPanel,
    renamingTitle,
    thread,
    variant,
    variantAction,
  } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const canOperateThread = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const { leaseLiveStatus, rowRef: leaseRowRef } = useSidebarRowSubscriptionLease(props.isActive);
  const { revealRef } = props;
  const rowRef = (row: HTMLElement | null) => {
    if (row !== null) revealRef?.(row, threadKey);
    return leaseRowRef(row);
  };
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const openPrLink = useOpenPrLink();
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const terminalProcessCount = runningTerminalIds.length;
  const hasUnsentDraft = useThreadHasUnsentDraft(threadRef) && !props.isRouteThread;
  const handleDiscardDraftClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    discardComposerDraft(threadRef);
  };

  const gitCwd = thread.worktreePath ?? props.project?.workspaceRoot ?? null;
  const linkedPullRequestStatus = useLinkedThreadPullRequest(
    thread.environmentId,
    thread.linkedPullRequest,
    leaseLiveStatus,
    thread.pullRequests,
    thread.branchPullRequest,
  );
  const gitStatus = useEnvironmentQuery(
    leaseLiveStatus && (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd, includeRemote: false },
        })
      : null,
  );
  const visibleGitStatus = useRetainedValue(
    JSON.stringify([thread.environmentId, gitCwd]),
    gitStatus.data,
  );
  const pr = linkedPullRequestStatus?.pr ?? null;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(thread.environmentId);
  const currentLinkedPr = supportsMultiplePullRequests
    ? resolveThreadCurrentPullRequestLink(thread.pullRequests)
    : null;

  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const status = resolveSidebarThreadStatus(thread);
  const lastVisitedDate = lastVisitedAt === undefined ? null : parseTimestampDate(lastVisitedAt);
  const wokeAtDate = props.wokeAt === null ? null : parseTimestampDate(props.wokeAt);
  const isWoke =
    wokeAtDate !== null &&
    (lastVisitedDate === null || lastVisitedDate < wokeAtDate) &&
    thread.settledOverride !== "settled";
  const shouldRecede =
    status !== "working" &&
    shouldRecedeSidebarThread({
      status,
      isUnread,
      isWoke,
      isActive: props.isActive,
      isSelected,
    });
  const isSettledRow = variantAction === "unsettle" && !props.isActive;
  const isQuietRow = shouldRecede || isSettledRow;
  const topStatus = resolveTopStatus({ thread, status, isWoke, isUnread });
  const isWokeStatus = topStatus?.icon === "woke";

  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: visibleGitStatus?.refName ?? null,
  });
  const prStatus = prStatusIndicator(pr, linkedPullRequestStatus?.sourceControlProvider);

  const modelInstanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : thread.modelSelection.model;

  const isRemote = thread.environmentId !== props.currentEnvironmentId;
  const showsScratchMachine = !thread.branch && props.scratchMachineLabel !== null;

  const detailsTooltip = (
    <SidebarThreadTooltip
      thread={thread}
      project={props.project}
      projectDisplayName={props.projectDisplayName}
      environmentLabel={props.environmentLabel}
      environmentMachine={props.environmentMachine}
      providerEntry={providerEntry}
      providerEntryByInstanceId={props.providerEntryByInstanceId}
      showInstanceBadge={showInstanceBadge}
      modelInstanceId={modelInstanceId}
      modelLabel={modelLabel}
      branchMismatch={branchMismatch}
      terminalStatus={terminalStatus}
      terminalProcessCount={terminalProcessCount}
    />
  );

  const handleClick = (event: ReactMouseEvent) => {
    onThreadClick(event, threadRef);
  };
  const handleAcknowledgeWokeClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (props.wokeAt === null) return;
    onAcknowledgeWoke(threadRef, props.wokeAt);
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    onContextMenu(threadRef, { x: event.clientX, y: event.clientY });
  };
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onThreadActivate(threadRef);
  };
  const handleDoubleClick = (event: ReactMouseEvent) => {
    if (
      !readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope) ||
      isRenaming ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    event.preventDefault();
    onStartRename(threadRef, thread.title);
  };
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDropHandlers = onFileDropThreads
    ? makeWorkspaceFileDropHandlers({
        setDragActive: (active) => setFileDragActive(setIsFileDragOver, active),
        addFiles: (files) => {
          onFileDropThreads(threadRef, files);
        },
        addFolders: () => {},
      })
    : null;
  const handleSettleClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onSettle(threadRef);
  };
  const handleActionPointerDown = (event: ReactPointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.stopPropagation();
    onActionSweepStart(threadRef, variantAction, event.nativeEvent);
  };
  const handleUnsettleClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnsettle(threadRef);
  };
  const handleUnsnoozeClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnsnooze(threadRef);
  };
  const handleUnpinClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnpin(threadRef);
  };
  const handlePrClick = (event: ReactMouseEvent<HTMLElement>, targetUrl?: string) => {
    const url = targetUrl ?? pr?.url ?? currentLinkedPr?.url;
    if (!url) return;
    const showInRightPanel = targetUrl !== undefined || openPullRequestsInRightPanel;
    const openedInRightPanel = openPrLink(event, url, showInRightPanel ? threadRef : undefined);
    if (openedInRightPanel && showInRightPanel && !props.isRouteThread) {
      onThreadActivate(threadRef);
    }
  };

  const rowSurfaceClassName = cn(
    "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-lg text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
    props.isActive
      ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border"
      : isSelected || props.sweepAction !== null
        ? "bg-sidebar-row-selected text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border"
        : shouldRecede
          ? "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
    isFileDragOver && "ring-1 ring-inset ring-brand/60",
    isFileDragOver && !props.isActive && !isSelected && "bg-sidebar-row-hover",
    props.sortable?.isDragging && "dropdown-glass text-sidebar-foreground opacity-100",
  );
  const sortable = props.sortable;
  const sortableRootProps = sortable
    ? {
        ref: sortable.setNodeRef,
        style: {
          transform: CSS.Translate.toString(sortable.transform),
          transition: sortable.transition,
          // A zero-height boundary also makes dnd-kit scale the source to
          // zero. Only projected peers use scaleY as a visibility sentinel.
          visibility:
            !sortable.isDragging && sortable.transform?.scaleY === 0
              ? ("hidden" as const)
              : undefined,
        },
        ...sortable.listeners,
      }
    : {};
  const destinationVerb = sortable?.isDragging
    ? props.dropVerb
    : props.sweepAction === "unsnooze"
      ? "wake"
      : props.sweepAction;
  const dragDestination =
    destinationVerb !== null ? (
      <Badge role="status" size="sm" variant="brand" className="pointer-events-none ml-auto">
        {dropVerbBadge[destinationVerb]}
      </Badge>
    ) : null;

  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    statusLabel: topStatus?.label ?? null,
    projectDisplayName: props.projectDisplayName,
    isActive: props.isActive,
  });

  const title =
    isRenaming && canOperateThread ? (
      <ThreadRenameInput
        title={renamingTitle}
        onTitleChange={onRenameTitleChange}
        onCommit={() => onCommitRename(threadRef, renamingTitle, thread.title)}
        onCancel={onCancelRename}
      />
    ) : (
      <span
        aria-hidden
        className={cn(
          "min-w-0 flex-1 truncate text-start text-sm transition-opacity motion-reduce:transition-none",
          shouldRecede ? "font-normal" : "font-medium",
          isQuietRow
            ? "text-secondary-label group-focus-within/sidebar-row:text-foreground group-hover/sidebar-row:text-foreground"
            : "text-foreground",
          isRegeneratingTitle && "opacity-50",
        )}
        dir={textDirection(thread.title)}
      >
        {thread.title}
      </span>
    );
  const accessibleTitle = isRenaming ? null : <span className="sr-only">{thread.title}</span>;

  const prBadgeShape = supportsMultiplePullRequests
    ? resolveThreadPullRequestBadge(thread.pullRequests)
    : null;
  const handlePrListClick = () => {
    useRightPanelStore.getState().open(threadRef, "pull-requests");
    if (!props.isRouteThread) onThreadActivate(threadRef);
  };
  const prBadge =
    prBadgeShape?.kind === "stack" || pr || currentLinkedPr ? (
      <ThreadPullRequestBadgeControl
        render={<InlineButton />}
        badge={prBadgeShape}
        pullRequests={thread.pullRequests}
        number={pr?.number ?? currentLinkedPr?.number}
        url={pr?.url ?? currentLinkedPr?.url}
        status={prStatus}
        onOpenList={handlePrListClick}
        onOpenPullRequest={handlePrClick}
      />
    ) : null;
  const terminalStatusIcon = (
    <ThreadTerminalStatusButton
      threadRef={threadRef}
      terminalIds={runningTerminalIds}
      onThreadActivate={onThreadActivate}
    />
  );
  const draftIndicator = hasUnsentDraft ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label="Unsent draft"
            data-testid={`sidebar-draft-indicator-${thread.id}`}
            className="inline-flex shrink-0 items-center"
          />
        }
      >
        <PencilLineIcon aria-hidden className={draftPenClassName} />
      </TooltipTrigger>
      <TooltipPopup side="top">Unsent draft</TooltipPopup>
    </Tooltip>
  ) : null;
  const showPin =
    props.isPinned && (!sortable?.isDragging || (props.dragOverPinned && props.dropVerb === null));
  const pinIndicator = showPin ? (
    props.pinningSupported && canOperateThread && !sortable?.isDragging ? (
      <SidebarRowAction label="Unpin thread" onClick={handleUnpinClick} className="group/unpin">
        <PinIcon
          aria-hidden
          className="group-hover/unpin:hidden group-focus-visible/unpin:hidden"
        />
        <PinOffIcon
          aria-hidden
          className="hidden group-hover/unpin:block group-focus-visible/unpin:block"
        />
      </SidebarRowAction>
    ) : (
      <PinIcon
        aria-label="Pinned"
        role="img"
        className="size-3 shrink-0 text-sidebar-muted-foreground"
      />
    )
  ) : null;

  const wokeDismiss = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Dismiss Woke notification"
            onClick={handleAcknowledgeWokeClick}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-md text-xs font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
              topStatus?.className,
            )}
          >
            <AlarmClockIcon aria-hidden className="size-3.5 shrink-0" />
            <span role="status">{topStatus?.label}</span>
          </button>
        }
      />
      <TooltipPopup side="top">Dismiss Woke notification</TooltipPopup>
    </Tooltip>
  );
  const StatusGlyph = topStatus ? topStatusGlyphs[topStatus.icon] : null;
  const statusLabel =
    topStatus && StatusGlyph ? (
      isWokeStatus ? (
        wokeDismiss
      ) : (
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1 text-xs font-medium",
            topStatus.className,
          )}
        >
          <StatusGlyph aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{topStatus.label}</span>
          {status === "working" ? (
            <span aria-hidden className="shrink-0">
              <WorkingDuration startedAt={resolveWorkingStartedAt(thread)} />
            </span>
          ) : status === "waiting" ? (
            <span aria-hidden className="shrink-0">
              <WorkingDuration startedAt={thread.latestRun?.completedAt ?? null} />
            </span>
          ) : null}
        </span>
      )
    ) : null;
  const timeLabel = (
    <span className="text-xs tabular-nums text-secondary-label">
      <RelativeTimeLabel
        timestamp={
          variantAction === "unsettle"
            ? resolveSettledThreadTimestamp(thread)
            : threadTimeTimestamp(thread)
        }
      />
    </span>
  );

  if (variant === "slim" || props.compact) {
    const lineStatus =
      variantAction === "unsnooze" && props.snoozeWakeLabelText !== null ? (
        <span className="inline-flex items-center gap-1 text-xs tabular-nums text-info-foreground">
          <AlarmClockIcon aria-hidden className="size-3" />
          {props.snoozeWakeLabelText}
        </span>
      ) : (
        (statusLabel ?? timeLabel)
      );
    const lineAction =
      variantAction === "unsnooze"
        ? props.snoozeSupported
          ? { label: "Wake thread now", Icon: AlarmClockOffIcon, onClick: handleUnsnoozeClick }
          : null
        : !props.settlementSupported
          ? null
          : variantAction === "unsettle"
            ? { label: "Un-settle thread", Icon: Undo2Icon, onClick: handleUnsettleClick }
            : { label: "Settle thread", Icon: CheckIcon, onClick: handleSettleClick };
    return (
      <li
        data-thread-item={threadKey}
        {...sortableRootProps}
        {...(fileDropHandlers ?? {})}
        className={cn(
          "list-none [content-visibility:auto]",
          props.compact
            ? "-mb-px ml-3 border-l border-sidebar-border/50 pb-px pl-1 [contain-intrinsic-size:auto_32px]"
            : "[contain-intrinsic-size:auto_36px]",
          sortable?.isDragging && "relative z-20",
        )}
      >
        <Tooltip disabled={sortable?.isDragging}>
          <TooltipTrigger
            render={
              <div
                ref={rowRef}
                role="button"
                tabIndex={0}
                aria-label={accessibility.label}
                aria-current={accessibility.current}
                data-testid={props.compact ? "sidebar-row-compact" : "sidebar-row-slim"}
                aria-busy={isRegeneratingTitle || undefined}
                className={cn(
                  rowSurfaceClassName,
                  "flex items-center gap-2 px-(--sidebar-row-content-inset)",
                  props.compact ? "h-8" : "h-9",
                )}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                onContextMenu={handleContextMenu}
              />
            }
          >
            {accessibleTitle}
            {props.compact ? null : (
              <span
                className={cn(
                  "flex shrink-0 items-center transition-opacity",
                  isQuietRow &&
                    "opacity-40 grayscale group-focus-within/sidebar-row:opacity-100 group-focus-within/sidebar-row:grayscale-0 group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
                )}
              >
                {props.project ? (
                  <ProjectFavicon project={props.project} className="size-4" />
                ) : null}
              </span>
            )}
            {draftIndicator}
            {title}
            {pinIndicator}
            {terminalStatusIcon}
            {isRegeneratingTitle ? (
              <span role="status" className="sr-only">
                Regenerating title
              </span>
            ) : null}
            {props.compact ? prBadge : null}
            {sortable?.isDragging ? (
              dragDestination
            ) : (
              <span
                className={cn(
                  "relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end gap-1.5",
                  props.sweepAction !== null && "hidden",
                )}
              >
                {props.compact ? (
                  <SidebarProviderStack
                    thread={thread}
                    providerEntryByInstanceId={props.providerEntryByInstanceId}
                  />
                ) : null}
                <span
                  className={cn(
                    "inline-flex min-w-0 max-w-32 justify-end transition-opacity",
                    !isWoke && "group-any-hover/sidebar-row:opacity-0",
                  )}
                >
                  {lineStatus}
                </span>
                {lineAction ? (
                  <SidebarRowActionSlot
                    className={cn(
                      "absolute inset-y-0 right-0 flex items-center",
                      isWoke && "group-any-hover/sidebar-row:static",
                    )}
                  >
                    <SidebarRowAction
                      label={lineAction.label}
                      onClick={lineAction.onClick}
                      onPointerDown={handleActionPointerDown}
                    >
                      <lineAction.Icon aria-hidden className="size-3.5" />
                    </SidebarRowAction>
                  </SidebarRowActionSlot>
                ) : null}
              </span>
            )}
            {props.sweepAction !== null ? dragDestination : null}
            {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
          </TooltipTrigger>
          {detailsTooltip}
        </Tooltip>
      </li>
    );
  }

  const metaLineEmpty =
    !thread.branch &&
    !showsScratchMachine &&
    prBadge === null &&
    !isRemote &&
    runningTerminalIds.length === 0;
  const providerStack = (
    <SidebarProviderStack
      thread={thread}
      providerEntryByInstanceId={props.providerEntryByInstanceId}
    />
  );

  return (
    <li
      data-thread-item={threadKey}
      {...sortableRootProps}
      {...(fileDropHandlers ?? {})}
      className={cn(
        "list-none py-0.5 [content-visibility:auto]",
        metaLineEmpty ? "[contain-intrinsic-size:auto_58px]" : "[contain-intrinsic-size:auto_78px]",
        sortable?.isDragging && "relative z-20",
      )}
    >
      <Tooltip disabled={sortable?.isDragging}>
        <TooltipTrigger
          render={
            <div
              ref={rowRef}
              role="button"
              tabIndex={0}
              aria-label={accessibility.label}
              aria-current={accessibility.current}
              data-testid="sidebar-row-card"
              aria-busy={isRegeneratingTitle || undefined}
              className={rowSurfaceClassName}
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
            />
          }
        >
          {accessibleTitle}
          <div className="relative z-10 px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)">
            <div className="flex h-5 min-w-0 items-center gap-1.5">
              {draftIndicator}
              {props.project ? (
                <ProjectFavicon project={props.project} className="size-4 shrink-0" />
              ) : null}
              {/* Left of the status slot, the pin would slide when hover swaps the
                label for the wider row controls. */}
              {pinIndicator}
              {props.projectDisplayName ? (
                <span className="min-w-0 flex-1 truncate text-xs font-normal text-secondary-label">
                  {props.projectDisplayName}
                </span>
              ) : (
                <span className="flex-1" />
              )}
              {sortable?.isDragging ? (
                dragDestination
              ) : (
                <span
                  className={cn(
                    "group/sidebar-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs",
                    props.sweepAction !== null && "hidden",
                  )}
                >
                  <span
                    className={cn(
                      isWokeStatus
                        ? "pointer-events-auto"
                        : "pointer-events-none group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0 group-any-hover/sidebar-row:absolute group-any-hover/sidebar-row:right-0 group-any-hover/sidebar-row:opacity-0",
                      "flex items-center self-center justify-self-end tabular-nums text-secondary-label transition-opacity",
                    )}
                  >
                    {statusLabel ?? <RelativeTimeLabel timestamp={threadTimeTimestamp(thread)} />}
                  </span>
                  {props.settlementSupported || hasUnsentDraft ? (
                    <SidebarRowActionSlot className="absolute inset-y-0 right-0 flex items-center gap-0.5 has-[:focus-visible]:static group-any-hover/sidebar-row:static">
                      {hasUnsentDraft ? (
                        <SidebarRowAction label="Discard draft" onClick={handleDiscardDraftClick}>
                          <XIcon aria-hidden className="size-3.5" />
                        </SidebarRowAction>
                      ) : null}
                      {props.settlementSupported ? (
                        <SidebarRowAction
                          label="Settle thread"
                          onClick={handleSettleClick}
                          onPointerDown={handleActionPointerDown}
                        >
                          <CheckIcon aria-hidden className="size-3.5" />
                        </SidebarRowAction>
                      ) : null}
                    </SidebarRowActionSlot>
                  ) : null}
                </span>
              )}
              {props.sweepAction !== null ? dragDestination : null}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              {title}
              {isRegeneratingTitle ? (
                <span role="status" className="sr-only">
                  Regenerating title
                </span>
              ) : null}
              {metaLineEmpty ? (
                <span aria-hidden className="inline-flex shrink-0">
                  {providerStack}
                </span>
              ) : null}
            </div>
            {metaLineEmpty ? null : (
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-secondary-label">
                {thread.branch ? (
                  <>
                    <ThreadWorktreeIndicator thread={thread} />
                    <span className="flex min-w-0 flex-1">
                      <MiddleTruncate value={thread.branch} showTitle={false} />
                    </span>
                  </>
                ) : showsScratchMachine ? (
                  <>
                    <EnvironmentMachineIcon
                      aria-hidden
                      kind={props.environmentMachine}
                      className="size-3 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{props.scratchMachineLabel}</span>
                  </>
                ) : (
                  <span className="flex-1" />
                )}
                {terminalStatusIcon}
                {prBadge}
                <span
                  aria-hidden
                  className="pointer-events-none ml-auto inline-flex shrink-0 items-center gap-1"
                >
                  {isRemote && !showsScratchMachine ? (
                    <span className="inline-flex shrink-0 items-center text-sidebar-muted-foreground">
                      <EnvironmentMachineIcon
                        aria-hidden
                        kind={props.environmentMachine}
                        className="size-3.5"
                      />
                    </span>
                  ) : null}
                  {providerStack}
                </span>
              </div>
            )}
          </div>
          {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
        </TooltipTrigger>
        {detailsTooltip}
      </Tooltip>
    </li>
  );
});

// Attached only to the highlighted result, so React calls it each time the
// highlight lands on a different row: a new query, late rows replacing the first
// result, or arrow keys moving past the scrolled edge.
const scrollHighlightedResultIntoView = (node: HTMLLIElement | null) => {
  node?.scrollIntoView({ block: "nearest" });
};

export const SidebarSearchResultRow = memo(function SidebarSearchResultRow(props: {
  isSettled: boolean;
  thread: SidebarThreadSummary;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  isHighlighted: boolean;
  isRouteActive: boolean;
  resultId: string;
  searchMatch: EnvironmentThreadSearchMatch | null;
  searchQuery: string;
  /** The query `searchMatch` was found for, which lags `searchQuery` while a search runs. */
  searchMatchQuery?: string;
  onHighlight: () => void;
  onSelect: () => void;
  onFileDropThreads: (threadRef: ScopedThreadRef, files: File[]) => void;
}) {
  const thread =
    useThreadShell(scopeThreadRef(props.thread.environmentId, props.thread.id)) ?? props.thread;
  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    statusLabel: null,
    projectDisplayName: props.projectDisplayName,
    isActive: props.isRouteActive,
  });
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const { leaseLiveStatus, rowRef } = useSidebarRowSubscriptionLease(
    props.isHighlighted || props.isRouteActive,
  );
  const gitCwd = thread.worktreePath ?? props.project?.workspaceRoot ?? null;
  const gitStatus = useEnvironmentQuery(
    leaseLiveStatus && (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd, includeRemote: false },
        })
      : null,
  );
  const visibleGitStatus = useRetainedValue(
    JSON.stringify([thread.environmentId, gitCwd]),
    gitStatus.data,
  );
  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: visibleGitStatus?.refName ?? null,
  });
  const modelInstanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : thread.modelSelection.model;
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const onFileDropThreads = props.onFileDropThreads;
  const fileDropHandlers = makeWorkspaceFileDropHandlers({
    setDragActive: (active) => setFileDragActive(setIsFileDragOver, active),
    addFiles: (files) => {
      onFileDropThreads(threadRef, files);
    },
    addFolders: () => {},
  });
  return (
    <li
      ref={props.isHighlighted ? scrollHighlightedResultIntoView : undefined}
      role="presentation"
      className="list-none"
      {...fileDropHandlers}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              ref={rowRef}
              id={props.resultId}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={props.isHighlighted}
              aria-current={accessibility.current}
              aria-describedby={`${props.resultId}-pr`}
              aria-label={accessibility.label}
              onMouseMove={props.onHighlight}
              onClick={props.onSelect}
              className={cn(
                "group/sidebar-row group/v2-row flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-(--sidebar-row-content-inset) py-1 text-left text-sm outline-none",
                props.isRouteActive
                  ? "bg-sidebar-row-active text-sidebar-foreground"
                  : props.isHighlighted
                    ? "bg-sidebar-row-hover text-sidebar-foreground"
                    : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                props.isHighlighted && "ring-1 ring-inset ring-ring/60",
                isFileDragOver && "ring-1 ring-inset ring-brand/60",
                isFileDragOver && !props.isRouteActive && "bg-sidebar-row-hover",
              )}
            />
          }
        >
          {props.project ? (
            <ProjectFavicon
              project={props.project}
              className={cn(
                "size-4 shrink-0 transition-opacity",
                props.isSettled &&
                  !props.isRouteActive &&
                  !props.isHighlighted &&
                  "opacity-40 grayscale group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
              )}
            />
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  props.isSettled
                    ? "font-normal text-secondary-label group-hover/sidebar-row:text-foreground"
                    : "font-medium text-foreground",
                  (props.isHighlighted || props.isRouteActive) && "text-foreground",
                  thread.titleRegeneration != null && "opacity-50",
                )}
              >
                {thread.title}
              </span>
              <span id={`${props.resultId}-pr`} className="contents">
                <ThreadSearchPullRequestNumber
                  thread={thread}
                  query={props.searchQuery}
                  enabled={leaseLiveStatus}
                  settled={props.isSettled}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-xs text-secondary-label tabular-nums">
                <RelativeTimeLabel timestamp={threadTimeTimestamp(thread)} />
              </span>
            </span>
            {props.searchMatch ? (
              <ThreadSearchMatchExcerpt
                match={{
                  source: props.searchMatch.source,
                  snippet: props.searchMatch.snippet,
                  query: props.searchMatchQuery ?? props.searchQuery,
                }}
              />
            ) : null}
          </span>
        </TooltipTrigger>
        <SidebarThreadTooltip
          thread={thread}
          project={props.project}
          projectDisplayName={props.projectDisplayName}
          environmentLabel={props.environmentLabel}
          environmentMachine={props.environmentMachine}
          providerEntry={providerEntry}
          providerEntryByInstanceId={props.providerEntryByInstanceId}
          showInstanceBadge={showInstanceBadge}
          modelInstanceId={modelInstanceId}
          modelLabel={modelLabel}
          branchMismatch={branchMismatch}
          terminalStatus={terminalStatus}
          terminalProcessCount={runningTerminalIds.length}
        />
      </Tooltip>
    </li>
  );
});
