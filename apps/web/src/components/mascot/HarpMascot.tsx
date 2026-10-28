import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import "./HarpMascot.css";
import {
  LYING_BODY,
  LYING_EYE_CLOSED,
  LYING_FLIPPER,
  LYING_HEAD,
  LYING_TAIL,
  SITTING_BODY,
  SITTING_FLIPPER,
  SITTING_HEAD,
  SITTING_TAIL,
} from "./harpMascotPaths";

type HarpMascotScene = "resting" | "sleeping" | "typing" | "ball";

// Each box fits its pose and the motion around it, so size the mascot by height alone.
const SCENE_VIEW_BOXES = {
  resting: "150 260 820 440",
  sleeping: "150 260 820 440",
  typing: "235 322 715 493",
  ball: "240 105 540 710",
} as const satisfies Record<HarpMascotScene, string>;

/**
 * Harp the seal. The body takes `--primary` and the eye the surface behind it; override
 * `--harp-mascot-color` and `--harp-mascot-eye` where that surface is not `--background`.
 * Loops run only while the mascot is on screen, and reduced motion keeps the first frame.
 */
export function HarpMascot({ scene, className }: { scene: HarpMascotScene; className?: string }) {
  const lying = scene === "resting" || scene === "sleeping";
  return (
    <svg
      ref={observeVisibleAnimation}
      aria-hidden
      focusable="false"
      data-harp-mascot={scene}
      data-pose={lying ? "lie" : "sit"}
      viewBox={SCENE_VIEW_BOXES[scene]}
      fill="currentColor"
      className={className}
    >
      {lying ? (
        <LyingPose sleeping={scene === "sleeping"} />
      ) : (
        <SittingPose typing={scene === "typing"} />
      )}
    </svg>
  );
}

function LyingPose({ sleeping }: { sleeping: boolean }) {
  return (
    <>
      <g data-part="seal">
        <g data-part="tail">
          <path d={LYING_TAIL} />
        </g>
        <path d={LYING_BODY} />
        <circle cx="715" cy="520" r="45" />
        <circle cx="318" cy="622" r="24" />
        <g data-part="head">
          <path d={LYING_HEAD} />
          {sleeping ? (
            <path data-part="eye-closed" d={LYING_EYE_CLOSED} />
          ) : (
            <circle data-part="eye" cx="770.5" cy="435.5" r="13.5" />
          )}
        </g>
        <g data-part="flipper">
          <path d={LYING_FLIPPER} />
        </g>
      </g>
      <circle cx="912" cy="634" r="34" />
      {sleeping ? (
        <g fontFamily="system-ui, sans-serif" fontWeight="800">
          <text data-part="z" x="840" y="400" fontSize="44">
            z
          </text>
          <text data-part="z" x="840" y="400" fontSize="56">
            z
          </text>
          <text data-part="z" x="840" y="400" fontSize="68">
            z
          </text>
        </g>
      ) : null}
    </>
  );
}

function SittingPose({ typing }: { typing: boolean }) {
  return (
    <>
      {typing ? (
        <>
          <rect x="726" y="780" width="182" height="22" rx="11" />
          <rect x="884" y="636" width="24" height="166" rx="12" transform="rotate(13 896 791)" />
        </>
      ) : null}
      <g data-part="seal">
        <path d={SITTING_TAIL} />
        <path d={SITTING_BODY} />
        <circle cx="615" cy="505" r="64" />
        <g data-part="head">
          <path d={SITTING_HEAD} />
          <circle data-part="eye" cx="625.5" cy="406" r="14.2" />
        </g>
        <g data-part="flipper">
          <path d={SITTING_FLIPPER} />
        </g>
      </g>
      {typing ? null : <circle data-part="ball" cx="703" cy="281" r="45.5" />}
    </>
  );
}
