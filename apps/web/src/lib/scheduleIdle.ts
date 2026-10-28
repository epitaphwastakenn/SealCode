const IDLE_TIMEOUT_MS = 1000;
const FALLBACK_DELAY_MS = 50;

/** Runs `run` once the page has painted and gone quiet, or after a second at the latest. */
export function scheduleIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, FALLBACK_DELAY_MS);
  return () => window.clearTimeout(handle);
}
