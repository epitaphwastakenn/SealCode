-- SealCode wheel-spin template. LocalScript for StarterPlayerScripts or StarterGui.
-- Native UI only: eight exact 45 degree wedges drawn from gradient triangles, no image art needed.
-- Edit CONFIG and STYLE only. To call it from other scripts, make this a ModuleScript and return `wheel`.

local Players = game:GetService("Players")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")

local ROBUX = utf8.char(0xE002)

local CONFIG = {
	startOpen = true,
	spins = 5, -- shown in the "spins left" line
	freeSpinText = "FREE in 15:00",
	spinSeconds = 6, -- 3 to 9 reads well; the last third is the slow creep
	extraTurns = { 5, 7 }, -- whole extra turns before the stop, min and max
	jitterDegrees = 12, -- random offset from the wedge centre; keep under 20
	showChance = true,
	-- Exactly eight prizes, clockwise from the top. Weights should total 100.
	-- No two neighbours (including 8 and 1) may share a colour.
	prizes = {
		{ name = "3 Spins", weight = 20, color = Color3.fromRGB(46, 204, 113), icon = "rbxassetid://123370754779214" },
		{ name = "2 Crowns", weight = 16, color = Color3.fromRGB(255, 64, 129), icon = "rbxassetid://78843852703854" },
		{ name = "10 Cups", weight = 6, color = Color3.fromRGB(255, 193, 7), icon = "rbxassetid://77830885604568" },
		{ name = "x2 Rebirth", weight = 22, color = Color3.fromRGB(124, 77, 255), icon = "rbxassetid://80234316052758" },
		{ name = "20 Gems", weight = 4, color = Color3.fromRGB(33, 150, 243), icon = "rbxassetid://75581768563141" },
		{ name = "5 Gems", weight = 15, color = Color3.fromRGB(255, 112, 67), icon = "rbxassetid://73150429062000" },
		{ name = "25K Cash", weight = 14, color = Color3.fromRGB(0, 188, 190), icon = "rbxassetid://70565105539676" },
		{ name = "50K Cash", weight = 3, color = Color3.fromRGB(229, 57, 53), icon = "rbxassetid://83606937519307" },
	},
	packs = {
		{ price = 99, caption = "+ 3 Spins" },
		{ price = 199, caption = "+ 5 Spins" },
		{ price = 299, caption = "+ 10 Spins" },
	},
	sounds = { hover = 99955064134003, click = 87437544236708, spin = 5406934065, reward = 4612378086 },
	-- Server authority: return the winning wedge (1 to 8) from a server decision, or nil to refuse.
	-- Left nil, the client draws by weight, which is only for demos.
	requestSpin = nil,
	onResult = function(prize, index)
		print("wheel result", index, prize.name)
	end,
	onBuyPack = function(packIndex)
		print("wheel buy pack", packIndex)
	end,
}

-- Cartoon card look. Swap these (and `makeButton`) to match another theme.
local STYLE = {
	font = Font.fromEnum(Enum.Font.FredokaOne),
	ink = Color3.fromRGB(43, 27, 61),
	rim = Color3.fromRGB(255, 200, 70),
	hub = Color3.fromRGB(255, 240, 200),
	green = { top = Color3.fromRGB(124, 240, 143), base = Color3.fromRGB(61, 220, 90), lip = Color3.fromRGB(31, 158, 58) },
	gold = { top = Color3.fromRGB(255, 229, 138), base = Color3.fromRGB(255, 210, 63), lip = Color3.fromRGB(201, 154, 8) },
	red = { top = Color3.fromRGB(255, 130, 130), base = Color3.fromRGB(239, 28, 28), lip = Color3.fromRGB(130, 10, 20) },
	grey = { top = Color3.fromRGB(208, 212, 238), base = Color3.fromRGB(147, 149, 168), lip = Color3.fromRGB(90, 92, 110) },
}

