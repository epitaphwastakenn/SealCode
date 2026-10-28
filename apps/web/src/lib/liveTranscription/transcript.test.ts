import { describe, expect, it } from "vite-plus/test";

import {
  chooseVoiceTranscript,
  cleanTranscriptText,
  decideWindowCommit,
  formatVoicePreviewText,
  joinTranscript,
  type WindowDecisionInput,
} from "./transcript";

function decide(overrides: Partial<WindowDecisionInput>) {
  return decideWindowCommit({
    text: "",
    segments: [],
    windowSec: 5,
    trailingSilenceSec: 0,
    silent: false,
    final: false,
    ...overrides,
  });
}

describe("cleanTranscriptText", () => {
  it("drops sound annotations and music notes", () => {
    expect(cleanTranscriptText(" [BLANK_AUDIO] ")).toBe("");
    expect(cleanTranscriptText("(upbeat music) hello ♪")).toBe("hello");
    expect(cleanTranscriptText("fix the (silêncio) bug")).toBe("fix the bug");
  });

  it("keeps ordinary parentheses", () => {
    expect(cleanTranscriptText("call foo (the old one) first")).toBe(
      "call foo (the old one) first",
    );
  });

  it("discards invented subtitle credits", () => {
    expect(cleanTranscriptText("Legendas pela comunidade Amara.org")).toBe("");
    expect(cleanTranscriptText("Thanks for watching!")).toBe("");
  });

  it("collapses runaway repetition and normalizes whitespace", () => {
    expect(cleanTranscriptText("obrigado obrigado  obrigado obrigado obrigado")).toBe(
      "obrigado obrigado obrigado",
    );
    expect(cleanTranscriptText("no no no yes")).toBe("no no no yes");
  });
});

describe("joinTranscript", () => {
  it("joins non-empty parts with single spaces", () => {
    expect(joinTranscript(" hello ", "", "world ")).toBe("hello world");
    expect(joinTranscript("", " ")).toBe("");
  });
});

describe("decideWindowCommit", () => {
  const segments = [
    { text: "first sentence here.", endSec: 5.2 },
    { text: "then a second one.", endSec: 9.6 },
    { text: "and it continues", endSec: null },
  ];

  it("keeps a short window fully revisable", () => {
    expect(decide({ text: "hello wor", windowSec: 3 })).toEqual({
      commitText: "",
      pendingText: "hello wor",
      cutSec: 0,
    });
  });

  it("commits only segments that ended before the editable tail once the window is long", () => {
    expect(decide({ text: "ignored", segments, windowSec: 13 })).toEqual({
      commitText: "first sentence here. then a second one.",
      pendingText: "and it continues",
      cutSec: 9.6,
    });
  });

  it("keeps segments that end inside the editable tail", () => {
    expect(decide({ text: "ignored", segments, windowSec: 12 })).toEqual({
      commitText: "first sentence here.",
      pendingText: "then a second one. and it continues",
      cutSec: 5.2,
    });
  });

  it("commits a whole oversized window that has no usable segment boundary", () => {
    const decision = decide({
      text: "one long run",
      segments: [{ text: "one long run", endSec: null }],
      windowSec: 25,
    });
    expect(decision).toEqual({ commitText: "one long run", pendingText: "", cutSec: 25 });
  });

  it("ends the utterance after a pause and keeps a lead-in of audio", () => {
    const decision = decide({ text: "that is all", windowSec: 4, trailingSilenceSec: 1.1 });
    expect(decision.commitText).toBe("that is all");
    expect(decision.pendingText).toBe("");
    expect(decision.cutSec).toBeCloseTo(3.6);
  });

  it("drops a silent window but keeps its lead-in and any unfinished guess", () => {
    const decision = decide({ text: "left over", silent: true, windowSec: 3 });
    expect(decision.commitText).toBe("left over");
    expect(decision.cutSec).toBeCloseTo(2.6);
  });

  it("holds audio when the model heard nothing yet, so a starting word is not clipped", () => {
    expect(decide({ text: "", windowSec: 3 }).cutSec).toBe(0);
  });

  it("commits everything when the recording ends", () => {
    expect(decide({ text: "final words", final: true, windowSec: 6 })).toEqual({
      commitText: "final words",
      pendingText: "",
      cutSec: 6,
    });
  });
});

describe("chooseVoiceTranscript", () => {
  it("prefers the server text over the preview", () => {
    expect(chooseVoiceTranscript({ ok: true, text: " server text " }, "local text")).toEqual({
      source: "server",
      text: "server text",
    });
  });

  it("trusts an empty server answer instead of the preview", () => {
    expect(chooseVoiceTranscript({ ok: true, text: "  " }, "hallucinated")).toEqual({
      source: "none",
    });
  });

  it("falls back to the preview when the server fails", () => {
    const error = new Error("provider down");
    expect(chooseVoiceTranscript({ ok: false, error }, " what I said ")).toEqual({
      source: "local-preview",
      text: "what I said",
      serverError: error,
    });
  });

  it("surfaces the server error when there is no preview text", () => {
    const error = new Error("provider down");
    expect(chooseVoiceTranscript({ ok: false, error }, "  ")).toEqual({
      source: "none",
      serverError: error,
    });
  });
});

describe("formatVoicePreviewText", () => {
  it("adds a space only when the draft does not end in whitespace", () => {
    expect(formatVoicePreviewText("", " hello ")).toBe("hello");
    expect(formatVoicePreviewText("Notes:", "hello")).toBe(" hello");
    expect(formatVoicePreviewText("Notes: ", "hello")).toBe("hello");
    expect(formatVoicePreviewText("line\n", "hello")).toBe("hello");
    expect(formatVoicePreviewText("anything", "  ")).toBe("");
  });
});
