---
name: roblox-ui-design
description: "Use FIRST for any new or restyled Roblox screen: main menus, HUDs, shops, dialogs, inventories, leaderboards, notifications. Visual design: style, colour, type, component construction, layout, motion, and visual review."
when_to_use: "Whenever the request is about how a UI looks: a style (cartoon, simulator, modern, sci-fi, fantasy, blocky), a new screen, 'make it look good', a mockup or reference image, or ugly, flat, generic or unreadable UI."
last_reviewed: 2026-10-20
---

# Roblox UI design (SealCode)

This skill owns how a screen **looks**. `roblox-gui` owns how it **behaves** (scaling, text fitting, input, safe areas, devices). Load both for a new screen: this one first, in the same `load_skill` call as `roblox-gui`.

## Route

1. **Pick the style family** from the request and the game: `references/styles.md` has five families with palettes, fonts and construction rules. If the user named a style or gave a reference image, that wins. If they gave nothing, choose the family that suits the game and say which.
2. **Pick the layout** by what the screen is for: `references/layouts.md` (landing/main menu, shop grid, dialog, HUD, inventory, leaderboard, toast).
3. **Build with the component recipes** in `references/construction.md`: buttons with a lip, cards, panels, titles, badges and icons. Do not invent a weaker version; every family uses the same skeleton.
4. **Polish** with `references/polish.md`: motion on hover, press and entrance, and the finishing details that separate a designed screen from a default one.
5. **Review it visually** with `references/validation.md`: a Play test screenshot on at least a phone and a PC, compared against the checklist, then fix and look again.

Load the references you need in **one** `load_skill` call, for example:
`load_skill { name: "roblox-ui-design", resources: ["references/styles.md", "references/construction.md", "references/layouts.md", "references/polish.md", "references/validation.md"] }`

## Non-negotiables

- **Text is always readable.** Light text on dark or saturated fills, dark text on light fills, and a `UIStroke` on text that sits on a busy or gradient background. Never outline-only text (a stroke with transparent or same-colour fill). Button labels are white or near-black, bold, and at least 18 px on a phone.
- **Every interactive element looks pressable:** a fill, a darker lip or shadow under it, a rounded corner and a stroke. Flat rectangles with default fonts are not designed UI.
- **One accent colour carries the main action** (Play, Buy, Confirm). Secondary actions use calmer colours, destructive actions red. Do not give every button a different loud colour unless the style family says so (Cartoon does: then order them by importance with size).
- **Hierarchy by size first:** the title is the largest thing, the primary action is the largest button, secondary buttons are smaller. Equal-sized buttons in a column read as a list, not a menu.
- **Space is designed:** consistent gaps from the spacing scale in `construction.md`, padding inside every container, nothing touching a screen edge or another element by accident.
- **Name everything** (`MainMenu`, `PlayButton`, `Title`) and build the whole screen in one `build_instances` call or one builder script, so it is one undo step and easy to edit.
- **The device simulator ends where it started.** Use `capture_device_matrix` with `restoreAfter: true`; never leave a phone simulation on for the user.

## Quick reference

- Fonts by family: Cartoon `FredokaOne` or `LuckiestGuy`; Simulator `FredokaOne`/`GothamBlack`; Modern `BuilderSans`/`Montserrat`; Sci-fi `Michroma`/`Oxanium`... use `Font.fromName("FredokaOne")` (or `Enum.Font` names) and check the face exists.
- Corner radius by family: Cartoon and Simulator `UDim.new(0.3, 0)` on buttons (pill), `UDim.new(0, 16)` on panels; Modern `UDim.new(0, 8)`; Sci-fi `UDim.new(0, 2)` with cut corners drawn by frames.
- Lip (pressable depth): a frame behind the button, same size and corner, darker shade of the fill, offset 4 to 6 px down (`Position` + offset) or 6% of the button height.
- Gradients: `UIGradient` on fills, top lighter (+12% lightness) to bottom base colour, `Rotation = 90`. Never on text that also has a stroke of the same hue.
- Stroke: `UIStroke` thickness 3 to 4 px for Cartoon, 1 to 2 px for Modern, in the darkest shade of the palette; set `ApplyStrokeMode = Border` on frames and buttons, `Contextual` on text.
- Motion: hover scale 1.06, press 0.94 with `Enum.EasingStyle.Back`, 0.12 s; entrance pop from 0.8 to 1 over 0.35 s. No endless looping animation on anything larger than a small badge.
