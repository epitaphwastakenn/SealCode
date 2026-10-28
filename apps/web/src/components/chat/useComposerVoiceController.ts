import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { startBrowserSpeechRecognition } from "../../lib/browserSpeechRecognition";
import {
  startLiveTranscription,
  type LiveTranscriptionSession,
} from "../../lib/liveTranscription/client";
import { chooseVoiceTranscript } from "../../lib/liveTranscription/transcript";
import {
  describeVoiceRecordingStartError,
  formatVoiceRecordingDuration,
  isVoiceRecordingCancelledError,
  useVoiceRecorder,
  type VoiceRecordingPayload,
} from "../../lib/voiceRecorder";
import { toastManager } from "../ui/toast";

export interface UseComposerVoiceControllerOptions {
  disabled?: boolean;
  /** Show on-device words dimmed while recording. Downloads a speech model on first use. */
  livePreviewEnabled: boolean;
  pendingUserInputCount: number;
  transcribeRecording: (payload: VoiceRecordingPayload) => Promise<string>;
  onTranscriptReady: (transcript: string) => void;
}

function describeTranscriptionError(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The voice note could not be transcribed.";
}

function startVoicePreview(onText: (text: string) => void): LiveTranscriptionSession | null {
  return startLiveTranscription({
    onText,
    onModelDownload: () => {
      toastManager.add({
        type: "info",
        title: "Downloading the live transcription model",
        description:
          "About 200 MB, once. Recording works meanwhile; the preview starts when it is ready.",
      });
    },
  });
}

