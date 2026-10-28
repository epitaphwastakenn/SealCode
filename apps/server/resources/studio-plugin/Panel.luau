--!nocheck
-- The dock panel, drawn in Studio's own colours so it reads like part of Studio: a header,
-- collapsible sections for the connection, the agent's activity and safety, and every agent
-- tool with its own switch, filtered by the search box.

local Catalog = require(script.Parent.Catalog)
local Config = require(script.Parent.Config)
local Lifetime = require(script.Parent.Lifetime)
local State = require(script.Parent.State)

local Panel = {}

local C = Enum.StudioStyleGuideColor
local M = Enum.StudioStyleGuideModifier

local themed = {}

local function color(token, modifier)
	local ok, value = pcall(function()
		return settings().Studio.Theme:GetColor(token, modifier or M.Default)
	end)
	return if ok then value else Color3.fromRGB(46, 46, 46)
end

local function paint(instance: Instance, property: string, token, modifier)
	table.insert(themed, { instance = instance, property = property, token = token, modifier = modifier })
	instance[property] = color(token, modifier)
end

local function repaint()
	for i = #themed, 1, -1 do
		local entry = themed[i]
		if entry.instance.Parent == nil and not entry.keep then
			table.remove(themed, i)
		else
			entry.instance[entry.property] = color(entry.token, entry.modifier)
		end
	end
end

local FONT = Font.new("rbxasset://fonts/families/BuilderSans.json", Enum.FontWeight.Regular)
local FONT_MEDIUM = Font.new("rbxasset://fonts/families/BuilderSans.json", Enum.FontWeight.Medium)
local FONT_BOLD = Font.new("rbxasset://fonts/families/BuilderSans.json", Enum.FontWeight.Bold)

local STATUS = {
	connected = Color3.fromRGB(70, 200, 120),
	working = Color3.fromRGB(90, 160, 255),
	waiting = Color3.fromRGB(240, 190, 60),
	error = Color3.fromRGB(235, 90, 90),
	idle = Color3.fromRGB(140, 140, 140),
}

local function new(className: string, props, children)
	local instance = Instance.new(className)
	for key, value in props or {} do
		if key ~= "Parent" then
			instance[key] = value
		end
	end
	for _, child in children or {} do
		child.Parent = instance
	end
	if props and props.Parent then
		instance.Parent = props.Parent
	end
	return instance
end

local function corner(radius: number)
	return new("UICorner", { CornerRadius = UDim.new(0, radius) })
end

local function pad(top: number, right: number?, bottom: number?, left: number?)
	return new("UIPadding", {
		PaddingTop = UDim.new(0, top),
		PaddingRight = UDim.new(0, right or top),
		PaddingBottom = UDim.new(0, bottom or top),
		PaddingLeft = UDim.new(0, left or right or top),
	})
end

local function list(gap: number, horizontal: boolean?)
	return new("UIListLayout", {
		Padding = UDim.new(0, gap),
		SortOrder = Enum.SortOrder.LayoutOrder,
		FillDirection = if horizontal then Enum.FillDirection.Horizontal else Enum.FillDirection.Vertical,
		VerticalAlignment = if horizontal then Enum.VerticalAlignment.Center else Enum.VerticalAlignment.Top,
	})
end

local function border(parent: Instance, token)
	local s = new("UIStroke", { Thickness = 1, ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Parent = parent })
	paint(s, "Color", token or C.Border)
	return s
end

local function text(props)
	local label = new("TextLabel", {
		BackgroundTransparency = 1,
		FontFace = props.font or FONT,
		TextSize = props.size or 13,
		TextXAlignment = props.align or Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Center,
		TextWrapped = props.wrap ~= false,
		TextTruncate = if props.wrap == false then Enum.TextTruncate.AtEnd else Enum.TextTruncate.None,
		RichText = props.rich == true,
		AutomaticSize = if props.height then Enum.AutomaticSize.None else Enum.AutomaticSize.Y,
		Size = props.sizeUDim or UDim2.new(1, 0, 0, props.height or 0),
		Text = props.text or "",
		LayoutOrder = props.order or 0,
		Parent = props.parent,
	})
	paint(label, "TextColor3", props.color or C.MainText)
	return label
