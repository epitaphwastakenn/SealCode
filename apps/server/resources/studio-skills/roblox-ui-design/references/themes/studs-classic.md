# Theme: Classic Studs

Toy-brick UI. Every element is a square-cornered stack of layers: a dark base with a black outline, a bright shiny face, clearly visible studs, and heavy white text with a black outline, all on a translucent black panel. It looks like the old Roblox bricks.

Gallery archetype: **14** (studded blocky), in its square-cornered form. Use `themes/studs-modern.md` for the rounded, lipped version; "classic", "square", "old-style studs" and existing square-brick screens mean this theme. The two are never mixed on one screen, and converting a classic screen to modern is a redesign.

How it combines: pick this theme for panels and widgets, then lay out with any file in `layouts/`. Items shown on cards can come from a gallery 2 viewport frame. The wheel and reel templates are theme-neutral: restyle their `STYLE` table with the colour sets below and replace their button builder with `bevelButton`. Do not combine with the cartoon card, AAA, sci-fi or fantasy archetypes on one screen.

## Tokens

Pixel values are for a 1080p screen; scale strokes and decoration by `unit = panelHeight / designHeight` (a shop of 0.66 of the screen has design height 713), floor 1, and never let a target drop under 44 px. Take the panel's real size from the `ScreenGui`'s usable area (the viewport minus `GuiService:GetGuiInset()`, or the whole viewport with `ScreenInsets = None`).

| Token          | Value                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| panel          | black at 0.40 transparency, height 0.40 to 0.66 of the screen (see `layouts.md`)                                                                                                       |
| outline        | black, 4 px, on every base; the outline belongs to the base (`ApplyStrokeMode = Border`)                                                                                               |
| corners        | none: every frame is square                                                                                                                                                            |
| fonts          | `FredokaOne` everywhere                                                                                                                                                                |
| text           | white or near-white fill, black `UIStroke` 3 (large) or 2.5 (small), no plate behind a label; scaled-text cap about 100 px                                                             |
| display number | vertical gradient white at 0 to gold at 0.5 to gold at 1; timers use a red version; never flat                                                                                         |
| stud tiles     | dense `92521981645530` at transparency 0.5 to 0.6 (bars, buttons, cards); sparse `102751665779866` at about 0.32 with a gradient rotated about 60 degrees (wide featured banners only) |
| faces          | bright; dark tones belong to bases, outlines and the panel                                                                                                                             |

Colour sets (base / tint / main). A gradient multiplies the object's colour, so a face is white and its `UIGradient` runs from the tint at the top to the main colour at the bottom:

| Name   | Base (dark)     | Tint (top)        | Main (bottom)     |
| ------ | --------------- | ----------------- | ----------------- |
| green  | `(6, 84, 12)`   | `(190, 255, 190)` | `(34, 197, 63)`   |
| gold   | `(105, 70, 0)`  | `(255, 233, 170)` | `(255, 176, 16)`  |
| red    | `(120, 14, 14)` | `(255, 130, 130)` | `(239, 28, 28)`   |
| blue   | `(10, 40, 120)` | `(170, 220, 255)` | `(40, 120, 240)`  |
| purple | `(60, 20, 110)` | `(225, 190, 255)` | `(150, 70, 235)`  |
| cyan   | `(0, 80, 110)`  | `(180, 250, 255)` | `(0, 190, 235)`   |
| orange | `(120, 50, 0)`  | `(255, 215, 160)` | `(245, 125, 20)`  |
| grey   | `(55, 55, 65)`  | `(235, 235, 240)` | `(150, 150, 165)` |

Green marks the primary action and prices; gold marks featured goods and SPIN; red marks close and destructive actions; grey marks owned and disabled. Goods for sale are vivid, never grey.

## The four layers

Every panel root, title bar, close button, card, banner, bar and button is built from these (labels are never).

```
Frame Base      BackgroundColor3 = the dark shade, square corners, UIStroke 4 black Border
└─ Frame Face   Position {0,0},{0,0}, Size {1,0},{0.90,0}, BackgroundColor3 white, UIGradient (tint -> main, Rotation 90)
   ├─ ImageLabel Studs   Size {1,0},{1,0}, Image dense stud, ScaleType Tile, TileSize = edge x edge, ImageTransparency 0.55
   └─ content (icons, labels), ZIndex above the studs
```

Face height as a fraction of the base: title bar 0.88 (a flat single colour, the only gradient-free face), cards and banners 0.94, buttons 0.90. The strip of base below the face is the bevel. A button face may use a three-stop shine: white at 0, the tint at 0.1, the main colour at 1.

Stud tile edge, in pixels: title bars `round(1.3 x bar height)`, buttons `round(0.9 x button height)`, cards, banners and bars `round(0.6 x height)` clamped to 40 to 110. Studs must read at a glance; if a phone shows noise, raise the tile size. Content is always ordered above the face and the studs.

## Surface kit

