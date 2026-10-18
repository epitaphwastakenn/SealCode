import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type PanelAnimationDurationMs } from "@t3tools/contracts/settings";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useClientSettings } from "./hooks/useSettings";
import { useStableCallback } from "./hooks/useStableCallback";
import { REDUCED_MOTION_QUERY } from "./motionPreference";

/**
 * Navigation, tab and popup motion. It only animates opacity, transform and clip, so
 * unlike panel resizing no frame does layout work, and it is on unless the Motion
 * setting or the system's reduced motion turns it off.
 */
export function useInterfaceMotion(): { active: boolean; durationMs: number } {
  const enabled = useClientSettings((settings) => settings.interfaceAnimationsEnabled);
  const prefersReducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  return { active: enabled && !prefersReducedMotion, durationMs: INTERFACE_MOTION_DURATION_MS };
}

const INTERFACE_MOTION_DURATION_MS = 200;
// Decelerates hard so the element is nearly settled after the first third.
const INTERFACE_MOTION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export type EnterMotion = "fade" | "settle" | "rise" | "slide-start" | "slide-end" | "reveal-end";

const ENTER_KEYFRAMES: Record<EnterMotion, Keyframe[]> = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  // For content that replaces other content in place: starting from nothing would
  // flash the window background between the two.
  settle: [{ opacity: 0.4 }, { opacity: 1 }],
  rise: [
    { opacity: 0, transform: "translateY(6px)" },
    { opacity: 1, transform: "translateY(0)" },
  ],
  "slide-start": [
    { opacity: 0, transform: "translateX(-10px)" },
    { opacity: 1, transform: "translateX(0)" },
  ],
  "slide-end": [
    { opacity: 0, transform: "translateX(10px)" },
    { opacity: 1, transform: "translateX(0)" },
  ],
  // Browser panels position a native view from getBoundingClientRect, which a
  // transform would skew mid-flight; a clip reveals the same way without moving it.
  "reveal-end": [
    { opacity: 0, clipPath: "inset(0 0 0 14%)" },
    { opacity: 1, clipPath: "inset(0 0 0 0)" },
  ],
};

const UNSET_MOTION_KEY = Symbol("unset");
// The first screen after launch paints without motion; later navigations animate in.
let firstScreen: "pending" | "painting" | "shown" = "pending";

function isPastFirstScreen(): boolean {
  if (firstScreen === "pending") {
    firstScreen = "painting";
    // Flipped after the frame, so every hook in the first commit sees it unset.
    const markShown = () => {
      firstScreen = "shown";
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(markShown);
    else markShown();
    return false;
  }
  return firstScreen === "shown";
}

/**
 * Plays a one-shot enter animation on `ref` whenever `motionKey` changes, without
 * remounting anything. The first key animates only with `onMount`; `"navigation"`
 * skips the app's first screen. A change while `when` is false is recorded but
 * not animated, so closing something does not replay its entrance.
 */
export function useEnterMotion(
  ref: { readonly current: HTMLElement | null },
  motionKey: unknown,
  motion: EnterMotion,
  {
    onMount = false,
    when = true,
    durationScale = 1,
  }: { onMount?: boolean | "navigation"; when?: boolean; durationScale?: number } = {},
): void {
  const { active, durationMs } = useInterfaceMotion();
  const lastKeyRef = useRef<unknown>(UNSET_MOTION_KEY);
  const runningRef = useRef<Animation | null>(null);
  const play = useStableCallback(() => {
    const element = ref.current;
    if (!element || typeof element.animate !== "function") return;
    runningRef.current?.cancel();
    runningRef.current = element.animate(ENTER_KEYFRAMES[motion], {
      duration: durationMs * durationScale,
      easing: INTERFACE_MOTION_EASING,
    });
  });

  useLayoutEffect(() => {
    // Compared rather than cleaned up, so StrictMode's second run neither replays
    // the animation nor cancels the one already in flight.
    if (lastKeyRef.current === motionKey) return;
    const initial = lastKeyRef.current === UNSET_MOTION_KEY;
    lastKeyRef.current = motionKey;
    if (!active) return;
    const afterFirstScreen = isPastFirstScreen();
    if (!when) return;
    if (initial && !(onMount === true || (onMount === "navigation" && afterFirstScreen))) return;
    play();
  }, [active, motionKey, onMount, play, when]);
}

const PanelAnimationSuppressionContext = createContext(false);

export const PanelAnimationSuppressionProvider = PanelAnimationSuppressionContext.Provider;

/** True while a navigation settles, when panels take their new state without motion. */
export function usePanelNavigationSuppressed(): boolean {
  return useContext(PanelAnimationSuppressionContext);
}

export function usePanelNavigationSuppression(navigationKey: string): boolean {
  const [paintedNavigationKey, setPaintedNavigationKey] = useState<string | null>(null);
  const suppressed = paintedNavigationKey !== navigationKey;

  useEffect(() => {
    if (!suppressed) return;
    let releaseFrame = 0;
    const paintFrame = window.requestAnimationFrame(() => {
      releaseFrame = window.requestAnimationFrame(() => setPaintedNavigationKey(navigationKey));
    });
    return () => {
      window.cancelAnimationFrame(paintFrame);
      window.cancelAnimationFrame(releaseFrame);
    };
  }, [navigationKey, suppressed]);

  return suppressed;
}

export function usePanelAnimationSettings(): {
  active: boolean;
  durationMs: PanelAnimationDurationMs;
} {
  const durationMs = useClientSettings((settings) => settings.panelAnimationDurationMs);
  const prefersReducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const suppressed = useContext(PanelAnimationSuppressionContext);
  return { active: durationMs > 0 && !prefersReducedMotion && !suppressed, durationMs };
}

export function usePanelPresence<T>(
  open: boolean,
  value: T | null,
  animated: boolean,
  scopeKey: string | null,
  durationMs: PanelAnimationDurationMs,
): { present: boolean; value: T | null } {
  const [present, setPresent] = useState(open);
  const [retained, setRetained] = useState<{ scopeKey: string | null; value: T | null } | null>(
    open ? { scopeKey, value } : null,
  );
  if (open && (retained?.scopeKey !== scopeKey || retained.value !== value)) {
    setRetained({ scopeKey, value });
  }

  if (open && !present) setPresent(true);
  if (!open && !animated && present) setPresent(false);

  useEffect(() => {
    if (open || !animated) return;
    const timeout = window.setTimeout(() => setPresent(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [animated, durationMs, open]);

  const retainedValue = retained?.scopeKey === scopeKey ? retained.value : null;
  const visible = open || (animated && present && retained?.scopeKey === scopeKey);
  return { present: visible, value: open ? value : visible ? retainedValue : null };
}
