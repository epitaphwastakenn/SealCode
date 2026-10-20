# Theme: Modern Studs

Rounded, lipped blocks with studs printed into the face. Everything on screen is a block: a black outline, rounded corners, a face that brightens toward the top and a darker strip of the same hue (the lip) under it. Art rests on sunbursts, text is heavy, white and black-outlined, and panels blur the world and pop open. This is the default brick look.

Gallery archetypes: **14** (studded blocky, the rounded form), with **12** (ribbon-and-bevel shop) and **13** (chunky slate kit) for the lip and candy-button ideas. Use **2** (viewport item cards) when items are 3D models. "Stud", "studded", "blocky" with no further word mean this theme. Use `themes/studs-classic.md` for square bricks.

How it combines: pick this theme for panels and widgets and lay out with any file in `layouts/`. HUD, sidebar, clicker, toasts and admin screens do not blur. The wheel template works as is, restyled with `STYLE` from this file; the reel template is theme-neutral, and its ROLL button should become a green block. Do not mix with cartoon card, AAA, sci-fi or fantasy on one screen, and never mix classic and modern constructions.

## Identity

1. Every element is a block with a black outline, round corners, a bright top and a lip. A square corner, a flat face or a missing lip is the classic look and counts as a defect here.
2. Studs are printed into the face (the face is the stud picture tinted by the face gradient). They are subdued: never the strongest thing on a block.
3. A fixed colour vocabulary: red close tile with a heavy white X; green main action and every price; purple gifts and secondary premium actions; gold featured goods; grey disabled or owned; slate empty or locked; inactive tabs keep their own hue, dimmed.
4. Product, reward and featured art always rests on a sunburst.
5. Text is heavy, white, black-outlined; large numbers on the panel body or over the world use a colour gradient; Robux prices use the Robux character (`utf8.char(0xE002)`, it renders as the logo) inside the text, not a picture.
6. Two panel flavours: Dark (translucent navy body with a coloured header band, the default) and Light (white studded body, title and close hanging over the top edge). One flavour per screen.
7. Opening a panel blurs the world and pops the panel into place.

## Palette

Each colour has a face top, a face bottom and a lip; the outline is always pure black. The face is white with a `UIGradient` from top to bottom (a gradient multiplies the object colour, so tinting a coloured frame would darken it twice).

| Name   | Face top          | Face bottom       | Lip              |
| ------ | ----------------- | ----------------- | ---------------- |
| green  | `(190, 255, 90)`  | `(40, 215, 30)`   | `(10, 140, 20)`  |
| red    | `(255, 120, 120)` | `(225, 20, 30)`   | `(130, 0, 10)`   |
| purple | `(215, 125, 250)` | `(150, 20, 230)`  | `(95, 5, 160)`   |
| yellow | `(255, 245, 110)` | `(250, 190, 20)`  | `(160, 105, 0)`  |
| orange | `(255, 210, 70)`  | `(240, 120, 10)`  | `(165, 80, 5)`   |
| blue   | `(120, 215, 255)` | `(20, 125, 240)`  | `(10, 65, 160)`  |
| cyan   | `(140, 250, 255)` | `(0, 195, 245)`   | `(0, 105, 160)`  |
| pink   | `(255, 150, 230)` | `(235, 40, 170)`  | `(140, 10, 100)` |
| gold   | `(255, 240, 130)` | `(240, 170, 20)`  | `(150, 95, 0)`   |
| silver | `(245, 248, 255)` | `(160, 170, 190)` | `(90, 98, 115)`  |
| bronze | `(255, 195, 135)` | `(205, 115, 50)`  | `(120, 60, 20)`  |
| grey   | `(240, 240, 245)` | `(165, 165, 178)` | `(95, 95, 108)`  |
| slate  | `(125, 130, 145)` | `(78, 82, 96)`    | `(45, 48, 58)`   |

Panel bodies: Dark `(13, 17, 23)` at 0.4 transparency; Light white. Scale strokes and decoration by `unit = panelHeight / designHeight` (floor 1), keep targets at 44 px or more, and take the panel's real size from the `ScreenGui`'s usable area (the viewport minus `GuiService:GetGuiInset()`).

