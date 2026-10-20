# Layout variant: daily-rewards

A seven-day reward calendar: six small day tiles and one tall, richer tile for day 7. A variant of `progression-hub.md` where every tile is one reward and only today's can be claimed.

**Use it when** a login streak hands out one reward a day. **Not when:** goals have progress bars (`progression-hub.md`).

## Zones

Panel `P`, a non-scrolling plain frame.

| Zone         | Regular (PC)                                                                                                         | Compact (phone)                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Panel        | 0.50 x 0.56 S, ratio about 1.59                                                                                      | 0.92 S wide, 0.84 S tall, ratio 1.75 |
| Header       | about 0.11 of P (title "Daily Rewards")                                                                              | 0.15                                 |
| Tiles 1 to 6 | a 3 x 2 grid in the left 72% of the content: each tile about 0.21 of the content width x 0.45 of its height, 2% gaps | the same grid, tiles at least 80 px  |
| Day 7        | one tall gold tile at the right: about 0.26 of the width, the full height of both rows, a bigger reward              | same                                 |
| Tile layout  | "Day N" over the top of the art (4 to 20%), the reward art filling the tile, the amount at the bottom (74 to 94%)    | same                                 |
| Streak line  | optional line under the grid: "Come back in 12:30:00" or "Streak: 4 days"                                            | same                                 |

The art box covers the whole face of the tile (size 1 x 1, `ScaleType = Fit`), so the labels sit on it as children and are never flagged as colliding with it.

## States

| Tile    | Look                                                                                  |
| ------- | ------------------------------------------------------------------------------------- |
| claimed | grey tile with a check icon instead of the art                                        |
| today   | green tile with "CLAIM!" at the bottom; the only clickable tile; may pulse its colour |
| future  | the reward's own colour, not clickable                                                |

Seed days 1 to 3 claimed, day 4 today, days 5 to 7 future.

## Failures to avoid

More than one clickable tile; green on tiles that are not claimable; day 7 the same size as the others; tiles with no art; a scrolling panel; a "CLAIM" button outside the tile.

## Build order

1. Panel, header, content frame (no scroller).
2. Reward table for seven days (amount, art, colour).
3. Tile builder with the three states; day 7 builder.
4. `setStreak(day, claimedToday)` restyles all tiles; `onClaim(day)` stub.
5. Audit; screenshot on both size classes.
