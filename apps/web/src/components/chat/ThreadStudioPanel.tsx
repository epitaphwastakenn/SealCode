import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { playtestsAllowed } from "@t3tools/shared/studioControls";
import { BoxIcon, PlayIcon } from "lucide-react";

import {
  useStudioControlsApply,
  useStudioPlaces,
  useThreadStudioControls,
} from "../../hooks/useThreadStudioControls";
import { cn } from "../../lib/utils";
import { useThreadShell } from "../../state/entities";
import { Switch } from "../ui/switch";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  studioPlaceChange,
  studioPlaceDetail,
  studioPlaceRows,
  type StudioPlaceRow,
} from "./ThreadStudioPanel.logic";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
} from "./threadDetailsPanelStyles";

function PanelRow(props: {
  readonly icon: typeof BoxIcon;
  readonly dot?: "connected" | "away" | undefined;
  readonly title: string;
  readonly switchLabel: string;
  readonly detail?: string | null | undefined;
  readonly muted?: boolean | undefined;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  const Icon = props.icon;
  return (
    <li
      className={cn("flex items-center rounded-lg py-1.5", THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS)}
    >
      <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
        <Icon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
        {props.dot === undefined ? null : (
          <span
            className={cn(
              "absolute -right-1 -top-1 size-1.5 rounded-full",
              props.dot === "connected" ? "bg-success" : "bg-muted-foreground",
            )}
            aria-hidden
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-medium",
            props.muted ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {props.title}
        </span>
        {props.detail ? (
          <p className="truncate text-2xs text-muted-foreground">{props.detail}</p>
        ) : null}
      </div>
      <Switch
        size="sm"
        checked={props.checked}
        onCheckedChange={props.onCheckedChange}
        aria-label={props.switchLabel}
      />
    </li>
  );
}

function StudioPlaceRowItem(props: {
  readonly row: StudioPlaceRow;
  readonly onChange: (change: ReturnType<typeof studioPlaceChange>) => void;
}) {
  const { row } = props;
  return (
    <PanelRow
      icon={BoxIcon}
      dot={row.connected ? "connected" : "away"}
      title={row.name}
      switchLabel={`Let the agent use ${row.name}`}
      detail={studioPlaceDetail(row)}
      muted={!row.included}
      checked={row.included}
      onCheckedChange={(included) => props.onChange(studioPlaceChange(row, included))}
    />
  );
}

export function ThreadStudioPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const applies = useStudioControlsApply({
    environmentId: props.environmentId,
    threadId: props.threadId,
    enabled: true,
  });
  const shell = useThreadShell({ environmentId: props.environmentId, threadId: props.threadId });
  const places = useStudioPlaces(props.environmentId, applies);
  const { controls, change } = useThreadStudioControls({
    environmentId: props.environmentId,
    threadId: props.threadId,
    composerDraftTarget: { environmentId: props.environmentId, threadId: props.threadId },
    isDraft: false,
    serverControls: shell?.studioControls,
  });
  if (!applies) return null;
  const rows = studioPlaceRows(places, controls);

  return (
    <ThreadDetailsSection
      headingId="thread-details-studio-heading"
      title="Studio places"
      data-thread-studio-panel
    >
      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <StudioPlaceRowItem key={row.placeKey} row={row} onChange={change} />
        ))}
        <PanelRow
          icon={PlayIcon}
          title="Playtests"
          switchLabel="Let the agent start playtests"
          detail={playtestsAllowed(controls) ? null : "The agent cannot start one"}
          checked={playtestsAllowed(controls)}
          onCheckedChange={(allowPlaytests) => change({ allowPlaytests })}
        />
      </ul>
      {rows.length === 0 ? (
        <p className="px-2.5 pt-1 text-2xs text-muted-foreground">
          No Studio place is connected. Open one in Roblox Studio.
        </p>
      ) : null}
    </ThreadDetailsSection>
  );
}