local WEDGE = 360 / #CONFIG.prizes -- 45
assert(#CONFIG.prizes == 8, "the wheel needs exactly eight prizes")

local random = Random.new()
local camera = workspace.CurrentCamera
local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")

local function new(className, properties, parent)
	local object = Instance.new(className)
	for key, value in properties do
		object[key] = value
	end
	object.Parent = parent
	return object
end

local function playSound(name)
	local id = CONFIG.sounds[name]
	if id then
		local sound = new("Sound", { SoundId = "rbxassetid://" .. id, Volume = 0.5 }, SoundService)
		sound.Ended:Once(function()
			sound:Destroy()
		end)
		sound.Stopped:Once(function()
			sound:Destroy()
		end)
		sound:Play()
		return sound
	end
end

local function makeLabel(parent, text, properties)
	local label = new("TextLabel", {
		BackgroundTransparency = 1,
		FontFace = STYLE.font,
		Text = text,
		TextColor3 = Color3.new(1, 1, 1),
		TextScaled = true,
		TextXAlignment = Enum.TextXAlignment.Center,
		TextYAlignment = Enum.TextYAlignment.Center,
	}, parent)
	for key, value in properties or {} do
		label[key] = value
	end
	new("UIStroke", { Color = STYLE.ink, Thickness = 2 }, label)
	new("UITextSizeConstraint", { MinTextSize = 8, MaxTextSize = 48 }, label)
	return label
end

local function tween(object, seconds, goal, style, direction)
	local info = TweenInfo.new(seconds, style or Enum.EasingStyle.Quad, direction or Enum.EasingDirection.Out)
	local playing = TweenService:Create(object, info, goal)
	playing:Play()
	return playing
end

-- A UIGradient multiplies the object colour, so a button face is white and its gradient carries the colours.
local function paint(face, colors)
	face.UIGradient.Color = ColorSequence.new(colors.top, colors.base)
	face.Parent.Lip.BackgroundColor3 = colors.lip
end

-- A button with a lip: `holder` carries a UIScale for hover and press, `face` is the TextButton.
local function makeButton(parent, name, text, colors, size)
	local holder = new("Frame", { Name = name, BackgroundTransparency = 1, Size = size }, parent)
	local scale = new("UIScale", {}, holder)
	local lip = new("Frame", {
		Name = "Lip",
		BackgroundColor3 = colors.lip,
		Position = UDim2.fromScale(0, 0.08),
		Size = UDim2.fromScale(1, 0.92),
	}, holder)
	new("UICorner", { CornerRadius = UDim.new(0.3, 0) }, lip)
	local face = new("TextButton", {
		Name = "Face",
		AutoButtonColor = false,
		BackgroundColor3 = Color3.new(1, 1, 1),
		Size = UDim2.fromScale(1, 0.92),
		Text = "",
	}, holder)
	new("UICorner", { CornerRadius = UDim.new(0.3, 0) }, face)
	new("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Color = STYLE.ink, Thickness = 3 }, face)
	new("UIGradient", { Color = ColorSequence.new(colors.top, colors.base), Rotation = 90 }, face)
	if text then
		makeLabel(face, text, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromScale(0.86, 0.6) })
	end
	face.MouseEnter:Connect(function()
		playSound("hover")
		tween(scale, 0.12, { Scale = 1.06 }, Enum.EasingStyle.Back)
	end)
	face.MouseLeave:Connect(function()
		tween(scale, 0.12, { Scale = 1 }, Enum.EasingStyle.Back)
	end)
	face.MouseButton1Down:Connect(function()
		playSound("click")
		tween(scale, 0.08, { Scale = 0.94 })
	end)
	face.MouseButton1Up:Connect(function()
		tween(scale, 0.12, { Scale = 1.06 }, Enum.EasingStyle.Back)
	end)
	return holder, face
end

-- Two right triangles that meet on the axis make an isosceles wedge with its apex at the centre of `parent`.
-- `parent` is square and rotated so the wedge points along its own +x axis; the length is half its width.
local function addWedgeShape(parent, color, halfAngle)
	local tangent = math.tan(math.rad(halfAngle))
	for _, upper in { true, false } do
		local half = new("Frame", {
			AnchorPoint = Vector2.new(0, upper and 1 or 0),
			BackgroundColor3 = color,
			BorderSizePixel = 0,
			Position = UDim2.fromScale(0.5, 0.5),
			Size = UDim2.fromScale(0.5, 0.5 * tangent),
		}, parent)
		-- A hard transparency step on a gradient turned 90 - halfAngle keeps one half of the box.
		new("UIGradient", {
			Rotation = upper and 90 - halfAngle or halfAngle - 90,
			Transparency = NumberSequence.new({
				NumberSequenceKeypoint.new(0, 1),
				NumberSequenceKeypoint.new(0.4999, 1),
				NumberSequenceKeypoint.new(0.5, 0),
				NumberSequenceKeypoint.new(1, 0),
			}),
		}, half)
	end
end

-- Screen ---------------------------------------------------------------------------------------

local gui = new("ScreenGui", { Name = "WheelSpin", DisplayOrder = 5, ResetOnSpawn = false, ZIndexBehavior = Enum.ZIndexBehavior.Sibling }, playerGui)
local root = new("Frame", { Name = "Root", BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Visible = CONFIG.startOpen }, gui)
local rootScale = new("UIScale", {}, root)

-- The wheel box includes the rim. The disc inside it spins; rim, pegs, hub and pointer stay still.
local wheelBox = new("Frame", { Name = "WheelBox", AnchorPoint = Vector2.new(0.5, 0.5), BackgroundTransparency = 1 }, root)
new("UIAspectRatioConstraint", { AspectRatio = 1 }, wheelBox)
local base = new("Frame", { Name = "Base", BackgroundColor3 = STYLE.ink, Size = UDim2.fromScale(1, 1) }, wheelBox)
new("UICorner", { CornerRadius = UDim.new(0.5, 0) }, base)

local disc = new("Frame", {
	Name = "Disc",
	AnchorPoint = Vector2.new(0.5, 0.5),
	BackgroundTransparency = 1,
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromScale(0.88, 0.88),
}, wheelBox)

local iconScales = {}
for index, prize in CONFIG.prizes do
	local centre = WEDGE * (index - 1) -- degrees clockwise from the top
	local shape = new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundTransparency = 1,
		Position = UDim2.fromScale(0.5, 0.5),
		Rotation = centre - 90,
		Size = UDim2.fromScale(1, 1),
	}, disc)
	addWedgeShape(shape, prize.color, WEDGE / 2)
