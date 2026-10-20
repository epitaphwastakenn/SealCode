# Layout: shop-grid

A dense selling surface: coin packs, gamepasses, bundles, a featured offer. Every card holds exactly one product with a name, art and one price button.

**Use it when** the player spends currency or Robux on several items at once. **Not when:** the player manages things they own (`grid-inventory.md`), confirms one purchase (`purchase-confirm.md`), or picks one class or map for free (`select-screen.md`). A shop has prices and titled sections; an inventory has square slots and a capacity counter.

Themes: `themes/cartoon-card.md` (gallery 7, 10), `themes/studs-classic.md`, `themes/studs-modern.md` (gallery 12 and 14 for ribbon or brick shops, 2 for 3D item cards, 9 for the loud kids' shop).

## Zones

Panel `P`, centred. Fractions are of the panel unless marked S (screen).

| Zone           | Regular (PC)                                                    | Compact (phone)                                  |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| Panel size     | 0.46 S wide; height 0.40 / 0.53 / 0.56 / 0.66 S (below)         | 0.90 S tall, aspect ratio 1.75                   |
| Panel ratio    | `width * 16 / (height * 9)`, for example 0.46 x 0.66 gives 1.24 | 1.75                                             |
| Header         | top 0.11 to 0.15 of P (theme: band, bar or straddling title)    | top 0.16 of P                                    |
| Balance row    | first row of the content area, 36 to 40 px, left aligned        | same, chips shrink to icon + number              |
| Scroll area    | from 0.16 to 0.97 of P, 14 px side inset, 12 px between items   | from 0.18, 10 px inset and spacing               |
| Section title  | one row, 44 px, own colour per section                          | 36 px                                            |
| Card grid      | 3 columns, 14 px gap, cell width from the live scroller width   | 2 columns, 10 px gap, cell width at least 130 px |
| Card height    | 0.92 x width (cartoon card: tile side + 8 + 44 px price pill)   | 1.0 x width so the price button stays 44 px      |
| Wide offer row | full content width, height = width / 3.4 (range 3.2 to 3.6)     | width / 2.6                                      |

Height by content (regular): 0.40 for one card row and no wide row, 0.53 for two rows, 0.56 for a wide row plus one card row, 0.66 for three or more rows or a wide row plus two (the rest scrolls). If content stops more than about 25% short of the panel bottom, take the next smaller height; do not pad with invented products. Cards keep their size; they are never stretched to fill spare height.

Section order, top to bottom: featured or limited offers, currency packs, gamepasses, codes or extras. A section title names the kind (Currency, Passes), never repeats the one row below it.

## Components

- Section heading, product card (name band, art band, price band), wide offer row (art, name, one description line, price, optional tag), balance chips, tag (HOT, NEW, BEST, -75%, LIMITED), owned state, struck-through old price, close button, an optional gift button beside a price button.
- Card bands never overlap: name 4 to 18% of card height, art 18 to 75%, price row 77 to 96%. A card without art gets shorter; it does not keep a blank band.
- Currency packs climb in value: the card colour and the art escalate together, for example coin, cash stack, ingot, piggy bank, chest, crown. No two cards in a section share a picture. If there are not enough distinct pictures, sell fewer items.
- Gamepasses and limited offers use wide rows; currency packs use cards.
- Price button: one centred row of currency icon (or the Robux glyph) and amount. Every card shows a price, with its currency icon.

## Density

Even rows, full content width. At least one complete row of the first section is visible at first render and no row shows as a sliver at the fold: a row either starts below it or is cut by at least a third of its height (the padding nudge in `layouts.md`). Row heights are whole numbers of pixels. On a window narrower than 16:9 the aspect lock shrinks the panel, so a shop can show only the banner and the heading of the next section; that is acceptable if the banner is complete.

## States

Seed all of these: tiered cards (common, rare, epic, legendary through colour), one to three tags, one owned item (button reads OWNED in the theme's grey), one discount (old price struck through beside the new, or a -60% tag), a featured offer with a countdown or discount cue. Goods for sale are never grey: grey means owned.

Tabs: once there are three or more categories, a strip of tabs may swap the visible category (active tab unmistakable, same grid rules per category). Two categories stay as stacked sections. Modern Studs has no shop tabs at all.

## Phone and PC

- Columns: 3 regular, 2 compact. Measure the cell width from the scroller (`fitGrid` in `layouts.md`); a window that is not 1080p wraps cards wrongly if you assume 1009 px.
- Compact: panel 0.90 of the height, header shorter, prices at least 44 px tall, text 14 px or larger, wide rows get taller (aspect 2.6) so the price stays readable.
- Keep the top-left corner clear; the close button sits on the right.

## Failures to avoid

Half-cut rows at the fold; cards that grow to fill space; a banner that is decoration and sells nothing; a half-width banner; card rows narrower than the banner; labels floating over the grid; a price without its currency icon; prices on only some cards; empty art band; the same art repeated; a tab row on a Modern Studs shop; a card for sale painted grey; purchase confirmation as an inline popup inside a card (use `purchase-confirm.md`).

## Build order

1. ScreenGui, dim or blur per theme, panel with aspect lock and size constraints.
2. Header (title, icon, close) from the theme.
3. Scroller with a `UIListLayout` for sections; padding and scrollbar gutter.
4. Demo data table: items with name, art, price, currency, tier, tag, owned, section.
5. Section title builder, then card builder, then wide-row builder, all from the theme's kit.
6. `fitGrid` for each card grid; check the integer-rows rule.
7. Balance row, tags, owned and discount states, featured cue.
8. One `onPurchase(item)` stub; hover and press on buttons only (`polish.md`).
9. Play test, `inspect_ui` audit, `capture_device_matrix`, fix, repeat.
