import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { startBrowserSpeechRecognition } from "../../lib/browserSpeechRecognition";
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
  pendingUserInputCount: number;
  transcribeRecording: (payload: VoiceRecordingPayload) => Promise<string>;
  onTranscriptReady: (transcript: string) => void;
}

/** Outside the hook: the React Compiler skips any hook with a try/finally. */
async function transcribeVoiceNote(input: {
  stopRecording: () => Promise<VoiceRecordingPayload | null>;
  speechSession: ReturnType<typeof startBrowserSpeechRecognition>;
  transcribeRecording: (payload: VoiceRecordingPayload) => Promise<string>;
  onTranscriptReady: (transcript: string) => void;
  isCurrent: () => boolean;
}) {
  try {
    const [payload, browserTranscript] = await Promise.all([
      input.stopRecording(),
      input.speechSession?.stop() ?? Promise.resolve(""),
    ]);
    if (!input.isCurrent()) {
      return;
    }

    const localTranscript = browserTranscript.trim();
    if (localTranscript.length > 0) {
      input.onTranscriptReady(localTranscript);
      return;
    }
    if (!payload) {
      toastManager.add({
        type: "warning",
        title: "No audio was captured.",
      });
      return;
    }

    const transcript = (await input.transcribeRecording(payload)).trim();
    if (!input.isCurrent()) {
      return;
    }
    if (transcript.length === 0) {
      toastManager.add({
        type: "warning",
        title: "No speech was recognized.",
      });
      return;
    }
    input.onTranscriptReady(transcript);
  } catch (error) {
    if (!input.isCurrent()) {
      return;
    }
    toastManager.add({
      type: "error",
      title: "Voice transcription failed",
      description:
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "The voice note could not be transcribed.",
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
  const requestIdRef = useRef(0);
  const speechSessionRef = useRef<ReturnType<typeof startBrowserSpeechRecognition>>(null);
  const disabledRef = useRef(options.disabled === true);
  // Written in an effect: a ref write during render keeps the React Compiler
  // from memoizing this hook, and with it the composer that renders per token.
  useLayoutEffect(() => {
    disabledRef.current = options.disabled === true;
  });
  const { onTranscriptReady, transcribeRecording } = options;

  const durationLabel = formatVoiceRecordingDuration(durationMs);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      speechSessionRef.current?.abort();
      speechSessionRef.current = null;
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
    void cancelRecording().finally(() => {
      setIsTranscribing(false);
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
      await startRecording();
      speechSessionRef.current = startBrowserSpeechRecognition();
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

    await transcribeVoiceNote({
      stopRecording,
      speechSession,
      transcribeRecording,
      onTranscriptReady,
      isCurrent: () => requestIdRef.current === requestId && !disabledRef.current,
    }).finally(() => {
      if (requestIdRef.current === requestId) {
        setIsTranscribing(false);
      }
    });
  };

  const cancelComposerVoiceRecording = () => {
    requestIdRef.current += 1;
    speechSessionRef.current?.abort();
    speechSessionRef.current = null;
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
    startComposerVoiceRecording,
    submitComposerVoiceRecording,
    cancelComposerVoiceRecording,
    toggleComposerVoiceRecording,
  };
}
