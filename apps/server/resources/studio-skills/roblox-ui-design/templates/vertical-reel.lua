-- Harp vertical-reel template. LocalScript for StarterPlayerScripts or StarterGui.
-- A crate, case or egg opening: a clipped window shows three cards, a long strip slides down and
-- decelerates until the winner sits in the middle. Native UI only; the only picture it needs is the glow.
-- Edit CONFIG and STYLE only. To call it from other scripts, make this a ModuleScript and return `reel`.

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local CONFIG = {
	startOpen = true,
	rollSeconds = 7, -- 4 to 8 reads well
	stripLength = 24, -- cards in the strip, at least 20
	winnerSlot = 19, -- where the winner sits in the strip, at least 15 so the roll travels far; slot 2 rests in the middle
	-- The item pool the strip is filled from. `icon` is a number (a catalogue item id, shown through its
	-- thumbnail) or a string (an image such as "rbxassetid://123"). `rarity` must exist in `rarityColors`.
	items = {
		{ name = "Wooden Sword", chance = "1/2", rarity = "Common", value = "Value: 120", icon = "rbxassetid://94091032987086", weight = 40 },
		{ name = "Old Shield", chance = "1/3", rarity = "Common", value = "Value: 150", icon = "rbxassetid://93114601642790", weight = 30 },
		{ name = "Lucky Axe", chance = "1/6", rarity = "Uncommon", value = "Value: 900", icon = "rbxassetid://75127143522091", weight = 12 },
		{ name = "Speed Shoe", chance = "1/9", rarity = "Uncommon", value = "Value: 1.4K", icon = "rbxassetid://100402338773449", weight = 8 },
		{ name = "Magic Potion", chance = "1/25", rarity = "Rare", value = "Value: 8.5K", icon = "rbxassetid://71202349341308", weight = 4 },
		{ name = "Rocket Pack", chance = "1/40", rarity = "Rare", value = "Value: 12K", icon = "rbxassetid://93379001930135", weight = 2.5 },
		{ name = "Golden Key", chance = "1/90", rarity = "Epic", value = "Value: 70K", icon = "rbxassetid://96066489256923", weight = 1.2 },
		{ name = "Blue Gem", chance = "1/150", rarity = "Epic", value = "Value: 120K", icon = "rbxassetid://73150429062000", weight = 0.7 },
		{ name = "Royal Crown", chance = "1/275", rarity = "Legendary", value = "Value: 540K", icon = "rbxassetid://78843852703854", weight = 0.35 },
		{ name = "Grand Trophy", chance = "1/600", rarity = "Legendary", value = "Value: 1.1M", icon = "rbxassetid://77830885604568", weight = 0.15 },
		{ name = "Diamond", chance = "1/2K", rarity = "Mythic", value = "Value: 9.8M", icon = "rbxassetid://75581768563141", weight = 0.05 },
	},
	-- The game's own rarity colours. Keep the names and colours the same as in its shop and inventory.
	rarityColors = {
		Common = Color3.fromRGB(184, 194, 204),
		Uncommon = Color3.fromRGB(61, 220, 90),
		Rare = Color3.fromRGB(59, 139, 255),
		Epic = Color3.fromRGB(161, 92, 255),
		Legendary = Color3.fromRGB(255, 178, 36),
		Mythic = Color3.fromRGB(255, 77, 109),
	},
	-- Server authority: return the winning item (a table from `items`, or its index) from a server decision.
	-- Left nil, the client draws by weight, which is only for demos.
	requestRoll = nil,
	onLanded = function(item)
		print("reel landed", item.name)
	end,
}

-- Cartoon card look. Swap these to match another theme.
local STYLE = {
	font = Font.fromEnum(Enum.Font.FredokaOne),
	ink = Color3.fromRGB(43, 27, 61),
	card = Color3.fromRGB(28, 24, 48),
	green = { top = Color3.fromRGB(124, 240, 143), base = Color3.fromRGB(61, 220, 90), lip = Color3.fromRGB(31, 158, 58) },
	glow = "rbxassetid://4925956526",
	dice = "rbxassetid://110883654232694",
}

