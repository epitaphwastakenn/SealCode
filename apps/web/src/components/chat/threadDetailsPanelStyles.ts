const restingButtonSurface = "bg-transparent shadow-none";

const hoverSurface = "hover:bg-row-hover data-pressed:bg-row-hover";

const halfHoverSurface = "hover:bg-row-hover";

const rowSurface = `${restingButtonSurface} ${hoverSurface}`;
const splitButtonSurface = `${rowSurface} data-popup-open:bg-row-hover`;
const splitGroupSurface = `${hoverSurface} has-[[data-popup-open]]:bg-row-hover`;

export const threadDetailsRowLabelClassName = "text-sm font-medium text-foreground";

export const threadDetailsMetaClassName = "text-2xs text-muted-foreground tabular-nums";

export const THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS = "gap-2.5 px-2.5 text-left";

export const THREAD_DETAILS_PANEL_LABEL_CLASS =
  "[text-box:trim-both_cap_alphabetic] overflow-x-clip overflow-y-visible";

const controlClassName = `h-8 min-w-0 rounded-lg border-transparent ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} ${threadDetailsRowLabelClassName}`;

export const threadDetailsRowClassName = `${controlClassName} w-full justify-start ${rowSurface}`;

export const threadDetailsSelectRowClassName = `${threadDetailsRowClassName} gap-0 px-0 [&_[data-slot=select-icon]]:-me-px [&_[data-slot=select-icon]]:relative [&_[data-slot=select-icon]]:flex [&_[data-slot=select-icon]]:h-full [&_[data-slot=select-icon]]:w-8 [&_[data-slot=select-icon]]:shrink-0 [&_[data-slot=select-icon]]:items-center [&_[data-slot=select-icon]]:justify-center [&_[data-slot=select-icon]]:before:absolute [&_[data-slot=select-icon]]:before:-left-px [&_[data-slot=select-icon]]:before:top-1/2 [&_[data-slot=select-icon]]:before:h-4 [&_[data-slot=select-icon]]:before:w-px [&_[data-slot=select-icon]]:before:-translate-y-1/2 [&_[data-slot=select-icon]]:before:bg-transparent hover:[&_[data-slot=select-icon]]:before:bg-border/50 data-popup-open:[&_[data-slot=select-icon]]:before:bg-border/50 [&_[data-slot=select-icon]>svg]:me-0 [&_[data-slot=select-icon]>svg]:size-4 [&_[data-slot=select-icon]>svg]:text-icon-muted [&_[data-slot=select-icon]>svg]:opacity-100`;

// The row keeps its soft fill while each half stacks a second one, like the split controls nearby.
export const threadDetailsSelectLabelClassName = `flex h-full min-w-0 flex-1 items-center rounded-s-lg ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} ${halfHoverSurface}`;

export const threadDetailsSelectIconClassName = `rounded-e-lg ${halfHoverSurface}`;

export const THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS = `h-8 w-full min-w-0 justify-start rounded-lg border border-transparent ${THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS} ${threadDetailsRowLabelClassName} sm:h-8`;

export const THREAD_DETAILS_PANEL_ICON_CLASS = "size-4 shrink-0 text-icon-muted";

export const THREAD_DETAILS_PANEL_CHEVRON_CLASS = "size-4 shrink-0 text-icon-muted";

export const threadDetailsIconActionClassName = `size-6 justify-center rounded-md border-transparent bg-transparent p-0 sm:size-6 ${rowSurface}`;

export const threadDetailsMetaActionClassName = `h-6 gap-1 rounded-md border-transparent px-1.5 text-xs font-medium text-muted-foreground ${rowSurface}`;

export const THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS = `group/details-split flex w-full items-center rounded-lg ${splitGroupSurface}`;

export const threadDetailsSplitPrimaryClassName = `${controlClassName} flex-1 justify-start rounded-e-none ${splitButtonSurface}`;

export const threadDetailsSplitSecondaryClassName = `${controlClassName} w-8 justify-center rounded-s-none px-0 ${splitButtonSurface}`;

// The split hairline shows only while the pair is in use, so resting rows read as plain rows.
export const THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS =
  "h-4 w-px shrink-0 bg-transparent group-hover/details-split:bg-border/50 group-has-[[data-popup-open]]/details-split:bg-border/50";
