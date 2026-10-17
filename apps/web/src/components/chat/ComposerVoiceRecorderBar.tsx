import { useEffect, useRef, useState } from "react";
import { Loader2Icon, XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

interface ComposerVoiceRecorderBarProps {
  disabled?: boolean;
  durationLabel: string;
  isRecording: boolean;
  isTranscribing: boolean;
  waveformLevels: readonly number[];
  onDiscard: () => void;
  onStop: () => void;
}

const BAR_WIDTH_PX = 2;
const BAR_GAP_PX = 2;
const BAR_MIN_HEIGHT_PX = 3;
const BAR_MAX_HEIGHT_PX = 22;

export function ComposerVoiceRecorderBar(props: ComposerVoiceRecorderBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [visibleBarCount, setVisibleBarCount] = useState(96);

  useEffect(() => {
    const node = trackRef.current;
    if (!node) {
      return;
    }
    const computeVisibleBars = () => {
      const width = node.clientWidth;
      if (width <= 0) {
        return;
      }
      setVisibleBarCount(Math.max(8, Math.floor(width / (BAR_WIDTH_PX + BAR_GAP_PX))));
    };
    computeVisibleBars();
    const observer = new ResizeObserver(computeVisibleBars);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const visibleLevels = props.waveformLevels.slice(-visibleBarCount);

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2"
      data-chat-composer-voice-recorder="true"
    >
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="rounded-full text-secondary-label hover:text-foreground"
        disabled={props.disabled || props.isTranscribing}
        aria-label="Discard voice note"
        onClick={props.onDiscard}
      >
        <XIcon className="size-4" aria-hidden="true" />
      </Button>
      <div
        ref={trackRef}
        className="flex h-6 min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden"
        aria-hidden="true"
      >
        {visibleLevels.map((level, index) => {
          const clamped = Math.max(0.04, Math.min(1, level));
          const height = Math.round(
            BAR_MIN_HEIGHT_PX + clamped * (BAR_MAX_HEIGHT_PX - BAR_MIN_HEIGHT_PX),
          );
          return (
            <span
              key={`${visibleLevels.length - index}-${index}`}
              className="inline-block shrink-0 rounded-full bg-destructive/80"
              style={{ width: BAR_WIDTH_PX, height }}
            />
          );
        })}
      </div>
      <span className="shrink-0 font-mono text-xs text-secondary-label tabular-nums">
        {props.isTranscribing ? "Transcribing…" : props.durationLabel}
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className={cn(
          "rounded-full",
          props.isTranscribing ? "text-secondary-label" : "text-destructive hover:text-destructive",
        )}
        disabled={props.disabled}
        aria-label={props.isTranscribing ? "Transcribing voice note" : "Stop and transcribe"}
        onClick={props.onStop}
      >
        {props.isTranscribing ? (
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <span className="size-2.5 rounded-[2px] bg-current" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
