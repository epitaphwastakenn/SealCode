export const LIVE_TRANSCRIPTION_SAMPLE_RATE_HZ = 16_000;

/** Whole-window RMS under this is treated as silence: no inference, no hallucinated filler. */
const SILENT_WINDOW_RMS = 0.004;
const SILENT_FRAME_RMS = 0.006;
const SILENCE_FRAME_SECONDS = 0.05;

/**
 * Box-filter resampler that keeps its phase across chunks, so a stream of small recorder
 * buffers resamples without clicks at the seams.
 */
export class StreamingResampler {
  private readonly step: number;
  private sum = 0;
  private filled = 0;

  constructor(inputRateHz: number, outputRateHz: number = LIVE_TRANSCRIPTION_SAMPLE_RATE_HZ) {
    this.step = inputRateHz / outputRateHz;
  }

  process(input: Float32Array): Float32Array {
    if (this.step === 1) {
      return input;
    }
    const output = new Float32Array(Math.ceil((input.length + this.filled) / this.step) + 1);
    let count = 0;
    for (let index = 0; index < input.length; index += 1) {
      const sample = input[index] ?? 0;
      let remaining = 1;
      while (remaining > 1e-9) {
        const needed = this.step - this.filled;
        const take = remaining < needed ? remaining : needed;
        this.sum += sample * take;
        this.filled += take;
        remaining -= take;
        if (this.filled >= this.step - 1e-9) {
          output[count] = this.sum / this.step;
          count += 1;
          this.sum = 0;
          this.filled = 0;
        }
      }
    }
    return output.subarray(0, count);
  }
}

/** Fixed-capacity PCM buffer. Pushing past capacity drops the oldest samples. */
export class RollingAudioBuffer {
  private readonly data: Float32Array;
  private used = 0;

  constructor(private readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  get length(): number {
    return this.used;
  }

  push(samples: Float32Array): void {
    if (samples.length >= this.capacity) {
      this.data.set(samples.subarray(samples.length - this.capacity));
      this.used = this.capacity;
      return;
    }
    const overflow = this.used + samples.length - this.capacity;
    if (overflow > 0) {
      this.data.copyWithin(0, overflow, this.used);
      this.used -= overflow;
    }
    this.data.set(samples, this.used);
    this.used += samples.length;
  }

  /** A copy, so an async inference can keep reading while new audio arrives. */
  snapshot(): Float32Array {
    return this.data.slice(0, this.used);
  }

  dropFront(count: number): void {
    const dropped = Math.max(0, Math.min(this.used, Math.floor(count)));
    if (dropped === 0) {
      return;
    }
    this.data.copyWithin(0, dropped, this.used);
    this.used -= dropped;
  }

  clear(): void {
    this.used = 0;
  }
}

function rms(samples: Float32Array, from: number, to: number): number {
  if (to <= from) {
    return 0;
  }
  let sumOfSquares = 0;
  for (let index = from; index < to; index += 1) {
    const sample = samples[index] ?? 0;
    sumOfSquares += sample * sample;
  }
  return Math.sqrt(sumOfSquares / (to - from));
}

export function isSilentAudio(samples: Float32Array): boolean {
  return rms(samples, 0, samples.length) < SILENT_WINDOW_RMS;
}

/** Length of the quiet run at the end of `samples`, in whole 50 ms frames. */
export function trailingSilenceSeconds(
  samples: Float32Array,
  sampleRateHz: number = LIVE_TRANSCRIPTION_SAMPLE_RATE_HZ,
): number {
  const frameSize = Math.max(1, Math.round(sampleRateHz * SILENCE_FRAME_SECONDS));
  let end = samples.length;
  let frames = 0;
  while (end - frameSize >= 0 && rms(samples, end - frameSize, end) < SILENT_FRAME_RMS) {
    end -= frameSize;
    frames += 1;
  }
  return (frames * frameSize) / sampleRateHz;
}
