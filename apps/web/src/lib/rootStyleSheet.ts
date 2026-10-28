export interface RootStyleSheet {
  /** Replaces the whole sheet in one write; `null` empties it. */
  readonly set: (css: string | null) => void;
}

/**
 * One style sheet the page owns. Rewriting it is a single style invalidation, unlike dozens of
 * inline `setProperty` calls, and it leaves the root's `style` attribute and `<head>` alone, so
 * observers of either stay quiet.
 */
export function createRootStyleSheet(id: string): RootStyleSheet {
  let sheet: CSSStyleSheet | null = null;
  let element: HTMLStyleElement | null = null;
  let current: string | null = null;

  return {
    set(css) {
      if (typeof document === "undefined" || css === current) return;
      if (sheet === null && element === null) {
        if (css === null) return;
        try {
          sheet = new CSSStyleSheet();
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        } catch {
          sheet = null;
          element = document.createElement("style");
          element.id = id;
          document.head.append(element);
        }
      }
      current = css;
      if (sheet !== null) sheet.replaceSync(css ?? "");
      else if (element !== null) element.textContent = css ?? "";
    },
  };
}
