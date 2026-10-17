# SIM refresh

> Repository-authored from a 2026-10-11 study of three simulator games (screen recordings and one complete UI hierarchy dump). Load it with every SIM route, after the recovered SIM parts and the selected body. Where it differs from them, this file wins. It changes construction details only: the recovered theme already follows the same game family (its close, corner, title and gradient numbers match the studied pet simulator exactly).

Every change below was checked in Studio: the refreshed shop and HUD audit clean, and the recovered scaffold's two audit warnings are gone.

## 1. Panel card: a faint pattern face

All three studied games put a faint tiled pattern on their panels. Ignore the recovered rule "the card face stays CLEAN white". The card is ONE `ImageLabel` whose image is the pattern, so nothing on the card crosses an overlay's edge. Replace the scaffold's `card` block with:

```lua
local PATTERN = "rbxassetid://14605469420" -- public Creator Store decal 14605469461 "Star Pattern" (28Pixels): white stars on transparency
local card = Instance.new("ImageLabel")
card.Name = "Card"
card.BackgroundColor3 = Color3.fromRGB(255, 255, 255) -- the card stays white; the stars are a faint navy tint
card.Image = PATTERN
card.ScaleType = Enum.ScaleType.Tile
card.TileSize = UDim2.fromOffset(110, 110)
card.ImageColor3 = Color3.fromRGB(42, 43, 49)
card.ImageTransparency = 0.94
card.Size = UDim2.new(1, 0, 1, 0)
card.ZIndex = 2
card.Parent = wrapper
local cardCorner = Instance.new("UICorner")
cardCorner.CornerRadius = UDim.new(0.035, 0)
cardCorner.Parent = card
local cardStroke = Instance.new("UIStroke")
cardStroke.Color = Color3.fromRGB(42, 43, 49)
cardStroke.Thickness = 7
cardStroke.Parent = card
```

Use the same pattern, at `ImageTransparency` 0.8 and untinted, on a banner (section 4). Never put it on buttons, item tiles or text rows.

## 2. Shadow: start it below the straddling title

The recovered shadow's top edge sits 5 px under the card's top, so the straddling title and close button both cross it, and the UI audit reports both on every SIM dialog. Keep the shadow, but start its top 45 px down, where the card hides it. Its visible bottom and sides do not change:

```lua
shadow.Position = UDim2.new(0.5, 0, 0.5, 28)
shadow.Size = UDim2.new(1, 6, 1, -34)
```

## 3. Big art, labels over it

The studied games draw item art big and put names, counts and timers over it. The UI audit accepts text over art only when the art image is the label's PARENT (it skips a label's ancestors). So:
- a label that sits on a picture is a child of that picture's `ImageLabel`, placed in the picture's coordinates; it may extend past the picture's box;
- a label never crosses the edge of a sibling picture.

## 4. Item tiles, shop cards, banner

**Item tile**: the one building block for shop items, inventory slots, rewards and reward previews.

