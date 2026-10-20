# Layout: incremental-clicker

Tap to earn: one giant repeatable control with a running total above it, over a visible world.

**Use it when** the core action is tapping or clicking one thing for points. **Not when:** the screen blocks the world (`fullscreen-landing.md`), shows upgrades (open a shop or a dialog from a shortcut tile), or is only a score readout (HUD).

Themes: `themes/cartoon-card.md` (cyan counter, green target), `themes/studs-classic.md` (white-to-gold counter), `themes/studs-modern.md` (cash or gold gradient with a heavy stroke).

## Zones

No panel, no backdrop, no title, no close. All values are fractions of the screen S; `ScreenGui` keeps the default inset.

| Element        | Regular (PC)                                                                                                                                                                                                               | Compact (phone)                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Counter        | centred near the top, about 0.28 x 0.09, centre y about 0.10 (or top at a 70 px offset); optional currency icon at about 60% of the number's height at its left; optional rate line about 0.03 tall ("+5 per click")       | 0.50 x 0.12, centre y 0.14                              |
| Click target   | square, about 0.15 of the screen width, centred near (0.5, 0.60); never under 0.10 of the screen height; content: currency icon (about 45 to 50% of the height, on a sunburst in modern studs) over a short label ("TAP!") | square of 0.40 of the screen height, centre (0.5, 0.58) |
| Shortcut tiles | at most two, bottom-right, about 0.07 to 0.08 of the screen height, inset 2%, they open the upgrade shop                                                                                                                   | same, 48 px minimum, above the jump button              |

The click target is at least twice the width and height of any other button. The counter and the target never overlap. The total is the only large text on the screen. No blur or dimming.

## Components

Counter (gradient number with stroke, optional icon and rate line), click target (themed button face), one or two shortcut tiles, floating `+N` feedback labels that rise and fade.

## Density

Sparse. The play space (the world) is the point. The static total is believable and non-zero (five digits, formatted `12,480`).

## States

Idle, hover (scale 1.06), pressed (0.94 and the face drops onto its lip), a `+N` popup after a tap, a very large total formatted with a suffix.

## Phone and PC

Placement is Scale so it holds on any aspect ratio. On a phone the target must be reachable with a thumb: centre or lower centre, away from the thumbstick; do not place it at the bottom-left. Targets bigger than 44 px by a wide margin. Taps use `Activated` so touch, mouse and gamepad all work.

## Failures to avoid

A tiny target; the clicker inside a card or panel; an upgrade list on this screen; a flat grey counter; a counter and target overlapping; blur or dim behind the screen; more than two shortcut tiles.

## Build order

1. ScreenGui, counter frame with number label and optional icon.
2. Click target from the theme's primary button, enlarged.
3. Shortcut tiles bottom-right.
4. `+N` popup builder (a label tweened up 40 px while fading, then destroyed).
5. Compact branch for sizes.
6. Number formatting (`polish.md`), audit, screenshot with the world visible.
