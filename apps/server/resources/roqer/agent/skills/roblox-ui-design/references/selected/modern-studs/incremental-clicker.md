# MODERN STUDS selected body: incremental-clicker

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: one reference game shows its main total as a big top-centre cash-gradient number with no plate. The click target and secondary buttons are carried from the CLASSIC STUDS clicker body.

# SELECTED LAYOUT GUIDE (loaded via layout="incremental-clicker")

For: clicker and tap-to-earn screens: a big click target that grants currency per press, with a running total. NOT for HUDs (hud-zone-system), shops, upgrade menus, or any screen that blocks the world (fullscreen-landing).

The defining trait: **one giant studded click tile dominates, with the total above it, over a sharp visible world.**

## Measurements (1080p)

- No panel, header, close, backdrop, or blur.
- Counter, top-centre: the running total as one extruded display number (cash or gold gradient, stroke 4), ~28% screen width x ~9% screen height, top at a 70 px offset (`AnchorPoint = Vector2.new(0.5, 0)`, `Position = UDim2.new(0.5, 0, 0, 70)`). Optional currency icon left of the number (Fit, square, ~60% of its rendered height) in one centred row. Under it one optional rate line ("+5 per click", ~3% screen height, stroke 2.5).
- Click target: a `tile` block with `isButton = true`, square (`UIAspectRatioConstraint` 1), ~15% screen width, centred at (0.5, 0.6), green or gold. Face content: the currency icon on a sunburst (~50% of face height) above a short extruded label ("TAP!"), stacked and centred.
- Size ratio: the click target is at least 2x the height and 2x the width of every other button on screen.
- Optional menu access: at most 2 `tile` blocks with icons (aspect 1, ~8% screen height) in the bottom-right corner, inset ~2%. They open shop/upgrade screens.
- Hardcode a believable total ("12,450"), never zero. Floating "+N" feedback and counter updates are behaviour for a later task.
- Size and position in Scale (except the 70 px keep-out anchor).

## Rules

- The click target is the largest interactive element on screen and at least 10% of screen height.
- The total is a gradient display number, and the only large text on screen.
- No panel chrome and no blur: the world stays visible and sharp.
- Counter and click target never overlap.
- At most 2 secondary tiles; upgrades never list on this screen.