```lua
local TIERS = { -- light top into the tier colour
	common = { Color3.fromRGB(235, 245, 255), Color3.fromRGB(150, 205, 255) },
	rare = { Color3.fromRGB(225, 255, 215), Color3.fromRGB(120, 225, 90) },
	epic = { Color3.fromRGB(245, 225, 255), Color3.fromRGB(190, 120, 255) },
	legendary = { Color3.fromRGB(255, 245, 200), Color3.fromRGB(255, 190, 60) },
	mythic = { Color3.fromRGB(255, 225, 240), Color3.fromRGB(255, 110, 175) },
}
local function tileLabel(parent, text, anchor, position, size, align)
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.Text = text
	label.TextScaled = true
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextXAlignment = align or Enum.TextXAlignment.Center
	label.AnchorPoint = anchor
	label.Position = position
	label.Size = size
	label.ZIndex = 4
	label.Parent = parent
	local stroke = Instance.new("UIStroke")
	stroke.Color = NAVY
	stroke.Thickness = 2.5
	stroke.Parent = label
end
local function framedModel(model) -- a pet or item model, framed front-on in a ViewportFrame
	local view = Instance.new("ViewportFrame")
	view.BackgroundTransparency = 1
	local copy = model:Clone()
	copy.Parent = view
	local camera = Instance.new("Camera")
	camera.FieldOfView = 30
	local box, size = copy:GetBoundingBox()
	local distance = (math.max(size.X, size.Y) / 2) / math.tan(math.rad(camera.FieldOfView / 2)) + size.Z / 2
	camera.CFrame = CFrame.lookAt(box.Position + box.LookVector * distance + Vector3.new(0, size.Y * 0.15, 0), box.Position)
	camera.Parent = view
	view.CurrentCamera = camera
	return view
end
local function makeItemTile(parent, item) -- item = { name = "", icon = "rbxassetid://..." or model = <Model>, tier = "rare", count = 3 }
	local tile = Instance.new("Frame")
	tile.BackgroundColor3 = Color3.new(1, 1, 1)
	tile.Parent = parent
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0.14, 0)
	corner.Parent = tile
	local stroke = Instance.new("UIStroke")
	stroke.Color = NAVY
	stroke.Thickness = 3
	stroke.Parent = tile
	local shade = Instance.new("UIGradient")
	shade.Rotation = 90
	shade.Color = ColorSequence.new(TIERS[item.tier or "common"][1], TIERS[item.tier or "common"][2])
	shade.Parent = tile
	local art
	if item.model then
		art = framedModel(item.model)
	else
		art = Instance.new("ImageLabel")
		art.BackgroundTransparency = 1
		art.Image = item.icon
		art.ScaleType = Enum.ScaleType.Fit
	end
	art.Name = "Art"
	art.AnchorPoint = Vector2.new(0.5, 0.5)
	art.Position = UDim2.fromScale(0.5, 0.56)
	art.Size = UDim2.fromScale(0.8, 0.8)
	art.ZIndex = 3
	art.Parent = tile
	if item.name and item.name ~= "" then -- over the art's top
		tileLabel(art, item.name, Vector2.new(0.5, 0), UDim2.fromScale(0.5, -0.08), UDim2.fromScale(1.25, 0.26))
	end
	if item.count then -- over the art's bottom-right corner
		tileLabel(art, "x" .. item.count, Vector2.new(1, 1), UDim2.fromScale(1.08, 1.06), UDim2.fromScale(0.6, 0.3), Enum.TextXAlignment.Right)
	end
	return tile
end
```

