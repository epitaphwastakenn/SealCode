# Layout variant: purchase-confirm

The small form of `centered-dialog.md`: one message and two buttons. It confirms one purchase or a destructive action. It is a separate dialog, never an inline popup inside a shop card.

**Use it when** a button in a shop, inventory or menu must be confirmed. **Not when:** it carries several values, a bar and a note (that is the full dialog).

## Zones

Panel `P`, non-scrolling, centred, with the world dimmed or blurred behind it.

| Zone     | Regular (PC)                                                                                                               | Compact (phone)                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Panel    | 0.30 x 0.34 S, ratio `w*16/(h*9)` about 1.57                                                                               | 0.70 S wide, 0.62 S tall, ratio 1.45 |
| Header   | the theme's header at the top, or a straddling title; close optional                                                       | same                                 |
| Message  | 0.86 x 0.22 of P centred at y 0.47: what is bought and for how much                                                        | 0.86 x 0.26 at y 0.46                |
| Item art | optional icon or tile above the message (cut the message to one line)                                                      | same                                 |
| Buttons  | two, each 0.38 x 0.20 of P at y 0.80; confirm on the left in the accent colour (red when destructive), cancel on the right | 0.40 x 0.20, at least 44 px tall     |

The gap between the buttons is about 3% of the panel width. Prices use the currency icon or the Robux glyph.

## States

Idle; confirm pressed (both buttons disabled while the purchase runs, the label shows "..."); success closes with the pop-out animation; failure shows a red note line and re-enables the buttons.

## Phone and PC

The panel is small, so the compact size class makes it wider; text 16 px or larger. A confirm that costs real money is at least 44 px tall and does not touch the cancel.

## Failures to avoid

A confirm that is wider or louder than cancel when the action is destructive; buttons touching; the price missing; the item unnamed; a popup that opens inside a card and scrolls away; no way out other than the confirm.

## Build order

1. Panel, header, message and buttons from the theme.
2. `confirm(item, onYes)` that fills the message and wires the two buttons.
3. Pop-in animation (`polish.md`); close on cancel or a click on the dim layer.
4. Audit; screenshot on both size classes.
