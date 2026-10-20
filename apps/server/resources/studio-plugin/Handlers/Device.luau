--!nocheck
-- Studio's device simulator: read and change the simulated device for this DataModel's view.

local Device = {}

local function service()
	local ok, result = pcall(function()
		return game:GetService("StudioDeviceSimulatorService")
	end)
	return if ok then result else nil
end

local function enumItem(enumType, value)
	if type(value) ~= "string" or value == "" then
		return nil, "expected an enum name"
	end
	local name = string.match(value, "([%w_]+)$") or value
	local names = {}
	for _, item in enumType:GetEnumItems() do
		if item.Name == name then
			return item, nil
		end
		table.insert(names, item.Name)
	end
	return nil, string.format('"%s" is not a %s. Valid: %s', value, tostring(enumType), table.concat(names, ", "))
end

local function state(simulator, includeList: boolean)
	local result = {}
	local ok, active = pcall(function()
		return simulator:GetDeviceAsync()
	end)
	result.activeDeviceId = if ok then active else "default"
	result.isSimulating = ok and active ~= nil and active ~= "default"
	if result.isSimulating then
		local unavailable = {}
		local function read(key, getter)
			local readOk, value = pcall(getter)
			if readOk then
				result[key] = value
			else
				unavailable[key] = tostring(value)
			end
		end
		read("resolution", function()
			local res = simulator:GetResolutionAsync()
			if typeof(res) == "Vector2" then
				return { width = res.X, height = res.Y }
			end
			return res
		end)
		read("pixelDensity", function()
			return simulator:GetPixelDensityAsync()
		end)
		read("orientation", function()
			return simulator:GetOrientationAsync().Name
		end)
		read("scalingMode", function()
			return simulator:GetScalingModeAsync().Name
		end)
		if next(unavailable) then
			result.unavailable = unavailable
		end
	end
	if includeList then
		local listOk, list = pcall(function()
			return simulator:GetDeviceListAsync()
		end)
		result.devices = if listOk then list else {}
	end
	return result
end
Device.state = state

function Device.get(args)
	local simulator = service()
	if simulator == nil then
		return { error = "This Studio has no device simulator service." }
	end
	local result = state(simulator, args.includeDeviceList ~= false)
	if type(args.deviceId) == "string" and args.deviceId ~= "" then
		local ok, info = pcall(function()
			return simulator:GetDeviceInfoAsync(args.deviceId)
		end)
		if not ok then
			return { error = string.format('deviceId "%s" is not an available device: %s', args.deviceId, tostring(info)) }
		end
		result.deviceInfo = info
	end
	return result
end

-- Device preset first, then orientation, resolution, pixel density and scaling mode.
function Device.set(args)
	local simulator = service()
	if simulator == nil then
		return { error = "This Studio has no device simulator service." }
	end
	local before = state(simulator, false)
	if args.stopSimulation == true then
		local ok, err = pcall(function()
			simulator:StopSimulationAsync()
		end)
		if not ok then
			return { error = "Could not stop the simulator: " .. tostring(err) }
		end
		return { success = true, applied = { stopSimulation = true }, before = before, after = state(simulator, false) }
	end
	local applied = {}
	local steps = {}
	if args.deviceId ~= nil then
		table.insert(steps, function()
			simulator:SetDeviceAsync(args.deviceId)
			applied.deviceId = args.deviceId
		end)
	end
	if args.orientation ~= nil then
		local item, problem = enumItem(Enum.ScreenOrientation, args.orientation)
		if item == nil then
			return { error = "orientation: " .. problem }
		end
		table.insert(steps, function()
			simulator:SetOrientationAsync(item)
			applied.orientation = item.Name
		end)
	end
	if args.resolution ~= nil then
		local res = args.resolution
		local w, h = type(res) == "table" and tonumber(res.width), type(res) == "table" and tonumber(res.height)
		if not w or not h or w <= 0 or h <= 0 or w % 1 ~= 0 or h % 1 ~= 0 then
			return { error = "resolution.width and resolution.height must be positive integers" }
		end
		table.insert(steps, function()
			simulator:SetResolutionAsync(w, h)
			applied.resolution = { width = w, height = h }
		end)
	end
	if args.pixelDensity ~= nil then
		local density = tonumber(args.pixelDensity)
		if not density or density <= 0 then
			return { error = "pixelDensity must be a positive number" }
		end
		table.insert(steps, function()
			simulator:SetPixelDensityAsync(density)
			applied.pixelDensity = density
		end)
	end
	if args.scalingMode ~= nil then
		local item, problem = enumItem(Enum.DeviceSimulatorScalingMode, args.scalingMode)
		if item == nil then
			return { error = "scalingMode: " .. problem }
		end
		table.insert(steps, function()
			simulator:SetScalingModeAsync(item)
			applied.scalingMode = item.Name
		end)
	end
	if #steps == 0 then
		return { error = "Pass stopSimulation=true or at least one simulator setting." }
	end
	for _, step in steps do
		local ok, err = pcall(step)
		if not ok then
			return { error = "The simulator refused a setting: " .. tostring(err), applied = applied, before = before }
		end
	end
	return { success = true, applied = applied, before = before, after = state(simulator, false) }
end

return Device
