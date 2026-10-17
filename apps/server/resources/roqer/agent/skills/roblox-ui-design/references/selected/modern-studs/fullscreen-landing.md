# MODERN STUDS selected body: fullscreen-landing

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: none in the reference games. Geometry is carried from the CLASSIC STUDS landing body and re-skinned with the modern surface kit.

# SELECTED LAYOUT GUIDE (loaded via layout="fullscreen-landing")

For: main menus, title screens, play screens, intro/warning screens, loading screens, round-start and respawn screens: any screen that fills the display and blocks the game view. NOT for shops, dialogs, inventories, HUDs, or click-to-earn screens over the visible world (incremental-clicker).

The defining trait: **the screen is the panel, and one action dominates.** No bordered panel and no header. A big title lockup on top, one large primary button in the middle, small secondary buttons under it.

## Measurements (1080p)

- The ScreenGui has EXACTLY `IgnoreGuiInset = true`, or a strip of raw world shows along the top.
- Backdrop: one full-screen Frame, `BackgroundColor3 = Color3.new(0, 0, 0)`, `BackgroundTransparency = 0.18`, lowest ZIndex. This screen does NOT use the theme's world blur: the backdrop already blocks the world.
- Composition centers on screen center-x and stays inside the center 70% of screen width. Size and position in Scale.
- Zone A, screen y 0-35%: the title lockup. Title box ~70% screen width x ~16% screen height, centered at y ~0.19: a bare label made with `makeText` (`extrude = true`, gold display gradient, stroke 4). The glyphs must render at least 11% of screen height; use the RichText size rule above 100 px. Optional tagline under it, ~35% x ~4% of the screen, white, stroke 2.5. Optional sunburst under the title (Fit, square, ~1.4x the title's rendered width, ImageTransparency ~0.75), staying inside Zone A.
- Zone B, screen y 35-75%: the action group, centered.
  - Primary: a green `button` block, ~26% screen width x ~11% screen height, centered at y ~0.50, label "PLAY" (extruded).
  - Secondaries: 2 to 4 `button` blocks in ONE centered row, each ~13% x ~7% of the screen, ~2% screen width apart, one colour per action (blue, purple, orange, grey). The gap between the primary's bottom and the row's top is ~7% of screen height, never below 5%.
  - Size ratio: the primary is at least 1.5x the height and 1.8x the width of a secondary.
- Zone C, screen y 75-100%: empty, except an optional footer line at y ~0.95.
- Corner slots (optional): up to 2 `tile` blocks with icons, aspect 1, ~7% of screen height, inset ~2% from a screen corner.

## Loading variant

Same backdrop and title, no buttons: one theme progress bar ~50% screen width x ~5% screen height, top edge at y ~0.64, and one status line under it at ~3.5% of screen height.

## Rules

- No panel, no header, no close button. A screen the player can dismiss gets ONE red close tile in the top-right SCREEN corner, ~7% of screen height, inset 2%.
- One primary action only; button budget 1 primary, at most 4 secondaries, at most 2 corner tiles.
- The title is a bare extruded label: never on a plate, band, or block.
- Nothing wider than 30% of the screen except the title lockup, the tagline, and the backdrop.
- The gaps between zones are the composition: when unsure, add space, not size.
