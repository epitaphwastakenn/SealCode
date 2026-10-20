# Layout: wheel-spin

A prize wheel: eight wedges, a pointer, a SPIN button, a spins-left line, optional spin packs, a close button and an open button. It floats over the world with no card and no backdrop. This is a specialised layout: build it from `templates/wheel-spin.lua`, not from scratch (see `references/specialized.md` for how to configure and extend it).

**Use it when** the player spins a radial wheel for a random prize. **Not when:** the prizes roll through a vertical window (`vertical-reel-roll.md`), the choice is not random (`select-screen.md`), or there are more than eight outcomes (group them; the layout is fixed at eight wedges, each exactly 45 degrees).

Themes: the template carries the cartoon card look in a `STYLE` table. For the studs themes swap `STYLE` and `makeButton` for the theme's block constructor (see the theme file); the wheel itself is theme-neutral.

## Zones

Placement is Scale of the screen S. The wheel box is a square that fits inside the given box (a `UIAspectRatioConstraint` of 1), so it never distorts.

| Zone        | Wide window (aspect 1.2 or more)                                              | Tall window (phone portrait)                                                             |
| ----------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Wheel box   | centre (0.34, 0.50), fits 0.42 x 0.66 S (a 1080p screen gives about 690 px)   | centre (0.50, 0.29), fits 0.92 x 0.46 S                                                  |
| Controls    | left edge at 0.60, centred at y 0.5, 0.36 x 0.70 S                            | centre (0.5, 0.70), 0.92 x 0.32 S, so the packs end above the thumbstick and jump button |
| Close       | 48 px square, top-right corner at (0.98, 0.04)                                | same                                                                                     |
| Open button | 56 px square at the left edge, (0.02, 0.5), always visible, toggles the wheel | same                                                                                     |

Inside the wheel box (fractions of the box): a dark outline circle (full size), the disc at 0.88 (it spins), the rim ring (a stroked circle at 0.88, stroke 4.5% of the box so it hides the octagon corners), eight white pegs on the rim between wedges, the hub (0.16) and the pointer (a downward wedge whose tip sits just inside the rim at the top).

Inside the disc, wedge `i` (1 to 8, clockwise from the top) has its centre at `45 * (i - 1)` degrees, so wedge 1 is under the pointer at rest. Contents run along the wedge axis, measured from the disc centre in disc widths: chance label at 0.15, icon at 0.255 (0.14 wide), name at 0.395 (0.30 wide, 0.075 tall).

Controls column, top to bottom (heights are fractions of the column): spins-left line 0.11, result line 0.11, SPIN row 0.20 (a SPIN button 0.5 wide and the free-spin text), spin packs 0.30 (three buy buttons 0.31 wide each: caption `+ N Spins` over the Robux glyph and price), gaps 0.03.

## Components

Disc, eight wedges (colour, name, icon, chance), dividers, rim, pegs, hub, pointer, spins-left and result lines, SPIN, three packs, close, open button. Required states: open and spinnable at first render, spinning (SPIN greyed), result shown (the winning icon pulses once).

## Density

Wedges hold three things only: name, icon, chance. Names are at most about 10 characters. The prize name appears large again in the result line after the stop; do not try to make wedge text bigger than the wedge allows.

## States

Idle, hover and press on buttons, spinning (SPIN disabled, Close ignored), result, no spins left (result line says so, SPIN stays disabled until the game raises the count with `wheel.setSpins`). The wheel starts open so it can be inspected; the game decides when to close it.

## Phone and PC

The layout switches by window shape: side by side on wide windows, stacked on tall ones. The wheel box fits the smaller dimension, so on a 390 px tall phone it is about 250 px across. At that size wedge text is about 11 to 13 px: keep names short and rely on the icon and the result line. Hit areas: SPIN and packs are at least 44 px tall; the close and open buttons are 48 and 56 px. Leave the thumbstick corner free.

## Failures to avoid

Wedges that are not exactly 45 degrees (or are re-ordered between runs); a number of prizes other than eight; chances that do not total 100; neighbouring wedges with the same colour (including wedge 8 and 1); a card or backdrop behind the wheel; a hand-written builder instead of the template; editing the template below its config and style tables for a content change; a wheel that starts closed; spinning while the player has no spins; deciding the prize on the client in a live game (use `requestSpin` with a server decision); purchases or remotes wired inside the first pass.

## Build order

1. Copy the template into a LocalScript (StarterPlayerScripts); keep the name `WheelSpin`.
2. Edit `CONFIG`: prizes (name, weight, colour, icon), spins, packs, sounds, `requestSpin`, `onResult`, `onBuyPack`.
3. Edit `STYLE` for the theme (font, ink, button colours); swap `makeButton` for the theme's constructor if it is not the cartoon card.
4. Play test; click SPIN through `interact_ui`; check the pointer lands on the named wedge and the result line matches.
5. Audit and screenshot on a phone and a PC; fix wedge text size by shortening names, not by editing geometry.
