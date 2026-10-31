import { memo, type MouseEventHandler, type PointerEventHandler } from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  Minimize2Icon,
  PlayIcon,
  SquareIcon,
} from "lucide-react";
import { CornerUpRight, ListPlus } from "lucide";
import { MorphIcon } from "~/components/MorphIcon";
import { useEnvironmentIdentificationMode } from "~/hooks/useSettings";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { useShortcutModifierState } from "../../shortcutModifierState";
import { StageBackdropButtonArt, useSidebarStageBackdropVariant } from "../SidebarStageBackdrop";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { ComposerSendButton } from "./ComposerSendButton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { composerFloatingLayerProps } from "./composerEventScope";
import {
  alternateComposerDispatchAction,
  resolveComposerDispatchMode,
} from "@t3tools/client-runtime/state/composer-dispatch";

interface PendingActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

interface ComposerPrimaryActionsProps {
  compact: boolean;
  canOperateThread: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  canInterrupt: boolean;
  followUpBehavior?: "queue" | "steer";
  canSteer?: boolean;
  alternateShortcutLabel?: string | null;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  canResume?: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  isEditingQueuedMessage?: boolean;
  onSubmitMessage?: MouseEventHandler<HTMLButtonElement>;
  onResume?: () => void;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
  compactBeforeSendTokens?: number | null;
  keepFullHistory?: boolean;
  onToggleKeepFullHistory?: () => void;
}

const formatPendingPrimaryActionLabel = (input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}) => {
  if (input.isResponding) {
    return "Submitting…";
  }
  if (input.compact) {
    return input.isLastQuestion ? "Submit" : "Next";
  }
  if (!input.isLastQuestion) {
    return "Next question";
  }
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
};

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

