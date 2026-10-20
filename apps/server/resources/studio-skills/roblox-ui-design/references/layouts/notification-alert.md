# Layout: notification-alert

Transient toasts and announcements: a reward, an achievement, an error, an info line, a server announcement. A toast never blocks, never needs a touch, and is one line.

**Use it when** the message leaves by itself. **Not when:** it waits for a click (`centered-dialog.md`) or it must stay on screen (HUD).

Themes: `themes/cartoon-card.md` (sticker bars), `themes/studs-classic.md` (bevel bars), `themes/studs-modern.md` (no blocks: bare, big, coloured text). Gallery 1 uses a thin outlined bar.

## Zones

One transparent stack `Frame` anchored top-centre at `(0.5, 0.03)` with a vertical `UIListLayout` (newest at the top, the stack grows downward, gaps about 1% of the screen height).

| Element      | Regular (PC)                                                                                                                              | Compact (phone)                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Toast        | about 0.24 x 0.055 S, identical size and construction for every toast; only colour and content vary                                       | 0.70 x 0.075, text at least 14 px |
| Icon         | left, about 65% of the toast height, 1.5% margin (optional)                                                                               | same                              |
| Message      | exactly one line, end-truncated, centred in the remaining width                                                                           | same                              |
| Announcement | one wide banner about 0.40 x 0.065, gold, replaces itself instead of stacking                                                             | 0.80 x 0.08                       |
| Modern studs | stack at (0.5, 0.1), size 0.60 x 0.30; each message a heavily stroked gradient label, height 0.16 of the stack (about 4.8% of the screen) | text height 0.06                  |

Kind colours: success and reward green, error and warning red-pink, info blue-cyan, rare and achievement gold. In modern studs the kinds are text gradients: cash green, gold, gem blue-cyan, error red.

## Behaviour (when wired)

Enter in 0.3 s or less (modern studs: scale 0.6 to 1, back-out, 0.2 s), hold 3 to 5 s (3 s in modern studs), exit and destroy (modern studs: fade text and strokes over 0.3 s). At most three visible: the fourth evicts the oldest. An announcement may stay up to 8 s. Nothing pulses during the hold. Keep one manager (`notify(kind, text)`) with the queue and the cap; builders do not tween list-placed objects' position (animate a child `UIScale` or the transparency instead).

## Components

Stack, toast (face, optional icon, label), announcement banner, manager function. No buttons, no close.

## Density

Top third of the screen only, never the centre. Messages never overlap or sit side by side. Shorten the text, do not shrink the font.

## States

Seed two or three toasts of different kinds at once so the first render shows the family: one reward, one error, one info.

## Phone and PC

Top-centre works on every aspect. On phones keep clear of the top bar and the core keep-out, widen the toast to 0.70 of the width, and keep it out of the thumbstick area. Readability beats polish: 14 px or larger with a stroke over the world.

## Failures to avoid

A two-line toast; a button on a toast; centre-screen placement; mixed sizes in one stack; overlapping messages; more than three at once; a backdrop or dim; a toast that says "tap to continue".

## Build order

1. ScreenGui (no reset), stack frame, list layout.
2. Toast builder from the theme taking `(kind, text, icon)`.
3. Manager: add, cap at three, schedule exit with `task.delay`, destroy.
4. Seed three toasts; compact sizes.
5. Audit for text overflow; screenshot; trigger one add and one eviction to check the cap.