- **Pets and other owned models** show the model itself, as a real pet game does: pass `item.model` (the game's pet `Model`, e.g. from `ReplicatedStorage`) and the tile frames it in a `ViewportFrame` in place of the icon, with the name and count still over it. Use an icon only when the game has no models yet, and repeated placeholder art is then fine; never go looking for one icon per pet.
- Names over the art stay short, about 12 characters at most: a longer name renders smaller than its neighbours. Put the full name in the detail strip or tooltip.
- Tier colour comes from the item's rarity or value step. A shop row steps up through common, rare, epic, legendary and mythic; it is never all one colour.
- An empty or locked slot is the same tile with the `grey` gradient from the recovered `GRADIENTS` (light end at the top) and no art, or a lock icon at 0.5.

**Shop card**: replaces the shop-grid body's `buildProductCard` and its fixed-width cells. The tile sits on top and the price button 8 px under it, never over the art:

```lua
local PILL_H, PILL_GAP, TILE_MAX = 38, 8, 150
local function cardHeight(cellW) return math.min(cellW, TILE_MAX) + PILL_GAP + PILL_H end
local function buildProductCard(parent, item, cellW)
	local cell = Instance.new("Frame")
	cell.BackgroundTransparency = 1
	cell.Parent = parent
	local side = math.min(cellW, TILE_MAX)
	local tile = makeItemTile(cell, item)
	tile.AnchorPoint = Vector2.new(0.5, 0)
	tile.Position = UDim2.new(0.5, 0, 0, 0)
	tile.Size = UDim2.fromOffset(side, side)
	local pill = buildPricePill(cell, item.price) -- the body's pill, resized and moved under the tile
	pill.Size = UDim2.fromOffset(side, PILL_H)
	pill.AnchorPoint = Vector2.new(0.5, 0)
	pill.Position = UDim2.new(0.5, 0, 0, side + PILL_GAP)
end
```

- **Measure the content width; never assume 1080p.** The body's `CONTENT_W = 1009` makes five cards wrap into rows of 3 and 2 in any smaller window (seen at 1350×832). After building `content`, wait a frame and use `CONTENT_W = content.AbsoluteWindowSize.X - 40` (the side padding). Set `content.VerticalScrollBarInset = Enum.ScrollBarInset.Always` so the scroll bar never covers a card.
- Each section's grid: `CellSize = UDim2.fromOffset(cellW, cardHeight(cellW))`, `HorizontalAlignment = Center`, where `cellW` is the body's column math applied to the measured width. The holder's height is `cardHeight(cellW)` with `AutomaticSize` Y.

**Banner** (the featured offer, `LayoutOrder = 1`, full content width, 176 px tall), as the studied starter packs are built:
- a white Frame, UICorner 0.1, navy UIStroke 4, and a two-stop gradient by offer (starter pack: `(255,220,60)` → `(255,140,20)`, rotation 90);
- a child `ImageLabel` filling it with the pattern (`ImageTransparency` 0.8, untinted, same corner). Everything else is a child of this pattern layer;
- the offer art big at the left: Fit, 0.9 of the banner height, 14 px in;
- the name, white with a navy stroke 4, 44 px tall, top-left beside the art; a dark-amber `(120,60,0)` "Ends in: 58:43" line under it, no stroke;
- two to four reward tiles (`makeItemTile` with no name, a count) at 76 px in a row under the name, 8 px apart (at 56 px their counts were unreadable);
- the green price button bottom-right, 150 × 52.

## 5. HUD: icons over the ends, gradient numbers

All three studied HUDs draw icons bigger than the element they sit on. These replace the hud-zone-system body's `currencyChip` and `railButton`:

- **Currency pill**: an `ImageLabel` pill 46 px tall (UICorner 0.5, navy stroke 4) with a light currency-tinted background (coins `(255,240,200)`, gems `(245,220,255)`, rebirths `(255,225,230)`) and the pattern at 0.93, 40 px tiles.
  - The currency icon is a child of the pill, centred on its left end (`AnchorPoint` (0.5, 0.5), `Position` (0, 0, 0.5, 0)), 1.45 times the pill's height (the studied pet simulator: 1.51, on the right end, with the "+" on the left; either end works, one each).
  - The value is left-aligned 38 px in, 0.8 of the pill's height, white with a navy stroke 3 and a vertical gradient in the currency's colour (coins `(255,230,90)`→`(255,150,20)`, gems `(240,150,255)`→`(160,60,255)`, rebirths `(255,110,120)`→`(220,20,50)`).
  - An optional round green "+" sticker button (aspect 1, 0.85 of the pill's height) is centred on its right end.
  - Pills go in the body's top-left zone, stacked, or in a top-centre row 14 px under the top edge, ~26 px apart, as one studied game does. The top-left keep-out rule still applies.
- **HUD tile**: a 92 px sticker tile (UICorner 0.22, navy stroke 4) with a two-stop gradient of its own colour.
  - The icon is 0.82 of the tile, centred at y 0.44.
  - The label is a CHILD of the icon over its foot: `AnchorPoint` (0.5, 1), `Position` (0.5, 1.14), `Size` (1.25, 0.34), white, navy stroke 3.
  - Tiles go in a 2-column `UIGridLayout` (`CellPadding` 14 × 18) on the left.
- **Badge** ("!", a count, NEW, OP): a round white frame tinted by the red sticker gradient, aspect 1, with a dark-red `(77,0,0)` stroke 3 as the studied game draws it, parented to the tile's ICON at its top-right (`Position` (1.02, 0.02), `Size` (0.36, 0.36)), so its text never crosses the icon's edge.
- **Wide button** (Rewards, Free Gifts): a sticker button 210 × 62 with its icon at 1.5 times its height centred on the left end, the label filling the rest.
