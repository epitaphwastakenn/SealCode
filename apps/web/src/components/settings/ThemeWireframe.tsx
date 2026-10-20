import type { CSSProperties, ReactNode } from "react";

import { cn } from "../../lib/utils";
import type { ThemeCardPreviewColors } from "./ThemePreviewCircles";

/** The parts of an appearance beyond its colors, for previewing a whole look. */
export interface ThemeWireframeLook {
  /** Drawn between the window and the panels, where the app's background image sits. */
  readonly backdrop?: ReactNode;
  /** How much the sidebar and the main panel cover the backdrop, in percent. */
  readonly sidebarOpacity: number;
  readonly panelOpacity: number;
  readonly floating: boolean;
}

const OPAQUE_LOOK: ThemeWireframeLook = { sidebarOpacity: 100, panelOpacity: 100, floating: false };

const tint = (color: string, opacity: number) =>
  opacity >= 100 ? color : `color-mix(in srgb, ${color} ${opacity}%, transparent)`;

function ThemeWireframePane({
  colors,
  clip,
  look = OPAQUE_LOOK,
}: {
  colors: ThemeCardPreviewColors;
  clip?: "left" | "right" | undefined;
  look?: ThemeWireframeLook | undefined;
}) {
  const line = "rgb(127 127 127 / 0.25)";
  return (
    <span
      className="absolute inset-0"
      style={
        clip === undefined
          ? undefined
          : {
              clipPath:
                clip === "left"
                  ? "polygon(0 0, calc(50% - 1px) 0, calc(50% - 1px) 100%, 0 100%)"
                  : "polygon(calc(50% + 1px) 0, 100% 0, 100% 100%, calc(50% + 1px) 100%)",
            }
      }
    >
      <span
        className="absolute inset-0"
        style={{
          backgroundColor: look.floating
            ? `color-mix(in oklab, ${colors.canvas} 88%, black)`
            : colors.canvas,
        }}
      />
      {look.backdrop}
      <span
        className={cn(
          "absolute",
          look.floating
            ? "inset-y-[4%] left-[24%] right-[2%] rounded-lg"
            : "inset-y-0 left-[22%] right-0",
        )}
        style={{
          backgroundColor: tint(colors.canvas, look.panelOpacity),
          boxShadow: look.floating ? `inset 0 0 0 1px ${line}` : undefined,
        }}
      />
      <span
        className={cn(
          "absolute",
          look.floating ? "inset-y-[4%] left-[2%] w-[20%] rounded-lg" : "inset-y-0 left-0 w-[22%]",
        )}
        style={{
          backgroundColor: tint(colors.sidebar, look.sidebarOpacity),
          boxShadow: look.floating ? `inset 0 0 0 1px ${line}` : `inset -1px 0 0 ${line}`,
        }}
      />

      <span
        className="absolute left-[3%] top-[8%] h-[8%] w-[16%] rounded-md"
        style={{ backgroundColor: colors.surface, boxShadow: `inset 0 0 0 1px ${line}` }}
      />
      <span
        className="absolute left-[3%] top-[22%] h-[7%] w-[16%] rounded-md"
        style={{ backgroundColor: colors.accentSurface }}
      />
      <span
        className="absolute left-[3%] top-[32%] h-[7%] w-[16%] rounded-md"
        style={{ backgroundColor: colors.messageSurface, opacity: 0.7 }}
      />
      <span
        className="absolute left-[3%] top-[42%] h-[7%] w-[16%] rounded-md"
        style={{ backgroundColor: colors.messageSurface, opacity: 0.5 }}
      />

      <span
        className="absolute right-[28%] top-[11%] h-[9%] w-[24%] rounded-lg"
        style={{ backgroundColor: colors.messageSurface }}
      />
      <span
        className="absolute left-[27%] top-[28%] h-[5%] w-[34%] rounded-sm"
        style={{ backgroundColor: line }}
      />
      <span
        className="absolute left-[27%] top-[38%] h-[5%] w-[26%] rounded-sm"
        style={{ backgroundColor: line }}
      />

      <span
        className="absolute bottom-[8%] left-[26%] right-[6%] flex h-[15%] items-center justify-between rounded-md px-1"
        style={{
          backgroundColor: colors.surface,
          boxShadow: `inset 0 0 0 1px ${line}`,
        }}
      >
        <span
          className="block h-[26%] w-[34%] rounded-full"
          style={{ backgroundColor: line, opacity: 0.7 }}
        />
        <span
          className="block aspect-square h-[58%] rounded-full"
          style={{ backgroundColor: colors.messageAction }}
        />
      </span>

      <span
        className="absolute right-[5%] top-[8%] h-[46%] w-[20%] rounded-lg"
        style={{
          backgroundColor: colors.surface,
          boxShadow: `inset 0 0 0 1px ${line}, 0 2px 5px rgb(0 0 0 / 0.14)`,
        }}
      >
        {[0, 1, 2].map((row) => (
          <span
            className="absolute left-[11%] right-[11%] flex items-center gap-1"
            key={row}
            style={{ top: `${10 + row * 30}%`, height: "20%" }}
          >
            <span
              className="block aspect-square h-[26%] rounded-full"
              style={{
                backgroundColor:
                  row === 0 ? "#34d399" : row === 1 ? colors.messageAction : "#fbbf24",
                opacity: 0.55,
              }}
            />
            <span className="block h-[30%] w-[52%] rounded-sm" style={{ backgroundColor: line }} />
          </span>
        ))}
      </span>
    </span>
  );
}

export function ThemeWireframe({
  className,
  panes,
  radius,
}: {
  className?: string;
  panes: ReadonlyArray<{
    colors: ThemeCardPreviewColors;
    clip?: "left" | "right";
    look?: ThemeWireframeLook;
  }>;
  /** The look's corner radius in app pixels; the miniature rounds in proportion. */
  radius?: number;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block w-full overflow-hidden rounded-lg border border-border/60",
        className,
      )}
      style={
        radius === undefined
          ? undefined
          : ({ "--radius": `${Math.max(2, radius * 0.5)}px` } as CSSProperties)
      }
    >
      {panes.map((pane) => (
        <ThemeWireframePane
          clip={pane.clip}
          colors={pane.colors}
          key={pane.clip ?? "pane"}
          look={pane.look}
        />
      ))}
    </span>
  );
}
