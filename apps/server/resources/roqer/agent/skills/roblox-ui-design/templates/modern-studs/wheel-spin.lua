-- LEMONADE_UI_SCALE_CONVERTER (managed by Lemonade, do not edit or remove)
-- Rewrites pixel (Offset) sizing on every GuiObject under the ScreenGuis this
-- script creates into Scale relative to the parent, so the UI keeps its
-- authored proportions on phones, tablets and other resolutions. Absolute
-- geometry is read first and written second, so the result is pixel-identical
-- at the viewport it was built for.
local lemonadeUiScale_LAYOUT_CLASSES = { "UIListLayout", "UIGridLayout", "UIPageLayout", "UITableLayout" }

local function lemonadeUiScale_resolve(udim: UDim, extent: number): number
	return udim.Scale * extent + udim.Offset
end

local function lemonadeUiScale_hasLayout(parent: Instance): boolean
	for _, className in lemonadeUiScale_LAYOUT_CLASSES do
		if parent:FindFirstChildWhichIsA(className) then
			return true
		end
	end
	return false
end

local function lemonadeUiScale_contentBox(parent: GuiBase2d): (Vector2, Vector2)
	local size = parent.AbsoluteSize
	local origin = parent.AbsolutePosition
	local padding = parent:FindFirstChildWhichIsA("UIPadding")
	if not padding then
		return origin, size
	end
	local left = lemonadeUiScale_resolve(padding.PaddingLeft, size.X)
	local right = lemonadeUiScale_resolve(padding.PaddingRight, size.X)
	local top = lemonadeUiScale_resolve(padding.PaddingTop, size.Y)
	local bottom = lemonadeUiScale_resolve(padding.PaddingBottom, size.Y)
	return origin + Vector2.new(left, top), size - Vector2.new(left + right, top + bottom)
end

local function lemonadeUiScale_toScale(absolute: Vector2, content: Vector2): UDim2
	return UDim2.fromScale(absolute.X / content.X, absolute.Y / content.Y)
end

local function lemonadeUiScale_planObject(object: GuiObject, plan: { () -> () })
	local parent = object.Parent
	if not (parent and parent:IsA("GuiBase2d")) then
		return
	end
	if parent:FindFirstChildWhichIsA("UIGridLayout") then
		return
	end
	local contentOrigin, content = lemonadeUiScale_contentBox(parent)
	if content.X <= 0 or content.Y <= 0 then
		return
	end
	local absoluteSize = object.AbsoluteSize
	local size = object.Size
	local automatic = object.AutomaticSize
	local scaled = lemonadeUiScale_toScale(absoluteSize, content)
	local keepX = automatic == Enum.AutomaticSize.X or automatic == Enum.AutomaticSize.XY
	local keepY = automatic == Enum.AutomaticSize.Y or automatic == Enum.AutomaticSize.XY
	local newSize = UDim2.new(if keepX then size.X else scaled.X, if keepY then size.Y else scaled.Y)
	local positionManaged = lemonadeUiScale_hasLayout(parent)
	local anchored = object.AbsolutePosition - contentOrigin + object.AnchorPoint * absoluteSize
	local newPosition = lemonadeUiScale_toScale(anchored, content)
	local pureOffset = size.X.Scale == 0 and size.Y.Scale == 0 and absoluteSize.X > 0 and absoluteSize.Y > 0
	local fixedShape = pureOffset and automatic == Enum.AutomaticSize.None
	local aspect = if fixedShape and not object:FindFirstChildWhichIsA("UIAspectRatioConstraint")
		then absoluteSize.X / absoluteSize.Y
		else nil
	table.insert(plan, function()
		object.Size = newSize
		if not positionManaged then
			object.Position = newPosition
		end
		if aspect then
			local constraint = Instance.new("UIAspectRatioConstraint")
			constraint.AspectRatio = aspect
			constraint.Parent = object
		end
	end)
end

