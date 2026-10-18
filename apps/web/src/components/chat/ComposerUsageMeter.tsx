import type { ServerProvider } from "@t3tools/contracts";
import { composerUsage, formatResetsIn } from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { composerFloatingLayerProps } from "./composerEventScope";

const RADIUS = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function usageColor(percent: number): string {
  if (percent >= 90) return "var(--color-error)";
  if (percent >= 75) return "var(--color-warning)";
  return "var(--color-info)";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The selected instance's subscription windows next to the model picker, read
 * from the same probe snapshot the Usage page shows. Renders nothing when the
 * instance has no windows for this model.
 */
export function ComposerUsageMeter(props: {
  readonly provider: ServerProvider | null;
  readonly model: string | null;
}) {
  const now = Date.parse(`${useNowMinute()}Z`);
  const navigate = useNavigate();
  const usage = composerUsage(props.provider, props.model, now);
  if (usage === null) return null;
  const peakColor = usageColor(usage.peakPercent);
  const title = usage.group ? `Usage · ${usage.group}` : "Usage";

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={150}
        render={
          <Button
            size="icon-sm"
            variant="ghost-muted"
            className="size-7"
            aria-label={`${title}: ${usage.peakPercent}% used`}
            data-composer-usage-meter
          >
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full mx-0!"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={RADIUS}
                  fill="none"
                  className="stroke-muted-foreground/24"
                  strokeWidth="3"
                />
                {usage.peakPercent > 0 ? (
                  <circle
                    cx="12"
                    cy="12"
                    r={RADIUS}
                    fill="none"
                    stroke={peakColor}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={CIRCUMFERENCE * (1 - usage.peakPercent / 100)}
                  />
                ) : null}
              </svg>
            </span>
          </Button>
        }
      />
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        align="end"
        padding="none"
        width="sm"
        className="text-left whitespace-normal"
      >
        <div className="flex flex-col gap-3 p-(--floating-content-inset)">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 truncate font-medium text-muted-foreground text-xs">
              {title}
            </div>
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Open usage"
              onClick={() => void navigate({ to: "/usage" })}
            >
              <ArrowUpRightIcon aria-hidden="true" />
            </Button>
          </div>
          {usage.rows.map((row) => {
            const resetsIn = formatResetsIn(row.window, now);
            const color = usageColor(row.usedPercent);
            return (
              <div key={row.window.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-medium text-foreground">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {row.usedPercent}% used
                  </span>
                </div>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={row.usedPercent}
                  aria-label={`${row.label} usage`}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${row.usedPercent}%`, backgroundColor: color }}
                  />
                </div>
                {resetsIn ? (
                  <div className="text-2xs text-secondary-label tabular-nums">
                    {capitalize(resetsIn)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
