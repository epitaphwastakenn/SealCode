--!nocheck
-- The dock panel: connection, peers, what the agent is doing, and the user's safety toggles.
-- Colours follow SealCode's palette in Studio's light or dark theme.

local Config = require(script.Parent.Config)
local State = require(script.Parent.State)

local Panel = {}

local PALETTES = {
	dark = {
		canvas = Color3.fromHex("#120a1f"),
		surface = Color3.fromHex("#1a0e2b"),
		raised = Color3.fromHex("#211238"),
		border = Color3.fromHex("#2f1d4a"),
		ink = Color3.fromHex("#f5f5f5"),
		muted = Color3.fromHex("#a3a0ad"),
		primary = Color3.fromHex("#a78bfa"),
		onPrimary = Color3.fromHex("#1a0e2b"),
		success = Color3.fromHex("#34d399"),
		warning = Color3.fromHex("#fbbf24"),
		error = Color3.fromHex("#f87171"),
	},
	light = {
		canvas = Color3.fromHex("#ffffff"),
		surface = Color3.fromHex("#f7f5fb"),
		raised = Color3.fromHex("#efeaf8"),
		border = Color3.fromHex("#e4e4e7"),
		ink = Color3.fromHex("#27272a"),
		muted = Color3.fromHex("#71717a"),
		primary = Color3.fromHex("#7c3aed"),
		onPrimary = Color3.fromHex("#ffffff"),
		success = Color3.fromHex("#047857"),
		warning = Color3.fromHex("#b45309"),
		error = Color3.fromHex("#dc2626"),
	},
}

local themed = {}
local palette = PALETTES.dark

local function font(bold: boolean?)
	local ok, face = pcall(function()
		return Font.new("rbxasset://fonts/families/BuilderSans.json", if bold then Enum.FontWeight.Bold else Enum.FontWeight.Medium)
	end)
	return if ok then face else Font.fromEnum(if bold then Enum.Font.GothamBold else Enum.Font.Gotham)
end

local function paint(instance: Instance, property: string, token: string)
	table.insert(themed, { instance = instance, property = property, token = token })
	instance[property] = palette[token]
end

local function applyTheme()
	local isDark = true
	pcall(function()
		isDark = settings().Studio.Theme.Name ~= "Light"
	end)
	palette = if isDark then PALETTES.dark else PALETTES.light
	for _, entry in themed do
		entry.instance[entry.property] = palette[entry.token]
	end
end

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

local function stroke(parent: Instance)
	local s = new("UIStroke", { Thickness = 1, ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Parent = parent })
	paint(s, "Color", "border")
	return s
end

local function padding(px: number)
	return new("UIPadding", {
		PaddingTop = UDim.new(0, px), PaddingBottom = UDim.new(0, px),
		PaddingLeft = UDim.new(0, px), PaddingRight = UDim.new(0, px),
	})
end

local function label(props)
	local text = new("TextLabel", {
		BackgroundTransparency = 1,
		FontFace = font(props.bold),
		TextSize = props.size or 13,
		TextXAlignment = props.align or Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Center,
		TextWrapped = props.wrap ~= false,
		RichText = props.rich == true,
		AutomaticSize = props.autoSize or Enum.AutomaticSize.Y,
		Size = props.sizeUDim or UDim2.new(1, 0, 0, 0),
		Text = props.text or "",
		LayoutOrder = props.order or 0,
		Parent = props.parent,
	})
	paint(text, "TextColor3", props.color or "ink")
	return text
end