local function lemonadeUiScale_planHelpers(object: GuiBase2d, plan: { () -> () })
	local _, content = lemonadeUiScale_contentBox(object)
	local size = object.AbsoluteSize
	for _, child in object:GetChildren() do
		if child:IsA("UIGridLayout") then
			local cell = Vector2.new(
				lemonadeUiScale_resolve(child.CellSize.X, content.X),
				lemonadeUiScale_resolve(child.CellSize.Y, content.Y)
			)
			local gap = Vector2.new(
				lemonadeUiScale_resolve(child.CellPadding.X, content.X),
				lemonadeUiScale_resolve(child.CellPadding.Y, content.Y)
			)
			table.insert(plan, function()
				child.CellSize = lemonadeUiScale_toScale(cell, content)
				child.CellPadding = lemonadeUiScale_toScale(gap, content)
			end)
		elseif child:IsA("UIListLayout") then
			local extent = if child.FillDirection == Enum.FillDirection.Horizontal then content.X else content.Y
			local gap = lemonadeUiScale_resolve(child.Padding, extent)
			table.insert(plan, function()
				child.Padding = UDim.new(gap / extent, 0)
			end)
		elseif child:IsA("UIPadding") then
			local left = lemonadeUiScale_resolve(child.PaddingLeft, size.X)
			local right = lemonadeUiScale_resolve(child.PaddingRight, size.X)
			local top = lemonadeUiScale_resolve(child.PaddingTop, size.Y)
			local bottom = lemonadeUiScale_resolve(child.PaddingBottom, size.Y)
			table.insert(plan, function()
				child.PaddingLeft = UDim.new(left / size.X, 0)
				child.PaddingRight = UDim.new(right / size.X, 0)
				child.PaddingTop = UDim.new(top / size.Y, 0)
				child.PaddingBottom = UDim.new(bottom / size.Y, 0)
			end)
		elseif child:IsA("UICorner") then
			local shortest = math.min(size.X, size.Y)
			local radius = lemonadeUiScale_resolve(child.CornerRadius, shortest)
			table.insert(plan, function()
				child.CornerRadius = UDim.new(radius / shortest, 0)
			end)
		end
	end
end

local function lemonadeUiScale_convert(screenGui: ScreenGui)
	if screenGui.AbsoluteSize.X <= 0 or screenGui.AbsoluteSize.Y <= 0 then
		return
	end
	local plan: { () -> () } = {}
	for _, descendant in screenGui:GetDescendants() do
		if descendant:IsA("GuiObject") then
			lemonadeUiScale_planObject(descendant, plan)
			if descendant.AbsoluteSize.X > 0 and descendant.AbsoluteSize.Y > 0 then
				lemonadeUiScale_planHelpers(descendant, plan)
			end
		end
	end
	for _, apply in plan do
		apply()
	end
end

local lemonadeUiScale_RunService = game:GetService("RunService")
if lemonadeUiScale_RunService:IsRunning() and lemonadeUiScale_RunService:IsClient() then
	local playerGui = game:GetService("Players").LocalPlayer:WaitForChild("PlayerGui")
	playerGui.ChildAdded:Connect(function(child)
		if not child:IsA("ScreenGui") then
			return
		end
		task.defer(function()
			lemonadeUiScale_RunService.RenderStepped:Wait()
			lemonadeUiScale_convert(child)
		end)
	end)
end

-- layout: wheel-spin
local TweenService = game:GetService("TweenService")
local Players = game:GetService("Players")

-- CONFIG: the ONLY content edits. 8 prizes in wedge order; chances sum to 100.
local CONFIG = {
	prizes = {
		{ name = "x3 Spin",     chance = 18, icon = "rbxassetid://136443558549099", accent = Color3.fromRGB(0, 255, 42) },
		{ name = "2 Crowns",    chance = 22, icon = "rbxassetid://138067739149366", accent = Color3.fromRGB(255, 0, 179) },
		{ name = "10 Trophies", chance = 5,  icon = "rbxassetid://116481146325646", accent = Color3.fromRGB(255, 0, 17) },
		{ name = "x2 Rebirth",  chance = 24, icon = "rbxassetid://136443558549099", accent = Color3.fromRGB(136, 0, 255) },
		{ name = "20 Diamonds", chance = 5,  icon = "rbxassetid://137697610085642", accent = Color3.fromRGB(0, 38, 255) },
		{ name = "5 Diamonds",  chance = 14, icon = "rbxassetid://96283942171480",  accent = Color3.fromRGB(0, 255, 238) },
		{ name = "25k Cash",    chance = 11, icon = "rbxassetid://133456293140151", accent = Color3.fromRGB(255, 238, 0) },
		{ name = "50k Cash",    chance = 1,  icon = "rbxassetid://85935540843502",  accent = Color3.fromRGB(255, 106, 0) },
	},
	spinsLeftText = "You Have 5 Spins Left",
	freeSpinTimer = "15:00",
	buyPacks = {
		{ price = "99",  caption = "+ 3 Spins" },
		{ price = "199", caption = "+ 5 Spins" },
		{ price = "299", caption = "+ 10 Spins" },
	},
}

