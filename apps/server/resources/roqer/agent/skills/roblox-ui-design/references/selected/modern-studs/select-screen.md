# MODERN STUDS selected body: select-screen

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: none in the reference games. Geometry is carried from the CLASSIC STUDS select body and re-skinned with the modern surface kit.

# SELECTED LAYOUT GUIDE (loaded via layout="select-screen")

For: character/skin/class pickers, team select, map or mode select, hero select, job and role pickers: any screen where the player compares a few options and commits to ONE. NOT for shops (those sell), inventories (those manage), or dialogs.

The defining trait: **a row of comparable option tiles, exactly one selected, and a single confirm.** Locked options stay visible and dimmed.

## Measurements (1080p)

- Panel: `Size = UDim2.fromScale(0.5, 0.55)`, centered, `makePanelDark` or `makePanelLight` with `scrolls = false`: a select screen never scrolls, and Scale heights inside a scrolling content overflow.
- Option tiles: 3 to 5 `card` blocks in ONE centered row Frame (`Position = UDim2.fromScale(0.5, 0.42)`, `AnchorPoint = Vector2.new(0.5, 0.5)`, `Size = UDim2.fromScale(1, 0.62)` of the content), each ~28% of the row's width, portrait aspect ~0.8 (`UIAspectRatioConstraint`), ~3% gaps, laid out by a horizontal `UIListLayout` centred as a group.
  - Bands: art 0.08-0.62 on a sunburst (Fit, square), name 0.66-0.82 (extruded, stroke 3), one-line stat or role 0.84-0.95 (stroke 2).
  - 6 or more options: the SAME tile size, wrapping to a second row; never shrink tiles to fit one row.
- Selected tile: in its option colour, outline raised to 5 (`base.UIStroke.Thickness = 5`), and a `UIScale` of 1.05 on its base. Unselected tiles: `paint`ed `grey`, outline 3, scale 1.
- Locked tile: `paint`ed `slate`, name still legible, the Lock icon `rbxassetid://113981661296218` in the tile's top-right at ~18% of tile width (child of the face). Locked tiles are never removed.
- Confirm: ONE green `button` block centred below the row, ~35% panel width x ~13% panel height, ~5% panel height below the tiles, parented to the panel. Label "SELECT" or "CONFIRM", extruded.
- Bottom breathing room: at least 5% of panel height below the confirm.

## Rules

- Exactly one tile reads as selected in a still screenshot: colour, heavier outline, and scale together.
- With 4 or more options, one confirm below the row and no buttons on tiles: the tile is the click target. With 2-3 options, tiles may commit directly and the panel shrinks to fit.
- Every tile carries art in its art band (`resolve_icon`); text-only tiles are a defect.
- Tiles are uniform in size, fields, and construction; no larger "featured" option.
- No prices, banners, offers, or currency readouts in this layout.
