# Layout: vertical-reel-roll

A crate, case or egg opening: a dimmed world, a clipped vertical window through which a tall strip of item cards slides down and decelerates onto a predetermined winner. The card nearest the middle grows, brightens and glows. One ROLL button starts it. This is a specialised layout: build it from `templates/vertical-reel.lua` (see `references/specialized.md`).

**Use it when** an item is revealed by rolling through other items. **Not when:** the result is a wheel (`wheel-spin.md`), a single reveal with no roll (use a dialog with a reward tile: `centered-dialog.md`), or a choice (`select-screen.md`).

Themes: theme-neutral except for the ROLL button and the card look; the template carries the cartoon card look in a `STYLE` table. Rarity colours come from the game's own rarity table, the same as in its shop and inventory.

## Zones

This is the one layout that requires a backdrop: a full-screen black overlay at 0.45 transparency (`IgnoreGuiInset = true`). Placement is Scale of the screen S.

| Zone       | Geometry                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window     | centre (0.5, 0.45), fits 0.30 x 0.74 S at aspect 1:2 on wide windows (about 400 x 800 px at 1080p) and 0.62 x 0.62 S on tall ones (phone portrait); it clips its descendants and is a dark panel with a 4 px stroke |
| Holder     | as big as the window; slides down by `(slot - 2) / 3` of the window height                                                                                                                                          |
| Card       | square: 2/3 of the window width by 1/3 of its height; card `i` sits `(i - 2)` thirds above the middle at rest, so slot 2 rests in the middle and slot 1 shows below it                                              |
| Card parts | rarity line `chance \| rarity` (top 4 to 17%), icon (centre 44%, half the card), value line (68 to 79%), name (80 to 95%, always white). A glow image sits behind the card, tinted by rarity                        |
| Selector   | a static white 3 px outline round the middle slot, slightly larger than a card                                                                                                                                      |
| ROLL       | centre (0.5, 0.92), 0.22 x 0.09 S clamped to 150 x 48 min and 330 x 96 max px, green with a dice icon and the word ROLL in a lockup frame                                                                           |

No panel, title or close: the game closes the screen itself (`reel.hide()`) after the result is read.

## Components

Overlay, window, holder, strip of cards (24 by default), card glow, selector, ROLL button. Cards are built once; the strip is refilled before each roll, so the instance count stays constant.

## Density

Three cards visible, the middle one emphasised: scale 0.7 at rest to 1.1 in the middle, icon transparency 0.8 to 0.15, glow transparency 1 to 0.35, by distance in cards (full effect at the middle, none at 1.3 cards away). Only cards near the middle are updated while the holder moves.

## States

At rest the ROLL button is visible; while rolling it is hidden (so it cannot be pressed twice); when the strip lands the button returns and the winner's glow pulses three times. Next roll starts from where the last stopped: the previous winner is in the middle slot of the new strip.

## Behaviour

- Strip length at least 20 and the winner slot at least 15, so the roll travels far. The winner is decided by the game (`requestRoll`, a server decision) or by the demo's weighted draw; the animation never decides the prize.
- Roll time 4 to 8 s, `Quint` ease-out: a fast start and a long creep. Proximity styling follows the holder position; there is no per-frame loop when idle.
- A reduced-motion setting is a shorter `rollSeconds` (1.5 s) with the same landing.

## Phone and PC

The window keeps its 1:2 shape and fits inside 0.74 of the height, so on a 390 px tall phone it is about 290 px tall and cards are about 96 px: item names stay readable (about 11 px) but chance lines are tiny. The ROLL button is never under 150 x 48 px. The window is a vertical column, so landscape phones lose width, not height; keep the thumbstick corner free (the overlay does not accept world input anyway).

## Failures to avoid

An automatic roll without a click; no ROLL button, or extra buttons; chrome (panel, title, close) on the overlay; no overlay; scaling the fixed window or cards on top of the template's own sizing; a strip shorter than 20 or a winner earlier than the 15th card; made-up rarity colours that do not match the shop; a winner that does not land centred; edits below the config and style tables for a content change; a catalogue thumbnail icon that is moderated or slow with no fallback image.

## Build order

1. Copy the template into a LocalScript; keep the name `VerticalReel`.
2. Edit `CONFIG.items` (name, chance text, rarity, value text, icon, weight), `rarityColors`, `stripLength`, `winnerSlot`, `requestRoll`, `onLanded`.
3. Edit `STYLE` for the theme.
4. Play test; click ROLL through `interact_ui`; wait for the roll; check the landed card is the one `onLanded` reports and sits in the middle slot.
5. Audit and screenshot on a phone and a PC.