Use of colour: green marks the primary action and every currency price and may be a card, tier or category colour, never cancel or destructive. Red is close, destructive, errors and urgent timers. Purple is gifts, skip, ads, boosts. Gold, yellow and orange mark featured, rare, achievement and first place: pick one of them per screen for featured goods. Blue, cyan and pink are neutral categories (tabs, HUD tiles, section bands), each destination keeping its colour. Grey means owned, claimed or disabled; slate means empty or locked. **Goods for sale are always vivid**: cards climb blue, green, cyan, purple, gold, pink as value rises. Collections colour by rarity: grey Common, green Uncommon, blue Rare, purple Epic, gold Legendary, pink Mythic.

Display-number gradients (top to bottom): cash `(180,255,135)` to `(90,215,55)`; gold `(255,245,140)` to `(255,170,0)`; gem or speed `(150,235,255)` to `(40,150,255)`; candy or event `(255,170,240)` to `(175,80,255)`. Warning text is `(255, 92, 92)` with the black outline. Green numerals on a green card, or gold on yellow, cannot be read: gradient numbers go only on the panel body, a grey or slate face, a banner of contrasting hue, or over the world.

## Typography

- `FredokaOne` (`Font.fromEnum(Enum.Font.FredokaOne)`). A whole screen may use `GothamBlack` for a cleaner look, but never both on one screen.
- All text is white with a black outline: 2 to 2.5 px for small text, 3 for buttons and headers, 3.5 for panel titles; `UIStroke.LineJoinMode = Round`; no plate behind it.
- **Extrusion** (a faux 3D lift) for panel titles, section titles, card and row names, card tags and big display numbers: a black copy of the text (`TextColor3` black, stroke black) with a white copy raised by 7% of the label's height drawn on top as its child, with the same size and the **same `TextXAlignment`** as the black copy (a centred copy over a left-aligned one drifts sideways). Descriptions, button prices and anything under 18 px do not extrude.
- Scaled text stops growing near 100 px; use `UITextSizeConstraint` and rich-text sizes above that.

## How a block is built

```
Frame Base       BackgroundColor3 = lip colour, UICorner, UIStroke 3 black Border (mandatory when the base is a button),
                 UIScale (hover 1.06, press 0.94)
└─ ImageLabel Face   Image = stud tile (92521981645530), ScaleType Tile, TileSize = stud edge,
                     BackgroundColor3 white, BackgroundTransparency 0, ImageTransparency 0.6,
                     Size {1,0},{1 - lip share,0}, UICorner (same radius as the base), UIGradient top -> bottom
   └─ content (text, icons, badges)   parented to the face so it draws above it and counts as "on" the block
```

The gradient tints the background and the studs together, so fill and studs shade as one. Stud tile edge = `max(8, face height x 4 / number of stud rows wanted)`, recomputed when the size changes so studs look equal at all resolutions (cards use a fixed 64 px tile). Block kinds (value, allowed range):

| Kind   | Used for                                   | Lip share            | Corner (of the short side) | Outline | Stud rows        | Stud transparency |
| ------ | ------------------------------------------ | -------------------- | -------------------------- | ------- | ---------------- | ----------------- |
| button | price, action, confirm                     | 0.12 (0.06 to 0.16)  | 0.22 (0.12 to 0.3)         | 3       | 2.5              | 0.6               |
| chip   | tabs, value chips, bars                    | 0.12 (0.08 to 0.16)  | 0.30                       | 3       | 2                | 0.7               |
| tile   | close, gift, HUD tiles, slots, rank badges | 0.07 (0.04 to 0.1)   | 0.16 (0.12 to 0.2)         | 4       | 4                | 0.6               |
| card   | product cards, rows, banners               | 0.05 (at least 4 px) | 10 px (8 to 14)            | 3       | fixed 64 px tile | 0.65              |
| band   | header band of a Dark panel                | 0.10                 | 10 px                      | 3       | 3                | 0.65              |

Staying inside these ranges keeps it reading as modern studs. To restyle an existing block (active tab, selected tile, owned state) swap the base colour and the gradient.

## Panels

Both flavours: an aspect-locked frame (`layouts.md`), a `UIScale` child for the opening pop, a 5 px black outline (Border mode), a 14 px corner radius, no lip, and an inner "rim" child frame with its own stroke (an object renders only one outline): inset 4 px, corner 11, 1.5 px `(70, 72, 84)` on Dark or 2 px `(175, 175, 185)` on Light. The content area scrolls only when the layout says so.

