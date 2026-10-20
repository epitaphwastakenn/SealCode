# Layouts

Choose by what the user does on the screen. Positions are Scale values of the safe area unless noted.

## Landing / main menu (blocks the world)

- Title group: centre-top, top edge at 0.10 to 0.14, height 0.20 to 0.24, width up to 0.7.
- Button stack: centred, starts 0.08 below the title; primary button first and largest (width 0.30 to 0.36 of the screen on PC, 0.6 to 0.7 on a phone in portrait), secondary buttons 0.85 of that.
- Optional: a featured character or item on one side (PC only; hide or move below on portrait phones), a version or "made by" label bottom-right in muted text at 12 to 14 px.
- Phone portrait: stack everything vertically, buttons wider, title smaller (0.16 height).

## Shop grid

- Panel: centred, width 0.62 (PC) to 0.94 (phone), height 0.78.
- Header: title left, currency balance right, close button top-right.
- Category tabs: a horizontal row under the header, pill buttons, the active one in the accent colour.
- Grid: 3 to 5 columns on PC, 2 on phone portrait; cards per `construction.md`.
- Purchase confirmation is a separate dialog, not an inline popup inside a card.

## Centered dialog

- Width 0.34 (PC) to 0.86 (phone), height by content (AutomaticSize Y with a max).
- Title, one or two lines of body text, then actions in a row: confirm on the right in the accent colour, cancel on the left in neutral. Destructive confirm in red.
- Dim the world behind at 0.45 transparency black.

## HUD (always on, world visible)

- Corners only: currencies top-left (stacked pills with icon + number), menu buttons left or right edge vertically, objective or timer top-centre, action buttons bottom-right on touch.
- Nothing in the centre third of the screen. Keep the HUD to 15% of the screen area or less.
- Touch: leave the bottom-left free for the thumbstick and bottom-right for the jump button.

## Inventory

- Like a shop grid but with equip state: equipped items get an accent stroke and a check badge; a detail panel on the right (PC) or a bottom sheet (phone) shows the selected item.

## Leaderboard

- Rows with rank number (gold, silver, bronze for 1 to 3), avatar thumbnail, name, value right-aligned. Alternate row shading at 0.95 transparency. The local player's row highlighted and pinned at the bottom if off-screen.

## Toast / notification

- Top-centre or right side, slides in, stays 3 to 4 s, slides out. Icon left, one line of text, at most two toasts stacked.
