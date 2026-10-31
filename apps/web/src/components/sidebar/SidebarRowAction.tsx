import { type ComponentProps } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const sidebarRowActionRevealClassName =
  "pointer-events-none opacity-0 transition-opacity duration-150 ease-out has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100 group-any-hover/sidebar-row:pointer-events-auto group-any-hover/sidebar-row:opacity-100 motion-reduce:transition-none";

export function SidebarRowAction({
  label,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "aria-label" | "size" | "variant"> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            aria-label={label}
            className={className}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function SidebarRowActionSlot({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn(sidebarRowActionRevealClassName, className)} {...props} />;
}
