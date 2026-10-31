import { cva } from "class-variance-authority";

import { cn } from "~/lib/utils";

type UsageTone = "muted" | "warning" | "error";

function usageTone(percent: number): UsageTone {
  if (percent >= 90) return "error";
  if (percent >= 75) return "warning";
  return "muted";
}

function clampPercent(percent: number | null | undefined): number {
  if (percent == null || !Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

const usageToneVariants = cva("", {
  defaultVariants: { tone: "muted" },
  variants: {
    tone: {
      error: "text-error",
      muted: "text-muted-foreground",
      warning: "text-warning",
    },
  },
});

const ringRadius = 9.75;
const ringCircumference = 2 * Math.PI * ringRadius;

function UsageRing({
  percent,
  size = "md",
  className,
}: {
  percent: number | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  const value = clampPercent(percent);
  return (
    <svg
      aria-hidden="true"
      className={cn(
        "-rotate-90 shrink-0 transform-gpu",
        size === "sm" ? "size-4" : "size-5",
        usageToneVariants({ tone: usageTone(value) }),
        className,
      )}
      data-slot="usage-ring"
      viewBox="0 0 24 24"
    >
      <circle
        cx="12"
        cy="12"
        r={ringRadius}
        fill="none"
        className="stroke-muted-foreground/24"
        strokeWidth="3"
      />
      <circle
        cx="12"
        cy="12"
        r={ringRadius}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={ringCircumference}
        strokeDashoffset={ringCircumference * (1 - value / 100)}
        className="transition-[stroke-dashoffset,stroke] duration-200 ease-out motion-reduce:transition-none"
      />
    </svg>
  );
}

function UsageBar({
  percent,
  label,
  className,
}: {
  percent: number | null | undefined;
  label: string;
  className?: string;
}) {
  const value = clampPercent(percent);
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(value)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.08]", className)}
      data-slot="usage-bar"
      role="progressbar"
    >
      <div
        className={cn(
          "h-full origin-left rounded-full bg-current transition-[transform,color] duration-200 ease-out motion-reduce:transition-none",
          usageToneVariants({ tone: usageTone(value) }),
        )}
        style={{ transform: `scaleX(${value / 100})` }}
      />
    </div>
  );
}

export { UsageBar, UsageRing, usageTone, type UsageTone };
