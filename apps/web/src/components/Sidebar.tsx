import { autoAnimate } from "@formkit/auto-animate";
import { useAtomValue } from "@effect/atom-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  canSnooze,
  effectiveSettled,
  effectiveSnoozed,
  threadWokeAt,
} from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { ModelSelection, ScopedThreadRef } from "@t3tools/contracts";
import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  GripVerticalIcon,
  EllipsisIcon,
  MessageSquareIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SquarePenIcon,
  TerminalIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useParams, useRouter } from "@tanstack/react-router";

import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isElectron } from "../env";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { useShortcutModifierState } from "../shortcutModifierState";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isMacPlatform } from "~/lib/utils";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { readLocalApi } from "../localApi";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import {
  legacyProjectCwdPreferenceKey,
  resolveProjectExpanded,
  useUiStateStore,
} from "../uiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useThreadActions } from "../hooks/useThreadActions";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { openCommandPalette } from "../commandPaletteBus";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { useClientSettings } from "../hooks/useSettings";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useNowMinute } from "../hooks/useNowMinute";
import {
  DeleteThreadConfirmDialog,
  ThreadActionMenu,
  useThreadDeleteConfirmation,
} from "./threadActionMenu";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useThreadShells } from "../state/entities";
import { environmentServerConfigsAtom, primaryServerKeybindingsAtom } from "../state/server";
import { vcsEnvironment } from "../state/vcs";
import { threadEnvironment } from "../state/threads";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { formatRelativeTimeLabel, parseTimestampDate } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";
import { cn } from "~/lib/utils";
import { buildThreadActionMenuItems } from "./threadActionMenu.logic";
import {
  buildBulkTitleRegenerationContextMenuItem,
  formatWorkingDurationLabel,
  firstValidTimestampMs,
  hasUnseenCompletion,
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  planPinnedReorder,
  resolveAdjacentThreadId,
  resolveSettledTimestamp,
  resolveSidebarThreadStatus,
  searchSidebarThreadsByTitle,
  resolveWorkingStartedAt,
  sortLogicalProjectsForSidebar,
  sortPinnedThreadsForSidebar,
  sortSettledThreadsForSidebar,
  sortThreadsForSidebar,
} from "./Sidebar.logic";
import { resolveLocalCheckoutBranchMismatch } from "./BranchToolbar.logic";
import {
  prStatusIndicator,
  resolveThreadPr,
  settledPrHoverColorClass,
  terminalStatusFromRunningIds,
  type TerminalStatusIndicator,
} from "./ThreadStatusIndicators";
import {
  resolveSnoozePresets,
  snoozeWakeDescription,
  snoozeWakeLabel,
  type SnoozePreset,
} from "./Sidebar.snooze";
import { ProjectFavicon } from "./ProjectFavicon";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "./chat/providerIconUtils";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../providerInstances";
import { useThreadRunningTerminalIds } from "../state/terminalSessions";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { presentThreadState } from "@t3tools/shared/statusPresentation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { SidebarContent, SidebarGroup, SidebarMenuButton, useSidebar } from "./ui/sidebar";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { useComposerDraftStore } from "../composerDraftStore";

// Settled-tail paging: recent history is the common lookup; the deep tail
// stays behind an explicit Show more.
const SETTLED_TAIL_INITIAL_COUNT = 10;
const SETTLED_TAIL_PAGE_COUNT = 25;

function compactSidebarTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

function threadTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt;
  return compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

function projectExpansionPreferenceKeys(project: SidebarProjectSnapshot): string[] {
  return [
    project.projectKey,
    ...project.memberProjects.map((member) => member.physicalProjectKey),
    ...project.memberProjects.map((member) => legacyProjectCwdPreferenceKey(member.workspaceRoot)),
  ];
}

function folderDragId(projectKey: string): string {
  return `folder:${projectKey}`;
}

function threadDragId(threadKey: string): string {
  return `thread:${threadKey}`;
}

function unprefixedDragId(id: string, prefix: "folder:" | "thread:"): string | null {
  return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

// Settled rows read "how long ago did this wrap up", matching their sort
// key: both go through resolveSettledTimestamp so label and order can't
// disagree.
function settledTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = resolveSettledTimestamp(thread);
  return timestamp === null ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

// Floats at the row's right edge, vertically centered, while the jump
// modifier is held. An overlay pill instead of an inline slot: the hint
// must neither displace the status/time label (holding ⌘ used to blank
// out "Working") nor shift any layout when it appears. pointer-events-none
// so it never swallows clicks meant for the settle/un-settle buttons it
// can overlap.
function JumpHintBadge(props: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1.5 top-1/2 z-10 inline-flex h-5 -translate-y-1/2 items-center rounded-full border border-border/80 bg-background/95 px-1.5 font-mono text-[10px] font-medium tracking-tight text-foreground shadow-sm"
    >
      {props.label}
    </span>
  );
}

// Self-ticking via a text-node write so active rows do not commit through React every second.
function WorkingDuration(props: { startedAt: string | null }) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
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
    <span ref={textRef} className="font-mono tabular-nums">
      {formatWorkingDurationLabel(Date.now() - startedMs)}
    </span>
  );
}

function terminalProcessLabel(count: number): string {
  return `${count} terminal ${count === 1 ? "process" : "processes"} running`;
}

type SidebarModelUsage = {
  selection: ModelSelection;
  providerEntry: ProviderInstanceEntry | null;
  modelLabel: string;
};

function sidebarModelSelectionKey(selection: ModelSelection): string {
  return `${selection.instanceId}\u0000${selection.model}\u0000${JSON.stringify(selection.options ?? [])}`;
}

function resolveSidebarModelUsages(
  thread: SidebarThreadSummary,
  providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>,
): ReadonlyArray<SidebarModelUsage> {
  const selections = [...(thread.modelsUsed ?? []), thread.modelSelection];
  const seen = new Set<string>();
  const usages: SidebarModelUsage[] = [];

  for (const selection of selections) {
    const key = sidebarModelSelectionKey(selection);
    if (seen.has(key)) continue;
    seen.add(key);
    const providerEntry =
      providerEntryByInstanceId.get(`${thread.environmentId}:${selection.instanceId}`) ?? null;
    const model = providerEntry?.models.find((candidate) => candidate.slug === selection.model);
    usages.push({
      selection,
      providerEntry,
      modelLabel: model ? getTriggerDisplayModelLabel(model) : selection.model,
    });
  }

  return usages;
}

function SidebarModelUsageSummary(props: { usages: ReadonlyArray<SidebarModelUsage> }) {
  if (props.usages.length === 0) return null;
  const labels = props.usages.map((usage) => usage.modelLabel);
  const description = `Models used: ${labels.join(", ")}`;
  const iconUsages = props.usages.filter(
    (usage): usage is SidebarModelUsage & { providerEntry: ProviderInstanceEntry } =>
      usage.providerEntry !== null,
  );
  const providerIconUsages = iconUsages.filter((usage, index) => {
    const firstIndex = iconUsages.findIndex(
      (candidate) => candidate.providerEntry.driverKind === usage.providerEntry.driverKind,
    );
    return firstIndex === index;
  });

  return (
    <span
      data-testid="sidebar-model-usage-summary"
      aria-label={description}
      title={description}
      className="inline-flex shrink-0 items-center gap-1 text-sidebar-muted-foreground/70"
    >
      {providerIconUsages.slice(0, 3).map((usage) => (
        <span key={usage.providerEntry.driverKind} className="inline-flex">
          <ProviderInstanceIcon
            driverKind={usage.providerEntry.driverKind}
            displayName={usage.providerEntry.displayName}
            iconClassName="size-3.5"
          />
        </span>
      ))}
      {props.usages.length > 1 ? (
        <span className="ml-0.5 text-[10px] font-medium tabular-nums">{props.usages.length}</span>
      ) : null}
    </span>
  );
}

function SidebarThreadTooltip({
  thread,
  projectTitle,
  projectCwd,
  environmentLabel,
  modelUsages,
  branchMismatch,
  terminalStatus,
  terminalProcessCount,
}: {
  thread: SidebarThreadSummary;
  projectTitle: string | null;
  projectCwd: string | null;
  environmentLabel: string | null;
  modelUsages: ReadonlyArray<SidebarModelUsage>;
  branchMismatch: {
    threadBranch: string;
    currentBranch: string;
  } | null;
  terminalStatus: TerminalStatusIndicator | null;
  terminalProcessCount: number;
}) {
  return (
    <TooltipPopup
      side="right"
      align="start"
      sideOffset={4}
      variant="glass"
      className="max-w-80 text-left whitespace-normal [&_[data-slot=tooltip-viewport]]:p-0"
    >
      <div className="flex min-w-0 max-w-80 flex-col gap-2 p-[var(--floating-content-inset)]">
        <div className="min-w-0 truncate text-xs leading-none font-medium text-foreground">
          {thread.title}
        </div>
        <div className="grid gap-1.5 pl-0.5 text-xs text-muted-foreground">
          {projectTitle ? (
            <div className="flex min-w-0 items-center gap-2">
              <ProjectFavicon
                environmentId={thread.environmentId}
                cwd={projectCwd ?? ""}
                className="size-3 shrink-0 stroke-muted-foreground"
              />
              <div className="min-w-0 truncate text-foreground/75">{projectTitle}</div>
            </div>
          ) : null}
          {environmentLabel ? (
            <div className="flex min-w-0 items-center gap-2">
              <ServerIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <div className="min-w-0 truncate text-foreground/75">{environmentLabel}</div>
            </div>
          ) : null}
          {thread.branch ? (
            <div className="flex min-w-0 items-center gap-2">
              <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <div className="min-w-0 truncate text-foreground/75">{thread.branch}</div>
            </div>
          ) : null}
          {branchMismatch ? (
            <div className="flex min-w-0 items-start gap-2 text-warning">
              <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
              <div className="min-w-0 flex-1 wrap-break-word leading-5">
                You're currently checked out on another branch.
              </div>
            </div>
          ) : null}
          {modelUsages.length > 0 ? (
            <div className="grid min-w-0 gap-1">
              {modelUsages.map((usage) => (
                <div
                  key={sidebarModelSelectionKey(usage.selection)}
                  className="flex min-w-0 items-center gap-2"
                >
                  {usage.providerEntry ? (
                    <ProviderInstanceIcon
                      driverKind={usage.providerEntry.driverKind}
                      displayName={usage.providerEntry.displayName}
                      iconClassName="size-3 shrink-0 grayscale opacity-60"
                    />
                  ) : (
                    <span className="size-3 shrink-0 rounded-full bg-muted-foreground/40" />
                  )}
                  <div className="min-w-0 truncate text-foreground/75">{usage.modelLabel}</div>
                </div>
              ))}
            </div>
          ) : null}
          {terminalStatus ? (
            <div className="flex min-w-0 items-center gap-2">
              <TerminalIcon
                aria-hidden
                className={cn("size-3 shrink-0", terminalStatus.colorClass)}
              />
              <div className="min-w-0 truncate text-foreground/75">
                {terminalProcessLabel(terminalProcessCount)}
              </div>
            </div>
          ) : null}
          {thread.session?.lastError ? (
            <div className="flex min-w-0 items-center gap-2 text-red-600 dark:text-red-400">
              <CircleAlertIcon className="size-3 shrink-0 stroke-current" />
              <div className="min-w-0 truncate">Error occurred</div>
            </div>
          ) : null}
        </div>
      </div>
    </TooltipPopup>
  );
}

// Subset of useSortable applied to a pinned card's root <li>. Listeners go
// on the whole card (no dedicated handle): the pointer sensor's distance
// constraint keeps plain clicks working, and we skip dnd-kit's aria
// attributes since there is no keyboard sensor and the card body already
// carries its own button semantics.
type SortablePinnedRowBag = Pick<
  ReturnType<typeof useSortable>,
  "listeners" | "setNodeRef" | "transform" | "transition" | "isDragging"
>;

