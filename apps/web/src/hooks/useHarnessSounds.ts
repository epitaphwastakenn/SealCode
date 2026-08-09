import { useEffect, useRef } from "react";

import {
  HARNESS_SOUND_URLS,
  resolveHarnessSoundEvent,
  type HarnessSoundSnapshot,
} from "../harnessSounds";

export function useHarnessSounds(snapshot: HarnessSoundSnapshot, volume: number): void {
  const previousRef = useRef<HarnessSoundSnapshot | null>(null);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = snapshot;
    if (previous === null || volume === 0) return;

    const event = resolveHarnessSoundEvent(previous, snapshot);
    if (event === null) return;

    const audio = new Audio(HARNESS_SOUND_URLS[event]);
    audio.volume = volume / 100;
    void audio.play().catch((error: unknown) => {
      console.debug(`[SealCode] Could not play ${event} harness sound.`, error);
    });
  }, [snapshot, volume]);
}
