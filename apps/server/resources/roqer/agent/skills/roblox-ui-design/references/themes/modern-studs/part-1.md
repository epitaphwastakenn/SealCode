# MODERN STUDS theme - part 1/2: identity, surface kit, colour, assets

> Repository-authored from a study of two published modern-stud games (screen recordings and UI hierarchy captures). It ships no art or code from those games. Benchmarked in Studio on a shop and a rebirth dialog; the other layouts are unbenchmarked, so judge every render against these rules and report anything that reads wrong.

Follow this theme for every visual decision, and exactly ONE selected layout body (`references/selected/modern-studs/<layout>.md`) for the skeleton. The selected body owns geometry and composition; this theme owns construction, colour and assets. When EDITING an existing UI, follow `references/core/editing.md` instead and do not load a layout body.

UI generation only, static data: hardcode all content. No MarketplaceService or product lookups, no RemoteEvents or RemoteFunctions, no leaderstats reads, no RunService per-frame work. TweenService is allowed for the presentation motion in `references/core/polish.md` and the open/close presentation in part 2. Click handlers may only toggle visibility or tabs and play that motion.

## When this theme applies

MODERN STUDS is the stud theme: use it for every stud, studded, or blocky request, and for a project whose builder is marked `-- theme: modern-studs`. CLASSIC STUDS (the recovered square bevel theme) is used only when the user asks for classic, square, or old-style studs, or when editing a screen already built with it.

## Identity

1. **Every surface is one rounded, outlined, lipped block**: a thick black outline, a darker same-hue lip along the bottom, and a saturated face that is lighter at the top. Square corners, flat faces, or a missing lip read as CLASSIC STUDS: a defect here.
2. **Studs are embossed inside the face**: the stud texture is the face's own image, tinted by the face gradient. Never a separate high-contrast overlay. Studs may be faint or clearly visible; they are never the loudest thing on the surface.
3. **Fixed vocabulary**: red close square with a heavy white X; green primary/CTA; purple gift and secondary premium actions; gold for rare/featured; grey for disabled and owned; inactive tabs dimmed in their own colour (part 2, Tab rail); slate for empty and locked slots.
4. **Item art sits on a sunburst.** Every product, reward, and featured item has the sunburst under it.
5. **Text is white and heavy with a black outline.** Display numbers on the panel body or over the world (totals, currency readouts) are gradient-filled; text on a coloured block stays white. Robux prices use the Robux text glyph, not an image.
6. **Panels** come in two variants (part 2): Dark (translucent body with a coloured header band, default) and Light (white studded body with the title and close straddling the top edge).
7. **Opening a panel blurs the world and pops the panel in** (part 2, Presentation).

## Builder header

The builder's first line is `-- layout: <slug>`, the second `-- theme: modern-studs`. Edits use the second line to recognise the construction.

## Surface kit - copy verbatim, customise only through arguments

Every block in every layout is built with `makeSurface`. Never hand-build a block from loose Frames.