-- FIXED geometry: wedge slice ids and per-position placement. Never edited.
local SLICE_IDS = {
	"rbxassetid://93917478516867", "rbxassetid://126317571251493",
	"rbxassetid://85329237473568", "rbxassetid://139163490421697",
	"rbxassetid://79640255136580", "rbxassetid://116368159017334",
	"rbxassetid://107141681148446", "rbxassetid://104881857625848",
}
local SLOT_GEOM = {
	{ pos = {0.188, 0.05},  size = {0.316, 0.448}, rot = 335, grad = 90,
	  name = {0.472, 0.171, 0.834, 0.109}, icon = {0.60, 0.35, 0.50, 0.353}, chance = {0.749, 0.571, 0.501, 0.109} },
	{ pos = {0.054, 0.185}, size = {0.448, 0.316}, rot = 285, grad = 0,
	  name = {0.172, 0.564, 0.592, 0.157}, icon = {0.36, 0.63, 0.353, 0.50}, chance = {0.573, 0.714, 0.348, 0.155} },
	{ pos = {0.054, 0.501}, size = {0.448, 0.316}, rot = 260, grad = 0,
	  name = {0.172, 0.397, 0.592, 0.157}, icon = {0.35, 0.33, 0.353, 0.50}, chance = {0.566, 0.282, 0.358, 0.157} },
	{ pos = {0.186, 0.499}, size = {0.316, 0.448}, rot = 205, grad = 270,
	  name = {0.494, 0.813, 0.838, 0.107}, icon = {0.60, 0.65, 0.50, 0.353}, chance = {0.740, 0.456, 0.505, 0.110} },
	{ pos = {0.502, 0.499}, size = {0.316, 0.448}, rot = 155, grad = 270,
	  name = {0.494, 0.813, 0.838, 0.107}, icon = {0.39, 0.65, 0.50, 0.353}, chance = {0.259, 0.455, 0.497, 0.107} },
	{ pos = {0.502, 0.499}, size = {0.448, 0.316}, rot = 100, grad = 180,
	  name = {0.823, 0.411, 0.502, 0.158}, icon = {0.63, 0.33, 0.353, 0.50}, chance = {0.414, 0.290, 0.340, 0.158} },
	{ pos = {0.502, 0.185}, size = {0.448, 0.316}, rot = 80,  grad = 180,
	  name = {0.823, 0.627, 0.502, 0.158}, icon = {0.63, 0.66, 0.353, 0.50}, chance = {0.412, 0.721, 0.320, 0.151} },
	{ pos = {0.502, 0.05},  size = {0.316, 0.448}, rot = 25,  grad = 90,
	  name = {0.495, 0.171, 0.840, 0.109}, icon = {0.39, 0.35, 0.50, 0.353}, chance = {0.266, 0.564, 0.504, 0.109} },
}
local SLOT_START = 23
local SLOT_STEP = 46

local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")

local gui = Instance.new("ScreenGui")
gui.Name = "WheelSpinUI"
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.ResetOnSpawn = false
gui.Parent = playerGui

local sounds = Instance.new("Folder")
sounds.Name = "Sounds"
sounds.Parent = gui
local function makeSound(name, id)
	local s = Instance.new("Sound")
	s.Name = name
	s.SoundId = id
	s.Parent = sounds
	return s
end
local hoverSound = makeSound("UIHover", "rbxassetid://99955064134003")
local clickSound = makeSound("UIClick", "rbxassetid://87437544236708")
local spinSound = makeSound("WheelSpinSound", "rbxassetid://5406934065")
local rewardSound = makeSound("RewardSound", "rbxassetid://4612378086")

-- THEME KIT: the MODERN STUDS surface kit (references/themes/modern-studs/part-1.md), inlined.
-- Every block below is built with makeSurface and every label with makeText; a hand-built
-- button or label is a defect. A change to the kit is a template change with a new hash.
local STUDS = "rbxassetid://92521981645530"
local ROBUX = utf8.char(0xE002)
local OUTLINE = Color3.new(0, 0, 0)
local FONT = Font.fromEnum(Enum.Font.FredokaOne)

