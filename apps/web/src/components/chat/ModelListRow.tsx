import { type ProviderDriverKind, type ProviderInstanceId } from "@t3tools/contracts";
import { memo } from "react";
import { CheckIcon, StarIcon } from "lucide-react";
import {
  getDisplayModelName,
  getTriggerDisplayModelLabel,
  type ModelEsque,
  PROVIDER_ICON_BY_PROVIDER,
} from "./providerIconUtils";
import { ComboboxItem } from "../ui/combobox";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { modelPickerModelKey } from "./modelPickerKeys";

function getModelCapabilityTags(model: ModelEsque): string[] {
  const tags: string[] = [];
  const text = `${model.slug} ${model.name}`.toLowerCase();

  if (
    text.includes("o3") ||
    text.includes("o1") ||
    text.includes("reason") ||
    text.includes("r1") ||
    text.includes("think")
  ) {
    tags.push("Thinking");
  } else if (
    text.includes("flash") ||
    text.includes("mini") ||
    text.includes("haiku") ||
    text.includes("fast")
  ) {
    tags.push("Fast");
  }

  if (
    text.includes("1m") ||
    text.includes("gemini-1.5") ||
    text.includes("gemini-2.0") ||
    text.includes("gemini-2.5")
  ) {
    tags.push("1M");
  } else if (
    text.includes("claude") ||
    text.includes("sonnet") ||
    text.includes("opus") ||
    text.includes("gpt-4o") ||
    text.includes("o3") ||
    text.includes("o1")
  ) {
    tags.push("200k");
  }

  return tags;
}

export const ModelListRow = memo(function ModelListRow(props: {
  index: number;
  model: ModelEsque;
  /** Instance the model belongs to — the routing key used in combobox values. */
  instanceId: ProviderInstanceId;
  /** Driver kind of the instance — used for the provider icon glyph. */
  driverKind: ProviderDriverKind;
  /**
   * Display name to show in the secondary line (provider footer). Usually
   * the instance's configured `displayName` so custom instances like
   * "Codex Personal" render with their user-authored label.
   */
  providerDisplayName: string;
  providerAccentColor?: string | undefined;
  isFavorite: boolean;
  isSelected: boolean;
  showProvider: boolean;
  preferShortName?: boolean;
  useTriggerLabel?: boolean;
  showNewBadge?: boolean;
  jumpLabel?: string | null;
  disabledReason?: string | null;
  onToggleFavorite: () => void;
  onDoubleClick?: () => void;
}) {
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.driverKind] ?? null;
  const providerLabel = props.model.subProvider
    ? `${props.providerDisplayName} · ${props.model.subProvider}`
    : props.providerDisplayName;
  const capabilityTags = getModelCapabilityTags(props.model);

  const row = (
    <ComboboxItem
      hideIndicator
      index={props.index}
      value={modelPickerModelKey(props.instanceId, props.model.slug)}
      disabled={Boolean(props.disabledReason)}
      onDoubleClick={(event) => {
        if (props.disabledReason) return;
        event.preventDefault();
        event.stopPropagation();
        props.onDoubleClick?.();
      }}
      contentClassName="flex w-full items-center gap-2.5"
      className={cn(
        "group relative w-full !min-w-0 max-w-full cursor-pointer overflow-hidden rounded-lg px-2.5 py-2 transition-all duration-150",
        props.isSelected
          ? "border border-primary/50 bg-gradient-to-r from-primary/15 via-primary/10 to-transparent text-foreground shadow-xs ring-1 ring-primary/20"
          : "border border-transparent hover:border-border/60 hover:bg-muted/60 data-highlighted:border-border/60 data-highlighted:bg-muted/60 text-foreground/90 hover:text-foreground",
        props.disabledReason &&
          "data-disabled:pointer-events-auto data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-transparent",
      )}
    >
      {/* Spotlight Sheen on Hover */}
      <div
        className="pointer-events-none absolute inset-0 rounded-lg opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--primary) 10%, transparent) 0%, transparent 75%)",
        }}
      />

      <div
        className={cn(
          "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
          props.isSelected
            ? "border-primary/40 bg-primary/15 text-primary"
            : "border-border/50 bg-muted/60 text-foreground/80 group-hover:border-border/80 group-hover:bg-muted",
        )}
      >
        {ProviderIcon ? <ProviderIcon className="size-4 shrink-0" /> : null}
      </div>

      <div className="relative z-10 min-w-0 flex-1 text-left">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 truncate text-xs font-semibold leading-snug">
            {props.useTriggerLabel
              ? getTriggerDisplayModelLabel(props.model)
              : getDisplayModelName(
                  props.model,
                  props.preferShortName ? { preferShortName: true } : undefined,
                )}
          </div>
          {props.showNewBadge ? (
            <span
              className="shrink-0 rounded border border-update/35 bg-update/15 px-1 py-0.2 text-[9px] font-bold uppercase leading-none tracking-wide text-update-foreground"
              aria-label="New model"
            >
              New
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-normal leading-tight text-muted-foreground">
          {props.showProvider && <span className="truncate">{providerLabel}</span>}
          {capabilityTags.length > 0 && (
            <span className="flex items-center gap-1 shrink-0">
              {capabilityTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-border/50 bg-background/50 px-1 py-0.2 text-[9px] font-medium leading-none text-muted-foreground/90"
                >
                  {tag}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {props.jumpLabel ? (
          <Kbd className="h-4.5 min-w-0 rounded border border-border/50 bg-muted/60 px-1.5 font-mono text-[10px] text-muted-foreground shadow-2xs">
            {props.jumpLabel}
          </Kbd>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                className={cn(
                  "size-6 shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground group-hover:opacity-100",
                  props.isFavorite ? "text-yellow-500 opacity-100" : "opacity-0",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleFavorite();
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
                disabled={Boolean(props.disabledReason)}
                aria-label={props.isFavorite ? "Remove from favorites" : "Add to favorites"}
              >
                <StarIcon
                  className={cn(
                    "size-3.5",
                    props.isFavorite && "fill-current text-yellow-500",
                  )}
                />
              </Button>
            }
          />
          <TooltipPopup side="top" align="center">
            {props.isFavorite ? "Remove from favorites" : "Add to favorites"}
          </TooltipPopup>
        </Tooltip>

        {props.isSelected ? (
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
            <CheckIcon className="size-3.5 stroke-[2.5]" />
          </div>
        ) : null}
      </div>
    </ComboboxItem>
  );

  if (!props.disabledReason) {
    return row;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={row} />
      <TooltipPopup side="left" align="center" className="max-w-64 text-balance leading-snug">
        {props.disabledReason}
      </TooltipPopup>
    </Tooltip>
  );
});