export const ComposerPrimaryActions = memo(function ComposerPrimaryActions({
  compact,
  canOperateThread,
  pendingAction,
  isRunning,
  canInterrupt,
  followUpBehavior = "steer",
  canSteer = true,
  alternateShortcutLabel = null,
  showPlanFollowUpPrompt,
  promptHasText,
  isSendBusy,
  sendDisabledReason,
  isConnecting,
  isEnvironmentUnavailable,
  isPreparingWorktree,
  hasSendableContent,
  canResume = false,
  preserveComposerFocusOnPointerDown = false,
  isEditingQueuedMessage = false,
  onSubmitMessage,
  onResume,
  onPreviousPendingQuestion,
  onInterrupt,
  onImplementPlanInNewThread,
  compactBeforeSendTokens = null,
  keepFullHistory = false,
  onToggleKeepFullHistory,
}: ComposerPrimaryActionsProps) {
  const pointerFocusProps = preserveComposerFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const shortcutModifiers = useShortcutModifierState();
  const isQueuing =
    !isEditingQueuedMessage &&
    resolveComposerDispatchMode({
      running: isRunning,
      activeTurnDefault: followUpBehavior,
      canSteer,
      alternateModifier: shortcutModifiers.metaKey || shortcutModifiers.ctrlKey,
    }) === "queue";
  const alternateAction = alternateComposerDispatchAction(followUpBehavior);
  const isSendDisabled = !canOperateThread || sendDisabledReason !== null;
  const stageBackdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );

  const stopGenerationButton = (
    <Tooltip key="interrupt">
      <TooltipTrigger
        render={
          <ComposerSendButton
            {...pointerFocusProps}
            disabled={!canOperateThread}
            onClick={() => {
              if (canOperateThread) onInterrupt();
            }}
            aria-label="Stop generation"
          />
        }
      >
        <SquareIcon className="size-3 fill-current" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipPopup>Interrupt</TooltipPopup>
    </Tooltip>
  );

  if (pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {canInterrupt ? stopGenerationButton : null}
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-sm"
              variant="outline"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
              aria-label="Previous question"
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
            >
              Previous
            </Button>
          )
        ) : null}
        <Button
          type="submit"
          size="sm"
          {...pointerFocusProps}
          disabled={
            !canOperateThread ||
            isEnvironmentUnavailable ||
            pendingAction.isResponding ||
            (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
          }
        >
          {formatPendingPrimaryActionLabel({
            compact,
            isLastQuestion: pendingAction.isLastQuestion,
            isResponding: pendingAction.isResponding,
            questionIndex: pendingAction.questionIndex,
          })}
        </Button>
      </div>
    );
  }

  if (showPlanFollowUpPrompt && (promptHasText || !canResume)) {
    if (promptHasText) {
      return (
        <Button
          type="submit"
          size="sm"
          {...pointerFocusProps}
          disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? "Sending…" : "Refine"}
        </Button>
      );
    }

    return (
      <div
        data-chat-composer-implement-actions="true"
        className="flex items-center justify-end gap-px"
      >
        <Button
          type="submit"
          size="sm"
          {...pointerFocusProps}
          disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? "Sending…" : "Implement"}
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-sm"
                aria-label="Implementation actions"
                onMouseDown={
                  preserveComposerFocusOnPointerDown ? (event) => event.preventDefault() : undefined
                }
                disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
              />
            }
          >
            <ChevronDownIcon />
          </MenuTrigger>
          <MenuPopup align="end" side="top" {...composerFloatingLayerProps}>
            <MenuItem
              disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
              onClick={() => {
                if (canOperateThread) onImplementPlanInNewThread();
              }}
            >
              Implement in a new thread
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  if (canInterrupt && !hasSendableContent && !isEditingQueuedMessage) {
    return stopGenerationButton;
  }

  const showResume = canResume && !hasSendableContent && !isEditingQueuedMessage;

  const compactTokens =
    compactBeforeSendTokens !== null && !showResume && !isEditingQueuedMessage
      ? formatContextWindowTokens(compactBeforeSendTokens)
      : null;
  const compactsBeforeSend = compactTokens !== null && !keepFullHistory;

  const submitLabel = showResume
    ? "Resume thread"
    : isEditingQueuedMessage
      ? "Update queued message"
      : compactsBeforeSend
        ? "Compact and send"
        : isQueuing
          ? "Queue message"
          : isRunning
            ? "Steer message"
            : "Submit message";
  const submitStatus = isEnvironmentUnavailable
    ? "Environment disconnected"
    : (sendDisabledReason ??
      (isConnecting
        ? "Connecting"
        : isPreparingWorktree
          ? "Preparing worktree"
          : isSendBusy
            ? isEditingQueuedMessage
              ? "Updating queued message"
              : "Submitting message"
            : null));
  const submitTooltip =
    submitStatus ??
    (compactsBeforeSend
      ? `Summarize ${compactTokens} tokens of history, then send`
      : isRunning && !isEditingQueuedMessage && canSteer
        ? `Click to ${followUpBehavior}, Ctrl/⌘-click${alternateShortcutLabel ? ` or ${alternateShortcutLabel}` : ""} to ${alternateAction}`
        : submitLabel);

  const sendButton = (
    <ComposerSendButton
      type={showResume ? "button" : "submit"}
      className={stageBackdropVariant ? "isolate overflow-hidden" : undefined}
      {...pointerFocusProps}
      onClick={showResume ? onResume : onSubmitMessage}
      disabled={
        isSendBusy ||
        isSendDisabled ||
        isConnecting ||
        isEnvironmentUnavailable ||
        (!hasSendableContent && !showResume)
      }
      aria-label={submitStatus ?? submitLabel}
    >
      {stageBackdropVariant ? (
        <span className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <StageBackdropButtonArt variant={stageBackdropVariant} />
        </span>
      ) : null}
      {isConnecting || isSendBusy ? (
        <Spinner size="sm" aria-hidden="true" />
      ) : showResume ? (
        <PlayIcon className="fill-current" aria-hidden="true" />
      ) : isEditingQueuedMessage ? (
        <CheckIcon aria-hidden="true" />
      ) : isRunning ? (
        <MorphIcon className="size-4" icon={isQueuing ? ListPlus : CornerUpRight} />
      ) : (
        <ArrowUpIcon aria-hidden="true" />
      )}
    </ComposerSendButton>
  );

  const submit = (
    <Tooltip key="submit">
      <TooltipTrigger render={<span className="inline-flex" />}>{sendButton}</TooltipTrigger>
      <TooltipPopup>{submitTooltip}</TooltipPopup>
    </Tooltip>
  );
  if (compactTokens === null) return submit;

  return (
    <div data-chat-composer-compact-send="true" className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={keepFullHistory ? "ghost-muted" : "outline"}
              size="sm"
              {...pointerFocusProps}
              aria-pressed={!keepFullHistory}
              aria-label={`Compact ${compactTokens} tokens of history before sending`}
              disabled={!canOperateThread}
              onClick={onToggleKeepFullHistory}
            />
          }
        >
          <Minimize2Icon aria-hidden="true" />
          {keepFullHistory ? "Keep full" : "Compact next"}
        </TooltipTrigger>
        <TooltipPopup>
          <div>
            {keepFullHistory
              ? `Next send keeps all ${compactTokens} tokens.`
              : `Next send compacts ${compactTokens} tokens first.`}
          </div>
          <div>{keepFullHistory ? "Click to compact first" : "Click to keep full history"}</div>
        </TooltipPopup>
      </Tooltip>
      {submit}
    </div>
  );
});
