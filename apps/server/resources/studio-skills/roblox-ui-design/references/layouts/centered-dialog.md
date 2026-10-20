# Layout: centered-dialog

A small panel with a few important facts and at most two actions: rebirth or prestige, offline earnings, "you got X", a requirement check. Breathing room beats density.

**Use it when** the screen waits for a decision, however short, including a "popup that says click OK". **Not when:** it leaves by itself (`notification-alert.md`), it is a catalogue (`shop-grid.md`), or it is a list of goals (`progression-hub.md`). For one purchase confirmation use the small form in `purchase-confirm.md`.

Themes: `themes/cartoon-card.md` (gallery 7), `themes/studs-classic.md`, `themes/studs-modern.md`.

## Zones

Panel `P` is a plain, non-scrolling `Frame`. All inner blocks are placed by fixed fractions of the panel, so the rhythm is the layout; do not use a list layout for the slots.

| Zone / block        | Regular (PC)                                                             | Compact (phone)                      |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| Panel               | 0.44 x 0.56 S (cartoon card 0.36 x 0.51), ratio `w*16/(h*9)`, about 1.40 | 0.86 S wide, 0.84 S tall, ratio 1.45 |
| Header              | ends near 0.165 of P (title, close; the theme decides the form)          | ends near 0.20                       |
| Caption row         | centre y 0.255, height 0.07: what this is ("Rebirth gives")              | centre 0.29                          |
| Value row           | centre y 0.37, height 0.15: chips or reward tiles                        | centre 0.41, height 0.16             |
| Requirement bar     | centre y 0.535, height 0.115, width 0.84, count on the bar               | centre 0.56, width 0.88              |
| Note line           | centre y 0.655, height 0.065, width 0.86, one line                       | centre 0.67                          |
| Action row          | centre y 0.815, height 0.15                                              | centre 0.83, height 0.16             |
| Empty under actions | 6 to 11% of P                                                            | at least 6%                          |

- Two actions: each 0.32 x 0.15; the confirm on the left with its right edge at 0.485 and the second action (cancel, skip) on the right with its left edge at 0.515, a 3% gap. One action: centred at x 0.5, about 0.4 wide.
- Before and after: two chips, each 0.37 x 0.15, centred at x 0.26 and 0.74, with a bare ">" (0.08 wide) between them.
- Reward tiles: up to three, each about 0.2 wide at y 0.33, height 0.22, gaps 0.03.
- Chips are at least 0.34 of the panel width. Never size them to their text.
- Optional extra: a purple gift button right of a purchasable "skip" action (shift both buttons left by 0.05).

## Components

Title, close, captions, value chips or reward tiles, requirement bar (icon and count grouped together on it), note line, confirm and cancel (or confirm and a skip), optional warning text in red `(255, 92, 92)` inside the panel.

## Density

Low on purpose. Every vertical gap is 0.04 to 0.05 of the panel, side padding is symmetric, the blocks are centred as a group. If something can shrink and still read, shrink it. An empty note slot stays empty; the actions do not move up.

## States

Both captions and values filled, the bar partly filled (never 0 or 100%), a note or an empty note slot. Disabled confirm when the requirement is not met: the muted button look, label unchanged, plus a note line saying what is missing.

## Phone and PC

Use the compact column above. The panel gets wider and taller in screen terms, never taller than 0.86 of the viewport; text stays at least 16 px and buttons at least 44 px. A confirm that must not be hit by accident gets the 3% gap and the cancel on the left. Dim or blur the world behind a dialog (theme says which).

## Failures to avoid

Confirm wider than cancel; buttons touching; content drifting to one side; text outside the panel; rows stretched edge to edge; chips sized to their text; an icon pinned to the far end of the bar instead of grouped with the count; a list layout that reflows the blocks into each other; a scroll bar in a dialog.

## Build order

1. ScreenGui and dim layer, panel with aspect lock.
2. Header from the theme.
3. Place the slots by fraction in this order: captions, value chips or tiles, bar, note, actions.
4. Fill demo data; set the bar by fraction (`polish.md` rules on a minimum visible fill).
5. Hook `onConfirm` and `onCancel` stubs, close = cancel.
6. Pop-in animation only (`polish.md`); no ambient loops on a dialog.
7. Check in the compact class, then audit and screenshot.
