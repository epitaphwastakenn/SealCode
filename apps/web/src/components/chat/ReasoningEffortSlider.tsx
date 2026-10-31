import { memo, useEffect, useId, useRef, useState } from "react";
import { type ProviderOptionDescriptor } from "@t3tools/contracts";
import { cn } from "~/lib/utils";

export interface ReasoningEffortSliderProps {
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>;
  selectedValue: string;
  disabled?: boolean;
  onSelect: (optionId: string) => void;
  className?: string;
}

// Matches the horizontal padding of the track so the end stops sit under the
// thumb's center instead of its edge.
const trackInsetPx = 12;

export const ReasoningEffortSlider = memo(function ReasoningEffortSlider({
  descriptor,
  selectedValue,
  disabled = false,
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
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) setActiveIndex(selectedIndex);
  }, [selectedIndex]);

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
    const usable = rect.width - trackInsetPx * 2;
    if (usable <= 0) return activeIndex;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - trackInsetPx) / usable));
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
  const percent = lastIndex > 0 ? (activeIndex / lastIndex) * 100 : 0;
  const label = descriptor.label || "Effort level";
  const previewIndex = hoverIndex !== null && hoverIndex !== activeIndex ? hoverIndex : null;

  return (
    <div
      className={cn("w-full space-y-1 py-0.5", className)}
      data-dragging={dragging ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span key={current?.id} className="text-xs font-medium text-foreground">
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
          "group relative flex h-8 w-full cursor-pointer touch-none select-none items-center rounded-full px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <div className="relative h-1 w-full rounded-full bg-muted">
          <div
            className="absolute inset-y-0 start-0 rounded-full bg-primary"
            style={{ width: `${percent}%` }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-between">
            {options.map((option, index) => (
              <span
                key={option.id}
                className={cn(
                  "size-1 rounded-full",
                  index <= activeIndex ? "bg-primary-foreground/60" : "bg-foreground/25",
                  index === previewIndex && "bg-foreground/60",
                )}
              />
            ))}
          </div>
          <span
            className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background"
            style={{ left: `${percent}%` }}
          />
        </div>
      </div>

      {options.length > 1 ? (
        <div className="flex items-center justify-between px-1 text-2xs text-muted-foreground">
          <span>{options[0]?.label}</span>
          <span>{options[lastIndex]?.label}</span>
        </div>
      ) : null}
    </div>
  );
});
