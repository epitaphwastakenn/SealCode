# MODERN STUDS theme - part 2/2: panels, components, presentation, rules

> Repository-authored from the modern-stud reference study; benchmarked in Studio on a shop and a rebirth dialog. Uses the surface kit from part 1 (`makeSurface`, `paint`, `makeText`, `PALETTE`, `ROBUX`, `SUNBURST`).

## Panels

Pick ONE variant per screen and use it for every panel on that screen. **Dark** is the default. Use **Light** when the user asks for a light, white, or clean look, or the project's existing panels are white.

Both variants:
- Panel size comes from the selected layout body. Lock its 1080p shape with `AspectRatio = (widthScale × 16) / (heightScale × 9)` (core generation, Responsive geometry); derive pixel measurements inside it from the panel's `AbsoluteSize`.
- A `UIScale` child on the panel, for the open pop.
- Outline: black `UIStroke` 5 with `ApplyStrokeMode.Border`, `UICorner` 14 px.
- The light inner rim is a child Frame with its own stroke: one object renders one stroke.
- Panels have no lip.
- **Content scrolls only when the selected body says so.** Pass `scrolls = false` for any layout that does not scroll; its `Content` is then a plain Frame and Scale sizes inside it are shares of the visible area. Inside a scrolling `Content`, size children in pixels computed from `content.AbsoluteSize` (Scale X is safe, Scale Y is not).

### Dark variant (default): translucent body, coloured header band

```lua
local HEADER_H = 0.15 -- band height, share of panel height
local PAD = 14        -- content inset, px

-- The panel's content area. scrolls = false for layouts that never scroll (dialogs, select
-- screens, consoles): inside a ScrollingFrame, Scale heights resolve against the canvas, which
-- grows with its own contents, so a dialog sized in Scale there overflows its panel.
local function makeContent(panel, scrolls, barColor)
	local content = Instance.new(scrolls == false and "Frame" or "ScrollingFrame")
	content.Name = "Content"
	content.BackgroundTransparency = 1
	content.BorderSizePixel = 0
	if scrolls ~= false then
		content.AutomaticCanvasSize = Enum.AutomaticSize.Y
		content.CanvasSize = UDim2.new()
		content.ScrollingDirection = Enum.ScrollingDirection.Y
		content.VerticalScrollBarInset = Enum.ScrollBarInset.Always -- rows stop short of the bar instead of running under it
		content.ScrollBarThickness = 6
		content.ScrollBarImageColor3 = barColor
	end
	content.Parent = panel
	return content
end

local function makePanelDark(gui, name, widthScale, heightScale, headerColor, title, iconId, scrolls)
	local panel = Instance.new("Frame")
	panel.Name = name
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.fromScale(widthScale, heightScale)
	panel.BackgroundColor3 = Color3.fromRGB(13, 17, 23)
	panel.BackgroundTransparency = 0.4
	panel.BorderSizePixel = 0
	panel.Parent = gui
	local aspect = Instance.new("UIAspectRatioConstraint")
	aspect.AspectRatio = (widthScale * 16) / (heightScale * 9)
	aspect.Parent = panel
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 14)
	corner.Parent = panel
	local stroke = Instance.new("UIStroke")
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Thickness = 5
	stroke.Parent = panel
	Instance.new("UIScale").Parent = panel

	local rim = Instance.new("Frame")
	rim.Name = "Rim"
	rim.BackgroundTransparency = 1
	rim.Position = UDim2.fromOffset(4, 4)
	rim.Size = UDim2.new(1, -8, 1, -8)
	rim.Parent = panel
	local rimCorner = Instance.new("UICorner")
	rimCorner.CornerRadius = UDim.new(0, 11)
	rimCorner.Parent = rim
	local rimStroke = Instance.new("UIStroke")
	rimStroke.Color = Color3.fromRGB(70, 72, 84)
	rimStroke.Thickness = 1.5
	rimStroke.Parent = rim

	local band, bandFace = makeSurface(panel, "band", headerColor)
	band.Name = "Header"
	band.Position = UDim2.fromOffset(8, 8)
	band.Size = UDim2.new(1, -16, HEADER_H, 0)

	local row = Instance.new("Frame") -- icon + title, one left-aligned group
	row.BackgroundTransparency = 1
	row.AnchorPoint = Vector2.new(0, 0.5)
	row.Position = UDim2.new(0, 10, 0.5, 0)
	row.Size = UDim2.new(0.62, 0, 0.84, 0)
	row.ZIndex = 3
	row.Parent = bandFace
	local list = Instance.new("UIListLayout")
	list.FillDirection = Enum.FillDirection.Horizontal
	list.VerticalAlignment = Enum.VerticalAlignment.Center
	list.SortOrder = Enum.SortOrder.LayoutOrder
	list.Padding = UDim.new(0, 8)
	list.Parent = row
	local icon = Instance.new("ImageLabel")
	icon.BackgroundTransparency = 1
	icon.Image = iconId
	icon.ScaleType = Enum.ScaleType.Fit
	icon.Size = UDim2.fromScale(1, 1)
	icon.LayoutOrder = 1
	icon.Parent = row
	local square = Instance.new("UIAspectRatioConstraint")
	square.DominantAxis = Enum.DominantAxis.Height
	square.Parent = icon
	local titleLabel = makeText(row, title, { size = UDim2.fromScale(0.8, 0.78), align = Enum.TextXAlignment.Left, stroke = 3.5, extrude = true })
	titleLabel.LayoutOrder = 2

	local close, closeFace = makeSurface(bandFace, "tile", "red", true)
	close.Name = "Close"
	close.AnchorPoint = Vector2.new(1, 0.5)
	close.Position = UDim2.new(1, -8, 0.5, 0)
	close.Size = UDim2.new(0.1, 0, 0.8, 0)
	close.ZIndex = 3
	local closeSquare = Instance.new("UIAspectRatioConstraint")
	closeSquare.DominantAxis = Enum.DominantAxis.Height
	closeSquare.Parent = close
	makeText(closeFace, "X", { size = UDim2.fromScale(0.72, 0.72), stroke = 3 })

	local content = makeContent(panel, scrolls, Color3.fromRGB(230, 230, 235))
	content.Position = UDim2.new(0, PAD, HEADER_H, 16)
	content.Size = UDim2.new(1, -2 * PAD, 1 - HEADER_H, -16 - PAD)
	return panel, content, close, bandFace
end
```

