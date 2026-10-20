# Layout: progression-hub

Quests, achievements, daily or weekly goals, a battle pass. A checklist, not a catalogue: every row answers goal, progress, reward. Rewards are earned, never bought.

**Use it when** each row has a goal, a progress bar and a claim step. **Not when:** items are for sale (`shop-grid.md`) or it is a seven-day calendar (`daily-rewards.md`).

Themes: `themes/cartoon-card.md`, `themes/studs-classic.md`, `themes/studs-modern.md` (purple header on the dark panel).

## Zones

| Zone                  | Regular (PC)                                                                                                                                                                                                                                                                                                       | Compact (phone)                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Panel                 | 0.52 x 0.62 S (cartoon card about 0.48 x 0.53), ratio about 1.49                                                                                                                                                                                                                                                   | 0.92 S wide, 0.88 S tall, ratio 1.75               |
| Header                | about 0.11 of P                                                                                                                                                                                                                                                                                                    | 0.15                                               |
| Tabs (optional)       | two to four, each about 0.16 wide x 40 px; one bright, the rest muted. Modern studs: a rail outside the panel (Daily, Weekly, Season)                                                                                                                                                                              | a chip row under the header, drop one demo row     |
| Row list              | scroller, row 96 px (cartoon card 82 px), 10 px spacing; five whole rows visible                                                                                                                                                                                                                                   | four whole rows; row 84 px                         |
| Row interior          | icon about 70% of the row height at the left; middle block about 52% of the row width: name (about 40% of the height) over the bar (about 90% of the block width, about 28% of the row height, count on the bar); right block about 14 to 16% wide: reward chip and the claim button (about 60% of the row height) | name stacked over the bar, claim button 44 px tall |
| Reset pill (optional) | "Resets in 12h" straddling the top edge                                                                                                                                                                                                                                                                            | in the first content row                           |

More than five rows scroll, always with whole rows visible.

## Components

Quest row (icon, name, bar with count, reward chip, claim button), tab strip or rail, reset pill, header. A progress bar is one object whose fill is a child or a gradient; at zero progress the fill is hidden, and a non-zero fill is at least 4% wide so it is still visible.

## Density

At least five rows visible on regular. One or two giant rows is a defect. Rows are full width and identical.

## States

Each row is in one of three states, and green is reserved for the actionable one:

| State      | Bar           | Button                                             |
| ---------- | ------------- | -------------------------------------------------- |
| incomplete | partly filled | CLAIM in the muted look (disabled), no hover       |
| claimable  | full          | CLAIM in the accent green, hover and press         |
| claimed    | full, dimmed  | CLAIMED in the muted look, optionally a check icon |

Seed 5 to 7 demo quests with varied progress: one claimable, one claimed, one barely started (1 or 2 out of N, never 0).

## Phone and PC

Rows stay one per line; on compact stack the name above the bar and give the claim button the full right third. Tabs become a chip row. A bar's count text stays at 14 px and larger. Do not put prices or Robux on quest rows.

## Failures to avoid

Green on rows that are not claimable; a fill that disagrees with the count; prices or Robux on rows; a partly visible last row; a missing bar; fewer than five rows; a claim button smaller than 44 px.

## Build order

1. Panel, header, optional tabs.
2. Quest data table: name, icon, current, goal, reward, claimed.
3. Row builder from the theme; `setProgress(row, value, goal)` that clamps and hides a zero fill.
4. State function `applyState(row)` that restyles the claim button from the three states.
5. Reset pill and tabs; seed the three states.
6. `onClaim(quest)` stub that flips the row to claimed; audit and screenshot.
