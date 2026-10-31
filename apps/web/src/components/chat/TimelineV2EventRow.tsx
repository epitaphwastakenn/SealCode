import { WorkLogBlock, WorkLogDetails, WorkLogRow } from "./WorkLog";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import { environmentThreadDetails } from "../../state/threads";
import {
  subagentGroupSummary,
  summarizeSubagentStatuses,
} from "@t3tools/client-runtime/state/subagent-display";
import { memo, use, useState } from "react";
import ChatMarkdown from "../ChatMarkdown";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DisclosureChevron } from "../ui/disclosure-chevron";
import { cn } from "~/lib/utils";
import { V2ItemInspector } from "./V2ItemInspector";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "../ui/collapsible";
import {
  isV2LifecycleItem,
  EnvironmentSubagentAvatar,
  SubagentElapsed,
  V2LifecycleRow,
} from "./V2LifecycleRow";
import { SecretRequestCard } from "./SecretRequestCard";
import { TimelineRowCtx, type TimelineRow } from "./timelineRowContext";
import { v2EventPresentation, subagentGroupTiming } from "./TimelineV2EventRow.logic";

export function V2EventTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "event" }> }) {
  const ctx = use(TimelineRowCtx);
  const { item, visibility } = row.projectedItem;
  if (item.type === "subagent" && (row.subagents?.length ?? 1) > 1) {
    return <V2SubagentGroup key={row.id} row={row} />;
  }
  if (item.type === "secret_request") {
    return (
      <SecretRequestCard
        environmentId={ctx.activeThreadEnvironmentId}
        item={item}
        visibility={visibility}
      />
    );
  }
  if (isV2LifecycleItem(item)) {
    return (
      <V2LifecycleRow
        environmentId={ctx.activeThreadEnvironmentId}
        item={item}
        resourceSummary={row.resourceSummary}
        createdAt={row.createdAt}
        timestampFormat={ctx.timestampFormat}
        runs={ctx.runs}
        onOpenThread={ctx.onOpenThread}
      />
    );
  }
  return <V2GenericEventRow row={row} />;
}

function V2GenericEventRow({ row }: { row: Extract<TimelineRow, { kind: "event" }> }) {
  const ctx = use(TimelineRowCtx);
  const [expanded, setExpanded] = useState(false);
  const { item, visibility } = row.projectedItem;
  const presentation = v2EventPresentation(item);
  const Icon = presentation.icon;
  const alertVariant =
    presentation.tone === "danger"
      ? "error"
      : presentation.tone === "warning"
        ? "warning"
        : presentation.tone === "success"
          ? "success"
          : null;
  const statusBadge =
    item.status === "failed" ? (
      <Badge variant="error" size="sm">
        Failed
      </Badge>
    ) : item.status === "interrupted" ? (
      <Badge variant="warning" size="sm">
        Interrupted
      </Badge>
    ) : null;
  const detail = presentation.detail ? (
    <div className="text-xs leading-relaxed text-muted-foreground">
      <ChatMarkdown
        text={presentation.detail}
        cwd={ctx.markdownCwd}
        threadRef={ctx.threadRef ?? undefined}
        skills={ctx.skills}
        lineBreaks
      />
    </div>
  ) : null;
  const inspector = (
    <V2ItemInspector
      projectedItem={row.projectedItem}
      environmentId={ctx.activeThreadEnvironmentId}
      cwd={ctx.markdownCwd}
      workspaceRoot={ctx.workspaceRoot}
      onOpenThread={ctx.onOpenThread}
      onOpenTurnDiff={ctx.onOpenTurnDiff}
      onRollbackCheckpoint={ctx.onRollbackCheckpoint}
      onImageExpand={ctx.onImageExpand}
      source={ctx.turnItemSource}
    />
  );

  if (alertVariant) {
    return (
      <div data-v2-item-type={item.type} data-v2-item-visibility={visibility}>
        <Alert variant={alertVariant}>
          <Icon />
          <AlertTitle>
            <span className="flex items-center gap-2">
              {presentation.label}
              {statusBadge}
            </span>
          </AlertTitle>
          {detail ? <AlertDescription>{detail}</AlertDescription> : null}
          <AlertAction>
            <Button
              size="xs"
              variant="ghost-muted"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              Details
              <DisclosureChevron open={expanded} />
            </Button>
          </AlertAction>
        </Alert>
        {expanded ? <div className="mt-2 ps-1">{inspector}</div> : null}
      </div>
    );
  }

  const toggle = () => setExpanded((open) => !open);
  return (
    <WorkLogRow
      data-v2-item-type={item.type}
      data-v2-item-visibility={visibility}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      }}
      icon={<Icon className="size-4 shrink-0 text-icon-muted" />}
      label={
        <>
          {presentation.label}
          {presentation.detail ? (
            <span className="ms-1.5 text-muted-foreground">{presentation.detail}</span>
          ) : null}
        </>
      }
      trailing={
        <>
          {statusBadge}
          <DisclosureChevron open={expanded} />
        </>
      }
    >
      {expanded ? (
        <WorkLogDetails kind="panel">
          <div className="flex flex-col gap-2">
            {detail}
            {inspector}
          </div>
        </WorkLogDetails>
      ) : null}
    </WorkLogRow>
  );
}

