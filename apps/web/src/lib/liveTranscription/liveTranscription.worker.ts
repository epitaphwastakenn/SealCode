import { LIVE_TRANSCRIPTION_SAMPLE_RATE_HZ, StreamingResampler } from "./audio";
import { LiveTranscriptEngine, type WindowTranscription } from "./engine";
import type {
  LiveTranscriptionDevice,
  LiveTranscriptionEvent,
  LiveTranscriptionRequest,
} from "./protocol";

type Transformers = typeof import("@huggingface/transformers");

// Whisper base keeps names and Portuguese usable; the GPU absorbs its cost. Without WebGPU the
// 8-bit tiny model is the largest one that still answers within a couple of seconds.
const MODELS = {
  webgpu: {
    model: "onnx-community/whisper-base",
    dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
  },
  wasm: { model: "onnx-community/whisper-tiny", dtype: "q8" },
} as const;

const MAX_NEW_TOKENS = 192;
const MAX_DETECTION_ATTEMPTS = 3;

async function createSpeechPipeline(transformers: Transformers, device: LiveTranscriptionDevice) {
  const config = MODELS[device];
  return transformers.pipeline("automatic-speech-recognition", config.model, {
    device,
    dtype: config.dtype,
  });
}

type SpeechPipeline = Awaited<ReturnType<typeof createSpeechPipeline>>;

interface LoadedModel {
  readonly speech: SpeechPipeline;
}

interface WhisperGenerationConfig {
  readonly decoder_start_token_id: number;
  readonly lang_to_id: Readonly<Record<string, number>> | null;
}

interface LanguageState {
  language: string | null;
  attempts: number;
}

interface ActiveSession {
  readonly id: number;
  readonly engine: LiveTranscriptEngine;
  resampler: StreamingResampler | null;
}

function post(event: LiveTranscriptionEvent): void {
  self.postMessage(event, { transfer: [] });
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

async function hasWebGpuAdapter(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) {
    return false;
  }
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

// The runtime is bundled next to the app: the desktop CSP forbids remote and blob: modules, and
// transformers.js would otherwise fetch it from a CDN.
async function configureRuntime(transformers: Transformers): Promise<void> {
  const [{ default: factoryUrl }, { default: binaryUrl }] = await Promise.all([
    import("onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url"),
    import("onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url"),
  ]);
  const { env } = transformers;
  env.allowLocalModels = false;
  env.useWasmCache = false;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = {
      mjs: new URL(factoryUrl, self.location.href).href,
      wasm: new URL(binaryUrl, self.location.href).href,
    };
    // Threads need cross-origin isolation, which the app does not enable.
    wasm.numThreads = 1;
  }
}

async function warmUp(speech: SpeechPipeline): Promise<void> {
  await speech(new Float32Array(LIVE_TRANSCRIPTION_SAMPLE_RATE_HZ), {
    language: "en",
    task: "transcribe",
    return_timestamps: true,
    max_new_tokens: 2,
  });
}

async function loadModel(): Promise<LoadedModel | null> {
  let transformers: Transformers;
  try {
    transformers = await import("@huggingface/transformers");
    await configureRuntime(transformers);
  } catch (error) {
    post({ type: "unavailable", reason: describeError(error) });
    return null;
  }

  const devices: ReadonlyArray<LiveTranscriptionDevice> = (await hasWebGpuAdapter())
    ? ["webgpu", "wasm"]
    : ["wasm"];
  let lastError: unknown;
  for (const device of devices) {
    post({ type: "loading", device });
    let speech: SpeechPipeline | null = null;
    try {
      speech = await createSpeechPipeline(transformers, device);
      await warmUp(speech);
      post({ type: "ready", device });
      return { speech };
    } catch (error) {
      lastError = error;
      console.warn(`Live transcription could not start on ${device}.`, error);
      await speech?.dispose().catch(() => undefined);
    }
  }
  post({ type: "unavailable", reason: describeError(lastError) });
  return null;
}

