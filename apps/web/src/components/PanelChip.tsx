import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

interface PanelChipProps extends Omit<ComponentProps<"div">, "children" | "onClick"> {
  active?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  tooltip?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  render?: useRender.ComponentProps<"button">["render"];
}

export function PanelChip({
  active = false,
  icon,
  label,
  tooltip,
  trailing,
  onClick,
  render,
  className,
  ...props
}: PanelChipProps) {
  const interactive = onClick !== undefined || render !== undefined;
  const labelProps = {
    className: cn(
      "flex min-w-0 flex-1 items-center text-left outline-none",
      interactive && "cursor-pointer",
    ),
    "data-panel-chip-label": "",
    onClick,
    type: interactive ? ("button" as const) : undefined,
  };
  const labelElement = useRender({
    defaultTagName: interactive ? "button" : "span",
    props: mergeProps<"button">(labelProps, {
      children: <span className="truncate">{label}</span>,
    }),
    render,
  });

  return (
    <div
      data-active={active || undefined}
      data-slot="panel-chip"
      {...props}
      className={cn(
        "group/tab flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md pl-1.5 text-xs transition-[background-color,color] duration-150 ease-out has-[[data-panel-chip-label]:focus-visible]:ring-2 has-[[data-panel-chip-label]:focus-visible]:ring-inset has-[[data-panel-chip-label]:focus-visible]:ring-ring/70 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0",
        trailing ? "pr-1" : "pr-2",
        active
          ? "bg-row-selected text-foreground"
          : "text-muted-foreground hover:bg-row-hover hover:text-foreground",
        className,
      )}
    >
      {icon}
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger render={labelElement} />
          <TooltipPopup>{tooltip}</TooltipPopup>
        </Tooltip>
      ) : (
        labelElement
      )}
      {trailing ? (
        <span data-slot="panel-chip-trailing" className="flex shrink-0 items-center gap-0.5">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
