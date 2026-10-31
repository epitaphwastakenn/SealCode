import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  threadDetailsRowClassName,
  threadDetailsSelectRowClassName,
  threadDetailsSplitPrimaryClassName,
  threadDetailsSplitSecondaryClassName,
  threadDetailsIconActionClassName,
  threadDetailsMetaActionClassName,
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  threadDetailsSelectLabelClassName,
  threadDetailsSelectIconClassName,
} from "./threadDetailsPanelStyles";
import { ChevronDownIcon } from "lucide-react";

const parts = {
  row: threadDetailsRowClassName,
  select: threadDetailsSelectRowClassName,
  primary: threadDetailsSplitPrimaryClassName,
  secondary: threadDetailsSplitSecondaryClassName,
  icon: threadDetailsIconActionClassName,
  meta: threadDetailsMetaActionClassName,
};

export function ThreadDetailsControl({
  panel = true,
  part = "row",
  multiline = false,
  tone = "default",
  className,
  children,
  size = "default",
  variant = "default",
  render,
  ...props
}: ComponentProps<typeof Button> & {
  panel?: boolean;
  part?: keyof typeof parts;
  multiline?: boolean;
  tone?: "default" | "muted" | "primary" | "destructive";
}) {
  const control = useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(
      {
        type: render ? undefined : "button",
        className: cn(
          "relative inline-flex shrink-0 cursor-pointer items-center whitespace-nowrap border outline-none transition-[color,background-color,box-shadow,scale] duration-150 ease-out [&:not([aria-haspopup]):not(:disabled):not([aria-disabled=true])]:will-change-[scale] [&:active:not([aria-haspopup])]:scale-[0.97] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:shrink-0",
          parts[part],
          multiline && "h-auto min-h-8 py-0.75 disabled:opacity-100 sm:h-auto",
          tone === "muted" && "text-muted-foreground hover:text-foreground",
          tone === "primary" &&
            "bg-primary text-primary-foreground hover:bg-primary/85 hover:text-primary-foreground data-pressed:bg-primary/85",
          tone === "destructive" &&
            "text-destructive-foreground hover:text-destructive-foreground data-pressed:text-destructive-foreground",
          // PR row actions share one 20px pill with a 1px inset focus ring that stays clear of the
          // label. The solid pill draws it in the canvas color so it shows against the fill.
          part === "meta" &&
            (tone === "primary" || tone === "destructive") &&
            "h-5 focus-visible:ring-1",
          part === "meta" && tone === "primary" && "focus-visible:ring-background",
          part === "meta" &&
            tone === "destructive" &&
            "bg-destructive/10 hover:bg-destructive/16 data-pressed:bg-destructive/16",
          className,
        ),
      },
      props,
      {
        children:
          part === "select" ? (
            <>
              <span data-slot="select-label" className={threadDetailsSelectLabelClassName}>
                {children}
              </span>
              <span data-slot="select-icon" className={threadDetailsSelectIconClassName}>
                <ChevronDownIcon className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} />
              </span>
            </>
          ) : (
            children
          ),
      },
    ),
  });
  if (!panel) {
    return (
      <Button
        {...props}
        render={render}
        size={multiline ? "sm-multiline" : size}
        variant={variant}
        className={className}
      >
        {children}
      </Button>
    );
  }
  return control;
}
