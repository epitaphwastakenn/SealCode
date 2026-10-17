import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import { VoiceTranscriptionError, type ServerVoiceTranscriptionInput } from "@t3tools/contracts";

import {
  applyLocalSpeechToTextEnvFile,
  decodeVoiceAudio,
  resolveSpeechToTextProviderFromEnv,
  transcribeVoiceRecording,
} from "./voiceTranscription.ts";
import {
  VOICE_UPLOAD_CAPACITY_ERROR_MESSAGE,
  VoiceUploadAdmissionGate,
} from "./voiceUploadAdmission.ts";
import * as Effect from "effect/Effect";

const WAV_BASE64 = Buffer.from("RIFF0000WAVE", "ascii").toString("base64");

const baseRequest: ServerVoiceTranscriptionInput = {
  mimeType: "audio/wav",
  sampleRateHz: 24_000,
  durationMs: 1_000,
  audioBase64: WAV_BASE64,
};

describe("resolveSpeechToTextProviderFromEnv", () => {
  it("prefers an explicit SealCode STT endpoint", () => {
    expect(
      resolveSpeechToTextProviderFromEnv({
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
      resolveSpeechToTextProviderFromEnv({
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
      resolveSpeechToTextProviderFromEnv({
        GROQ_API_KEY: "gsk_test",
        SEALCODE_STT_MODEL: "whisper-large-v3",
      }),
    ).toMatchObject({
      kind: "groq",
      model: "whisper-large-v3",
    });
  });

  it("returns null when no speech-to-text key is configured", () => {
    expect(resolveSpeechToTextProviderFromEnv({})).toBeNull();
  });
});

describe("applyLocalSpeechToTextEnvFile", () => {
  it("fills missing Groq keys from a local env file", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sealcode-stt-env-"));
    const filePath = NodePath.join(directory, ".env");
    NodeFS.writeFileSync(
      filePath,
      "GROQ_API_KEY=gsk_from_file\nSEALCODE_STT_MODEL=whisper-large-v3\n",
    );
    const env: NodeJS.ProcessEnv = {};
    applyLocalSpeechToTextEnvFile(filePath, env);
    expect(resolveSpeechToTextProviderFromEnv(env)).toMatchObject({
      kind: "groq",
      apiKey: "gsk_from_file",
      model: "whisper-large-v3",
    });
    NodeFS.rmSync(directory, { recursive: true, force: true });
  });

  it("does not override an existing process env key", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sealcode-stt-env-"));
    const filePath = NodePath.join(directory, ".env");
    NodeFS.writeFileSync(filePath, "GROQ_API_KEY=gsk_from_file\n");
    const env: NodeJS.ProcessEnv = { GROQ_API_KEY: "gsk_existing" };
    applyLocalSpeechToTextEnvFile(filePath, env);
    expect(env.GROQ_API_KEY).toBe("gsk_existing");
    NodeFS.rmSync(directory, { recursive: true, force: true });
  });
});

describe("decodeVoiceAudio", () => {
  it("rejects non-WAV payloads", () => {
    expect(() =>
      decodeVoiceAudio({
        ...baseRequest,
        mimeType: "audio/webm" as ServerVoiceTranscriptionInput["mimeType"],
      }),
    ).toThrow(VoiceTranscriptionError);
  });

  it("accepts a minimal WAV buffer", () => {
    expect(decodeVoiceAudio(baseRequest).toString("ascii", 0, 4)).toBe("RIFF");
  });
});

describe("transcribeVoiceRecording", () => {
  it("posts the WAV clip to the configured OpenAI-compatible endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ text: "hello from whisper" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await Effect.runPromise(
      transcribeVoiceRecording({
        request: baseRequest,
        provider: {
          kind: "groq",
          url: "https://api.groq.com/openai/v1/audio/transcriptions",
          apiKey: "gsk_test",
          model: "whisper-large-v3-turbo",
        },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    );

    expect(result).toEqual({ text: "hello from whisper" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ Authorization: "Bearer gsk_test" });
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("fails clearly when no provider is configured", async () => {
    const result = await Effect.runPromiseExit(
      transcribeVoiceRecording({
        request: baseRequest,
        provider: null,
      }),
    );
    expect(result._tag).toBe("Failure");
  });
});

describe("VoiceUploadAdmissionGate", () => {
  it("rejects a third concurrent upload", async () => {
    const gate = new VoiceUploadAdmissionGate(2);
    const first = gate.tryAcquire();
    const second = gate.tryAcquire();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    await expect(Effect.runPromise(gate.run(Effect.succeed("ok")))).rejects.toThrow(
      VOICE_UPLOAD_CAPACITY_ERROR_MESSAGE,
    );
    first?.();
    second?.();
  });
});