end

-- A frame rotates around its own centre, so each divider hangs off a full-size rotated holder.
for index = 1, #CONFIG.prizes do
	local holder = new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundTransparency = 1,
		Position = UDim2.fromScale(0.5, 0.5),
		Rotation = WEDGE * (index - 1) + WEDGE / 2 - 90,
		Size = UDim2.fromScale(1, 1),
	}, disc)
	new("Frame", {
		AnchorPoint = Vector2.new(0, 0.5),
		BackgroundColor3 = Color3.new(1, 1, 1),
		BackgroundTransparency = 0.35,
		BorderSizePixel = 0,
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.new(0.5, 0, 0, 3),
	}, holder)
end

-- Wedge contents are laid out along the wedge's own axis: y = 0.5 - radius (in disc widths).
for index, prize in CONFIG.prizes do
	local holder = new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundTransparency = 1,
		Position = UDim2.fromScale(0.5, 0.5),
		Rotation = WEDGE * (index - 1),
		Size = UDim2.fromScale(1, 1),
	}, disc)
	makeLabel(holder, prize.name, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.105), Size = UDim2.fromScale(0.3, 0.075) })
	local iconBox = new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), BackgroundTransparency = 1, Position = UDim2.fromScale(0.5, 0.245), Size = UDim2.fromScale(0.14, 0.14) }, holder)
	iconScales[index] = new("UIScale", {}, iconBox)
	new("ImageLabel", { BackgroundTransparency = 1, Image = prize.icon, ScaleType = Enum.ScaleType.Fit, Size = UDim2.fromScale(1, 1) }, iconBox)
	if CONFIG.showChance then
		makeLabel(holder, `{prize.weight}%`, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.35), Size = UDim2.fromScale(0.11, 0.045) })
	end
end

-- The rim is a transparent circle whose stroke is wide enough to hide the octagon corners.
local rim = new("Frame", {
	Name = "Rim",
	AnchorPoint = Vector2.new(0.5, 0.5),
	BackgroundTransparency = 1,
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromScale(0.88, 0.88),
	ZIndex = 3,
}, wheelBox)
new("UICorner", { CornerRadius = UDim.new(0.5, 0) }, rim)
local rimStroke = new("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Color = STYLE.rim, Thickness = 10 }, rim)
wheelBox:GetPropertyChangedSignal("AbsoluteSize"):Connect(function()
	rimStroke.Thickness = wheelBox.AbsoluteSize.X * 0.045
end)

for index = 1, #CONFIG.prizes do
	local angle = math.rad(WEDGE * (index - 1) + WEDGE / 2)
	local peg = new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundColor3 = Color3.new(1, 1, 1),
		Position = UDim2.fromScale(0.5 + 0.4625 * math.sin(angle), 0.5 - 0.4625 * math.cos(angle)),
		Size = UDim2.fromScale(0.03, 0.03),
		ZIndex = 4,
	}, wheelBox)
	new("UICorner", { CornerRadius = UDim.new(0.5, 0) }, peg)
end

