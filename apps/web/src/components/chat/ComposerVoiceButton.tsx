import { Loader2Icon, MicIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

export function ComposerVoiceButton(props: {
  disabled?: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  durationLabel: string;
  onClick: () => void;
}) {
  const label = props.isTranscribing
    ? "Transcribing voice note"
    : props.isRecording
      ? `Stop voice note (${props.durationLabel})`
      : "Record voice note";

  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className={cn(
                "rounded-full text-secondary-label hover:text-foreground",
                props.isRecording && "text-destructive hover:text-destructive",
              )}
              disabled={props.disabled || props.isTranscribing}
              aria-label={label}
              aria-pressed={props.isRecording}
              data-chat-composer-voice="true"
              onClick={props.onClick}
            >
              {props.isTranscribing ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <MicIcon className="size-4" aria-hidden="true" />
              )}
            </Button>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </TooltipProvider>
  );
}
