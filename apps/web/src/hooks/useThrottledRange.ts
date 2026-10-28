import { useEffect, useState } from "react";

import { ThrottledValue } from "../lib/throttledValue";
import { useStableCallback } from "./useStableCallback";

const RANGE_COMMIT_INTERVAL_MS = 100;

/**
 * A range input over a setting that restyles the whole page. The thumb follows the pointer at
 * once; the setting is committed (applied and persisted) about ten times a second while
 * dragging, and finally when the drag, key press or focus ends.
 */
export function useThrottledRange(committed: number, commit: (value: number) => void) {
  const [draft, setDraft] = useState<number | null>(null);
  const commitNow = useStableCallback(commit);
  const [throttle] = useState(
    () => new ThrottledValue<number>((value) => commitNow(value), RANGE_COMMIT_INTERVAL_MS),
  );
  // oxlint-disable-next-line t3code/react-effect-budget -- Unmounting mid-drag still owes the throttle's last value to the setting.
  useEffect(() => () => throttle.flush(), [throttle]);

  return {
    value: draft ?? committed,
    onChange: (value: number) => {
      setDraft(value);
      throttle.push(value);
    },
    onFinish: () => {
      throttle.flush();
      setDraft(null);
    },
  } as const;
}
