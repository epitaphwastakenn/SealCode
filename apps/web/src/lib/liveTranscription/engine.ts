import {
  isSilentAudio,
  LIVE_TRANSCRIPTION_SAMPLE_RATE_HZ,
  RollingAudioBuffer,
  trailingSilenceSeconds,
} from "./audio";
import {
  cleanTranscriptText,
  DEFAULT_WINDOW_CONFIG,
  decideWindowCommit,
  joinTranscript,
  type TranscriptSegment,
  type WindowConfig,
} from "./transcript";

export interface WindowTranscription {
  readonly text: string;
  readonly segments: ReadonlyArray<TranscriptSegment>;
}

/** Resolves null when the model cannot answer yet, for example before it knows the language. */
export type TranscribeWindow = (audio: Float32Array) => Promise<WindowTranscription | null>;

export interface LiveTranscriptEngineOptions {
  readonly transcribe: TranscribeWindow;
  readonly onText: (text: string) => void;
  readonly onFailure?: (error: unknown) => void;
  readonly window?: WindowConfig;
}

// Whisper reads 30 s at most; the buffer only has to outlast one slow pass.
const BUFFER_SECONDS = 28;
const MIN_WINDOW_SECONDS = 1.2;
const MIN_NEW_AUDIO_SECONDS = 0.5;
const MIN_FINAL_AUDIO_SECONDS = 0.25;
const RATE = LIVE_TRANSCRIPTION_SAMPLE_RATE_HZ;

function cleanSegments(segments: ReadonlyArray<TranscriptSegment>): TranscriptSegment[] {
  const cleaned: TranscriptSegment[] = [];
  for (const segment of segments) {
    const text = cleanTranscriptText(segment.text);
    if (text.length > 0) {
      cleaned.push({ text, endSec: segment.endSec });
    }
  }
  return cleaned;
}

/**
 * Re-transcribes a rolling window of 16 kHz audio as it grows. Text that has left the window is
 * frozen in `committed`; `pending` is the latest guess for the audio still inside it. One pass
 * runs at a time, so a slow device simply updates less often instead of queueing work.
 */
export class LiveTranscriptEngine {
  private readonly buffer = new RollingAudioBuffer(BUFFER_SECONDS * RATE);
  private readonly window: WindowConfig;
  private committed = "";
  private pending = "";
  private emitted = "";
  private decodedLength = 0;
  private running: Promise<void> | null = null;
  private finishing = false;
  private failed = false;
  private closed = false;

  constructor(private readonly options: LiveTranscriptEngineOptions) {
    this.window = options.window ?? DEFAULT_WINDOW_CONFIG;
  }

  get text(): string {
    return joinTranscript(this.committed, this.pending);
  }

  push(samples: Float32Array): void {
    if (this.closed) {
      return;
    }
    this.buffer.push(samples);
    this.schedule();
  }

  async whenIdle(): Promise<void> {
    while (this.running) {
      await this.running;
    }
  }

  /** Waits for the pass in flight, transcribes what is left, and returns the full text. */
  async finish(): Promise<string> {
    if (this.closed) {
      return this.text;
    }
    this.finishing = true;
    await this.whenIdle();
    const unseenSamples = this.buffer.length - this.decodedLength;
    if (!this.failed && !this.closed && unseenSamples >= MIN_FINAL_AUDIO_SECONDS * RATE) {
      await this.runPass(true);
    }
    this.committed = joinTranscript(this.committed, this.pending);
    this.pending = "";
    const text = this.text;
    this.emit();
    this.close();
    return text;
  }

  close(): void {
    this.closed = true;
    this.buffer.clear();
  }

  private schedule(): void {
    if (this.running || this.closed || this.finishing || this.failed) {
      return;
    }
    const length = this.buffer.length;
    if (
      length < MIN_WINDOW_SECONDS * RATE ||
      length - this.decodedLength < MIN_NEW_AUDIO_SECONDS * RATE
    ) {
      return;
    }
    this.running = this.runPass(false)
      .catch(() => undefined)
      .finally(() => {
        this.running = null;
        this.schedule();
      });
  }

  private emit(): void {
    const text = this.text;
    if (text !== this.emitted && !this.closed) {
      this.emitted = text;
      this.options.onText(text);
    }
  }

  private async runPass(final: boolean): Promise<void> {
    const audio = this.buffer.snapshot();
    const windowSec = audio.length / RATE;
    const silent = isSilentAudio(audio);
    this.decodedLength = audio.length;

    let hypothesis: string | null = null;
    let segments: TranscriptSegment[] = [];
    if (!silent) {
      try {
        const result = await this.options.transcribe(audio);
        if (result) {
          segments = cleanSegments(result.segments);
          hypothesis =
            segments.length > 0
              ? joinTranscript(...segments.map((segment) => segment.text))
              : cleanTranscriptText(result.text);
        }
      } catch (error) {
        this.failed = true;
        this.options.onFailure?.(error);
        return;
      }
      if (this.closed) {
        return;
      }
      if (hypothesis === null && !final) {
        return;
      }
    }

    // Silence and an unanswered final pass keep the last guess instead of discarding it.
    const text =
      hypothesis === null || (final && hypothesis.length === 0) ? this.pending : hypothesis;
    const decision = decideWindowCommit(
      {
        text,
        segments,
        windowSec,
        trailingSilenceSec: trailingSilenceSeconds(audio),
        silent,
        final,
      },
      this.window,
    );
    this.committed = joinTranscript(this.committed, decision.commitText);
    this.pending = decision.pendingText;
    const cutSamples = Math.min(audio.length, Math.round(decision.cutSec * RATE));
    this.buffer.dropFront(cutSamples);
    this.decodedLength = audio.length - cutSamples;
    this.emit();
  }
}