```lua
-- theme: modern-studs surface kit
local STUDS = "rbxassetid://92521981645530"   -- embossed rounded-square stud tile (4 x 4 per tile)
local SUNBURST = "rbxassetid://91084849147872"
local ROBUX = utf8.char(0xE002)                -- Roblox's Robux glyph, rendered by the text engine
local OUTLINE = Color3.new(0, 0, 0)
local FONT = Font.fromEnum(Enum.Font.FredokaOne)

local PALETTE = {
	green  = { top = Color3.fromRGB(190, 255, 90),  bottom = Color3.fromRGB(40, 215, 30),  lip = Color3.fromRGB(10, 140, 20) },
	red    = { top = Color3.fromRGB(255, 120, 120), bottom = Color3.fromRGB(225, 20, 30),  lip = Color3.fromRGB(130, 0, 10) },
	purple = { top = Color3.fromRGB(215, 125, 250), bottom = Color3.fromRGB(150, 20, 230), lip = Color3.fromRGB(95, 5, 160) },
	yellow = { top = Color3.fromRGB(255, 245, 110), bottom = Color3.fromRGB(250, 190, 20), lip = Color3.fromRGB(160, 105, 0) },
	orange = { top = Color3.fromRGB(255, 210, 70),  bottom = Color3.fromRGB(240, 120, 10), lip = Color3.fromRGB(165, 80, 5) },
	blue   = { top = Color3.fromRGB(120, 215, 255), bottom = Color3.fromRGB(20, 125, 240), lip = Color3.fromRGB(10, 65, 160) },
	cyan   = { top = Color3.fromRGB(140, 250, 255), bottom = Color3.fromRGB(0, 195, 245),  lip = Color3.fromRGB(0, 105, 160) },
	pink   = { top = Color3.fromRGB(255, 150, 230), bottom = Color3.fromRGB(235, 40, 170), lip = Color3.fromRGB(140, 10, 100) },
	gold   = { top = Color3.fromRGB(255, 240, 130), bottom = Color3.fromRGB(240, 170, 20), lip = Color3.fromRGB(150, 95, 0) },
	silver = { top = Color3.fromRGB(245, 248, 255), bottom = Color3.fromRGB(160, 170, 190), lip = Color3.fromRGB(90, 98, 115) },
	bronze = { top = Color3.fromRGB(255, 195, 135), bottom = Color3.fromRGB(205, 115, 50), lip = Color3.fromRGB(120, 60, 20) },
	grey   = { top = Color3.fromRGB(240, 240, 245), bottom = Color3.fromRGB(165, 165, 178), lip = Color3.fromRGB(95, 95, 108) },
	slate  = { top = Color3.fromRGB(125, 130, 145), bottom = Color3.fromRGB(78, 82, 96),   lip = Color3.fromRGB(45, 48, 58) },
}

-- lip: share of the block's height left showing below the face. rows: stud rows across the face.
local KIND = {
	button = { lip = 0.12, corner = UDim.new(0.22, 0), stroke = 3, rows = 2.5, studs = 0.6 },
	chip   = { lip = 0.12, corner = UDim.new(0.3, 0),  stroke = 3, rows = 2,   studs = 0.7 },
	tile   = { lip = 0.07, corner = UDim.new(0.16, 0), stroke = 4, rows = 4,   studs = 0.6 },
	card   = { lip = 0.05, corner = UDim.new(0, 10),   stroke = 3, px = 64,    studs = 0.65 },
	band   = { lip = 0.10, corner = UDim.new(0, 10),   stroke = 3, rows = 3,   studs = 0.65 },
}

-- Stud size follows the rendered face, so studs read the same at every resolution.
local function fitStuds(face, kind)
	local function update()
		local edge = kind.px or math.floor(face.AbsoluteSize.Y * 4 / kind.rows + 0.5)
		face.TileSize = UDim2.fromOffset(math.max(edge, 8), math.max(edge, 8))
	end
	face:GetPropertyChangedSignal("AbsoluteSize"):Connect(update)
	update()
end

-- One outlined, lipped, studded block. Size and place `base`; parent content to `face`.
local function makeSurface(parent, kindName, colorName, isButton)
	local kind, color = KIND[kindName], PALETTE[colorName]
	local base = Instance.new(isButton and "TextButton" or "Frame")
	base.Name = kindName
	base.BackgroundColor3 = color.lip
	base.BorderSizePixel = 0
	if isButton then
		base.Text = ""
		base.AutoButtonColor = false
	end
	local corner = Instance.new("UICorner")
	corner.CornerRadius = kind.corner
	corner.Parent = base
	local stroke = Instance.new("UIStroke")
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border -- on a TextButton, Contextual would stroke the text
	stroke.Color = OUTLINE
	stroke.Thickness = kind.stroke
	stroke.Parent = base

	local face = Instance.new("ImageLabel") -- the face IS the stud image: one painted element, so text never straddles an overlay
	face.Name = "Face"
	face.BackgroundColor3 = Color3.new(1, 1, 1)
	face.BorderSizePixel = 0
	face.Size = UDim2.new(1, 0, 1 - kind.lip, 0)
	face.Image = STUDS
	face.ScaleType = Enum.ScaleType.Tile
	face.ImageTransparency = kind.studs
	face.ZIndex = 2
	face.Parent = base
	corner:Clone().Parent = face
	local shade = Instance.new("UIGradient") -- tints background and studs together
	shade.Rotation = 90
	shade.Color = ColorSequence.new(color.top, color.bottom)
	shade.Parent = face
	fitStuds(face, kind)
	base.Parent = parent
	return base, face
end

-- Recolour an existing block (active tab, selected tile, owned state).
local function paint(base, colorName)
	local color = PALETTE[colorName]
	base.BackgroundColor3 = color.lip
	base.Face.UIGradient.Color = ColorSequence.new(color.top, color.bottom)
end

-- White heavy text with a black outline. opts: size, position, anchor, align, stroke, color,
-- gradient (ColorSequence for display numbers), extrude (titles and display numbers only), z.
local function makeText(parent, text, opts)
	opts = opts or {}
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.FontFace = FONT
	label.Text = text
	label.TextScaled = true
	label.TextColor3 = opts.color or Color3.new(1, 1, 1)
	label.TextXAlignment = opts.align or Enum.TextXAlignment.Center
	label.AnchorPoint = opts.anchor or Vector2.new(0.5, 0.5)
	label.Position = opts.position or UDim2.fromScale(0.5, 0.5)
	label.Size = opts.size or UDim2.fromScale(0.9, 0.6)
	label.ZIndex = opts.z or 3
	local stroke = Instance.new("UIStroke")
	stroke.Color = OUTLINE
	stroke.Thickness = opts.stroke or 2.5
	stroke.LineJoinMode = Enum.LineJoinMode.Round
	stroke.Parent = label
	local top = label
	if opts.extrude then
		-- A black copy under a white copy lifted 7% of the label height. The white copy is a CHILD,
		-- so the UI audit reads the pair as one label.
		top = label:Clone()
		top.Name = "Top"
		top.AnchorPoint = Vector2.new(0.5, 0.5)
		top.Position = UDim2.fromScale(0.5, 0.43)
		top.Size = UDim2.fromScale(1, 1)
		top.Parent = label
		label.TextColor3 = OUTLINE
	end
	if opts.gradient then
		local fill = Instance.new("UIGradient")
		fill.Rotation = 90
		fill.Color = opts.gradient
		fill.Parent = top
	end
	label.Parent = parent
	return label, top
end
```