/** Outside the hook: the React Compiler skips any hook with a try/finally. */
async function transcribeVoiceNote(input: {
  stopRecording: () => Promise<VoiceRecordingPayload | null>;
  speechSession: ReturnType<typeof startBrowserSpeechRecognition>;
  previewSession: LiveTranscriptionSession | null;
  transcribeRecording: (payload: VoiceRecordingPayload) => Promise<string>;
  onTranscriptReady: (transcript: string) => void;
  isCurrent: () => boolean;
}) {
  const { previewSession } = input;
  try {
    const [payload, browserTranscript] = await Promise.all([
      input.stopRecording(),
      input.speechSession?.stop() ?? Promise.resolve(""),
    ]);
    if (!input.isCurrent()) {
      previewSession?.abort();
      return;
    }

    const localTranscript = browserTranscript.trim();
    if (localTranscript.length > 0) {
      previewSession?.abort();
      input.onTranscriptReady(localTranscript);
      return;
    }
    if (!payload) {
      previewSession?.abort();
      toastManager.add({
        type: "warning",
        title: "No audio was captured.",
      });
      return;
    }

    // The preview finishes its last pass while the server works; the server answer wins.
    const previewTranscript = previewSession?.finish() ?? Promise.resolve("");
    const server = await input.transcribeRecording(payload).then(
      (text) => ({ ok: true as const, text }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (server.ok) {
      previewSession?.abort();
    }
    const choice = chooseVoiceTranscript(server, server.ok ? "" : await previewTranscript);
    if (!input.isCurrent()) {
      return;
    }

    if (choice.source === "server") {
      input.onTranscriptReady(choice.text);
      return;
    }
    if (choice.source === "local-preview") {
      toastManager.add({
        type: "warning",
        title: "Used the live preview text",
        description: `${describeTranscriptionError(choice.serverError)} The words below come from on-device recognition and may be less accurate.`,
      });
      input.onTranscriptReady(choice.text);
      return;
    }
    if (choice.serverError !== undefined) {
      throw choice.serverError;
    }
    toastManager.add({
      type: "warning",
      title: "No speech was recognized.",
    });
  } catch (error) {
    previewSession?.abort();
    if (!input.isCurrent()) {
      return;
    }
    toastManager.add({
      type: "error",
      title: "Voice transcription failed",
      description: describeTranscriptionError(error),
    });
  }
}

export function useComposerVoiceController(options: UseComposerVoiceControllerOptions) {
  const {
    isRecording,
    durationMs,
    waveformLevels,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const requestIdRef = useRef(0);
  const speechSessionRef = useRef<ReturnType<typeof startBrowserSpeechRecognition>>(null);
  const previewSessionRef = useRef<LiveTranscriptionSession | null>(null);
  const disabledRef = useRef(options.disabled === true);
  // Written in an effect: a ref write during render keeps the React Compiler
  // from memoizing this hook, and with it the composer that renders per token.
  useLayoutEffect(() => {
    disabledRef.current = options.disabled === true;
  });
  const { livePreviewEnabled, onTranscriptReady, transcribeRecording } = options;

  const durationLabel = formatVoiceRecordingDuration(durationMs);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      speechSessionRef.current?.abort();
      speechSessionRef.current = null;
      previewSessionRef.current?.abort();
      previewSessionRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!options.disabled || (!isRecording && !isTranscribing)) {
      return;
    }
    requestIdRef.current += 1;
    speechSessionRef.current?.abort();
    speechSessionRef.current = null;
    previewSessionRef.current?.abort();
    previewSessionRef.current = null;
    void cancelRecording().finally(() => {
      setIsTranscribing(false);
      setPreviewText("");
    });
  }, [cancelRecording, isRecording, isTranscribing, options.disabled]);

  const startComposerVoiceRecording = async () => {
    if (options.disabled || isRecording || isTranscribing) {
      return;
    }
    if (options.pendingUserInputCount > 0) {
      toastManager.add({
        type: "error",
        title: "Answer plan questions before recording a voice note.",
      });
      return;
    }

    try {
      await startRecording({
        onAudioChunk: (samples, sampleRateHz) => {
          previewSessionRef.current?.pushAudio(samples, sampleRateHz);
        },
      });
      speechSessionRef.current = startBrowserSpeechRecognition();
      setPreviewText("");
      previewSessionRef.current = livePreviewEnabled ? startVoicePreview(setPreviewText) : null;
    } catch (error) {
      if (isVoiceRecordingCancelledError(error)) {
        return;
      }
      toastManager.add({
        type: "error",
        title: "Could not start recording",
        description: describeVoiceRecordingStartError(error),
      });
    }
  };

  const submitComposerVoiceRecording = async () => {
    if (!isRecording) {
      return;
    }

    setIsTranscribing(true);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const speechSession = speechSessionRef.current;
    speechSessionRef.current = null;
    const previewSession = previewSessionRef.current;
    previewSessionRef.current = null;

    await transcribeVoiceNote({
      stopRecording,
      speechSession,
      previewSession,
      transcribeRecording,
      onTranscriptReady,
      isCurrent: () => requestIdRef.current === requestId && !disabledRef.current,
    }).finally(() => {
      if (requestIdRef.current === requestId) {
        setIsTranscribing(false);
        setPreviewText("");
      }
    });
  };

  const cancelComposerVoiceRecording = () => {
    requestIdRef.current += 1;
    speechSessionRef.current?.abort();
    speechSessionRef.current = null;
    previewSessionRef.current?.abort();
    previewSessionRef.current = null;
    setPreviewText("");
    setIsTranscribing(false);
    void cancelRecording();
  };

  const toggleComposerVoiceRecording = () => {
    if (isTranscribing) {
      return;
    }
    if (isRecording) {
      void submitComposerVoiceRecording();
      return;
    }
    void startComposerVoiceRecording();
  };

  return {
    isVoiceRecording: isRecording,
    isVoiceTranscribing: isTranscribing,
    voiceWaveformLevels: waveformLevels,
    voiceRecordingDurationLabel: durationLabel,
    voicePreviewText: previewText,
    startComposerVoiceRecording,
    submitComposerVoiceRecording,
    cancelComposerVoiceRecording,
    toggleComposerVoiceRecording,
  };
}
