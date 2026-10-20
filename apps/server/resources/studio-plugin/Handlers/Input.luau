--!nocheck
-- Real engine input (UserInputService virtual input), so GUI buttons fire and characters walk.
-- One virtual-input object per plugin VM, so a mouseDown in one call can be released later.

local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Input = {}

local virtual = nil
local lastFrame = os.clock()
pcall(function()
	RunService.RenderStepped:Connect(function()
		lastFrame = os.clock()
	end)
end)

local BUTTONS = {
	Left = Enum.UserInputType.MouseButton1,
	Right = Enum.UserInputType.MouseButton2,
	Middle = Enum.UserInputType.MouseButton3,
}

-- A minimized window stops rendering and input, though scripts keep running.
local function notRendering(): string?
	local gap = os.clock() - lastFrame
	if gap > 1 then
		return string.format(
			"Studio window appears minimized or not rendering (no frame in %.1fs). Virtual input only works while the window is visible: restore the Studio window and retry.",
			gap
		)
	end
	return nil
end

local function device()
	if virtual then
		return virtual, nil
	end
	local ok, result = pcall(function()
		return UserInputService:CreateVirtualInput()
	end)
	if not ok or result == nil then
		return nil, "UserInputService:CreateVirtualInput() is not available in this context: " .. tostring(result)
	end
	virtual = result
	return virtual, nil
end

function Input.mouse(args)
	local action = args.action
	local x, y = tonumber(args.x), tonumber(args.y)
	if type(action) ~= "string" or action == "" then
		return { error = "action is required" }
	end
	if x == nil or y == nil then
		return { error = "x and y are required" }
	end
	if action ~= "click" and action ~= "mouseDown" and action ~= "mouseUp" and action ~= "move" then
		return { error = 'action must be "click", "mouseDown", "mouseUp" or "move"' }
	end
	local button = BUTTONS[args.button or "Left"]
	if button == nil then
		return { error = 'button must be "Left", "Right" or "Middle"' }
	end
	local stalled = notRendering()
	if stalled then
		return { error = stalled }
	end
	local input, problem = device()
	if input == nil then
		return { error = problem }
	end
	local position = Vector2.new(x, y)
	local ok, err = pcall(function()
		input:SendMousePosition(position)
		if action == "click" then
			input:SendMouseButton(position, button, true)
			task.wait(0.05)
			input:SendMouseButton(position, button, false)
			-- Lets the click dispatch before the caller's next action.
			task.wait(0.1)
		elseif action == "mouseDown" then
			input:SendMouseButton(position, button, true)
		elseif action == "mouseUp" then
			input:SendMouseButton(position, button, false)
		end
	end)
	if not ok then
		return { error = "Mouse input failed: " .. tostring(err) }
	end
	return { success = true, action = action, x = x, y = y, button = args.button or "Left" }
end

function Input.keyboard(args)
	local stalled = notRendering()
	if stalled then
		return { error = stalled }
	end
	local input, problem = device()
	if input == nil then
		return { error = problem }
	end
	if type(args.text) == "string" then
		if args.text == "" then
			return { error = "text must not be empty" }
		end
		local ok, err = pcall(function()
			input:SendTextInput(args.text)
		end)
		if not ok then
			return { error = "Failed to send text input: " .. tostring(err) }
		end
		return { success = true, text = args.text, note = "Text goes to the focused TextBox; focus one first." }
	end
	local name = type(args.keyCode) == "string" and (string.match(args.keyCode, "([%w_]+)$") or args.keyCode) or nil
	if name == nil then
		return { error = "keyCode or text is required" }
	end
	local keyCode = nil
	for _, item in Enum.KeyCode:GetEnumItems() do
		if item.Name == name then
			keyCode = item
			break
		end
	end
	if keyCode == nil then
		return { error = 'Unknown keyCode: ' .. name .. '. Use Enum.KeyCode names like "W", "Space", "E", "LeftShift".' }
	end
	local action = args.action or "tap"
	local duration = math.clamp(tonumber(args.duration) or 0.1, 0, 5)
	local ok, err = pcall(function()
		if action == "press" then
			input:SendKey(true, keyCode)
		elseif action == "release" then
			input:SendKey(false, keyCode)
		elseif action == "tap" then
			input:SendKey(true, keyCode)
			task.wait(duration)
			input:SendKey(false, keyCode)
		else
			error("Unknown action: " .. tostring(action), 0)
		end
	end)
	if not ok then
		return { error = "Failed to simulate keyboard input: " .. tostring(err) }
	end
	return { success = true, keyCode = keyCode.Name, action = action }
end

Input.notRendering = notRendering

return Input
