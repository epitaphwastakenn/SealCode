import { describe, expect, it } from "vite-plus/test";

import { encodeVoiceRecordingWav } from "./voiceRecorderEncoding";

function readAscii(bytes: ArrayBuffer, offset: number, length: number): string {
  return String.fromCharCode(...new Uint8Array(bytes, offset, length));
}

describe("encodeVoiceRecordingWav", () => {
  it("returns null for empty audio", () => {
    expect(encodeVoiceRecordingWav([], 24_000, 24_000)).toBeNull();
    expect(encodeVoiceRecordingWav([new Float32Array(0)], 24_000, 24_000)).toBeNull();
  });

  it("writes a 24 kHz mono 16-bit WAV header", () => {
    const samples = new Float32Array(24_000);
    samples[0] = 0.5;
    const encoded = encodeVoiceRecordingWav([samples], 24_000, 24_000);
    expect(encoded).not.toBeNull();
    if (!encoded) {
      return;
    }

    expect(encoded.sampleCount).toBe(24_000);
    expect(encoded.durationMs).toBe(1_000);
    expect(encoded.bytes.byteLength).toBe(44 + 24_000 * 2);
    expect(readAscii(encoded.bytes, 0, 4)).toBe("RIFF");
    expect(readAscii(encoded.bytes, 8, 4)).toBe("WAVE");
    expect(readAscii(encoded.bytes, 12, 4)).toBe("fmt ");
    expect(readAscii(encoded.bytes, 36, 4)).toBe("data");

    const view = new DataView(encoded.bytes);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getInt16(44, true)).toBe(16_384);
  });

  it("downsamples 48 kHz audio to 24 kHz", () => {
    const samples = new Float32Array(48_000);
    const encoded = encodeVoiceRecordingWav([samples], 48_000, 24_000);
    expect(encoded?.sampleCount).toBe(24_000);
    expect(encoded?.durationMs).toBe(1_000);
  });
});
