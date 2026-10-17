# MODERN STUDS selected body: centered-dialog

> Repository-authored from the modern-stud reference study. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: both reference games' Rebirth dialogs (before/after value chips ~0.17 of panel height, a requirement bar ~0.11, buttons ~0.15-0.165, a warning line) and one game's small confirmations. The slot table below was checked live in Studio on a rebirth dialog: no audit problems, nothing overflowing.

# SELECTED LAYOUT GUIDE (loaded via layout="centered-dialog")

For: rebirth, confirmations, offline earnings, prestige, prompts, "you got X" dialogs: any screen that presents a small amount of important information with one or two actions. NOT for shops, inventories, HUDs, transient toasts that dismiss themselves (notification-alert), or quest/reward boards (progression-hub).

The defining trait: **a few chunky blocks on a fixed vertical rhythm, and one or two actions.** Nothing stretches to fill the panel width, and nothing scrolls.

## Measurements (1080p)

- Panel: `Size = UDim2.fromScale(0.44, 0.56)`, centered, built with `scrolls = false` (`makePanelDark(gui, name, 0.44, 0.56, "yellow", title, icon, false)` or the Light equivalent). A dialog never scrolls: inside a scrolling `Content`, Scale heights grow with the canvas and the blocks overflow the panel.
- Leave the `Content` frame empty. Parent every block below directly to the PANEL with `AnchorPoint = Vector2.new(0.5, 0.5)` at these exact slots, all shares of the panel. No `UIListLayout`, no `UIPadding`: the slots ARE the rhythm.

  | Slot | Centre y | Height | Holds |
  |---|---|---|---|
  | Caption row | 0.255 | 0.07 | two captions ("Rebirth 0", "Rebirth 1"), stroke 2.5 |
  | Value row | 0.37 | 0.15 | two value chips, or a row of reward tiles |
  | Bar | 0.535 | 0.115 | the requirement bar, width 0.84 |
  | Note | 0.655 | 0.065 | one warning or note line, width 0.86 |
  | Actions | 0.815 | 0.15 | one or two action buttons |

  Copy the numbers. Every gap between slots is 0.04-0.05 of the panel, the header ends near 0.165, and 11% of the panel stays empty under the buttons.
- Before/after (rebirth, upgrade): two green `chip` blocks, each `Size = UDim2.fromScale(0.37, 0.15)`, centred at x 0.26 and 0.74 in the Value row, one centred label each ("x1.5 Money", stroke 3, ~0.62 of the chip face). Captions above them at the same x, `0.37` wide. Between the chips, a bare stroked ">" at (0.5, 0.37), `Size = UDim2.fromScale(0.08, 0.075)`. The chips are display only.
- Reward tiles (offline earnings, "you got X"): up to 3 `tile` blocks in the Value row and the Caption row together (centre y 0.33, height 0.22), each ~0.2 of panel width, icon on a small sunburst above the amount, centred as a group with ~0.03 gaps.
- Requirement bar: the theme's progress bar, `Size = UDim2.fromScale(0.84, 0.115)` at (0.5, 0.535), filled with `setProgress`. On its face, ONE centred row (horizontal `UIListLayout`, centred both ways, 6 px padding): the requirement icon (Fit, square, the row's full height) then the count label ("131/1K Strength", stroke 2.5).
- Note: a red label (`Color3.fromRGB(255, 92, 92)`, stroke 3) at (0.5, 0.655), `Size = UDim2.fromScale(0.86, 0.065)`. Inside the panel, never below it.
- Actions, two buttons with these exact properties:
  - ConfirmButton: `AnchorPoint = Vector2.new(1, 0.5)`, `Position = UDim2.fromScale(0.485, 0.815)`, `Size = UDim2.fromScale(0.32, 0.15)`, green, label ~0.62 of the face.
  - SecondButton: `AnchorPoint = Vector2.new(0, 0.5)`, `Position = UDim2.fromScale(0.515, 0.815)`, `Size = UDim2.fromScale(0.32, 0.15)`: grey for Cancel, purple for a Robux skip (label "Skip" at y 0.38 and 0.5 tall, "KEEP STATS!" at y 0.78 and 0.27 tall, both on the face).
  The two sizes are IDENTICAL; the affirmative action sits LEFT. With one action, centre it: `AnchorPoint = Vector2.new(0.5, 0.5)`, `Position = UDim2.fromScale(0.5, 0.815)`.
- Optional gift square: a purple `tile` right of the second button, the same height, only when the skip is a Robux purchase. Shift both buttons 0.05 left to keep the group centred.
- A dialog without a bar or a note keeps the empty slot as space; it does not move the actions up.

## Small confirmation variant

For a yes/no question with one line of text: `Size = UDim2.fromScale(0.3, 0.34)`, `scrolls = false`. Message label at (0.5, 0.47), `Size = UDim2.fromScale(0.86, 0.22)`, stroke 2.5, wrapping allowed. Two buttons at centre y 0.8, `Size = UDim2.fromScale(0.38, 0.2)`, anchored at x 0.485 (right edge) and 0.515 (left edge).

## Rules

- Nothing in a dialog scrolls, and nothing sits in a list layout: the slots are fixed shares of the panel.
- Padding is symmetric: every block is centred on x 0.5 or mirrored around it.
- At most 2 action buttons (plus the optional gift square).
- Chips are wider than their text needs: at least 0.34 of the panel wide, never sized to the label.
- If the audit reports text that does not fit, shorten the text or lower the label's share of its block. Never shrink the blocks below this table.