end

local function button(props)
	local b = new("TextButton", {
		AutoButtonColor = false,
		FontFace = FONT_MEDIUM,
		TextSize = 13,
		Size = props.sizeUDim or UDim2.new(0, 0, 0, 26),
		AutomaticSize = if props.sizeUDim then Enum.AutomaticSize.None else Enum.AutomaticSize.X,
		Text = props.text,
		LayoutOrder = props.order or 0,
		Parent = props.parent,
	}, { corner(4), pad(0, 12, 0, 12) })
	local primary = props.primary == true
	paint(b, "BackgroundColor3", if primary then C.DialogMainButton else C.Button)
	paint(b, "TextColor3", if primary then C.DialogMainButtonText else C.ButtonText)
	border(b, if primary then C.DialogMainButton else C.ButtonBorder)
	b.MouseEnter:Connect(function()
		b.BackgroundColor3 = color(if primary then C.DialogMainButton else C.Button, M.Hover)
	end)
	b.MouseLeave:Connect(function()
		b.BackgroundColor3 = color(if primary then C.DialogMainButton else C.Button)
	end)
	b.Activated:Connect(props.onClick)
	return b
end

-- A row with a checkbox, a label and an optional hint; the whole row toggles.
local function checkRow(props)
	local row = new("TextButton", {
		AutoButtonColor = false,
		BackgroundTransparency = 1,
		Text = "",
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		LayoutOrder = props.order or 0,
		Parent = props.parent,
	}, { pad(3, 4, 3, 2) })
	local box = new("Frame", {
		Size = UDim2.fromOffset(14, 14),
		Position = UDim2.new(0, 0, 0, 2),
		Parent = row,
	}, { corner(3) })
	paint(box, "BackgroundColor3", if props.checked then C.DialogMainButton else C.CheckedFieldBackground)
	border(box, if props.checked then C.DialogMainButton else C.CheckedFieldBorder)
	if props.checked then
		local mark = text({ text = "✓", size = 11, font = FONT_BOLD, align = Enum.TextXAlignment.Center, parent = box, sizeUDim = UDim2.fromScale(1, 1), wrap = false })
		mark.AutomaticSize = Enum.AutomaticSize.None
		paint(mark, "TextColor3", C.DialogMainButtonText)
	end
	local body = new("Frame", {
		BackgroundTransparency = 1,
		Position = UDim2.new(0, 22, 0, 0),
		Size = UDim2.new(1, -22, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		Parent = row,
	}, { list(1) })
	text({ text = props.label, size = 13, parent = body, order = 1, color = if props.dim then C.DimmedText else C.MainText })
	if props.hint then
		text({ text = props.hint, size = 11, parent = body, order = 2, color = C.DimmedText })
	end
	row.Activated:Connect(props.onToggle)
	return row
end

local function relativeTime(started: number?): string
	if started == nil then
		return ""
	end
	return string.format("%.1fs", started / 1000)
end

-- What the header dot and line say about the link.
local function status(): (Color3, string)
	local phase = State.connection.phase
	if phase == "connected" then
		if State.inFlight > 0 then
			return STATUS.working, "Agent working"
		end
		return STATUS.connected, if State.server.agentLinked then "Connected · agent ready" else "Connected"
	elseif phase == "connecting" then
		return STATUS.waiting, "Connecting…"
	elseif phase == "retrying" then
		return STATUS.waiting, "Waiting for Harp"
	elseif phase == "refused" or phase == "duplicate" then
		return STATUS.error, "Not linked"
	end
	return STATUS.idle, "Disconnected"
end

function Panel.create(plugin, widget, actions)
	widget.Title = Config.productName

	local root = new("Frame", { Name = "SealCodePanel", Size = UDim2.fromScale(1, 1), BorderSizePixel = 0, Parent = widget })
	paint(root, "BackgroundColor3", C.MainBackground)
	Lifetime.onStop(function()
		root:Destroy()
	end)

	-- Header: title, status line and the search box stay put while the list below redraws.
	local header = new("Frame", {
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		Parent = root,
	}, { pad(10, 10, 8, 10), list(6) })
	text({ text = "Harp Studio", font = FONT_BOLD, size = 15, align = Enum.TextXAlignment.Center, parent = header, order = 1 })
	local statusRow = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 16), LayoutOrder = 2, Parent = header })
	local statusLayout = list(6, true)
	statusLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
	statusLayout.Parent = statusRow
	local dot = new("Frame", { Size = UDim2.fromOffset(8, 8), LayoutOrder = 1, Parent = statusRow }, { corner(4) })
	local statusText = text({ text = "", size = 12, parent = statusRow, order = 2, wrap = false, sizeUDim = UDim2.new(0, 0, 0, 16), color = C.DimmedText })
	statusText.AutomaticSize = Enum.AutomaticSize.X

	local searchBox = new("TextBox", {
		Size = UDim2.new(1, 0, 0, 26),
		ClearTextOnFocus = false,
		PlaceholderText = "Search tools…",
		Text = "",
		FontFace = FONT,
		TextSize = 13,
		TextXAlignment = Enum.TextXAlignment.Left,
		LayoutOrder = 3,
		Parent = header,
	}, { corner(4), pad(0, 8, 0, 8) })
	paint(searchBox, "BackgroundColor3", C.InputFieldBackground)
	paint(searchBox, "TextColor3", C.MainText)
	paint(searchBox, "PlaceholderColor3", C.DimmedText)
	border(searchBox, C.InputFieldBorder)

	local scroller = new("ScrollingFrame", {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Position = UDim2.new(0, 0, 0, 0),
		Size = UDim2.new(1, 0, 1, 0),
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollBarThickness = 6,
		ScrollingDirection = Enum.ScrollingDirection.Y,
		Parent = root,
	})
	paint(scroller, "ScrollBarImageColor3", C.ScrollBar)
	local function placeScroller()
		local top = header.AbsoluteSize.Y
		scroller.Position = UDim2.new(0, 0, 0, top)
		scroller.Size = UDim2.new(1, 0, 1, -top)
	end
	Lifetime.connect(header:GetPropertyChangedSignal("AbsoluteSize"), placeScroller)
	placeScroller()

	local content = nil
	local collapsed = State.getSetting("collapsed")
	if type(collapsed) ~= "table" then
		collapsed = { activity = false, safety = false }
		for _, group in Catalog do
			collapsed["tools:" .. group.id] = true
		end
	end

	local function setCollapsed(id: string, value: boolean)
		collapsed[id] = value
		State.setSetting("collapsed", collapsed)
	end

	local render

	-- A box with a clickable ▸/▾ title, like Studio's own property groups.
	local function section(parent, order: number, id: string, title: string, aside: string?, fill)
		local open = collapsed[id] ~= true
		local box = new("Frame", {
			Size = UDim2.new(1, 0, 0, 0),
			AutomaticSize = Enum.AutomaticSize.Y,
			LayoutOrder = order,
			Parent = parent,
		}, { corner(4), list(0) })
		paint(box, "BackgroundColor3", C.Button)
		border(box, C.ButtonBorder)
		local head = new("TextButton", {
			AutoButtonColor = false,
			BackgroundTransparency = 1,
			Text = "",
			Size = UDim2.new(1, 0, 0, 28),
			LayoutOrder = 1,
			Parent = box,
		}, { pad(0, 10, 0, 8) })
		-- Builder Sans has no triangle glyphs: a ">" turned 90 degrees when open reads the same.
		local arrow = text({ text = ">", font = FONT_BOLD, size = 12, parent = head, wrap = false, align = Enum.TextXAlignment.Center, sizeUDim = UDim2.fromOffset(12, 28), color = C.DimmedText })
		arrow.AutomaticSize = Enum.AutomaticSize.None
		arrow.Rotation = if open then 90 else 0
		local titleLabel = text({ text = title, font = FONT_MEDIUM, size = 13, parent = head, wrap = false, sizeUDim = UDim2.new(1, -80, 0, 28) })
		titleLabel.Position = UDim2.fromOffset(16, 0)
		titleLabel.AutomaticSize = Enum.AutomaticSize.None
		if aside then
			local asideLabel = text({ text = aside, size = 11, parent = head, wrap = false, align = Enum.TextXAlignment.Right, sizeUDim = UDim2.new(0, 70, 0, 28), color = C.DimmedText })
			asideLabel.AnchorPoint = Vector2.new(1, 0)
			asideLabel.Position = UDim2.new(1, 0, 0, 0)
			asideLabel.AutomaticSize = Enum.AutomaticSize.None
		end
		head.MouseEnter:Connect(function()
			box.BackgroundColor3 = color(C.Button, M.Hover)
		end)
		head.MouseLeave:Connect(function()
			box.BackgroundColor3 = color(C.Button)
		end)
		head.Activated:Connect(function()
			setCollapsed(id, open)
			render()
		end)
		if open then
			local body = new("Frame", {
				BackgroundTransparency = 1,
				Size = UDim2.new(1, 0, 0, 0),
				AutomaticSize = Enum.AutomaticSize.Y,
				LayoutOrder = 2,
				Parent = box,
			}, { pad(2, 10, 10, 10), list(6) })
			fill(body)
		end
		return box
	end

	local function connectionSection(parent, order)
		local phase = State.connection.phase
		section(parent, order, "connection", "Connection", if phase == "connected" then "linked" else nil, function(body)
			if State.server.pluginOutdated or State.server.pluginUpdated then
				local note = text({ text = "Updating the plugin from Harp…", size = 12, parent = body, order = 0 })
				note.TextColor3 = STATUS.waiting
			end
			if State.notice then
				local note = text({ text = State.notice, size = 12, parent = body, order = 1 })
				note.TextColor3 = STATUS.working
			end
			local detail = State.connection.detail
			if phase ~= "connected" and detail then
				text({ text = detail, size = 12, parent = body, order = 2, color = C.DimmedText })
			end
			local place = State.placeName or game.Name
			text({ text = "Place: <b>" .. place .. "</b>", rich = true, size = 12, parent = body, order = 3 })
			local peerNames = {}
			for _, peer in State.peers do
				table.insert(peerNames, tostring(peer.role or peer.logicalId or "peer"))
			end
			if #peerNames > 0 then
				text({ text = "Peers: " .. table.concat(peerNames, ", "), size = 12, parent = body, order = 4, color = C.DimmedText })
			end
			text({
				text = string.format("Harp %s · %s · protocol %s", tostring(State.server.build or "?"), Config.baseUrl, tostring(Config.protocol)),
				size = 11,
				parent = body,
				order = 5,
				color = C.DimmedText,
			})
			local buttons = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 26), LayoutOrder = 6, Parent = body }, { list(6, true) })
			button({ text = if actions.isActive() then "Disconnect" else "Connect", primary = not actions.isActive(), parent = buttons, order = 1, onClick = actions.toggleConnection })
			if phase ~= "connected" and actions.isActive() then
				button({ text = "Retry now", parent = buttons, order = 2, onClick = actions.retryNow })
			end
			button({ text = "Diagnostics", parent = buttons, order = 3, onClick = function()
				print("[Harp] Diagnostics\n" .. table.concat(State.transportLog, "\n"))
			end })
		end)
	end

	local function activitySection(parent, order)
		local count = #State.activity
		section(parent, order, "activity", "Agent activity", if count > 0 then tostring(count) else nil, function(body)
			if count == 0 then
				text({ text = "Nothing yet. What the agent does in Studio shows up here.", size = 12, parent = body, color = C.DimmedText })
				return
			end
			for i, entry in State.activity do
				if i > 12 then
					break
				end
				local mark = if entry.state == "running" then "…" elseif entry.state == "error" then "×" else "✓"
				local line = string.format(
					"%s  <font transparency=\"0.35\">%s</font>  <b>%s</b>%s",
					mark,
					tostring(entry.time),
					tostring(entry.tool),
					if entry.durationMs then "  <font transparency=\"0.35\">" .. relativeTime(entry.durationMs) .. "</font>" else ""
				)
				local label = text({ text = line, rich = true, size = 12, parent = body, order = i })
				if entry.state == "error" then
					label.TextColor3 = STATUS.error
				end
				if entry.summary then
					text({ text = tostring(entry.summary), size = 11, parent = body, order = i, color = C.DimmedText })
				end
				if entry.error then
					local err = text({ text = tostring(entry.error), size = 11, parent = body, order = i })
					err.TextColor3 = STATUS.error
				end
			end
		end)
	end

	local function safetySection(parent, order)
		local toggles = State.toggles
		section(parent, order, "safety", "Safety", nil, function(body)
			checkRow({ parent = body, order = 1, checked = toggles.paused, label = "Pause the agent", hint = "Refuse every request until you resume.", onToggle = function()
				State.setToggle("paused", not toggles.paused)
			end })
			checkRow({ parent = body, order = 2, checked = toggles.readOnly, label = "Read-only", hint = "The agent can look but not change the place.", onToggle = function()
				State.setToggle("readOnly", not toggles.readOnly)
			end })
			checkRow({ parent = body, order = 3, checked = toggles.allowLuau, label = "Allow running Luau", hint = "execute_luau and runtime eval.", onToggle = function()
				State.setToggle("allowLuau", not toggles.allowLuau)
			end })
			text({ text = "Enforced here in Studio, whatever the agent asks.", size = 11, parent = body, order = 4, color = C.DimmedText })
		end)
	end

	local function toolSections(parent, firstOrder)
		local query = string.lower(searchBox.Text)
		local disabled = State.toggles.disabledTools or {}
		local order = firstOrder
		for _, group in Catalog do
			local matches = {}
			for _, tool in group.tools do
				local name, title = tool[1], tool[2]
				if query == "" or string.find(string.lower(name .. " " .. title .. " " .. group.title), query, 1, true) then
					table.insert(matches, tool)
				end
			end
			if #matches > 0 then
				local on = 0
				for _, tool in group.tools do
					if not disabled[tool[1]] then
						on += 1
					end
				end
				local id = "tools:" .. group.id
				if query ~= "" then
					collapsed[id] = false
				end
				order += 1
				section(parent, order, id, group.title, string.format("%d/%d on", on, #group.tools), function(body)
					for i, tool in matches do
						local name, title = tool[1], tool[2]
						local enabled = not disabled[name]
						checkRow({ parent = body, order = i, checked = enabled, dim = not enabled, label = title, hint = name, onToggle = function()
							State.setToolEnabled(name, not enabled)
						end })
					end
				end)
			end
		end
		if order == firstOrder then
			text({ text = "No tool matches “" .. searchBox.Text .. "”.", size = 12, parent = parent, order = order + 1, color = C.DimmedText })
		end
	end

	local pending = false
	render = function()
		if not Lifetime.alive then
			return
		end
		local dotColor, line = status()
		dot.BackgroundColor3 = dotColor
		statusText.Text = line
		if content then
			content:Destroy()
			for i = #themed, 1, -1 do
				if not themed[i].instance:IsDescendantOf(root) then
					table.remove(themed, i)
				end
			end
		end
		content = new("Frame", {
			BackgroundTransparency = 1,
			Size = UDim2.new(1, 0, 0, 0),
			AutomaticSize = Enum.AutomaticSize.Y,
			Parent = scroller,
		}, { pad(2, 10, 12, 10), list(6) })
		if searchBox.Text == "" then
			connectionSection(content, 1)
			activitySection(content, 2)
			safetySection(content, 3)
			local caption = text({ text = "AGENT TOOLS", font = FONT_MEDIUM, size = 11, parent = content, order = 4, color = C.DimmedText })
			caption.Size = UDim2.new(1, 0, 0, 22)
			caption.AutomaticSize = Enum.AutomaticSize.None
		end
		toolSections(content, 10)
	end

	-- Coalesces bursts of state changes into one redraw.
	local function schedule()
		if pending then
			return
		end
		pending = true
		task.delay(0.15, function()
			pending = false
			render()
		end)
	end

	State.onChanged(schedule)
	Lifetime.connect(searchBox:GetPropertyChangedSignal("Text"), schedule)
	Lifetime.connect(settings().Studio.ThemeChanged, function()
		repaint()
		schedule()
	end)
	render()
	return widget
end

return Panel