local hub = new("Frame", {
	Name = "Hub",
	AnchorPoint = Vector2.new(0.5, 0.5),
	BackgroundColor3 = STYLE.hub,
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromScale(0.16, 0.16),
	ZIndex = 4,
}, wheelBox)
new("UICorner", { CornerRadius = UDim.new(0.5, 0) }, hub)
new("UIStroke", { Color = STYLE.ink, Thickness = 3 }, hub)

-- The pointer is a wedge too: its tip sits just inside the rim and its base points out of the wheel.
for _, part in { { 30, STYLE.ink, 5 }, { 24, Color3.new(1, 1, 1), 6 } } do
	local pointer = new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundTransparency = 1,
		Position = UDim2.fromScale(0.5, 0.105),
		Rotation = -90,
		Size = UDim2.fromScale(0.2, 0.2),
		ZIndex = part[3],
	}, wheelBox)
	addWedgeShape(pointer, part[2], part[1])
end

-- Controls -------------------------------------------------------------------------------------

local controls = new("Frame", { Name = "Controls", BackgroundTransparency = 1 }, root)
new("UIListLayout", {
	HorizontalAlignment = Enum.HorizontalAlignment.Center,
	Padding = UDim.new(0.03, 0),
	SortOrder = Enum.SortOrder.LayoutOrder,
	VerticalAlignment = Enum.VerticalAlignment.Center,
}, controls)
local spinsLabel = makeLabel(controls, "", { Name = "SpinsLeft", LayoutOrder = 1, Size = UDim2.fromScale(1, 0.11) })
local resultLabel = makeLabel(controls, "Spin to win!", { Name = "Result", LayoutOrder = 2, Size = UDim2.fromScale(1, 0.11), TextColor3 = STYLE.gold.base })

local spinRow = new("Frame", { Name = "SpinRow", BackgroundTransparency = 1, LayoutOrder = 3, Size = UDim2.fromScale(1, 0.2) }, controls)
new("UIListLayout", {
	FillDirection = Enum.FillDirection.Horizontal,
	HorizontalAlignment = Enum.HorizontalAlignment.Center,
	Padding = UDim.new(0.04, 0),
	VerticalAlignment = Enum.VerticalAlignment.Center,
}, spinRow)
local _, spinFace = makeButton(spinRow, "Spin", "SPIN", STYLE.gold, UDim2.fromScale(0.5, 1))
makeLabel(spinRow, CONFIG.freeSpinText, { Size = UDim2.fromScale(0.42, 0.6) })

local packRow = new("Frame", { Name = "Packs", BackgroundTransparency = 1, LayoutOrder = 4, Size = UDim2.fromScale(1, 0.3) }, controls)
new("UIListLayout", {
	FillDirection = Enum.FillDirection.Horizontal,
	HorizontalAlignment = Enum.HorizontalAlignment.Center,
	Padding = UDim.new(0.03, 0),
	VerticalAlignment = Enum.VerticalAlignment.Center,
}, packRow)
for packIndex, pack in CONFIG.packs do
	local _, face = makeButton(packRow, `Pack{packIndex}`, nil, STYLE.green, UDim2.fromScale(0.31, 1))
	makeLabel(face, pack.caption, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.3), Size = UDim2.fromScale(0.86, 0.34) })
	makeLabel(face, `{ROBUX} {pack.price}`, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.68), Size = UDim2.fromScale(0.8, 0.38) })
	face.Activated:Connect(function()
		CONFIG.onBuyPack(packIndex)
	end)
end

-- Close (top right of the screen) and the open button (left edge, always visible).
local closeHolder, closeFace = makeButton(root, "Close", nil, STYLE.red, UDim2.fromOffset(48, 48))
closeHolder.AnchorPoint = Vector2.new(1, 0)
closeHolder.Position = UDim2.fromScale(0.98, 0.04)
for _, turn in { 45, -45 } do
	new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundColor3 = Color3.new(1, 1, 1),
		Position = UDim2.fromScale(0.5, 0.5),
		Rotation = turn,
		Size = UDim2.fromScale(0.62, 0.14),
	}, closeFace)
end

local openHolder, openFace = makeButton(gui, "OpenWheel", nil, STYLE.gold, UDim2.fromOffset(56, 56))
openHolder.AnchorPoint = Vector2.new(0, 0.5)
openHolder.Position = UDim2.fromScale(0.02, 0.5)
new("ImageLabel", {
	AnchorPoint = Vector2.new(0.5, 0.5),
	BackgroundTransparency = 1,
	Image = "rbxassetid://120233256572525",
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromScale(0.7, 0.7),
}, openFace)

