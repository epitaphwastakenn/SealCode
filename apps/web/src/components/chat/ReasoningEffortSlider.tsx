import { memo, useEffect, useId, useRef, useState } from "react";
import { type ProviderOptionDescriptor } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { useInterfaceMotion } from "../../panelAnimations";

export interface ReasoningEffortSliderProps {
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>;
  selectedValue: string;
  disabled?: boolean;
  onSelect: (optionId: string) => void;
  className?: string;
}

// Matches the horizontal padding of the track so the end stops sit under the
// thumb's center instead of its edge.
const TRACK_INSET_PX = 12;

/**
 * The level's color on a cool-to-hot ramp built from theme tokens, so it reads
 * in light, dark and glass themes alike: info at the bottom, primary in the
 * middle, warming towards warning at the top.
 */
function levelColor(heat: number): string {
  if (heat <= 0.5) {
    return `color-mix(in oklch, var(--primary) ${Math.round(heat * 200)}%, var(--info))`;
  }
  return `color-mix(in oklch, var(--warning) ${Math.round((heat - 0.5) * 90)}%, var(--primary))`;
}

const FILL_GRADIENT = `linear-gradient(90deg, ${levelColor(0)}, ${levelColor(0.5)} 50%, ${levelColor(1)})`;

export const ReasoningEffortSlider = memo(function ReasoningEffortSlider({
  descriptor,
  selectedValue,
  disabled = false,
  onSelect,
  className,
}: ReasoningEffortSliderProps) {
  const sliderId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const { active: motionActive } = useInterfaceMotion();
  const options = descriptor.options;
  const lastIndex = Math.max(0, options.length - 1);

  let selectedIndex = options.findIndex((option) => option.id === selectedValue);
  if (selectedIndex === -1) {
    const defaultIndex = options.findIndex((option) => option.isDefault);
    selectedIndex = defaultIndex >= 0 ? defaultIndex : 0;
  }

  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
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

  const commit = (index: number) => {
    const option = options[index];
    if (option) onSelect(option.id);
  };

  // Number keys pick a level while the picker is open, as in Harp 1.x.
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

  const indexFromPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return activeIndex;
    const rect = track.getBoundingClientRect();
    const usable = rect.width - TRACK_INSET_PX * 2;
    if (usable <= 0) return activeIndex;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - TRACK_INSET_PX) / usable));
    return Math.round(ratio * lastIndex);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !trackRef.current) return;
    trackRef.current.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
    setActiveIndex(indexFromPointer(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const index = indexFromPointer(event.clientX);
    if (draggingRef.current) {
      setActiveIndex(index);
    } else if (!disabled && event.pointerType === "mouse") {
      setHoverIndex(index);
    }
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    const index = indexFromPointer(event.clientX);
    setActiveIndex(index);
    commit(index);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
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
  };

  const current = options[activeIndex] ?? options[0];
  const heat = lastIndex > 0 ? activeIndex / lastIndex : 0;
  const percent = heat * 100;
  const color = levelColor(heat);
  const label = descriptor.label || "Effort level";
  const previewIndex = hoverIndex !== null && hoverIndex !== activeIndex ? hoverIndex : null;

  return (
    <div
      className={cn("w-full space-y-1.5 py-0.5", className)}
      data-dragging={dragging ? "true" : undefined}
      data-motion={motionActive ? undefined : "off"}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs font-medium text-foreground/80">{label}</span>
        <span
          key={current?.id}
          className={cn(
            "reasoning-slider-label-in inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
            isPeak && "border",
          )}
          style={{
            color: `color-mix(in oklch, ${color} 72%, var(--foreground))`,
            backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
            ...(isPeak
              ? { borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }
              : undefined),
          }}
        >
          {isPeak ? (
            <svg viewBox="0 0 16 16" fill="currentColor" className="size-3" aria-hidden="true">
              <path d="M8 0L9.79 6.21L16 8L9.79 9.79L8 16L6.21 9.79L0 8L6.21 6.21L8 0Z" />
            </svg>
          ) : null}
          {current?.label}
        </span>
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
        onPointerLeave={() => setHoverIndex(null)}
        onKeyDown={onKeyDown}
        className={cn(
          "group relative flex h-9 w-full cursor-pointer touch-none select-none items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
          disabled && "cursor-not-allowed opacity-50",
        )}
        style={{ paddingInline: TRACK_INSET_PX }}
      >
        <div className="reasoning-slider-track relative h-3 w-full rounded-full bg-muted-foreground/15 dark:bg-white/10">
          {/* The ramp spans the whole track and the fill reveals it, so each
              level keeps its own color and the reveal glides between them. */}
          <div
            className="reasoning-slider-glide absolute inset-0 rounded-full"
            style={{
              clipPath: `inset(0 ${100 - percent}% 0 0 round 9999px)`,
              filter:
                heat > 0
                  ? `drop-shadow(0 0 ${Math.round(3 + heat * 5)}px color-mix(in srgb, ${color} ${Math.round(25 + heat * 30)}%, transparent))`
                  : undefined,
            }}
          >
            <div
              className="absolute inset-0 overflow-hidden rounded-full"
              style={{ backgroundImage: FILL_GRADIENT }}
            >
              {isPeak && peakKey > 0 ? (
                <span
                  key={peakKey}
                  className="reasoning-slider-sheen pointer-events-none absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-white/55 to-transparent"
                />
              ) : null}
            </div>
          </div>

          <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-0.75">
            {options.map((option, index) => (
              <span
                key={option.id}
                className={cn(
                  "reasoning-slider-tick size-1.5 rounded-full",
                  index <= activeIndex ? "bg-white/85" : "bg-muted-foreground/40 dark:bg-white/30",
                  index === previewIndex && "scale-150 bg-foreground/70 dark:bg-white/80",
                )}
              />
            ))}
          </div>

          <span
            className="reasoning-slider-glide pointer-events-none absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white group-hover:scale-110 group-active:scale-110"
            style={{
              left: `${percent}%`,
              borderColor: color,
              boxShadow: `0 0 0 ${isPeak ? 5 : 3}px color-mix(in srgb, ${color} ${Math.round(18 + heat * 17)}%, transparent), 0 0 ${Math.round(6 + heat * 10)}px color-mix(in srgb, ${color} ${Math.round(30 + heat * 30)}%, transparent), 0 1px 3px rgb(0 0 0 / 25%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
});
