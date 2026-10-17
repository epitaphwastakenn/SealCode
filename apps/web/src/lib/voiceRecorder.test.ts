import { describe, expect, it } from "vite-plus/test";

import { appendTranscriptToPrompt, formatVoiceRecordingDuration } from "./voiceRecorder";

describe("formatVoiceRecordingDuration", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatVoiceRecordingDuration(0)).toBe("0:00");
    expect(formatVoiceRecordingDuration(1_000)).toBe("0:01");
    expect(formatVoiceRecordingDuration(12_400)).toBe("0:12");
    expect(formatVoiceRecordingDuration(61_000)).toBe("1:01");
  });
});

describe("appendTranscriptToPrompt", () => {
  it("returns the prompt when the transcript is empty", () => {
    expect(appendTranscriptToPrompt("hello", "  ")).toBe("hello");
  });

  it("uses the transcript alone when the prompt is empty", () => {
    expect(appendTranscriptToPrompt("", "  hello world  ")).toBe("hello world");
  });

  it("inserts a space unless the prompt already ends with whitespace", () => {
    expect(appendTranscriptToPrompt("Notes:", "ship it")).toBe("Notes: ship it");
    expect(appendTranscriptToPrompt("Notes: ", "ship it")).toBe("Notes: ship it");
  });
});
