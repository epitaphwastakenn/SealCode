import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { type ProviderOptionDescriptor } from "@t3tools/contracts";
import { cn } from "~/lib/utils";

export interface ReasoningEffortSliderProps {
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>;
  selectedValue: string;
  disabled?: boolean;
  promptControlled?: boolean;
  onSelect: (optionId: string) => void;
  className?: string;
}

// Matches the horizontal padding of the track so the end stops sit under the
// thumb's center instead of its edge.
const TRACK_INSET_PX = 10;

export const ReasoningEffortSlider = memo(function ReasoningEffortSlider({
  descriptor,
  selectedValue,
  disabled = false,
  promptControlled = false,
  onSelect,
  className,
}: ReasoningEffortSliderProps) {
  const sliderId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const options = descriptor.options;
  const lastIndex = Math.max(0, options.length - 1);

  let selectedIndex = options.findIndex((option) => option.id === selectedValue);
  if (selectedIndex === -1) {
    const defaultIndex = options.findIndex((option) => option.isDefault);
    selectedIndex = defaultIndex >= 0 ? defaultIndex : 0;
  }

  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [dragging, setDragging] = useState(false);
  // Bumped each time the top level is reached, so the sheen replays once per arrival.
  const [peakKey, setPeakKey] = useState(0);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  const isPeak = options.length > 1 && activeIndex === lastIndex;
  const wasPeakRef = useRef(isPeak);
  useEffect(() => {
    if (isPeak && !wasPeakRef.current) setPeakKey((key) => key + 1);
    wasPeakRef.current = isPeak;
  }, [isPeak]);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (option) onSelect(option.id);
    },
    [onSelect, options],
  );

  // Number keys pick a level while the picker is open, as in SealCode 1.x.
  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > options.length) return;
      event.preventDefault();
      setActiveIndex(digit - 1);
      commit(digit - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commit, disabled, options.length]);

  const indexFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return activeIndex;
      const rect = track.getBoundingClientRect();
      const usable = rect.width - TRACK_INSET_PX * 2;
      if (usable <= 0) return activeIndex;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left - TRACK_INSET_PX) / usable));
      return Math.round(ratio * lastIndex);
    },
    [activeIndex, lastIndex],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !trackRef.current) return;
      trackRef.current.setPointerCapture(event.pointerId);
      draggingRef.current = true;
      setDragging(true);
      setActiveIndex(indexFromPointer(event.clientX));
    },
    [disabled, indexFromPointer],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      setActiveIndex(indexFromPointer(event.clientX));
    },
    [indexFromPointer],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      const index = indexFromPointer(event.clientX);
      setActiveIndex(index);
      commit(index);
    },
    [commit, indexFromPointer],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (disabled) return;
      let next = activeIndex;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") next = activeIndex + 1;
      else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = activeIndex - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = lastIndex;
      else return;
      event.preventDefault();
      next = Math.min(lastIndex, Math.max(0, next));
      if (next === activeIndex) return;
      setActiveIndex(next);
      commit(next);
    },
    [activeIndex, commit, disabled, lastIndex],
  );

  const current = options[activeIndex] ?? options[0];
  const heat = lastIndex > 0 ? activeIndex / lastIndex : 0;
  const progress = `${heat * 100}%`;
  const label = descriptor.label || "Effort level";

  return (
    <div
      className={cn("w-full space-y-2 py-0.5", className)}
      data-dragging={dragging ? "true" : undefined}
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-foreground/80">{label}</span>
        {promptControlled ? (
          <span className="text-xs font-semibold text-warning">Prompt-controlled</span>
        ) : (
          <span
            key={current?.id}
            className={cn(
              "reasoning-slider-label-in inline-flex items-center gap-1 text-xs font-semibold",
              isPeak &&
                "rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 text-primary",
            )}
            style={
              isPeak
                ? undefined
                : {
                    color: `color-mix(in srgb, var(--primary) ${Math.round(heat * 70)}%, var(--foreground))`,
                  }
            }
          >
            {isPeak ? (
              <svg viewBox="0 0 16 16" fill="currentColor" className="size-3" aria-hidden="true">
                <path d="M8 0L9.79 6.21L16 8L9.79 9.79L8 16L6.21 9.79L0 8L6.21 6.21L8 0Z" />
              </svg>
            ) : null}
            {current?.label}
          </span>
        )}
      </div>

      <div
        ref={trackRef}
        id={sliderId}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={activeIndex}
        aria-valuetext={current?.label}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className={cn(
          "group relative flex h-7 w-full cursor-pointer touch-none select-none items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
          disabled && "cursor-not-allowed opacity-50",
        )}
        style={{ paddingInline: TRACK_INSET_PX }}
      >
        <div className="relative h-1.5 w-full rounded-full bg-muted-foreground/15 dark:bg-white/12">
          <div
            className="reasoning-slider-glide absolute inset-y-0 left-0 overflow-hidden rounded-full"
            style={{
              width: progress,
              background: `linear-gradient(90deg, color-mix(in srgb, var(--primary) ${Math.round(45 + heat * 25)}%, transparent), var(--primary))`,
              boxShadow:
                heat > 0
                  ? `0 0 ${Math.round(4 + heat * 10)}px color-mix(in srgb, var(--primary) ${Math.round(20 + heat * 35)}%, transparent)`
                  : undefined,
            }}
          >
            {isPeak && peakKey > 0 ? (
              <span
                key={peakKey}
                className="reasoning-slider-sheen pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/60 to-transparent"
              />
            ) : null}
          </div>

          <div className="pointer-events-none absolute inset-0 flex items-center justify-between">
            {options.map((option, index) => (
              <span
                key={option.id}
                className={cn(
                  "size-1 rounded-full transition-colors duration-200",
                  index <= activeIndex ? "bg-white/80" : "bg-muted-foreground/35 dark:bg-white/25",
                )}
              />
            ))}
          </div>

          <span
            className="reasoning-slider-glide pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/10 bg-white shadow-sm group-active:scale-110 dark:border-white/20"
            style={{
              left: progress,
              boxShadow:
                heat > 0.5
                  ? `0 0 0 3px color-mix(in srgb, var(--primary) ${Math.round(heat * 22)}%, transparent), 0 1px 3px rgb(0 0 0 / 20%)`
                  : undefined,
            }}
          />
        </div>
      </div>
    </div>
  );
});
