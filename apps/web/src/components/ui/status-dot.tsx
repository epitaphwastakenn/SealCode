import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

const statusDotVariants = cva("inline-block shrink-0 rounded-full", {
  defaultVariants: { size: "sm", tone: "muted" },
  variants: {
    size: {
      sm: "size-1.5",
      md: "size-2",
    },
    tone: {
      brand: "bg-brand",
      error: "bg-destructive",
      info: "bg-info",
      muted: "bg-muted-foreground",
      success: "bg-success",
      warning: "bg-warning",
    },
  },
});

type StatusDotTone = NonNullable<VariantProps<typeof statusDotVariants>["tone"]>;
type StatusDotSize = NonNullable<VariantProps<typeof statusDotVariants>["size"]>;

interface StatusDotProps extends Omit<React.ComponentProps<"span">, "children"> {
  tone?: StatusDotTone;
  size?: StatusDotSize;
}

function StatusDot({ className, tone, size, ...props }: StatusDotProps) {
  return (
    <span
      aria-hidden={props["aria-label"] ? undefined : true}
      className={cn(statusDotVariants({ size, tone }), className)}
      data-slot="status-dot"
      data-tone={tone ?? "muted"}
      {...props}
    />
  );
}

export { StatusDot, statusDotVariants, type StatusDotSize, type StatusDotTone };
