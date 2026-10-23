import {
  type AppBackdrop as AppBackdropSettings,
  backdropFadeDegrees,
  backdropLook,
  type BackdropLook,
  DEFAULT_BACKDROP_LOOK,
} from "@t3tools/contracts";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { isElectron } from "~/env";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import {
  pixelLookKey,
  type PreparedBackdrop,
  prepareBackdrop,
} from "~/lib/backdrop/preparedBackdrop";
import { type EdgeColors, revokeBackdropUrl } from "~/lib/backdrop/processBackdrop";
import { observeResize } from "~/lib/observeResize";
import { panelClipPath } from "~/lib/backdrop/panelClipPath";
import { isWindowsPlatform } from "~/lib/utils";

// How far the image drifts against the mouse at full parallax, as a share of
// the window (SealScreen's PARALLAX_MAX).
const PARALLAX_MAX = 0.06;

interface ShownImage extends PreparedBackdrop {
  /** The settings this image was prepared for. */
  readonly backdrop: AppBackdropSettings;
}

const rgbCss = ([r, g, b]: readonly [number, number, number]) => `rgb(${r} ${g} ${b})`;

/**
 * The effects a CSS filter can draw: all an animated image takes on every
 * frame, and what a look's miniature shows without the effects worker.
 */
export function cssLevelFilter(look: BackdropLook): string {
  const parts: string[] = [];
  if (look.saturation !== 100) parts.push(`saturate(${look.saturation / 100})`);
  if (look.brightness !== 100) parts.push(`brightness(${look.brightness / 100})`);
  if (look.hue !== 0) parts.push(`hue-rotate(${Math.round(look.hue * 3.6)}deg)`);
  if (look.invert !== 0) parts.push(`invert(${look.invert / 100})`);
  return parts.join(" ");
}

function fadeColor(backdrop: AppBackdropSettings, edges: EdgeColors | null): string | null {
  if (backdrop.fadeColor === "theme") return "var(--background)";
  if (backdrop.fadeColor !== null) return backdrop.fadeColor;
  const degrees = backdropFadeDegrees(backdrop);
  if (degrees === null || edges === null) return null;
  const side = (["top", "right", "bottom", "left"] as const)[Math.round(degrees / 90) % 4]!;
  return rgbCss(edges[side]);
}

const FLOATING_PANEL_SELECTOR =
  '[data-app-sidebar] [data-slot="sidebar-inner"], [data-slot="sidebar-inset"]';

/**
 * With floating panels the Windows app has no material behind the page, so the
 * image is cut to the panels and the gaps between them show the desktop.
 */
function useClipToFloatingPanels(container: HTMLDivElement | null, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || container === null) return;
    let frame = 0;
    let watchingDom = false;
    // Resizes cover window and sidebar changes, and a panel leaving the DOM
    // reports one too. The DOM is only watched while a panel is still missing.
    const observed = new Map<Element, () => void>();
    const scheduleMeasure = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    // Streaming adds nodes to the body many times a second; measuring forces a
    // layout, so only a panel arriving or leaving schedules one.
    const touchesPanel = (nodes: NodeList) =>
      Array.prototype.some.call(
        nodes,
        (node: Node) =>
          node instanceof Element &&
          (node.matches(FLOATING_PANEL_SELECTOR) ||
            node.querySelector(FLOATING_PANEL_SELECTOR) !== null),
      );
    const mutationObserver = new MutationObserver((records) => {
      if (
        records.some(
          (record) => touchesPanel(record.addedNodes) || touchesPanel(record.removedNodes),
        )
      )
        scheduleMeasure();
    });
    // The corner settings land on the root and change the panels' radius and
    // shape without resizing them.
    const rootObserver = new MutationObserver(scheduleMeasure);
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-smooth-corners"],
    });
    function measure() {
      frame = 0;
      if (container === null) return;
      const panels = Array.from(document.querySelectorAll(FLOATING_PANEL_SELECTOR));
      for (const [panel, unobserve] of observed) {
        if (panel.isConnected) continue;
        unobserve();
        observed.delete(panel);
      }
      for (const panel of panels) {
        if (!observed.has(panel)) observed.set(panel, observeResize(panel, measure));
      }
      const complete = panels.length >= 2;
      if (complete && watchingDom) mutationObserver.disconnect();
      if (!complete && !watchingDom) {
        mutationObserver.observe(document.body, { childList: true, subtree: true });
      }
      watchingDom = !complete;
      const path = panels
        .map((panel) =>
          panelClipPath(
            panel.getBoundingClientRect(),
            Number.parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0,
            document.documentElement.dataset.smoothCorners === "true",
          ),
        )
        .join("");
      container.style.clipPath = `path("${path || "M0,0Z"}")`;
    }
    measure();
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      for (const unobserve of observed.values()) unobserve();
      mutationObserver.disconnect();
      rootObserver.disconnect();
      container.style.removeProperty("clip-path");
    };
  }, [container, enabled]);
}

