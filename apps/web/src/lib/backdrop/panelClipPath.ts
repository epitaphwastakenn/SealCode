interface PanelBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const SQUIRCLE_STEPS = 16;
const round = (value: number) => Math.round(value * 100) / 100;

// `corner-shape: squircle` draws each corner as the superellipse
// |x|^4 + |y|^4 = 1, fuller than a circular arc of the same radius. A clip
// that follows a circle instead leaves slivers at every corner where the panel
// is painted but the image behind it is cut away.
function squircleCorner(centerX: number, centerY: number, radius: number, fromAngle: number) {
  let path = "";
  for (let step = 1; step <= SQUIRCLE_STEPS; step += 1) {
    const angle = fromAngle + (step / SQUIRCLE_STEPS) * (Math.PI / 2);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = centerX + radius * Math.sign(cos) * Math.sqrt(Math.abs(cos));
    const y = centerY + radius * Math.sign(sin) * Math.sqrt(Math.abs(sin));
    path += `L${round(x)},${round(y)}`;
  }
  return path;
}

/** An SVG path of a panel's outline, matching how CSS rounds its corners. */
export function panelClipPath(
  { left: x, top: y, width: w, height: h }: PanelBox,
  radius: number,
  smooth: boolean,
): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (!smooth || r === 0) {
    return (
      `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}` +
      `A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}` +
      `V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`
    );
  }
  return (
    `M${x + r},${y}H${x + w - r}` +
    squircleCorner(x + w - r, y + r, r, -Math.PI / 2) +
    `V${y + h - r}` +
    squircleCorner(x + w - r, y + h - r, r, 0) +
    `H${x + r}` +
    squircleCorner(x + r, y + h - r, r, Math.PI / 2) +
    `V${y + r}` +
    squircleCorner(x + r, y + r, r, Math.PI) +
    "Z"
  );
}