- **Panel:** a `Frame` black at 0.40 transparency, centred, aspect-locked (`layouts.md`). The title bar and content sit inside it.
- **Title bar:** about 11% of the panel height (13.5% in dialogs, 10% in leaderboards) and at least 68 px, so the close tile (66% of the bar) stays at least 44 px. A flat colour face (gold, green or blue by destination). The icon is exactly 50 x 50 px inside the bar, about 1.5% from the left; the white outlined title starts about 1% after it. Content below starts at `(PAD px, title height as scale)` and has size `(width - 2 PAD px, 1 - title height as scale - PAD px)`: never a scale fraction in an offset slot.
- **Close:** a bright red bevel button (colour set red), square, about 66% of the bar's height, 6 px from the right edge, fully inside the bar, with a white X filling about 70% of it (two rotated bars with a black stroke 3). Taller than the bar is a structural fault.
- **Button:** the four layers; face 0.90; label area about 62% of the height; an icon about 55 to 60% of the height with a fixed pixel size; icon and text centred as a row with 4 to 6 px between them; at least 6% margin below inside its host; at least 140 x 48 px; at most about 30% of the card height. Green for the primary action; red allowed for destructive.
- **Price button:** green; the currency icon and the number form one centred row (row about 62% of the button height, 6 px spacing, icon about 60% of the button height). Robux: image `87608142780557` and the number; coins: image `84697600263846`.
- **Card:** the four layers with a 0.94 face. Bands as shares of the card height: name 2 to 18%, art 20 to 62% (fitted, aspect locked, ending above the button band), button 66 to 94%. Shrink the card instead of leaving a gap between art and button.
- **Banner:** a wide card; the sparse stud texture is for banners only and is tinted with the set's main colour (`ImageColor3`), otherwise it washes the face out to pale white; a sunburst `91084849147872` under the art at about 0.75 transparency, never rotated rectangles.
- **Currency chip:** a bevel chip about 16% x 5.5% of the screen with the icon at about 70% of its height; each currency a different icon (coin `84697600263846`, cash `70565105539676`, diamond `75581768563141`, crystal `73150429062000`).
- **Tabs:** square bevel buttons; the inactive tabs are desaturated, the active one bright. A vertical rail of square bevel buttons (about 9% of the panel height) is parented to the panel and flush against its left edge, top at 0.13.
- **Bar:** one bevel whose face gradient has a hard stop at the progress fraction: the bright fill colour left of it, the dark track colour `(35, 30, 45)` right of it (`Rotation = 0`, keypoints at 0, f, f + 0.001, 1); the icon and the count are children of the face, so the audit sees one painted object. HUD bar: the same with a saturated fill (green health, blue or yellow stamina) and a white count. At least 4% fill when above zero.
- **Slider:** a long bevel track with studs, a square bevel knob (colour set gold) with the face on top; value text to the right.
- **Toggle:** a grey bevel track with a bevel knob that slides; green when on, grey when off; the label inside the track says ON or OFF, so state never depends on colour alone.
- **Badge:** a red bevel square chip, about 28% of the host height, one per host, on its top-right corner; white count with a stroke.
- **Ribbon:** a wide gold bevel strip across the top of a card with its ends cut by two rotated red squares; text white with a black stroke; at most one per screen.
- **Headings:** bare text, no plate.

## Screen rules

- Panel height 0.40 to 0.66 of the screen; content ends within about 12% of the panel bottom; the title bar sits inside the panel.
- Interactive targets at least 44 px; squares have explicit pixel sizes (never a Scale width of 0 with an aspect constraint).
- No world blur, no backdrop blur; the world shows through the 0.40 black panel.
- Restyling an existing screen: delete the old close buttons and rebuild; recolouring while keeping old geometry is not acceptable.

## Polish for this theme

Hover and press via a `UIScale` (1.06 and 0.94); the bevel is the depth, so no extra shine overlay (nothing may cover the studs); text and colours pulse, pictures bob by at least 10 px; no rotated children in scrollers; icons keep their aspect and are never tinted.

## Assets

All ids are image ids that rendered in a Studio play test; their original creators and licences are not recorded, so treat them as swappable and keep them in one table in the builder.

| Use                                           | Id                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| dense stud tile                               | `92521981645530`                                                                             |
| sparse stud tile                              | `102751665779866` (opaque white tile with four studs; banners only)                          |
| sunburst                                      | `91084849147872`                                                                             |
| shop basket (title bars of shops)             | `110972987269284`                                                                            |
| pig and money                                 | `103120983042082`                                                                            |
| coin / cash stack / crystal / diamond / Robux | `84697600263846` / `70565105539676` / `73150429062000` / `75581768563141` / `87608142780557` |
| crown, gift, lock, check                      | `78843852703854`, `122416766679510`, `113981661296218`, `128850290702187`                    |

Other art comes from `icons.md` or the Creator Store; by default a classic card has no icon unless the slot needs one.

## Acceptance checklist

Square four-layer bevels; black stroke 4 on component bases; gradient faces except the title bar; studs legible at phone size; the title icon, title and close geometry above; exact ids; targets large enough; panel 0.40 to 0.66 high; white outlined text; green on primary actions only.
