--!nocheck
-- The viewport camera, so an agent can look at what it built from the right angle before a
-- screenshot: read it, place it, or frame instances from a named angle.

local RunService = game:GetService("RunService")
local Selection = game:GetService("Selection")

local Util = require(script.Parent.Parent.Util)

local Camera = {}

local ANGLES = {
	-- Direction from the target to the camera, before normalising.
	front = Vector3.new(0, 0.35, -1),
	back = Vector3.new(0, 0.35, 1),
	left = Vector3.new(-1, 0.35, 0),
	right = Vector3.new(1, 0.35, 0),
	top = Vector3.new(0, 1, -0.001),
	iso = Vector3.new(1, 0.8, -1),
	low = Vector3.new(0.6, 0.12, -1),
}

local function vector(value): Vector3?
	if type(value) == "table" then
		local x, y, z = tonumber(value.x or value[1]), tonumber(value.y or value[2]), tonumber(value.z or value[3])
		if x and y and z then
			return Vector3.new(x, y, z)
		end
	end
	return nil
end

local function round(n: number): number
	return math.floor(n * 100 + 0.5) / 100
end

local function describe(camera: Camera)
	local cf = camera.CFrame
	local look = cf.LookVector
	return {
		success = true,
		position = { x = round(cf.Position.X), y = round(cf.Position.Y), z = round(cf.Position.Z) },
		lookVector = { x = round(look.X), y = round(look.Y), z = round(look.Z) },
		focus = { x = round(camera.Focus.Position.X), y = round(camera.Focus.Position.Y), z = round(camera.Focus.Position.Z) },
		fieldOfView = round(camera.FieldOfView),
		cameraType = camera.CameraType.Name,
		viewport = { width = math.floor(camera.ViewportSize.X), height = math.floor(camera.ViewportSize.Y) },
	}
end

-- One box around everything asked for: models by their bounding box, parts by their own.
local function bounds(instances): (CFrame?, Vector3?)
	local minV, maxV = nil, nil
	local function add(cf: CFrame, size: Vector3)
		local half = size / 2
		for _, sx in { -1, 1 } do
			for _, sy in { -1, 1 } do
				for _, sz in { -1, 1 } do
					local corner = cf * Vector3.new(half.X * sx, half.Y * sy, half.Z * sz)
					minV = if minV then minV:Min(corner) else corner
					maxV = if maxV then maxV:Max(corner) else corner
				end
			end
		end
	end
	for _, instance in instances do
		if instance:IsA("Model") then
			local ok, cf, size = pcall(function()
				return instance:GetBoundingBox()
			end)
			if ok then
				add(cf, size)
			end
		elseif instance:IsA("BasePart") then
			add(instance.CFrame, instance.Size)
		elseif instance:IsA("Attachment") then
			add(CFrame.new(instance.WorldPosition), Vector3.one * 4)
		else
			for _, descendant in instance:GetDescendants() do
				if descendant:IsA("BasePart") then
					add(descendant.CFrame, descendant.Size)
				end
			end
		end
	end
	if minV == nil then
		return nil, nil
	end
	return CFrame.new((minV + maxV) / 2), maxV - minV
end

function Camera.run(args)
	local camera = workspace.CurrentCamera
	if camera == nil then
		return { error = "This DataModel has no camera." }
	end
	local action = tostring(args.action or "get")
	if action == "get" then
		return describe(camera)
	end

	if action == "set" then
		local position = vector(args.position)
		local lookAt = vector(args.lookAt)
		if position == nil and lookAt == nil and args.fieldOfView == nil then
			return { error = "set needs position, lookAt and/or fieldOfView." }
		end
		-- Studio's edit camera takes a CFrame as is; a playtest camera must stop following the character.
		if RunService:IsRunning() then
			camera.CameraType = Enum.CameraType.Scriptable
		end
		local from = position or camera.CFrame.Position
		if lookAt then
			camera.CFrame = CFrame.lookAt(from, lookAt)
			camera.Focus = CFrame.new(lookAt)
		else
			camera.CFrame = CFrame.new(from) * camera.CFrame.Rotation
		end
		if tonumber(args.fieldOfView) then
			camera.FieldOfView = math.clamp(tonumber(args.fieldOfView), 1, 120)
		end
		return describe(camera)
	end

	if action == "frame" then
		local targets = {}
		local missing = {}
		if args.paths == nil or args.paths == "selection" then
			targets = Selection:Get()
		else
			for _, path in (if type(args.paths) == "table" then args.paths else { args.paths }) do
				local instance = Util.resolvePath(tostring(path))
				if instance then
					table.insert(targets, instance)
				else
					table.insert(missing, tostring(path))
				end
			end
		end
		if #missing > 0 then
			return { error = "Not found: " .. table.concat(missing, ", ") }
		end
		if #targets == 0 then
			return { error = "Nothing to frame: pass paths, or select something in Studio." }
		end
		local center, size = bounds(targets)
		if center == nil then
			return { error = "The targets have no parts to frame." }
		end
		local angle = tostring(args.angle or "iso")
		local direction = ANGLES[angle]
		if angle == "current" then
			direction = -camera.CFrame.LookVector
		elseif direction == nil then
			local yaw = math.rad(tonumber(args.yaw) or 45)
			local pitch = math.rad(tonumber(args.pitch) or 25)
			direction = Vector3.new(math.sin(yaw) * math.cos(pitch), math.sin(pitch), -math.cos(yaw) * math.cos(pitch))
		end
		direction = direction.Unit
		if tonumber(args.fieldOfView) then
			camera.FieldOfView = math.clamp(tonumber(args.fieldOfView), 1, 120)
		end
		-- Fit the bounding sphere in the narrower field of view, with a little margin.
		local radius = size.Magnitude / 2
		local aspect = camera.ViewportSize.X / math.max(camera.ViewportSize.Y, 1)
		local vertical = math.rad(camera.FieldOfView) / 2
		local horizontal = math.atan(math.tan(vertical) * aspect)
		local fit = radius / math.sin(math.min(vertical, horizontal))
		local distance = fit * math.clamp(tonumber(args.padding) or 1, 0.5, 4)
		-- Studio's edit camera takes a CFrame as is; a playtest camera must stop following the character.
		if RunService:IsRunning() then
			camera.CameraType = Enum.CameraType.Scriptable
		end
		camera.CFrame = CFrame.lookAt(center.Position + direction * distance, center.Position)
		camera.Focus = center
		local result = describe(camera)
		result.framed = #targets
		result.boundsSize = { x = round(size.X), y = round(size.Y), z = round(size.Z) }
		result.angle = angle
		return result
	end

	return { error = "Unknown camera action: " .. action .. " (use get, set or frame)." }
end

return Camera