- **Dark:** the band is inset 8 px from the panel edges and 15% of the panel height (at least 56 px, so the close tile at 0.8 of it stays above 44 px), coloured per destination (Shop green, Index cyan, Rebirth yellow, Rewards purple, Trade blue, Settings grey). Inside it, left to right: a square icon and the extruded title (stroke 3.5) as one left-aligned group, and at the far right the red tile close (0.1 of the band width, 0.8 of its height, 8 px from the edge). One optional secondary action (a purple Gift of the same height) may sit left of the close. Timers and counters belong to the first row of content, not the band. Content starts 16 px under the band with 14 px side insets; scrollbar 6 px `(230, 230, 235)`.
- **Light:** the body itself is the stud image (tile 56 px, transparency 0.82) so the overhanging children sit on one painted object. The icon overhangs the top-left corner (centre 0.035, 0.02; size 0.1 x 0.15), the extruded title sits to its right (x 0.095, y 0.015, size 0.55 x 0.1), the red tile close hangs on the top-right corner (centre 0.975, 0.03; size 0.1 x 0.14); all three are children of the body. Content starts at y 0.11, height 0.89, 14 px side insets; scrollbar `(120, 120, 130)`.

## Surface kit

- **Close:** a red tile block with a white X (stroke 3), kept square by a height-dominant aspect constraint; inside the band (Dark) or on the corner (Light). Never the letter X or another colour.
- **Price button:** a green button block; its single label (glyph and amount) fills about 0.74 of the face height; for coin prices an icon then the amount, centred. At most about 30% of the card height, never under 44 px.
- **Gift button:** an optional purple tile beside a price button, same height, 6 px gap, the gift icon at 70% of its size.
- **Action button:** affirmative green, skip or boost purple, destructive red, cancel grey; a label alone, or an icon and label centred together.
- **Card** (product, reward, collection entry), as shares of the card height: name 0.04 to 0.18 (white, extruded, outline 2.5, centred, or left aligned at 0.6 width when a tag shares the row); art 0.18 to 0.75 (a transparent holder centred at x 0.5, y 0.465, size 1 x 0.57, square by a height-dominant aspect; the art fits 0.9 of it, 0.8 when it bobs; behind it a sunburst filling the art band with `ScaleType = Crop` at transparency 0.15; an oversized sunburst inside a clipping frame is reported by the audit as content beyond the scroll canvas); price row 0.77 to 0.96 (a button 0.74 x 0.19 anchored top-centre at y 0.77, or price plus gift). On yellow and gold faces tint the sunburst orange `(240, 120, 10)`; on every other face it stays white (an orange sunburst on an orange face disappears). Keep the bands separate; a card without art gets shorter.
- **Tag** (NEW!, HOT, BEST, -75%, LIMITED): bare coloured text, one per card, extruded with outline 3, right aligned inside the card's top-right corner within the name band (x 0.64 to 0.96, y 0.03 to 0.17). Red `(255, 60, 60)` for NEW!, HOT, OP! and discounts; a gold gradient for BEST, LIMITED, MOST POPULAR. Never a tag on a face of its own hue. Tags stay upright in scrollers.
- **Wide offer row:** a card block with aspect 3.2 to 3.6; a square holder (about 0.85 of the row height) on the left with a fitted sunburst and art at most 0.7 of the holder; a name and one description line in the middle; the price bottom-right; an optional tag top-right. It uses the same dense stud texture as everything else. It always sells a real product.
- **Section title:** a full-width strip 44 px (range 40 to 48) in the section's colour, fading at both ends (transparency keypoints 1, 0.55, 0.55, 1 at 0, 0.3, 0.7, 1), with a centred extruded title (60% x 80% of the strip, outline 3).
- **Tab rail** (rarity or world tabs on collections, Daily and Weekly on progression and leaderboards; shops never get one): chip blocks stacked vertically **outside** the panel edge but parented to the panel; right side by default (anchor top-left at x = panel width + 10 px, y = 0.14), left side only if nothing sits there. Rail width 0.2 of the panel, each tab 0.11 of the rail height with about 2% gaps. Only the tab matching the visible content keeps full colour and full width; the others are dimmed (face tinted `(150,150,150)`, lip darkened by 40%) and 0.9 wide, aligned to the panel so they still touch it. Use only when the panel is at most 0.55 of the screen wide.
- **HUD tile:** a tile block, aspect 0.97; the icon fitted at 0.8 x 0.8 of the face centred at (0.5, 0.45); the label is a child of the icon at (0.5, 0.92), 1.2 x 0.3 of the icon, outline 2.5; an optional badge is a red chip child of the face (not the base) at z-index 4: "NEW!" 0.46 x 0.18 centred at (0.84, 0), or "!" 0.28 x 0.28 at (0.94, 0.08). Icons keep their full size with a badge.
- **HUD offer:** not a block: one transparent image button with a square holder (0.17 of the screen height) holding a fitted sunburst and art at 0.76 (0.66 while bobbing), the name as outlined text 0.035 of the screen height, the price as green `(0, 255, 8)` outlined text with the Robux glyph, 0.03 of the screen height. Size it from the screen height.
- **Currency readout:** no plate; a transparent row with the icon (square, full row height) and a left-aligned value with outline 3 and the currency's gradient. Every currency has its own icon and gradient.
- **Value chip** (multipliers such as "x1.5 Money"): a chip block with one centred label; before and after are two chips with a plain outlined ">" between.
- **Progress bar:** one chip block whose face gradient encodes the fill: a horizontal gradient with a hard stop at the progress fraction between the bright fill colour and the track colour `(75, 78, 92)`, the base `(40, 42, 52)`, the fraction clamped to 0.001 to 0.998, the count on the face. One object, so the audit does not see text half on a fill frame.
- **Text input:** a slate chip block with the text box in its face, white text, outline 2, placeholder `(190, 190, 200)`.
- **Toggle:** a chip block track with a round knob block; green with "ON" when on, slate with "OFF" when off (the word carries the state as well as the colour).
- **Slider:** a slate chip block as the track with a coloured fill block inside and a tile block as the knob (gold), 44 px hit area, the value as outlined text to the right.
- **Badge:** a small red chip block with a white count, a child of the host face at z-index 4, top-right.
- **Ribbon:** a wide block strip (gold or red) across the top of a card or panel, its ends cut by two 45-degree rotated squares in the panel colour; text extruded; at most one per screen.

