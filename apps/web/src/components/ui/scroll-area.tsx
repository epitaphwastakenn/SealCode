"use client";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type { PointerEvent } from "react";

import { cn } from "~/lib/utils";

function getVirtualizedScrollFadeClassName({ top, bottom }: { top: boolean; bottom: boolean }) {
  if (!top && !bottom) return undefined;

  return cn(
    "virtualized-scroll-fade [--fade-size:1.5rem]",
    top &&
      bottom &&
      "[--virtualized-scroll-fade-mask:linear-gradient(to_bottom,transparent,black_var(--fade-size),black_calc(100%-var(--fade-size)),transparent)]",
    top &&
      !bottom &&
      "[--virtualized-scroll-fade-mask:linear-gradient(to_bottom,transparent,black_var(--fade-size))]",
    !top &&
      bottom &&
      "[--virtualized-scroll-fade-mask:linear-gradient(to_bottom,black_calc(100%-var(--fade-size)),transparent)]",
  );
}

function ScrollArea({
  className,
  children,
  scrollFade = false,
  scrollFadePadding = true,
  scrollbarGutter = false,
  hideScrollbars = false,
  chainVerticalScroll = false,
  radius = "inherit",
  viewportTabIndex,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  scrollFade?: boolean;
  scrollFadePadding?: boolean;
  scrollbarGutter?: boolean;
  hideScrollbars?: boolean;
  chainVerticalScroll?: boolean;
  radius?: "inherit" | "none";
  viewportTabIndex?: number;
}) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn(
        "relative size-full min-h-0 overflow-hidden",
        radius === "none" ? "rounded-none" : "rounded-[inherit]",
        className,
      )}
      data-slot="scroll-area"
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        {...(viewportTabIndex === undefined ? {} : { tabIndex: viewportTabIndex })}
        className={cn(
          "h-full max-h-[inherit] overflow-auto overscroll-contain rounded-[inherit] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-has-overflow-x:overscroll-x-contain",
          chainVerticalScroll && "overscroll-y-auto",
          scrollFade &&
            "mask-t-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-start)))] mask-b-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-end)))] mask-l-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-start)))] mask-r-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-end)))] focus-visible:mask-none [--fade-size:1.5rem]",
          scrollFade && scrollFadePadding && "scroll-p-[var(--fade-size)]",
          scrollFade && !scrollFadePadding && "has-focus-visible:mask-none",
          scrollbarGutter && "scrollbar-gutter-stable",
          hideScrollbars &&
            "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          // The scrollbars float over the viewport, so keep their lane clear of content.
          !hideScrollbars &&
            "data-has-overflow-x:pb-[var(--app-scrollbar-width)] data-has-overflow-y:pe-[var(--app-scrollbar-width)]",
        )}
        data-slot="scroll-area-viewport"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {!hideScrollbars && (
        <>
          <ScrollBar orientation="vertical" />
          <ScrollBar orientation="horizontal" />
          <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
        </>
      )}
    </ScrollAreaPrimitive.Root>
  );
}

const SCROLL_ARROW_STEP_PX = 48;

function scrollByArrow(
  event: PointerEvent<HTMLElement>,
  orientation: "horizontal" | "vertical",
  direction: -1 | 1,
) {
  // Keep Base UI's track press from jumping the thumb to the pointer.
  event.preventDefault();
  event.stopPropagation();
  const viewport = event.currentTarget
    .closest("[data-slot=scroll-area]")
    ?.querySelector(":scope > [data-slot=scroll-area-viewport]");
  const step = direction * SCROLL_ARROW_STEP_PX;
  viewport?.scrollBy(orientation === "horizontal" ? { left: step } : { top: step });
}

function ScrollArrow({
  orientation,
  position,
}: {
  orientation: "horizontal" | "vertical";
  position: "start" | "end";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute flex size-[var(--app-scrollbar-width)] items-center justify-center text-[var(--app-scrollbar-arrow)]",
        position === "start" && "top-0 left-0",
        position === "end" && (orientation === "horizontal" ? "top-0 right-0" : "bottom-0 left-0"),
      )}
      data-slot="scroll-area-arrow"
      onPointerDown={(event) => scrollByArrow(event, orientation, position === "start" ? -1 : 1)}
    >
      <svg
        className={cn(
          "size-[clamp(6px,var(--app-scrollbar-size),12px)]",
          orientation === "horizontal" && "-rotate-90",
        )}
        viewBox="0 0 10 10"
      >
        <path
          d="M5 2.5 8.5 7h-7z"
          fill="currentColor"
          transform={position === "end" ? "rotate(180 5 5)" : undefined}
        />
      </svg>
    </span>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cn(
        // The lane pads the thumb off its edges, and its ends hold the arrows; Base UI measures
        // the thumb's travel inside that padding.
        "flex opacity-0 transition-opacity delay-300 data-[orientation=horizontal]:h-[var(--app-scrollbar-width)] data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:px-[var(--app-scrollbar-width)] data-[orientation=horizontal]:py-[var(--app-scrollbar-gap)] data-[orientation=vertical]:w-[var(--app-scrollbar-width)] data-[orientation=vertical]:px-[var(--app-scrollbar-gap)] data-[orientation=vertical]:py-[var(--app-scrollbar-width)] data-hovering:opacity-100 data-scrolling:opacity-100 data-hovering:delay-0 data-scrolling:delay-0 data-hovering:duration-100 data-scrolling:duration-100",
        className,
      )}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      {...props}
    >
      <ScrollArrow orientation={orientation} position="start" />
      <ScrollAreaPrimitive.Thumb
        className="relative flex-1 rounded-full bg-[var(--app-scrollbar-thumb)] transition-colors hover:bg-[var(--app-scrollbar-thumb-hover)]"
        data-slot="scroll-area-thumb"
      />
      <ScrollArrow orientation={orientation} position="end" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { getVirtualizedScrollFadeClassName, ScrollArea, ScrollBar };
