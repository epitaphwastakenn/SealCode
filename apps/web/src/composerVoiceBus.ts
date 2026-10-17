const COMPOSER_VOICE_TOGGLE_EVENT = "sealcode:toggle-composer-voice";

export function toggleComposerVoice(): void {
  window.dispatchEvent(new Event(COMPOSER_VOICE_TOGGLE_EVENT));
}

export function onToggleComposerVoice(listener: () => void): () => void {
  window.addEventListener(COMPOSER_VOICE_TOGGLE_EVENT, listener);
  return () => window.removeEventListener(COMPOSER_VOICE_TOGGLE_EVENT, listener);
}
