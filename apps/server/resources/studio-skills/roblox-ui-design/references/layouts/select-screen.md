# Layout: select-screen

Compare a few options and commit to exactly one: character, class, team, map, mode, role.

**Use it when** the options are uniform, one is selected, and a single confirm follows. **Not when:** items have prices (`shop-grid.md`), the player manages what they own (`grid-inventory.md`), or there are dozens of options (use a scrolling inventory-style grid).

Themes: `themes/cartoon-card.md`, `themes/studs-classic.md`, `themes/studs-modern.md`; gallery 6 (colour tiles) and 16 (hex cards) for tile-forward looks.

## Zones

Panel `P`, non-scrolling.

| Zone       | Regular (PC)                                                                                                                | Compact (phone)                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Panel      | 0.50 x 0.55 S (range 0.45 to 0.60 wide), ratio about 1.62                                                                   | 0.92 S wide, 0.86 S tall, ratio 1.8                                    |
| Header     | about 0.11 to 0.15 of P (theme)                                                                                             | 0.16                                                                   |
| Tile row   | centred at y 0.42, height 0.62 of the content area; 3 to 5 tiles, each about 0.28 of the content width, aspect 0.8, 3% gaps | 2 or 3 tiles per row, tiles at least 110 px wide; wrap to a second row |
| Tile bands | art 8 to 62% of tile height, name 66 to 84%, role or subtitle 86 to 96%                                                     | same                                                                   |
| Confirm    | one button about 0.35 x 0.13 of P, about 5% under the tiles                                                                 | 0.5 x 0.14, at least 48 px tall                                        |
| Breathing  | at least 5% empty under the confirm                                                                                         | 4%                                                                     |

Six or more options wrap to a second row at the same tile size; two or three may commit directly with no confirm and a smaller panel (ratio 1.25).

## Components

Option tile (art, name, role), selected style, locked style (lock badge about 18% of tile width at a corner, dimmed face), one confirm button, header and close.

## Density

Tiles are uniform: no "featured" larger option. Wrap rather than shrink. Art is required in every tile; text-only tiles are a defect.

## States

Exactly one selected tile, visible in a still image: brighter or in its option colour, heavier outline (about 5 against 3), scale 1.05 where the theme allows it. Unselected tiles are desaturated or grey with the thinner outline. One locked tile (slate or darkened, lock badge). The confirm is enabled when something is selected; if the selected tile is locked, the confirm is the muted look.

## Phone and PC

On compact, two tiles across and the second row scrolls only if there are more than six; the confirm sticks to the bottom of the panel (outside the scroller). Tap selects; a second tap on the confirm commits. Do not rely on hover for any information.

## Failures to avoid

A SELECT button on every tile when there are four or more options; text-only tiles; prices or offers on a select screen; hidden locked options (show them locked); tiles that look identical; two selected tiles; no selected tile at first render; per-tile subtitles in different greys.

## Build order

1. Panel, header, content frame (no scroller).
2. Options data table: name, role, art, color, locked.
3. Tile builder from the theme; place tiles with a `UIListLayout` (horizontal, centred) or a `UIGridLayout` when wrapping.
4. `select(index)` restyles the old and new tile; a locked tile cannot be confirmed.
5. Confirm button below the tiles, `onConfirm(option)` stub.
6. Seed one selected and one locked; audit, screenshot.