let loadedModel: Promise<LoadedModel | null> | null = null;

function ensureModel(): Promise<LoadedModel | null> {
  loadedModel ??= loadModel();
  return loadedModel;
}

async function detectLanguage(speech: SpeechPipeline, audio: Float32Array): Promise<string | null> {
  const config = speech.model.generation_config as WhisperGenerationConfig | null;
  const languageIds = config?.lang_to_id;
  if (!config || !languageIds) {
    return null;
  }
  const { input_features: features } = await speech.processor(audio);
  // transformers.js falls back to English without a language, so the model is asked for it:
  // one decoder step after the start token yields the language token.
  const output = (await speech.model.generate({
    inputs: features,
    decoder_input_ids: [config.decoder_start_token_id],
    max_new_tokens: 1,
  })) as unknown as { tolist: () => ReadonlyArray<ReadonlyArray<number | bigint>> };
  const token = Number(output.tolist()[0]?.at(-1));
  for (const [name, id] of Object.entries(languageIds)) {
    if (id === token) {
      return name.replace(/^<\||\|>$/g, "");
    }
  }
  return null;
}

function fallbackLanguage(speech: SpeechPipeline): string {
  const config = speech.model.generation_config as WhisperGenerationConfig | null;
  const code = navigator.language.split("-")[0]?.toLowerCase() ?? "en";
  return config?.lang_to_id?.[`<|${code}|>`] === undefined ? "en" : code;
}

async function resolveLanguage(
  speech: SpeechPipeline,
  state: LanguageState,
  audio: Float32Array,
): Promise<string | null> {
  if (state.language) {
    return state.language;
  }
  state.attempts += 1;
  state.language = await detectLanguage(speech, audio);
  if (!state.language && state.attempts >= MAX_DETECTION_ATTEMPTS) {
    state.language = fallbackLanguage(speech);
  }
  return state.language;
}

async function transcribeWindow(
  state: LanguageState,
  audio: Float32Array,
): Promise<WindowTranscription | null> {
  const model = await ensureModel();
  if (!model) {
    return null;
  }
  const language = await resolveLanguage(model.speech, state, audio);
  if (!language) {
    return null;
  }
  const result = await model.speech(audio, {
    language,
    task: "transcribe",
    return_timestamps: true,
    max_new_tokens: MAX_NEW_TOKENS,
  });
  return {
    text: result.text,
    segments: (result.chunks ?? []).map((chunk) => {
      const endSec: number | null | undefined = chunk.timestamp[1];
      return { text: chunk.text, endSec: typeof endSec === "number" ? endSec : null };
    }),
  };
}

let active: ActiveSession | null = null;

function beginSession(id: number): void {
  active?.engine.close();
  const language: LanguageState = { language: null, attempts: 0 };
  active = {
    id,
    resampler: null,
    engine: new LiveTranscriptEngine({
      transcribe: (audio) => transcribeWindow(language, audio),
      onText: (text) => post({ type: "text", session: id, text }),
      onFailure: (error) => {
        console.warn("Live transcription stopped.", error);
        post({ type: "unavailable", reason: describeError(error) });
      },
    }),
  };
  void ensureModel();
}

self.addEventListener("message", (event: MessageEvent<LiveTranscriptionRequest>) => {
  const message = event.data;
  switch (message.type) {
    case "load":
      void ensureModel();
      return;
    case "begin":
      beginSession(message.session);
      return;
    case "audio": {
      if (active?.id !== message.session) {
        return;
      }
      active.resampler ??= new StreamingResampler(message.sampleRateHz);
      active.engine.push(active.resampler.process(message.samples));
      return;
    }
    case "end": {
      const session = active;
      if (session?.id !== message.session) {
        return;
      }
      active = null;
      void session.engine
        .finish()
        .then((text) => post({ type: "final", session: session.id, text }));
      return;
    }
    case "abort":
      if (active?.id === message.session) {
        active.engine.close();
        active = null;
      }
      return;
  }
});
