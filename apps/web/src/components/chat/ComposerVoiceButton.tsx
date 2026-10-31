import { MicIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

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
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost-muted"
            className={cn(props.isRecording && "text-error-foreground hover:text-error-foreground")}
            disabled={props.disabled || props.isTranscribing}
            aria-label={label}
            aria-pressed={props.isRecording}
            data-chat-composer-voice="true"
            onClick={props.onClick}
          >
            {props.isTranscribing ? <Spinner aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
          </Button>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
