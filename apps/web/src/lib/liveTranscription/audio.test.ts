import { describe, expect, it } from "vite-plus/test";

import {
  isSilentAudio,
  RollingAudioBuffer,
  StreamingResampler,
  trailingSilenceSeconds,
} from "./audio";

function ramp(length: number): Float32Array {
  return Float32Array.from({ length }, (_, index) => index);
}

describe("StreamingResampler", () => {
  it("averages 3:1 input exactly", () => {
    const resampler = new StreamingResampler(48_000, 16_000);
    expect(Array.from(resampler.process(Float32Array.of(3, 6, 9, 12, 15, 18)))).toEqual([6, 15]);
  });

  it("keeps its phase across chunk boundaries", () => {
    const input = ramp(300);
    const whole = Array.from(new StreamingResampler(24_000, 16_000).process(input));

    const split = new StreamingResampler(24_000, 16_000);
    const pieces = [input.subarray(0, 7), input.subarray(7, 100), input.subarray(100)].flatMap(
      (chunk) => Array.from(split.process(chunk)),
    );

    expect(pieces).toHaveLength(whole.length);
    pieces.forEach((value, index) => expect(value).toBeCloseTo(whole[index] ?? 0, 4));
  });

  it("produces one output sample per 1.5 input samples at 24 kHz", () => {
    const output = new StreamingResampler(24_000, 16_000).process(new Float32Array(2_400));
    expect(output.length).toBe(1_600);
  });

  it("passes matching rates through untouched", () => {
    const input = Float32Array.of(1, 2, 3);
    expect(new StreamingResampler(16_000, 16_000).process(input)).toBe(input);
  });
});

describe("RollingAudioBuffer", () => {
  it("drops the oldest samples once full", () => {
    const buffer = new RollingAudioBuffer(5);
    buffer.push(Float32Array.of(1, 2, 3));
    buffer.push(Float32Array.of(4, 5, 6, 7));
    expect(Array.from(buffer.snapshot())).toEqual([3, 4, 5, 6, 7]);
    buffer.push(Float32Array.of(8, 9, 10, 11, 12, 13, 14));
    expect(Array.from(buffer.snapshot())).toEqual([10, 11, 12, 13, 14]);
  });

  it("hands out snapshots that later writes do not change", () => {
    const buffer = new RollingAudioBuffer(8);
    buffer.push(Float32Array.of(1, 2, 3));
    const snapshot = buffer.snapshot();
    buffer.dropFront(2);
    buffer.push(Float32Array.of(9));
    expect(Array.from(snapshot)).toEqual([1, 2, 3]);
    expect(Array.from(buffer.snapshot())).toEqual([3, 9]);
  });

  it("clamps drops to what is buffered", () => {
    const buffer = new RollingAudioBuffer(8);
    buffer.push(Float32Array.of(1, 2));
    buffer.dropFront(100);
    expect(buffer.length).toBe(0);
  });
});

describe("silence detection", () => {
  const rate = 16_000;
  const speech = Float32Array.from({ length: rate }, (_, index) => 0.2 * Math.sin(index / 5));
  const quiet = new Float32Array(rate * 2);

  it("treats quiet audio as silent and speech as audible", () => {
    expect(isSilentAudio(quiet)).toBe(true);
    expect(isSilentAudio(speech)).toBe(false);
  });

  it("measures the quiet run after the last speech", () => {
    const audio = new Float32Array(speech.length + quiet.length);
    audio.set(speech);
    expect(trailingSilenceSeconds(audio)).toBeCloseTo(2, 1);
    expect(trailingSilenceSeconds(speech)).toBe(0);
  });
});
