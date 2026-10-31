import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { ThreadHoverCardPopup } from "../ThreadHoverCard";
import { DisclosureChevron } from "../ui/disclosure-chevron";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";

export function SubagentRow(props: {
  readonly avatar: ReactNode;
  readonly title: string;
  readonly detail: ReactNode | null;
  readonly failed: boolean;
  readonly statusText: string | null;
  readonly time: ReactNode | null;
  readonly description: string | null;
  readonly onOpen: (() => void) | null;
  readonly tooltip: ReactNode;
  readonly rowProps?: Record<string, string>;
}) {
  const className =
    "group/subagent flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left";
  const statusTone = props.failed ? "text-error-foreground" : "text-muted-foreground";
  const content = (
    <>
      {props.avatar}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{props.title}</span>
        {props.detail === null ? null : (
          <span className={cn("block text-xs leading-relaxed", statusTone)}>{props.detail}</span>
        )}
      </span>
      {props.statusText === null ? null : (
        <span className={cn("shrink-0 text-xs", statusTone)}>{props.statusText}</span>
      )}
      {props.time === null ? null : (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{props.time}</span>
      )}
      {props.onOpen === null ? null : <DisclosureChevron open={false} />}
    </>
  );
  const onOpen = props.onOpen;
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={
          onOpen === null ? (
            <div
              {...props.rowProps}
              aria-description={props.description ?? undefined}
              className={className}
            >
              {content}
            </div>
          ) : (
            <button
              type="button"
              {...props.rowProps}
              aria-label={`Open ${props.title}`}
              aria-description={props.description ?? undefined}
              onClick={onOpen}
              className={cn(
                className,
                "cursor-pointer transition-colors hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
              )}
            >
              {content}
            </button>
          )
        }
      />
      <ThreadHoverCardPopup>{props.tooltip}</ThreadHoverCardPopup>
    </Tooltip>
  );
}