Each panel has its own stable header colour, for example Shop green, Index cyan, Rebirth yellow, Rewards purple, Trade blue, Settings grey. Only the icon, the title, the close button, and at most ONE secondary header action (a `button` surface such as a purple Gift, left of close, same height as close) live in the band. Timers and counters go on the first content row.

### Light variant: white studded body, straddling title and close

```lua
local PAD = 14 -- content inset, px (the same value the Dark variant uses)

local function makePanelLight(gui, name, widthScale, heightScale, title, iconId, scrolls)
	local panel = Instance.new("ImageLabel") -- the body is the stud image, so straddling children sit on one painted element
	panel.Name = name
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.fromScale(widthScale, heightScale)
	panel.BackgroundColor3 = Color3.new(1, 1, 1)
	panel.BorderSizePixel = 0
	panel.Image = STUDS
	panel.ScaleType = Enum.ScaleType.Tile
	panel.TileSize = UDim2.fromOffset(56, 56)
	panel.ImageTransparency = 0.82
	panel.Parent = gui
	local aspect = Instance.new("UIAspectRatioConstraint")
	aspect.AspectRatio = (widthScale * 16) / (heightScale * 9)
	aspect.Parent = panel
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 14)
	corner.Parent = panel
	local stroke = Instance.new("UIStroke")
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Thickness = 5
	stroke.Parent = panel
	Instance.new("UIScale").Parent = panel

	local rim = Instance.new("Frame")
	rim.Name = "Rim"
	rim.BackgroundTransparency = 1
	rim.Position = UDim2.fromOffset(4, 4)
	rim.Size = UDim2.new(1, -8, 1, -8)
	rim.Parent = panel
	local rimCorner = Instance.new("UICorner")
	rimCorner.CornerRadius = UDim.new(0, 11)
	rimCorner.Parent = rim
	local rimStroke = Instance.new("UIStroke")
	rimStroke.Color = Color3.fromRGB(175, 175, 185)
	rimStroke.Thickness = 2
	rimStroke.Parent = rim

	local icon = Instance.new("ImageLabel") -- overflows the top-left corner on purpose
	icon.BackgroundTransparency = 1
	icon.Image = iconId
	icon.ScaleType = Enum.ScaleType.Fit
	icon.AnchorPoint = Vector2.new(0.5, 0.5)
	icon.Position = UDim2.fromScale(0.035, 0.02)
	icon.Size = UDim2.fromScale(0.1, 0.15)
	icon.ZIndex = 3
	icon.Parent = panel
	local square = Instance.new("UIAspectRatioConstraint")
	square.DominantAxis = Enum.DominantAxis.Height
	square.Parent = icon
	makeText(panel, title, {
		anchor = Vector2.new(0, 0.5), position = UDim2.fromScale(0.095, 0.015), size = UDim2.fromScale(0.55, 0.1),
		align = Enum.TextXAlignment.Left, stroke = 3.5, extrude = true,
	})

	local close, closeFace = makeSurface(panel, "tile", "red", true) -- straddles the top-right corner
	close.Name = "Close"
	close.AnchorPoint = Vector2.new(0.5, 0.5)
	close.Position = UDim2.fromScale(0.975, 0.03)
	close.Size = UDim2.fromScale(0.1, 0.14)
	close.ZIndex = 3
	local closeSquare = Instance.new("UIAspectRatioConstraint")
	closeSquare.DominantAxis = Enum.DominantAxis.Height
	closeSquare.Parent = close
	makeText(closeFace, "X", { size = UDim2.fromScale(0.72, 0.72), stroke = 3 })

	local content = makeContent(panel, scrolls, Color3.fromRGB(120, 120, 130))
	content.Position = UDim2.new(0, PAD, 0.11, 0)
	content.Size = UDim2.new(1, -2 * PAD, 0.89, -PAD)
	return panel, content, close
end
```

