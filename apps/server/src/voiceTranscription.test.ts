import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import { VoiceTranscriptionError, type ServerVoiceTranscriptionInput } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as VoiceTranscription from "./voiceTranscription.ts";

const WAV_BASE64 = Buffer.from("RIFF0000WAVE", "ascii").toString("base64");

const baseRequest: ServerVoiceTranscriptionInput = {
  mimeType: "audio/wav",
  sampleRateHz: 24_000,
  durationMs: 1_000,
  audioBase64: WAV_BASE64,
};

interface RecordedRequest {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

const withProviderEnv = <A, E, R>(env: Record<string, string>, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
      Object.assign(process.env, env);
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }),
  );

const layerProvider = (
  reply: (request: RecordedRequest) => Effect.Effect<Response>,
  recorded: Array<RecordedRequest> = [],
) =>
  VoiceTranscription.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.suspend(() => {
            const entry = {
              url: request.url,
              authorization: request.headers.authorization,
              body: request.body._tag === "FormData" ? request.body.formData : undefined,
            };
            recorded.push(entry);
            return reply(entry);
          }).pipe(Effect.map((response) => HttpClientResponse.fromWeb(request, response))),
        ),
      ),
    ),
  );

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("resolveSpeechToTextProviderFromEnv", () => {
  it("prefers an explicit SealCode STT endpoint", () => {
    expect(
      VoiceTranscription.resolveSpeechToTextProviderFromEnv({
        SEALCODE_STT_API_KEY: "sk-custom",
        SEALCODE_STT_BASE_URL: "https://stt.example/v1",
        GROQ_API_KEY: "gsk_ignored",
      }),
    ).toEqual({
      kind: "custom",
      url: "https://stt.example/v1/audio/transcriptions",
      apiKey: "sk-custom",
      model: "whisper-1",
    });
  });

  it("uses Groq before OpenAI when both keys are present", () => {
    expect(
      VoiceTranscription.resolveSpeechToTextProviderFromEnv({
        GROQ_API_KEY: "gsk_test",
        OPENAI_API_KEY: "sk-openai",
      }),
    ).toMatchObject({
      kind: "groq",
      url: "https://api.groq.com/openai/v1/audio/transcriptions",
      model: "whisper-large-v3-turbo",
    });
  });

  it("uses SEALCODE_STT_MODEL for Groq when set", () => {
    expect(
      VoiceTranscription.resolveSpeechToTextProviderFromEnv({
        GROQ_API_KEY: "gsk_test",
        SEALCODE_STT_MODEL: "whisper-large-v3",
      }),
    ).toMatchObject({
      kind: "groq",
      model: "whisper-large-v3",
    });
  });

  it("returns null when no speech-to-text key is configured", () => {
    expect(VoiceTranscription.resolveSpeechToTextProviderFromEnv({})).toBeNull();
  });
});

