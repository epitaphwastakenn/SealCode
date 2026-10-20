# Layout: hud-zone-system

The always-on overlay: the player's currencies and stats, a timer or objective, menu buttons, bars, buff chips and actions. The world is fully visible.

**Use it when** the elements stay on screen during play. **Not when:** it is a labelled rail where each button opens a menu and that is the whole UI (`vertical-navigation-sidebar.md`), or a ranking of other players (`stat-leaderboard.md`). Your own score is HUD.

Themes: gallery 8 (glossy HUD kit) with `themes/cartoon-card.md`; plate-less currency readouts and tile menus in `themes/studs-modern.md`; chips and bars in `themes/studs-classic.md`.

## Zones

Think of a 3 x 3 grid of the screen S. The centre cell is forbidden. Use three or four zones, six at most. Each zone is an invisible `Frame` pinned to an edge or corner, and its children are placed by a list or grid layout; nothing is positioned against the screen on its own.

| Zone               | Holds                                                         | Anchor and limits                                                                                                               |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Top-left           | currencies and stats                                          | below the core keep-out: offset (12 + half a pill height, 80) px, so an icon that overhangs the pill's left end stays on screen |
| Top-centre         | one timer, objective, nav chip row or total                   | up to 0.40 S wide, starts 8 px under the top bar                                                                                |
| Top-right          | controls (settings), small offers                             | 0.98 S, up to 0.22 wide                                                                                                         |
| Left / right rails | menu buttons, up to 6 per side, badges on at most 2           | vertical centre, x 0.02 / 0.98                                                                                                  |
| Bottom-left        | health, stamina, buffs, currency readouts                     | x 0.02, bottom 0.97, up to 0.22 wide                                                                                            |
| Bottom-centre      | actions or hotbar, at most 4, each about 0.11 x 0.08, 2% gaps | up to 0.40 wide                                                                                                                 |
| Bottom-right       | secondary readouts                                            | up to 0.22 wide                                                                                                                 |

Margins: 2% of the screen from every edge, at least 2% between zones, the middle 50% x 50% empty. The whole HUD stays within about 15% of the screen area.

Typical sizes (regular): currency chip about 0.16 x 0.055 with the icon at 70% of the chip height; icon buttons 0.045 x 0.08, aspect 1 (about 86 px) with a 48 px icon; timer 0.18 x 0.07; bars 0.22 x 0.035 (dark track, bright fill, count on the bar); gaps 1 to 1.5% of the screen height. Currency pill variant: 46 px tall, icon at 1.45x the pill height poking over one end, optional round green plus. Menu tiles: about 0.065 x 0.115 (aspect 0.97) with a label over the icon's foot.

## Components

Currency chip or pill (always an icon, a different icon per currency), stat readout, bar (track, fill, count), timer, menu tile or round icon button with optional badge, buff chip, action button, small offer. Plate-less readouts (icon plus gradient number) are allowed in the modern studs theme only.

## Density

Compact: 8 px between pills and bars, 12 px between round buttons. Do not mix framed menu tiles and unframed offers in one zone.

## States

At least three zones populated; each currency with its own icon; badges on at most two tiles; one bar partly full; one timer running.

## Phone and PC

- Placement is Scale, which holds on phones, but fixed pixel sizes must scale: keep the 1080p pixel values in a table and multiply by `viewport.Y / 1080`, with a floor so text stays at 14 px and hit areas at 44 px.
- On compact: drop to two zones per side, move bars above the thumbstick area (never under it), and put actions bottom-right above the jump button. Leave the bottom-left quarter free for the thumbstick and the bottom-right corner for jump.
- Top-centre elements start below the top bar (default inset about 58 px); if `ScreenInsets = None`, add that back.

## Failures to avoid

An element in the centre; zones that overlap; an element outside any zone container; a bare number without its icon; the top-left corner covered; a flat black rectangle instead of a bar (needs the track, fill and rim of the theme); a backdrop, panel, title or close on a HUD; a HUD that grows past a fifth of the screen.

## Build order

1. ScreenGui (`ResetOnSpawn = false`), one container `Frame` per zone with a list or grid layout and padding.
2. Currency chips and stat readouts (top-left), then the bars (bottom-left).
3. Menu tiles on the side rails; badges last.
4. Timer or objective (top-centre); actions (bottom-centre).
5. Compact branch by size class; touch-control clearance check.
6. Hover and press on tiles only (`polish.md`); no ambient loops except one badge.
7. Audit, then screenshots on a phone and a PC with the world visible behind.