local VISIBLE = 3 -- cards visible in the window; the strip pitch is 1 / VISIBLE of the window height
local PITCH = 1 / VISIBLE
local CARD_WIDTH = 2 * PITCH -- the window is 1:2, so this makes the cards square
local START = 2 -- the strip slot that rests in the middle; slot 1 shows below it
local INFLUENCE = 1.3 -- cards away from the centre that still grow and glow
assert(#CONFIG.items >= 3, "the pool needs at least three items")
assert(CONFIG.stripLength >= 20 and CONFIG.winnerSlot >= 15 and CONFIG.winnerSlot <= CONFIG.stripLength, "strip too short")

local random = Random.new()
local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")

local function new(className, properties, parent)
	local object = Instance.new(className)
	for key, value in properties do
		object[key] = value
	end
	object.Parent = parent
	return object
end

local function makeLabel(parent, name, properties)
	local label = new("TextLabel", {
		Name = name,
		BackgroundTransparency = 1,
		FontFace = STYLE.font,
		TextColor3 = Color3.new(1, 1, 1),
		TextScaled = true,
		TextXAlignment = Enum.TextXAlignment.Center,
		TextYAlignment = Enum.TextYAlignment.Center,
	}, parent)
	for key, value in properties do
		label[key] = value
	end
	new("UIStroke", { Color = STYLE.ink, Thickness = 2, Transparency = 0.2 }, label)
	new("UITextSizeConstraint", { MinTextSize = 8, MaxTextSize = 40 }, label)
	return label
end

local function iconImage(icon)
	if type(icon) == "number" then
		return `rbxthumb://type=Asset&id={icon}&w=150&h=150`
	end
	return icon
end

-- Screen ---------------------------------------------------------------------------------------

local gui = new("ScreenGui", {
	Name = "VerticalReel",
	DisplayOrder = 5,
	Enabled = CONFIG.startOpen,
	IgnoreGuiInset = true,
	ResetOnSpawn = false,
	ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
}, playerGui)
new("Frame", { Name = "Overlay", BackgroundColor3 = Color3.new(0, 0, 0), BackgroundTransparency = 0.45, Size = UDim2.fromScale(1, 1) }, gui)

-- The window is a 1:2 box (sized by `arrange` below). Cards are square inside it.
local window = new("Frame", {
	Name = "Window",
	AnchorPoint = Vector2.new(0.5, 0.5),
	BackgroundColor3 = Color3.fromRGB(14, 12, 26),
	BackgroundTransparency = 0.2,
	ClipsDescendants = true,
	Position = UDim2.fromScale(0.5, 0.45),
}, gui)
new("UIAspectRatioConstraint", { AspectRatio = 0.5 }, window)
new("UICorner", { CornerRadius = UDim.new(0.04, 0) }, window)
new("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Color = STYLE.ink, Thickness = 4 }, window)

-- The holder is as big as the window and slides down; card i starts (i - START) pitches above the middle.
local holder = new("Frame", { Name = "Holder", BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1) }, window)
local cards = {}
for index = 1, CONFIG.stripLength do
	local card = new("Frame", {
		Name = `Card{index}`,
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundTransparency = 1,
		Position = UDim2.fromScale(0.5, 0.5 - (index - START) * PITCH),
		Size = UDim2.fromScale(CARD_WIDTH, PITCH),
	}, holder)
	local scale = new("UIScale", { Scale = 0.7 }, card)
	local glow = new("ImageLabel", {
		Name = "Glow",
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundTransparency = 1,
		Image = STYLE.glow,
		ImageTransparency = 1,
		Position = UDim2.fromScale(0.5, 0.5),
		Rotation = random:NextInteger(0, 359),
		Size = UDim2.fromScale(1.4, 1.4),
	}, card)
	local face = new("Frame", { Name = "Face", BackgroundColor3 = STYLE.card, Size = UDim2.fromScale(1, 1), ZIndex = 2 }, card)
	new("UICorner", { CornerRadius = UDim.new(0.08, 0) }, face)
	local stroke = new("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Thickness = 2, Transparency = 0.3 }, face)
	local top = makeLabel(face, "Top", { Position = UDim2.fromScale(0.05, 0.04), Size = UDim2.fromScale(0.9, 0.13), ZIndex = 3 })
	local icon = new("ImageLabel", {
		Name = "Icon",
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundTransparency = 1,
		ImageTransparency = 0.8,
		Position = UDim2.fromScale(0.5, 0.44),
		ScaleType = Enum.ScaleType.Fit,
		Size = UDim2.fromScale(0.5, 0.5),
		ZIndex = 3,
	}, face)
	local value = makeLabel(face, "Value", { Position = UDim2.fromScale(0.05, 0.68), Size = UDim2.fromScale(0.9, 0.11), ZIndex = 3 })
	local name = makeLabel(face, "ItemName", { Position = UDim2.fromScale(0.05, 0.8), Size = UDim2.fromScale(0.9, 0.15), ZIndex = 3 })
	cards[index] = { scale = scale, glow = glow, icon = icon, stroke = stroke, top = top, value = value, name = name }
end

-- A static frame marks the middle slot.
local selector = new("Frame", {
	Name = "Selector",
	AnchorPoint = Vector2.new(0.5, 0.5),
	BackgroundTransparency = 1,
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromScale(CARD_WIDTH + 0.06, PITCH + 0.03),
	ZIndex = 10,
}, window)
new("UICorner", { CornerRadius = UDim.new(0.08, 0) }, selector)
new("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Color = Color3.new(1, 1, 1), Thickness = 3, Transparency = 0.2 }, selector)

-- ROLL button, with a lip, below the window.
local rollHolder = new("Frame", {
	Name = "Roll",
	AnchorPoint = Vector2.new(0.5, 0.5),
	BackgroundTransparency = 1,
	Position = UDim2.fromScale(0.5, 0.92),
	Size = UDim2.fromScale(0.22, 0.09),
}, gui)
new("UISizeConstraint", { MinSize = Vector2.new(150, 48), MaxSize = Vector2.new(330, 96) }, rollHolder)
local rollScale = new("UIScale", {}, rollHolder)
local lip = new("Frame", { Name = "Lip", BackgroundColor3 = STYLE.green.lip, Position = UDim2.fromScale(0, 0.08), Size = UDim2.fromScale(1, 0.92) }, rollHolder)
new("UICorner", { CornerRadius = UDim.new(0.3, 0) }, lip)
local rollFace = new("TextButton", { Name = "Face", AutoButtonColor = false, BackgroundColor3 = Color3.new(1, 1, 1), Size = UDim2.fromScale(1, 0.92), Text = "" }, rollHolder)
new("UICorner", { CornerRadius = UDim.new(0.3, 0) }, rollFace)
new("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Color = STYLE.ink, Thickness = 3 }, rollFace)
new("UIGradient", { Color = ColorSequence.new(STYLE.green.top, STYLE.green.base), Rotation = 90 }, rollFace)
-- The icon and word sit in their own frame so the list layout never touches the button's other children.
local lockup = new("Frame", { Name = "Lockup", AnchorPoint = Vector2.new(0.5, 0.5), BackgroundTransparency = 1, Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromScale(0.8, 0.7) }, rollFace)
new("UIListLayout", {
	FillDirection = Enum.FillDirection.Horizontal,
	HorizontalAlignment = Enum.HorizontalAlignment.Center,
	Padding = UDim.new(0.06, 0),
	VerticalAlignment = Enum.VerticalAlignment.Center,
}, lockup)
local dice = new("ImageLabel", { Name = "Dice", BackgroundTransparency = 1, Image = STYLE.dice, Size = UDim2.fromScale(0.3, 1) }, lockup)
new("UIAspectRatioConstraint", { AspectRatio = 1 }, dice)
makeLabel(lockup, "Word", { Text = "ROLL", Size = UDim2.fromScale(0.5, 0.85) })

-- A wide window fits 30% x 74% of the screen; a tall one (phone portrait) fits 62% x 62%.
local function arrange()
	local size = workspace.CurrentCamera.ViewportSize
	window.Size = size.X / size.Y >= 1.2 and UDim2.fromScale(0.3, 0.74) or UDim2.fromScale(0.62, 0.62)
end
arrange()
workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(arrange)

-- Behaviour ------------------------------------------------------------------------------------

local strip = {}
local lastWinner
local rolling = false

local function applyItem(card, item)
	local color = CONFIG.rarityColors[item.rarity]
	card.stroke.Color = color
	card.glow.ImageColor3 = color
	card.top.Text = `{item.chance} | {item.rarity}`
	card.top.TextColor3 = color
	card.icon.Image = iconImage(item.icon)
	card.value.Text = item.value
	card.value.TextColor3 = color
	card.name.Text = item.name
end

-- Cards near the middle grow, brighten and glow; the rest rest at their small, dim look.
local function setEmphasis(card, t)
	card.scale.Scale = 0.7 + 0.4 * t
	card.icon.ImageTransparency = 0.8 - 0.65 * t
	card.glow.ImageTransparency = 1 - 0.65 * t
end

local function emphasize()
	local shift = holder.Position.Y.Scale
	local nearest = math.floor(shift / PITCH + 0.5) + START
	for index = nearest - 3, nearest + 3 do
		local card = cards[index]
		if card then
			local away = math.abs(shift - (index - START) * PITCH) / PITCH
			setEmphasis(card, math.clamp(1 - away / INFLUENCE, 0, 1))
		end
	end
end
holder:GetPropertyChangedSignal("Position"):Connect(emphasize)

local function drawItem()
	local total = 0
	for _, item in CONFIG.items do
		total += item.weight
	end
	local pick = random:NextNumber(0, total)
	for _, item in CONFIG.items do
		pick -= item.weight
		if pick <= 0 then
			return item
		end
	end
	return CONFIG.items[#CONFIG.items]
end

-- The middle slot at rest shows the last winner so the strip continues where the last roll stopped; the winner goes
-- to winnerSlot; every other slot is a random pool item that differs from its upper neighbour.
local function fillStrip(winner)
	for index = 1, CONFIG.stripLength do
		local item
		if index == START and lastWinner then
			item = lastWinner
		elseif index == CONFIG.winnerSlot then
			item = winner
		else
			repeat
				item = CONFIG.items[random:NextInteger(1, #CONFIG.items)]
			until item ~= strip[index - 1] and item ~= winner
		end
		strip[index] = item
		applyItem(cards[index], item)
	end
end

local function setRollVisible(visible)
	rollHolder.Visible = visible
end

local function roll(winnerItem)
	if rolling then
		return
	end
	rolling = true
	setRollVisible(false)
	local winner = winnerItem or (CONFIG.requestRoll and CONFIG.requestRoll()) or drawItem()
	if type(winner) == "number" then
		winner = CONFIG.items[winner]
	end
	holder.Position = UDim2.fromScale(0, 0)
	for _, card in cards do
		setEmphasis(card, 0)
	end
	fillStrip(winner)
	emphasize()
	local info = TweenInfo.new(CONFIG.rollSeconds, Enum.EasingStyle.Quint, Enum.EasingDirection.Out)
	local travel = TweenService:Create(holder, info, { Position = UDim2.fromScale(0, (CONFIG.winnerSlot - START) * PITCH) })
	travel.Completed:Once(function()
		rolling = false
		lastWinner = winner
		setRollVisible(true)
		local pulse = TweenInfo.new(0.5, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, 2, true)
		TweenService:Create(cards[CONFIG.winnerSlot].glow, pulse, { ImageTransparency = 0.1 }):Play()
		CONFIG.onLanded(winner)
	end)
	travel:Play()
end

rollFace.MouseEnter:Connect(function()
	TweenService:Create(rollScale, TweenInfo.new(0.12, Enum.EasingStyle.Back), { Scale = 1.06 }):Play()
end)
rollFace.MouseLeave:Connect(function()
	TweenService:Create(rollScale, TweenInfo.new(0.12, Enum.EasingStyle.Back), { Scale = 1 }):Play()
end)
rollFace.Activated:Connect(function()
	roll()
end)

-- Show the first strip at rest: slot START in the middle.
fillStrip(CONFIG.items[1])
emphasize()

local reel = {
	gui = gui,
	roll = roll,
	show = function()
		gui.Enabled = true
	end,
	hide = function()
		if not rolling then
			gui.Enabled = false
		end
	end,
}
-- return reel -- when this file is a ModuleScript