describe("applyLocalSpeechToTextEnvFile", () => {
  it.effect("fills missing Groq keys from a local env file", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "sealcode-stt-env-" });
      const filePath = path.join(directory, ".env");
      yield* fileSystem.writeFileString(
        filePath,
        "GROQ_API_KEY=gsk_from_file\nSEALCODE_STT_MODEL=whisper-large-v3\n",
      );
      const env: NodeJS.ProcessEnv = {};
      yield* VoiceTranscription.applyLocalSpeechToTextEnvFile(filePath, env);
      expect(VoiceTranscription.resolveSpeechToTextProviderFromEnv(env)).toMatchObject({
        kind: "groq",
        apiKey: "gsk_from_file",
        model: "whisper-large-v3",
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does not override an existing process env key", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "sealcode-stt-env-" });
      const filePath = path.join(directory, ".env");
      yield* fileSystem.writeFileString(filePath, "GROQ_API_KEY=gsk_from_file\n");
      const env: NodeJS.ProcessEnv = { GROQ_API_KEY: "gsk_existing" };
      yield* VoiceTranscription.applyLocalSpeechToTextEnvFile(filePath, env);
      expect(env.GROQ_API_KEY).toBe("gsk_existing");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("ignores a missing env file", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {};
      yield* VoiceTranscription.applyLocalSpeechToTextEnvFile("/nonexistent/sealcode/.env", env);
      expect(env).toEqual({});
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("decodeVoiceAudio", () => {
  it.effect("rejects non-WAV payloads", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        VoiceTranscription.decodeVoiceAudio({
          ...baseRequest,
          mimeType: "audio/webm" as ServerVoiceTranscriptionInput["mimeType"],
        }),
      );
      assert(Exit.isFailure(exit));
      expect(Exit.findErrorOption(exit)).toMatchObject({
        value: { _tag: "VoiceTranscriptionError", failure: "invalid_audio" },
      });
    }),
  );

  it.effect("accepts a minimal WAV buffer", () =>
    Effect.gen(function* () {
      const audio = yield* VoiceTranscription.decodeVoiceAudio(baseRequest);
      expect(audio.toString("ascii", 0, 4)).toBe("RIFF");
    }),
  );
});

describe("VoiceTranscription.transcribe", () => {
  it.effect("posts the WAV clip to the configured OpenAI-compatible endpoint", () => {
    const recorded: Array<RecordedRequest> = [];
    return Effect.gen(function* () {
      const voice = yield* VoiceTranscription.VoiceTranscription;
      const result = yield* withProviderEnv(
        { GROQ_API_KEY: "gsk_test" },
        voice.transcribe(baseRequest),
      );

      expect(result).toEqual({ text: "hello from whisper" });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
      expect(recorded[0]?.authorization).toBe("Bearer gsk_test");
      expect(recorded[0]?.body).toBeInstanceOf(FormData);
    }).pipe(
      Effect.provide(
        layerProvider(() => Effect.succeed(jsonResponse({ text: "hello from whisper" })), recorded),
      ),
    );
  });

  it.effect("fails clearly when no provider is configured", () =>
    Effect.gen(function* () {
      const voice = yield* VoiceTranscription.VoiceTranscription;
      const exit = yield* Effect.exit(
        withProviderEnv(
          {
            GROQ_API_KEY: "",
            OPENAI_API_KEY: "",
            VOICE_TOOLS_OPENAI_KEY: "",
            SEALCODE_STT_API_KEY: "",
            SEALCODE_STT_BASE_URL: "",
          },
          voice.transcribe(baseRequest),
        ),
      );
      assert(Exit.isFailure(exit));
      expect(Exit.findErrorOption(exit)).toMatchObject({
        value: { failure: "provider_unavailable" },
      });
    }).pipe(Effect.provide(layerProvider(() => Effect.succeed(jsonResponse({ text: "unused" }))))),
  );

  it.effect("surfaces the provider's error message", () =>
    Effect.gen(function* () {
      const voice = yield* VoiceTranscription.VoiceTranscription;
      const exit = yield* Effect.exit(
        withProviderEnv({ GROQ_API_KEY: "gsk_bad" }, voice.transcribe(baseRequest)),
      );
      assert(Exit.isFailure(exit));
      expect(Exit.findErrorOption(exit)).toMatchObject({
        value: { failure: "provider_failed", message: "Invalid API Key" },
      });
    }).pipe(
      Effect.provide(
        layerProvider(() =>
          Effect.succeed(jsonResponse({ error: { message: "Invalid API Key" } }, 401)),
        ),
      ),
    ),
  );

  it.effect("reports an empty transcript", () =>
    Effect.gen(function* () {
      const voice = yield* VoiceTranscription.VoiceTranscription;
      const exit = yield* Effect.exit(
        withProviderEnv({ GROQ_API_KEY: "gsk_test" }, voice.transcribe(baseRequest)),
      );
      assert(Exit.isFailure(exit));
      expect(Exit.findErrorOption(exit)).toMatchObject({
        value: { failure: "empty_transcript" },
      });
    }).pipe(Effect.provide(layerProvider(() => Effect.succeed(jsonResponse({ text: "  " }))))),
  );

  it.effect("gives up on a provider that never answers and frees its slot", () =>
    Effect.gen(function* () {
      const voice = yield* VoiceTranscription.VoiceTranscription;
      yield* withProviderEnv(
        { GROQ_API_KEY: "gsk_test" },
        Effect.gen(function* () {
          const stalled = yield* Effect.forkChild(Effect.exit(voice.transcribe(baseRequest)));
          yield* TestClock.adjust("61 seconds");
          const exit = yield* Fiber.join(stalled);
          assert(Exit.isFailure(exit));
          expect(Exit.findErrorOption(exit)).toMatchObject({
            value: { failure: "provider_failed" },
          });
        }),
      );
    }).pipe(Effect.provide(layerProvider(() => Effect.never))),
  );

  it.effect("rejects a third concurrent upload", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      let inFlight = 0;
      const layer = layerProvider(() =>
        Effect.gen(function* () {
          inFlight += 1;
          if (inFlight === 2) yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return jsonResponse({ text: "done" });
        }),
      );
      yield* Effect.gen(function* () {
        const voice = yield* VoiceTranscription.VoiceTranscription;
        yield* withProviderEnv(
          { GROQ_API_KEY: "gsk_test" },
          Effect.gen(function* () {
            const first = yield* Effect.forkChild(voice.transcribe(baseRequest));
            const second = yield* Effect.forkChild(voice.transcribe(baseRequest));
            yield* Deferred.await(started);
            const third = yield* Effect.exit(voice.transcribe(baseRequest));
            assert(Exit.isFailure(third));
            const error = Exit.findErrorOption(third);
            expect(error).toMatchObject({ value: { failure: "capacity" } });
            expect(error._tag === "Some" && error.value).toBeInstanceOf(VoiceTranscriptionError);
            yield* Deferred.succeed(release, undefined);
            yield* Fiber.await(first);
            yield* Fiber.await(second);
          }),
        );
      }).pipe(Effect.provide(layer));
    }),
  );
});
