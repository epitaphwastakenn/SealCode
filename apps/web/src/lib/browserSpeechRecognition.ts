interface BrowserSpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0?: { readonly transcript?: string };
}

interface BrowserSpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<BrowserSpeechRecognitionResultLike>;
}

interface BrowserSpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognitionLike;

export function getBrowserSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const speechWindow = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function isBrowserSpeechRecognitionAvailable(): boolean {
  return getBrowserSpeechRecognitionConstructor() !== null;
}

export interface BrowserSpeechRecognitionSession {
  stop(): Promise<string>;
  abort(): void;
}

export function startBrowserSpeechRecognition(): BrowserSpeechRecognitionSession | null {
  const Recognition = getBrowserSpeechRecognitionConstructor();
  if (!Recognition) {
    return null;
  }

  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = typeof navigator === "undefined" ? "en-US" : (navigator.language || "en-US");

  let finalTranscript = "";
  let ended = false;
  const endWaiters: Array<(text: string) => void> = [];

  const finish = () => {
    if (ended) {
      return;
    }
    ended = true;
    const text = finalTranscript.trim();
    for (const waiter of endWaiters) {
      waiter(text);
    }
    endWaiters.length = 0;
  };

  recognition.onresult = (event) => {
    let nextFinal = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result?.isFinal) {
        continue;
      }
      nextFinal += result[0]?.transcript ?? "";
    }
    if (nextFinal.trim().length > 0) {
      finalTranscript = `${finalTranscript} ${nextFinal}`.trim();
    }
  };
  recognition.onerror = () => {
    finish();
  };
  recognition.onend = () => {
    finish();
  };

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    stop: () =>
      new Promise((resolve) => {
        if (ended) {
          resolve(finalTranscript.trim());
          return;
        }
        endWaiters.push(resolve);
        try {
          recognition.stop();
        } catch {
          finish();
        }
        window.setTimeout(finish, 1_500);
      }),
    abort: () => {
      try {
        recognition.abort();
      } catch {
        finish();
      }
    },
  };
}
