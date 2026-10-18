import { isInterfaceMotionActive } from "./motionPreference";

/**
 * A theme change revealed as two slanted curtains parting from where it was
 * picked, each edge carrying a thin seam of the new theme's primary color.
 *
 * The View Transitions API keeps a snapshot of the old colors
 * (`::view-transition-old(root)`) over the live page. A two-layer mask opens a
 * gap in that snapshot at the pointer and widens it until the old colors are
 * gone. The seams live in their own named transition element above the
 * snapshot, and only their transforms animate. Everything runs once and stops.
 */

const REVEAL_DURATION_MS = 620;
const REVEAL_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
/** Width of each curtain's soft edge. */
const FEATHER_PX = 80;
/** Width of the colored seam riding each edge. */
const SEAM_WIDTH_PX = 150;
/** How far the curtain edges lean off vertical. */
const TILT_DEG = 14;
/** A pointer press older than this is not what picked the theme (a shortcut or the system did). */
const POINTER_ORIGIN_MAX_AGE_MS = 1500;
const SEAM_ELEMENT_ID = "theme-reveal-seam";

interface Point {
  readonly x: number;
  readonly y: number;
}

let lastPointer: (Point & { readonly at: number }) | null = null;
let activeRevealId = 0;

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener(
    "pointerdown",
    (event) => {
      lastPointer = { x: event.clientX, y: event.clientY, at: performance.now() };
    },
    { capture: true, passive: true },
  );
}

function revealOrigin(): Point {
  if (lastPointer && performance.now() - lastPointer.at <= POINTER_ORIGIN_MAX_AGE_MS) {
    return lastPointer;
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function createSeamElement(): HTMLElement {
  const seam = document.createElement("div");
  seam.id = SEAM_ELEMENT_ID;
  seam.setAttribute("aria-hidden", "true");
  seam.dataset.themeRevealSeam = "";
  for (const side of ["start", "end"] as const) {
    const band = document.createElement("div");
    band.dataset.themeRevealBand = side;
    seam.append(band);
  }
  return seam;
}

/**
 * Applies `change` (which repaints the app in other colors) behind the reveal.
 * Without View Transitions, with reduced motion, or with interface animations
 * off, the change is instant.
 */
export function revealThemeChange(change: () => void): void {
  if (
    typeof document === "undefined" ||
    typeof document.startViewTransition !== "function" ||
    document.visibilityState !== "visible" ||
    !isInterfaceMotionActive()
  ) {
    change();
    return;
  }

  const revealId = ++activeRevealId;
  const root = document.documentElement;
  // A second reveal skips the first; its seam must not be captured as old state.
  document.getElementById(SEAM_ELEMENT_ID)?.remove();

  const width = window.innerWidth;
  const height = window.innerHeight;
  const origin = revealOrigin();
  const angle = ((90 + TILT_DEG) * Math.PI) / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  // CSS measures gradient stops along a line through the box center at `angle`.
  const lineLength = Math.abs(width * sin) + Math.abs(height * cos);
  const at = (origin.x - width / 2) * sin - (origin.y - height / 2) * cos + lineLength / 2;
  const startRadius = -FEATHER_PX;
  const endRadius = Math.max(at, lineLength - at) + FEATHER_PX;

  root.dataset.themeReveal = "";
  root.style.setProperty("--theme-reveal-angle", `${90 + TILT_DEG}deg`);
  root.style.setProperty("--theme-reveal-at", `${at}px`);
  root.style.setProperty("--theme-reveal-feather", `${FEATHER_PX}px`);
  root.style.setProperty("--theme-reveal-seam-width", `${SEAM_WIDTH_PX}px`);
  root.style.setProperty("--theme-reveal-seam-length", `${Math.hypot(width, height) * 2}px`);

  let seam: HTMLElement | null = null;
  const transition = document.startViewTransition(() => {
    change();
    seam = createSeamElement();
    document.body.append(seam);
  });

  const timing = { duration: REVEAL_DURATION_MS, easing: REVEAL_EASING, fill: "forwards" } as const;
  void transition.ready
    .then(() => {
      root.animate(
        { "--theme-reveal-r": [`${startRadius}px`, `${endRadius}px`] },
        { ...timing, pseudoElement: "::view-transition-old(root)" },
      );
      if (!seam) return;
      // Each seam sits on the middle of its curtain's feathered edge.
      const seamOffset = (radius: number, direction: 1 | -1) =>
        `translate(${origin.x}px, ${origin.y}px) rotate(${TILT_DEG}deg) translateX(${
          direction * (radius + FEATHER_PX / 2)
        }px) translate(-50%, -50%)`;
      for (const band of seam.querySelectorAll<HTMLElement>("[data-theme-reveal-band]")) {
        const direction = band.dataset.themeRevealBand === "start" ? -1 : 1;
        band.animate(
          [
            { transform: seamOffset(startRadius, direction), opacity: 0 },
            { opacity: 1, offset: 0.15 },
            { opacity: 1, offset: 0.6 },
            { transform: seamOffset(endRadius, direction), opacity: 0 },
          ],
          timing,
        );
      }
    })
    .catch(() => {});

  void transition.finished.finally(() => {
    seam?.remove();
    if (activeRevealId !== revealId) return;
    delete root.dataset.themeReveal;
    for (const property of [
      "--theme-reveal-angle",
      "--theme-reveal-at",
      "--theme-reveal-feather",
      "--theme-reveal-seam-width",
      "--theme-reveal-seam-length",
    ]) {
      root.style.removeProperty(property);
    }
  });
}
