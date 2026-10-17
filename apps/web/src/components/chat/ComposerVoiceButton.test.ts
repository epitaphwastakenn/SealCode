import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { TooltipProvider } from "../ui/tooltip";
import { ComposerVoiceButton } from "./ComposerVoiceButton";

function renderVoiceButton(props: {
  isRecording: boolean;
  isTranscribing: boolean;
  durationLabel: string;
}) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ComposerVoiceButton, {
        ...props,
        onClick: () => {},
      }),
    ),
  );
}

describe("ComposerVoiceButton", () => {
  it("renders a microphone control to the left of send", () => {
    const markup = renderVoiceButton({
      isRecording: false,
      isTranscribing: false,
      durationLabel: "0:00",
    });
    expect(markup).toContain('data-chat-composer-voice="true"');
    expect(markup).toContain('aria-label="Record voice note"');
  });

  it("labels stop with the recording duration", () => {
    const markup = renderVoiceButton({
      isRecording: true,
      isTranscribing: false,
      durationLabel: "0:12",
    });
    expect(markup).toContain('aria-label="Stop voice note (0:12)"');
    expect(markup).toContain('aria-pressed="true"');
  });
});
