# Component construction

Recipes in instance terms. Sizes are for a 1920x1080 design; use Scale for placement and size the outer regions from the viewport (see `roblox-gui`), then let these inner offsets follow.

## Spacing scale

Use only these gaps and paddings (px at 1080p, or the same ratio in Scale): **4, 8, 12, 16, 24, 32, 48**. Inside a button: 12 to 16 horizontal padding. Between stacked buttons: 12 to 16. Panel padding: 24. Between title and first button: 32 to 48.

## Screen root

```
ScreenGui  MainMenu   (ResetOnSpawn = false, IgnoreGuiInset = true, ZIndexBehavior = Sibling)
├─ Frame  Backdrop    Size {1,0},{1,0}, BackgroundColor3 base, UIGradient (Rotation 90)
├─ Frame  Decor       Size full, BackgroundTransparency 1, ZIndex 1 (confetti, shapes)
└─ Frame  Content     AnchorPoint 0.5,0.5, Position {0.5,0},{0.5,0}, Size {0.42,0},{0.78,0},
                      UISizeConstraint (MinSize 320x420, MaxSize 720x900), ZIndex 2
   └─ UIListLayout (Vertical, HorizontalAlignment Center, VerticalAlignment Center, Padding 0.025 scale)
```

`IgnoreGuiInset = true` for full-screen backdrops; keep interactive content inside the safe area (`roblox-gui`).

## Button with lip (Cartoon, Simulator)

```
Frame  PlayButton          Size {1,0},{0,0} via UIAspectRatioConstraint (AspectRatio 4.2), BackgroundTransparency 1
├─ Frame  Lip              Size {1,0},{1,0}, Position {0,0},{0,6}, BackgroundColor3 = dark shade, UICorner same radius
├─ TextButton Face         Size {1,0},{1,0}, BackgroundColor3 = base, AutoButtonColor = false, Text = "",
│                          UICorner {0.35,0}, UIStroke (Thickness 4, Color ink, ApplyStrokeMode Border),
│                          UIGradient (light shade -> base, Rotation 90)
│  ├─ Frame Shine          Size {1,-12},{0.38,0}, Position {0,6},{0,5}, BackgroundColor3 white,
│  │                       BackgroundTransparency 0.72, UICorner same radius
│  └─ TextLabel Label      Size {1,-24},{0.62,0}, AnchorPoint 0.5,0.5, Position {0.5,0},{0.52,0},
│                          Text "PLAY", Font FredokaOne, TextScaled true + UITextSizeConstraint (Min 18, Max 56),
│                          TextColor3 white, UIStroke (Thickness 3, Color ink, ApplyStrokeMode Contextual)
```

- The lip sits **behind** the face (lower `ZIndex`, or earlier in a sibling order with `ZIndexBehavior = Sibling`).
- On press, move the face down by the lip offset (`Position` y + 6 px) and shrink the lip's visible part: it reads as a physical press.
- Primary buttons: AspectRatio 4 to 4.5 and the widest. Secondary: 0.85 of the primary width. Icon buttons: square (AspectRatio 1) with the icon at 60% of the face.

## Modern button

TextButton with `BackgroundColor3` accent, `UICorner` 8 px, no stroke or a 1 px light stroke, label `BuilderSans` Bold white, hover lightens the fill by 8%, a 2 px shadow frame at 0.85 transparency below.

## Title

```
Frame  TitleGroup  (Size {1,0},{0.22,0}, BackgroundTransparency 1, Rotation -4 for Cartoon)
├─ TextLabel TitleShadow  same text, TextColor3 dark shade, Position offset +5 px down, TextTransparency 0.1
└─ TextLabel Title        TextColor3 #FFF1B8 or white, Font LuckiestGuy/FredokaOne, TextScaled + UITextSizeConstraint (Max 120),
                          UIStroke Thickness 5, Color ink, LineJoinMode Round
```

A subtitle, if any, sits under the title at 35% of its size in the muted or white colour.

## Card (shop item, inventory slot)

```
Frame Card  (UIAspectRatioConstraint 0.8, UICorner 16, BackgroundColor3 white, UIStroke 3 ink)
├─ Frame Lip (behind, dark grey-blue, +5 px)
├─ Frame RarityBand (top 18%, rarity colour, UICorner 16 + a square Frame under its bottom half so only the top corners round)
├─ ImageLabel Icon (centre, 55% of the card, ScaleType Fit)
├─ TextLabel Name (FredokaOne, ink colour, under the icon)
└─ Frame PriceChip (bottom, pill, currency icon + amount, primary colour)
```

Grid: `UIGridLayout` with `CellSize` in Scale, `CellPadding` 12 to 16 px, inside a `ScrollingFrame` with `AutomaticCanvasSize` Y and `ScrollBarThickness` 6.

## Panel and dialog

Panel = rounded frame (radius 20 to 24 Cartoon, 10 Modern) with stroke, a header band in the accent colour holding the title, a close button (square icon button, top-right, overlapping the corner by half its size in Cartoon), content area with 24 px padding.

## Icons

- Prefer real icon images: search the Creator Store (`search_assets` with type Decal or Image, e.g. "coin icon", "gear icon") and check the thumbnail before use. Use one icon set per screen.
- Without assets, build simple icons from frames (a gear is not worth drawing; use a text label like "⚙" only if the font renders it, otherwise skip the icon). Never leave an empty square where an icon failed to load.

## Backgrounds that are not flat

- Gradient (two colours, `UIGradient` with 3 keypoints so the middle is brightest).
- Soft blobs: 3 to 5 large circles (`UICorner` 1,0) in lighter shades at 0.7 to 0.85 transparency, partly off-screen.
- Confetti: 12 to 25 small rotated squares and dots in the palette.
- For in-world menus (the game stays visible), use a dark gradient vignette at 0.35 to 0.5 transparency instead.
