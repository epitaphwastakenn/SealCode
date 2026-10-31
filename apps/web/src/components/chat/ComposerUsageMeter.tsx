import type { ServerProvider } from "@t3tools/contracts";
import { composerUsage, formatResetsIn } from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRightIcon, TimerIcon } from "lucide-react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { UsageBar, usageTone } from "../ui/usage-ring";
import { composerFloatingLayerProps } from "./composerEventScope";

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
  const peakTone = usageTone(usage.peakPercent);
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
            className="size-7 shrink-0"
            aria-label={`${title}: ${usage.peakPercent}% used`}
            data-composer-usage-meter
            data-resting-controls-fixed
          >
            <TimerIcon
              aria-hidden="true"
              className={
                peakTone === "error"
                  ? "text-error-foreground"
                  : peakTone === "warning"
                    ? "text-warning-foreground"
                    : undefined
              }
            />
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
            <div className="min-w-0 truncate text-xs font-medium text-muted-foreground">
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
            return (
              <div key={row.window.id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-medium text-foreground">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {row.usedPercent}% used
                  </span>
                </div>
                <UsageBar percent={row.usedPercent} label={`${row.label} usage`} />
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
