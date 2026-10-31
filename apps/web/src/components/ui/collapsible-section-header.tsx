import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { DisclosureChevron } from "./disclosure-chevron";

const tones = {
  muted: "text-sidebar-muted-foreground",
  emphasized: "text-sidebar-foreground",
  accent: "text-primary",
} as const;

export function CollapsibleSectionHeader({
  children,
  expanded,
  tone = "muted",
  variant = "default",
  accessory,
  ...buttonProps
}: Omit<ComponentProps<"button">, "className" | "style" | "aria-expanded"> & {
  expanded: boolean;
  tone?: keyof typeof tones;
  variant?: "default" | "panel";
  accessory?: ReactNode;
}) {
  return (
    <button
      {...buttonProps}
      type="button"
      aria-expanded={expanded}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        variant === "panel" ? "ps-2 pe-2.5" : "px-2",
        tones[tone],
      )}
    >
      <span className="shrink-0">{children}</span>
      <span aria-hidden className="min-w-2 flex-1" />
      {accessory}
      <DisclosureChevron className="text-sidebar-muted-foreground" open={expanded} />
    </button>
  );
}

export function SectionHeaderStatus({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 text-3xs leading-none text-destructive-foreground">{children}</span>
  );
}
