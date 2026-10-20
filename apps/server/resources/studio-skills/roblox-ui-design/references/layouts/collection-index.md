# Layout variant: collection-index

A catalogue of everything that exists, discovered or not: an index of pets, fish, cards. It is `grid-inventory.md` with different slot states and a "discovered n of N" counter.

**Use it when** the player collects entries and should see what is still missing. **Not when:** the screen lists only what the player owns (`grid-inventory.md`).

## Zones

As in `grid-inventory.md`: panel 0.50 x 0.60, five columns of square cells, a tab rail for rarity or world, the counter in the first content row. Differences:

- Counter: `discovered/total` (for example `42/100`), first content row, right aligned.
- One tab per category (rarity, world); only the active tab is at full strength.
- A collection with a reward shows a reward tile and a Claim / Claimed button in the first row or the detail pane.

## Slot states

| State        | Look                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- |
| discovered   | the art in full colour, the name on or under it, rarity colour on the outline                   |
| undiscovered | slate face, the art as a black silhouette at about 0.2 transparency, the name replaced by `???` |
| selected     | heavier outline and a slight scale-up (outline 5 against 4, scale 1.05)                         |
| new          | a small NEW tag on the corner, removed when seen                                                |

The silhouette is the one sanctioned dark silhouette in the cartoon card theme.

## Phone and PC

Four columns on compact, the tab rail a chip row, cells at least 64 px. The grid may hold a hundred entries: build it with a `UIGridLayout` in a scroller, and create slots lazily if the count is in the hundreds.

## Failures to avoid

Showing only discovered entries; undiscovered entries with their real names; a counter that disagrees with the discovered slots; rarity by colour alone, with no other cue, on undiscovered slots.

## Build order

1. Panel, header, counter, tab rail, scroller grid.
2. Entry table with `discovered` flags.
3. Slot builder with the states above.
4. Counter from the table; seed some discovered and some not; audit; screenshot.