local function card(parent: Instance, order: number)
	local frame = new("Frame", {
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		LayoutOrder = order,
		Parent = parent,
	}, {
		corner(8),
		padding(10),
		new("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	paint(frame, "BackgroundColor3", "surface")
	stroke(frame)
	return frame
end

local function button(props)
	local b = new("TextButton", {
		AutoButtonColor = true,
		FontFace = font(true),
		TextSize = 13,
		Size = props.sizeUDim or UDim2.new(0, 96, 0, 30),
		Text = props.text,
		LayoutOrder = props.order or 0,
		Parent = props.parent,
	}, { corner(6) })
	paint(b, "BackgroundColor3", props.primary and "primary" or "raised")
	paint(b, "TextColor3", props.primary and "onPrimary" or "ink")
	if not props.primary then
		stroke(b)
	end
	b.Activated:Connect(props.onClick)
	return b
end

local function checkbox(props)
	local row = new("TextButton", {
		AutoButtonColor = false,
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 0, 24),
		Text = "",
		LayoutOrder = props.order,
		Parent = props.parent,
	})
	local box = new("Frame", { Size = UDim2.new(0, 16, 0, 16), Position = UDim2.new(0, 0, 0.5, -8), Parent = row }, { corner(4) })
	local mark = new("TextLabel", {
		BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Text = "✓", FontFace = font(true), TextSize = 12, Parent = box,
	})
	paint(mark, "TextColor3", "onPrimary")
	stroke(box)
	local text = label({ text = props.text, parent = row, size = 13, autoSize = Enum.AutomaticSize.None, sizeUDim = UDim2.new(1, -24, 1, 0) })
	text.Position = UDim2.new(0, 24, 0, 0)
	local function render()
		local on = props.get()
		box.BackgroundColor3 = if on then palette.primary else palette.raised
		mark.Visible = on
	end
	row.Activated:Connect(function()
		props.set(not props.get())
		render()
	end)
	return render
end

local STATUS = {
	idle = { "Not connected", "muted" },
	connecting = { "Connecting", "warning" },
	retrying = { "Reconnecting", "warning" },
	refused = { "Restart Studio", "warning" },
	duplicate = { "Already linked", "warning" },
}

function Panel.statusLine()
	local phase = State.connection.phase
	if phase == "connected" then
		if State.toggles.paused then
			return "Connected · agent paused", "warning", "Studio refuses every agent request until you resume."
		end
		if not State.server.agentLinked then
			return "Connected", "warning", "Waiting for SealCode's agent tools to link."
		end
		if State.inFlight > 0 then
			return "Agent working", "primary", string.format("%d request(s) running in this place.", State.inFlight)
		end
		return "Connected", "success", if State.server.agentActive then "Agent active in a SealCode thread." else "Ready for agent tasks."
	end
	local entry = STATUS[phase] or STATUS.idle
	local detail = State.connection.detail
	if phase == "idle" then
		detail = "Press Connect to link this place to SealCode."
	elseif State.connection.failures >= 50 then
		detail = (detail or "") .. " Still retrying every 5 s."
	end
	return entry[1], entry[2], detail
end

function Panel.diagnostics(): string
	local lines = {
		"SealCode Studio plugin " .. Config.build .. " (protocol " .. tostring(Config.protocol) .. ")",
		"Bridge: " .. Config.baseUrl .. " · server build " .. tostring(State.server.build) .. " protocol " .. tostring(State.server.protocol),
		"Studio: " .. version(),
		"Place: " .. tostring(State.instanceId) .. " · role " .. State.role,
		"Phase: " .. State.connection.phase .. " · failures " .. tostring(State.connection.failures) .. " · last status " .. tostring(State.connection.lastStatusCode),
		"Last error: " .. tostring(State.connection.lastError),
	}
	for _, line in State.transportLog do
		table.insert(lines, "  " .. line)
	end
	return table.concat(lines, "\n")
end

function Panel.create(plugin, actions)
	local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 360, 520, 300, 300)
	local widget
	local ok = pcall(function()
		widget = plugin:CreateDockWidgetPluginGuiAsync("SealCodeStudioPanel", info)
	end)
	if not ok or widget == nil then
		widget = plugin:CreateDockWidgetPluginGui("SealCodeStudioPanel", info)
	end
	widget.Title = Config.productName .. " Studio"
	widget.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

	local root = new("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1),
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
		Parent = widget,
	}, {
		padding(12),
		new("UIListLayout", { Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	paint(root, "BackgroundColor3", "canvas")
	paint(root, "ScrollBarImageColor3", "border")

	-- Header
	local header = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 36), LayoutOrder = 1, Parent = root })
	local tile = new("TextLabel", {
		Size = UDim2.new(0, 34, 0, 34), Text = "S", FontFace = font(true), TextSize = 18, Parent = header,
	}, { corner(9) })
	paint(tile, "BackgroundColor3", "primary")
	paint(tile, "TextColor3", "onPrimary")
	local title = label({ text = Config.productName, bold = true, size = 16, parent = header, autoSize = Enum.AutomaticSize.None, sizeUDim = UDim2.new(1, -44, 0, 18) })
	title.Position = UDim2.new(0, 44, 0, 0)
	local subtitle = label({ text = "", size = 12, color = "muted", parent = header, autoSize = Enum.AutomaticSize.None, sizeUDim = UDim2.new(1, -44, 0, 16) })
	subtitle.Position = UDim2.new(0, 44, 0, 19)

	-- Notice banner
	local notice = new("Frame", { Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 2, Visible = false, Parent = root }, { corner(8), padding(8) })
	paint(notice, "BackgroundColor3", "raised")
	local noticeText = label({ text = "", size = 13, color = "warning", parent = notice })

	-- Connection card
	local connection = card(root, 3)
	local statusRow = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 30), LayoutOrder = 1, Parent = connection })
	local dot = new("Frame", { Size = UDim2.new(0, 10, 0, 10), Position = UDim2.new(0, 0, 0.5, -5), Parent = statusRow }, { corner(5) })
	local statusText = label({ text = "", bold = true, size = 14, parent = statusRow, autoSize = Enum.AutomaticSize.None, sizeUDim = UDim2.new(1, -124, 1, 0) })
	statusText.Position = UDim2.new(0, 18, 0, 0)
	local toggleButton = button({
		text = "Connect", primary = true, parent = statusRow,
		onClick = function()
			actions.toggleConnection()
		end,
	})
	toggleButton.AnchorPoint = Vector2.new(1, 0)
	toggleButton.Position = UDim2.new(1, 0, 0, 0)
	local detailText = label({ text = "", size = 12, color = "muted", parent = connection, order = 2 })
	local placeText = label({ text = "", size = 12, parent = connection, order = 3, rich = true })
	local bridgeText = label({ text = "", size = 12, color = "muted", parent = connection, order = 4 })

	-- Activity card
	local activityCard = card(root, 4)
	label({ text = "Activity", bold = true, size = 13, parent = activityCard, order = 1 })
	local activityList = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, LayoutOrder = 2, Parent = activityCard }, {
		new("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	local emptyActivity = label({ text = "Nothing yet. Agent requests in this place show up here.", size = 12, color = "muted", parent = activityList, order = 0 })

	-- Safety card
	local safety = card(root, 5)
	label({ text = "Safety", bold = true, size = 13, parent = safety, order = 1 })
	local renders = {}
	table.insert(renders, checkbox({
		text = "Pause the agent (refuse every request)", parent = safety, order = 2,
		get = function() return State.toggles.paused end,
		set = function(v) State.setToggle("paused", v) end,
	}))
	table.insert(renders, checkbox({
		text = "Read-only (refuse changes)", parent = safety, order = 3,
		get = function() return State.toggles.readOnly end,
		set = function(v) State.setToggle("readOnly", v) end,
	}))
	table.insert(renders, checkbox({
		text = "Allow running Luau", parent = safety, order = 4,
		get = function() return State.toggles.allowLuau end,
		set = function(v) State.setToggle("allowLuau", v) end,
	}))
	label({ text = "Enforced here in Studio, whatever the agent asks.", size = 12, color = "muted", parent = safety, order = 5 })

	-- Footer
	local footer = new("Frame", { BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 30), LayoutOrder = 6, Parent = root }, {
		new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	local diagnosticsBox
	button({ text = "Retry now", parent = footer, order = 1, onClick = function() actions.retryNow() end })
	button({
		text = "Diagnostics", parent = footer, order = 2,
		onClick = function()
			diagnosticsBox.Visible = not diagnosticsBox.Visible
			diagnosticsBox.Text = Panel.diagnostics()
		end,
	})
	diagnosticsBox = new("TextBox", {
		Visible = false,
		ClearTextOnFocus = false,
		TextEditable = false,
		MultiLine = true,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Top,
		FontFace = Font.fromEnum(Enum.Font.RobotoMono),
		TextSize = 12,
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		LayoutOrder = 7,
		Parent = root,
	}, { corner(6), padding(8) })
	paint(diagnosticsBox, "BackgroundColor3", "surface")
	paint(diagnosticsBox, "TextColor3", "ink")

	local rows = {}
	local function renderActivity()
		for _, row in rows do
			row:Destroy()
		end
		rows = {}
		emptyActivity.Visible = #State.activity == 0
		for index, entry in State.activity do
			local mark = if entry.state == "running" then "…" elseif entry.state == "ok" then "✓" else "✗"
			local tone = if entry.state == "error" then palette.error elseif entry.state == "ok" then palette.success else palette.primary
			local timing = if entry.durationMs then string.format(" %.1fs", entry.durationMs / 1000) else ""
			local undo = if entry.mutating and entry.state == "ok" then "  · Ctrl+Z undoes" else ""
			local summary = if entry.summary and entry.summary ~= "" then "  " .. entry.summary else ""
			local text = string.format(
				'<font color="#%s">%s</font> %s  <b>%s</b>%s<font color="#%s">%s%s</font>',
				tone:ToHex(), mark, entry.time, entry.tool, summary, palette.muted:ToHex(), timing, undo
			)
			if entry.error then
				text ..= '\n<font color="#' .. palette.error:ToHex() .. '">' .. string.gsub(entry.error, "[<>&]", { ["<"] = "&lt;", [">"] = "&gt;", ["&"] = "&amp;" }) .. "</font>"
			end
			local row = label({ text = text, rich = true, size = 12, parent = activityList, order = index })
			table.insert(rows, row)
		end
	end

	local function render()
		local status, tone, detail = Panel.statusLine()
		statusText.Text = status
		dot.BackgroundColor3 = palette[tone]
		detailText.Text = detail or ""
		detailText.Visible = detail ~= nil and detail ~= ""
		toggleButton.Text = if actions.isActive() then "Disconnect" else "Connect"
		subtitle.Text = string.format("Studio bridge · v%s · protocol %d", Config.build, Config.protocol)
		local peerText = {}
		for _, peer in State.peers do
			table.insert(peerText, string.format('<font color="#%s">●</font> %s', palette.success:ToHex(), peer.role))
		end
		placeText.Text = string.format(
			"Place: <b>%s</b>%s",
			string.gsub(tostring(State.placeName or game.Name), "[<>&]", { ["<"] = "&lt;", [">"] = "&gt;", ["&"] = "&amp;" }),
			if #peerText > 0 then "   " .. table.concat(peerText, "  ") else ""
		)
		local serverVersion = if State.server.build then " · SealCode " .. tostring(State.server.build) else ""
		bridgeText.Text = "Bridge " .. string.gsub(Config.baseUrl, "^http://", "") .. serverVersion
		local noticeMessage = State.notice
		if State.server.pluginUpdated then
			noticeMessage = "SealCode updated this plugin. Restart Studio windows opened earlier to load it."
		end
		notice.Visible = noticeMessage ~= nil
		noticeText.Text = noticeMessage or ""
		for _, renderToggle in renders do
			renderToggle()
		end
		renderActivity()
		if diagnosticsBox.Visible then
			diagnosticsBox.Text = Panel.diagnostics()
		end
	end

	local pending = false
	State.onChanged(function()
		if pending then
			return
		end
		pending = true
		task.defer(function()
			pending = false
			render()
		end)
	end)
	pcall(function()
		settings().Studio.ThemeChanged:Connect(function()
			applyTheme()
			render()
		end)
	end)
	applyTheme()
	render()
	return widget
end

return Panel
