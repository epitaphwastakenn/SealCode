import type { EnvironmentId, GlobalMcpStatus, ThreadId } from "@t3tools/contracts";
import type { PendingBackgroundWorkItem } from "@t3tools/client-runtime/state/thread-execution";
import { useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  EyeIcon,
  GaugeIcon,
  type LucideIcon,
  PlugIcon,
  Settings2Icon,
  SquareTerminalIcon,
} from "lucide-react";

import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { StatusDot, type StatusDotTone } from "../ui/status-dot";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { UsageBar, usageTone } from "../ui/usage-ring";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { mcpStatusLabel, threadMcpServers } from "./ThreadSessionPanel.logic";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
  threadDetailsMetaClassName,
  threadDetailsRowLabelClassName,
} from "./threadDetailsPanelStyles";

export interface ThreadSessionInfo {
  readonly modelLabel: string | null;
  /** Provider and permission mode, shown under the model. */
  readonly modelDetail: string | null;
  readonly contextWindow: ContextWindowSnapshot | null;
  readonly backgroundWork: ReadonlyArray<PendingBackgroundWorkItem>;
  /** Whether the provider is handed Harp's MCP servers at all. */
  readonly receivesMcpServers: boolean;
}

const BACKGROUND_WORK_ICON: Partial<Record<PendingBackgroundWorkItem["kind"], LucideIcon>> = {
  subagent: BotIcon,
  command: SquareTerminalIcon,
  monitor: EyeIcon,
  background_task: SquareTerminalIcon,
};

const mcpStateDotTone: Record<GlobalMcpStatus["state"], StatusDotTone> = {
  ready: "success",
  connecting: "info",
  error: "error",
  stopped: "muted",
  disabled: "muted",
};

const usageTextClassName = {
  muted: "text-muted-foreground",
  warning: "text-warning-foreground",
  error: "text-error-foreground",
} as const;

function SessionRow(props: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly trailing?: string | null;
  readonly trailingClassName?: string;
  readonly children?: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <li
      className={cn("flex items-start rounded-lg py-1.5", THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS)}
    >
      <Icon className={cn(THREAD_DETAILS_PANEL_ICON_CLASS, "mt-px")} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <span className={cn("truncate", threadDetailsRowLabelClassName)}>{props.title}</span>
          {props.trailing ? (
            <span className={cn("shrink-0", threadDetailsMetaClassName, props.trailingClassName)}>
              {props.trailing}
            </span>
          ) : null}
        </div>
        {props.children}
      </div>
    </li>
  );
}

function ContextWindowRow({ usage }: { readonly usage: ContextWindowSnapshot }) {
  const percent =
    usage.usedPercentage === null ? null : Math.max(0, Math.min(100, usage.usedPercentage));
  const used = formatContextWindowTokens(usage.usedTokens);
  return (
    <SessionRow
      icon={GaugeIcon}
      title="Context"
      trailingClassName={usageTextClassName[usageTone(percent ?? 0)]}
      trailing={
        usage.maxTokens == null
          ? `${used} tokens`
          : `${used} / ${formatContextWindowTokens(usage.maxTokens)}${
              percent === null ? "" : ` · ${Math.round(percent)}%`
            }`
      }
    >
      {percent === null ? null : <UsageBar percent={percent} label="Context window usage" />}
    </SessionRow>
  );
}

function ThreadMcpServers(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const navigate = useNavigate();
  const scoped = useEnvironmentQuery(
    serverEnvironment.mcpStatuses({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );
  const live = useEnvironmentQuery(
    serverEnvironment.mcpStatusUpdates({ environmentId: props.environmentId, input: {} }),
  );
  const servers = threadMcpServers(scoped.data ?? undefined, live.data?.statuses);
  if (servers.length === 0) return null;

  return (
    <ThreadDetailsSection
      headingId="thread-details-mcp-heading"
      title="MCP servers"
      actions={
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                aria-label="Manage MCP servers"
                onClick={() => void navigate({ to: "/settings/connections" })}
              >
                <Settings2Icon className="size-3.5" />
              </ThreadDetailsControl>
            }
          />
          <TooltipPopup>Manage MCP servers</TooltipPopup>
        </Tooltip>
      }
    >
      <ul className="m-0 list-none p-0">
        {servers.map((server) => {
          const row = (
            <li
              key={server.id}
              className={cn(
                "flex items-center rounded-lg py-1.5",
                THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
              )}
            >
              <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
                <PlugIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
                <StatusDot
                  tone={mcpStateDotTone[server.state]}
                  className="absolute -top-1 -right-1"
                />
              </span>
              <span className={cn("min-w-0 flex-1 truncate", threadDetailsRowLabelClassName)}>
                {server.displayName ?? server.id}
              </span>
              <span
                className={cn(
                  "shrink-0",
                  threadDetailsMetaClassName,
                  server.state === "error" && "text-error-foreground",
                )}
              >
                {mcpStatusLabel(server)}
              </span>
            </li>
          );
          return server.errorMessage ? (
            <Tooltip key={server.id}>
              <TooltipTrigger render={row} />
              <TooltipPopup className="max-w-72 whitespace-pre-wrap">
                {server.errorMessage}
              </TooltipPopup>
            </Tooltip>
          ) : (
            row
          );
        })}
      </ul>
    </ThreadDetailsSection>
  );
}

/**
 * What the thread's session knows beyond its workspace: the context
 * window the provider last reported, background work still running, and the
 * MCP servers Harp hands its agent. A provider that reports none of it
 * leaves its row out.
 */
export function ThreadSessionPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly session: ThreadSessionInfo;
  readonly showMcpServers: boolean;
  readonly compact: boolean;
}) {
  const { session } = props;
  const backgroundWork = props.compact ? [] : session.backgroundWork;
  const hasSessionRows = session.contextWindow !== null || backgroundWork.length > 0;

  return (
    <>
      {hasSessionRows ? (
        <ThreadDetailsSection headingId="thread-details-session-heading" title="Session">
          <ul className="m-0 list-none p-0">
            {session.contextWindow !== null ? (
              <ContextWindowRow usage={session.contextWindow} />
            ) : null}
            {backgroundWork.map((item) => (
              <SessionRow
                key={item.taskId}
                icon={BACKGROUND_WORK_ICON[item.kind] ?? SquareTerminalIcon}
                title={item.label}
                trailing="Running"
              />
            ))}
          </ul>
        </ThreadDetailsSection>
      ) : null}
      {props.showMcpServers && session.receivesMcpServers && !props.compact ? (
        <ThreadMcpServers environmentId={props.environmentId} threadId={props.threadId} />
      ) : null}
    </>
  );
}
