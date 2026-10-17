import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SERVER_VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const SERVER_VOICE_TRANSCRIPTION_MAX_DURATION_MS = 120_000;
export const VOICE_RECORDING_TARGET_SAMPLE_RATE_HZ = 24_000;
export const SERVER_VOICE_TRANSCRIPTION_MAX_BASE64_LENGTH = 14_000_000;

export const VoiceRecordingMimeType = Schema.Literal("audio/wav");
export type VoiceRecordingMimeType = typeof VoiceRecordingMimeType.Type;

export const ServerVoiceTranscriptionInput = Schema.Struct({
  audioBase64: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(SERVER_VOICE_TRANSCRIPTION_MAX_BASE64_LENGTH),
  ),
  mimeType: VoiceRecordingMimeType,
  sampleRateHz: PositiveInt,
  durationMs: PositiveInt.check(
    Schema.isLessThanOrEqualTo(SERVER_VOICE_TRANSCRIPTION_MAX_DURATION_MS),
  ),
});
export type ServerVoiceTranscriptionInput = typeof ServerVoiceTranscriptionInput.Type;

export const ServerVoiceTranscriptionResult = Schema.Struct({
  text: TrimmedNonEmptyString,
});
export type ServerVoiceTranscriptionResult = typeof ServerVoiceTranscriptionResult.Type;

export const VoiceTranscriptionFailure = Schema.Literals([
  "invalid_audio",
  "too_large",
  "too_long",
  "provider_unavailable",
  "provider_failed",
  "empty_transcript",
  "capacity",
]);
export type VoiceTranscriptionFailure = typeof VoiceTranscriptionFailure.Type;

export class VoiceTranscriptionError extends Schema.TaggedError<VoiceTranscriptionError>()(
  "VoiceTranscriptionError",
  {
    failure: VoiceTranscriptionFailure,
    message: TrimmedNonEmptyString,
  },
) {}
