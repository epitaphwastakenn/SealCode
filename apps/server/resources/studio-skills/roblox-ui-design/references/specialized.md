# Specialised widgets: wheel and reel

Two layouts are shipped as finished scripts with a small config table, not generated: the prize wheel (`layouts/wheel-spin.md`) and the vertical reel (`layouts/vertical-reel-roll.md`). They are original Harp code, plain Luau, built from native `Frame`s, `UIGradient`s and `TweenService`: no wedge art, no ring pictures, nothing to download. You change content by editing the tables at the top; you change geometry only if the user asks for a different mechanic.

| Widget | Template (source of truth)    | Same text as a loadable file | Layout contract                            |
| ------ | ----------------------------- | ---------------------------- | ------------------------------------------ |
| wheel  | `templates/wheel-spin.lua`    | (load the `.lua` directly)   | `references/layouts/wheel-spin.md`         |
| reel   | `templates/vertical-reel.lua` | (load the `.lua` directly)   | `references/layouts/vertical-reel-roll.md` |

Load the `.lua` template with `load_skill` together with its layout file in one call, copy it **verbatim** into the script, then edit only `CONFIG` and `STYLE`.

## Using a template

1. Create a `LocalScript` in `StarterPlayer.StarterPlayerScripts`, named `WheelSpin` or `VerticalReel` (the script name is also the marker later edits look for). One script per widget; a rebuild replaces only the ScreenGui of that name.
2. Paste the code. It builds its own `ScreenGui` (`WheelSpin` or `VerticalReel`, `ResetOnSpawn = false`) at runtime; nothing is placed in StarterGui.
3. Edit `CONFIG` (content and hooks) and `STYLE` (look). Do not edit the geometry below them for a content change.
4. Play test, screenshot, `inspect_ui` audit, then exercise the widget (see Proving it below).

To drive a widget from another script, make the file a `ModuleScript` (the last line is a commented `return`), uncomment `return wheel` or `return reel`, and `require` it from a LocalScript.

## Wheel config

| Field                                            | Meaning                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prizes`                                         | exactly eight entries, clockwise from the top: `name` (about 10 characters), `weight` (positive; total 100 so the shown percentages are true), `color`, `icon` (`rbxassetid://...`, ids from `icons.md`). No two neighbours share a colour, including 8 and 1. |
| `spins`                                          | the number in "You have N spins left"; `wheel.setSpins(n)` changes it later                                                                                                                                                                                    |
| `freeSpinText`, `packs`                          | the free-spin line and three `{ price, caption }` buy buttons (price shown with the Robux glyph)                                                                                                                                                               |
| `spinSeconds`, `extraTurns`, `jitterDegrees`     | duration (3 to 9 s), whole extra turns (min, max), random offset from the wedge centre (under 20; wedges are 45 degrees wide)                                                                                                                                  |
| `sounds`                                         | `hover`, `click`, `spin`, `reward` ids; remove a key to silence it                                                                                                                                                                                             |
| `requestSpin`                                    | **server authority**: a function that asks the server and returns the winning wedge 1 to 8 (or nil to refuse). Left nil, the client draws by weight, which is only for demos                                                                                   |
| `onResult(prize, index)`, `onBuyPack(packIndex)` | hooks for the game; the template grants and charges nothing itself                                                                                                                                                                                             |

How it stops: wedge `i` sits at `45 * (i - 1)` degrees clockwise from the top, the pointer is at the top, and the disc tweens (Quart out) to the rotation that leaves wedge `i` under the pointer plus a random offset of at most `jitterDegrees`. Eight wedges at exactly 45 degrees is a fixed property of the drawing; a different count means a different widget.

Server wiring sketch (the game's script, not the template's):

```lua
-- LocalScript, in the config:
requestSpin = function()
	return spinRemote:InvokeServer() -- the server checks the spin count, draws by weight, grants the prize, returns 1..8
end,
```

## Reel config

| Field                       | Meaning                                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `items`                     | the pool the strip is filled from (at least three): `name`, `chance` text (`"1/275"`), `rarity`, `value` text, `icon` (a number is a catalogue item id shown as a thumbnail, a string is an image id), `weight` for the demo draw |
| `rarityColors`              | one entry per rarity used in `items`; copy the game's own rarity table so shop, inventory and reel agree                                                                                                                          |
| `stripLength`, `winnerSlot` | cards in the strip (at least 20) and where the winner sits (at least 15, at most the length)                                                                                                                                      |
| `rollSeconds`               | 4 to 8 s, Quint out                                                                                                                                                                                                               |
| `requestRoll`               | **server authority**: returns the winning item (a table from `items`, or its index). Left nil, the client draws by weight (demo only)                                                                                             |
| `onLanded(item)`            | the hook after the strip stops and the winner's glow has started pulsing                                                                                                                                                          |

Each roll refills the same cards: the middle slot starts with the previous winner, the winner goes to `winnerSlot`, the other slots get random pool items (never the same as the card above or the winner), so the visible path differs every time and the instance count stays constant. `reel.roll(item)` rolls to a given item; `reel.show()` and `reel.hide()` open and close the screen (hiding is refused while rolling).

## Making it match a theme

- **Cartoon card:** the defaults. Swap the ink colour and gradients if the game's palette differs.
- **Classic or modern studs:** change `STYLE` colours to the theme's sets, and replace `makeButton` (wheel) and the ROLL button block (reel) with the theme's block constructor from `themes/studs-classic.md` or `studs-modern.md`. Keep the button's name and the `Face` child so `interact_ui` and the hover code still find them. Leave wedge shapes, the disc, the strip and the proximity code alone.
- **Other archetypes:** same idea: `STYLE.font`, ink, rim and button colours. Gold rims and dark inks suit fantasy; thin cyan rims suit sci-fi.

## Proving it

- Paths after a play test start: `PlayerGui.WheelSpin.Root.Controls.SpinRow.Spin.Face` and `PlayerGui.VerticalReel.Roll.Face`. `interact_ui` with `action: "click"` and that path clicks the button.
- Wheel: click SPIN, wait `spinSeconds + 1`, read the log line from `onResult`, and check in the screenshot that the pointer sits on the named wedge and the result line matches it. The SPIN button must be greyed while spinning and Close must be ignored.
- Reel: click ROLL, check the button disappears, wait `rollSeconds + 1`, then check the card in the middle slot has the name `onLanded` printed.
- Check both on a phone landscape and a phone portrait size (`capture_device_matrix`): the wheel box and reel window are Scale and aspect-locked, so they fit; names must still be legible (shorten them, do not edit geometry).
- Expected audit findings. Wheel: about a dozen `text_straddles_edge` warnings on the wedge name and chance labels (each label sits across the two triangle halves of its wedge, which are separate painted frames); the labels are wholly on the wedge colour. Reel: one `element_outside_viewport` warning per element of every card that is currently outside the window (the strip is hidden by design); about 160 of them. Judge both by screenshot, and audit the rest of the screen with `root` set to `PlayerGui.WheelSpin.Root.Controls` or `PlayerGui.VerticalReel.Roll`.

## What not to do

Do not rebuild the wheel from frames or the reel from a scrolling frame by hand; do not add remotes, purchases or data access inside the template; do not edit below the config and style tables to change content; do not decide a prize on the client in a live game; do not put the wheel or the reel in a card, a panel or a title bar.
