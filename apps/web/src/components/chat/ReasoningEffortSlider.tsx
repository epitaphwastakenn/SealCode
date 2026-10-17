import { memo, useCallback, useId, useRef, useState, useEffect } from "react";
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

const SPARK_VECTORS = [
  { x: "0px", y: "-5px", delay: "0ms" },
  { x: "4px", y: "-4px", delay: "18ms" },
  { x: "5px", y: "0px", delay: "32ms" },
  { x: "4px", y: "4px", delay: "12ms" },
  { x: "0px", y: "5px", delay: "28ms" },
  { x: "-4px", y: "4px", delay: "8ms" },
  { x: "-5px", y: "0px", delay: "22ms" },
  { x: "-4px", y: "-4px", delay: "40ms" },
  { x: "2px", y: "-6px", delay: "50ms" },
  { x: "-2px", y: "6px", delay: "36ms" },
] as const;

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
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, time: 0 });
  const warpTimeoutRef = useRef<number | null>(null);
  const options = descriptor.options;
  const numSteps = Math.max(1, options.length - 1);

  let selectedIndex = options.findIndex((opt) => opt.id === selectedValue);
  if (selectedIndex === -1) {
    const defaultIdx = options.findIndex((opt) => opt.isDefault);
    selectedIndex = defaultIdx >= 0 ? defaultIdx : 0;
  }

  const [activeIdx, setActiveIdx] = useState(selectedIndex);
  const [burstKey, setBurstKey] = useState(0);
  const [stepPulseKey, setStepPulseKey] = useState(0);
  const [isWarpSpeed, setIsWarpSpeed] = useState(false);

  const isHighest = activeIdx === options.length - 1 && options.length > 1;
  const heat = numSteps > 0 ? activeIdx / numSteps : 0;
  const prevHighestRef = useRef(isHighest);
  const prevIdxRef = useRef(activeIdx);

  useEffect(() => {
    if (!isDraggingRef.current) {
      setActiveIdx(selectedIndex);
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (isHighest && !prevHighestRef.current) {
      setBurstKey((k) => k + 1);
    }
    prevHighestRef.current = isHighest;
  }, [isHighest]);

  useEffect(() => {
    if (prevIdxRef.current !== activeIdx) {
      setStepPulseKey((k) => k + 1);
      prevIdxRef.current = activeIdx;
    }
  }, [activeIdx]);

  useEffect(() => {
    if (disabled) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= options.length) {
        e.preventDefault();
        const targetIdx = num - 1;
        setActiveIdx(targetIdx);
        const targetOption = options[targetIdx];
        if (targetOption) {
          onSelect(targetOption.id);
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [disabled, onSelect, options]);

  const currentOption = options[activeIdx] ?? options[0];

  const getIndexFromPointer = useCallback(
    (clientX: number): number => {
      if (!trackRef.current) return activeIdx;
      const rect = trackRef.current.getBoundingClientRect();
      const padding = 12;
      const innerWidth = rect.width - 2 * padding;
      if (innerWidth <= 0) return activeIdx;
      const relativeX = clientX - rect.left - padding;
      const ratio = Math.max(0, Math.min(1, relativeX / innerWidth));
      return Math.round(ratio * (options.length - 1));
    },
    [activeIdx, options.length],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !trackRef.current) return;
      isDraggingRef.current = true;
      trackRef.current.setPointerCapture(e.pointerId);
      lastPosRef.current = { x: e.clientX, time: performance.now() };

      const newIdx = getIndexFromPointer(e.clientX);
      setActiveIdx(newIdx);

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!isDraggingRef.current) return;
        const now = performance.now();
        const dt = now - lastPosRef.current.time;
        const dx = Math.abs(moveEvent.clientX - lastPosRef.current.x);
        const velocity = dt > 0 ? dx / dt : 0;
        lastPosRef.current = { x: moveEvent.clientX, time: now };

        if (velocity > 0.45) {
          setIsWarpSpeed(true);
          if (warpTimeoutRef.current) window.clearTimeout(warpTimeoutRef.current);
          warpTimeoutRef.current = window.setTimeout(() => setIsWarpSpeed(false), 220);
        }

        const moveIdx = getIndexFromPointer(moveEvent.clientX);
        setActiveIdx(moveIdx);
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        setIsWarpSpeed(false);
        if (warpTimeoutRef.current) window.clearTimeout(warpTimeoutRef.current);
        const finalIdx = getIndexFromPointer(upEvent.clientX);
        setActiveIdx(finalIdx);
        const targetOption = options[finalIdx];
        if (targetOption) {
          onSelect(targetOption.id);
        }
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [disabled, getIndexFromPointer, onSelect, options],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= options.length) {
        e.preventDefault();
        const targetIdx = num - 1;
        setActiveIdx(targetIdx);
        const targetOption = options[targetIdx];
        if (targetOption) {
          onSelect(targetOption.id);
        }
        return;
      }

      let nextIdx = activeIdx;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIdx = Math.min(options.length - 1, activeIdx + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIdx = Math.max(0, activeIdx - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        nextIdx = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextIdx = options.length - 1;
      }

      if (nextIdx !== activeIdx) {
        setActiveIdx(nextIdx);
        const targetOption = options[nextIdx];
        if (targetOption) {
          onSelect(targetOption.id);
        }
      }
    },
    [activeIdx, disabled, onSelect, options],
  );

  const progressPercent = numSteps > 0 ? (activeIdx / numSteps) * 100 : 0;
  const glowStrength = 8 + heat * 18;

  return (
    <div
      className={cn("w-full space-y-2 py-0.5", className)}
      style={{ ["--reasoning-heat" as string]: String(heat) }}
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-foreground/80">
          {descriptor.label || "Effort level"}
        </span>

        {promptControlled ? (
          <span className="text-xs font-semibold text-amber-500">Prompt-controlled</span>
        ) : isHighest ? (
          <span
            key={`badge-${burstKey}`}
            className="animate-reasoning-badge-enter relative inline-flex items-center gap-1.5 overflow-hidden rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--primary) 18%, var(--card)), color-mix(in srgb, var(--primary) 8%, var(--card)))",
              color: "color-mix(in srgb, var(--primary) 42%, var(--foreground))",
              border: "1px solid color-mix(in srgb, var(--primary) 38%, transparent)",
              boxShadow: "0 0 10px color-mix(in srgb, var(--primary) 22%, transparent)",
            }}
          >
            <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
              <span className="animate-reasoning-shimmer absolute -inset-full bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            </span>
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              className="animate-reasoning-twinkle relative z-10 size-3 shrink-0"
              aria-hidden="true"
            >
              <path d="M8 0L9.79 6.21L16 8L9.79 9.79L8 16L6.21 9.79L0 8L6.21 6.21L8 0Z" />
            </svg>
            <span className="relative z-10">{currentOption?.label}</span>
          </span>
        ) : (
          <span
            className="text-xs font-semibold transition-colors duration-200"
            style={{
              color: `color-mix(in srgb, var(--primary) ${Math.round(heat * 70)}%, var(--foreground))`,
            }}
          >
            {currentOption?.label}
          </span>
        )}
      </div>

      <div
        ref={trackRef}
        id={sliderId}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={descriptor.label || "Effort level"}
        aria-valuemin={0}
        aria-valuemax={options.length - 1}
        aria-valuenow={activeIdx}
        aria-valuetext={currentOption?.label}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        className={cn(
          "group relative flex h-8 w-full cursor-pointer touch-none select-none items-center overflow-visible px-3 focus:outline-none",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <div
          className="pointer-events-none absolute inset-x-4 top-1/2 h-5 -translate-y-1/2 rounded-full blur-md transition-opacity duration-300"
          style={{
            opacity: 0.25 + heat * 0.7,
            background: `radial-gradient(ellipse at center, color-mix(in srgb, var(--primary) ${Math.round(28 + heat * 42)}%, transparent) 0%, transparent 80%)`,
          }}
        />

        {burstKey > 0 && isHighest && (
          <div
            key={`bar-flash-${burstKey}`}
            className="animate-reasoning-bar-flash pointer-events-none absolute inset-x-3 inset-y-1.5 rounded-full"
          />
        )}

        {burstKey > 0 && isHighest && (
          <div
            key={`surge-${burstKey}`}
            className="animate-reasoning-surge-sweep pointer-events-none absolute inset-x-3 top-1/2 z-20 h-[3px] -translate-y-1/2 overflow-hidden"
          >
            <div
              className="h-full w-32 rounded-full"
              style={{
                background: "linear-gradient(to right, transparent, var(--primary), white, transparent)",
                boxShadow: "0 0 16px var(--primary), 0 0 6px #fff",
              }}
            />
          </div>
        )}

        <div className="relative flex h-4 w-full items-center">
          <div
            className={cn(
              "relative h-3.5 w-full overflow-hidden rounded-full bg-muted/80 shadow-inner transition-[filter,transform] duration-150 dark:bg-white/15",
              isWarpSpeed && "saturate-150 brightness-110",
            )}
            style={{
              transform: isWarpSpeed ? "scaleY(0.72)" : undefined,
            }}
          >
            <div className="pointer-events-none absolute inset-x-2 top-1/2 z-0 flex -translate-y-1/2 justify-between">
              {options.map((_, idx) => {
                const isPassed = idx <= activeIdx;
                const isCurrent = idx === activeIdx;
                return (
                  <span
                    key={idx}
                    className={cn(
                      "size-1 rounded-full transition-colors duration-200",
                      isCurrent && stepPulseKey > 0 && "animate-reasoning-tick-ignite",
                      isCurrent
                        ? "bg-white"
                        : isPassed
                          ? "bg-white/55"
                          : "bg-muted-foreground/30 dark:bg-white/20",
                    )}
                    style={
                      isCurrent
                        ? { boxShadow: "0 0 7px var(--primary)" }
                        : undefined
                    }
                  />
                );
              })}
            </div>

            <div
              className="relative z-10 h-full rounded-full transition-[width] duration-100 ease-out"
              style={{
                width: `${progressPercent}%`,
                background: isHighest
                  ? "linear-gradient(90deg, color-mix(in srgb, var(--primary) 55%, transparent), var(--primary), color-mix(in srgb, var(--primary) 35%, white))"
                  : `linear-gradient(90deg, color-mix(in srgb, var(--primary) ${Math.round(40 + heat * 30)}%, transparent), color-mix(in srgb, var(--primary) ${Math.round(70 + heat * 30)}%, white))`,
                boxShadow:
                  heat > 0.15
                    ? `0 0 ${glowStrength}px color-mix(in srgb, var(--primary) ${Math.round(30 + heat * 40)}%, transparent)`
                    : undefined,
              }}
            >
              {heat > 0.2 && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
                  <div
                    key={`sheen-${stepPulseKey}-${burstKey}`}
                    className="animate-reasoning-heat-sheen absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                  />
                </div>
              )}
              {isHighest && (
                <>
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-0 overflow-hidden rounded-full transition-transform duration-150",
                      isWarpSpeed && "scale-x-[2.2] scale-y-[0.7]",
                    )}
                  >
                    <span
                      className="animate-reasoning-particle-1 absolute top-[20%] size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                      style={{ boxShadow: "0 0 4px #fff, 0 0 6px var(--primary)" }}
                    />
                    <span
                      className="animate-reasoning-particle-2 absolute top-[65%] size-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--primary) 65%, white)",
                        boxShadow: "0 0 6px var(--primary)",
                      }}
                    />
                    <span
                      className="animate-reasoning-particle-3 absolute top-[35%] size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--primary) 40%, white)",
                        boxShadow: "0 0 4px var(--primary)",
                      }}
                    />
                    <span
                      className="animate-reasoning-particle-4 absolute top-[78%] size-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--primary) 80%, white)",
                        boxShadow: "0 0 5px var(--primary)",
                      }}
                    />
                    <span
                      className="animate-reasoning-particle-5 absolute top-[25%] size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--primary) 25%, white)",
                        boxShadow: "0 0 6px var(--primary)",
                      }}
                    />
                    <span
                      className="animate-reasoning-particle-6 absolute top-[50%] size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                      style={{ boxShadow: "0 0 4px #fff, 0 0 6px var(--primary)" }}
                    />
                    <span
                      className="animate-reasoning-particle-7 absolute top-[15%] size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                      style={{ boxShadow: "0 0 4px #fff, 0 0 6px var(--primary)" }}
                    />
                    <span
                      className="animate-reasoning-particle-8 absolute top-[82%] size-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--primary) 50%, white)",
                        boxShadow: "0 0 5px var(--primary)",
                      }}
                    />
                    <span
                      className="animate-reasoning-particle-9 absolute top-[42%] size-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--primary) 30%, white)",
                        boxShadow: "0 0 5px var(--primary)",
                      }}
                    />
                    <span
                      className="animate-reasoning-particle-10 absolute top-[70%] size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--primary) 70%, white)",
                        boxShadow: "0 0 4px var(--primary)",
                      }}
                    />
                    <span
                      className="animate-reasoning-particle-11 absolute top-[30%] size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                      style={{ boxShadow: "0 0 4px #fff, 0 0 6px var(--primary)" }}
                    />
                    <span
                      className="animate-reasoning-particle-12 absolute top-[58%] size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--primary) 20%, white)",
                        boxShadow: "0 0 6px var(--primary)",
                      }}
                    />
                    <span
                      className="animate-reasoning-particle-13 absolute top-[85%] size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--primary) 60%, white)",
                        boxShadow: "0 0 4px var(--primary)",
                      }}
                    />
                    <span
                      className="animate-reasoning-particle-14 absolute top-[46%] size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                      style={{ boxShadow: "0 0 4px #fff, 0 0 6px var(--primary)" }}
                    />
                  </div>
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-[1.5px]"
                    style={{
                      background:
                        "linear-gradient(to right, transparent, color-mix(in srgb, var(--primary) 15%, white), transparent)",
                    }}
                  />
                </>
              )}
            </div>
          </div>

          <div
            key={isHighest ? `thumb-${burstKey}` : "thumb"}
            className={cn(
              "pointer-events-none absolute top-1/2 z-20 size-6 rounded-full border border-black/15 bg-white shadow-md transition-[left,box-shadow] duration-100 ease-out dark:border-white/20 dark:bg-zinc-100",
              isHighest && "animate-reasoning-thumb-spring",
            )}
            style={{
              left: `${progressPercent}%`,
              transform: "translate(-50%, -50%)",
              boxShadow: isHighest
                ? "0 0 16px var(--primary), 0 0 3px rgba(255,255,255,0.9) inset"
                : heat > 0.4
                  ? `0 0 ${8 + heat * 8}px color-mix(in srgb, var(--primary) 55%, transparent)`
                  : undefined,
            }}
          >
            {heat > 0.25 && (
              <span
                className="absolute inset-1.5 rounded-full"
                style={{
                  background: `radial-gradient(circle, color-mix(in srgb, var(--primary) ${Math.round(50 + heat * 50)}%, white) 0%, color-mix(in srgb, var(--primary) 25%, transparent) 80%)`,
                }}
              />
            )}

            {burstKey > 0 && isHighest && (
              <>
                <span
                  key={`corona-a-${burstKey}`}
                  className="animate-reasoning-corona pointer-events-none absolute left-1/2 top-1/2 size-6 rounded-full border border-primary/70"
                />
                <span
                  key={`corona-b-${burstKey}`}
                  className="animate-reasoning-corona pointer-events-none absolute left-1/2 top-1/2 size-6 rounded-full border border-white/70"
                  style={{ animationDelay: "90ms" }}
                />
                {SPARK_VECTORS.map((spark, i) => (
                  <span
                    key={`spark-${burstKey}-${i}`}
                    className="animate-reasoning-spark pointer-events-none absolute left-1/2 top-1/2 size-1 rounded-full bg-white"
                    style={{
                      ["--spark-x" as string]: spark.x,
                      ["--spark-y" as string]: spark.y,
                      animationDelay: spark.delay,
                      boxShadow: "0 0 6px #fff, 0 0 8px var(--primary)",
                    }}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