The title, icon, and close are CHILDREN of the panel body: the UI audit treats a child crossing its parent's edge as placed, while a sibling crossing a painted edge is a collision.

## Components

All of these are `makeSurface` blocks. Text, art, and buttons are children of a block's `Face`, so they render above it and the audit reads them as on it.

**Text over art.** Both reference games draw art big and put labels over it. A label may sit on a picture in two ways, and the UI audit accepts both:
- the label is a CHILD of the art image (a HUD tile's name over its icon's foot, a tag on HUD-offer art); or
- the art's box covers the whole face it sits on: `Size = UDim2.fromScale(1, 1)`, `ScaleType.Fit`, and no aspect constraint on the box, its sunburst, or its holder. The picture stays square while its box reaches every label (day tiles, collection slots).

A label that crosses the edge of a sibling art or sunburst box is the collision the audit reports. Shop cards keep their separate bands (Card).

- **Close**: always the `tile` red block with a white "X" (`makeText`, stroke 3), square through a height-dominant `UIAspectRatioConstraint`. Inside the band (Dark) or straddling the top-right corner (Light). Never a bare "X" label, never a different colour.
- **Price button**: `button` green block, ONE label `ROBUX .. " " .. price` at ~0.74 of the face's height (or the coin icon beside an amount for coin prices: icon left, amount right, one centred `UIListLayout` row). At most ~30% of its card's height, at least 44 px tall.
- **Gift button**: `tile` purple square beside a price button, the same height, with the Gift icon at 70% of its size. Optional; when present it sits to the right of the price button with a 6 px gap.
- **Action button**: `button` block, green for the affirmative action, purple for skip/boost, red for destructive, grey for cancel. Label only, or icon left of the label as one centred group.
- **Card** (product, reward, collection entry): `card` block. Bands top to bottom, as shares of card height:
  - name 0.04-0.18: white, extruded, stroke 2.5, centred (left-aligned at 0.6 width when the card has a tag);
  - art 0.18-0.75: a transparent holder centred at (0.5, 0.465), `Size = UDim2.fromScale(1, 0.57)` with a height-dominant square constraint. In it, the art `ImageLabel` (Fit, `Size = UDim2.fromScale(0.9, 0.9)`, `ZIndex` 2) on the sunburst (`ScaleType.Crop`, `Size = UDim2.fromScale(1.7, 1)`, centred, ImageTransparency 0.15, `ZIndex` 1). The crop spreads the rays across the card's width while keeping them inside the art band, clear of the name and the price. On `yellow` and `gold` faces tint the sunburst with `ImageColor3 = PALETTE.orange.bottom`: measured on a benchmark shop, white and gold-tinted rays both vanish on those faces, orange ones show;
  - price/action row 0.77-0.96: price button `Size = UDim2.fromScale(0.74, 0.19)`, anchored top-centre at (0.5, 0.77), or price + gift.
  Bands never overlap; with no art, the card shrinks rather than leaving an empty band. Art that floats (Presentation) is sized at 0.8 instead of 0.9, so its travel stays inside the band.
