import {
  SERVER_VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES,
  SERVER_VOICE_TRANSCRIPTION_MAX_DURATION_MS,
  VOICE_RECORDING_TARGET_SAMPLE_RATE_HZ,
  VoiceTranscriptionError,
  type ServerVoiceTranscriptionInput,
  type ServerVoiceTranscriptionResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as NodeUtil from "node:util";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

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

/** Each clip is up to 10 MB of base64 in memory, so uploads past this wait for the client to retry. */
const MAX_CONCURRENT_TRANSCRIPTIONS = 2;
const TRANSCRIPTION_TIMEOUT = Duration.seconds(60);
const MAX_PROVIDER_MESSAGE_CHARS = 300;

const VOICE_UPLOAD_CAPACITY_ERROR_MESSAGE =
  "Too many voice uploads are already in progress. Try again shortly.";

/**
 * Lets a desktop install keep speech-to-text keys beside its state instead of in the shell
 * environment, which GUI launches do not inherit. Variables already set always win.
 */
export const applyLocalSpeechToTextEnvFile = Effect.fn("voice.applyLocalEnvFile")(function* (
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const contents = yield* fileSystem.readFileString(filePath).pipe(Effect.option);
  if (Option.isNone(contents)) return;
  const parsed = yield* Effect.try({
    try: () => NodeUtil.parseEnv(contents.value),
    catch: () => undefined,
  }).pipe(Effect.option);
  if (Option.isNone(parsed) || parsed.value === undefined) return;
  for (const key of LOCAL_SPEECH_TO_TEXT_ENV_KEYS) {
    if (env[key]?.trim()) continue;
    const next = parsed.value[key]?.trim();
    if (next) env[key] = next;
  }
});

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

export const decodeVoiceAudio = (input: ServerVoiceTranscriptionInput) => {
  const invalid = (message: string) =>
    Effect.fail(new VoiceTranscriptionError({ failure: "invalid_audio", message }));

  if (input.mimeType !== "audio/wav") {
    return invalid("Only WAV audio is supported for voice transcription.");
  }
  if (input.sampleRateHz !== VOICE_RECORDING_TARGET_SAMPLE_RATE_HZ) {
    return invalid("Voice transcription requires 24 kHz mono WAV audio.");
  }
  if (input.durationMs <= 0) {
    return invalid("Voice messages must include a positive duration.");
  }
  if (input.durationMs > SERVER_VOICE_TRANSCRIPTION_MAX_DURATION_MS) {
    return Effect.fail(
      new VoiceTranscriptionError({
        failure: "too_long",
        message: "Voice messages are limited to 120 seconds.",
      }),
    );
  }

  const normalizedBase64 = normalizeBase64(input.audioBase64);
  if (!normalizedBase64 || !isLikelyBase64(normalizedBase64)) {
    return invalid("The recorded audio could not be decoded.");
  }

  const audioBuffer = Buffer.from(normalizedBase64, "base64");
  if (!audioBuffer.length || audioBuffer.toString("base64") !== normalizedBase64) {
    return invalid("The recorded audio could not be decoded.");
  }
  if (audioBuffer.length > SERVER_VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES) {
    return Effect.fail(
      new VoiceTranscriptionError({
        failure: "too_large",
        message: "Voice messages are limited to 10 MB.",
      }),
    );
  }
  if (!isLikelyWavBuffer(audioBuffer)) {
    return invalid("The recorded audio is not a valid WAV file.");
  }

  return Effect.succeed(audioBuffer);
};

export class VoiceTranscription extends Context.Service<
  VoiceTranscription,
  {
    readonly transcribe: (
      request: ServerVoiceTranscriptionInput,
    ) => Effect.Effect<ServerVoiceTranscriptionResult, VoiceTranscriptionError>;
  }
>()("t3/voiceTranscription") {}

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const admission = yield* Semaphore.make(MAX_CONCURRENT_TRANSCRIPTIONS);

  const providerFailed = (message: string) =>
    new VoiceTranscriptionError({ failure: "provider_failed", message });

  const send = Effect.fn("voice.transcribe.send")(function* (
    request: ServerVoiceTranscriptionInput,
    provider: SpeechToTextProvider,
  ) {
    const audioBuffer = yield* decodeVoiceAudio(request);
    const form = new FormData();
    form.append("file", new File([audioBuffer], "recording.wav", { type: request.mimeType }));
    form.append("model", provider.model);
    form.append("response_format", "json");

    const response = yield* httpClient
      .execute(
        HttpClientRequest.post(provider.url).pipe(
          HttpClientRequest.setHeader("authorization", `Bearer ${provider.apiKey}`),
          HttpClientRequest.bodyFormData(form),
        ),
      )
      .pipe(
        Effect.mapError(() => providerFailed("The speech-to-text provider could not be reached.")),
      );

    const payload = yield* response.json.pipe(
      Effect.map(readTranscriptionPayload),
      Effect.orElseSucceed(() => null),
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* providerFailed(
        payload?.errorMessage ?? `Transcription failed with status ${response.status}.`,
      );
    }
    if (payload === null) {
      return yield* providerFailed("The transcription response was not valid JSON.");
    }
    if (payload.text === null) {
      return yield* new VoiceTranscriptionError({
        failure: "empty_transcript",
        message: "The transcription response did not include any text.",
      });
    }
    return { text: payload.text } satisfies ServerVoiceTranscriptionResult;
  });

  const transcribe: VoiceTranscription["Service"]["transcribe"] = Effect.fn("voice.transcribe")(
    function* (request) {
      const provider = resolveSpeechToTextProviderFromEnv();
      if (!provider) {
        return yield* new VoiceTranscriptionError({
          failure: "provider_unavailable",
          message:
            "Speech-to-text needs a Groq or OpenAI API key on the server, or a browser that supports speech recognition.",
        });
      }
      const result = yield* admission.withPermitsIfAvailable(1)(
        send(request, provider).pipe(
          Effect.timeoutOrElse({
            duration: TRANSCRIPTION_TIMEOUT,
            orElse: () =>
              Effect.fail(providerFailed("The speech-to-text provider took too long to respond.")),
          }),
        ),
      );
      if (Option.isNone(result)) {
        return yield* new VoiceTranscriptionError({
          failure: "capacity",
          message: VOICE_UPLOAD_CAPACITY_ERROR_MESSAGE,
        });
      }
      return result.value;
    },
  );

  return VoiceTranscription.of({ transcribe });
});

export const layer = Layer.effect(VoiceTranscription, make);

function joinTranscriptionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/audio/transcriptions") ? trimmed : `${trimmed}/audio/transcriptions`;
}

/** A provider's error body or a success body, whichever the response carried. */
function readTranscriptionPayload(payload: unknown): {
  readonly text: string | null;
  readonly errorMessage: string | null;
} | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as {
    text?: unknown;
    transcript?: unknown;
    message?: unknown;
    error?: { message?: unknown } | null;
  };
  const errorMessage = readString(record.error?.message) ?? readString(record.message);
  return {
    text: readString(record.text) ?? readString(record.transcript),
    errorMessage: errorMessage === null ? null : errorMessage.slice(0, MAX_PROVIDER_MESSAGE_CHARS),
  };
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