local PALETTE = {
	green  = { top = Color3.fromRGB(190, 255, 90),  bottom = Color3.fromRGB(40, 215, 30),  lip = Color3.fromRGB(10, 140, 20) },
	red    = { top = Color3.fromRGB(255, 120, 120), bottom = Color3.fromRGB(225, 20, 30),  lip = Color3.fromRGB(130, 0, 10) },
	gold   = { top = Color3.fromRGB(255, 240, 130), bottom = Color3.fromRGB(240, 170, 20), lip = Color3.fromRGB(150, 95, 0) },
}

-- lip: share of the block's height left showing below the face. rows: stud rows across the face.
local KIND = {
	button = { lip = 0.12, corner = UDim.new(0.22, 0), stroke = 3, rows = 2.5, studs = 0.6 },
	chip   = { lip = 0.12, corner = UDim.new(0.3, 0),  stroke = 3, rows = 2,   studs = 0.7 },
	tile   = { lip = 0.07, corner = UDim.new(0.16, 0), stroke = 4, rows = 4,   studs = 0.6 },
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

-- Wedge, caption and counter labels: plain stroked text, placed in Scale.
local function makeLabel(parent, text, x, y, w, h, z)
	return makeText(parent, text, { position = UDim2.fromScale(x, y), size = UDim2.fromScale(w, h), stroke = 3, z = z or 2 })
end

local wheelFrame = Instance.new("Frame")
wheelFrame.Name = "WheelSpin"
wheelFrame.BackgroundTransparency = 1
wheelFrame.Size = UDim2.new(1, 0, 1, 0)
wheelFrame.Parent = gui
local uiScale = Instance.new("UIScale")
uiScale.Parent = wheelFrame

local wheel = Instance.new("ImageLabel")
wheel.Name = "Wheel"
wheel.BackgroundTransparency = 1
wheel.Image = "rbxassetid://110833418157060"
wheel.AnchorPoint = Vector2.new(0.5, 0.5)
wheel.Position = UDim2.new(0.5, 0, 0.46, 0)
wheel.Size = UDim2.new(0.27, 0, 0.46, 0)
wheel.Parent = wheelFrame
local wheelAspect = Instance.new("UIAspectRatioConstraint")
wheelAspect.AspectRatio = 1
wheelAspect.Parent = wheel

local slotContainer = Instance.new("Frame")
slotContainer.Name = "SlotsContainer"
slotContainer.BackgroundTransparency = 1
slotContainer.Size = UDim2.new(1, 0, 1, 0)
slotContainer.Parent = wheel

for i, prize in ipairs(CONFIG.prizes) do
	local geom = SLOT_GEOM[i]
	local slot = Instance.new("ImageLabel")
	slot.Name = "Slot" .. i
	slot.BackgroundTransparency = 1
	slot.Image = SLICE_IDS[i]
	slot.Position = UDim2.new(geom.pos[1], 0, geom.pos[2], 0)
	slot.Size = UDim2.new(geom.size[1], 0, geom.size[2], 0)
	slot.Parent = slotContainer
	local grad = Instance.new("UIGradient")
	grad.Color = ColorSequence.new(prize.accent, Color3.new(1, 1, 1))
	grad.Rotation = geom.grad
	grad.Parent = slot
	local name = makeLabel(slot, prize.name, geom.name[1], geom.name[2], geom.name[3], geom.name[4])
	name.Rotation = geom.rot
	name.UIStroke.Thickness = 2.5
	local icon = Instance.new("ImageLabel")
	icon.BackgroundTransparency = 1
	icon.Image = prize.icon
	icon.ScaleType = Enum.ScaleType.Fit
	icon.AnchorPoint = Vector2.new(0.5, 0.5)
	icon.Position = UDim2.new(geom.icon[1], 0, geom.icon[2], 0)
	icon.Size = UDim2.new(geom.icon[3], 0, geom.icon[4], 0)
	icon.Rotation = geom.rot
	icon.ZIndex = 2
	icon.Parent = slot
	local chance = makeLabel(slot, prize.chance .. "%", geom.chance[1], geom.chance[2], geom.chance[3], geom.chance[4])
	chance.Rotation = geom.rot
	chance.UIStroke.Thickness = 2.5
end

local divider = Instance.new("ImageLabel")
divider.Name = "Stroke"
divider.BackgroundTransparency = 1
divider.Image = "rbxassetid://134944584099686"
divider.ImageColor3 = Color3.new(0, 0, 0)
divider.AnchorPoint = Vector2.new(0.5, 0.5)
divider.Position = UDim2.new(0.5, 0, 0.5, 0)
divider.Size = UDim2.new(0.909, 0, 0.909, 0)
divider.ZIndex = 2
divider.Parent = wheel

local hub = Instance.new("ImageLabel")
hub.Name = "Middle"
hub.BackgroundTransparency = 1
hub.Image = "rbxassetid://132449669432787"
hub.AnchorPoint = Vector2.new(0.5, 0.5)
hub.Position = UDim2.new(0.5, 0, 0.5, 0)
hub.Size = UDim2.new(0.212, 0, 0.212, 0)
hub.ZIndex = 3
hub.Parent = wheel
local hubAspect = Instance.new("UIAspectRatioConstraint")
hubAspect.AspectRatio = 1
hubAspect.Parent = hub

local arrow = Instance.new("ImageLabel")
arrow.Name = "Arrow"
arrow.BackgroundTransparency = 1
arrow.Image = "rbxassetid://121446361788141"
arrow.AnchorPoint = Vector2.new(0.5, 0.5)
arrow.Position = UDim2.new(0.5, 0, 0.253, 0)
arrow.Size = UDim2.new(0.033, 0, 0.04, 0)
arrow.ZIndex = 3
arrow.Parent = wheelFrame
local arrowAspect = Instance.new("UIAspectRatioConstraint")
arrowAspect.AspectRatio = 1.319
arrowAspect.Parent = arrow

-- CONTROLS (fixed): counter, timer, close, SPIN, three buy packs and the HUD open tile.
makeText(wheelFrame, CONFIG.spinsLeftText, { position = UDim2.fromScale(0.5, 0.715), size = UDim2.fromScale(0.2, 0.034), stroke = 3, extrude = true })
local timerLabel = makeLabel(wheelFrame, "", 0.455, 0.762, 0.13, 0.03)
timerLabel.RichText = true
timerLabel.Text = 'Free Spin in <font color="#3CFF3C">' .. CONFIG.freeSpinTimer .. "</font>"

local closeBtn, closeFace = makeSurface(wheelFrame, "tile", "red", true)
closeBtn.Name = "Close"
closeBtn.AnchorPoint = Vector2.new(0.5, 0.5)
closeBtn.Position = UDim2.new(0.651, 0, 0.246, 0)
closeBtn.Size = UDim2.new(0.03, 0, 0.053, 0)
local closeAspect = Instance.new("UIAspectRatioConstraint")
closeAspect.AspectRatio = 1
closeAspect.DominantAxis = Enum.DominantAxis.Height
closeAspect.Parent = closeBtn
makeText(closeFace, "X", { size = UDim2.fromScale(0.72, 0.72), stroke = 3 })

local spinBtn, spinFace = makeSurface(wheelFrame, "button", "gold", true)
spinBtn.Name = "Spin"
spinBtn.AnchorPoint = Vector2.new(0.5, 0.5)
spinBtn.Position = UDim2.new(0.57, 0, 0.762, 0)
spinBtn.Size = UDim2.new(0.09, 0, 0.052, 0)
makeText(spinFace, "SPIN", { size = UDim2.fromScale(0.86, 0.74), stroke = 3 })

local BUY_X = { 0.364, 0.5, 0.635 }
for i, pack in ipairs(CONFIG.buyPacks) do
	local btn, face = makeSurface(wheelFrame, "button", "green", true)
	btn.Name = "BuyPack" .. i
	btn.AnchorPoint = Vector2.new(0.5, 0.5)
	btn.Position = UDim2.new(BUY_X[i], 0, 0.825, 0)
	btn.Size = UDim2.new(0.129, 0, 0.054, 0)
	makeText(face, ROBUX .. " " .. pack.price, { size = UDim2.fromScale(0.9, 0.74), stroke = 2.5 })
	makeLabel(wheelFrame, pack.caption, BUY_X[i], 0.868, 0.103, 0.022)
end

local openBtn, openFace = makeSurface(gui, "tile", "gold", true)
openBtn.Name = "OpenWheel"
openBtn.AnchorPoint = Vector2.new(0.5, 0.5)
openBtn.Position = UDim2.new(0.032, 0, 0.457, 0)
openBtn.Size = UDim2.new(0.043, 0, 0.072, 0)
local openAspect = Instance.new("UIAspectRatioConstraint")
openAspect.AspectRatio = 0.97
openAspect.DominantAxis = Enum.DominantAxis.Height
openAspect.Parent = openBtn
local openImg = Instance.new("ImageLabel")
openImg.BackgroundTransparency = 1
openImg.Image = "rbxassetid://79841360279510"
openImg.ScaleType = Enum.ScaleType.Fit
openImg.AnchorPoint = Vector2.new(0.5, 0.5)
openImg.Position = UDim2.new(0.5, 0, 0.45, 0)
openImg.Size = UDim2.new(0.8, 0, 0.8, 0)
openImg.ZIndex = 3
openImg.Parent = openFace
-- The timer is a red chip on the tile's face, straddling its bottom edge, drawn above the icon.
local openTimer, openTimerFace = makeSurface(openFace, "chip", "red")
openTimer.Name = "Timer"
openTimer.AnchorPoint = Vector2.new(0.5, 0.5)
openTimer.Position = UDim2.new(0.5, 0, 0.97, 0)
openTimer.Size = UDim2.new(0.86, 0, 0.3, 0)
openTimer.ZIndex = 4
makeText(openTimerFace, CONFIG.freeSpinTimer, { size = UDim2.fromScale(0.86, 0.8), stroke = 2 })

-- ANIMATION (fixed): open/close, hover grow, weighted client spin.
local openTween = TweenService:Create(uiScale, TweenInfo.new(0.35, Enum.EasingStyle.Quart, Enum.EasingDirection.Out), { Scale = 1 })
local closeTween = TweenService:Create(uiScale, TweenInfo.new(0.3, Enum.EasingStyle.Quart, Enum.EasingDirection.In), { Scale = 0 })
local isOpen = true
local spinning = false

local function openUI()
	if isOpen then return end
	isOpen = true
	wheelFrame.Visible = true
	openTween:Play()
end

local function closeUI()
	if not isOpen then return end
	isOpen = false
	closeTween:Play()
	closeTween.Completed:Once(function()
		wheelFrame.Visible = false
	end)
end

openBtn.MouseButton1Click:Connect(function()
	if isOpen then closeUI() else openUI() end
end)
closeBtn.MouseButton1Click:Connect(closeUI)

local function setupHover(button)
	local normalSize = button.Size
	local hoverSize = UDim2.new(normalSize.X.Scale * 1.1, 0, normalSize.Y.Scale * 1.1, 0)
	local clickSize = UDim2.new(normalSize.X.Scale * 0.9, 0, normalSize.Y.Scale * 0.9, 0)
	local ti = TweenInfo.new(0.1, Enum.EasingStyle.Quad, Enum.EasingDirection.InOut)
	button.MouseEnter:Connect(function()
		TweenService:Create(button, ti, { Size = hoverSize }):Play()
		if not hoverSound.IsPlaying then hoverSound:Play() end
	end)
	button.MouseLeave:Connect(function()
		TweenService:Create(button, ti, { Size = normalSize }):Play()
	end)
	button.MouseButton1Down:Connect(function()
		TweenService:Create(button, ti, { Size = clickSize }):Play()
		clickSound:Play()
	end)
	button.MouseButton1Up:Connect(function()
		TweenService:Create(button, ti, { Size = hoverSize }):Play()
	end)
end
for _, obj in ipairs(gui:GetDescendants()) do
	if obj:IsA("TextButton") or obj:IsA("ImageButton") then
		setupHover(obj)
	end
end

local function pickSlot()
	local totalChance = 0
	for _, prize in ipairs(CONFIG.prizes) do
		totalChance += prize.chance
	end
	local roll = math.random(1, totalChance)
	local current = 0
	for i, prize in ipairs(CONFIG.prizes) do
		current += prize.chance
		if roll <= current then
			return i
		end
	end
	return 1
end

spinBtn.MouseButton1Click:Connect(function()
	if spinning then return end
	spinning = true
	local chosenSlot = pickSlot()
	local slotAngle = SLOT_START + (SLOT_STEP * (chosenSlot - 1))
	local spins = math.random(6, 9)
	wheel.Rotation = wheel.Rotation % 360
	local delta = (slotAngle - wheel.Rotation) % 360
	local finalRotation = wheel.Rotation + delta + (360 * spins) + math.random(-10, 10)
	local spinTween = TweenService:Create(wheel, TweenInfo.new(9, Enum.EasingStyle.Quart, Enum.EasingDirection.Out), { Rotation = finalRotation })
	spinSound:Play()
	spinTween:Play()
	spinTween.Completed:Once(function()
		spinning = false
		spinSound:Stop()
		rewardSound:Play()
		print("Won:", CONFIG.prizes[chosenSlot].name)
	end)
end)
