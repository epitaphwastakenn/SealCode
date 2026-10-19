import { type ProviderDriverKind, type ProviderInstanceId } from "@t3tools/contracts";
import { memo } from "react";
import { CheckIcon, StarIcon } from "lucide-react";
import {
  getDisplayModelName,
  getProviderRowLabel,
  getTriggerDisplayModelLabel,
} from "./providerIconUtils";
import { ComboboxItem } from "../ui/combobox";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { modelPickerModelKey } from "./modelPickerKeys";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

// Small at-a-glance hints in each row. They come from the model name because
// providers do not report these traits consistently.
function getModelCapabilityTags(model: { slug: string; name: string }): string[] {
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

// Rows take the model's fields rather than the picker's item object, and one shared toggle
// handler, because the picker rebuilds its items on every search keystroke; that keeps memo
// effective for rows whose content did not change.
export const ModelListRow = memo(function ModelListRow(props: {
  index: number;
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  providerDisplayName: string;
  providerAccentColor?: string | undefined;
  acpRegistryAgentId?: string | undefined;
  acpRegistryIconUrl?: string | undefined;
  isFavorite: boolean;
  isSelected: boolean;
  showSelection?: boolean;
  showProvider: boolean;
  preferShortName?: boolean;
  useTriggerLabel?: boolean;
  showNewBadge?: boolean;
  unavailable?: boolean;
  jumpLabel?: string | null;
  disabledReason?: string | null;
  onToggleFavorite: (instanceId: ProviderInstanceId, slug: string) => void;
  onDoubleClick?: ((instanceId: ProviderInstanceId, slug: string) => void) | undefined;
}) {
  const model = {
    slug: props.slug,
    name: props.name,
    shortName: props.shortName,
    subProvider: props.subProvider,
  };
  const providerLabel = getProviderRowLabel(props.providerDisplayName, props.subProvider);
  const capabilityTags = getModelCapabilityTags(model);

  const row = (
    <ComboboxItem
      hideIndicator
      index={props.index}
      value={modelPickerModelKey(props.instanceId, props.slug)}
      disabled={Boolean(props.disabledReason)}
      onDoubleClick={(event) => {
        if (props.disabledReason) return;
        event.preventDefault();
        event.stopPropagation();
        props.onDoubleClick?.(props.instanceId, props.slug);
      }}
      variant="card"
      className={cn(
        "group relative w-full !min-w-0 max-w-full cursor-pointer",
        props.disabledReason &&
          "data-disabled:pointer-events-auto data-disabled:cursor-not-allowed",
      )}
    >
      <div
        aria-hidden="true"
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
        <ProviderInstanceIcon
          driverKind={props.driverKind}
          displayName={props.providerDisplayName}
          acpRegistryAgentId={props.acpRegistryAgentId}
          acpRegistryIconUrl={props.acpRegistryIconUrl}
          className="size-4"
          iconClassName="size-4"
        />
      </div>
      <div className="relative z-10 min-w-0 flex-1 text-left">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 truncate text-xs font-semibold leading-snug">
            {props.useTriggerLabel
              ? getTriggerDisplayModelLabel(model)
              : getDisplayModelName(
                  model,
                  props.preferShortName ? { preferShortName: true } : undefined,
                )}
          </div>
          {props.showNewBadge ? (
            <span
              className="shrink-0 rounded border border-update/35 bg-update/15 px-0.5 py-px text-3xs font-bold uppercase leading-none tracking-wide text-update-foreground"
              aria-label="New model"
            >
              New
            </span>
          ) : null}
          {props.unavailable ? (
            <Badge variant="outline" size="sm">
              Unavailable
            </Badge>
          ) : null}
        </div>
        {props.showProvider || capabilityTags.length > 0 ? (
          <div className="mt-0.5 flex items-center gap-1.5 text-2xs leading-tight text-muted-foreground">
            {props.showProvider ? <span className="truncate">{providerLabel}</span> : null}
            {capabilityTags.length > 0 ? (
              <span className="flex shrink-0 items-center gap-1">
                {capabilityTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded border border-border/50 bg-background/50 px-1 py-px text-3xs font-medium leading-none text-muted-foreground/90"
                  >
                    {tag}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-1.5">
        {props.jumpLabel ? <Kbd>{props.jumpLabel}</Kbd> : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                className="-mr-1 shrink-0"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleFavorite(props.instanceId, props.slug);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
                disabled={Boolean(props.disabledReason)}
                aria-label={props.isFavorite ? "Remove from favorites" : "Add to favorites"}
              >
                <StarIcon
                  className={cn(
                    "size-3.5 sm:size-3",
                    props.isFavorite && "fill-current text-warning",
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
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
            <CheckIcon className="size-3.5" aria-hidden="true" />
          </span>
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
      <TooltipPopup side="left" align="center">
        {props.disabledReason}
      </TooltipPopup>
    </Tooltip>
  );
});