Add helpers you need (cards, tiles, panels) from part 2 after these; keep these definitions unchanged.

## Shape: defaults and allowed ranges

The kit's numbers are the defaults. The reference games differed, so these ranges are acceptable when a layout body or the user asks for a heavier or lighter look; outside them the block stops reading as modern studs.

| Kind | Used for | Lip (share of height) | Corner | Outline px |
|---|---|---|---|---|
| button | price, action, confirm buttons | 0.12 (0.06-0.16) | 0.22 scale (0.12-0.3) | 3 |
| chip | tabs, value chips, bars | 0.12 (0.08-0.16) | 0.3 scale | 3 |
| tile | close, gift square, HUD tiles, slots, rank badges | 0.07 (0.04-0.1) | 0.16 scale (0.12-0.2) | 4 |
| card | product cards, rows, banners | 0.05 (min 4 px) | 10 px (8-14) | 3 |
| band | Dark panel header band | 0.10 | 10 px | 3 |

`UICorner` scale is a share of the block's shorter side; 0.5 makes a pill.

## Colour roles

- **green**: the primary action and every Robux/currency price button, and also a legitimate card, tier, or category colour. Green is never a destructive or cancel action.
- **red**: close, destructive actions, errors, and timers that warn.
- **purple**: gift buttons and secondary premium actions (skip, ad, boost).
- **gold / yellow / orange**: featured, rare, achievement, rank 1. Choose one family per screen for featured items.
- **blue / cyan / pink**: neutral category colours (tabs, HUD tiles, section bands). One colour per destination, stable across the screen.
- **grey**: owned, claimed, disabled. An inactive tab is not grey: it keeps its own colour, dimmed. **slate**: empty slot, locked tile.
- **Anything for sale is saturated.** A shop card or offer row is never `grey` or `slate`: grey reads as owned or disabled, and neither reference game sells on it. Shop cards step up in value through blue, green, cyan, purple, gold, pink. Collections and inventories may encode rarity: Common grey, Uncommon green, Rare blue, Epic purple, Legendary gold, Mythic pink.
- Dark panel body: `Color3.fromRGB(13, 17, 23)` at `BackgroundTransparency = 0.4`. Light panel body: white.

## Text

