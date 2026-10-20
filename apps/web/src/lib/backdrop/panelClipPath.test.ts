import { describe, expect, it } from "vite-plus/test";

import { panelClipPath } from "./panelClipPath";

const box = { left: 10, top: 20, width: 200, height: 100 };

function points(path: string): Array<[number, number]> {
  return Array.from(path.matchAll(/L(-?[\d.]+),(-?[\d.]+)/g), (match) => [
    Number(match[1]),
    Number(match[2]),
  ]);
}

describe("panelClipPath", () => {
  it("follows a circular arc for plain rounded corners", () => {
    expect(panelClipPath(box, 12, false)).toBe(
      "M22,20H198A12,12 0 0 1 210,32V108A12,12 0 0 1 198,120H22A12,12 0 0 1 10,108V32A12,12 0 0 1 22,20Z",
    );
  });

  it("bulges past the circular arc for smooth corners, as corner-shape: squircle does", () => {
    const radius = 12;
    const corner = points(panelClipPath(box, radius, true)).slice(0, 16);
    // The top-right corner runs from the top edge to the right edge.
    expect(corner.at(-1)).toEqual([210, 32]);
    const center = [198, 32] as const;
    const diagonal = corner[7]!;
    const distance = Math.hypot(diagonal[0] - center[0], diagonal[1] - center[1]);
    expect(distance).toBeGreaterThan(radius * 1.1);
    for (const [x, y] of corner) {
      expect(x).toBeLessThanOrEqual(210);
      expect(y).toBeGreaterThanOrEqual(20);
    }
  });

  it("caps the radius at half the shorter side", () => {
    expect(panelClipPath({ left: 0, top: 0, width: 40, height: 20 }, 50, false)).toContain(
      "A10,10",
    );
  });
});