## Text over art

Art is drawn large with labels on it. Two placements pass the audit: the label is a child of the art image, or the art's box covers the entire face it lives on (size 1 x 1, fit scaling, no aspect constraint on the box) so the drawing stays square while the box reaches every label (day tiles, collection slots). A label crossing the border of a sibling art or sunburst box is a collision. Shop cards keep distinct bands.

## Presentation

Opening a panel: a named `BlurEffect` owned by the builder (reused if present, removed with the screen) rises to size 16 over 0.2 s while the panel's `UIScale` goes 0.85 to 1 with a Back-out curve over 0.22 s; closing returns the blur to 0 in 0.15 s. A screen that starts open plays the opening once after it is built. HUD, sidebar, clicker, toast and admin screens never blur. Hover and press use the `UIScale` on the block base (1.06 and 0.94); buttons and HUD tiles react, cards, offer rows and banners do not. The size or position of anything placed by a layout is never tweened.

## Assets

Image ids that rendered in a Studio play test (creators and licences are not recorded; keep them in one table so they can be swapped):

| Use                                                        | Id                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dense stud tile (4 x 4 per tile, embossed)                 | `92521981645530`                                                                                                                                                                                                 |
| sunburst, ImageTransparency 0.15                           | `91084849147872`                                                                                                                                                                                                 |
| chunkier stud alternatives                                 | `6927295847` (4 x 4, tile 50 to 70 px, transparency 0.7); `12055407192` (2 x 2 large, tile 40 px, transparency 0.7). The decal wrappers `6927295857` and `12055407253` do not load as images: use the image ids. |
| shop basket (shop header and HUD tile)                     | `110972987269284`                                                                                                                                                                                                |
| coin, cash stack, pig and money                            | `84697600263846`, `70565105539676`, `103120983042082`                                                                                                                                                            |
| diamond, crystal (gems)                                    | `75581768563141`, `73150429062000`                                                                                                                                                                               |
| gift, lock, check, crown                                   | `122416766679510`, `113981661296218`, `128850290702187`, `78843852703854`                                                                                                                                        |
| plain Robux image (never on a price button; use the glyph) | `87608142780557`                                                                                                                                                                                                 |

## Acceptance checklist

Every block built from the kit; one panel flavour; a red tile close; no stud pixels outside rounded corners (if they appear, raise the face's image transparency by 0.1); art on sunbursts; Robux glyph prices; one tab at full strength with the rest dimmed in their own hues and the rail outside the panel; blur and pop on panels but not on HUD, sidebar, clicker or toast; green never on cancel or destructive; nothing for sale in grey; owned and claimed grey; empty and locked slate; no size-pulsing text; badges are children of the block face at z-index 4; HUD tile icons 0.8 with the label over the foot; day tiles and collection slots covered by their art.
