--!nocheck
-- Inserts Creator Store assets. Untrusted content arrives disarmed: scripts are kept but
-- disabled, so the agent can read them and enable only what it has reviewed; package links
-- are removed so the copy is the place's own.

local Selection = game:GetService("Selection")

local Util = require(script.Parent.Parent.Util)

local Assets = {}

local function vector(value): Vector3?
	if type(value) == "table" then
		local x, y, z = tonumber(value.x or value[1]), tonumber(value.y or value[2]), tonumber(value.z or value[3])
		if x and y and z then
			return Vector3.new(x, y, z)
		end
	end
	return nil
end

function Assets.insert(args)
	local id = tonumber(args.assetId)
	if id == nil or id <= 0 then
		return { error = "assetId must be a positive number." }
	end
	local parent = workspace
	if type(args.parentPath) == "string" and args.parentPath ~= "" then
		parent = Util.resolvePath(args.parentPath)
		if parent == nil then
			return { error = "parentPath not found: " .. args.parentPath }
		end
	end

	local ok, objects = pcall(function()
		return game:GetObjects("rbxassetid://" .. tostring(id))
	end)
	if not ok or type(objects) ~= "table" or #objects == 0 then
		return {
			error = "Roblox would not load asset " .. tostring(id) .. ": " .. tostring(if ok then "it has no objects" else objects)
				.. ". Paid or private assets cannot be inserted; pick a free one.",
		}
	end

	local recording = Util.beginRecording("Harp: insert asset " .. tostring(id))
	local root
	if #objects == 1 then
		root = objects[1]
	else
		root = Instance.new("Model")
		root.Name = "Asset_" .. tostring(id)
		for _, object in objects do
			object.Parent = root
		end
	end
	if type(args.name) == "string" and args.name ~= "" then
		root.Name = args.name
	end

	local counts = { scriptsDisabled = 0, packageLinksRemoved = 0, parts = 0, particleEmitters = 0, beams = 0, trails = 0, sounds = 0, decalsAndTextures = 0, lights = 0 }
	local scripts = {}
	local function visit(instance: Instance)
		if instance:IsA("PackageLink") then
			counts.packageLinksRemoved += 1
			instance:Destroy()
			return
		end
		if instance:IsA("BaseScript") then
			instance.Enabled = false
			counts.scriptsDisabled += 1
		end
		if instance:IsA("LuaSourceContainer") then
			table.insert(scripts, instance)
		elseif instance:IsA("BasePart") then
			counts.parts += 1
		elseif instance:IsA("ParticleEmitter") then
			counts.particleEmitters += 1
		elseif instance:IsA("Beam") then
			counts.beams += 1
		elseif instance:IsA("Trail") then
			counts.trails += 1
		elseif instance:IsA("Sound") then
			counts.sounds += 1
		elseif instance:IsA("Decal") then
			counts.decalsAndTextures += 1
		elseif instance:IsA("Light") then
			counts.lights += 1
		end
	end
	visit(root)
	for _, descendant in root:GetDescendants() do
		if descendant.Parent ~= nil then
			visit(descendant)
		end
	end

	root.Parent = parent
	local position = vector(args.position)
	if position == nil then
		local camera = workspace.CurrentCamera
		position = if camera then camera.Focus.Position else Vector3.zero
	end
	pcall(function()
		if root:IsA("PVInstance") then
			root:PivotTo(CFrame.new(position))
		end
	end)
	Util.finishRecording(recording, true)
	if args.select ~= false then
		Selection:Set({ root })
	end

	local size = nil
	pcall(function()
		if root:IsA("Model") then
			local _, extents = root:GetBoundingBox()
			size = { x = math.floor(extents.X * 10) / 10, y = math.floor(extents.Y * 10) / 10, z = math.floor(extents.Z * 10) / 10 }
		elseif root:IsA("BasePart") then
			size = { x = root.Size.X, y = root.Size.Y, z = root.Size.Z }
		end
	end)
	local scriptPaths = {}
	for i, scriptInstance in scripts do
		if i > 20 then
			break
		end
		table.insert(scriptPaths, { path = Util.pathOf(scriptInstance), className = scriptInstance.ClassName })
	end
	local children = {}
	for i, child in root:GetChildren() do
		if i > 25 then
			break
		end
		table.insert(children, child.Name .. " (" .. child.ClassName .. ")")
	end
	return {
		success = true,
		path = Util.pathOf(root),
		className = root.ClassName,
		boundsSize = size,
		counts = counts,
		scripts = scriptPaths,
		children = children,
		note = if counts.scriptsDisabled > 0
			then "Scripts arrived disabled. Read them with get_script_source and enable only the ones you reviewed (set_properties Enabled=true)."
			else nil,
	}
end

return Assets
