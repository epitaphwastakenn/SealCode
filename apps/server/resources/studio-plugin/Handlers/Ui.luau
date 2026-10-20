--!nocheck
-- Live UI in a playtest client: raw facts for inspect_ui (SealCode computes visibility, clipping
-- and the audit from them), and interact_ui, which resolves one element, proves it can take
-- input with the engine's own hit test, and then acts with real input.

local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local Util = require(script.Parent.Parent.Util)
local Input = require(script.Parent.Input)

local Ui = {}

local MAX_TEXT = 2000

local function failure(code: string, message: string)
	return { success = false, errorCode = code, error = code, message = message }
end

local function playerGui()
	local player = Players.LocalPlayer
	return player and player:FindFirstChildOfClass("PlayerGui")
end

local function relevant(instance: Instance): boolean
	return instance:IsA("ScreenGui") or instance:IsA("GuiObject")
end

local function role(instance: Instance): string
	if instance:IsA("TextButton") or instance:IsA("ImageButton") then
		return "button"
	elseif instance:IsA("TextBox") then
		return "input"
	elseif instance:IsA("TextLabel") then
		return "text"
	elseif instance:IsA("ScrollingFrame") then
		return "scroll_container"
	elseif instance:IsA("ImageLabel") then
		return "image"
	elseif instance:IsA("ViewportFrame") or instance:IsA("ScreenGui") then
		return "viewport"
	end
	return "container"
end

local function capText(text)
	if type(text) ~= "string" then
		return nil
	end
	if #text <= MAX_TEXT then
		return text
	end
	-- Cut on a character boundary so the text stays valid UTF-8.
	local cut = utf8.offset(text, MAX_TEXT) or MAX_TEXT
	return string.sub(text, 1, cut - 1) .. "…"
end

local function read(instance, name)
	local ok, value = pcall(function()
		return instance[name]
	end)
	return if ok then value else nil
end

local function vec(v)
	if typeof(v) == "Vector2" then
		return { v.X, v.Y }
	end
	return nil
end

local function viewport()
	local camera = workspace.CurrentCamera
	local size = camera and camera.ViewportSize or Vector2.zero
	local topLeft, bottomRight = GuiService:GetGuiInset()
	return {
		width = size.X,
		height = size.Y,
		insetTopLeft = { topLeft.X, topLeft.Y },
		insetBottomRight = { bottomRight.X, bottomRight.Y },
	}
end

local function facts(instance: Instance, depth: number, options, parentRef, semanticParentRef)
	local entry = {
		ref = Util.refOf(instance),
		path = Util.pathOf(instance),
		name = instance.Name,
		className = instance.ClassName,
		role = role(instance),
		depth = depth,
		parentRef = parentRef,
		semanticParentRef = semanticParentRef,
	}
	if instance:IsA("ScreenGui") then
		entry.enabled = read(instance, "Enabled")
		entry.ignoreGuiInset = read(instance, "IgnoreGuiInset")
		entry.displayOrder = read(instance, "DisplayOrder")
		local behavior = read(instance, "ZIndexBehavior")
		entry.zIndexBehavior = behavior and behavior.Name
		local insets = read(instance, "ScreenInsets")
		entry.screenInsets = insets and insets.Name
	end
	if instance:IsA("GuiObject") then
		entry.visible = read(instance, "Visible")
		entry.absolutePosition = vec(read(instance, "AbsolutePosition"))
		entry.absoluteSize = vec(read(instance, "AbsoluteSize"))
		entry.absoluteRotation = read(instance, "AbsoluteRotation")
		entry.active = read(instance, "Active")
		local interactable = read(instance, "Interactable")
		if type(interactable) == "boolean" then
			entry.engineInteractable = interactable
		end
		entry.zIndex = read(instance, "ZIndex")
		entry.backgroundTransparency = read(instance, "BackgroundTransparency")
		entry.layoutOrder = read(instance, "LayoutOrder")
		entry.clipsDescendants = read(instance, "ClipsDescendants")
	end
	if instance:IsA("TextLabel") or instance:IsA("TextButton") or instance:IsA("TextBox") then
		if options.includeText then
			entry.text = capText(read(instance, "Text"))
			entry.contentText = capText(read(instance, "ContentText"))
		end
		entry.textSize = read(instance, "TextSize")
		entry.textBounds = vec(read(instance, "TextBounds"))
		entry.textFits = read(instance, "TextFits")
		entry.textWrapped = read(instance, "TextWrapped")
		entry.textScaled = read(instance, "TextScaled")
		entry.textTransparency = read(instance, "TextTransparency")
		local xa, ya = read(instance, "TextXAlignment"), read(instance, "TextYAlignment")
		entry.textXAlignment = xa and xa.Name
		entry.textYAlignment = ya and ya.Name
		if options.includeStyles then
			local color = read(instance, "TextColor3")
			entry.textColor = color and { color.R, color.G, color.B }
			local face = read(instance, "FontFace")
			entry.font = face and { family = face.Family, weight = face.Weight.Name, style = face.Style.Name }
		end
	end
	if instance:IsA("ImageLabel") or instance:IsA("ImageButton") then
		entry.image = read(instance, "Image")
		entry.imageTransparency = read(instance, "ImageTransparency")
	end
	if instance:IsA("ScrollingFrame") then
		entry.canvasPosition = vec(read(instance, "CanvasPosition"))
		entry.absoluteCanvasSize = vec(read(instance, "AbsoluteCanvasSize"))
		entry.absoluteWindowSize = vec(read(instance, "AbsoluteWindowSize"))
	end
	return entry
