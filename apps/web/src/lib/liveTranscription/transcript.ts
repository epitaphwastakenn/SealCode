export interface TranscriptSegment {
  readonly text: string;
  /** Seconds from the window start; null while the model has not closed the segment. */
  readonly endSec: number | null;
}

export interface WindowConfig {
  /** A window this long starts committing finished segments. */
  readonly maxWindowSec: number;
  /** Past this, the whole window is committed even without a segment boundary. */
  readonly hardMaxWindowSec: number;
  /** Seconds of the newest audio that stay editable when committing a long window. */
  readonly keepTailSec: number;
  /** A quiet gap this long ends the utterance. */
  readonly pauseCommitSec: number;
  /** Audio kept after a cut so the next word's onset is not clipped. */
  readonly leadInSec: number;
}

export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
  maxWindowSec: 12,
  hardMaxWindowSec: 24,
  keepTailSec: 3,
  pauseCommitSec: 1,
  leadInSec: 0.4,
};

export interface WindowDecisionInput {
  /** Cleaned hypothesis for the whole window. */
  readonly text: string;
  readonly segments: ReadonlyArray<TranscriptSegment>;
  readonly windowSec: number;
  readonly trailingSilenceSec: number;
  /** The window had no audible speech, so no inference ran. */
  readonly silent: boolean;
  /** The recording ended: everything left is final. */
  readonly final: boolean;
}

export interface WindowDecision {
  /** Text that leaves the rolling window for good. */
  readonly commitText: string;
  /** Text that stays a revisable guess for the audio still in the window. */
  readonly pendingText: string;
  /** Seconds to drop from the front of the window audio. */
  readonly cutSec: number;
}

const NOISE_ANNOTATION =
  /[[(]\s*[^\])]{0,30}?(?:music|música|musica|silence|silêncio|silencio|applause|aplausos|laugh|risos|noise|ruído|ruido|blank|inaudible|sound)[^\])]{0,30}[\])]|[♪♫]+/giu;

// Whisper's habit of inventing subtitle credits and sign-offs on near-silence.
const HALLUCINATED_CREDIT =
  /amara\.org|subtitles? by|legendas? (?:pela|por|feitas)|subt[ií]tulos? (?:realizados|por)|thanks? for watching|thank you for watching|obrigad[oa] por assistir|like and subscribe|inscreva-se/iu;

const REPEATED_WORD = /(?<![\p{L}])(\p{L}+)(?:[\s,.!?]+\1(?![\p{L}])){3,}/giu;

export function cleanTranscriptText(text: string): string {
  const withoutNoise = text.replace(NOISE_ANNOTATION, " ");
  if (HALLUCINATED_CREDIT.test(withoutNoise)) {
    return "";
  }
  return withoutNoise.replace(REPEATED_WORD, "$1 $1 $1").replace(/\s+/g, " ").trim();
}

export function joinTranscript(...parts: ReadonlyArray<string>): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

function planLongWindowCommit(
  segments: ReadonlyArray<TranscriptSegment>,
  windowSec: number,
  config: WindowConfig,
): WindowDecision | null {
  if (windowSec < config.maxWindowSec) {
    return null;
  }
  const limit = windowSec - config.keepTailSec;
  let lastCommittable = -1;
  for (let index = 0; index < segments.length; index += 1) {
    const endSec = segments[index]?.endSec ?? null;
    if (endSec === null || endSec > limit) {
      break;
    }
    lastCommittable = index;
  }
  if (lastCommittable >= 0) {
    const cutSec = Math.min(segments[lastCommittable]?.endSec ?? windowSec, windowSec);
    return {
      commitText: joinTranscript(
        ...segments.slice(0, lastCommittable + 1).map((segment) => segment.text),
      ),
      pendingText: joinTranscript(
        ...segments.slice(lastCommittable + 1).map((segment) => segment.text),
      ),
      cutSec,
    };
  }
  if (windowSec >= config.hardMaxWindowSec) {
    return {
      commitText: joinTranscript(...segments.map((segment) => segment.text)),
      pendingText: "",
      cutSec: windowSec,
    };
  }
  return null;
}

/**
 * Decides what a finished pass over the rolling window freezes. The window restarts exactly
 * where the committed audio ends, so frozen text never overlaps what is re-transcribed.
 */
export function decideWindowCommit(
  input: WindowDecisionInput,
  config: WindowConfig = DEFAULT_WINDOW_CONFIG,
): WindowDecision {
  const { text, segments, windowSec, trailingSilenceSec } = input;
  if (input.final) {
    return { commitText: text, pendingText: "", cutSec: windowSec };
  }
  const afterLeadIn = Math.max(0, windowSec - config.leadInSec);
  if (input.silent) {
    return { commitText: text, pendingText: "", cutSec: afterLeadIn };
  }
  if (text.length === 0) {
    return {
      commitText: "",
      pendingText: "",
      cutSec: windowSec >= config.hardMaxWindowSec ? afterLeadIn : 0,
    };
  }
  if (trailingSilenceSec >= config.pauseCommitSec) {
    return { commitText: text, pendingText: "", cutSec: afterLeadIn };
  }
  return (
    planLongWindowCommit(segments, windowSec, config) ?? {
      commitText: "",
      pendingText: text,
      cutSec: 0,
    }
  );
}

export type ServerTranscriptionOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: unknown };

export type VoiceTranscriptChoice =
  | { readonly source: "server"; readonly text: string }
  | { readonly source: "local-preview"; readonly text: string; readonly serverError: unknown }
  | { readonly source: "none"; readonly serverError?: unknown };

/**
 * The server stays the source of truth. The on-device preview only stands in when the server
 * could not answer, so the user's words are not lost; an empty server answer is trusted.
 */
export function chooseVoiceTranscript(
  server: ServerTranscriptionOutcome,
  localPreview: string,
): VoiceTranscriptChoice {
  if (server.ok) {
    const text = server.text.trim();
    return text.length > 0 ? { source: "server", text } : { source: "none" };
  }
  const local = localPreview.trim();
  return local.length > 0
    ? { source: "local-preview", text: local, serverError: server.error }
    : { source: "none", serverError: server.error };
}

/** What the composer shows dimmed after the draft: a leading space unless one is already there. */
export function formatVoicePreviewText(draftTail: string, previewText: string): string {
  const preview = previewText.trim();
  if (preview.length === 0) {
    return "";
  }
  return draftTail.length === 0 || /\s$/.test(draftTail) ? preview : ` ${preview}`;
}