- **Tag** ("NEW!", "HOT", "BEST", "-75%", "LIMITED"): bare coloured text, no block behind it, as both reference games do. One `makeText` label, `extrude = true`, stroke 3, right-aligned inside the card's top-right corner in the name band (x 0.64-0.96, y 0.03-0.17). At most one per card.
  - Colour by meaning: red `Color3.fromRGB(255, 60, 60)` for NEW!, HOT, OP! and discounts; the gold gradient for BEST, LIMITED and MOST POPULAR.
  - The thick black stroke carries it on any face, but never put a tag on a face of its own colour: on a red or pink card use the gold tag, on a gold or yellow card use the red one.
  - Inside a scrolling list a tag stays upright. A HUD offer outside any scrolling list may tilt its tag to `Rotation = -10`, as one reference game does.
- **Wide offer row / featured banner**: a `card` block spanning the content width, aspect 3.2-3.6. A square holder at the left (~0.85 of row height) filled by a `Fit` sunburst, with the art at most 0.7 of the holder so some rays show around it (at 0.78 the art hid them completely), then name + one description line in the middle, price button bottom-right, optional tag top-right. It uses the same dense stud face as every other block: the sparse texture tiled across a banner came out as huge, patchy studs in a benchmark shop. A featured banner may carry an extruded gold display number. A banner always sells a real product.
- **Section title**: a full-width Frame 40-48 px tall in the section's colour, faded at both ends, with an extruded title centred on it:

  ```lua
  local function makeSectionTitle(parent, text, colorName, order)
  	local band = Instance.new("Frame")
  	band.Name = "Section_" .. text
  	band.BackgroundColor3 = PALETTE[colorName].bottom
  	band.BorderSizePixel = 0
  	band.Size = UDim2.new(1, 0, 0, 44)
  	band.LayoutOrder = order
  	local fade = Instance.new("UIGradient")
  	fade.Transparency = NumberSequence.new({
  		NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.3, 0.55),
  		NumberSequenceKeypoint.new(0.7, 0.55), NumberSequenceKeypoint.new(1, 1),
  	})
  	fade.Parent = band
  	makeText(band, text, { size = UDim2.fromScale(0.6, 0.8), stroke = 3, extrude = true })
  	band.Parent = parent
  	return band
  end
  ```