end

local function sortedChildren(instance: Instance)
	local children = instance:GetChildren()
	table.sort(children, function(a, b)
		if a.Name ~= b.Name then
			return a.Name < b.Name
		end
		return a.ClassName < b.ClassName
	end)
	return children
end

-- Up to five probe points; the target must be the topmost blocking object at one of them.
local function hitTest(gui: PlayerGui, target: GuiObject, bounds)
	local x0, y0, x1, y1 = bounds[1], bounds[2], bounds[3], bounds[4]
	local cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
	local points = {
		{ cx, cy },
		{ (x0 + cx) / 2, (y0 + cy) / 2 },
		{ (cx + x1) / 2, (y0 + cy) / 2 },
		{ (x0 + cx) / 2, (cy + y1) / 2 },
		{ (cx + x1) / 2, (cy + y1) / 2 },
	}
	local anyOk = false
	for _, point in points do
		local ok, hits = pcall(function()
			return gui:GetGuiObjectsAtPosition(point[1], point[2])
		end)
		if ok then
			anyOk = true
			for _, hit in hits do
				if hit == target then
					return point, nil
				end
				if target:IsDescendantOf(hit) then
					continue
				end
				local blocks = hit:IsA("GuiButton") or hit:IsA("TextBox") or read(hit, "Active") == true
				if read(hit, "Interactable") == false then
					blocks = false
				end
				if blocks then
					break
				end
			end
		end
	end
	if not anyOk then
		return { cx, cy }, nil
	end
	return nil, "occluded"
end

-- Whether a GUI object can take input now, and where; mirrors what a player could do.
local function targetState(gui: PlayerGui, target: Instance)
	if not target:IsA("GuiObject") then
		return { actionable = false, reason = "not_gui_object" }
	end
	if not target:IsDescendantOf(gui) then
		return { actionable = false, reason = "detached_from_player_gui" }
	end
	local pos, size = target.AbsolutePosition, target.AbsoluteSize
	if pos.X ~= pos.X or size.X ~= size.X then
		return { actionable = false, reason = "invalid_geometry" }
	end
	if size.X <= 0 or size.Y <= 0 then
		return { actionable = false, reason = "zero_size" }
	end
	local camera = workspace.CurrentCamera
	if camera == nil or camera.ViewportSize.X <= 0 then
		return { actionable = false, reason = "invalid_viewport" }
	end
	local inset = GuiService:GetGuiInset()
	local x0, y0 = -inset.X, -inset.Y
	local x1, y1 = camera.ViewportSize.X - inset.X, camera.ViewportSize.Y - inset.Y
	local bx0, by0, bx1, by1 = pos.X, pos.Y, pos.X + size.X, pos.Y + size.Y
	local node: Instance? = target
	while node and node ~= gui do
		if node:IsA("GuiObject") and not node.Visible then
			return { actionable = false, reason = "hidden" }
		end
		if node:IsA("ScreenGui") and not node.Enabled then
			return { actionable = false, reason = "hidden" }
		end
		if node ~= target and node:IsA("GuiObject") then
			local clips = node.ClipsDescendants or node:IsA("ScrollingFrame")
			if clips then
				local np = node.AbsolutePosition
				local ns = if node:IsA("ScrollingFrame") then node.AbsoluteWindowSize else node.AbsoluteSize
				x0, y0 = math.max(x0, np.X), math.max(y0, np.Y)
				x1, y1 = math.min(x1, np.X + ns.X), math.min(y1, np.Y + ns.Y)
			end
		end
		node = node.Parent
	end
	local vx0, vy0, vx1, vy1 = math.max(x0, bx0), math.max(y0, by0), math.min(x1, bx1), math.min(y1, by1)
	if vx1 <= vx0 or vy1 <= vy0 then
		return { actionable = false, reason = "fully_clipped" }
	end
	if read(target, "Interactable") == false then
		return { actionable = false, reason = "engine_not_interactable" }
	end
	if read(target, "Active") == false and (target:IsA("GuiButton") or target:IsA("TextBox")) == false then
		return { actionable = false, reason = "inactive" }
	end
	local point, reason = hitTest(gui, target, { vx0, vy0, vx1, vy1 })
	if point == nil then
		return { actionable = false, reason = reason, visibleBounds = { vx0, vy0, vx1, vy1 } }
	end
	return { actionable = true, point = point, bounds = { bx0, by0, bx1, by1 }, visibleBounds = { vx0, vy0, vx1, vy1 } }
