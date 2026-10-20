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
import { loadBackdropImage } from "~/lib/backdrop/backdropStore";
import {
  type BackdropPalette,
  type EdgeColors,
  processBackdropImage,
  revokeBackdropUrl,
} from "~/lib/backdrop/processBackdrop";
import { observeResize } from "~/lib/observeResize";
import { panelClipPath } from "~/lib/backdrop/panelClipPath";
import { isWindowsPlatform } from "~/lib/utils";

// How far the image drifts against the mouse at full parallax, as a share of
// the window (SealScreen's PARALLAX_MAX).
const PARALLAX_MAX = 0.06;

interface ShownImage {
  readonly imageId: string;
  readonly key: string;
  readonly url: string;
  readonly edges: EdgeColors;
}

/** Resolves any CSS color (hex, rgb, oklch…) to RGB through a 1×1 canvas. */
function cssColorToRgb(color: string): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [0, 0, 0];
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function readThemePalette(): BackdropPalette {
  const style = getComputedStyle(document.documentElement);
  return {
    base: cssColorToRgb(style.getPropertyValue("--background").trim() || "#000"),
    accent: cssColorToRgb(style.getPropertyValue("--primary").trim() || "#7c3aed"),
  };
}

const rgbCss = ([r, g, b]: readonly [number, number, number]) => `rgb(${r} ${g} ${b})`;

function pixelLookKey(look: BackdropLook): string {
  // Strength, blur, the fade, the vignette and the drift are drawn in CSS, so
  // changing them must not send the image back through the effects worker.
  const {
    strength: _strength,
    blur: _blur,
    vignette: _vignette,
    fade: _fade,
    fadeAngle: _fadeAngle,
    fadeSize: _fadeSize,
    fadeColor: _fadeColor,
    parallax: _parallax,
    parallaxAmount: _parallaxAmount,
    ...pixel
  } = look;
  return JSON.stringify(pixel);
}

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
    const mutationObserver = new MutationObserver(scheduleMeasure);
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
  const [source, setSource] = useState<{ imageId: string; blob: Blob } | null>(null);
  const [shown, setShown] = useState<ShownImage | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const imageId = glassAppEnabled ? (backdrop?.imageId ?? null) : null;

  useEffect(() => {
    if (imageId === null) {
      setSource(null);
      return;
    }
    let cancelled = false;
    void loadBackdropImage(imageId).then(
      (blob) => {
        if (!cancelled) setSource(blob ? { imageId, blob } : null);
      },
      () => {
        if (!cancelled) setSource(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  const look = backdrop ? backdropLook(backdrop) : DEFAULT_BACKDROP_LOOK;
  const animated = backdrop?.animated ?? false;
  const processKey =
    source === null
      ? null
      : `${source.imageId}:${animated ? "animated" : pixelLookKey(look)}:${resolvedTheme}`;

  const shownUrlRef = useRef<string | null>(null);
  const showImage = (next: ShownImage | null) => {
    const previous = shownUrlRef.current;
    shownUrlRef.current = next?.url ?? null;
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
    if (source === null || processKey === null) {
      showImage(null);
      return;
    }
    let cancelled = false;
    // Slider drags restyle the same image many times a second; the worker
    // only needs the value the pointer rests on.
    const delay = shownUrlRef.current !== null ? 120 : 0;
    const timer = window.setTimeout(() => {
      // Animated images play as they are; the worker still reads their first
      // frame for the edge colors the automatic fade melts into.
      void processBackdropImage(
        source.blob,
        animated ? DEFAULT_BACKDROP_LOOK : look,
        readThemePalette(),
      ).then(
        (result) => {
          if (cancelled) {
            revokeBackdropUrl(result.url);
            return;
          }
          let url = result.url;
          if (animated) {
            revokeBackdropUrl(result.url);
            url = URL.createObjectURL(source.blob);
          }
          showImage({ imageId: source.imageId, key: processKey, url, edges: result.edges });
        },
        () => undefined,
      );
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `look` reaches the worker through processKey, which changes exactly when
    // the pixel effects do.
  }, [processKey, source]);

  const parallax = backdrop?.parallax === true && glassAppEnabled;
  const parallaxAmount = backdrop?.parallaxAmount ?? 0;
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

  const visible =
    glassAppEnabled && backdrop !== null && shown !== null && shown.imageId === backdrop.imageId;

  useEffect(() => {
    document.documentElement.dataset.backdrop = visible ? "true" : "false";
  }, [visible]);

  useClipToFloatingPanels(
    container,
    visible && floatingPanels && isElectron && isWindowsPlatform(navigator.platform),
  );

  if (!glassAppEnabled) return null;

  const drift = parallax ? (PARALLAX_MAX * Math.min(parallaxAmount, 100)) / 100 : 0;
  const strength = (backdrop?.strength ?? 100) / 100;
  const blur = backdrop?.blur ?? 0;
  // Blur pulls transparent pixels in from outside the image; a little extra
  // scale keeps its edges under the window frame.
  const scale = ((backdrop?.zoom ?? 100) / 100) * (1 + drift * 2) * (1 + blur / 300);
  const imageStyle = {
    objectPosition: `${backdrop?.x ?? 50}% ${backdrop?.y ?? 50}%`,
    transformOrigin: `${backdrop?.x ?? 50}% ${backdrop?.y ?? 50}%`,
    transform: `translate(calc(var(--backdrop-drift-x, 0) * ${-drift * 100}vw), calc(var(--backdrop-drift-y, 0) * ${-drift * 100}vh)) scale(${scale})`,
    opacity: strength,
    filter:
      [blur > 0 ? `blur(${blur}px)` : "", animated ? cssLevelFilter(look) : ""]
        .filter(Boolean)
        .join(" ") || undefined,
    imageRendering: !animated && look.pixel > 1 ? "pixelated" : undefined,
  } satisfies CSSProperties;

  const degrees = backdrop ? backdropFadeDegrees(look) : null;
  const fade = backdrop && visible ? fadeColor(backdrop, shown.edges) : null;

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