- **Tab rail** (rarities or worlds on a collection/index or inventory, Daily/Weekly scopes on progression and leaderboards; never on a shop, which scrolls through titled sections instead): a vertical stack of `chip` blocks OUTSIDE the panel edge, parented to the panel so it moves with it:
  - placement: on the RIGHT by default, `AnchorPoint` (0, 0) and `Position` (1, 10, 0.14, 0), because a HUD's menu tiles usually sit on the left; on the left, `AnchorPoint` (1, 0) and `Position` (0, -10, 0.14, 0), only when nothing sits beside the panel there;
  - size: rail width 0.2 of panel width; tabs 0.11 of rail height, ~2% gaps;
  - state: every tab keeps its own colour, as one reference game draws its tabs. EXACTLY ONE tab (the active one, matching the visible content) is at full colour and full width; every other tab is dimmed and 0.9 wide with `setTab`. A grey category (Common) still reads as active, which a grey inactive state could not show. The rail's `UIListLayout` aligns the tabs to the panel side (`HorizontalAlignment` Left on a right rail, Right on a left rail), so the narrower ones keep touching the panel's edge.

  ```lua
  local DIMMED = Color3.fromRGB(150, 150, 150)
  local function setTab(tab, colorName, active)
  	paint(tab, colorName)
  	local tone = active and Color3.new(1, 1, 1) or DIMMED
  	tab.Face.BackgroundColor3 = tone -- the face's UIGradient multiplies this, so the colour dims
  	tab.Face.ImageColor3 = tone
  	if not active then
  		tab.BackgroundColor3 = PALETTE[colorName].lip:Lerp(Color3.new(0, 0, 0), 0.4)
  	end
  	tab.Size = UDim2.fromScale(active and 1 or 0.9, tab.Size.Y.Scale)
  end
  ```
  Use the rail only when the panel is at most 0.55 screen width, so it stays on screen.
- **HUD tile**: a `tile` block, roughly square (aspect 0.97), drawn as the references draw it: a big icon with its label over the icon's foot (modern-2: icon 0.775 of the tile, label 0.26 tall at y 0.77).
  - Icon: Fit, square, `Size = UDim2.fromScale(0.8, 0.8)` of the face at (0.5, 0.45).
  - Label: a CHILD of the icon (Text over art) at (0.5, 0.92), `Size = UDim2.fromScale(1.2, 0.3)` of the icon, stroke 2.5, `ZIndex` 3. Checked live: audit clean.
  - Optional badge, straddling the top-right corner as one reference game's alert does: a red `chip` parented to the tile's FACE, `AnchorPoint` (0.5, 0.5), `ZIndex = 4` so it draws above the icon and label. "NEW!": `Size = UDim2.fromScale(0.46, 0.18)` at (0.84, 0). "!": `Size = UDim2.fromScale(0.28, 0.28)` at (0.94, 0.08). Its text is `makeText` at 0.82 x 0.8, stroke 2.
  - Parent it to the face, never the base. On the base, the badge's text is partly on the face and partly off it, which the UI audit reports; a benchmark HUD then pushed its badges into the tile and shrank the icons to make room. Never shrink or move the icon for a badge.
  - These sizes keep the badge's text clear of the icon's box, and the part that hangs outside the tile stays inside a ~1% grid gap (checked live with the 0.8 icon: audit clean, with a badge on a tile in either column). Do not enlarge it or move it further out, or it lands on the next tile.
- **HUD offer** (the right-column deals both reference games show): NOT a block. The whole offer is one transparent `ImageButton` (no image, `BackgroundTransparency = 1`) holding, top to bottom:
  - a square holder 0.17 of screen height (~184 px at 1080p), filled by a `ScaleType.Fit` sunburst, with the art (Fit, square) at 0.76 of it, or 0.66 when it floats;
  - the offer's name as a stroked label 0.035 of screen height, under the holder;
  - the price under the name, 0.03 of screen height: green stroked text with the Robux glyph (`ROBUX .. " 99"`, `Color3.fromRGB(0, 255, 8)`, stroke 2.5).
  Size it from screen HEIGHT. Both references draw this art big (155 px in modern-2, 177 px in modern-1, at 1080p); a benchmark that sized the offer to 8.5% of screen width drew the art at about half that. Keep the name and price clear of the holder's box. A tag on the offer ("Cheap!", `Rotation = -10`) is a CHILD of the art image, wholly inside its top corner, so it never crosses the sunburst's edge. Checked live: audit clean.