end

local function compact(gui, instance)
	local state = targetState(gui, instance)
	return {
		ref = Util.refOf(instance),
		path = Util.pathOf(instance),
		name = instance.Name,
		className = instance.ClassName,
		role = role(instance),
		bounds = state.bounds,
		visibleBounds = state.visibleBounds,
		actionable = state.actionable,
		reason = state.reason,
	}
end

function Ui.inspect(args)
	local gui = playerGui()
	if gui == nil or not RunService:IsRunning() then
		return failure("runtime_client_required", "UI inspection requires a running playtest client with a local player's PlayerGui.")
	end
	local root = gui
	if type(args.root) == "table" and (args.root.ref or args.root.path) then
		local found, problem = Util.resolve({ instanceRef = args.root.ref, path = args.root.path })
		if found == nil then
			return failure(
				"ui_root_not_found",
				tostring(problem) .. ". Live UI is a copy under the local player's PlayerGui, not the StarterGui original. Omit root to inspect the whole PlayerGui."
			)
		end
		if found ~= gui and not found:IsDescendantOf(gui) then
			return failure("invalid_ui_root", "UI roots must be the local player's PlayerGui or one of its descendants.")
		end
		root = found
	end
	local options = {
		maxDepth = math.clamp(math.floor(tonumber(args.max_depth) or 8), 0, 32),
		maxNodes = math.clamp(math.floor(tonumber(args.max_nodes) or 250), 1, 1000),
		includeText = args.include_text ~= false,
		includeStyles = args.include_styles == true,
	}
	local elements = {}
	local context = {}
	-- Ancestors between the root and PlayerGui shape visibility and clipping but are not returned.
	local chain = {}
	local node = root.Parent
	while node and node ~= gui and node ~= game do
		table.insert(chain, 1, node)
		node = node.Parent
	end
	local lastEmitted = nil
	for i, ancestor in chain do
		if relevant(ancestor) then
			local entry = facts(ancestor, i - #chain - 1, options, ancestor.Parent and Util.refOf(ancestor.Parent), lastEmitted)
			table.insert(context, entry)
			lastEmitted = entry.ref
		end
	end
	local visited, returned = 0, 0
	local truncated, reason = false, nil
	local function walk(instance, depth, semanticParent)
		visited += 1
		local emittedRef = semanticParent
		if instance ~= gui and relevant(instance) then
			if returned >= options.maxNodes then
				truncated, reason = true, "max_nodes"
				return false
			end
			local entry = facts(instance, depth, options, instance.Parent and Util.refOf(instance.Parent), semanticParent)
			table.insert(elements, entry)
			returned += 1
			emittedRef = entry.ref
		end
		local children = sortedChildren(instance)
		if depth >= options.maxDepth then
			if #children > 0 then
				truncated, reason = true, "max_depth"
			end
			return true
		end
		for _, child in children do
			if walk(child, depth + 1, emittedRef) == false then
				return false
			end
		end
		return true
	end
	walk(root, 0, lastEmitted)
	return {
		success = true,
		source = "runtime_player_gui",
		root = { ref = Util.refOf(root), path = Util.pathOf(root), name = root.Name, className = root.ClassName },
		viewport = viewport(),
		elements = elements,
		context = context,
		limits = { maxDepth = options.maxDepth, maxNodes = options.maxNodes },
		truncation = { truncated = truncated, reason = reason, returned = returned, visited = visited },
	}
end

local function matches(gui, instance, selector)
	if selector.name ~= nil and instance.Name ~= selector.name then
		return false
	end
	if selector.class ~= nil and instance.ClassName ~= selector.class then
		return false
	end
	if selector.role ~= nil and role(instance) ~= selector.role then
		return false
	end
	if selector.text ~= nil then
		local isText = instance:IsA("TextLabel") or instance:IsA("TextButton") or instance:IsA("TextBox")
		if not isText or (instance.Text ~= selector.text and read(instance, "ContentText") ~= selector.text) then
			return false
		end
	end
	if selector.ancestor ~= nil then
		local found = false
		local node = instance.Parent
		while node and node ~= gui and not found do
			if type(selector.ancestor) == "string" then
				local a = selector.ancestor
				found = node.Name == a or node.ClassName == a or role(node) == a or read(node, "Text") == a
					or Util.refOf(node) == a or Util.pathOf(node) == a
			elseif type(selector.ancestor) == "table" then
				found = matches(gui, node, selector.ancestor) and (selector.ancestor.ref == nil or Util.refOf(node) == selector.ancestor.ref)
					and (selector.ancestor.path == nil or Util.pathOf(node) == selector.ancestor.path)
			end
			node = node.Parent
		end
		if not found then
			return false
		end
	end
	if selector.visible_only == true and not targetState(gui, instance).visibleBounds then
		return false
	end
	return true
end

local function resolveTarget(gui, selector)
	local candidates = {}
	if selector.ref or selector.path then
		local found = Util.resolve({ instanceRef = selector.ref, path = selector.path })
		if found and (selector.path == nil or Util.pathOf(found) == selector.path) and found:IsDescendantOf(gui) then
			if matches(gui, found, selector) then
				table.insert(candidates, found)
			end
		end
	else
		for _, instance in gui:GetDescendants() do
			if relevant(instance) and matches(gui, instance, selector) then
				table.insert(candidates, instance)
			end
		end
	end
	table.sort(candidates, function(a, b)
		return (Util.pathOf(a) or "") < (Util.pathOf(b) or "")
	end)
	if #candidates == 0 then
		return nil, failure("ui_target_not_found", "No PlayerGui element matched the selector.")
	end
	if #candidates > 1 then
		local sample = {}
		for i = 1, math.min(10, #candidates) do
			table.insert(sample, compact(gui, candidates[i]))
		end
		local result = failure("ambiguous_ui_selector", "The UI selector matched multiple elements; refine it with an exact ref or path.")
		result.candidate_count = #candidates
		result.candidates = sample
		return nil, result
	end
	return candidates[1], nil
end

local function notActionable(reason, resolved)
	local result = failure("ui_target_not_actionable", "The selected UI target cannot perform this action: " .. reason .. ".")
	result.reason = reason
	result.resolved_target = resolved
	return result
end

local function waitFrame()
	local done = false
	local connection = RunService.RenderStepped:Connect(function()
		done = true
	end)
	local deadline = os.clock() + 1
	while not done and os.clock() < deadline do
		task.wait()
	end
	connection:Disconnect()
end

local function setCanvas(frame: ScrollingFrame, x, y)
	local maxX = math.max(0, frame.AbsoluteCanvasSize.X - frame.AbsoluteWindowSize.X)
	local maxY = math.max(0, frame.AbsoluteCanvasSize.Y - frame.AbsoluteWindowSize.Y)
	local target = Vector2.new(math.clamp(x, 0, maxX), math.clamp(y, 0, maxY))
	frame.CanvasPosition = target
	waitFrame()
	local now = frame.CanvasPosition
	if math.abs(now.X - target.X) > 1 or math.abs(now.Y - target.Y) > 1 then
		return nil, "scroll_position_verification_failed"
	end
	return { now.X, now.Y }, { maxX, maxY }
end

function Ui.interact(args)
	local gui = playerGui()
	if gui == nil or not RunService:IsRunning() then
		return failure("runtime_client_required", "UI interaction requires a running playtest client with a local player's PlayerGui.")
	end
	local action = args.action
	local selector = args.selector
	if type(selector) ~= "table" or next(selector) == nil then
		return failure("invalid_ui_request", "selector must contain at least one field.")
	end
	local target, problem = resolveTarget(gui, selector)
	if target == nil then
		return problem
	end
	local resolved = compact(gui, target)
	if action == "set_scroll" then
		if not target:IsA("ScrollingFrame") then
			return notActionable("set_scroll_requires_scrolling_frame", resolved)
		end
		local position = args.canvas_position or args.canvasPosition
		if type(position) ~= "table" or type(position.x) ~= "number" or type(position.y) ~= "number" then
			return failure("invalid_ui_request", "set_scroll requires canvas_position with numeric x and y.")
		end
		local now, max = setCanvas(target, position.x, position.y)
		if now == nil then
			return notActionable(max, resolved)
		end
		return { success = true, action = action, interaction_mode = "test_helper", resolved_target = resolved, canvas_position = now, max_canvas_position = max }
	end
	if action == "scroll_into_view" then
		local frame = target.Parent
		while frame and frame ~= gui and not frame:IsA("ScrollingFrame") do
			frame = frame.Parent
		end
		if frame == nil or not frame:IsA("ScrollingFrame") then
			return notActionable("scrolling_ancestor_not_found", resolved)
		end
		waitFrame()
		local window0 = frame.AbsolutePosition
		local window1 = window0 + frame.AbsoluteWindowSize
		local p0, p1 = target.AbsolutePosition, target.AbsolutePosition + target.AbsoluteSize
		local shiftX, shiftY = 0, 0
		if p0.X < window0.X then
			shiftX = p0.X - window0.X
		elseif p1.X > window1.X then
			shiftX = math.min(p1.X - window1.X, p0.X - window0.X)
		end
		if p0.Y < window0.Y then
			shiftY = p0.Y - window0.Y
		elseif p1.Y > window1.Y then
			shiftY = math.min(p1.Y - window1.Y, p0.Y - window0.Y)
		end
		local now, max = setCanvas(frame, frame.CanvasPosition.X + shiftX, frame.CanvasPosition.Y + shiftY)
		if now == nil then
			return notActionable(max, resolved)
		end
		if targetState(gui, target).visibleBounds == nil then
			return notActionable("scroll_into_view_verification_failed", resolved)
		end
		return { success = true, action = action, interaction_mode = "test_helper", resolved_target = compact(gui, target), canvas_position = now, max_canvas_position = max, scrolling_frame = Util.pathOf(frame), revealed = true }
	end
	if action ~= "click" and action ~= "focus" and action ~= "type" then
		return failure("invalid_ui_request", "action must be one of: click, focus, type, scroll_into_view, set_scroll")
	end
	if action == "click" and not (target:IsA("GuiButton") or target:IsA("TextBox")) then
		return notActionable("click_requires_button_or_text_box", resolved)
	end
	if (action == "focus" or action == "type") and not target:IsA("TextBox") then
		return notActionable("focus_and_type_require_text_box", resolved)
	end
	if action == "type" and type(args.text) ~= "string" then
		return failure("invalid_ui_request", "type requires a string text value.")
	end
	local state = targetState(gui, target)
	if not state.actionable then
		return notActionable(state.reason, resolved)
	end
	local inset = GuiService:GetGuiInset()
	local windowPoint = { state.point[1] + inset.X, state.point[2] + inset.Y }
	local clicked = Input.mouse({ action = "click", x = windowPoint[1], y = windowPoint[2] })
	if clicked.error then
		return failure("ui_input_failed", "Mouse input failed: " .. clicked.error)
	end
	if action == "type" then
		task.wait(0.05)
		local typed = Input.keyboard({ text = args.text })
		if typed.error then
			return failure("ui_input_failed", "Keyboard input failed: " .. typed.error)
		end
	end
	local result = {
		success = true,
		action = action,
		interaction_mode = "real_input",
		resolved_target = resolved,
		semantic_point = state.point,
		input_point = windowPoint,
	}
	if action == "type" and target:IsA("TextBox") then
		task.wait(0.05)
		result.text_after = capText(target.Text)
	end
	return result
end

return Ui
