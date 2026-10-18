import type { EnvironmentId, GlobalMcpStatus, ThreadId } from "@t3tools/contracts";
import type { PendingBackgroundWorkItem } from "@t3tools/client-runtime/state/thread-execution";
import { useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  CpuIcon,
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { mcpStatusLabel, threadMcpServers } from "./ThreadSessionPanel.logic";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
} from "./threadDetailsPanelStyles";

export interface ThreadSessionInfo {
  readonly modelLabel: string | null;
  /** Provider and permission mode, shown under the model. */
  readonly modelDetail: string | null;
  readonly contextWindow: ContextWindowSnapshot | null;
  readonly backgroundWork: ReadonlyArray<PendingBackgroundWorkItem>;
  /** Whether the provider is handed SealCode's MCP servers at all. */
  readonly receivesMcpServers: boolean;
}

const BACKGROUND_WORK_ICON: Partial<Record<PendingBackgroundWorkItem["kind"], LucideIcon>> = {
  subagent: BotIcon,
  command: SquareTerminalIcon,
  monitor: EyeIcon,
  background_task: SquareTerminalIcon,
};

const MCP_STATE_DOT_CLASS: Record<GlobalMcpStatus["state"], string> = {
  ready: "bg-emerald-500",
  connecting: "bg-sky-500",
  error: "bg-destructive",
  stopped: "bg-muted-foreground/40",
  disabled: "bg-muted-foreground/40",
};

function contextUsageColor(percent: number): string {
  if (percent >= 90) return "var(--color-error)";
  if (percent >= 75) return "var(--color-warning)";
  return "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";
}

function SessionRow(props: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly detail?: string | null;
  readonly trailing?: string | null;
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
          <span className="truncate text-sm font-medium text-foreground/80">{props.title}</span>
          {props.trailing ? (
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
              {props.trailing}
            </span>
          ) : null}
        </div>
        {props.detail ? (
          <p className="truncate text-2xs text-muted-foreground">{props.detail}</p>
        ) : null}
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
      trailing={
        usage.maxTokens == null
          ? `${used} tokens`
          : `${used} / ${formatContextWindowTokens(usage.maxTokens)}${
              percent === null ? "" : ` · ${Math.round(percent)}%`
            }`
      }
    >
      {percent === null ? null : (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-muted/60"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-label="Context window usage"
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${percent}%`, backgroundColor: contextUsageColor(percent) }}
          />
        </div>
      )}
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
                <span
                  className={cn(
                    "absolute -right-1 -top-1 size-1.5 rounded-full",
                    MCP_STATE_DOT_CLASS[server.state],
                  )}
                  aria-hidden
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/80">
                {server.displayName ?? server.id}
              </span>
              <span
                className={cn(
                  "shrink-0 text-2xs tabular-nums",
                  server.state === "error" ? "text-destructive" : "text-muted-foreground",
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
 * What the thread's session knows beyond its workspace: the model, the context
 * window the provider last reported, background work still running, and the
 * MCP servers SealCode hands its agent. A provider that reports none of it
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
  const hasSessionRows =
    session.modelLabel !== null || session.contextWindow !== null || backgroundWork.length > 0;

  return (
    <>
      {hasSessionRows ? (
        <ThreadDetailsSection headingId="thread-details-session-heading" title="Session">
          <ul className="m-0 list-none p-0">
            {session.modelLabel !== null ? (
              <SessionRow icon={CpuIcon} title={session.modelLabel} detail={session.modelDetail} />
            ) : null}
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
