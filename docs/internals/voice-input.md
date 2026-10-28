# Voice input

Transcription edits a composer draft. It does not submit an agent turn. Audio is
temporary client input, and only normal message submission sends the resulting
text. The web and desktop
composer send a short WAV clip to the environment, which forwards it to a
speech-to-text API (`voice.transcribe`; see [Speech to text](../user/speech-to-text.md)).

The [shared controller](../../packages/client-runtime/src/voice-input/controller.ts)
owns the operation while the client supplies capture and transcription. Preparation
binds the transcriber and resolved locale for the whole recording. Draft ownership,
text, and revision are captured before recording and checked before insertion, so
a late transcript cannot overwrite a draft that was edited or replaced.

Cancellation invalidates a result immediately, but resources stay owned until the
underlying work settles. Apple's native transcription call cannot be interrupted
once started. Releasing the session or deleting its recording when the abort signal
fires would race that work. The [transcription contract](../../packages/client-runtime/src/voice-input/transcription.ts)
therefore requires implementations to settle only after their work has stopped;
the [Apple binding](../../apps/mobile/src/native/voiceTranscription.ios.ts) checks
cancellation between native calls and discards late results.

## Live preview

The dimmed words while recording come from Whisper running in a [web worker](../../apps/web/src/lib/liveTranscription/liveTranscription.worker.ts),
never from the server, and they are not the transcript: the server answer replaces them, and they
only stand in when the server fails. Three constraints shape it:

- The ONNX runtime is bundled with the app. The desktop CSP allows neither CDN scripts nor `blob:`
  modules, so `env.useWasmCache` stays off and `wasmPaths` points at the emitted assets.
- The app is not cross-origin isolated, so the WASM fallback is single-threaded. Enabling COOP/COEP
  would block the cross-origin images and frames the app embeds.
- transformers.js has no language detection and silently decodes multilingual Whisper as English.
  The worker asks the model for the language token itself and keeps it for the recording.
