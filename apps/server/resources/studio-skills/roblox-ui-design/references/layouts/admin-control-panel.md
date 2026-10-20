# Layout: admin-control-panel

A staff, owner, moderator or event console: a category rail at the left, a tightly packed grid of text-only command buttons at the right, and optional target and amount inputs above the grid.

**Use it when** commands are executed, not browsed. **Not when:** it is a settings window for players (`settings-panel.md`) or a tool window with many mixed controls, where the flat windowed archetype (gallery 5 and `windui.md`) saves effort.

Themes: dark panel versions of `themes/studs-classic.md` and `themes/studs-modern.md`, `themes/cartoon-card.md` (white card), or gallery 5. An operator console is never the light card of a modern studs panel, and it never blurs the world: the operator needs to see the game.

## Zones

Panel `P`, non-scrolling shell, centred.

| Zone               | Regular (PC)                                                                                                                                                                | Compact (phone)                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Panel              | 0.55 S wide; height 0.42 (1 to 2 command rows), 0.47 (3), 0.51 (4), 0.55 (5 or more, scrolls). Multiply the width by `min(1, 1.78 / viewport aspect)` on very wide windows. | 0.92 S wide, 0.88 S tall, ratio 1.8; rail on top                |
| Title bar          | about 0.11 of P (theme)                                                                                                                                                     | 0.14                                                            |
| Rail               | at (0.02, 0.14) of P, size (0.22, 0.83); category buttons 52 px tall, 8 px apart                                                                                            | a horizontal row of category chips, 44 px tall, under the title |
| Content pane       | at (0.26, 0.14), size (0.72, 0.83)                                                                                                                                          | the full width under the rail                                   |
| Target row         | 46 px: target input 70% wide, optional amount input 28%, dark inset fields                                                                                                  | same, stacked if narrower than 520 px                           |
| Command grid       | starts 54 px under the pane top; 3 columns of 0.313 with 0.03 gaps; 10 px row gap                                                                                           | 2 columns                                                       |
| Command row height | 145 px (1 to 2 rows), 96 px (3 rows), 64 px (4 or more)                                                                                                                     | 56 px                                                           |

The width never shrinks just because there are few commands: three columns must survive. Below about 0.55 S width the grid collapses to two columns; do not let that happen on regular windows.

## Components

Category rail buttons (at least three categories so the rail is not a dead strip, for example Actions, Players, Fun, World), target input, amount input, command buttons (label only), player-name buttons, close. Destructive commands (kick, ban, freeze, jail, kill) are red; others are not. Exactly one category button is lit (a colour, the rest grey).

## Density

- One category page exists at a time: hide or destroy the others.
- The grid and the target row together fill the pane. Empty space below the grid means the row height should step up.
- The default page is an action page, never Players.
- The Players page lists at least six demo names; clicking a name writes it into the target input (no separate "selected player" panel).
- No banners, art, icons, prices or descriptions. Commands are label-only buttons, never cards.

## States

Active category lit; target input filled or showing its placeholder; one command pressed; Players page with a highlighted target; disabled commands for a missing target (muted look).

## Phone and PC

This layout is PC-first. On a phone, turn the rail into a chip row above the content, use two columns, keep 56 px rows and 44 px minimum targets, and treat the text input carefully: the on-screen keyboard covers the lower half, so keep the target row at the top of the pane. Gamepad: not supported by default; say so if asked.

## Failures to avoid

A dead band under the grid; a two-tab rail; a top tab strip or dropdown instead of the rail; cards instead of label buttons; the wrong category highlighted for the visible page; destructive commands not red; a panel too narrow for three columns; Players as the default page; blurred world.

## Build order

1. Panel with aspect lock; width clamp for ultra-wide.
2. Title bar and close from the theme.
3. Rail as a `UIListLayout` of category buttons; active state function (`setCategory(name)`).
4. Content pane: target row, then a grid (`UIGridLayout`, pixel row height from the row count).
5. One page builder per category from a data table (`{ label, destructive, run }`).
6. Players page from the demo list; click sets the target text.
7. `run(command, target, amount)` stub that only prints; audit and screenshot.