-- Layout for wide and tall windows ------------------------------------------------------------

local function arrange()
	local size = camera.ViewportSize
	if size.X / size.Y >= 1.2 then
		wheelBox.Position = UDim2.fromScale(0.34, 0.5)
		wheelBox.Size = UDim2.fromScale(0.42, 0.66)
		controls.AnchorPoint = Vector2.new(0, 0.5)
		controls.Position = UDim2.fromScale(0.6, 0.5)
		controls.Size = UDim2.fromScale(0.36, 0.7)
	else
		wheelBox.Position = UDim2.fromScale(0.5, 0.29)
		wheelBox.Size = UDim2.fromScale(0.92, 0.46)
		controls.AnchorPoint = Vector2.new(0.5, 0.5)
		controls.Position = UDim2.fromScale(0.5, 0.7)
		controls.Size = UDim2.fromScale(0.92, 0.32)
	end
end
arrange()
camera:GetPropertyChangedSignal("ViewportSize"):Connect(arrange)

-- Behaviour ------------------------------------------------------------------------------------

local spinning = false
local isOpen = CONFIG.startOpen

local function setSpins(count)
	CONFIG.spins = count
	spinsLabel.Text = `You have {count} spins left`
end

local function drawIndex()
	local total = 0
	for _, prize in CONFIG.prizes do
		total += prize.weight
	end
	local roll = random:NextNumber(0, total)
	for index, prize in CONFIG.prizes do
		roll -= prize.weight
		if roll <= 0 then
			return index
		end
	end
	return #CONFIG.prizes
end

-- Rotation that leaves wedge `index` under the pointer (top), with a few turns and a small random offset.
local function stopRotation(index)
	local jitter = random:NextNumber(-CONFIG.jitterDegrees, CONFIG.jitterDegrees)
	local distance = (-WEDGE * (index - 1) + jitter - disc.Rotation) % 360
	local turns = random:NextInteger(CONFIG.extraTurns[1], CONFIG.extraTurns[2])
	return disc.Rotation + distance + 360 * turns
end

local function setSpinEnabled(enabled)
	spinFace.Active = enabled
	paint(spinFace, enabled and STYLE.gold or STYLE.grey)
end

local function open()
	isOpen = true
	root.Visible = true
	rootScale.Scale = 0
	tween(rootScale, 0.35, { Scale = 1 }, Enum.EasingStyle.Quart)
end

local function close()
	if spinning or not isOpen then
		return
	end
	isOpen = false
	tween(rootScale, 0.3, { Scale = 0 }, Enum.EasingStyle.Quart, Enum.EasingDirection.In).Completed:Once(function()
		if not isOpen then
			root.Visible = false
		end
	end)
end

local function finishSpin(index, target, spinSound)
	spinning = false
	disc.Rotation = target % 360
	if spinSound then
		spinSound:Stop()
	end
	playSound("reward")
	local prize = CONFIG.prizes[index]
	resultLabel.Text = `You won {prize.name}!`
	TweenService:Create(iconScales[index], TweenInfo.new(0.25, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, 1, true), { Scale = 1.35 }):Play()
	setSpinEnabled(true)
	CONFIG.onResult(prize, index)
end

-- `forcedIndex` is for tests and cutscenes; normal play lets requestSpin (server) or the demo draw decide.
local function spin(forcedIndex)
	if spinning then
		return
	end
	spinning = true
	setSpinEnabled(false)
	local index = forcedIndex
	if not index and CONFIG.requestSpin then
		index = CONFIG.requestSpin()
	elseif not index and CONFIG.spins > 0 then
		setSpins(CONFIG.spins - 1)
		index = drawIndex()
	end
	if not index then
		spinning = false
		setSpinEnabled(true)
		resultLabel.Text = "No spins left"
		return
	end
	resultLabel.Text = "Spinning..."
	local target = stopRotation(index)
	local spinSound = playSound("spin")
	tween(disc, CONFIG.spinSeconds, { Rotation = target }, Enum.EasingStyle.Quart).Completed:Once(function()
		finishSpin(index, target, spinSound)
	end)
end

spinFace.Activated:Connect(function()
	spin()
end)
closeFace.Activated:Connect(close)
openFace.Activated:Connect(function()
	if isOpen then
		close()
	else
		open()
	end
end)
setSpins(CONFIG.spins)

local wheel = { gui = gui, spin = spin, open = open, close = close, setSpins = setSpins }
-- return wheel -- when this file is a ModuleScript
