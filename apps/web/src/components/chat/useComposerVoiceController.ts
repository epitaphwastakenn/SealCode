import { useCallback, useEffect, useRef, useState } from "react";

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
  disabledRef.current = options.disabled === true;

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

  const startComposerVoiceRecording = useCallback(async () => {
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
  }, [
    isRecording,
    isTranscribing,
    options.disabled,
    options.pendingUserInputCount,
    startRecording,
  ]);

  const submitComposerVoiceRecording = useCallback(async () => {
    if (!isRecording) {
      return;
    }

    setIsTranscribing(true);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const speechSession = speechSessionRef.current;
    speechSessionRef.current = null;

    try {
      const [payload, browserTranscript] = await Promise.all([
        stopRecording(),
        speechSession?.stop() ?? Promise.resolve(""),
      ]);
      if (requestIdRef.current !== requestId || disabledRef.current) {
        return;
      }

      const localTranscript = browserTranscript.trim();
      if (localTranscript.length > 0) {
        options.onTranscriptReady(localTranscript);
        return;
      }
      if (!payload) {
        toastManager.add({
          type: "warning",
          title: "No audio was captured.",
        });
        return;
      }

      const transcript = (await options.transcribeRecording(payload)).trim();
      if (requestIdRef.current !== requestId || disabledRef.current) {
        return;
      }
      if (transcript.length === 0) {
        toastManager.add({
          type: "warning",
          title: "No speech was recognized.",
        });
        return;
      }
      options.onTranscriptReady(transcript);
    } catch (error) {
      if (requestIdRef.current !== requestId || disabledRef.current) {
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
    } finally {
      if (requestIdRef.current === requestId) {
        setIsTranscribing(false);
      }
    }
  }, [isRecording, options, stopRecording]);

  const cancelComposerVoiceRecording = useCallback(() => {
    requestIdRef.current += 1;
    speechSessionRef.current?.abort();
    speechSessionRef.current = null;
    setIsTranscribing(false);
    void cancelRecording();
  }, [cancelRecording]);

  const toggleComposerVoiceRecording = useCallback(() => {
    if (isTranscribing) {
      return;
    }
    if (isRecording) {
      void submitComposerVoiceRecording();
      return;
    }
    void startComposerVoiceRecording();
  }, [isRecording, isTranscribing, startComposerVoiceRecording, submitComposerVoiceRecording]);

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
