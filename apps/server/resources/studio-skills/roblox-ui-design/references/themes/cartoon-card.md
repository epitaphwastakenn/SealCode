# Theme: Cartoon Card

White rounded cards with dark outlines and a hard offset shadow, glossy two-stop "sticker" buttons, a chunky rounded font, a bare outlined title that hangs over the card's top edge, and a red close button on the top-right corner. There is no title bar. This is the look of simulator, tycoon and pet games.

Gallery archetypes: **7** (simulator white-panel cartoon) is this theme's windows and shops; **8** (glossy HUD kit) supplies the HUD pills and rail; **10** (patterned cards) is the same card with louder patterns; **9** (brainrot clickbait) and **13** (chunky slate) are loud or dark relatives. Use **2** (viewport item cards) inside this theme when items are 3D models. Use `themes/studs-modern.md` or `studs-classic.md` instead when the game's world is made of bricks.

How it combines: pick this theme for the panels, then lay out with any file in `layouts/`. The HUD may come from gallery 8 if it shares the palette and the ink colour; sci-fi, fantasy and AAA archetypes do not mix with it on one screen. One ink colour for the whole game: this theme's `ink` replaces the navy of gallery 7 (`#12203A`) or the other way round, never both.

## Tokens

All pixel values are for a 1080p screen. Compute `unit = panelHeight / designHeight` (the panel's real pixel height over its 1080p height, for example a shop of 0.66 of the screen has a design height of 713) and multiply strokes, lips, shadows and decoration by it with a floor of 1, so phones do not get heavy outlines. **Targets never scale below 44 px** (`max(44, design x unit)`), and scaled text keeps its size caps and floors. Take the panel's real size from the `ScreenGui`'s usable area (the viewport minus `GuiService:GetGuiInset()`, or the whole viewport when `ScreenInsets = None`), not from the raw viewport: on a phone the top bar costs about 58 px.

| Token         | Value                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ink           | `(42, 43, 49)` (the only outline colour on cards and buttons)                                                                                                 |
| glyph ink     | black `(0, 0, 0)` for outlines of white text on buttons and values                                                                                            |
| card          | white `(255, 255, 255)`, opaque                                                                                                                               |
| tile fill     | `(235, 240, 252)`; filled inventory slot `(224, 240, 255)`                                                                                                    |
| muted text    | `(84, 86, 98)`, no outline                                                                                                                                    |
| card corner   | `UDim.new(0.035, 0)` (fraction of the shorter side); tiles 0.12 to 0.14; buttons 0.3; pills 0.45 to 0.5                                                       |
| card stroke   | 7 px `ink`, `ApplyStrokeMode = Border`                                                                                                                        |
| button stroke | 4 px `ink`, Border mode; tile stroke 3; bar stroke 4                                                                                                          |
| shadow        | black at 0.75 transparency, 8 px lower, 6 px wider than the card, same corners                                                                                |
| fonts         | `FredokaOne` for everything (`Font.fromEnum(Enum.Font.FredokaOne)`); heavy numerals may use `Font.new("rbxassetid://11702779409", Enum.FontWeight.ExtraBold)` |
| text          | on colour or over the world: white with an outline (title navy 5, button label and value black 3, tile label 2.5); on a white card: `ink`, no outline         |
| spacing       | 4, 8, 12, 16, 24, 32 (see `construction.md`); content padding 16 to 24                                                                                        |

Action colours, light top to saturated bottom (a `UIGradient` with `Rotation = 90`; keep the object's `BackgroundColor3` white because a gradient multiplies it):

| Role                                      | Top               | Bottom            | Lip (darker)     |
| ----------------------------------------- | ----------------- | ----------------- | ---------------- |
| green: primary, confirm, buy, "on"        | `(163, 253, 28)`  | `(92, 239, 0)`    | `(31, 158, 58)`  |
| red-pink: close, back, destructive, "off" | `(255, 39, 125)`  | `(255, 2, 61)`    | `(150, 0, 35)`   |
| blue-cyan: secondary, save, info          | `(135, 255, 249)` | `(87, 216, 255)`  | `(29, 120, 170)` |
| grey: inactive, disabled, unselected      | `(208, 212, 238)` | `(147, 149, 168)` | `(90, 92, 110)`  |
| gold: featured, rank 1, special           | `(255, 245, 140)` | `(255, 170, 0)`   | `(180, 110, 0)`  |
| purple: gifts, boosts                     | `(215, 160, 255)` | `(150, 60, 240)`  | `(95, 25, 160)`  |

A secondary control is blue, never grey: grey reads as disabled.

Tier gradients for item tiles, top to bottom: common `(235,245,255)` to `(150,205,255)`; rare `(225,255,215)` to `(120,225,90)`; epic `(245,225,255)` to `(190,120,255)`; legendary `(255,245,200)` to `(255,190,60)`; mythic `(255,225,240)` to `(255,110,175)`. A shop row climbs through tiers instead of using one colour.

Currency: coins `(255,240,200)` pill with a value gradient `(255,230,90)` to `(255,150,20)`; gems `(245,220,255)` with `(240,150,255)` to `(160,60,255)`; rebirths `(255,225,230)` with `(255,110,120)` to `(220,20,50)`. Every currency has its own icon and gradient.

Special text exceptions: the clicker counter (cyan `(55,195,255)` to `(94,239,255)`), one yellow `(252,240,111)` label, and a rainbow gradient for ultimate text. Everything else is white or ink; accents live on surfaces.

## Surface kit

### Panel

```
Frame Wrapper (transparent; owns Position, Size, UIAspectRatioConstraint, UISizeConstraint)
├─ Frame Shadow   BackgroundColor3 black, BackgroundTransparency 0.75, UICorner like the card,
│                 Position {0, -3},{0, 45}, Size {1, 6},{1, -37}   (starts 45 px down so the title and close never cross it)
├─ ImageLabel Card  BackgroundColor3 white, Size {1,0},{1,0}, UICorner {0.035,0},
│                 UIStroke 7 ink Border, Image "rbxassetid://14605469420", ScaleType Tile, TileSize {0,110},{0,110},
│                 ImageColor3 ink, ImageTransparency 0.94     (a faint star pattern; never on buttons, tiles or text rows)
├─ (the title, icon, close and hanging pills are children of Card, so the audit sees their overhang as placed on purpose)
└─ Frame Content  Position {0.04,0},{0.14,0}, Size {0.92,0},{0.82,0}   (the top 12% is the band for title, icon, pills, close)
```

The wrapper is not clipped: the title, icon and close overhang on purpose. Last content row ends within about 8% of the card bottom.

### Title and icon

A bare `TextLabel` (no plate, bar or pill), a child of `Card`: `FredokaOne`, white, `UIStroke` 5 ink (Contextual), `TextScaled` off with `TextSize` about 8.5% of the panel height (minimum 18) and `AutomaticSize = X` so the text is centred in a box that hugs it (scaled text ignores automatic size), placed so it straddles the top edge starting about 0.03 of the card width from the left. A full-colour icon (88 px at 1080p, `ScaleType = Fit`) sits just left of the first letter with a 10 px gap, parented to the title so the pair moves as one.

### Close

A red sticker button, a child of `Card`, size about (6% of the card height + 45 px x unit) and at least 44 px, aspect about 1.05, centred on the card's top-right corner (x about 0.991) and above everything else on the card (`ZIndex` high). The X is two white rounded bars rotated 45 and -45 degrees with a black stroke, about 62% of the face wide and 14% thick; never the letter X.

### Sticker button (tabs, claim chips, on and off chips, CTAs)

```
Frame Button  (transparent, the hit area; size from the layout)
├─ Frame Lip   BackgroundColor3 lip colour, Position {0,0},{0,4}, Size {1,0},{1,0}, UICorner {0.3,0}      (CTAs only; flat chips skip it)
└─ TextButton Face   Text "", AutoButtonColor false, BackgroundColor3 white, Size {1,0},{1,-4} with a lip, UICorner {0.3,0},
   │            UIStroke 4 ink Border (border mode: an empty-text button would otherwise outline nothing), UIGradient top->bottom
   ├─ Frame Gloss   white, transparency 0.55 at the top fading to 1 at the middle (UIGradient Transparency), same corner, under the label
   └─ TextLabel Label  centred, FredokaOne white, TextScaled in about 90% x 62% of the button, UIStroke 3 black, UITextSizeConstraint (14, 48)
```

A `UIListLayout` that holds buttons needs `SortOrder = LayoutOrder` (the default sorts by name and shuffles the row). Hover scales a `UIScale` on `Button` to 1.06; press to 0.94 and the face moves down onto the lip; disabled swaps the gradient to grey and sets the label to 0.4 transparency. Buttons in one row have identical sizes. Targets are at least 44 px tall.

### Card and item tile

Item tile: white base, `UICorner` 0.14, `UIStroke` 3 ink, a vertical gradient from a pale top to the tier colour (above). Art fills 0.8 of the tile, centred at y 0.56. The name is white with a 2.5 px ink stroke, centred over the top of the art (a label 1.25 times the art width and 0.26 tall, at most 12 characters); a count such as `x3` is 0.6 x 0.3 over the bottom-right corner. Names, counts and timers are children of the art image and may overflow its box but must not cross a neighbour's border. A struck-through old price is rich text (`<s>...</s>`) in white with an ink stroke 2, at the art's bottom-right; ink text on a coloured tile over art is unreadable. An empty or locked slot is a grey-gradient tile with no art, or with a lock at 0.5 size.

Shop card: the tile on top (side = min(cell width, 150 px)), a 44 px price pill of the same width 8 px beneath it, never over the art. Card height = side + 8 + 44. The price pill is a green sticker button with the currency icon and the amount in one centred row.

Banner (wide offer row, 176 px tall at 1080p, full width): white base, corner 0.1, stroke 4 ink, a gradient per offer (starter pack `(255,220,60)` to `(255,140,20)`), the star pattern untinted at 0.8, art at 0.9 of the height 14 px from the left, the name 44 px tall (white, ink stroke 4), a dark amber `(120,60,0)` "Ends in: mm:ss" line, two to four reward tiles 76 px wide with 8 px gaps, and a green 150 x 52 price button at the bottom-right.

### Currency chip and HUD pieces

- Pill: 46 px tall, corner 0.5, ink stroke 4, the currency's pale fill, the star pattern at 0.93 with 40 px tiles. The icon is 1.45 times the pill height, centred over one end. The value is left aligned about 38 px in, 0.8 of the height, white with an ink stroke 3 and the currency gradient. A round green "+" (aspect 1, 0.85 of the height) may sit over the other end.
- HUD tile: 92 px, corner 0.22, stroke 4, its own gradient; the icon 0.82 of the tile at y 0.44; the label is a child of the icon over its lower end (bottom-centre anchor, y 1.14, 1.25 x 0.34 of the icon, ink stroke 3). Two-column grids use 14 x 18 padding.
- Wide button (Rewards, Free Gifts): 210 x 62 with an icon 1.5 times its height over the left end.
- Badge (a count, "!", NEW): round, aspect 1, 0.36 of the icon, red gradient, outline `(77, 0, 0)` 3, white count in the heavy numeral font with a dark red stroke, on the icon's top-right.

### Tabs

Sticker buttons in a row, the active one in its colour, the rest grey. An edge rail of square icon tabs may overhang the card's left edge (about 7% of the card width, its own shadow): icons stay in full colour and an inactive tab dims its own surface to grey, not the icon; red count badges allowed.

### Bars

Progress bar: track black at 0.5 transparency, fully rounded, ink stroke 4; fill white tinted with the blue-cyan gradient, ink stroke 3, 10% taller than the track; value text white with a black stroke 3. HUD health bar 420 x 38: dark track, a green fill slightly taller, white value on the bar. The fill is hidden at zero and at least 4% wide otherwise.

### Toggle and settings row

Row aspect about 6, transparent. The label at the left in `ink` with a text-size cap of 10 to 60. The right 40% holds a track (grey gradient `(194,192,220)` to `(148,145,167)`, stroke `(63,62,71)` 4, corner 0.125) carrying a sticker chip: green "On" or red "Off". An optional hint line in cyan sits under the label.

### Slider

Track: black at 0.5, fully rounded, ink stroke 4, 14 px thick. Fill: the blue-cyan gradient over the left part. Knob: a white sticker circle (aspect 1, stroke 4 ink, gloss) 36 px, on the end of the fill, with a 44 px transparent hit area around it. The value in `FredokaOne` white with a black stroke to the right.

### Ribbon

A banner for events and "best value": a centre `Frame` (gradient red-pink, ink stroke 4, corner 0.15) 0.7 of the card width, 54 px tall, overlapping the card's top edge; two darker tail frames (the lip colour) behind it, 14 px lower and 40 px wider each side, with a rotated square (45 degrees, card colour) notching each end; the title in white with a navy stroke. Place at most one per screen.

### Other pieces

- Pill control (search, pager): white, corner 0.45, ink stroke 4 Border, inner icon buttons square at 70 to 75% of the height; hangs over the top edge to the right of the title and stops short of the close.
- Section heading: a centred `ink` label between two 1 px divider lines (black at about 0.88 transparency, fading at the ends).
- Dark inset (inputs, wells): black at 0.75 transparency, corner 0.125, white outlined text. Locked overlay: the same dark layer over a row or cell with an "Unlock" label and a green price button.
- Avatar row: aspect about 6; round avatar with a 4 px ink stroke and an optional rank badge; the name in `ink`, the username in muted text; one sticker button at the right (about 32% of the row).
- Scroller: transparent, scrollbar 15 px in ink (6 to 8 px on phones), automatic canvas on Y.
- Sidebar (in-panel): the left 30% of the card, a vertical gradient `(230,230,230)` to white, corner 0.055, stacked sticker buttons.

## Layout notes

- Panels: wrapper height = a small scale plus a 120 px allowance and an aspect ratio of 1.25 (compact dialog), 1.7 (mid) or 1.95 (wide) keeps the card from collapsing on small screens; or use the aspect formula in `layouts.md`. Content gaps at least 4% of the card height; 6% empty below buttons in dialogs.
- Backdrop for menus: a gradient between two saturated colours, never flat grey (`styles.md`, family 1 and 2); for in-world panels a 0.45 black dim and no blur.
- Decor: confetti dots and rounded squares in the palette on the backdrop, 5 to 12% of its area; one sticker badge at most.

## Polish for this theme

Gloss on every button and card (`polish.md`); a hard shadow, never a soft one; tier colours on tiles; one NEW or HOT sticker per card at most, upright, inside the card; colour pulses (not size pulses) on tags and discount stickers; the title may wobble a degree or two. No world blur.

## Assets

No outside construction art: shadows, cards, buttons, cells and bars are native objects. The one texture: star pattern image `14605469420` (use the image id; the decal wrapper `14605469461` does not load as an image). Pictures are catalogue icons (`icons.md`) or avatar headshots. Heavy numeral font family `11702779409`.

## Acceptance checklist

White rounded card with the ink outline and the lower hard shadow; a bare stroked title with its icon locked beside it; a red close straddling the top-right corner; buttons with a Border-mode ink stroke and their semantic gradient; tier-coloured tiles with the price beneath; currency icons overlapping pill ends; text white-with-outline on colour and ink on white; no thin grey strokes, no default fonts, no soft shadows.
