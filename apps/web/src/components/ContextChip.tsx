import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

const contextChipVariants = cva(
  "inline-flex h-[1.41em] max-w-full items-center gap-[0.33em] rounded-(--control-radius) border px-[0.5em] align-middle font-medium text-[0.86em] leading-none [&_svg]:block [&_svg]:size-[1.17em] [&_svg]:shrink-0 [&_svg]:self-center [button&,a&,[data-popup-open]&]:cursor-pointer [button&,a&]:transition-colors [button&,a&]:motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground disabled:cursor-default",
  {
    defaultVariants: { kind: "neutral" },
    variants: {
      kind: {
        neutral: "border-border bg-row-hover text-foreground",
        image: "[--context-chip-accent:var(--muted-foreground)]",
        video: "[--context-chip-accent:var(--muted-foreground)]",
        file: "[--context-chip-accent:var(--muted-foreground)]",
        mention: "[--context-chip-accent:var(--muted-foreground)]",
        terminal: "[--context-chip-accent:var(--success)]",
        element: "[--context-chip-accent:var(--brand-accent)]",
        "preview-annotation": "[--context-chip-accent:var(--warning)]",
        "review-comment": "[--context-chip-accent:var(--brand-accent)]",
        "pull-request": "[--context-chip-accent:var(--info)]",
        "pr-open": "[--context-chip-accent:var(--success)]",
        "pr-draft": "[--context-chip-accent:var(--muted-foreground)]",
        "pr-merged": "[--context-chip-accent:var(--brand-accent)]",
        "pr-closed": "[--context-chip-accent:var(--destructive)]",
        skill: "[--context-chip-accent:var(--brand-accent)]",
        thread: "[--context-chip-accent:var(--muted-foreground)]",
        citation: "[--context-chip-accent:var(--muted-foreground)]",
      },
      state: {
        unresolved: "border-dashed",
        invalid: "",
      },
    },
    compoundVariants: [
      {
        kind: [
          "image",
          "video",
          "file",
          "mention",
          "terminal",
          "element",
          "preview-annotation",
          "review-comment",
          "pull-request",
          "pr-open",
          "pr-draft",
          "pr-merged",
          "pr-closed",
          "skill",
          "thread",
          "citation",
        ],
        className:
          "[--context-chip-border:color-mix(in_oklab,var(--context-chip-accent)_34%,var(--contrast-border))] [--context-chip-border-hover:color-mix(in_oklab,var(--context-chip-accent)_48%,var(--contrast-border))] [--context-chip-foreground:color-mix(in_oklab,var(--context-chip-accent)_22%,var(--contrast-foreground))] border-(--context-chip-border) bg-(--context-chip-accent)/11 text-(--context-chip-foreground) [button:enabled&,a&]:hover:border-(--context-chip-border-hover) [button:enabled&,a&]:hover:bg-(--context-chip-accent)/17",
      },
      { state: "unresolved", className: "text-foreground" },
      {
        state: "invalid",
        className: "border-destructive/32 bg-destructive/8 text-error-foreground",
      },
    ],
  },
);

type ContextChipKind = NonNullable<VariantProps<typeof contextChipVariants>["kind"]>;

interface ContextChipProps extends useRender.ComponentProps<"span"> {
  kind?: ContextChipKind;
  state?: "unresolved" | "invalid";
}

function ContextChip({ className, kind, state, render, ...props }: ContextChipProps) {
  const defaultProps = {
    className: cn(contextChipVariants({ kind, state }), className),
    "data-slot": "context-chip",
    "data-state": state,
  };
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}

function ContextChipLabel({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("block min-w-0 self-center truncate leading-tight", className)}
      data-slot="context-chip-label"
      {...props}
    />
  );
}

function ContextChipAction({ className, render, ...props }: useRender.ComponentProps<"button">) {
  const defaultProps = {
    className: cn(
      "ml-[0.17em] inline-flex size-[1.17em] shrink-0 cursor-pointer items-center justify-center rounded-sm text-current transition-colors hover:bg-(--context-chip-accent,var(--color-foreground))/17 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none [&_svg]:size-[0.85em]",
      className,
    ),
    "data-slot": "context-chip-action",
    type: render ? undefined : ("button" as const),
  };
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export { ContextChip, ContextChipAction, ContextChipLabel, type ContextChipKind };