- **Currency readout**: no plate. A transparent row: icon (Fit, square, the row's full height) then the value as a left-aligned label with stroke 3 and a display-number gradient (cash, gold, gem). Each currency has its own icon and gradient.
- **Value chip** (multipliers, "x1.5 Money"): a `chip` block with one centred label. A before/after pair is two chips with a bare stroked ">" between them, never an arrow drawn from Frames.
- **Progress bar**: ONE `chip` block whose face gradient carries the fill as a hard colour stop, with its count label on the face. A label centred over a separate fill frame is half on and half off it, which the UI audit reports.

  ```lua
  local TRACK = Color3.fromRGB(75, 78, 92)
  local function setProgress(bar, progress, goal, colorName)
  	local f = math.clamp(progress / goal, 0.001, 0.998)
  	local fill = PALETTE[colorName].bottom
  	local shade = bar.Face.UIGradient
  	shade.Rotation = 0
  	shade.Color = ColorSequence.new({
  		ColorSequenceKeypoint.new(0, fill), ColorSequenceKeypoint.new(f, fill),
  		ColorSequenceKeypoint.new(f + 0.001, TRACK), ColorSequenceKeypoint.new(1, TRACK),
  	})
  	bar.BackgroundColor3 = Color3.fromRGB(40, 42, 52)
  end
  -- local bar, barFace = makeSurface(parent, "chip", "green"); setProgress(bar, 3, 10, "green")
  -- makeText(barFace, "3/10", { size = UDim2.fromScale(0.9, 0.72) })
  ```
- **Text input** (codes, player name): a `chip` block in `slate`, with the `TextBox` as a child of its face, white text, stroke 2, placeholder `Color3.fromRGB(190, 190, 200)`.

## Presentation

Every panel opens with a world blur and a quick pop. This adds to the polish layer's open animation, which it matches. The blur is a client-side `BlurEffect` the builder owns: reuse it by name, and destroy it with the screen.

```lua
local Lighting = game:GetService("Lighting")
local TweenService = game:GetService("TweenService")
local POP = TweenInfo.new(0.22, Enum.EasingStyle.Back, Enum.EasingDirection.Out)

local oldBlur = Lighting:FindFirstChild("ModernStudsBlur")
if oldBlur then oldBlur:Destroy() end
local blur = Instance.new("BlurEffect")
blur.Name = "ModernStudsBlur"
blur.Size = 0
blur.Parent = Lighting
gui.Destroying:Connect(function() blur:Destroy() end)

local function openPanel(panel)
	panel.Visible = true
	local scale = panel:FindFirstChildOfClass("UIScale")
	scale.Scale = 0.85
	TweenService:Create(scale, POP, { Scale = 1 }):Play()
	TweenService:Create(blur, TweenInfo.new(0.2), { Size = 16 }):Play()
end

local function closePanel(panel)
	panel.Visible = false
	TweenService:Create(blur, TweenInfo.new(0.15), { Size = 0 }):Play()
end
```

- A screen that starts open calls `openPanel` once after building, so the first render shows the blur and the resting panel.
- Close buttons call `closePanel`.
- HUD, sidebar, clicker, and toast layouts never blur: the world stays sharp behind them.
- Hiding the HUD while a panel is open is allowed only when the user asks for it.
- Hover and press follow the polish layer through a `UIScale` on a button's base (hover 1.06, press 0.94). Buttons and HUD tiles scale on hover; cards, offer rows, and banners do not, because in a scrolling list they have no room to grow. Nothing tweens `Size` or `Position` of anything a layout places.
- Ambient motion follows the polish layer's smooth-motion rules. With this kit:

  ```lua
  local function loop(seconds)
  	return TweenInfo.new(seconds, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)
  end
  -- Attention on a block with text (a badge, a button): dim and restore its face; the text never resizes.
  TweenService:Create(badgeFace, loop(0.6), { BackgroundColor3 = Color3.fromRGB(190, 190, 190) }):Play()
  -- Attention on a bare text tag: brighten and restore its colour. tagTop is the second value makeText returns.
  TweenService:Create(tagTop, loop(0.6), { TextColor3 = Color3.fromRGB(255, 175, 175) }):Play() -- red tag; a gold tag tweens white -> (215, 215, 215)
  -- A HUD badge outside any ScrollingFrame may wobble instead: rotation turns its text with it.
  badge.Rotation = -8
  TweenService:Create(badge, loop(0.45), { Rotation = 8 }):Play()
  -- Float an image (never text) at least 10 px each way. Size the art at 0.8 of its band so the travel stays inside it.
  local rest = art.Position
  art.Position = rest + UDim2.fromOffset(0, 10)
  TweenService:Create(art, loop(1.1), { Position = rest - UDim2.fromOffset(0, 10) }):Play()
  ```
  Never tween a `UIScale` on a block, tag, or badge that holds text for longer than a hover or the open pop.

## Engine facts

- `ScreenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling`. Children always draw above their parent; `ZIndex` orders siblings only.
- Never give an element a Scale width of 0. Squares (icons, close, tiles, badges) use a non-zero width scale with a height-dominant `UIAspectRatioConstraint`, or an explicit `UDim2.fromOffset(H, H)`.
- Never put a scale fraction in an offset slot: `UDim2.new(1, -2 * PAD, 1 - HEADER_H, -16 - PAD)` keeps scale and pixels in their own slots.
- `TextScaled` caps near 100 px; for bigger display text keep `TextScaled` and set `RichText` with `<font size="N">`.
- Interactive blocks are at least 44 px tall.
- Nothing inside a `ScrollingFrame` is rotated. Do not add gloss or streak overlays to blocks: the lip and face gradient are the shine. Tried on a live header band, a white streak overlay beside the title row made the UI audit report the title and close text as crossing its edge.
- `UICorner` rounds an `ImageLabel`'s image, so the stud tile stays inside the rounded face. If a screenshot ever shows stud pixels past a corner, raise the face's `ImageTransparency` by 0.1 and report it.
- No visible element inside the top-left 350×70 Core UI keep-out; elements near the top-left anchor their y at a 70 px offset.
- Panel height stays within [0.40, 0.66] of the screen unless the selected body says otherwise, and content ends within ~12% of the panel bottom.
- A `ScrollingFrame` with `AutomaticCanvasSize` measures Scale heights against its canvas, which grows with the children: a child sized `UDim2.fromScale(1, 0.3)` inside it is 30% of a canvas that then grows, and the layout overflows. Non-scrolling layouts use `scrolls = false`; scrolling ones size rows and cells in pixels.

## Final check

- Every block is a `makeSurface` block: outline, rounded corners, lip, gradient face with tinted studs. Nothing flat, square-cornered, or lipless.
- One panel variant on the screen; the close is the red tile with a white X, inside the band (Dark) or straddling the corner (Light).
- Green never on a destructive or cancel action; nothing for sale on grey; exactly one active tab at full colour and width, the others dimmed in their own colours; owned and claimed states grey; empty and locked slots slate.
- Every item art has its sunburst; every price button uses the Robux glyph or a coin icon group.
- Text: white, stroked, never boxed; white on coloured blocks except bare red or gold card tags, never on a face of their own colour; gradient-filled numbers only on the panel body or over the world; extrusion on titles, section titles, card and row names, and display numbers.
- Nothing with text pulses in size; ambient attention is a colour pulse or (outside scrolling lists) a rotation wobble.
- Every badge is parented to its block's face with `ZIndex` 4, its text clear of the icon; icons keep their full size.
- The panel opened with blur and pop; the screenshot shows the resting state.
- Asset IDs are only the ones in part 1, `resolve_icon` results, or verified project art.
- No overlap, no text crossing a sibling's edge, no zero-size element, all content hardcoded. Text over art only as the art's child or on a full-face art box.
- HUD tile icons at 0.8 with the label over their foot; HUD-offer art sized from screen height; day tiles and collection slots filled by their art.

## Layout bodies

Load exactly one with this theme: `references/selected/modern-studs/<layout>.md`. Slugs: `shop-grid`, `centered-dialog`, `fullscreen-landing`, `admin-control-panel`, `hud-zone-system`, `select-screen`, `grid-inventory`, `vertical-navigation-sidebar`, `progression-hub`, `stat-leaderboard`, `incremental-clicker`, `notification-alert`, `wheel-spin`, `vertical-reel-roll`. `wheel-spin` routes to the MODERN STUDS wheel template; MODERN STUDS has no reel template, so `vertical-reel-roll` routes to the CLASSIC STUDS reel.
