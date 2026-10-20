# Layout variant: loading-screen

The landing layout with no buttons: the same backdrop and title, one progress bar and one status line. It tells the player the game is starting and leaves by itself.

**Use it when** the game, a round or a teleport is loading and nothing can be pressed. **Not when:** any button is needed (that is `fullscreen-landing.md`). Backdrop and title rules come from `fullscreen-landing.md`; this file lists what changes.

## Zones

| Zone           | Geometry (fractions of the screen S)                                                           |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Backdrop       | as in the landing: black at about 0.18 transparency, `ScreenInsets = None`, no blur            |
| Title          | as in the landing (zone A)                                                                     |
| Bar            | about 0.50 x 0.05 S, top edge near y 0.64, centred; track, fill and count from the theme's bar |
| Status line    | about 0.035 tall, directly under the bar ("Loading world 62%", "Almost there")                 |
| Tip (optional) | one line near y 0.90, muted: a gameplay hint                                                   |

No primary or secondary buttons, no close, no corner tiles. The control budget is zero.

## States

Seed a partly filled bar (30 to 80%) and a believable status. The fill is hidden at zero and at least 4% wide otherwise. On finish: bar full, status "Ready", then fade the whole screen out over 0.4 s and destroy it.

## Phone and PC

Same zones in Scale. On compact windows the bar is 0.70 wide and 0.06 tall, the status text at least 14 px, and the title the size given in the landing's compact notes.

## Failures to avoid

A button on a loading screen; a flat grey or hairline bar; a bar with no count or status; a backdrop too transparent; a bar that jumps backwards; a screen that never leaves.

## Build order

1. Reuse the landing's backdrop and title builders.
2. Bar from the theme (`setProgress(fraction)` clamps and hides zero).
3. Status and tip labels.
4. Drive `setProgress` from real load progress (`ContentProvider`, teleport data) or leave a demo value.
5. Fade-out on finish; audit; screenshot.