const V2SubagentGroup = memo(function V2SubagentGroup({
  row,
}: {
  row: Extract<TimelineRow, { kind: "event" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const groupId = `subagent-group:${row.id}`;
  const [expanded, setExpanded] = useState(() =>
    ctx.workGroupViewState.expandedEntries.has(groupId),
  );
  const members = (row.subagents ?? [row.projectedItem]).flatMap(({ item }) =>
    item.type === "subagent" ? [item] : [],
  );
  const liveAgents = useAtomValue(
    environmentThreadDetails.threadAtom(
      scopeThreadRef(ctx.activeThreadEnvironmentId, row.projectedItem.item.threadId),
    ),
    (thread) => thread?.projection.subagents,
  );
  const agents = members.map((item) => {
    const live = liveAgents?.find((agent) => agent.id === item.subagentId);
    return {
      item,
      status: live?.status ?? item.status,
      startedAt: live?.startedAt ?? item.startedAt,
      completedAt: live?.completedAt ?? item.completedAt,
    };
  });
  const summary = subagentGroupSummary(agents);
  const label = `${members.length} ${members.length === 1 ? "subagent" : "subagents"}`;
  const statusSummary = summarizeSubagentStatuses(agents.map(({ status }) => status));
  const toggleExpanded = (open: boolean) => {
    ctx.onToggleWorkEntry(row.id, expanded);
    if (open) ctx.workGroupViewState.expandedEntries.add(groupId);
    else ctx.workGroupViewState.expandedEntries.delete(groupId);
    setExpanded(open);
  };
  return (
    <WorkLogBlock continues={row.continuesWorkLog}>
      <Collapsible open={expanded} onOpenChange={toggleExpanded} data-subagent-group>
        <CollapsibleTrigger
          aria-label={label}
          aria-description={statusSummary}
          className={cn(
            "flex w-full min-w-0 items-center gap-2.5 py-2 text-left transition-colors hover:text-foreground",
            expanded || summary.active ? "text-foreground" : "text-secondary-label",
          )}
        >
          <span className="flex shrink-0 items-center -space-x-1.5" aria-hidden>
            {agents.slice(0, 3).map(({ item, status }) => (
              <EnvironmentSubagentAvatar
                key={item.id}
                environmentId={ctx.activeThreadEnvironmentId}
                providerInstanceId={item.providerInstanceId}
                driver={item.driver}
                status={agents.length === 1 ? status : undefined}
              />
            ))}
            {agents.length > 3 ? (
              <span className="relative inline-flex size-6 items-center justify-center rounded-full bg-muted text-3xs font-medium text-muted-foreground ring-2 ring-background">
                +{agents.length - 3}
              </span>
            ) : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{label}</span>
            <span
              className={cn(
                "block truncate text-xs text-muted-foreground",
                summary.active ? "text-info-foreground" : summary.failed && "text-error-foreground",
              )}
            >
              {statusSummary}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            <SubagentElapsed agent={subagentGroupTiming(agents)} />
          </span>
          <DisclosureChevron open={expanded} />
        </CollapsibleTrigger>
        {/* Virtualized rows must settle before disclosure scroll anchoring resumes. */}
        <CollapsiblePanel animate={false}>
          {expanded ? (
            <div className="mt-1 mb-1 rounded-xl bg-foreground/[0.03] p-1">
              {members.map((item) => (
                <V2LifecycleRow
                  environmentId={ctx.activeThreadEnvironmentId}
                  key={item.id}
                  item={item}
                  createdAt={row.createdAt}
                  timestampFormat={ctx.timestampFormat}
                  runs={ctx.runs}
                  onOpenThread={ctx.onOpenThread}
                />
              ))}
            </div>
          ) : null}
        </CollapsiblePanel>
      </Collapsible>
    </WorkLogBlock>
  );
});
