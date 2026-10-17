import { Buffer } from "node:buffer";
import * as NodeFS from "node:fs";
import * as NodeUtil from "node:util";

import {
  SERVER_VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES,
  SERVER_VOICE_TRANSCRIPTION_MAX_DURATION_MS,
  VOICE_RECORDING_TARGET_SAMPLE_RATE_HZ,
  VoiceTranscriptionError,
  type ServerVoiceTranscriptionInput,
  type ServerVoiceTranscriptionResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export type SpeechToTextProviderKind = "groq" | "openai" | "custom";

export interface SpeechToTextProvider {
  readonly kind: SpeechToTextProviderKind;
  readonly url: string;
  readonly apiKey: string;
  readonly model: string;
}

const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const GROQ_DEFAULT_MODEL = "whisper-large-v3-turbo";
const OPENAI_DEFAULT_MODEL = "whisper-1";
const LOCAL_SPEECH_TO_TEXT_ENV_KEYS = [
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "VOICE_TOOLS_OPENAI_KEY",
  "SEALCODE_STT_API_KEY",
  "SEALCODE_STT_BASE_URL",
  "SEALCODE_STT_MODEL",
] as const;

export function applyLocalSpeechToTextEnvFile(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!NodeFS.existsSync(filePath)) {
    return;
  }
  let parsed: Record<string, string | undefined>;
  try {
    parsed = NodeUtil.parseEnv(NodeFS.readFileSync(filePath, "utf8"));
  } catch {
    return;
  }
  for (const key of LOCAL_SPEECH_TO_TEXT_ENV_KEYS) {
    if (env[key]?.trim()) {
      continue;
    }
    const next = parsed[key]?.trim();
    if (next) {
      env[key] = next;
    }
  }
}

export function resolveSpeechToTextProviderFromEnv(
  env: NodeJS.Dict<string> = process.env,
): SpeechToTextProvider | null {
  const customKey = env.SEALCODE_STT_API_KEY?.trim();
  const customUrl = env.SEALCODE_STT_BASE_URL?.trim();
  if (customKey && customUrl) {
    return {
      kind: "custom",
      url: joinTranscriptionsUrl(customUrl),
      apiKey: customKey,
      model: env.SEALCODE_STT_MODEL?.trim() || OPENAI_DEFAULT_MODEL,
    };
  }

  const groqKey = env.GROQ_API_KEY?.trim();
  if (groqKey) {
    return {
      kind: "groq",
      url: GROQ_TRANSCRIPTIONS_URL,
      apiKey: groqKey,
      model: env.SEALCODE_STT_MODEL?.trim() || GROQ_DEFAULT_MODEL,
    };
  }

  const openaiKey = env.OPENAI_API_KEY?.trim() || env.VOICE_TOOLS_OPENAI_KEY?.trim();
  if (openaiKey) {
    return {
      kind: "openai",
      url: OPENAI_TRANSCRIPTIONS_URL,
      apiKey: openaiKey,
      model: env.SEALCODE_STT_MODEL?.trim() || OPENAI_DEFAULT_MODEL,
    };
  }

  return null;
}

