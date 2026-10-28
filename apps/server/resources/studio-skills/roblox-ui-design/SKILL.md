---
name: roblox-ui-design
description: "Use FIRST for any new or restyled Roblox screen: main menus, HUDs, shops, dialogs, inventories, leaderboards, notifications, wheels, reels. Visual design: style, colour, type, icons, themes, layouts, polish and visual review."
when_to_use: "Whenever the request is about how a UI looks: a style (cartoon, simulator, modern, studs, blocky, sci-fi, fantasy, AAA), a new screen, 'make it look good', a mockup or reference image, icons, a prize wheel or crate opening, or ugly, flat, generic or unreadable UI."
last_reviewed: 2026-10-20
---

# Roblox UI design (Harp)

This skill owns how a screen **looks**. `roblox-gui` owns how it **behaves** (scaling, text fitting, input, safe areas, devices). For a new screen load both: this one first, in the same `load_skill` call.

## Route

1. **Settle the style** (next section). Never build before the game's style is known or chosen.
2. **Pick the theme.** Three complete themes have every construction number, palette and asset id: `themes/cartoon-card.md` (white rounded cards, sticker buttons: simulators, tycoons, pets), `themes/studs-classic.md` (square bevel bricks), `themes/studs-modern.md` (rounded lipped bricks, the default for "studs" or "blocky"). For any other look use the archetypes in `references/gallery.md` (eighteen named looks; its "Choosing quickly" table maps wording to one) and `references/styles.md`.
3. **Pick the layout** by what the screen does: `references/layouts.md` is the index with the decision table; each layout has its own file (`layouts/shop-grid.md`, `centered-dialog.md`, `fullscreen-landing.md`, `admin-control-panel.md`, `hud-zone-system.md`, `select-screen.md`, `grid-inventory.md`, `vertical-navigation-sidebar.md`, `progression-hub.md`, `stat-leaderboard.md`, `incremental-clicker.md`, `notification-alert.md`, `wheel-spin.md`, `vertical-reel-roll.md`) plus variants (`loading-screen.md`, `purchase-confirm.md`, `inventory-detail.md`, `collection-index.md`, `daily-rewards.md`, `settings-panel.md`).
4. **Wheel or reel:** build from the shipped templates, never from scratch: `references/specialized.md` and `templates/wheel-spin.lua`, `templates/vertical-reel.lua`.
5. **Icons:** `references/icons.md` (resolution order, a catalogue of 107 verified ids, Creator Store search). One family per screen.
6. **WindUI:** only for the flat windowed archetype (admin, settings, tool windows): `references/windui.md`.
7. **Polish** with `references/polish.md`, then **review** with `references/validation.md`.

## Load in one call

A call returns at most about 48,000 characters and ten files, and files that do not fit are deferred to another call, so pick the set that fits and list `validation.md` last. Sizes are approximate.

| Task                              | `resources` (all in one `load_skill` call with `name: "roblox-ui-design"`)                                                                                                                                                            | Size      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Build a themed screen             | `references/themes/<theme>.md`, `references/layouts/<layout>.md`, `references/polish.md`, `references/validation.md`                                                                                                                  | 40 to 47k |
| Same, plus a variant or icons     | add the variant file (2 to 3k); load `references/icons.md` (18k) in a second call with `references/construction.md`                                                                                                                   |           |
| Another archetype (gallery looks) | `references/gallery.md` alone (50k), then a second call with the layout, `references/construction.md`, `polish.md`, `validation.md`                                                                                                   |           |
| Wheel or reel                     | `references/specialized.md`, `references/layouts/<wheel-spin or vertical-reel-roll>.md`, `templates/<wheel-spin or vertical-reel>.lua` (33k for the wheel, 28k for the reel); add the theme file in a second call only when restyling | 28 to 33k |
| Edit an existing screen           | the theme or archetype it uses, `references/validation.md`; skip polish unless asked                                                                                                                                                  |           |

Example: `load_skill { name: "roblox-ui-design", resources: ["references/themes/cartoon-card.md", "references/layouts/shop-grid.md", "references/polish.md", "references/validation.md"] }`.

## Choosing the style

Read the game's recorded choice first:

```lua
local style = game:GetService("StarterGui"):GetAttribute("SealCodeUiStyle")  -- nil when unset
```

