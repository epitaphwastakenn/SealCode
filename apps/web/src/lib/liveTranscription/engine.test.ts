import { describe, expect, it } from "vite-plus/test";

import { LIVE_TRANSCRIPTION_SAMPLE_RATE_HZ } from "./audio";
import { LiveTranscriptEngine, type WindowTranscription } from "./engine";

const RATE = LIVE_TRANSCRIPTION_SAMPLE_RATE_HZ;

function tone(seconds: number): Float32Array {
  return Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, index) => 0.2 * Math.sin(index / 5),
  );
}

function quiet(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * RATE));
}

function said(text: string, endSec: number | null = null): WindowTranscription {
  return { text, segments: [{ text, endSec }] };
}

function setup(results: ReadonlyArray<WindowTranscription | null | Error>, gate?: Promise<void>) {
  const windowLengths: number[] = [];
  const texts: string[] = [];
  const failures: unknown[] = [];
  const engine = new LiveTranscriptEngine({
    transcribe: async (audio) => {
      windowLengths.push(audio.length);
      if (windowLengths.length === 1 && gate) {
        await gate;
      }
      const result = results[windowLengths.length - 1] ?? null;
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
    onText: (text) => texts.push(text),
    onFailure: (error) => failures.push(error),
  });
  return { engine, windowLengths, texts, failures };
}

describe("LiveTranscriptEngine", () => {
  it("grows the text as audio arrives", async () => {
    const { engine, texts } = setup([said("hello"), said("hello world")]);

    engine.push(tone(1.3));
    await engine.whenIdle();
    engine.push(tone(0.6));
    await engine.whenIdle();

    expect(texts).toEqual(["hello", "hello world"]);
  });

  it("waits for enough audio before the first pass and between passes", async () => {
    const { engine, windowLengths } = setup([said("a"), said("b")]);

    engine.push(tone(1));
    await engine.whenIdle();
    expect(windowLengths).toEqual([]);

    engine.push(tone(0.3));
    await engine.whenIdle();
    engine.push(tone(0.3));
    await engine.whenIdle();
    expect(windowLengths).toEqual([Math.round(1.3 * RATE)]);
  });

  it("runs one pass at a time and catches up on the audio that arrived meanwhile", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { engine, windowLengths, texts } = setup([said("hi"), said("hi there")], gate);

    engine.push(tone(1.3));
    engine.push(tone(1));
    expect(windowLengths).toEqual([Math.round(1.3 * RATE)]);

    release();
    await engine.whenIdle();
    expect(windowLengths).toEqual([Math.round(1.3 * RATE), Math.round(2.3 * RATE)]);
    expect(texts).toEqual(["hi", "hi there"]);
  });

  it("does not run the model on silence", async () => {
    const { engine, windowLengths, texts } = setup([said("Thanks for watching")]);

    engine.push(quiet(3));
    await engine.whenIdle();

    expect(windowLengths).toEqual([]);
    expect(texts).toEqual([]);
  });

  it("freezes an utterance at a pause and restarts the window after it", async () => {
    const { engine, windowLengths, texts } = setup([
      said("hello"),
      said("hello there", 1.7),
      said("how are you"),
    ]);

    engine.push(tone(1.5));
    await engine.whenIdle();
    engine.push(quiet(1.2));
    await engine.whenIdle();
    expect(engine.text).toBe("hello there");

    engine.push(tone(1.5));
    await engine.whenIdle();

    // Only the 0.4 s lead-in and the new speech: the frozen words are not re-transcribed.
    expect(windowLengths.at(-1)).toBe(Math.round(1.9 * RATE));
    expect(engine.text).toBe("hello there how are you");
    expect(texts.at(-1)).toBe("hello there how are you");
  });

  it("slides a long window forward at a finished segment", async () => {
    const { engine, windowLengths } = setup([
      {
        text: "a b c",
        segments: [
          { text: "a", endSec: 5 },
          { text: "b", endSec: 9.5 },
          { text: "c", endSec: null },
        ],
      },
      said("c d"),
    ]);

    engine.push(tone(13));
    await engine.whenIdle();
    expect(engine.text).toBe("a b c");

    engine.push(tone(1));
    await engine.whenIdle();

    expect(windowLengths[1]).toBe(Math.round(4.5 * RATE));
    expect(engine.text).toBe("a b c d");
  });

  it("keeps the last guess when the model cannot answer", async () => {
    const { engine, texts } = setup([said("hello"), null]);

    engine.push(tone(1.3));
    await engine.whenIdle();
    engine.push(tone(0.6));
    await engine.whenIdle();

    expect(engine.text).toBe("hello");
    expect(texts).toEqual(["hello"]);
  });

  it("drops hallucinated filler from the text", async () => {
    const { engine, texts } = setup([said("Legendas pela comunidade Amara.org")]);

    engine.push(tone(1.3));
    await engine.whenIdle();

    expect(engine.text).toBe("");
    expect(texts).toEqual([]);
  });

  it("stops after a failure and reports it once", async () => {
    const error = new Error("device lost");
    const { engine, windowLengths, failures } = setup([said("hello"), error]);

    engine.push(tone(1.3));
    await engine.whenIdle();
    engine.push(tone(0.6));
    await engine.whenIdle();
    engine.push(tone(2));
    await engine.whenIdle();

    expect(failures).toEqual([error]);
    expect(windowLengths).toHaveLength(2);
    expect(engine.text).toBe("hello");
  });

  describe("finish", () => {
    it("returns the settled text without another pass when nothing new was heard", async () => {
      const { engine, windowLengths } = setup([said("hello")]);

      engine.push(tone(2));
      await engine.whenIdle();

      await expect(engine.finish()).resolves.toBe("hello");
      expect(windowLengths).toHaveLength(1);
    });

    it("transcribes the audio that no pass has covered yet", async () => {
      const { engine, windowLengths, texts } = setup([said("hel"), said("hello")]);

      engine.push(tone(1.3));
      await engine.whenIdle();
      engine.push(tone(0.4));
      await engine.whenIdle();
      expect(windowLengths).toHaveLength(1);

      await expect(engine.finish()).resolves.toBe("hello");
      expect(windowLengths).toHaveLength(2);
      expect(texts.at(-1)).toBe("hello");
    });

    it("waits for the pass in flight before the final pass", async () => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { engine } = setup([said("hi"), said("hi there")], gate);

      engine.push(tone(1.3));
      engine.push(tone(0.5));
      const finished = engine.finish();
      release();

      await expect(finished).resolves.toBe("hi there");
    });

    it("keeps the pending guess when the final pass cannot answer", async () => {
      const { engine } = setup([said("hello"), null]);

      engine.push(tone(1.3));
      await engine.whenIdle();
      engine.push(tone(0.4));

      await expect(engine.finish()).resolves.toBe("hello");
    });

    it("ignores audio after it closed", async () => {
      const { engine, windowLengths } = setup([said("hello")]);

      engine.push(tone(2));
      await engine.finish();
      engine.push(tone(2));
      await engine.whenIdle();

      expect(windowLengths).toHaveLength(1);
    });
  });
});
