export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether interface motion may run, for code outside React (the theme reveal).
 * MotionAppearanceSync mirrors the Motion setting onto the root element.
 */
export function isInterfaceMotionActive(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.dataset.uiMotion !== "on") return false;
  return (
    typeof window.matchMedia !== "function" || !window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}