- **Set:** follow it without asking. `match-existing` means copy the game's current UI (palette, fonts, corners, strokes: inspect StarterGui and measure real instances). Anything else is a theme name (`cartoon-card`, `studs-classic`, `studs-modern`) or a gallery archetype name.
- **Unset and StarterGui has no UI:** if the user named a style or sent a reference image, use that. Otherwise **ask before building**, with 3 to 4 options in one line each:
  - _Cartoon card:_ white rounded cards, chunky outlines, glossy sticker buttons (simulators, pets).
  - _Studs:_ toy-brick blocks with studs, square (classic) or rounded and lipped (modern).
  - _Modern / minimal:_ flat dark or light panels, thin lines, outlined icons.
  - _AAA / sleek:_ black translucent boxes, hairline borders, white caps text, the world visible behind.
  - Or name a gallery archetype (brainrot shop, sci-fi, fantasy...).
- **Unset and StarterGui already has UI:** inspect it first (every ScreenGui, fonts, colours, corner radii), then ask whether the new UI should **match the existing style** or use a **completely new style**.
- **Record the answer in the place** so other threads do not ask again, then build: `game:GetService("StarterGui"):SetAttribute("SealCodeUiStyle", "<match-existing | theme or archetype name>")`. If the user later asks for another style, update the attribute.

## Non-negotiables

- **Centre text by default.** `TextXAlignment` and `TextYAlignment` Center for button labels, titles, tabs, badges and chips; left alignment only for body copy, lists, rows with a value on the right, and inputs. Check centring in the screenshot, not in the properties.
- **Always check your work.** After every visual change take a screenshot in a Play test, compare it with the theme or archetype, fix what differs and look again before saying done (`references/validation.md`, including the `inspect_ui` audit and the device matrix).
- **Text is readable.** Light text on dark or saturated fills, dark text on light, a `UIStroke` on text over busy or gradient backgrounds, never outline-only text. Button labels are bold, at least 18 px on a phone; body at least 14.
- **Every interactive element looks pressable** in the theme's way, with hover, pressed and disabled looks, and is at least 44 px tall.
- **One accent colour carries the main action** (Play, Buy, Confirm); secondary actions are calmer, destructive red. Loud multi-colour buttons only in themes that define them.
- **Hierarchy by size first:** title largest, primary action the largest button, secondary smaller.
- **Space is designed:** gaps from the scale in `construction.md` (4, 8, 12, 16, 24, 32, 48), padding inside every container, nothing touching an edge by accident, nothing in the top-left keep-out.
- **One icon family per screen** (`references/icons.md`): icons from the catalogue or a verified set; no emoji, no letters as icons, no empty squares. A `UIGradient` multiplies the object's colour, so a gradient face is white.
- **Phone and PC both:** pick the size class (compact or regular, see `layouts.md`), size panels with an aspect lock, never in pixels from the viewport.
- **Name everything** (`MainMenu`, `PlayButton`, `Title`) and build the whole screen in one `build_instances` call or one builder script, so it is one undo step.
- **The device simulator ends where it started** (`capture_device_matrix` with `restoreAfter: true`).
- Gallery looks and themes are styles to learn from: never copy another game's art, logo or characters.

## Quick reference

- Fonts: cartoon card `FredokaOne` (numerals may use family `11702779409`); studs `FredokaOne` or `GothamBlack`; modern `BuilderSans`, `Montserrat`; AAA `GothamMedium` with `TitilliumWeb` or `Oswald` caps; sci-fi `Michroma`, `Sarpanch`; fantasy `Antique`, `Fondamento`, `Merriweather`. Use `Font.fromEnum` or `Font.fromName` and confirm the face exists.
- Corner radius: cartoon card panel `0.035` of the short side, buttons `0.3`, pills `0.45`; classic studs square; modern studs blocks 0.12 to 0.3 by kind; modern minimal 8 to 16 px; AAA 0 to 2; sci-fi 2.
- Lip: a frame behind the button, same size and corner, a darker shade, 4 to 6 px lower (or 6 to 12% of the height).
- Gradients: top lighter (+12%) to the base colour, `Rotation = 90`; the object colour is white. `UIGradient` on a `UIStroke` tints the stroke.
- Stroke: 3 to 7 px for cartoon and studs (scaled by `viewport.Y / 1080`, floor 1), 1 to 2 px modern; a darker shade of the palette (not pure black unless the theme says so), `ApplyStrokeMode = Border` on frames and buttons, `Contextual` on text.
- Patterns (stars, studs, checker, dots): a tiled `ImageLabel` (`ScaleType = Tile`, `TileSize`), faint and in a tint of the fill.
- Motion: hover scale 1.06, press 0.94, `Enum.EasingStyle.Back`, 0.12 s; open pop 0.85 to 1 over 0.22 to 0.35 s; text never pulses in size; pictures bob at least 10 px; no endless loops on anything large or containing text (`polish.md`).
