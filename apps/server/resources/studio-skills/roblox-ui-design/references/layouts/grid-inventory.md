# Layout: grid-inventory

Storage with a capacity: owned pets or items, a backpack, a locker, a collection. One slot is selected and one shared Equip or Unequip action acts on the selection.

**Use it when** the player looks at things they own. **Not when:** items have prices (`shop-grid.md`) or the player is picking one of a few options (`select-screen.md`). With a detail pane use `inventory-detail.md`; for a discovered-or-not index use `collection-index.md`.

Themes: `themes/cartoon-card.md` (gallery 7; 2 for 3D models), `themes/studs-classic.md`, `themes/studs-modern.md`.

## Zones

Panel `P`.

| Zone         | Regular (PC)                                                                                                                                                        | Compact (phone)                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Panel        | 0.50 x 0.60 S (cartoon card about 0.63 x 0.57), ratio about 1.48                                                                                                    | 0.92 S wide, 0.88 S tall, ratio 1.75 |
| Header       | about 0.11 of P; the counter does not go here in modern studs                                                                                                       | 0.15                                 |
| Counter row  | first content row, 36 px, right aligned: `3/20` (the number in gold in modern studs)                                                                                | same                                 |
| Grid         | 5 columns, square cells about 0.18 of the content width, 2% padding computed so five cells and four gaps span the pane                                              | 4 columns, cells at least 64 px      |
| Rows visible | about 4                                                                                                                                                             | 3                                    |
| Action       | one button at (0.5, 0.92) of P, about 0.26 x 0.09 (the grid shortens by 0.12 to leave room)                                                                         | 0.5 x 0.10, at least 44 px           |
| Tabs         | an edge rail of square tabs (modern: outside the panel's right edge; classic: a vertical rail flush against the left edge; cartoon card: overhanging the left edge) | a row of icon tabs above the grid    |

Capacity above what fits scrolls with a whole number of visible rows. Cells are never taller than 1.15 x their width. The cartoon card theme measured 8 columns of 132 px slots in a 63% panel; that is the dense PC form, not the default.

## Components

Slot (filled: art, name, optional count or rarity chip at the top-right, about 22 to 24% of the cell; empty: the bare cell), selected style, tab rail, counter, one action button, optional search pill straddling the top edge (cartoon card only), optional Equipped and Stored dividers.

## Density

Square uniform cells that never resize to fill space and never change the column count between rows. Overflow scrolls instead of shrinking slots. One slot is rendered per unit of capacity: 3 owned of 20 is 3 filled slots and 17 empty ones, filling left to right.

## States

5 to 8 demo items when there is no data; one selected slot (heavier outline and a small scale-up, or the cartoon wash); empty slots; a counter `current/max`; rarity by colour per tab (common grey, uncommon green, rare blue, epic purple, legendary gold, mythic pink). The Equip button says Unequip when the selection is already equipped.

## Phone and PC

Compact: 4 columns, tabs become a horizontal row of icon tabs under the header, the action button sits below the grid, text at 14 px and larger. Prefer a detail bottom sheet (`inventory-detail.md`) over a side pane. The slot is the button; never put a button inside each slot.

## Failures to avoid

Only owned items rendered (the empty capacity must show); a button on every slot; bare icons without names; portrait cells; rows running under the action button; prices; changing the column count; a panel taller than 0.66.

## Build order

1. Panel, header, counter row, scroller with a `UIGridLayout`.
2. Item data table: name, art, rarity, count, equipped.
3. Slot builder from the theme; `fitGrid` for the cell size (`layouts.md`); fill empty slots up to capacity.
4. `select(slot)`; the Equip button reads the selection.
5. Tab rail (rarity or world); only one tab at full strength.
6. Seed a selected slot; audit; screenshots on both size classes.