function SortablePinnedThreadRow(props: {
  id: string;
  children: (bag: SortablePinnedRowBag) => ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  return props.children({ listeners, setNodeRef, transform, transition, isDragging });
}

function SortableSidebarFolder(props: {
  id: string;
  label: string;
  threadCount: number;
  expanded: boolean;
  pinned: boolean;
  onToggle: () => void;
  onTogglePinned: () => void;
  onCreateThread: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn("list-none", isDragging && "z-20 opacity-80")}
    >
      <div className="group/sidebar-folder flex min-h-10 min-w-0 items-center gap-1 rounded-lg border border-transparent hover:border-sidebar-border/70 hover:bg-sidebar-row-hover">
        <button
          type="button"
          aria-expanded={props.expanded}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.9375rem] font-bold text-sidebar-foreground hover:text-sidebar-foreground"
          onClick={props.onToggle}
        >
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-transform",
              !props.expanded && "-rotate-90",
            )}
          />
          <FolderIcon aria-hidden className="size-5 shrink-0 text-sidebar-foreground/90" />
          <span className="min-w-0 flex-1 truncate">{props.label}</span>
          <span className="shrink-0 rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-sidebar-muted-foreground">
            {props.threadCount}
          </span>
        </button>
        <button
          type="button"
          aria-label={`Create thread in ${props.label}`}
          title={`Create thread in ${props.label}`}
          className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground/45 opacity-0 transition-opacity hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/sidebar-folder:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            props.onCreateThread();
          }}
        >
          <PlusIcon aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`${props.pinned ? "Unpin" : "Pin"} project ${props.label}`}
          aria-pressed={props.pinned}
          title={`${props.pinned ? "Unpin" : "Pin"} project`}
          className={cn(
            "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-opacity hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            props.pinned
              ? "text-primary"
              : "text-sidebar-muted-foreground/45 opacity-0 group-hover/sidebar-folder:opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation();
            props.onTogglePinned();
          }}
        >
          <PinIcon aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Reorder folder ${props.label}`}
          title="Drag to reorder folder"
          className="mr-1 inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-sidebar-muted-foreground/45 opacity-0 transition-opacity hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing group-hover/sidebar-folder:opacity-100"
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
        >
          <GripVerticalIcon aria-hidden className="size-3.5" />
        </button>
      </div>
      {props.expanded ? <ul className="flex flex-col gap-px pl-3">{props.children}</ul> : null}
    </li>
  );
}

const SidebarThreadRow = memo(function SidebarThreadRow(props: {
  thread: SidebarThreadSummary;
  variant: "card" | "slim";
  // Slim rows are either settled (action: un-settle) or merely quiet
  // (seen Ready threads — action: settle).
  variantAction: "settle" | "unsettle" | "unsnooze";
  // False on environments whose server predates thread.settle/unsettle:
  // the lifecycle affordances hide entirely rather than fail on click.
  settlementSupported: boolean;
  // Same contract for thread.snooze/unsnooze.
  snoozeSupported: boolean;
  // Renders the pin glyph. Pinned cards keep the full settle/snooze quick
  // actions: settling clears the pin server-side, and snoozing hides the
  // card until wake with the pin intact underneath. The glyph is also the
  // in-row pin state cue (the pinned block has no header), so it always
  // shows while pinned; it only becomes a clickable unpin quick-action once
  // the pinning capability is confirmed, and stays a passive marker while
  // the descriptor is not loaded. Pinning itself lives in the context menu.
  pinningSupported: boolean;
  isPinned: boolean;
  // Present only on pinned cards whose server supports reordering: dnd-kit
  // sortable bag applied to the card root so the whole card drags (the
  // pointer sensor's distance constraint keeps plain clicks working).
  sortable?: SortablePinnedRowBag | undefined;
  // Folder-grouped inbox rows use a single-line presentation so the sidebar
  // stays dense without changing the full pinned/shelf card treatment.
  compact?: boolean;
  // Compact wake countdown ("2h") for rows in the snoozed shelf.
  snoozeWakeLabelText: string | null;
  // When a snooze ended (timer or early wake); drives the Woke pill until
  // the user visits the thread.
  wokeAt: string | null;
  isActive: boolean;
  jumpLabel: string | null;
  currentEnvironmentId: string | null;
  environmentLabel: string | null;
  projectCwd: string | null;
  projectTitle: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
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
  onUnsettle: (threadRef: ScopedThreadRef) => Promise<boolean>;
  onUnsnooze: (threadRef: ScopedThreadRef) => void;
  onUnpin: (threadRef: ScopedThreadRef) => void;
  onAcknowledgeWoke: (threadRef: ScopedThreadRef, visitedAt: string) => void;
  onChangeRequestState: (threadKey: string, state: "open" | "closed" | "merged" | null) => void;
}) {
  const {
    isRenaming,
    onChangeRequestState,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onAcknowledgeWoke,
    onRenameTitleChange,
    onSettle,
    onStartRename,
    onThreadActivate,
    onThreadClick,
    onUnsettle,
    onUnsnooze,
    onUnpin,
    renamingTitle,
    thread,
    variant,
    variantAction,
  } = props;
  const threadRef = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );
  const threadKey = scopedThreadKey(threadRef);
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const openPrLink = useOpenPrLink();
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const terminalProcessCount = runningTerminalIds.length;

  const gitCwd = thread.worktreePath ?? props.projectCwd;
  const gitStatus = useEnvironmentQuery(
    (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const pr = resolveThreadPr({
    threadBranch: thread.branch,
    gitStatus: gitStatus.data,
  });
  const prState = pr?.state ?? null;

  // Same semantics as the legacy sidebar (never-visited counts as read):
  // switching sidebars must not light up every historical thread as unread.
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const status = resolveSidebarThreadStatus(thread);
  // A woken thread reappears at its original position (the sort is
  // deliberately static), so the pill has to carry the weight. Snoozing is
  // an explicit act, so the pill clears only when the user re-engages:
  // reading a completion-triggered wake, clicking the pill, sending a
  // message, settling, archiving — or finishing the work outright (merged
  // or closed PR). Timer wakes survive a mere visit. An unparseable visit
  // timestamp counts as never-visited — corrupt local data must not eat
  // the wake signal.
  const lastVisitedDate = lastVisitedAt === undefined ? null : parseTimestampDate(lastVisitedAt);
  const wokeAtDate = props.wokeAt === null ? null : parseTimestampDate(props.wokeAt);
  const isWoke =
    wokeAtDate !== null &&
    (lastVisitedDate === null || lastVisitedDate < wokeAtDate) &&
    prState !== "merged" &&
    prState !== "closed";
  // In-flight rows (working, or waiting on approval/input) fade as a whole:
  // there is nothing for the user to do yet, so prominence is reserved for
  // rows that need a human — done (unread), read-but-unsettled, failed, and
  // freshly woken. The status label keeps its hue, so waiting rows stay
  // findable. In-flight rows recede the same as read-ready ones (inbox-zero:
  // working threads aren't your problem yet) — only the colored status label
  // stands out.
  const isInFlight =
    status === "working" || status === "monitoring" || status === "approval" || status === "input";
  const shouldRecede =
    (status === "ready" || isInFlight) && !isUnread && !isWoke && !props.isActive && !isSelected;
  // Status hues follow the system-wide convention set by sidebar v1 and the
  // mobile Live Activity/widgets (amber approval, indigo input, sky working)
  // so a thread reads the same color everywhere it surfaces.
  const [isUnsettling, setIsUnsettling] = useState(false);
  const topStatus = isUnsettling
    ? null
    : status === "working"
      ? {
          label: presentThreadState("working").label,
          icon: "working" as const,
          // No shimmer: a label that animates forever is noise in a sidebar
          // full of them (and repaints every vsync on high-refresh displays).
          // Working is a background state, so it rests at the dim end of what
          // the old pulse cycled through; only the thread you have open gets
          // the label at full strength.
          className: cn("text-sky-600 dark:text-sky-400", !props.isActive && "opacity-75"),
        }
      : status === "monitoring"
        ? {
            // Monitoring is calm background presence, not active progress
            // (monitoring-pill D6), so it keeps the label at full strength.
            label: presentThreadState("monitoring").label,
            icon: null,
            className: "text-sky-600 dark:text-sky-400",
          }
        : status === "approval"
          ? {
              label: presentThreadState("needs-approval").label,
              icon: null,
              className: "text-amber-700 dark:text-amber-300",
            }
          : status === "input"
            ? {
                label: presentThreadState("needs-input").label,
                icon: null,
                className: "text-indigo-600 dark:text-indigo-300",
              }
            : status === "failed"
              ? {
                  label: presentThreadState("failed").label,
                  icon: null,
                  className: "text-red-700 dark:text-red-300",
                }
              : isWoke
                ? {
                    label: "Woke",
                    icon: "woke" as const,
                    className: "text-amber-700 dark:text-amber-300",
                  }
                : isUnread
                  ? {
                      label: presentThreadState("completed").label,
                      icon: "done" as const,
                      className: "text-emerald-700 dark:text-emerald-300",
                    }
                  : null;
  const isWokeStatus = topStatus?.icon === "woke";

  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: gitStatus.data?.refName ?? null,
  });
  const prStatus = prStatusIndicator(pr, gitStatus.data?.sourceControlProvider);
  const settledPrHoverClass = pr ? settledPrHoverColorClass(pr.state) : undefined;
  // Report the PR state up: the parent partitions rows with effectiveSettled,
  // and a merged/closed PR auto-settles a thread — data only rows have.
  useEffect(() => {
    onChangeRequestState(threadKey, prState);
  }, [onChangeRequestState, prState, threadKey]);

  const modelUsages = useMemo(
    () => resolveSidebarModelUsages(thread, props.providerEntryByInstanceId),
    [props.providerEntryByInstanceId, thread],
  );

  const isRemote =
    props.currentEnvironmentId !== null && thread.environmentId !== props.currentEnvironmentId;

  const detailsTooltip = (
    <SidebarThreadTooltip
      thread={thread}
      projectTitle={props.projectTitle}
      projectCwd={props.projectCwd}
      environmentLabel={props.environmentLabel}
      modelUsages={modelUsages}
      branchMismatch={branchMismatch}
      terminalStatus={terminalStatus}
      terminalProcessCount={terminalProcessCount}
    />
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent) => {
      onThreadClick(event, threadRef);
    },
    [onThreadClick, threadRef],
  );
  const handleAcknowledgeWokeClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (props.wokeAt === null) return;
      onAcknowledgeWoke(threadRef, props.wokeAt);
    },
    [onAcknowledgeWoke, props.wokeAt, threadRef],
  );
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      onContextMenu(threadRef, { x: event.clientX, y: event.clientY });
    },
    [onContextMenu, threadRef],
  );
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onThreadActivate(threadRef);
    },
    [onThreadActivate, threadRef],
  );
  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (isRenaming || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if ((event.target as HTMLElement).closest("button, a, input")) return;
      event.preventDefault();
      onStartRename(threadRef, thread.title);
    },
    [isRenaming, onStartRename, thread.title, threadRef],
  );
  const renameCommittedRef = useRef(false);
  useEffect(() => {
    if (isRenaming) renameCommittedRef.current = false;
  }, [isRenaming]);
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        renameCommittedRef.current = true;
        onCommitRename(threadRef, renamingTitle, thread.title);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renameCommittedRef.current = true;
        onCancelRename();
      }
    },
    [onCancelRename, onCommitRename, renamingTitle, thread.title, threadRef],
  );
  const handleRenameBlur = useCallback(() => {
    if (!renameCommittedRef.current) {
      onCommitRename(threadRef, renamingTitle, thread.title);
    }
  }, [onCommitRename, renamingTitle, thread.title, threadRef]);
  const handleSettleClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onSettle(threadRef);
    },
    [onSettle, threadRef],
  );
  const handleUnsettleClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsUnsettling(true);
      void onUnsettle(threadRef).then((succeeded) => {
        if (!succeeded) setIsUnsettling(false);
      });
    },
    [onUnsettle, threadRef],
  );
  const handleUnsnoozeClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onUnsnooze(threadRef);
    },
    [onUnsnooze, threadRef],
  );
  const handleUnpinClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onUnpin(threadRef);
    },
    [onUnpin, threadRef],
  );
  const handlePrClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (pr?.url) openPrLink(event, pr.url);
    },
    [openPrLink, pr],
  );

  // All sidebar rows share one surface model. Live threads used to look
  // like elevated cards while settled threads were plain rows, leaving neither
  // a useful hierarchy nor a reliable hover cue. Status now lives in the row
  // content; surface is reserved for interaction (hover, multi-select, route).
  const rowSurfaceClassName = cn(
    "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none",
    props.isActive
      ? "bg-sidebar-row-active text-sidebar-foreground"
      : isSelected
        ? "bg-sidebar-row-selected text-sidebar-foreground"
        : shouldRecede
          ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
    isInFlight &&
      !props.isActive &&
      !isSelected &&
      "opacity-70 transition-opacity hover:opacity-100",
  );

  const title = isRenaming ? (
    <input
      autoFocus
      value={renamingTitle}
      aria-label="Thread title"
      onChange={(event) => onRenameTitleChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleRenameKeyDown}
      onBlur={handleRenameBlur}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
    />
  ) : (
    <span
      className={cn(
        "min-w-0 flex-1 transition-opacity motion-reduce:transition-none",
        props.compact ? "text-[13px] leading-4" : "text-sm",
        shouldRecede ? "font-normal" : "font-medium",
        variant === "card"
          ? cn(
              "truncate",
              isUnread || isWoke
                ? "text-foreground"
                : shouldRecede
                  ? "text-secondary-label"
                  : status === "failed"
                    ? "text-foreground/95"
                    : "text-foreground/90",
            )
          : cn(
              "truncate group-hover/sidebar-row:text-foreground",
              props.isActive || isWoke
                ? "text-foreground"
                : isUnread
                  ? "text-muted-foreground"
                  : "text-secondary-label/70",
            ),
        isRegeneratingTitle && "opacity-[0.55]",
      )}
    >
      {thread.title}
    </span>
  );

  const prBadge =
    prStatus && pr ? (
      <button
        type="button"
        onClick={handlePrClick}
        className={cn(
          // Sidebar chrome follows the interface font; tabular digits keep the
          // number from reflowing as PR states stream in.
          "shrink-0 text-xs tabular-nums hover:underline",
          variant === "slim" && variantAction === "unsettle"
            ? props.isActive
              ? "text-secondary-label"
              : cn("text-secondary-label transition-colors", settledPrHoverClass)
            : prStatus.colorClass,
        )}
        aria-label={prStatus.tooltip}
      >
        #{pr.number}
      </button>
    ) : null;
  const terminalStatusIcon = terminalStatus ? (
    <span
      role="img"
      aria-label={terminalProcessLabel(terminalProcessCount)}
      data-testid={`sidebar-terminal-status-${thread.id}`}
      className={cn("inline-flex shrink-0 items-center justify-center", terminalStatus.colorClass)}
    >
      <TerminalIcon className={cn("size-3.5", terminalStatus.pulse && "animate-status-pulse")} />
    </span>
  ) : null;

  if (variant === "slim") {
    return (
      <li
        data-thread-item
        className="list-none [content-visibility:auto] [contain-intrinsic-size:auto_34px]"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="button"
                tabIndex={0}
                data-testid="sidebar-row-slim"
                aria-busy={isRegeneratingTitle || undefined}
                className={cn(rowSurfaceClassName, "flex h-9 items-center gap-2.5 px-2.5")}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                onContextMenu={handleContextMenu}
              />
            }
          >
            {/* Settled history recedes: dimmed favicon at rest, restored on
              hover so the tail stays scannable when you're hunting. */}
            <span
              className={cn(
                "shrink-0 transition-opacity",
                !props.isActive &&
                  "opacity-40 grayscale group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
              )}
            >
              <ProjectFavicon
                environmentId={thread.environmentId}
                cwd={props.projectCwd ?? ""}
                className="size-4"
                fallbackIcon={MessageSquareIcon}
              />
            </span>
            <SidebarModelUsageSummary usages={modelUsages} />
            {title}
            {terminalStatusIcon}
            {isRegeneratingTitle ? (
              <span role="status" className="sr-only">
                Regenerating title
              </span>
            ) : null}
            {/* The PR badge stays outside the hover-fading slot: it must
              remain visible AND clickable while the row is hovered. Only
              the time/jump label yields to the settle affordance. */}
            {prBadge}
            <span className="relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end">
              <span
                className={cn(
                  "inline-flex justify-end tabular-nums text-secondary-label transition-opacity",
                  !isWoke && "group-hover/sidebar-row:opacity-0",
                )}
              >
                {variantAction === "unsnooze" && props.snoozeWakeLabelText !== null ? (
                  // Snoozed rows show when they come BACK, not when they were
                  // last touched — the return ticket is the row's whole story.
                  <span className="text-xs text-blue-600 tabular-nums dark:text-blue-400">
                    {props.snoozeWakeLabelText}
                  </span>
                ) : isWoke ? (
                  // A wake can land straight in the settled tail (e.g. PR
                  // merged while snoozed); the signal must survive the trip.
                  <button
                    type="button"
                    aria-label="Dismiss Woke notification"
                    title="Dismiss Woke notification"
                    onClick={handleAcknowledgeWokeClick}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-amber-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
                  >
                    <AlarmClockIcon aria-hidden className="size-3" />
                    <span role="status">Woke</span>
                  </button>
                ) : (
                  <span className="text-xs">
                    {variantAction === "unsettle"
                      ? settledTimeLabel(thread)
                      : threadTimeLabel(thread)}
                  </span>
                )}
              </span>
              {variantAction === "unsnooze" ? (
                !props.snoozeSupported ? null : (
                  <button
                    type="button"
                    aria-label="Wake thread now"
                    onClick={handleUnsnoozeClick}
                    className={cn(
                      "pointer-events-none absolute inset-y-0 right-0 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-2 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100",
                      isWoke && "group-hover/sidebar-row:static",
                    )}
                  >
                    <AlarmClockOffIcon className="size-3" />
                  </button>
                )
              ) : !props.settlementSupported ? null : variantAction === "unsettle" ? (
                <button
                  type="button"
                  aria-label="Un-settle thread"
                  onClick={handleUnsettleClick}
                  className={cn(
                    "pointer-events-none absolute inset-y-0 right-0 -mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100",
                    isWoke && "group-hover/sidebar-row:static",
                  )}
                >
                  <Undo2Icon className="mb-px size-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Settle thread"
                  onClick={handleSettleClick}
                  className={cn(
                    "pointer-events-none absolute inset-y-0 right-0 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-2 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:opacity-100",
                    isWoke && "group-hover/sidebar-row:static",
                  )}
                >
                  <CheckIcon className="size-3" />
                </button>
              )}
            </span>
            {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
          </TooltipTrigger>
          {detailsTooltip}
        </Tooltip>
      </li>
    );
  }

  if (props.compact) {
    const compactStatus = topStatus ? (
      isWokeStatus ? (
        <button
          type="button"
          aria-label="Dismiss Woke notification"
          title="Dismiss Woke notification"
          onClick={handleAcknowledgeWokeClick}
          className={cn(
            "inline-flex max-w-32 cursor-pointer items-center gap-1 truncate text-[10px] font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
            topStatus.className,
          )}
        >
          <AlarmClockIcon aria-hidden className="size-3 shrink-0" />
          <span role="status" className="truncate">
            {topStatus.label}
          </span>
        </button>
      ) : (
        <span
          className={cn(
            "inline-flex max-w-32 items-center gap-1 truncate text-[10px] font-medium",
            topStatus.className,
          )}
        >
          {topStatus.icon === "working" ? (
            <CircleDashedIcon aria-hidden className="size-3 shrink-0" />
          ) : topStatus.icon === "done" ? (
            <CircleCheckIcon aria-hidden className="size-3 shrink-0" />
          ) : null}
          <span role="status" className="truncate">
            {topStatus.label}
          </span>
          {status === "working" ? (
            <span aria-hidden className="shrink-0">
              <WorkingDuration startedAt={resolveWorkingStartedAt(thread)} />
            </span>
          ) : null}
        </span>
      )
    ) : (
      <span className="text-[10px] tabular-nums text-secondary-label">
        {threadTimeLabel(thread)}
      </span>
    );
    const sortable = props.sortable;

    return (
      <li
        data-thread-item
        ref={sortable?.setNodeRef}
        style={
          sortable
            ? {
                transform: CSS.Translate.toString(sortable.transform),
                transition: sortable.transition,
              }
            : undefined
        }
        {...(sortable?.listeners ?? {})}
        className={cn(
          "list-none [content-visibility:auto] [contain-intrinsic-size:auto_32px]",
          sortable?.isDragging && "z-20 opacity-80",
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="button"
                tabIndex={0}
                data-testid="sidebar-row-compact"
                aria-busy={isRegeneratingTitle || undefined}
                className={cn(rowSurfaceClassName, "flex h-8 items-center gap-2 px-2")}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                onContextMenu={handleContextMenu}
              />
            }
          >
            <SidebarModelUsageSummary usages={modelUsages} />
            {title}
            {isRegeneratingTitle ? (
              <span role="status" className="sr-only">
                Regenerating title
              </span>
            ) : null}
            {terminalStatusIcon}
            <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
              {compactStatus}
              {props.settlementSupported ? (
                <button
                  type="button"
                  aria-label="Settle thread"
                  title="Settle thread"
                  onClick={handleSettleClick}
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover/sidebar-row:opacity-100"
                >
                  <CheckIcon aria-hidden className="size-3" />
                </button>
              ) : null}
            </span>
          </TooltipTrigger>
          {detailsTooltip}
        </Tooltip>
      </li>
    );
  }

  const diff = latestTurnDiff(thread);

  const sortable = props.sortable;
  return (
    <li
      data-thread-item
      ref={sortable?.setNodeRef}
      style={
        sortable
          ? {
              transform: CSS.Translate.toString(sortable.transform),
              transition: sortable.transition,
            }
          : undefined
      }
      {...(sortable?.listeners ?? {})}
      className={cn(
        "list-none py-0.5 [content-visibility:auto] [contain-intrinsic-size:auto_96px]",
        sortable?.isDragging && "z-20 opacity-80",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              role="button"
              tabIndex={0}
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
          <div className="relative z-10 h-[4.875rem] px-[var(--sidebar-row-content-inset)] py-[var(--sidebar-content-inset)]">
            <div className="flex h-5 min-w-0 items-center gap-1.5">
              {props.projectTitle ? (
                <>
                  <ProjectFavicon
                    environmentId={thread.environmentId}
                    cwd={props.projectCwd ?? ""}
                    className="size-4 shrink-0"
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-secondary-label text-xs",
                      shouldRecede ? "font-normal" : "font-medium",
                    )}
                  >
                    {props.projectTitle}
                  </span>
                </>
              ) : (
                <span className="flex-1" />
              )}
              {props.isPinned ? (
                props.pinningSupported ? (
                  <button
                    type="button"
                    aria-label="Unpin thread"
                    title="Unpin thread"
                    onClick={handleUnpinClick}
                    className="inline-flex cursor-pointer items-center rounded-sm text-muted-foreground/65 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PinIcon aria-hidden className="size-3 shrink-0" />
                  </button>
                ) : (
                  <PinIcon
                    aria-label="Pinned"
                    role="img"
                    className="size-3 shrink-0 text-muted-foreground/65"
                  />
                )
              ) : null}
              {/* The visible state owns this slot's width: status at rest,
                  actions on hover/keyboard focus or while the popover is open. Keeping
                  the hidden state out of flow lets the project label reclaim
                  space without either state overlapping it. */}
              <span className="group/sidebar-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs">
                {/* Read-only status labels yield to the hover actions. Woke is
                    itself an action, so it stays pointer-enabled and visible
                    while the other controls appear beside it. */}
                <span
                  className={cn(
                    isWokeStatus
                      ? "pointer-events-auto"
                      : "pointer-events-none group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0 group-hover/sidebar-row:absolute group-hover/sidebar-row:right-0 group-hover/sidebar-row:opacity-0",
                    "self-center justify-self-end tabular-nums text-secondary-label transition-opacity",
                  )}
                >
                  {topStatus ? (
                    isWokeStatus ? (
                      <button
                        type="button"
                        aria-label="Dismiss Woke notification"
                        title="Dismiss Woke notification"
                        onClick={handleAcknowledgeWokeClick}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                          topStatus.className,
                        )}
                      >
                        <AlarmClockIcon aria-hidden className="size-4 shrink-0" />
                        <span role="status">{topStatus.label}</span>
                      </button>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 font-medium",
                          topStatus.className,
                        )}
                      >
                        {topStatus.icon === "working" ? (
                          <CircleDashedIcon aria-hidden className="size-4 shrink-0" />
                        ) : topStatus.icon === "done" ? (
                          <CircleCheckIcon aria-hidden className="size-4 shrink-0" />
                        ) : null}
                        {/* The label alone is the live region: a role="status"
                            wrapper around the ticking duration would make
                            screen readers announce every second. */}
                        <span role="status">{topStatus.label}</span>
                        {status === "working" ? (
                          <span aria-hidden>
                            <WorkingDuration startedAt={resolveWorkingStartedAt(thread)} />
                          </span>
                        ) : null}
                      </span>
                    )
                  ) : (
                    threadTimeLabel(thread)
                  )}
                </span>
                {props.settlementSupported ? (
                  <span
                    className={cn(
                      // focus-visible, not focus-within: a mouse click leaves
                      // the Settle button focused, and a plain focus-within
                      // would keep the controls pinned over the status label
                      // once the pointer moves away (e.g. after a failed
                      // settle) instead of cross-fading back.
                      "pointer-events-none absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100 group-hover/sidebar-row:pointer-events-auto group-hover/sidebar-row:static group-hover/sidebar-row:opacity-100",
                    )}
                  >
                    {props.settlementSupported ? (
                      <button
                        type="button"
                        aria-label="Settle thread"
                        onClick={handleSettleClick}
                        className="-mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <CheckIcon className="size-3.5" />
                        Settle
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <SidebarModelUsageSummary usages={modelUsages} />
              {title}
              {isRegeneratingTitle ? (
                <span role="status" className="sr-only">
                  Regenerating title
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-secondary-label text-xs">
              {/* Always the branch. The plan step used to take this slot while
                  working, but it truncated to a half-sentence and dropped the
                  branch, so the row lost its most stable identifier. */}
              {thread.branch ? (
                <span className="min-w-0 flex-1 truncate whitespace-nowrap">{thread.branch}</span>
              ) : (
                <span className="flex-1" />
              )}
              {terminalStatusIcon}
              {prBadge}
              {diff ? (
                <span className="shrink-0 font-mono">
                  <span className="text-emerald-600 dark:text-emerald-400">+{diff.insertions}</span>{" "}
                  <span className="text-red-600 dark:text-red-400">−{diff.deletions}</span>
                </span>
              ) : null}
              <span
                aria-hidden
                className="pointer-events-none ml-auto inline-flex shrink-0 items-center gap-1"
              >
                {isRemote ? (
                  <span className="inline-flex shrink-0 items-center text-sidebar-muted-foreground/70">
                    <ServerIcon aria-hidden className="size-3.5" />
                  </span>
                ) : null}
              </span>
            </div>
          </div>
          {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
        </TooltipTrigger>
        {detailsTooltip}
      </Tooltip>
    </li>
  );
});

function latestTurnDiff(
  thread: SidebarThreadSummary,
): { insertions: number; deletions: number } | null {
  // Shells don't carry checkpoint summaries; diff stats render only when the
  // shell projection grows them. Kept as a seam so the row layout is ready.
  void thread;
  return null;
}

const SidebarSearchResultRow = memo(function SidebarSearchResultRow(props: {
  thread: SidebarThreadSummary;
  projectCwd: string | null;
  projectTitle: string | null;
  environmentLabel: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
  isHighlighted: boolean;
  isRouteActive: boolean;
  resultId: string;
  onHighlight: () => void;
  onSelect: () => void;
}) {
  const { thread } = props;
  // Same details tooltip as the regular rows: a search hit is still a thread,
  // and the hover card is how you disambiguate identically-titled results.
  const gitCwd = thread.worktreePath ?? props.projectCwd;
  const gitStatus = useEnvironmentQuery(
    (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: gitStatus.data?.refName ?? null,
  });
  const modelUsages = useMemo(
    () => resolveSidebarModelUsages(thread, props.providerEntryByInstanceId),
    [props.providerEntryByInstanceId, thread],
  );
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  return (
    <li role="presentation" className="list-none">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              id={props.resultId}
              type="button"
              role="option"
              // aria-activedescendant options: focus stays on the search input,
              // which owns all keyboard interaction for the listbox.
              tabIndex={-1}
              aria-selected={props.isHighlighted}
              aria-current={props.isRouteActive ? "page" : undefined}
              aria-label={
                props.projectTitle ? `${thread.title}, ${props.projectTitle}` : thread.title
              }
              onMouseMove={props.onHighlight}
              onClick={props.onSelect}
              className={cn(
                "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none",
                props.isHighlighted || props.isRouteActive
                  ? "bg-sidebar-row-active text-sidebar-foreground"
                  : "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              )}
            />
          }
        >
          <ProjectFavicon
            environmentId={thread.environmentId}
            cwd={props.projectCwd ?? ""}
            className="size-4 shrink-0"
            fallbackIcon={MessageSquareIcon}
          />
          <SidebarModelUsageSummary usages={modelUsages} />
          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground/55 tabular-nums">
            {threadTimeLabel(thread)}
          </span>
        </TooltipTrigger>
        <SidebarThreadTooltip
          thread={thread}
          projectTitle={props.projectTitle}
          projectCwd={props.projectCwd}
          environmentLabel={props.environmentLabel}
          modelUsages={modelUsages}
          branchMismatch={branchMismatch}
          terminalStatus={terminalStatus}
          terminalProcessCount={runningTerminalIds.length}
        />
      </Tooltip>
    </li>
  );
});

export default function Sidebar() {
  const projects = useProjects();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const pinnedProjectKeys = useUiStateStore((store) => store.pinnedProjectKeys);
  const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);
  const threadOrderByGroup = useUiStateStore((store) => store.threadOrderByGroup);
  const setProjectExpanded = useUiStateStore((store) => store.setProjectExpanded);
  const setProjectPinned = useUiStateStore((store) => store.setProjectPinned);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const reorderThreads = useUiStateStore((store) => store.reorderThreads);
  const threads = useThreadShells();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const autoSettleAfterDays = useClientSettings((s) => s.sidebarAutoSettleAfterDays);
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const sidebarProjectSortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    reorderPinnedThread,
    deleteThread,
  } = useThreadActions();
  const {
    requestConfirmation: requestWorktreeConfirmation,
    deleteConfirmDialog: worktreeConfirmDialog,
  } = useThreadDeleteConfirmation();
  const confirmWorktreeDeletion = useCallback(
    ({ path }: { path: string }) =>
      requestWorktreeConfirmation({
        title: "linked worktree",
        count: 1,
        single: true,
        heading: "Delete linked worktree?",
        description: [
          "This thread is the only one linked to this worktree:",
          path,
          "",
          "Delete the worktree too?",
        ].join("\n"),
      }),
    [requestWorktreeConfirmation],
  );
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: "branch name",
    onCopy: ({ branch }) => {
      toastManager.add({
        type: "success",
        title: "Branch copied",
        description: branch,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy branch",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const [projectScopeMenuOpen, setProjectScopeMenuOpen] = useState(false);
  const newThreadContext = useHandleNewThread();
  const openAddProjectCommandPalette = useCallback(
    () => openCommandPalette({ open: "add-project" }),
    [],
  );
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const markThreadUnread = useUiStateStore((s) => s.markThreadUnread);
  const markThreadVisited = useUiStateStore((s) => s.markThreadVisited);
  const acknowledgeWoke = useCallback(
    (threadRef: ScopedThreadRef, visitedAt: string) => {
      markThreadVisited(scopedThreadKey(threadRef), visitedAt);
    },
    [markThreadVisited],
  );
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeThreadRef = useMemo(
    () => resolveActiveThreadRouteRef(routeTarget, routeDraftThread),
    [routeDraftThread, routeTarget],
  );
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const routeTargetRef = useRef(routeTarget);
  routeTargetRef.current = routeTarget;
  // Post-settle navigation validates against the CURRENT route, not the one
  // captured when the settle started: if the user navigated elsewhere while
  // the command was in flight, completing it must not yank them away.
  const routeThreadKeyRef = useRef(routeThreadKey);
  routeThreadKeyRef.current = routeThreadKey;

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [projectOrder, projects],
  );
  const unsortedProjectGroups = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: sidebarProjectSortOrder === "manual" ? orderedProjects : projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      }),
    [
      environmentLabelById,
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      projects,
      sidebarProjectSortOrder,
    ],
  );
  const projectGroups = useMemo(
    () => sortLogicalProjectsForSidebar(unsortedProjectGroups, threads, sidebarProjectSortOrder),
    [sidebarProjectSortOrder, threads, unsortedProjectGroups],
  );
  const projectGroupKeyByPreferenceId = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const group of projectGroups) {
      mapping.set(group.projectKey, group.projectKey);
      for (const member of group.memberProjects) {
        mapping.set(member.physicalProjectKey, group.projectKey);
        mapping.set(legacyProjectCwdPreferenceKey(member.workspaceRoot), group.projectKey);
      }
    }
    return mapping;
  }, [projectGroups]);
  const orderedProjectGroups = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projectGroups,
        preferredIds: projectOrder.flatMap((id) => {
          const groupKey = projectGroupKeyByPreferenceId.get(id);
          return groupKey ? [groupKey] : [];
        }),
        getId: (group) => group.projectKey,
      }),
    [projectGroupKeyByPreferenceId, projectGroups, projectOrder],
  );
  const projectGroupKeyByScopedRef = useMemo(
    () =>
      new Map(
        projectGroups.flatMap((group) =>
          group.memberProjectRefs.map(
            (projectRef) =>
              [`${projectRef.environmentId}:${projectRef.projectId}`, group.projectKey] as const,
          ),
        ),
      ),
    [projectGroups],
  );
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const providerEntryByInstanceId = useMemo(
    () =>
      new Map(
        Array.from(serverConfigs.entries()).flatMap(([environmentId, config]) =>
          deriveProviderInstanceEntries(config.providers).map(
            (entry) => [`${environmentId}:${entry.instanceId}`, entry] as const,
          ),
        ),
      ),
    [serverConfigs],
  );
  const projectCwdByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          `${project.environmentId}:${project.id}`,
          project.workspaceRoot,
        ]),
      ),
    [projects],
  );
  const projectDisplayNameByKey = useMemo(
    () =>
      new Map(
        projectGroups.flatMap((group) =>
          group.memberProjects.map(
            (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
          ),
        ),
      ),
    [projectGroups],
  );

  // now is quantized to the minute so effectiveSettled memoization doesn't
  // churn on every render; auto-settle thresholds are day-granular anyway.
  const nowMinute = useNowMinute();
  // Snooze wake times are second-precise, so classifying with the quantized
  // minute would hold a woken thread on the shelf for up to a minute. The
  // tick is a plain counter bumped exactly at the next wake boundary (armed
  // below, after the partition knows the boundary); the partition reads a
  // fresh clock whenever it recomputes.
  const [snoozeWakeTick, bumpSnoozeWakeTick] = useState(0);

  // PR states stream in per-row (rows own the VCS subscriptions); a merged or
  // closed PR auto-settles its thread on the next partition.
  const [changeRequestStateByKey, setChangeRequestStateByKey] = useState<
    ReadonlyMap<string, "open" | "closed" | "merged">
  >(() => new Map());
  const handleChangeRequestState = useCallback(
    (threadKey: string, state: "open" | "closed" | "merged" | null) => {
      setChangeRequestStateByKey((current) => {
        if ((current.get(threadKey) ?? null) === state) return current;
        const next = new Map(current);
        if (state === null) {
          next.delete(threadKey);
        } else {
          next.set(threadKey, state);
        }
        return next;
      });
    },
    [],
  );

  // Project scope: one menu above the list. Scoping filters the list without
  // making the header width depend on the number or length of project names.
  const [projectScopeKey, setProjectScopeKey] = useState<string | null>(null);
  const scopedProjectGroup = useMemo(
    () =>
      projectScopeKey === null
        ? null
        : (projectGroups.find((project) => project.projectKey === projectScopeKey) ?? null),
    [projectGroups, projectScopeKey],
  );
  const scopedProjectKeys = useMemo(
    () =>
      scopedProjectGroup === null
        ? null
        : new Set(
            scopedProjectGroup.memberProjectRefs.map(
              (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
            ),
          ),
    [scopedProjectGroup],
  );
  useEffect(() => {
    if (projectScopeKey !== null && scopedProjectGroup === null) {
      setProjectScopeKey(null);
    }
  }, [projectScopeKey, scopedProjectGroup]);
  // Scope flips drop the selection: rows selected under the old scope may be
  // hidden now, and bulk actions must never count or touch invisible rows.
  useEffect(() => {
    clearSelection();
  }, [clearSelection, projectScopeKey]);

  const handleProjectActions = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      setProjectScopeMenuOpen(false);
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/settings/projects/$projectKey",
        params: { projectKey: projectGroup.projectKey },
      });
    },
    [isMobile, router, setOpenMobile],
  );

  // Settled threads stay in the live shell stream (settled ≠ archived), so
  // the partition works directly off live shells: no archived-snapshot
  // merging, no optimistic holds. Archived threads remain hidden here —
  // archive keeps its original "remove from sidebar" meaning.
  const {
    pinnedThreads,
    reorderablePinnedKeys,
    activeThreads,
    snoozedThreads,
    settledThreads,
    snoozeNow,
  } = useMemo(() => {
    const now = `${nowMinute}:00.000Z`;
    // Snooze classification uses a REAL clock, not the quantized minute:
    // wake times are second-precise and a woken thread must not linger on
    // the shelf for the rest of the minute. snoozeWakeTick re-runs this
    // memo exactly at the next wake boundary.
    void snoozeWakeTick;
    const preciseNow = new Date().toISOString();
    const visible = threads.filter(
      (thread) =>
        thread.archivedAt === null &&
        (scopedProjectKeys === null ||
          scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`)),
    );
    const pinned: EnvironmentThreadShell[] = [];
    const active: EnvironmentThreadShell[] = [];
    const snoozed: EnvironmentThreadShell[] = [];
    const settled: EnvironmentThreadShell[] = [];
    for (const thread of visible) {
      // Threads on servers without the settlement capability (old server,
      // or descriptor not loaded yet) never classify as settled: the user
      // could neither un-settle nor pin them, so auto-settling them would
      // strand rows in a tail with no working affordances.
      const supportsSettlement =
        serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement === true;
      const supportsSnooze =
        serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true;
      const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      const changeRequestState = changeRequestStateByKey.get(threadKey) ?? null;
      // Snooze outranks everything, including a pin: "hide until Tuesday"
      // temporarily suspends "keep on top". The pin survives underneath —
      // and so does its pinOrderKey, so on wake the thread reappears at
      // its exact slot in the pinned block. (For unpinned threads
      // this is also the snooze-beats-auto-settle rule: the wake time is a
      // stronger statement about when the thread matters again.)
      if (supportsSnooze && effectiveSnoozed(thread, { now: preciseNow })) {
        snoozed.push(thread);
        // A pin otherwise overrides the lifecycle: pinned threads never
        // auto-settle out of sight. (The decider clears settled state on
        // pin and the pin on settle, so pin-vs-settled conflicts only
        // arise from stale or raced writes.)
      } else if (thread.pinnedAt != null) {
        pinned.push(thread);
      } else if (
        supportsSettlement &&
        effectiveSettled(thread, { now, autoSettleAfterDays, changeRequestState })
      ) {
        settled.push(thread);
      } else {
        active.push(thread);
      }
    }
    // One shared rule on every platform (see sortPinnedThreadsByOrderKey):
    // user-arranged keys first, keyless threads in creation order below.
    // Server capability only gates DRAGGING — it must not influence the
    // sort, or mixed-version fleets would render different pinned orders on
    // web and mobile from the same data.
    return {
      pinnedThreads: sortPinnedThreadsForSidebar(pinned),
      reorderablePinnedKeys: new Set(
        pinned
          .filter(
            (thread) =>
              serverConfigs.get(thread.environmentId)?.environment.capabilities.threadPinReorder ===
              true,
          )
          .map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
      ),
      activeThreads: sortThreadsForSidebar(active),
      // Soonest wake first: "what comes back next" is the shelf's question.
      snoozedThreads: snoozed.toSorted(
        (left, right) =>
          firstValidTimestampMs(left.snoozedUntil ?? null) -
          firstValidTimestampMs(right.snoozedUntil ?? null),
      ),
      settledThreads: sortSettledThreadsForSidebar(settled),
      snoozeNow: preciseNow,
    };
  }, [
    autoSettleAfterDays,
    changeRequestStateByKey,
    nowMinute,
    scopedProjectKeys,
    serverConfigs,
    snoozeWakeTick,
    threads,
  ]);

  const threadSearchInputRef = useRef<HTMLInputElement>(null);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [activeSearchResultIndex, setActiveSearchResultIndex] = useState(0);
  const isSearchingThreads = threadSearchQuery.trim().length > 0;
  const searchableThreads = useMemo(
    () => [...pinnedThreads, ...activeThreads, ...snoozedThreads, ...settledThreads],
    [activeThreads, pinnedThreads, settledThreads, snoozedThreads],
  );
  const threadSearchResults = useMemo(
    () => searchSidebarThreadsByTitle(searchableThreads, threadSearchQuery),
    [searchableThreads, threadSearchQuery],
  );
  const threadSearchResultOrderKey = threadSearchResults
    .map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))
    .join("\0");

  useEffect(() => {
    setActiveSearchResultIndex(0);
  }, [threadSearchResultOrderKey]);

  useEffect(() => {
    if (!isSearchingThreads) return;
    document
      .getElementById(`sidebar-thread-search-result-${activeSearchResultIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeSearchResultIndex, isSearchingThreads, threadSearchResultOrderKey]);

  // Arm a timeout for the earliest upcoming wake so the shelf empties the
  // moment a snooze expires instead of on the next minute tick. Sorted
  // soonest-first, so entry 0 is the boundary.
  useEffect(() => {
    const nextWakeAtMs =
      snoozedThreads.length > 0 && snoozedThreads[0]?.snoozedUntil != null
        ? Date.parse(snoozedThreads[0].snoozedUntil)
        : Number.NaN;
    if (Number.isNaN(nextWakeAtMs)) return;
    // setTimeout delays are signed 32-bit: anything larger overflows and
    // fires immediately, turning a far-future wake (event-condition snoozes
    // synced from elsewhere) into a tight re-arm loop. Clamped, the timer
    // just re-arms every ~24.8 days until the wake is in range.
    const delayMs = Math.min(Math.max(0, nextWakeAtMs - Date.now()) + 50, 2_147_483_647);
    const id = window.setTimeout(() => bumpSnoozeWakeTick((tick) => tick + 1), delayMs);
    return () => window.clearTimeout(id);
  }, [snoozedThreads]);

  // The settled tail renders in pages: history shouldn't dominate the
  // sidebar, and the common lookups are recent. Expansion resets when the
  // filter context changes so a scope/search flip never inherits a deep
  // page state.
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_TAIL_INITIAL_COUNT);
  const settledResetKey = projectScopeKey ?? "all";
  const lastSettledResetKeyRef = useRef(settledResetKey);
  if (lastSettledResetKeyRef.current !== settledResetKey) {
    lastSettledResetKeyRef.current = settledResetKey;
    setSettledVisibleCount(SETTLED_TAIL_INITIAL_COUNT);
  }
  const visibleSettledThreads = useMemo(() => {
    if (settledThreads.length <= settledVisibleCount) return settledThreads;
    const visible = settledThreads.slice(0, settledVisibleCount);
    // The open thread must never hide under "Show more": navigating into a
    // deep settled thread (search, deep link) pulls its row into the visible
    // tail so the highlight and the un-settle affordance stay reachable.
    if (routeThreadKey !== null) {
      const routeThread = settledThreads
        .slice(settledVisibleCount)
        .find(
          (thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === routeThreadKey,
        );
      if (routeThread !== undefined) visible.push(routeThread);
    }
    return visible;
  }, [routeThreadKey, settledThreads, settledVisibleCount]);
  const hiddenSettledCount = settledThreads.length - visibleSettledThreads.length;
  const showMoreSettled = useCallback(
    () => setSettledVisibleCount((count) => count + SETTLED_TAIL_PAGE_COUNT),
    [],
  );
  const [settledShelfExpanded, setSettledShelfExpanded] = useState(true);
  const toggleSettledShelf = useCallback(() => setSettledShelfExpanded((value) => !value), []);
  const renderedSettledThreads = useMemo(() => {
    if (settledShelfExpanded) return visibleSettledThreads;
    if (routeThreadKey === null) return [];
    const routeThread = visibleSettledThreads.find(
      (thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === routeThreadKey,
    );
    return routeThread === undefined ? [] : [routeThread];
  }, [routeThreadKey, settledShelfExpanded, visibleSettledThreads]);

  // The snoozed shelf is collapsed by default: out of the way, never gone.
  // Collapsed threads don't render (and so don't participate in jump
  // shortcuts or multi-select), matching the settled tail's paging model.
  const [snoozedShelfExpanded, setSnoozedShelfExpanded] = useState(false);
  const toggleSnoozedShelf = useCallback(() => setSnoozedShelfExpanded((value) => !value), []);
  const visibleSnoozedThreads = useMemo(() => {
    if (snoozedShelfExpanded) return snoozedThreads;
    // The open thread must never vanish behind the collapsed shelf: a
    // snoozed thread reached by route (deep link, open before snoozing
    // elsewhere) keeps its row — with highlight and wake affordance — same
    // exception the settled tail's "Show more" makes.
    if (routeThreadKey === null) return [];
    const routeThread = snoozedThreads.find(
      (thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === routeThreadKey,
    );
    return routeThread === undefined ? [] : [routeThread];
  }, [routeThreadKey, snoozedShelfExpanded, snoozedThreads]);

  const activeThreadsByProjectGroup = useMemo(() => {
    const grouped = new Map<string, EnvironmentThreadShell[]>();
    for (const thread of activeThreads) {
      const groupKey = projectGroupKeyByScopedRef.get(
        `${thread.environmentId}:${thread.projectId}`,
      );
      if (!groupKey) continue;
      const existing = grouped.get(groupKey);
      if (existing) {
        existing.push(thread);
      } else {
        grouped.set(groupKey, [thread]);
      }
    }
    return grouped;
  }, [activeThreads, projectGroupKeyByScopedRef]);
  const activeThreadGroups = useMemo(
    () =>
      orderedProjectGroups.flatMap((group) => {
        const threadsForGroup = activeThreadsByProjectGroup.get(group.projectKey) ?? [];
        if (threadsForGroup.length === 0) return [];
        return [
          {
            group,
            threads: orderItemsByPreferredIds({
              items: threadsForGroup,
              preferredIds: threadOrderByGroup[group.projectKey] ?? [],
              getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
            }),
          },
        ];
      }),
    [activeThreadsByProjectGroup, orderedProjectGroups, threadOrderByGroup],
  );
  const pinnedProjectKeySet = useMemo(() => new Set(pinnedProjectKeys), [pinnedProjectKeys]);
  const pinnedActiveThreadGroups = useMemo(
    () => activeThreadGroups.filter((entry) => pinnedProjectKeySet.has(entry.group.projectKey)),
    [activeThreadGroups, pinnedProjectKeySet],
  );
  const regularActiveThreadGroups = useMemo(
    () => activeThreadGroups.filter((entry) => !pinnedProjectKeySet.has(entry.group.projectKey)),
    [activeThreadGroups, pinnedProjectKeySet],
  );
  const visibleActiveThreadGroups = useMemo(
    () => [...pinnedActiveThreadGroups, ...regularActiveThreadGroups],
    [pinnedActiveThreadGroups, regularActiveThreadGroups],
  );
  const groupedActiveThreadKeys = useMemo(
    () =>
      new Set(
        activeThreadGroups.flatMap((entry) =>
          entry.threads.map((thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          ),
        ),
      ),
    [activeThreadGroups],
  );
  const ungroupedActiveThreads = useMemo(
    () =>
      activeThreads.filter(
        (thread) =>
          !groupedActiveThreadKeys.has(
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          ) && !projectGroupKeyByScopedRef.has(`${thread.environmentId}:${thread.projectId}`),
      ),
    [activeThreads, groupedActiveThreadKeys, projectGroupKeyByScopedRef],
  );
  const activeThreadGroupKeyByThreadKey = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const entry of activeThreadGroups) {
      for (const thread of entry.threads) {
        mapping.set(
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          entry.group.projectKey,
        );
      }
    }
    return mapping;
  }, [activeThreadGroups]);

  const orderedThreads = useMemo(
    () => [
      ...pinnedThreads,
      ...activeThreadGroups.flatMap((entry) => entry.threads),
      ...ungroupedActiveThreads,
      ...visibleSnoozedThreads,
      ...renderedSettledThreads,
    ],
    [
      activeThreadGroups,
      pinnedThreads,
      renderedSettledThreads,
      ungroupedActiveThreads,
      visibleSnoozedThreads,
    ],
  );
  const orderedThreadKeys = useMemo(
    () =>
      orderedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [orderedThreads],
  );
  // Rows call back into the click handler without carrying the ordered list as
  // a prop — a fresh array identity per shell update would defeat every row's
  // memoization. The ref keeps shift-range-select working against the list as
  // rendered at click time.
  const orderedThreadKeysRef = useRef(orderedThreadKeys);
  orderedThreadKeysRef.current = orderedThreadKeys;
  const threadByKey = useMemo(
    () =>
      new Map(
        orderedThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [orderedThreads],
  );
  // Handlers read these through refs: depending on per-update Map/Set
  // identities would give every row a fresh callback prop on each shell
  // event and defeat row memoization during streaming.
  const threadByKeyRef = useRef(threadByKey);
  threadByKeyRef.current = threadByKey;
  // handleNewThread is inherently unstable (depends on the projects list);
  // a ref keeps it out of attemptSettle's dependency array.
  const handleNewThreadRef = useRef(newThreadContext.handleNewThread);
  handleNewThreadRef.current = newThreadContext.handleNewThread;
  const settledThreadKeys = useMemo(
    () =>
      new Set(
        settledThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
    [settledThreads],
  );
  const settledThreadKeysRef = useRef(settledThreadKeys);
  settledThreadKeysRef.current = settledThreadKeys;
  const snoozedThreadKeys = useMemo(
    () =>
      new Set(
        snoozedThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
    [snoozedThreads],
  );
  const snoozedThreadKeysRef = useRef(snoozedThreadKeys);
  snoozedThreadKeysRef.current = snoozedThreadKeys;

  const jumpLabelByKey = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const [index, threadKey] of orderedThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(index);
      if (!jumpCommand) break;
      const label = shortcutLabelForCommand(keybindings, jumpCommand);
      if (label) mapping.set(threadKey, label);
    }
    return mapping;
  }, [keybindings, orderedThreadKeys]);
  const [showJumpHints, setShowJumpHints] = useState(false);

  // Settled threads are live shells, so opening one is plain navigation:
  // history stays readable without un-settling, and sending a message or
  // starting a session un-settles server-side.
  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, router, setOpenMobile, setSelectionAnchor],
  );

  const clearThreadSearch = useCallback(() => {
    setThreadSearchQuery("");
    setActiveSearchResultIndex(0);
  }, []);
  const selectThreadSearchResult = useCallback(
    (thread: EnvironmentThreadShell) => {
      clearThreadSearch();
      navigateToThread(scopeThreadRef(thread.environmentId, thread.id));
    },
    [clearThreadSearch, navigateToThread],
  );
  const handleThreadSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      // IME composition (Japanese/Chinese input) uses the same keys; committing
      // a candidate must not move the highlight or navigate away mid-compose.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && isSearchingThreads) {
        event.preventDefault();
        event.stopPropagation();
        clearThreadSearch();
        return;
      }
      if (threadSearchResults.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSearchResultIndex((index) => (index + 1) % threadSearchResults.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSearchResultIndex(
          (index) => (index - 1 + threadSearchResults.length) % threadSearchResults.length,
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const result = threadSearchResults[activeSearchResultIndex];
        if (result) selectThreadSearchResult(result);
      }
    },
    [
      activeSearchResultIndex,
      clearThreadSearch,
      isSearchingThreads,
      selectThreadSearchResult,
      threadSearchResults,
    ],
  );

  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const startThreadRename = useCallback((threadRef: ScopedThreadRef, title: string) => {
    setRenamingThreadKey(scopedThreadKey(threadRef));
    setRenamingTitle(title);
  }, []);
  const cancelThreadRename = useCallback(() => setRenamingThreadKey(null), []);
  const commitThreadRename = useCallback(
    (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
      void (async () => {
        const trimmed = title.trim();
        setRenamingThreadKey(null);
        if (trimmed.length === 0) {
          toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
          return;
        }
        if (trimmed === originalTitle) return;
        const result = await updateThreadMetadata({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, title: trimmed },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to rename thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [updateThreadMetadata],
  );

  const handleThreadClick = useCallback(
    (event: ReactMouseEvent, threadRef: ScopedThreadRef) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const threadKey = scopedThreadKey(threadRef);
      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedThreadKeysRef.current);
        return;
      }
      if (isTrailingDoubleClick(event.detail)) {
        return;
      }
      navigateToThread(threadRef);
    },
    [navigateToThread, rangeSelectTo, toggleThreadSelection],
  );

  // A settle per thread at a time: double clicks and repeated menu picks
  // must not dispatch a second settle that fails and toasts a false error.
  const settlingThreadKeysRef = useRef(new Set<string>());
  // Parking the thread you're looking at (settle or snooze) moves you
  // forward: the next remaining card (never a settled or snoozed row, never
  // one leaving in the same batch), or a fresh draft in this project when it
  // was the last active one. Callers snapshot the plan BEFORE the command
  // mutates the partition; background parks never navigate (null plan).
  const planForwardNavigation = useCallback(
    (threadKey: string, coParkingKeys?: ReadonlySet<string>): (() => void) | null => {
      if (routeThreadKeyRef.current !== threadKey) return null;
      const shell = threadByKeyRef.current.get(threadKey);
      const orderedKeys = orderedThreadKeysRef.current;
      const settledKeys = settledThreadKeysRef.current;
      const snoozedKeys = snoozedThreadKeysRef.current;
      const currentIndex = orderedKeys.indexOf(threadKey);
      const nextCardKey =
        currentIndex === -1
          ? null
          : ([...orderedKeys.slice(currentIndex + 1), ...orderedKeys.slice(0, currentIndex)].find(
              (key) => !settledKeys.has(key) && !snoozedKeys.has(key) && !coParkingKeys?.has(key),
            ) ?? null);
      const nextThread = nextCardKey ? threadByKeyRef.current.get(nextCardKey) : null;
      return nextThread
        ? () => navigateToThread(scopeThreadRef(nextThread.environmentId, nextThread.id))
        : shell
          ? () =>
              void handleNewThreadRef.current(scopeProjectRef(shell.environmentId, shell.projectId))
          : () => void router.navigate({ to: "/" });
    },
    [navigateToThread, router],
  );

  const attemptSettle = useCallback(
    (threadRef: ScopedThreadRef, opts: { coSettlingKeys?: ReadonlySet<string> } = {}) => {
      void (async () => {
        const threadKey = scopedThreadKey(threadRef);
        if (settlingThreadKeysRef.current.has(threadKey)) return;
        settlingThreadKeysRef.current.add(threadKey);
        try {
          const navigateAfterSettle = planForwardNavigation(threadKey, opts.coSettlingKeys);
          const result = await settleThread(threadRef);
          if (result._tag === "Failure") {
            // Never navigate away from a thread that did not settle.
            if (!isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to settle thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          // Only move forward if the user is still on the settled thread —
          // a navigation made during the await wins over ours.
          if (routeThreadKeyRef.current === threadKey) {
            navigateAfterSettle?.();
          }
        } finally {
          settlingThreadKeysRef.current.delete(threadKey);
        }
      })();
    },
    [planForwardNavigation, settleThread],
  );
  const attemptUnsettle = useCallback(
    async (threadRef: ScopedThreadRef): Promise<boolean> => {
      const result = await unsettleThread(threadRef);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to un-settle thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return false;
      }
      return true;
    },
    [unsettleThread],
  );
  const attemptUnsnooze = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        const result = await unsnoozeThread(threadRef);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to wake thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [unsnoozeThread],
  );
  // Drag-to-reorder for the pinned block. A drop computes ONE fractional key
  // for the moved thread and sends it to that thread's own server (see
  // planPinnedReorder for the keyless-neighbor materialization case, which
  // instead rewrites every key in the section). The optimistic order keeps
  // the card where it was dropped until EVERY key the drop wrote is
  // reflected in canonical state — a section rewrite is several sequential
  // writes, and releasing on the first landed key would expose the
  // half-written canonical order, reshuffling the block once per write.
  // A failed write clears the override (the card snaps back) with a toast.
  // A key we did NOT write landing (a concurrent client's reorder that must
  // win) and ANY membership change (new pin, unpin, snooze/wake) also
  // release it: the override can't say where members it never saw belong,
  // and holding it would launder a stale order into later drags.
  const pinnedDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const sidebarDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const handleSidebarDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const overId = event.over === null ? null : String(event.over.id);
      if (overId === null || activeId === overId) return;

      const draggedFolderKey = unprefixedDragId(activeId, "folder:");
      if (draggedFolderKey !== null) {
        const targetFolderKey = unprefixedDragId(overId, "folder:");
        if (targetFolderKey === null) return;
        const draggedFolder = orderedProjectGroups.find(
          (group) => group.projectKey === draggedFolderKey,
        );
        const targetFolder = orderedProjectGroups.find(
          (group) => group.projectKey === targetFolderKey,
        );
        if (!draggedFolder || !targetFolder) return;
        reorderProjects(
          orderedProjects.map(getProjectOrderKey),
          draggedFolder.memberProjects.map((member) => member.physicalProjectKey),
          targetFolder.memberProjects.map((member) => member.physicalProjectKey),
        );
        return;
      }

      const draggedThreadKey = unprefixedDragId(activeId, "thread:");
      const targetThreadKey = unprefixedDragId(overId, "thread:");
      if (draggedThreadKey === null || targetThreadKey === null) return;
      const groupKey = activeThreadGroupKeyByThreadKey.get(draggedThreadKey);
      if (!groupKey || activeThreadGroupKeyByThreadKey.get(targetThreadKey) !== groupKey) return;
      const group = activeThreadGroups.find((entry) => entry.group.projectKey === groupKey);
      if (!group) return;
      reorderThreads(
        groupKey,
        group.threads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
        draggedThreadKey,
        targetThreadKey,
      );
    },
    [
      activeThreadGroupKeyByThreadKey,
      activeThreadGroups,
      orderedProjectGroups,
      orderedProjects,
      reorderProjects,
      reorderThreads,
    ],
  );
  const [optimisticPinnedOrder, setOptimisticPinnedOrder] = useState<{
    readonly order: readonly string[];
    /** pinOrderKey per thread as of the drop — the baseline that tells a
        concurrent client's write apart from one of our own landing. */
    readonly keysAtDrop: ReadonlyMap<string, string | null>;
    /** The keys this drop writes (one per planned assignment). The
        override holds until all of them appear in canonical state. */
    readonly assignedKeys: ReadonlyMap<string, string>;
  } | null>(null);
  const orderedPinnedThreads = useMemo(() => {
    if (optimisticPinnedOrder === null) return pinnedThreads;
    return orderItemsByPreferredIds({
      items: pinnedThreads,
      preferredIds: optimisticPinnedOrder.order,
      getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
    });
  }, [optimisticPinnedOrder, pinnedThreads]);
  useEffect(() => {
    if (optimisticPinnedOrder === null) return;
    const canonical = pinnedThreads.filter((thread) =>
      reorderablePinnedKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
    );
    const canonicalKeys = canonical.map((thread) =>
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
    );
    // The override represents one drop against one snapshot of the world.
    // Release it when the world moves on: membership changed (pin/unpin/
    // snooze/wake — the override can't say where members it never saw
    // belong), a key changed to something we did NOT write (a concurrent
    // client's reorder that must win), every key we wrote has landed, or
    // canonical already matches. Releasing on the FIRST landed key instead
    // of the last exposes the half-written order mid-materialization and
    // the block visibly reshuffles once per write.
    const membershipChanged =
      canonicalKeys.length !== optimisticPinnedOrder.order.length ||
      canonicalKeys.some((key) => !optimisticPinnedOrder.order.includes(key));
    const foreignKeyLanded = canonical.some((thread, index) => {
      const threadKey = canonicalKeys[index]!;
      const currentKey = thread.pinOrderKey ?? null;
      if (currentKey === optimisticPinnedOrder.keysAtDrop.get(threadKey)) return false;
      return currentKey !== optimisticPinnedOrder.assignedKeys.get(threadKey);
    });
    const currentKeyByThreadKey = new Map(
      canonical.map((thread, index) => [canonicalKeys[index]!, thread.pinOrderKey ?? null]),
    );
    const allAssignmentsLanded = [...optimisticPinnedOrder.assignedKeys].every(
      ([threadKey, orderKey]) => currentKeyByThreadKey.get(threadKey) === orderKey,
    );
    const orderConfirmed =
      !membershipChanged &&
      canonicalKeys.every((key, index) => key === optimisticPinnedOrder.order[index]);
    if (membershipChanged || foreignKeyLanded || allAssignmentsLanded || orderConfirmed) {
      setOptimisticPinnedOrder(null);
    }
  }, [optimisticPinnedOrder, pinnedThreads, reorderablePinnedKeys]);
  const attemptPin = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        // Fresh pins take the top of the arranged run: pinThread computes a
        // key before the smallest key across ALL pinned shells — including
        // snoozed pins hidden from this list, whose keys are still part of
        // the run — so the new pin can't land beneath a hidden head.
        const result = await pinThread(threadRef);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to pin thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [pinThread],
  );
  const attemptUnpin = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        const result = await unpinThread(threadRef);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to unpin thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [unpinThread],
  );

  const handlePinnedDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeKey = String(event.active.id);
      const overKey = event.over === null ? null : String(event.over.id);
      if (overKey === null || activeKey === overKey) return;
      const reorderable = orderedPinnedThreads.filter((thread) =>
        reorderablePinnedKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
      );
      const keys = reorderable.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
      const fromIndex = keys.indexOf(activeKey);
      const toIndex = keys.indexOf(overKey);
      if (fromIndex === -1 || toIndex === -1) return;
      const newOrder = arrayMove([...keys], fromIndex, toIndex);
      const threadByKey = new Map(reorderable.map((thread, index) => [keys[index]!, thread]));
      const keysAtDrop = new Map(
        reorderable.map((thread, index) => [keys[index]!, thread.pinOrderKey ?? null]),
      );
      const assignments = planPinnedReorder({
        orderedIds: newOrder,
        keysById: keysAtDrop,
        movedId: activeKey,
      });
      if (assignments.length === 0) return;
      setOptimisticPinnedOrder({
        order: newOrder,
        keysAtDrop,
        assignedKeys: new Map(
          assignments.map((assignment) => [assignment.id, assignment.orderKey]),
        ),
      });
      void (async () => {
        // Sequential, stop on first failure. There is deliberately no
        // rollback: every key write is a complete, valid placement on its
        // own, so a partial materialization leaves a sensible order (and
        // the next drag repairs the rest) — unwinding writes across
        // servers would trade that for real inconsistency windows.
        for (const assignment of assignments) {
          const thread = threadByKey.get(assignment.id);
          if (thread === undefined) continue;
          const result = await reorderPinnedThread(
            scopeThreadRef(thread.environmentId, thread.id),
            assignment.orderKey,
          );
          if (result._tag === "Failure") {
            // Any failure — interrupted included — releases the override:
            // a key that never lands would otherwise hold it until some
            // unrelated world change came along.
            setOptimisticPinnedOrder(null);
            if (isAtomCommandInterrupted(result)) return;
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to reorder pinned threads",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
            return;
          }
        }
      })();
    },
    [orderedPinnedThreads, reorderPinnedThread, reorderablePinnedKeys],
  );
  // One snooze per thread at a time — same double-dispatch guard as settle.
  const snoozingThreadKeysRef = useRef(new Set<string>());
  const performSnooze = useCallback(
    async (
      threadRef: ScopedThreadRef,
      preset: SnoozePreset,
      opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
    ) => {
      const threadKey = scopedThreadKey(threadRef);
      if (snoozingThreadKeysRef.current.has(threadKey)) {
        return { status: "skipped" } as const;
      }
      snoozingThreadKeysRef.current.add(threadKey);
      try {
        // Snoozing the open thread moves you forward, same as settle —
        // both park the thread you're done with for now.
        const navigateAfterSnooze = planForwardNavigation(threadKey, opts.coSnoozingKeys);
        const result = await snoozeThread(threadRef, preset.snoozedUntil);
        if (result._tag === "Failure") {
          // Never navigate away from a thread that did not snooze.
          return isAtomCommandInterrupted(result)
            ? ({ status: "interrupted" } as const)
            : ({ status: "failure", error: squashAtomCommandFailure(result) } as const);
        }
        // Only move forward if the user is still on the snoozed thread —
        // a navigation made during the await wins over ours.
        if (routeThreadKeyRef.current === threadKey) {
          navigateAfterSnooze?.();
        }
        return { status: "success" } as const;
      } finally {
        snoozingThreadKeysRef.current.delete(threadKey);
      }
    },
    [planForwardNavigation, snoozeThread],
  );
  const attemptSnooze = useCallback(
    (
      threadRef: ScopedThreadRef,
      preset: SnoozePreset,
      opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
    ) => {
      void (async () => {
        const outcome = await performSnooze(threadRef, preset, opts);
        if (outcome.status === "failure") {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to snooze thread",
              description:
                outcome.error instanceof Error ? outcome.error.message : "An error occurred.",
            }),
          );
          return;
        }
        if (outcome.status !== "success") return;
        // Snooze hides the row, so the toast is the only confirmation —
        // and the Undo is the escape hatch for a mis-click.
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: `Snoozed until ${snoozeWakeDescription(preset.snoozedUntil, new Date(), timestampFormat)}`,
            timeout: 5_000,
            actionProps: {
              children: "Undo",
              onClick: () => attemptUnsnooze(threadRef),
            },
          }),
        );
      })();
    },
    [attemptUnsnooze, performSnooze, timestampFormat],
  );

  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      // One exact actionable set: keys whose rows are actually rendered
      // right now. Selections can outlive their rows (settled-tail paging,
      // thread deletion elsewhere) and the menu labels must count only what
      // the actions will touch.
      const threadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys].filter(
        (threadKey) => threadByKeyRef.current.has(threadKey),
      );
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      // Snooze (N) is offered when every selected thread can actually take
      // it — a mixed selection with blocked-on-you work would half-apply.
      const selectionNow = new Date();
      const selectedThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      const canSnoozeSelection = selectedThreads.every(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true &&
          canSnooze(thread, { now: selectionNow.toISOString() }),
      );
      const titleRegenerationThreads = selectedThreads.filter(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadTitleRegeneration === true,
      );
      const regeneratableTitleThreads = titleRegenerationThreads.filter(
        (thread) => thread.titleRegeneration == null,
      );
      const titleRegenerationMenuItem = buildBulkTitleRegenerationContextMenuItem({
        supportedCount: titleRegenerationThreads.length,
        actionableCount: regeneratableTitleThreads.length,
      });
      const snoozePresets = resolveSnoozePresets(new Date(), timestampFormat);
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            { id: "settle", label: `Settle (${count})` },
            ...(canSnoozeSelection
              ? [
                  {
                    id: "snooze",
                    label: `Snooze (${count})`,
                    children: snoozePresets.map((preset) => ({
                      id: `snooze:${preset.id}`,
                      label: `${preset.label} (${preset.whenLabel})`,
                    })),
                  },
                ]
              : []),
            ...(titleRegenerationMenuItem ? [titleRegenerationMenuItem] : []),
            { id: "mark-unread", label: `Mark unread (${count})` },
            { id: "delete", label: `Delete (${count})`, destructive: true },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure") return;
      if (clicked.value?.startsWith("snooze:")) {
        const preset = snoozePresets.find(
          (candidate) => `snooze:${candidate.id}` === clicked.value,
        );
        if (preset) {
          // Post-snooze navigation must skip threads snoozing in this same
          // batch — they are all leaving the card block together.
          const coSnoozingKeys = new Set(threadKeys);
          clearSelection();
          const outcomes = await Promise.all(
            selectedThreads.map(async (thread) => {
              const threadRef = scopeThreadRef(thread.environmentId, thread.id);
              const outcome = await performSnooze(threadRef, preset, { coSnoozingKeys });
              return { outcome, threadRef };
            }),
          );
          const snoozedThreadRefs = outcomes.flatMap(({ outcome, threadRef }) =>
            outcome.status === "success" ? [threadRef] : [],
          );
          const failures = outcomes.flatMap(({ outcome }) =>
            outcome.status === "failure" ? [outcome.error] : [],
          );

          if (snoozedThreadRefs.length > 0) {
            const snoozedCount = snoozedThreadRefs.length;
            const failedCount = failures.length;
            toastManager.add(
              stackedThreadToast({
                type: failedCount > 0 ? "warning" : "success",
                title:
                  failedCount > 0
                    ? `Snoozed ${snoozedCount} of ${selectedThreads.length} threads`
                    : `Snoozed ${snoozedCount} thread${snoozedCount === 1 ? "" : "s"}`,
                description:
                  failedCount > 0
                    ? `${failedCount} thread${failedCount === 1 ? "" : "s"} couldn't be snoozed.`
                    : undefined,
                timeout: 5_000,
                actionProps: {
                  children: "Undo",
                  onClick: () => {
                    for (const threadRef of snoozedThreadRefs) attemptUnsnooze(threadRef);
                  },
                },
              }),
            );
          } else if (failures.length > 0) {
            const firstError = failures[0];
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to snooze threads",
                description:
                  firstError instanceof Error ? firstError.message : "An error occurred.",
              }),
            );
          }
        }
        return;
      }
      if (clicked.value === "regenerate-title") {
        for (const thread of regeneratableTitleThreads) {
          const result = await updateThreadMetadata({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, regenerateTitle: true },
          });
          if (result._tag === "Success") continue;
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to regenerate thread titles",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
        clearSelection();
        return;
      }
      if (clicked.value === "settle") {
        // Post-settle navigation must skip threads settling in this same
        // batch — they are all leaving the card block together. Rows that
        // are already explicitly settled are skipped: nothing to do on a
        // valid mixed selection. Pinned rows ARE included: the decider
        // clears the pin as part of settling, so they park like the rest.
        const coSettlingKeys = new Set(threadKeys);
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          if (!thread || thread.settledOverride === "settled") continue;
          attemptSettle(scopeThreadRef(thread.environmentId, thread.id), { coSettlingKeys });
        }
        clearSelection();
        return;
      }
      if (clicked.value === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          markThreadUnread(threadKey, thread?.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }
      if (clicked.value !== "delete") return;
      if (confirmThreadDelete) {
        setDeleteConfirmState({
          threadRef: null,
          title: "",
          single: false,
          count,
        });
        return;
      }
      // Grown as deletions actually land, never seeded with the whole batch:
      // orphaned-worktree detection must only discount threads that are
      // really gone, or the first delete would treat still-alive batch mates
      // as deleted and remove a worktree they still point at.
      const deletedThreadKeys = new Set<string>();
      for (const threadKey of threadKeys) {
        const thread = threadByKeyRef.current.get(threadKey);
        if (!thread) continue;
        const result = await deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
          deletedThreadKeys,
          confirmWorktreeDeletion,
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to delete threads",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
        deletedThreadKeys.add(threadKey);
      }
      removeFromSelection(threadKeys);
    },
    [
      attemptSettle,
      attemptSnooze,
      clearSelection,
      confirmThreadDelete,
      confirmWorktreeDeletion,
      deleteThread,
      markThreadUnread,
      performSnooze,
      removeFromSelection,
      serverConfigs,
      attemptUnsnooze,
      updateThreadMetadata,
      timestampFormat,
    ],
  );

  const [threadMenuState, setThreadMenuState] = useState<{
    threadRef: ScopedThreadRef;
    threadKey: string;
    position: { x: number; y: number };
  } | null>(null);
  const [deleteConfirmState, setDeleteConfirmState] = useState<{
    threadRef: ScopedThreadRef | null;
    title: string;
    single: boolean;
    count: number;
  } | null>(null);
  const closeThreadMenu = useCallback(() => setThreadMenuState(null), []);
  const closeDeleteConfirm = useCallback(() => setDeleteConfirmState(null), []);
  const handleThreadMenuAction = useCallback(
    async (
      action: string,
      threadRef: ScopedThreadRef,
      thread: typeof threadByKeyRef.current extends Map<string, infer V> ? V : never,
    ) => {
      const threadKey = scopedThreadKey(threadRef);
      const threadWorkspacePath =
        thread.worktreePath ??
        projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ??
        null;
      if (action.startsWith("snooze:")) {
        const preset = resolveSnoozePresets(new Date(), timestampFormat).find(
          (candidate) => `snooze:${candidate.id}` === action,
        );
        if (preset) attemptSnooze(threadRef, preset);
        return;
      }
      switch (action) {
        case "new-thread-on-branch": {
          const result = await settlePromise(() =>
            handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId), {
              branch: thread.branch,
              worktreePath: thread.worktreePath,
              envMode: thread.worktreePath ? "worktree" : "local",
              startFromOrigin: false,
            }),
          );
          if (result._tag === "Failure") {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Could not create thread",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
        case "settle":
          attemptSettle(threadRef);
          return;
        case "unsettle":
          attemptUnsettle(threadRef);
          return;
        case "unsnooze":
          attemptUnsnooze(threadRef);
          return;
        case "pin":
          attemptPin(threadRef);
          return;
        case "unpin":
          attemptUnpin(threadRef);
          return;
        case "rename":
          startThreadRename(threadRef, thread.title);
          return;
        case "regenerate-title": {
          if (thread.titleRegeneration != null) return;
          const result = await updateThreadMetadata({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, regenerateTitle: true },
          });
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to regenerate thread title",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
        case "mark-unread":
          markThreadUnread(threadKey, thread.latestTurn?.completedAt);
          return;
        case "copy-path":
          if (!threadWorkspacePath) {
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Path unavailable",
                description: "This thread does not have a workspace path to copy.",
              }),
            );
            return;
          }
          copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
          return;
        case "copy-branch":
          if (thread.branch) {
            copyBranchToClipboard(thread.branch, { branch: thread.branch });
          }
          return;
        case "delete": {
          closeThreadMenu();
          if (confirmThreadDelete) {
            setDeleteConfirmState({
              threadRef,
              title: thread.title,
              single: true,
              count: 1,
            });
            return;
          }
          {
            const result = await deleteThread(threadRef, { confirmWorktreeDeletion });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to delete thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
          }
          return;
        }
        default:
          return;
      }
    },
    [
      attemptPin,
      attemptSettle,
      attemptSnooze,
      attemptUnpin,
      attemptUnsettle,
      attemptUnsnooze,
      closeThreadMenu,
      confirmThreadDelete,
      copyBranchToClipboard,
      copyPathToClipboard,
      confirmWorktreeDeletion,
      deleteThread,
      markThreadUnread,
      projectCwdByKey,
      startThreadRename,
      timestampFormat,
      updateThreadMetadata,
    ],
  );

  const handleThreadContextMenu = useCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const threadKey = scopedThreadKey(threadRef);
      const selectionState = useThreadSelectionStore.getState();
      if (selectionState.hasSelection() && selectionState.selectedThreadKeys.has(threadKey)) {
        const api = readLocalApi();
        if (api) {
          void handleMultiSelectContextMenu(position);
        } else {
          setThreadMenuState({ threadRef, threadKey, position });
        }
        return;
      }
      const thread = threadByKeyRef.current.get(threadKey);
      if (!thread) return;
      setThreadMenuState({ threadRef, threadKey, position });
    },
    [handleMultiSelectContextMenu],
  );

  // Thread jump (cmd+1..9) and prev/next traversal reuse the same commands as
  // v1 — the keybinding layer is shared, only the ordered list differs.
  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeTerminalOpen,
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey) return false;
        const targetThread = threadByKey.get(targetThreadKey);
        if (!targetThread) return false;
        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return true;
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: routeThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    keybindings,
    navigateToThread,
    orderedThreadKeys,
    routeTerminalOpen,
    routeThreadKey,
    threadByKey,
  ]);

  // Same predicate as v1: hints show only while the held modifiers exactly
  // match a thread-jump binding. Adding Shift (screenshots) or Alt no
  // longer matches ⌘1..9, so the overlay hides for chords like ⌘⇧4.
  const shortcutModifiers = useShortcutModifierState();
  const shouldShowJumpHintsNow = shouldShowThreadJumpHintsForModifiers(
    shortcutModifiers,
    keybindings,
    { platform: navigator.platform },
  );
  useEffect(() => {
    setShowJumpHints(shouldShowJumpHintsNow);
  }, [shouldShowJumpHintsNow]);

  const attachListAutoAnimateRef = useCallback((node: HTMLUListElement | null) => {
    if (!node) return;
    autoAnimate(node, { duration: 150, easing: "ease-out" });
  }, []);

  // New thread defaults to the project you're in (active thread's project,
  // falling back to the top project) — same resolution the command palette
  // uses. The command palette already offers a "New thread in..." submenu
  // for multi-project setups.
  const handleNewThreadClick = useCallback(() => {
    // One project: nothing to pick, create immediately.
    if (projectGroups.length <= 1) {
      if (isMobile) setOpenMobile(false);
      void startNewThreadFromContext({
        activeDraftThread: newThreadContext.activeDraftThread,
        activeThread: newThreadContext.activeThread ?? undefined,
        defaultProjectRef: newThreadContext.defaultProjectRef,
        handleNewThread: newThreadContext.handleNewThread,
      });
      return;
    }
    if (isMobile) setOpenMobile(false);
    openCommandPalette({ open: "new-thread-in" });
  }, [isMobile, newThreadContext, projectGroups.length, setOpenMobile]);

  // The button mirrors chat.new: in multi-project setups both route through
  // the command palette's "New thread in..." picker, and in single-project
  // setups both create immediately. chat.newLocal always creates directly, so
  // it is only a correct label when chat.new is unbound.
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    shortcutLabelForCommand(keybindings, "chat.newLocal");
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="gap-0"
        fixedHeader={
          // Lifted above the stage backdrop, whose fade bleeds below the
          // header and would otherwise paint across the search row's outline.
          <SidebarGroup className="relative z-[1] gap-1 p-[var(--sidebar-content-inset)]">
            <div className="flex items-center gap-1">
              <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
                <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
                <Input
                  ref={threadSearchInputRef}
                  nativeInput
                  unstyled
                  type="search"
                  value={threadSearchQuery}
                  onChange={(event) => {
                    setThreadSearchQuery(event.currentTarget.value);
                    setActiveSearchResultIndex(0);
                  }}
                  onKeyDown={handleThreadSearchKeyDown}
                  placeholder="Search"
                  aria-label="Search threads"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={isSearchingThreads && threadSearchResults.length > 0}
                  aria-controls={
                    isSearchingThreads && threadSearchResults.length > 0
                      ? "sidebar-thread-search-results"
                      : undefined
                  }
                  aria-activedescendant={
                    isSearchingThreads && threadSearchResults[activeSearchResultIndex]
                      ? `sidebar-thread-search-result-${activeSearchResultIndex}`
                      : undefined
                  }
                  className="min-w-0 flex-1 [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:p-0 [&_[data-slot=input]]:leading-normal [&_[data-slot=input]]:text-sm [&_[data-slot=input]]:font-medium [&_[data-slot=input]]:text-sidebar-foreground [&_[data-slot=input]]:placeholder:text-sidebar-muted-foreground"
                />
                {isSearchingThreads ? (
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 shrink-0 rounded-sm text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
                    aria-label="Clear thread search"
                    onClick={() => {
                      clearThreadSearch();
                      threadSearchInputRef.current?.focus();
                    }}
                  >
                    <XIcon className="size-3" />
                  </Button>
                ) : null}
              </div>
              <div className="shrink-0">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        type="button"
                        className="relative focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onClick={handleNewThreadClick}
                        disabled={projects.length === 0}
                        aria-label="New thread"
                      />
                    }
                  >
                    <SquarePenIcon />
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="right">
                    {newThreadShortcutLabel
                      ? `New thread (${newThreadShortcutLabel})`
                      : "New thread"}
                  </TooltipPopup>
                </Tooltip>
              </div>
            </div>
            {projectGroups.length > 0 ? (
              <div className="flex items-center gap-1">
                <Menu open={projectScopeMenuOpen} onOpenChange={setProjectScopeMenuOpen}>
                  <MenuTrigger
                    render={
                      <SidebarMenuButton
                        aria-label="Filter threads by project"
                        className="min-w-0 flex-1 ps-[calc(var(--sidebar-row-content-inset)-1px)] focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                      />
                    }
                  >
                    {scopedProjectGroup ? (
                      <ProjectFavicon
                        environmentId={scopedProjectGroup.environmentId}
                        cwd={scopedProjectGroup.workspaceRoot}
                        className="size-4 shrink-0"
                      />
                    ) : (
                      <FolderIcon className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {scopedProjectGroup?.displayName ?? "All projects"}
                    </span>
                    <ChevronDownIcon className="-mr-px size-4 shrink-0" />
                  </MenuTrigger>
                  <MenuPopup align="start" className="w-(--anchor-width)">
                    <MenuRadioGroup
                      value={projectScopeKey ?? "all"}
                      onValueChange={(value) =>
                        setProjectScopeKey(value === "all" ? null : (value as string))
                      }
                    >
                      <MenuRadioItem
                        value="all"
                        closeOnClick
                        className="h-8 min-h-8 px-1 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                      >
                        <FolderIcon className="size-4 shrink-0" />
                        <span className="min-w-0 truncate text-sm">All projects</span>
                      </MenuRadioItem>
                      {projectGroups.map((project) => {
                        const scopeKey = project.projectKey;
                        return (
                          <MenuRadioItem
                            key={scopeKey}
                            value={scopeKey}
                            closeOnClick
                            className="h-8 min-h-8 px-1 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                          >
                            <ProjectFavicon
                              environmentId={project.environmentId}
                              cwd={project.workspaceRoot}
                              className="size-4 shrink-0"
                            />
                            <span className="min-w-0 truncate text-sm">{project.displayName}</span>
                            <button
                              type="button"
                              aria-label={`Project actions for ${project.displayName}`}
                              title={`Project actions for ${project.displayName}`}
                              className="ml-auto inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-icon-muted outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                void handleProjectActions(event, project);
                              }}
                            >
                              <EllipsisIcon className="size-3.5" />
                            </button>
                          </MenuRadioItem>
                        );
                      })}
                    </MenuRadioGroup>
                  </MenuPopup>
                </Menu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onClick={openAddProjectCommandPalette}
                        type="button"
                        aria-label="New project"
                      />
                    }
                  >
                    <FolderPlusIcon />
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="right">New project</TooltipPopup>
                </Tooltip>
              </div>
            ) : null}
          </SidebarGroup>
        }
      >
        <SidebarGroup className="ps-[calc(var(--sidebar-content-inset)+1px)] pe-[var(--sidebar-content-inset)] pb-1 pt-0">
          {isSearchingThreads ? (
            threadSearchResults.length > 0 ? (
              <TooltipProvider
                key="sidebar-thread-search-tooltips-150"
                delay={150}
                closeDelay={0}
                timeout={400}
              >
                <ul
                  id="sidebar-thread-search-results"
                  role="listbox"
                  aria-label="Thread search results"
                  className="flex flex-col gap-px"
                >
                  {threadSearchResults.map((thread, index) => {
                    const threadKey = scopedThreadKey(
                      scopeThreadRef(thread.environmentId, thread.id),
                    );
                    return (
                      <SidebarSearchResultRow
                        key={threadKey}
                        thread={thread}
                        projectCwd={
                          projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                        }
                        projectTitle={
                          projectDisplayNameByKey.get(
                            `${thread.environmentId}:${thread.projectId}`,
                          ) ?? null
                        }
                        environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                        providerEntryByInstanceId={providerEntryByInstanceId}
                        isHighlighted={activeSearchResultIndex === index}
                        isRouteActive={routeThreadKey === threadKey}
                        resultId={`sidebar-thread-search-result-${index}`}
                        onHighlight={() => setActiveSearchResultIndex(index)}
                        onSelect={() => selectThreadSearchResult(thread)}
                      />
                    );
                  })}
                </ul>
              </TooltipProvider>
            ) : (
              <p
                role="status"
                className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
              >
                No threads found
              </p>
            )
          ) : null}
          {!isSearchingThreads ? (
            <TooltipProvider
              key="sidebar-thread-tooltips-150"
              delay={150}
              closeDelay={0}
              timeout={400}
            >
              <ul ref={attachListAutoAnimateRef} role="list" className="flex flex-col gap-px">
                {(() => {
                  const renderThreadRow = (
                    thread: EnvironmentThreadShell,
                    section: "pinned" | "active" | "snoozed" | "settled",
                    sortable?: SortablePinnedRowBag,
                    hideProjectContext = false,
                    compact = false,
                  ) => {
                    const threadKey = scopedThreadKey(
                      scopeThreadRef(thread.environmentId, thread.id),
                    );
                    // Settled and snoozed are the ONLY things that collapse a
                    // row: every other thread is a full card. Density comes
                    // from users (or the auto rules) actually parking work,
                    // not from the sidebar second-guessing what still matters.
                    const isCard = section === "active" || section === "pinned";
                    const rowVariant = isCard ? "card" : "slim";
                    return (
                      <SidebarThreadRow
                        // Keyed per variant on purpose: when a thread settles,
                        // the card fades out in place and the slim row fades
                        // in at its settled position instead of one element
                        // FLIP-sliding through every row in between (rows here
                        // are translucent, so a crossing row reads as text
                        // painted over text).
                        key={`${threadKey}:${rowVariant}`}
                        thread={thread}
                        variant={rowVariant}
                        // Snoozed rows wake; settled rows un-settle (explicit
                        // settles clear the override, auto-settled rows get
                        // pinned active); cards settle.
                        variantAction={
                          section === "snoozed"
                            ? "unsnooze"
                            : section === "settled"
                              ? "unsettle"
                              : "settle"
                        }
                        settlementSupported={
                          serverConfigs.get(thread.environmentId)?.environment.capabilities
                            .threadSettlement === true
                        }
                        snoozeSupported={
                          serverConfigs.get(thread.environmentId)?.environment.capabilities
                            .threadSnooze === true
                        }
                        pinningSupported={
                          serverConfigs.get(thread.environmentId)?.environment.capabilities
                            .threadPinning === true
                        }
                        isPinned={section === "pinned"}
                        sortable={sortable}
                        snoozeWakeLabelText={
                          section === "snoozed" && thread.snoozedUntil != null
                            ? snoozeWakeLabel(thread.snoozedUntil, {
                                now: new Date().toISOString(),
                              })
                            : null
                        }
                        // All sections: a woken thread can classify straight
                        // into the settled tail (PR merged while snoozed), and
                        // the wake signal must survive the trip. Still-snoozed
                        // rows resolve to null on their own.
                        wokeAt={threadWokeAt(thread, { now: snoozeNow })}
                        isActive={routeThreadKey === threadKey}
                        jumpLabel={showJumpHints ? (jumpLabelByKey.get(threadKey) ?? null) : null}
                        currentEnvironmentId={primaryEnvironmentId}
                        environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                        projectCwd={
                          projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                        }
                        projectTitle={
                          hideProjectContext
                            ? null
                            : (projectDisplayNameByKey.get(
                                `${thread.environmentId}:${thread.projectId}`,
                              ) ?? null)
                        }
                        compact={compact}
                        providerEntryByInstanceId={providerEntryByInstanceId}
                        onThreadClick={handleThreadClick}
                        onThreadActivate={navigateToThread}
                        onStartRename={startThreadRename}
                        onRenameTitleChange={setRenamingTitle}
                        onCommitRename={commitThreadRename}
                        onCancelRename={cancelThreadRename}
                        isRenaming={renamingThreadKey === threadKey}
                        renamingTitle={renamingThreadKey === threadKey ? renamingTitle : ""}
                        onContextMenu={handleThreadContextMenu}
                        onSettle={attemptSettle}
                        onUnsettle={attemptUnsettle}
                        onUnsnooze={attemptUnsnooze}
                        onUnpin={attemptUnpin}
                        onAcknowledgeWoke={acknowledgeWoke}
                        onChangeRequestState={handleChangeRequestState}
                      />
                    );
                  };
                  // Pinned block: full cards above the inbox, closed by a
                  // thin divider (the pin glyphs carry the meaning, so no
                  // header text). Vanishes entirely at count 0.
                  // Rows render in the one shared pinned order; only
                  // reorder-capable rows register as sortable (legacy-server
                  // pins render in place as plain rows).
                  const items: ReactNode[] = [
                    <DndContext
                      key="pinned-dnd"
                      sensors={pinnedDndSensors}
                      collisionDetection={closestCenter}
                      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
                      onDragEnd={handlePinnedDragEnd}
                    >
                      <SortableContext
                        items={orderedPinnedThreads
                          .map((thread) =>
                            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                          )
                          .filter((threadKey) => reorderablePinnedKeys.has(threadKey))}
                        strategy={verticalListSortingStrategy}
                      >
                        {orderedPinnedThreads.map((thread) => {
                          const threadKey = scopedThreadKey(
                            scopeThreadRef(thread.environmentId, thread.id),
                          );
                          if (!reorderablePinnedKeys.has(threadKey)) {
                            return renderThreadRow(thread, "pinned");
                          }
                          return (
                            <SortablePinnedThreadRow key={threadKey} id={threadKey}>
                              {(bag) => renderThreadRow(thread, "pinned", bag)}
                            </SortablePinnedThreadRow>
                          );
                        })}
                      </SortableContext>
                    </DndContext>,
                  ];
                  if (pinnedThreads.length > 0) {
                    items.push(
                      <li
                        key="pinned-divider"
                        aria-hidden
                        data-testid="sidebar-pinned-divider"
                        className="mx-2.5 my-1.5 h-px list-none bg-sidebar-border/60"
                      />,
                    );
                  }
                  if (activeThreadGroups.length > 0) {
                    items.push(
                      <DndContext
                        key="active-folder-dnd"
                        sensors={sidebarDndSensors}
                        collisionDetection={closestCenter}
                        modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
                        onDragEnd={handleSidebarDragEnd}
                      >
                        <SortableContext
                          items={visibleActiveThreadGroups.map((entry) =>
                            folderDragId(entry.group.projectKey),
                          )}
                          strategy={verticalListSortingStrategy}
                        >
                          {visibleActiveThreadGroups.flatMap((entry, index) => {
                            const preferenceKeys = projectExpansionPreferenceKeys(entry.group);
                            const expanded = resolveProjectExpanded(
                              projectExpandedById,
                              preferenceKeys,
                            );
                            const sectionHeader =
                              index === 0 && pinnedActiveThreadGroups.length > 0 ? (
                                <li
                                  key="pinned-projects-header"
                                  className="mb-0.5 mt-1 list-none px-2 text-[10px] font-semibold uppercase tracking-wide text-sidebar-muted-foreground/60"
                                >
                                  Pinned
                                </li>
                              ) : index === pinnedActiveThreadGroups.length &&
                                pinnedActiveThreadGroups.length > 0 &&
                                regularActiveThreadGroups.length > 0 ? (
                                <li
                                  key="projects-header"
                                  className="mb-0.5 mt-2 list-none border-t border-sidebar-border/50 px-2 pt-2 text-[10px] font-semibold uppercase tracking-wide text-sidebar-muted-foreground/60"
                                >
                                  Threads
                                </li>
                              ) : null;
                            const folder = (
                              <SortableSidebarFolder
                                key={entry.group.projectKey}
                                id={folderDragId(entry.group.projectKey)}
                                label={entry.group.displayName}
                                threadCount={entry.threads.length}
                                expanded={expanded}
                                pinned={pinnedProjectKeySet.has(entry.group.projectKey)}
                                onToggle={() => setProjectExpanded(preferenceKeys, !expanded)}
                                onTogglePinned={() =>
                                  setProjectPinned(
                                    entry.group.projectKey,
                                    !pinnedProjectKeySet.has(entry.group.projectKey),
                                  )
                                }
                                onCreateThread={() => {
                                  const firstProjectRef = entry.group.memberProjectRefs[0];
                                  if (!firstProjectRef) return;
                                  if (isMobile) setOpenMobile(false);
                                  void newThreadContext.handleNewThread(
                                    firstProjectRef,
                                    entry.group.groupedProjectCount > 1
                                      ? undefined
                                      : { startFromOrigin: false },
                                  );
                                }}
                              >
                                <SortableContext
                                  items={entry.threads.map((thread) =>
                                    threadDragId(
                                      scopedThreadKey(
                                        scopeThreadRef(thread.environmentId, thread.id),
                                      ),
                                    ),
                                  )}
                                  strategy={verticalListSortingStrategy}
                                >
                                  {entry.threads.map((thread) => {
                                    const threadKey = scopedThreadKey(
                                      scopeThreadRef(thread.environmentId, thread.id),
                                    );
                                    return (
                                      <SortablePinnedThreadRow
                                        key={threadKey}
                                        id={threadDragId(threadKey)}
                                      >
                                        {(bag) =>
                                          renderThreadRow(thread, "active", bag, true, true)
                                        }
                                      </SortablePinnedThreadRow>
                                    );
                                  })}
                                </SortableContext>
                              </SortableSidebarFolder>
                            );
                            return sectionHeader ? [sectionHeader, folder] : [folder];
                          })}
                        </SortableContext>
                      </DndContext>,
                    );
                  }
                  for (const thread of ungroupedActiveThreads) {
                    items.push(renderThreadRow(thread, "active"));
                  }
                  // Snoozed shelf: between the inbox and Settled — out of the
                  // way, never gone. The header always renders while anything
                  // is snoozed (the count is the whole footprint when
                  // collapsed); rows only when expanded. Vanishes entirely at
                  // count 0.
                  if (snoozedThreads.length > 0) {
                    items.push(
                      <li
                        key="snoozed-shelf-header"
                        data-thread-selection-safe
                        className="list-none"
                      >
                        <button
                          type="button"
                          onClick={toggleSnoozedShelf}
                          aria-expanded={snoozedShelfExpanded}
                          data-testid="sidebar-snoozed-shelf-toggle"
                          className="mb-1 mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
                        >
                          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            {snoozedShelfExpanded
                              ? "Snoozed"
                              : `Snoozed (${snoozedThreads.length})`}
                          </span>
                          <span className="h-px flex-1 bg-blue-500/20 dark:bg-blue-400/15" />
                          <ChevronDownIcon
                            aria-hidden
                            className={cn(
                              "size-3 text-blue-600 transition-transform dark:text-blue-400",
                              snoozedShelfExpanded && "rotate-180",
                            )}
                          />
                        </button>
                      </li>,
                    );
                    for (const thread of visibleSnoozedThreads) {
                      items.push(renderThreadRow(thread, "snoozed"));
                    }
                  }
                  if (settledThreads.length > 0) {
                    items.push(
                      <li
                        key="settled-shelf-header"
                        data-thread-selection-safe
                        className="list-none"
                      >
                        <button
                          type="button"
                          onClick={toggleSettledShelf}
                          aria-expanded={settledShelfExpanded}
                          data-testid="sidebar-settled-shelf-toggle"
                          className="mb-1 mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
                        >
                          <span className="text-xs font-medium text-muted-foreground/50">
                            {settledShelfExpanded
                              ? "Settled"
                              : `Settled (${settledThreads.length})`}
                          </span>
                          <span className="h-px flex-1 bg-sidebar-border/60" />
                          <ChevronDownIcon
                            aria-hidden
                            className={cn(
                              "size-3 text-muted-foreground/50 transition-transform",
                              settledShelfExpanded && "rotate-180",
                            )}
                          />
                        </button>
                      </li>,
                    );
                  }
                  for (const thread of renderedSettledThreads) {
                    items.push(renderThreadRow(thread, "settled"));
                  }
                  return items;
                })()}
                {settledShelfExpanded && hiddenSettledCount > 0 ? (
                  <li className="list-none">
                    <button
                      type="button"
                      onClick={showMoreSettled}
                      className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground/55 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                    >
                      <PlusIcon aria-hidden className="size-4 shrink-0" />
                      Show {Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more
                    </button>
                  </li>
                ) : null}
              </ul>
            </TooltipProvider>
          ) : null}
          {!isSearchingThreads &&
          pinnedThreads.length +
            activeThreads.length +
            snoozedThreads.length +
            settledThreads.length ===
            0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              {projects.length === 0 ? (
                <>
                  <span>No projects yet</span>
                  <button
                    type="button"
                    onClick={openAddProjectCommandPalette}
                    className="inline-flex items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-[11px] font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  >
                    <PlusIcon className="-mx-0.5 size-3" />
                    Add project
                  </button>
                </>
              ) : scopedProjectGroup ? (
                `No threads in ${scopedProjectGroup.displayName} yet`
              ) : (
                "No threads yet"
              )}
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
      {threadMenuState
        ? (() => {
            const thread = threadByKeyRef.current.get(threadMenuState.threadKey);
            if (!thread) return null;
            const threadRef = threadMenuState.threadRef;
            const threadKey = threadMenuState.threadKey;
            const position = threadMenuState.position;
            const supportsSettlement =
              serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement ===
              true;
            const supportsSnooze =
              serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze ===
              true;
            const supportsPinning =
              serverConfigs.get(thread.environmentId)?.environment.capabilities.threadPinning ===
              true;
            const supportsTitleRegeneration =
              serverConfigs.get(thread.environmentId)?.environment.capabilities
                .threadTitleRegeneration === true;
            const isSettled = settledThreadKeysRef.current.has(threadKey);
            const isSnoozed = snoozedThreadKeysRef.current.has(threadKey);
            const isPinned = thread.pinnedAt != null;
            const items = buildThreadActionMenuItems({
              branch: thread.branch ?? null,
              isPinned,
              isSettled,
              isSnoozed,
              canSnoozeNow: canSnooze(thread, { now: new Date().toISOString() }),
              isRegeneratingTitle: thread.titleRegeneration != null,
              supports: {
                settlement: supportsSettlement,
                snooze: supportsSnooze,
                pinning: supportsPinning,
                titleRegeneration: supportsTitleRegeneration,
              },
              snoozePresets: resolveSnoozePresets(new Date(), timestampFormat),
            });
            return (
              <ThreadActionMenu
                items={items}
                position={position}
                onClose={closeThreadMenu}
                onSelect={(action) => {
                  closeThreadMenu();
                  void handleThreadMenuAction(action, threadRef, thread);
                }}
              />
            );
          })()
        : null}
      {deleteConfirmState ? (
        <DeleteThreadConfirmDialog
          title={deleteConfirmState.title}
          count={deleteConfirmState.count}
          single={deleteConfirmState.single}
          onCancel={closeDeleteConfirm}
          onConfirm={async () => {
            const state = deleteConfirmState;
            closeDeleteConfirm();
            if (state.single) {
              if (!state.threadRef) return;
              const result = await deleteThread(state.threadRef, { confirmWorktreeDeletion });
              if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                const error = squashAtomCommandFailure(result);
                toastManager.add(
                  stackedThreadToast({
                    type: "error",
                    title: "Failed to delete thread",
                    description: error instanceof Error ? error.message : "An error occurred.",
                  }),
                );
              }
              return;
            }
            const threadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys].filter(
              (key) => threadByKeyRef.current.has(key),
            );
            if (threadKeys.length === 0) return;
            const deletedThreadKeys = new Set<string>();
            for (const key of threadKeys) {
              const t = threadByKeyRef.current.get(key);
              if (!t) continue;
              const result = await deleteThread(scopeThreadRef(t.environmentId, t.id), {
                deletedThreadKeys,
                confirmWorktreeDeletion,
              });
              if (result._tag === "Failure") {
                if (!isAtomCommandInterrupted(result)) {
                  const error = squashAtomCommandFailure(result);
                  toastManager.add(
                    stackedThreadToast({
                      type: "error",
                      title: "Failed to delete threads",
                      description: error instanceof Error ? error.message : "An error occurred.",
                    }),
                  );
                }
                return;
              }
              deletedThreadKeys.add(key);
            }
            removeFromSelection(threadKeys);
          }}
        />
      ) : null}
      {worktreeConfirmDialog}
    </>
  );
}
