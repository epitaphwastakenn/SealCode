# MODERN STUDS selected body: stat-leaderboard

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: none in the reference games. Geometry is carried from the CLASSIC STUDS leaderboard body and re-skinned with the modern surface kit.

# SELECTED LAYOUT GUIDE (loaded via layout="stat-leaderboard")

For: leaderboards, rankings, top-player boards, high scores, richest lists, kill boards: any screen ranking players by a value. NOT for your OWN stat readouts (hud-zone-system), select screens, or quest boards (progression-hub).

The defining trait: **ranked rows, one player each, in strict columns.** Rank, name, and value each align vertically.

## Measurements (1080p)

- Panel: `Size = UDim2.fromScale(0.38, 0.68)`, centered, taller than wide, `makePanelDark` (gold header, Crown icon `rbxassetid://78843852703854`) or `makePanelLight`.
- Optional scope tabs (Daily / All Time): the theme's tab rail on the panel's RIGHT edge, one active in colour.
- Optional column header row: bare labels (stroke 2, ~4% panel height) over the rank / name / value columns.
- Rows: the content's vertical `UIListLayout` with 6 px gaps; each row a `card` block, full content width, explicit height 64 px (`Size = UDim2.new(1, 0, 0, 64)`). Columns on the face, left to right:
  - Rank badge: a `tile` block, square (height-dominant aspect 1), ~74% of the face height, left margin ~1.5%; rank number centred, stroke 2.5. Ranks 1, 2, 3 are `gold`, `silver`, `bronze`; every other rank `slate`.
  - Player name: left-aligned label starting past the badge + ~1.5%, ~45% of row width, stroke 2, `TextTruncate = Enum.TextTruncate.AtEnd`.
  - Value: right-aligned, ending ~2% from the face's right edge, gold display gradient, stroke 2.5; optional stat icon left of the number at ~60% of row height.
- Row face colour: `grey` for every row; the local player's row `cyan` (the same selection cue as select-screen).
- SEED 8-12 demo players with strictly descending values when the game has no data.

## Rules

- Values descend top to bottom; rank 1 is visible without scrolling.
- Rows are uniform: no podium cards above the list.
- Columns align: every value ends at the same x, every name starts at the same x.
- No buttons on rows, no prices, no banners: a leaderboard displays, it never acts.
- Names truncate; a name wrapping to two lines is a defect.