const GRAIN_TEXTURE = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

/**
 * What lies behind the app's glass: the device-stored image with its look, or
 * the plain theme color when there is no image and no native acrylic.
 */
export function AppBackdrop() {
  const glassAppEnabled = useClientSettings((settings) => settings.glassAppEnabled);
  const backdrop = useClientSettings((settings) => settings.backdrop);
  const floatingPanels = useClientSettings((settings) => settings.floatingPanels);
  const { resolvedTheme } = useTheme();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [shown, setShown] = useState<ShownImage | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const wanted = glassAppEnabled ? backdrop : null;
  const processKey =
    wanted === null
      ? null
      : `${wanted.imageId}:${wanted.animated ? "animated" : pixelLookKey(backdropLook(wanted))}:${resolvedTheme}`;

  const shownUrlRef = useRef<string | null>(null);
  const shownImageIdRef = useRef<string | null>(null);
  const showImage = (next: ShownImage | null) => {
    const previous = shownUrlRef.current;
    shownUrlRef.current = next?.url ?? null;
    shownImageIdRef.current = next?.imageId ?? null;
    setShown(next);
    // The old image stays painted until the new one has decoded.
    if (previous !== null && previous !== next?.url) {
      window.setTimeout(() => revokeBackdropUrl(previous), 1000);
    }
  };
  useEffect(
    () => () => {
      if (shownUrlRef.current !== null) revokeBackdropUrl(shownUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (wanted === null) {
      showImage(null);
      return;
    }
    let cancelled = false;
    // Slider drags restyle the same image many times a second; the worker
    // only needs the value the pointer rests on. A different image goes at once.
    const delay = shownImageIdRef.current === wanted.imageId ? 120 : 0;
    const timer = window.setTimeout(() => {
      // Until the new picture is decoded the old one stays up, so switching
      // looks never leaves the window without a background; if it fails, the
      // old one simply stays.
      void prepareBackdrop(wanted).then(
        (prepared) => {
          if (cancelled) {
            revokeBackdropUrl(prepared.url);
            return;
          }
          showImage({ ...prepared, backdrop: wanted });
        },
        () => undefined,
      );
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `wanted` reaches the worker through processKey, which changes exactly
    // when the image or its pixel effects do.
  }, [processKey]);

  // While a new image is being prepared, the old one is drawn the way it was set up.
  const drawn =
    !glassAppEnabled || backdrop === null || shown === null
      ? null
      : shown.imageId === backdrop.imageId
        ? backdrop
        : shown.backdrop;
  const look = drawn ? backdropLook(drawn) : DEFAULT_BACKDROP_LOOK;
  const animated = drawn?.animated ?? false;

  const parallax = drawn?.parallax === true;
  const parallaxAmount = drawn?.parallaxAmount ?? 0;
  useEffect(() => {
    const image = imageRef.current;
    if (!parallax || !image) return;
    let frame = 0;
    let pointer = { x: 0.5, y: 0.5 };
    const apply = () => {
      frame = 0;
      image.style.setProperty("--backdrop-drift-x", String(pointer.x - 0.5));
      image.style.setProperty("--backdrop-drift-y", String(pointer.y - 0.5));
    };
    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight };
      if (frame === 0) frame = window.requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      image.style.removeProperty("--backdrop-drift-x");
      image.style.removeProperty("--backdrop-drift-y");
    };
  }, [parallax, shown?.url]);

  const visible = drawn !== null && shown !== null;

  useEffect(() => {
    document.documentElement.dataset.backdrop = visible ? "true" : "false";
  }, [visible]);

  useClipToFloatingPanels(
    container,
    visible && floatingPanels && isElectron && isWindowsPlatform(navigator.platform),
  );

  if (!glassAppEnabled) return null;

  const drift = parallax ? (PARALLAX_MAX * Math.min(parallaxAmount, 100)) / 100 : 0;
  const strength = (drawn?.strength ?? 100) / 100;
  const blur = drawn?.blur ?? 0;
  // Blur pulls transparent pixels in from outside the image; a little extra
  // scale keeps its edges under the window frame.
  const scale = ((drawn?.zoom ?? 100) / 100) * (1 + drift * 2) * (1 + blur / 300);
  const imageStyle = {
    objectPosition: `${drawn?.x ?? 50}% ${drawn?.y ?? 50}%`,
    transformOrigin: `${drawn?.x ?? 50}% ${drawn?.y ?? 50}%`,
    transform: `translate(calc(var(--backdrop-drift-x, 0) * ${-drift * 100}vw), calc(var(--backdrop-drift-y, 0) * ${-drift * 100}vh)) scale(${scale})`,
    opacity: strength,
    filter:
      [blur > 0 ? `blur(${blur}px)` : "", animated ? cssLevelFilter(look) : ""]
        .filter(Boolean)
        .join(" ") || undefined,
    imageRendering: !animated && look.pixel > 1 ? "pixelated" : undefined,
  } satisfies CSSProperties;

  const degrees = drawn ? backdropFadeDegrees(look) : null;
  const fade = drawn && visible ? fadeColor(drawn, shown.edges) : null;

  return (
    <div
      ref={setContainer}
      aria-hidden="true"
      data-app-backdrop="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="app-backdrop-base absolute inset-0" />
      {visible ? (
        <>
          <img
            ref={imageRef}
            src={shown.url}
            alt=""
            draggable={false}
            decoding="async"
            className="absolute inset-0 size-full object-cover"
            style={imageStyle}
          />
          {animated && look.scanlines > 0 ? (
            <div
              className="absolute inset-0"
              style={{
                opacity: strength,
                backgroundImage: `repeating-linear-gradient(to bottom, rgb(0 0 0 / ${(look.scanlines / 100) * 0.55}) 0 1px, transparent 1px 3px)`,
              }}
            />
          ) : null}
          {animated && look.grain > 0 ? (
            <div
              className="absolute inset-0 mix-blend-overlay"
              style={{
                opacity: (look.grain / 100) * 0.6 * strength,
                backgroundImage: GRAIN_TEXTURE,
              }}
            />
          ) : null}
          {degrees !== null && fade !== null ? (
            <div
              className="absolute inset-0"
              style={{
                opacity: strength,
                backgroundImage: `linear-gradient(${degrees}deg, transparent ${100 - look.fadeSize}%, ${fade} 100%)`,
              }}
            />
          ) : null}
          {look.vignette > 0 ? (
            <div
              className="absolute inset-0"
              style={{
                opacity: (look.vignette / 100) * strength,
                backgroundImage:
                  "radial-gradient(ellipse at center, transparent 40%, rgb(0 0 0 / 0.9) 100%)",
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
