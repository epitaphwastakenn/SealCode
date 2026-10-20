---
name: roblox-ui-design
description: "Use FIRST for any new or restyled Roblox screen: main menus, HUDs, shops, dialogs, inventories, leaderboards, notifications. Visual design: style, colour, type, icons, component construction, layout, motion, and visual review."
when_to_use: "Whenever the request is about how a UI looks: a style (cartoon, simulator, modern, sci-fi, fantasy, blocky, AAA), a new screen, 'make it look good', a mockup or reference image, icons, or ugly, flat, generic or unreadable UI."
last_reviewed: 2026-10-20
---

# Roblox UI design (SealCode)

This skill owns how a screen **looks**. `roblox-gui` owns how it **behaves** (scaling, text fitting, input, safe areas, devices). Load both for a new screen: this one first, in the same `load_skill` call as `roblox-gui`.

## Route

1. **Settle the style** (next section). Never build before the game's style is known or chosen.
2. **Pick the archetype** in `references/gallery.md`: eighteen named looks (AAA sleek black panels, simulator white-panel cartoon, brainrot clickbait shop, studded blocky, monochrome minimal, viewport-frame item cards, world-space UI and more), each with palette, type, components and what looks good versus cheap. Its "Choosing quickly" table turns vague wording into an archetype. `references/styles.md` has the five broad families.
3. **Pick the layout** by what the screen is for: `references/layouts.md` (landing, shop grid, dialog, HUD, inventory, leaderboard, toast).
4. **Build with the recipes** in `references/construction.md` (lip buttons, cards, panels, titles, backgrounds), changed only as the archetype says.
5. **Icons:** `references/icons.md`. The user's icons if given; otherwise search the Creator Store for a set that matches the style. One family per screen.
6. **WindUI:** if the archetype is the flat windowed UI (admin, settings, tool windows) and a library saves effort, read `references/windui.md`. Not for cartoon HUDs.
7. **Polish** with `references/polish.md`, then **review** with `references/validation.md`.

Load what you need in **one** `load_skill` call, for example:
`load_skill { name: "roblox-ui-design", resources: ["references/gallery.md", "references/icons.md", "references/construction.md", "references/layouts.md", "references/polish.md", "references/validation.md"] }`
(add `references/styles.md` for the family palettes, `references/windui.md` only when using WindUI).

## Choosing the style

Read the game's recorded choice first:

```lua
local style = game:GetService("StarterGui"):GetAttribute("SealCodeUiStyle")  -- nil when unset
```

- **Set:** follow it without asking. `match-existing` means copy the game's current UI (palette, fonts, corners, strokes: inspect StarterGui and measure real instances); anything else is an archetype name from `gallery.md`.
- **Unset and StarterGui has no UI:** if the user named a style or sent a reference image, use that. Otherwise **ask before building**, offering 3 to 4 options with one-line descriptions, for example:
  - _Cartoon / simulator:_ chunky outlines, glossy lipped buttons, bright colours, 3D icons.
  - _Simple / minimal:_ flat rounded shapes, one accent colour, lots of space.
  - _Modern:_ clean flat dark or light panels, thin lines, outlined icons.
  - _AAA / sleek:_ black translucent boxes, hairline borders, white caps text, the world visible behind.
  - Or name an archetype from the gallery (brainrot shop, studded, sci-fi, fantasy...).
- **Unset and StarterGui already has UI:** inspect it first (every ScreenGui, fonts, colours, corner radii). Then ask whether the new UI should **match the existing style** or use a **completely new style**.
- **Record the answer in the place** so other threads do not ask again, then build:
  `game:GetService("StarterGui"):SetAttribute("SealCodeUiStyle", "<match-existing | archetype name>")`
  If the user later asks for another style, update the attribute.

## Non-negotiables

- **Centre text by default.** `TextXAlignment` and `TextYAlignment` Center for button labels, titles, tabs, badges and chips. Left alignment only for body copy, lists, rows with a value on the right, and inputs. Check centring in the screenshot, not in the properties.
- **Always check your work.** After every visual change take a screenshot in a Play test, compare it with the chosen archetype, fix what differs and look again before saying done (`references/validation.md`).
- **Text is always readable.** Light text on dark or saturated fills, dark text on light, a `UIStroke` on text over busy or gradient backgrounds. Never outline-only text. Button labels are white or near-black, bold, at least 18 px on a phone.
- **Every interactive element looks pressable** in the archetype's way (lip, rim, hover state), with hover, pressed and disabled looks. Flat default rectangles with default fonts are not designed UI.
- **One accent colour carries the main action** (Play, Buy, Confirm). Secondary actions are calmer, destructive red. Loud multi-colour buttons only in archetypes that define them (cartoon, simulator, brainrot, chunky kit), ordered by importance with size.
- **Hierarchy by size first:** title largest, primary action the largest button, secondary smaller.
- **Space is designed:** gaps from the scale in `construction.md`, padding inside every container, nothing touching an edge or another element by accident.
- **One icon family per screen** (`references/icons.md`). No emoji, no letters as icons, no empty squares.
- **Name everything** (`MainMenu`, `PlayButton`, `Title`) and build the whole screen in one `build_instances` call or one builder script, so it is one undo step.
- **The device simulator ends where it started** (`capture_device_matrix` with `restoreAfter: true`).
- Gallery looks are styles to learn from: never copy another game's art, logo or characters.

## Quick reference

- Fonts by archetype: cartoon `FredokaOne` or `LuckiestGuy`; simulator `FredokaOne`, `GothamBlack`, `BuilderSansExtraBold`; modern `BuilderSans`, `Montserrat`; AAA `GothamMedium` with `TitilliumWeb` or `Oswald` caps; sci-fi `Michroma`, `Sarpanch`; fantasy `Antique`, `Fondamento`, `Merriweather`. Use `Font.fromName` or `Enum.Font` and confirm the face exists.
- Corner radius: cartoon and simulator pill buttons `UDim.new(0.3, 0)` to `0.5`, panels 16 to 24 px; minimal 16 to 24; modern 8 to 16; AAA 0 to 2 (miter); sci-fi 2.
- Lip: a frame behind the button, same size and corner, darker shade, 4 to 6 px lower (or 6% of the height).
- Gradients: top lighter (+12%) to the base colour, `Rotation = 90`. `UIGradient` on a `UIStroke` tints the stroke.
- Stroke: 3 to 4 px for cartoon, 1 to 2 px modern, a darker shade of the palette (not pure black) with `ApplyStrokeMode = Border` on frames and `Contextual` on text.
- Patterns (checker, dots, studs): a tiled `ImageLabel` (`ScaleType = Tile`, `TileSize`), faint and in a tint of the fill.
- Motion: hover scale 1.06, press 0.94, `Enum.EasingStyle.Back`, 0.12 s; entrance pop from 0.8 to 1 over 0.35 s; no endless looping on anything large or containing text.
