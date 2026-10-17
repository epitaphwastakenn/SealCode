import { describe, expect, it } from "vite-plus/test";

import { isBrowserSpeechRecognitionAvailable } from "./browserSpeechRecognition";

describe("isBrowserSpeechRecognitionAvailable", () => {
  it("is false when the browser has no speech recognition API", () => {
    expect(isBrowserSpeechRecognitionAvailable()).toBe(false);
  });
});