export function decodeVoiceAudio(input: ServerVoiceTranscriptionInput): Buffer {
  if (input.mimeType !== "audio/wav") {
    throw new VoiceTranscriptionError({
      failure: "invalid_audio",
      message: "Only WAV audio is supported for voice transcription.",
    });
  }
  if (input.sampleRateHz !== VOICE_RECORDING_TARGET_SAMPLE_RATE_HZ) {
    throw new VoiceTranscriptionError({
      failure: "invalid_audio",
      message: "Voice transcription requires 24 kHz mono WAV audio.",
    });
  }
  if (input.durationMs <= 0) {
    throw new VoiceTranscriptionError({
      failure: "invalid_audio",
      message: "Voice messages must include a positive duration.",
    });
  }
  if (input.durationMs > SERVER_VOICE_TRANSCRIPTION_MAX_DURATION_MS) {
    throw new VoiceTranscriptionError({
      failure: "too_long",
      message: "Voice messages are limited to 120 seconds.",
    });
  }

  const normalizedBase64 = normalizeBase64(input.audioBase64);
  if (!normalizedBase64 || !isLikelyBase64(normalizedBase64)) {
    throw new VoiceTranscriptionError({
      failure: "invalid_audio",
      message: "The recorded audio could not be decoded.",
    });
  }

  const audioBuffer = Buffer.from(normalizedBase64, "base64");
  if (!audioBuffer.length || audioBuffer.toString("base64") !== normalizedBase64) {
    throw new VoiceTranscriptionError({
      failure: "invalid_audio",
      message: "The recorded audio could not be decoded.",
    });
  }
  if (audioBuffer.length > SERVER_VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES) {
    throw new VoiceTranscriptionError({
      failure: "too_large",
      message: "Voice messages are limited to 10 MB.",
    });
  }
  if (!isLikelyWavBuffer(audioBuffer)) {
    throw new VoiceTranscriptionError({
      failure: "invalid_audio",
      message: "The recorded audio is not a valid WAV file.",
    });
  }

  return audioBuffer;
}

export const transcribeVoiceRecording = Effect.fn("voice.transcribe")(function* (input: {
  readonly request: ServerVoiceTranscriptionInput;
  readonly provider?: SpeechToTextProvider | null;
  readonly fetchImpl?: typeof fetch;
}) {
  const provider = input.provider ?? resolveSpeechToTextProviderFromEnv();
  if (!provider) {
    return yield* new VoiceTranscriptionError({
      failure: "provider_unavailable",
      message:
        "Speech-to-text needs a Groq or OpenAI API key on the server, or a browser that supports speech recognition.",
    });
  }

  const audioBuffer = yield* Effect.try({
    try: () => decodeVoiceAudio(input.request),
    catch: (cause) =>
      cause instanceof VoiceTranscriptionError
        ? cause
        : new VoiceTranscriptionError({
            failure: "invalid_audio",
            message: "The recorded audio could not be decoded.",
          }),
  });

  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  form.append("file", new File([audioBuffer], "recording.wav", { type: input.request.mimeType }));
  form.append("model", provider.model);
  form.append("response_format", "json");

  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetchImpl(provider.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey}` },
        body: form,
        signal,
      }),
    catch: (cause) =>
      new VoiceTranscriptionError({
        failure: "provider_failed",
        message:
          cause instanceof Error
            ? cause.message
            : "The speech-to-text provider could not be reached.",
      }),
  });

  if (!response.ok) {
    const providerMessage = yield* readProviderErrorMessage(response);
    return yield* new VoiceTranscriptionError({
      failure: "provider_failed",
      message: providerMessage ?? `Transcription failed with status ${response.status}.`,
    });
  }

  const payload = yield* Effect.tryPromise({
    try: () => response.json() as Promise<{ text?: unknown; transcript?: unknown }>,
    catch: () =>
      new VoiceTranscriptionError({
        failure: "provider_failed",
        message: "The transcription response was not valid JSON.",
      }),
  });

  const text = readString(payload.text) ?? readString(payload.transcript);
  if (!text) {
    return yield* new VoiceTranscriptionError({
      failure: "empty_transcript",
      message: "The transcription response did not include any text.",
    });
  }

  const result: ServerVoiceTranscriptionResult = { text };
  return result;
});

function joinTranscriptionsUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").endsWith("/audio/transcriptions")
    ? baseUrl.replace(/\/+$/, "")
    : `${baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
}

async function readProviderErrorMessage(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    return readString(payload.error?.message) ?? readString(payload.message);
  } catch {
    return null;
  }
}

function normalizeBase64(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, "");
  return normalized.length > 0 ? normalized : null;
}

function isLikelyBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function isLikelyWavBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  );
}

function readString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}