- Font: `Enum.Font.FredokaOne` through `FONT`. A cleaner geometric look may use `Font.fromEnum(Enum.Font.GothamBlack)` for the whole screen; never mix the two on one screen.
- Every label is white with a black `UIStroke`: 2-2.5 small text, 3 buttons and headers, 3.5 panel titles. Bare glyphs: never a box, plate, or background behind a label.
- `extrude = true` for panel titles, section titles, card and row names, card tags, and big display numbers. Descriptions, prices on buttons, and labels under 18 px never extrude.
- **Text on a coloured block face is white**, with one exception: a card tag is bare red or gold text (part 2, Tag), never on a face of its own colour. Gradient-filled numbers sit only on the panel body, a `grey`/`slate` face, a banner of a contrasting hue, or over the world (HUD readouts, totals). A cash-green amount on a green card, or gold on a yellow one, does not read.
- Display-number gradients (vertical, through `opts.gradient`):
  - cash: `ColorSequence.new(Color3.fromRGB(180, 255, 135), Color3.fromRGB(90, 215, 55))`
  - gold: `ColorSequence.new(Color3.fromRGB(255, 245, 140), Color3.fromRGB(255, 170, 0))`
  - gem/speed: `ColorSequence.new(Color3.fromRGB(150, 235, 255), Color3.fromRGB(40, 150, 255))`
  - candy/event: `ColorSequence.new(Color3.fromRGB(255, 170, 240), Color3.fromRGB(175, 80, 255))`
- Warning lines are red text `Color3.fromRGB(255, 92, 92)` with the black stroke.
- Robux price text is `ROBUX .. " " .. price` in ONE label (for example `ROBUX .. " 249"`), centred on the button.

## Assets - exact IDs

Use these exact IDs for these roles. Everything else comes from `resolve_icon` (one call for the whole screen) or verified project art. Never invent an ID, never use emoji or drawn shapes in place of an icon, and never use another game's UI sprites.

**Theme textures**

| Role | Image ID | Notes |
|---|---|---|
| Stud texture, every surface (default) | `rbxassetid://92521981645530` | Embossed rounded squares, 4 x 4 per tile. Shared with CLASSIC STUDS. |
| Sunburst under item art | `rbxassetid://91084849147872` | ImageTransparency 0.15 (its soft white rays vanish above ~0.3), below the art. On cards: `ScaleType.Crop`, 1.7x as wide as the art band (part 2, Card). Elsewhere: `ScaleType.Fit` filling a square holder, with the art at 0.66-0.76 of it so the rays show around the art. On `yellow` and `gold` faces tint it `PALETTE.orange.bottom`: white and gold rays vanish there. |

**Public Creator Store alternatives for the stud texture.** Use only when the user asks for chunkier studs. These are public decals; the IMAGE ID goes in `Image` (core assets rule). Each image was matched to its decal by creator, upload date, and thumbnail. Confirm with `get_asset_details` on the decal (its `asset.textureId` must equal the image ID) before first use in a project.

| Decal (Creator Store) | Image ID for `Image` | Look | Starting values |
|---|---|---|---|
| 6927295857 "Studs" | `rbxassetid://6927295847` | 4 x 4 embossed squares, chunkier | `TileSize` 50-70 px, ImageTransparency 0.7 |
| 12055407253 "stud" | `rbxassetid://12055407192` | 2 x 2 large embossed squares | `TileSize` 40 px, ImageTransparency 0.7 |

**Integral icons**

| Role | ID |
|---|---|
| Shop header and Shop HUD tile | `rbxassetid://110972987269284` (shop basket) |
| Coin amounts | `rbxassetid://84697600263846` |
| Cash packs and cash readouts | `rbxassetid://70565105539676` (cash stack) |
| Money/reward art | `rbxassetid://103120983042082` (pig and money) |
| Gems | `rbxassetid://75581768563141` (diamond), `rbxassetid://73150429062000` (crystal) |
| Standalone Robux icon (never on a price button) | `rbxassetid://87608142780557` |
| Gift buttons | `rbxassetid://122416766679510` (catalog "Gift") |
| Locked tiles and slots | `rbxassetid://113981661296218` (catalog "Lock") |
| Claimed state | `rbxassetid://128850290702187` (catalog "Checkmark") |
| Rank 1, VIP | `rbxassetid://78843852703854` (catalog "Crown") |

Icons sit on surfaces with `ScaleType.Fit` and a square `UIAspectRatioConstraint`; full-colour icons are never tinted.
