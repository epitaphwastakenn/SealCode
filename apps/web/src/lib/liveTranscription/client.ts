import type { LiveTranscriptionEvent, LiveTranscriptionRequest } from "./protocol";

// The speech model holds hundreds of MB of GPU and heap memory, so an unused worker goes away.
const IDLE_TERMINATE_MS = 5 * 60_000;
const FINISH_TIMEOUT_MS = 8_000;
const MODEL_CACHED_KEY = "harp:live-transcription-model-cached";

export interface LiveTranscriptionHandlers {
  /** The latest full guess for what was said so far. */
  readonly onText: (text: string) => void;
  /** The speech model is loading for the first time on this device, which downloads it. */
  readonly onModelDownload: () => void;
}

export interface LiveTranscriptionSession {
  pushAudio: (samples: Float32Array, sampleRateHz: number) => void;
  /** Waits for the last pass and resolves the final local text; never rejects. */
  finish: () => Promise<string>;
  abort: () => void;
}

interface SessionRecord {
  readonly handlers: LiveTranscriptionHandlers;
  lastText: string;
  settle: ((text: string) => void) | null;
}

let worker: Worker | null = null;
let idleTimer: number | null = null;
let nextSessionId = 0;
let downloadAnnounced = false;
const sessions = new Map<number, SessionRecord>();

function readModelCached(): boolean {
  try {
    return window.localStorage.getItem(MODEL_CACHED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeModelCached(): void {
  try {
    window.localStorage.setItem(MODEL_CACHED_KEY, "1");
  } catch {
    // Without storage the hint can repeat; nothing else depends on it.
  }
}

function send(message: LiveTranscriptionRequest): void {
  worker?.postMessage(message, { transfer: [] });
}

function cancelIdleTermination(): void {
  if (idleTimer !== null) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function terminateWorker(): void {
  cancelIdleTermination();
  worker?.terminate();
  worker = null;
}

function scheduleIdleTermination(): void {
  cancelIdleTermination();
  if (worker && sessions.size === 0) {
    idleTimer = window.setTimeout(terminateWorker, IDLE_TERMINATE_MS);
  }
}

function failAllSessions(): void {
  const failed = [...sessions.values()];
  sessions.clear();
  terminateWorker();
  for (const record of failed) {
    record.settle?.(record.lastText);
  }
}

function handleEvent(event: MessageEvent<LiveTranscriptionEvent>): void {
  const message = event.data;
  switch (message.type) {
    case "loading": {
      if (!downloadAnnounced && !readModelCached()) {
        downloadAnnounced = true;
        for (const record of sessions.values()) {
          record.handlers.onModelDownload();
        }
      }
      return;
    }
    case "ready":
      writeModelCached();
      return;
    case "unavailable":
      failAllSessions();
      return;
    case "text": {
      const record = sessions.get(message.session);
      if (record) {
        record.lastText = message.text;
        record.handlers.onText(message.text);
      }
      return;
    }
    case "final": {
      const record = sessions.get(message.session);
      if (record) {
        record.lastText = message.text;
        record.handlers.onText(message.text);
        record.settle?.(message.text);
      }
      return;
    }
  }
}

function ensureWorker(): Worker | null {
  if (worker) {
    return worker;
  }
  if (typeof Worker === "undefined") {
    return null;
  }
  try {
    const next = new Worker(new URL("./liveTranscription.worker.ts", import.meta.url), {
      type: "module",
    });
    next.addEventListener("message", handleEvent);
    next.addEventListener("error", failAllSessions);
    worker = next;
    return next;
  } catch {
    return null;
  }
}

export function startLiveTranscription(
  handlers: LiveTranscriptionHandlers,
): LiveTranscriptionSession | null {
  if (!ensureWorker()) {
    return null;
  }
  cancelIdleTermination();
  nextSessionId += 1;
  const id = nextSessionId;
  const record: SessionRecord = { handlers, lastText: "", settle: null };
  sessions.set(id, record);
  send({ type: "begin", session: id });

  const release = () => {
    sessions.delete(id);
    scheduleIdleTermination();
  };

  return {
    pushAudio: (samples, sampleRateHz) => {
      if (sessions.has(id)) {
        send({ type: "audio", session: id, samples, sampleRateHz });
      }
    },
    finish: () =>
      new Promise<string>((resolve) => {
        if (!sessions.has(id)) {
          resolve(record.lastText);
          return;
        }
        const timer = window.setTimeout(() => record.settle?.(record.lastText), FINISH_TIMEOUT_MS);
        record.settle = (text) => {
          record.settle = null;
          window.clearTimeout(timer);
          release();
          resolve(text);
        };
        send({ type: "end", session: id });
      }),
    abort: () => {
      if (!sessions.has(id)) {
        return;
      }
      send({ type: "abort", session: id });
      if (record.settle) {
        record.settle(record.lastText);
      } else {
        release();
      }
    },
  };
}
