# Layout variant: inventory-detail

`grid-inventory.md` with a detail pane for the selected slot: a grid on the left and a card on the right (a bottom sheet on phones).

**Use it when** the selected item has art, a name, stats and an action worth reading. **Not when:** a name and one action are enough (plain `grid-inventory.md`).

## Zones

Panel `P` is a non-scrolling shell; the grid scroller inside it scrolls.

| Zone        | Regular (PC)                                                                                                                                           | Compact (phone)                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Grid        | left 62% of the content width, 3 columns (4 to 5 in the cartoon card theme), square cells, whole rows visible                                          | full width, 4 columns, top 58% of the panel                                                              |
| Gap         | 3%                                                                                                                                                     | 2%                                                                                                       |
| Detail card | right 35% of the content width, full content height: art 6 to 46%, name 50 to 60%, up to three stat lines 62 to 84%, action 86 to 96% (about 70% wide) | bottom sheet in the lower 38% of the panel: art left, name and stats right, the action across the bottom |

The detail card is white (cartoon card: corner 0.05, stroke 4) or a card block in the studs themes; in modern studs the art sits on a sunburst.

## States

Nothing selected: the card shows an empty hint ("Select an item") and hides the action. Selected: the grid slot takes its selected style and the card fills in. The action reads Equip, Unequip or Use by the item's state.

## Failures to avoid

A detail card taller than the grid; stats as long paragraphs; a second action row; the grid changing its column count when the card appears; card text smaller than 14 px.

## Build order

1. Shell panel; split the content area into grid and card regions.
2. Grid per `grid-inventory.md` with `fitGrid`.
3. Detail card builder `showDetail(item)`.
4. Wire `select(slot)` to both.
5. Compact branch (bottom sheet); audit; screenshots.
