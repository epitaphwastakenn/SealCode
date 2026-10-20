# Polish

Polish is what makes a screen feel made, not generated. It is **additive**: it never moves, resizes or recolours anything the theme or layout defines, and it never adds overlap, a mislabelled band, a lopsided row, cut-off content or lower density. When it disagrees with the layout or the theme, they win. Add it after the layout passes review, in a LocalScript next to the ScreenGui (or in the existing UI controller). Skip it when the user asks for plain, minimal or static UI. An edit to an existing screen does not get polish unless asked. The wheel and reel templates carry their own motion.

The idle state is the real design: a screenshot taken after the opening animation must equal the layout exactly.

## Motion

All motion is cosmetic (tweens). Use `TweenService`, keep the `Tween` objects so they are cancelled when the screen closes, and never use `RenderStepped` for UI motion.

| Moment                             | What happens                                                                                                                                                                                                                                                     | Time and easing                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A panel opens                      | its `UIScale` goes 0.85 to 1 (0.8 to 1 in the cartoon card theme), content transparency in; modern studs adds a blur to size 16                                                                                                                                  | 0.22 to 0.35 s, Back out (blur 0.2 s)                      |
| A panel closes                     | `UIScale` to 0.85 and transparency out; blur to 0                                                                                                                                                                                                                | 0.15 to 0.3 s, Quart in                                    |
| Button hover, press, release       | `UIScale` on the button holder 1.06, 0.94, back to 1; switch `AutoButtonColor` off                                                                                                                                                                               | 0.12 s each, Back out                                      |
| Card or list row under the pointer | no reaction. A full-width row has no spare width: a 1.03 scale made a row wider than its scroller and the panel clipped it. The buy button gives the hover feedback                                                                                              | none                                                       |
| Cards enter                        | on first show and whenever a tab changes, cards pop in one after another and grow to their normal size, never beyond                                                                                                                                             | at most 0.03 s between neighbours, 0.4 s for the whole set |
| Buttons enter                      | staggered pop from 0.8 to 1                                                                                                                                                                                                                                      | 0.05 s apart                                               |
| Number change                      | tween the displayed number (count up) rather than jumping                                                                                                                                                                                                        | 0.4 to 0.8 s, Quad out                                     |
| Toast                              | enter, hold, exit (see `layouts/notification-alert.md`)                                                                                                                                                                                                          | 0.3 s / 3 to 5 s / 0.3 s                                   |
| Ambient loops                      | at most two or three per screen: a featured picture bobs, an alert badge or discount tag calls attention, a highlight sweeps over the featured buy button (slide a gradient's `Offset`). Each loop is one repeating tween (Sine in-out, repeat forever, reverse) | 0.9 to 1.2 s per half cycle                                |

### What can move, and how

- **Text cannot be scaled smoothly.** Glyphs render only at whole font sizes: while a box shrank from 38 to 35 px its text hopped 24, 23, 22 px at different instants. Brief pops (hover, press, open) hide it; endless pulses do not. Never run a continuous scale on anything that holds text.
- To draw the eye to something with text (a discount tag, a NEW badge, a button), pulse its **colour**: oscillate the block's background between its rest colour and a dimmer one (about 190, 190, 190 on a white-backed gradient face) over about 0.6 s while the text keeps its size. A bare-text tag shifts its own colour toward a lighter tint. Away from scrollers, a badge may instead swing +-8 degrees over about 0.45 s, since a rotation carries text exactly. A title may wobble a degree or two over a slow 2 s cycle. Size pulses are for pictures with no text (an icon badge, a glow).
- **Bobbing is for pictures only** and needs at least 10 px of travel each way (20 px peak to peak) over 0.9 to 1.2 s: a 7 px bob over 1.4 s looked like a few uneven one-pixel jumps because the renderer snaps to whole pixels. Reserve the travel inside the picture's own band so it never touches the name or price. Text never bobs.
- Animate only: the `Scale` of a scale child, transparency, a background colour for attention, a gradient offset, and the position of a purely decorative picture. Never the size or position of anything placed by a list, a grid or the layout.
- Nothing rotated or tilted inside a scrolling container: rotated children are not clipped, so one that scrolls out of view draws outside the panel.
- No per-frame callbacks. A decorative countdown is one waiting loop (`task.wait(1)`) that exits when the screen leaves the game tree.
- Event handlers may start animations and flip visibility or tabs. They never purchase, award or read game data; that is wired to the named handler stubs later.

## Sound

One hover tick and one click, short and quiet (volume 0.3 to 0.5), one pair for the whole game, played from `SoundService` with `PlayLocalSound` or a pooled `Sound`. Add open and close sounds, a claim chime and an error buzz in the same family. Do not retrigger a hover sound while it is still playing. Give players a mute switch through the game's settings. Sound ids that rendered in a test and may be used as a starting set: hover `99955064134003`, click `87437544236708`, reward `4612378086`, long spin loop `5406934065`; keep them in the builder's table so they can be replaced.

## States

Every button has default, hover, pressed and disabled looks. Disabled: swap to the theme's grey (or desaturate to `#9AA3B2`), label at 0.4 transparency, no hover motion, `Active = false`. Purchasable, owned and equipped items must differ at a glance, by more than colour alone (OWNED text or a check icon, not just grey).

## Merchandising states

Seed these into a shop-style screen, always inside the layout's own cells and bands:

- **Tier** per card (Common, Rare, Epic, Legendary): classic studs encodes it in the face colour, cartoon card in the tile tint, modern studs in the palette colour of the card. Grey is never used for something for sale: grey means owned.
- **Tags** (HOT, NEW, BEST, x2) on one to three cards: a small upright sticker in a corner of the card, wholly inside it and away from the name, art and price. Modern studs uses coloured text, not a sticker.
- **Owned:** one item whose button reads OWNED in the theme's grey.
- **Discount:** the old price struck through (a `Frame` line across the text, or rich text `<s>`) beside the new, or a "-60%" tag.
- **Featured cue:** the banner carries a discount sticker or a running countdown ("ENDS IN 02:14:09").
- **Tabs:** once there are three or more categories, a strip of theme tabs at the head of the content may swap the visible category with the active one unmistakable. Two categories stay as stacked sections. Modern studs overrides this: a shop has no tabs, and other modern layouts put tabs in the rail outside the panel.
- **Balances:** when items cost soft currency, show coin and gem totals with small "+" buttons: pills overlapping the top edge in the cartoon card theme, the first content row in the studs themes (never inside a title bar).

## Finishing details

- **Gloss:** buttons and cards in the cartoon card theme get a white overlay with the same corner shape, transparency about 0.55 at the top to fully clear at the middle, over the gradient and under the text. Classic studs needs none (nothing may cover the studs); modern studs uses none (the lip and gradient provide the shine).
- **Outline thickness** scales with the window: store each stroke's 1080p thickness and multiply by `viewport.Y / 1080`, never below 1.
- **Text size caps** on scaled-text labels (`UITextSizeConstraint`, Max around 48 for labels, 100 for display) so large windows do not inflate text; and a Min of 14 for body and 12 for captions on phones.
- **Number formatting:** separators or suffixes (1,250 or 1.25K, 3.4M), never raw floats. Times as `mm:ss` or `hh:mm:ss`.
- **Close buttons:** a clear X made from two rotated frames or an icon, never the letter X in a random font.
- **Consistent icon sizes** and baselines with their text; icons centred as one group with their label.
- **Text over gradients or art** always has a stroke or a shadow.
- **One data table feeds every card** (name, picture, price, currency, tier, tag, owned, category); one empty purchase handler (`onPurchase`) near the top is where purchase code attaches later; small helper builders for text, cards and tweens; extend the theme's button builder with gloss and hover instead of making a second one.
- **Review step:** after the layout comparison, scan the screenshot for a tag or badge sitting on a name, art or price or outside the panel, for owned, discount and tier states that fail to read, and for an element photographed mid-animation. Stills cannot show motion, so do not run extra playtests just to watch it.
- **Reduced motion:** if the game has a setting, shorten open animations to 0.1 s and stop ambient loops.
