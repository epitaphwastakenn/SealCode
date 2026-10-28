export type LiveTranscriptionDevice = "webgpu" | "wasm";

export type LiveTranscriptionRequest =
  | { readonly type: "load" }
  | { readonly type: "begin"; readonly session: number }
  | {
      readonly type: "audio";
      readonly session: number;
      readonly samples: Float32Array;
      readonly sampleRateHz: number;
    }
  | { readonly type: "end"; readonly session: number }
  | { readonly type: "abort"; readonly session: number };

export type LiveTranscriptionEvent =
  | { readonly type: "loading"; readonly device: LiveTranscriptionDevice }
  | { readonly type: "ready"; readonly device: LiveTranscriptionDevice }
  | { readonly type: "unavailable"; readonly reason: string }
  | { readonly type: "text"; readonly session: number; readonly text: string }
  | { readonly type: "final"; readonly session: number; readonly text: string };
