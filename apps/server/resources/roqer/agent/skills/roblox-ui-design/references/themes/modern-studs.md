# Theme: MODERN STUDS / rounded-studded-cartoon

Summary only. Build from `themes/modern-studs/part-1.md`, `themes/modern-studs/part-2.md`, and `selected/modern-studs/<layout>.md`; this page never replaces them. Repository-authored from a reference study of two published games, and benchmarked in Studio on a shop and a rebirth dialog.

MODERN STUDS is the default stud theme: every stud, studded, or blocky request uses it. CLASSIC STUDS (`themes/studs.md`) is for explicit classic requests, edits of screens built with it, and the reel template.

## Identity

- Every surface is one `makeSurface` block: rounded corners, black outline, a darker same-hue lip along the bottom, a face lighter at the top.
- Studs are embossed inside the face (the face is the stud image `rbxassetid://92521981645530`, tinted by its gradient), never a loud separate overlay.
- Fixed vocabulary: red close tile with a white X, green CTA and prices, purple gift, gold featured, grey inactive/owned, slate empty/locked.
- Item art always sits on the sunburst `rbxassetid://91084849147872`.
- White heavy text (FredokaOne) with a black outline; display numbers gradient-filled; Robux prices use the text glyph `utf8.char(0xE002)`.
- Panels: Dark (translucent navy body, coloured header band; default) or Light (white studded body, title and close straddling the top edge).
- Opening a panel blurs the world and pops the panel in.

## Differences from CLASSIC STUDS

| | CLASSIC STUDS | MODERN STUDS |
|---|---|---|
| Corners | Square, no `UICorner` | Rounded `UICorner` on every block |
| Depth | 4-layer bevel, face 0.88-0.94 | Base lip under a face, lip 0.05-0.12 |
| Studs | Separate overlay that must read clearly | Embossed in the face, subdued |
| Title | 50×50 icon inside a flat title bar | Dark band or straddling Light title |
| Robux price | Robux image icon | Robux text glyph |
| Panel open | Polish pop | Polish pop plus world blur |

## Shared engine rules

- No visible element inside the top-left 350×70 Core UI keep-out.
- Panel shape locked with a `UIAspectRatioConstraint`; panel height 0.40-0.66 unless a selected body says otherwise.
- Interactive blocks at least 44 px tall; no zero-scale widths; nothing rotated inside a `ScrollingFrame`.
- `ZIndexBehavior = Sibling`.

## Specialized layouts

`wheel-spin` deploys the MODERN STUDS wheel template (`templates/modern-studs/wheel-spin.lua`). MODERN STUDS has no reel template: `vertical-reel-roll` deploys the CLASSIC STUDS template unchanged, and the run says so once.
