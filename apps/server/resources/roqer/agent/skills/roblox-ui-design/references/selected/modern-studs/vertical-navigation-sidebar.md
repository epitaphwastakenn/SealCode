# MODERN STUDS selected body: vertical-navigation-sidebar

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: partial. One reference game opens its left menu stack with a wide labelled Shop button (icon left, label right, alert badge). Rail geometry is carried from the CLASSIC STUDS sidebar body.

# SELECTED LAYOUT GUIDE (loaded via layout="vertical-navigation-sidebar")

For: persistent sidebar menus over gameplay: a vertical stack of labelled nav buttons on a screen edge (Shop, Pets, Rewards, Codes, Settings) where each button opens its own menu. NOT for HUDs with stat readouts or icon-only corner stacks (hud-zone-system), admin category rails (admin-control-panel), or any bordered panel with a header.

The defining trait: **an edge-anchored rail of wide studded buttons over a sharp, visible world.**

## Measurements (1080p)

- Container: ONE transparent Frame on the LEFT screen edge, `AnchorPoint = Vector2.new(0, 0.5)`, `Position = UDim2.fromScale(0.015, 0.5)`, sized to its buttons; vertical `UIListLayout` with ~1.2% screen-height padding.
- Buttons: 3 to 6 `button` blocks, uniform, each `Size = UDim2.fromScale(0.11, 0.075)` (with `isButton = true`), one colour per destination (Shop gold, Pets green, Rewards purple, Codes blue, Settings grey).
- Button content on the face: icon (Fit, square, ~78% of face height) at the left with ~6% button-width margin, then the label (stroke 3, left-aligned, ~60% of face height), as one row. Both are mandatory.
- Optional badge: a red `chip` parented to the button's face (never the base, or its text crosses the face's edge) with `ZIndex = 4`, straddling the face's top-right corner at (0.95, 0.05), ~40% of button height tall, with "!" or a count. The label's text ends short of it. At most one per button.
- Size and position in Scale: the rail must hold on phone aspect ratios.

## Rules

- No panel, header, close, backdrop, or blur: the world stays fully visible and sharp.
- ONE column, vertically centred on the screen edge.
- Buttons are uniform: same size, same construction, colour per destination.
- Each button opens its own menu; the rail never expands into a panel.
- At most 6 buttons.
- Compact over large.
