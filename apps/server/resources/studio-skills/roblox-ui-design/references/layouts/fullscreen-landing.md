# Layout: fullscreen-landing

The title or main-menu screen. It hides the world, carries the game's name, and pushes one action: PLAY. There is no card and no title bar; the screen is the panel.

**Use it when** the screen fills the view and one button dominates (title, lobby entry, round start). **Not when:** the world stays visible and the player taps one big button for points (`incremental-clicker.md`), or it is a loading screen with no buttons (`loading-screen.md`).

Themes: `themes/cartoon-card.md` (gallery 7, 9), `themes/studs-classic.md`, `themes/studs-modern.md`, or any gallery archetype that fits the game (1 AAA, 3 minimal, 15 fantasy, 16 sci-fi use the same zones with their own type and colour).

## Zones

`ScreenGui` with `ScreenInsets = None` (otherwise a strip of world shows at the top). All numbers are fractions of the screen S.

| Zone                      | Geometry                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backdrop                  | one full frame, black `(0,0,0)` at `BackgroundTransparency` about 0.18 (never above 0.30; RGB channels above about 0.2 are a defect). A tinted vignette child (the theme's accent colour at 0.55 to 1 transparency, a vertical `UIGradient`) stops it reading as dead black. No blur: the backdrop already blocks. |
| A: title (0 to 0.35)      | lockup about 0.70 x 0.16 centred at y about 0.19; glyphs at least 11% of the screen height; at least 8% empty above. Optional tagline about 0.35 x 0.04 under it.                                                                                                                                                  |
| B: actions (0.35 to 0.75) | primary button about 0.26 x 0.11 centred at y about 0.50. Secondary buttons: two to four in one centred row, each about 0.13 x 0.07, 2% gaps. Gap from primary to secondaries about 0.07 (never below 0.05).                                                                                                       |
| C: footer (0.75 to 1)     | empty, except an optional footer line near y 0.95, about 0.03 tall (version, credits).                                                                                                                                                                                                                             |
| Corner tiles              | up to two, aspect 1, about 0.07 of the screen height, inset 2%. A dismissible landing may have one red close tile at the top-right (0.07 tall, 2% inset).                                                                                                                                                          |

Control budget: one primary, up to four secondaries, up to two corner tiles. Apart from the title, tagline and backdrop, nothing is wider than 0.30 of the screen. The primary is at least 1.5x a secondary's height and 1.8x its width.

## Components

Backdrop, title lockup (bare outlined text, optionally on a sunburst or with a gold gradient), tagline, primary button, secondary buttons, corner tiles, footer. Titles are bare glyphs with a stroke; no plate behind them. A featured character or item may stand on one side (regular only).

## Density

The empty bands between the zones are part of the design. When unsure, widen the gaps rather than the elements.

## States

Primary enabled; one secondary can show a badge ("NEW", a red dot). While the game connects the primary may read "Loading..." and be disabled (muted look), but a screen with no buttons at all is the loading variant.

## Phone and PC

Everything is placed in Scale, so the composition survives aspect changes. On compact windows:

- Title zone grows: lockup 0.80 wide; glyphs at least 0.14 of the screen height in landscape, and the lockup is allowed two lines in portrait.
- Primary becomes 0.40 x 0.15 (landscape) or 0.70 x 0.09 (portrait); secondaries 0.20 x 0.11 or a column in portrait.
- Hide the side character in portrait; stack title, primary, secondaries, footer top to bottom.
- Keep the thumbstick and jump areas free if the landing can appear while playing; on a pure title screen they do not matter.

## Failures to avoid

Backdrop grey or too transparent; a strip of world at the top; two CTAs of the same size; a vertical list of six equal buttons; the title on a plate; buttons on a loading screen; a grey secondary that reads as disabled when it is only secondary (keep it blue, or the theme's secondary colour); text smaller than the stroke can carry.

## Build order

1. ScreenGui (`ScreenInsets = None`, `ResetOnSpawn = false`), backdrop frame.
2. Title lockup from the theme (stroke, gradient, optional sunburst).
3. Primary button, then the secondary row with a `UIListLayout` (horizontal, centred).
4. Corner tiles and footer.
5. Compact branch: reposition by the size class.
6. Entrance stagger (`polish.md`), then audit and screenshots on a phone and a PC.
