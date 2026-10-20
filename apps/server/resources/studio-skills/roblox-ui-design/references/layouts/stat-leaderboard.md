# Layout: stat-leaderboard

A read-only ranking: top players, richest, most kills, high scores. Each row is `rank | player | value`. Nothing on a row can be pressed.

**Use it when** the screen only displays a ranking of other players. **Not when:** a row needs an action such as Challenge or Trade (then it is a list with actions, not this contract), or it is your own score (HUD).

Themes: `themes/cartoon-card.md`, `themes/studs-classic.md`, `themes/studs-modern.md` (gold header with a crown icon).

## Zones

| Zone            | Regular (PC)                                                                                                                  | Compact (phone)                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Panel           | 0.38 x 0.68 S (cartoon card about 0.29 x 0.61, ratio 0.85), a column; ratio `w*16/(h*9)` about 0.99                           | 0.62 S wide, 0.90 S tall, ratio 0.95 in landscape; 0.92 S wide in portrait |
| Header          | about 0.10 of P, crown or trophy icon                                                                                         | 0.13                                                                       |
| Tabs (optional) | two (Daily, All time), each about 0.22 x 0.06 of P; one bright. Modern studs: an outside rail                                 | chip row                                                                   |
| Column header   | optional small labels over the columns, about 0.04 of P                                                                       | omit                                                                       |
| Row list        | scroller, rows 64 px, 6 px gaps, width = content minus 26 px; the visible height is a whole multiple of the pitch (70 px)     | rows 56 px, 5 px gaps                                                      |
| Rank badge      | square, about 70 to 74% of the row height, 1.5% from the left; gold, silver, bronze for 1 to 3, neutral after                 | same                                                                       |
| Name            | starts after the badge plus 1.5%, about 45% of the row width, end-truncated, left aligned                                     | 50%                                                                        |
| Value           | right aligned about 2% from the right edge, optional stat icon at about 60% of the row height; every value ends at the same x | same                                                                       |

Avatars: a round avatar in the cartoon card theme. A catalogue icon for demo players, a headshot thumbnail (`rbxthumb://type=AvatarHeadShot&id=<userId>&w=150&h=150`) only for real players.

## Components

Header, rank badge, avatar (cartoon card), name label, value label (plain text, never a pill: a pill reads as a button), row background (grey; the local player's row cyan or white with a soft wash), tabs, scroller. The local player's row is highlighted and pinned at the bottom if it is off screen.

## Density

Seed 8 to 12 rows. Rank 1 is visible without scrolling. Values strictly descend. The top three are ordinary rows with different badge colours: no podium cards above the list. Side margins are 3% or less.

## States

Rank colours, the local row highlighted, a long name truncated, one very large value formatted (`1.25M`, `polish.md`), a tab switched.

## Phone and PC

A narrow column suits portrait phones. On a landscape phone use the compact column and keep five whole rows visible. Names truncate with an ellipsis, never wrap; rows never need a hover to be readable.

## Failures to avoid

Values out of order; a value that drifts with the length of the name; a podium; buttons or prices or banners on rows; wide side margins; names that wrap; rank 1 hidden by scroll; rows that do not share a right edge.

## Build order

1. Panel and header; tabs if asked.
2. Scroller with a list layout; row pitch known in pixels.
3. Demo player data sorted descending; assert the order in the builder.
4. Row builder: badge, name, value (and avatar); local-row highlight.
5. Pin the local row if off screen.
6. Audit for truncated or overflowing text; screenshot.
