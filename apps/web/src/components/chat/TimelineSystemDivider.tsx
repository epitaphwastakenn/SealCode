import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ActivityShimmerOverlay } from "./TimelineRowParts";

export function TimelineSystemDivider(props: {
  readonly label: string;
  readonly detail?: ReactNode | null;
  readonly tone?: "neutral" | "danger";
  readonly icon?: LucideIcon;
  readonly showDetailSeparator?: boolean;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly active?: boolean;
  readonly ariaLabel?: string;
}) {
  const Icon = props.icon;
  const content = (
    <span className="flex min-w-0 items-center justify-center gap-1.5">
      {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0" /> : null}
      <span className="font-medium">{props.label}</span>
      {props.detail ? (
        <span
          className={cn(
            "inline-flex min-w-0 items-center",
            props.tone !== "danger" && "text-muted-foreground",
            typeof props.detail === "string" && "max-w-80 truncate",
          )}
        >
          {props.showDetailSeparator === false ? null : "· "}
          {props.detail}
        </span>
      ) : null}
    </span>
  );

  return (
    <div
      role={props.ariaLabel && !props.onAction ? "separator" : undefined}
      aria-label={props.ariaLabel && !props.onAction ? props.ariaLabel : undefined}
      className={cn(
        "flex min-w-0 items-center gap-3 py-1 text-xs",
        props.tone === "danger" ? "text-error-foreground" : "text-secondary-label",
      )}
    >
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      {props.onAction ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="glass"
                size="xs"
                aria-label={props.actionLabel}
                onClick={props.onAction}
                className="min-w-0"
              />
            }
          >
            {content}
          </TooltipTrigger>
          <TooltipPopup side="top">{props.actionLabel}</TooltipPopup>
        </Tooltip>
      ) : props.active ? (
        <span ref={observeVisibleAnimation} className="relative min-w-0 overflow-hidden">
          {content}
          <ActivityShimmerOverlay>{content}</ActivityShimmerOverlay>
        </span>
      ) : (
        content
      )}
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
