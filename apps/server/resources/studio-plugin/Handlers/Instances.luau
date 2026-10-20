--!nocheck
-- Reading and changing instances: typed properties, atomic writes, creation and removal.

local CollectionService = game:GetService("CollectionService")

local Util = require(script.Parent.Parent.Util)

local Instances = {}

-- Used when Studio has no ReflectionService to list a class's properties.
local COMMON_PROPERTIES = {
	"Name", "ClassName", "Parent", "Archivable",
	"Anchored", "CanCollide", "CanQuery", "CanTouch", "CastShadow", "CFrame", "Color", "Locked",
	"Mass", "Massless", "Material", "MaterialVariant", "Orientation", "PivotOffset", "Position",
	"Reflectance", "Rotation", "Shape", "Size", "Transparency", "BrickColor",
	"MeshId", "TextureID", "TextureId", "PrimaryPart", "WorldPivot",
	"Active", "AnchorPoint", "AutomaticSize", "BackgroundColor3", "BackgroundTransparency",
	"BorderSizePixel", "ClipsDescendants", "Font", "FontFace", "Image", "ImageColor3",
	"ImageTransparency", "LayoutOrder", "RichText", "ScaleType", "Text", "TextColor3",
	"TextScaled", "TextSize", "TextTransparency", "TextWrapped", "TextXAlignment",
	"TextYAlignment", "Visible", "ZIndex", "Enabled", "DisplayOrder", "IgnoreGuiInset",
	"ResetOnSpawn", "ZIndexBehavior", "Value", "Brightness", "Range", "Shadows", "Face",
	"SoundId", "Volume", "Looped", "Playing", "PlaybackSpeed", "AnimationId", "RunContext",
	"Ambient", "ClockTime", "FogEnd", "FogColor", "OutdoorAmbient", "Technology",
	"Health", "MaxHealth", "WalkSpeed", "JumpPower", "DisplayName",
}

local SKIPPED = { Source = true, ClassName = false }

local function propertyNames(instance: Instance): { string }
	local ok, list = pcall(function()
		return game:GetService("ReflectionService"):GetPropertiesOfClass(instance.ClassName)
	end)
	local names = {}
	if ok and type(list) == "table" and #list > 0 then
		for _, entry in list do
			local name = if type(entry) == "table" then entry.Name else entry
			-- Lower-case names are deprecated aliases of PascalCase ones.
			if type(name) == "string" and string.match(name, "^%u") and not SKIPPED[name] then
				table.insert(names, name)
			end
		end
		table.sort(names)
		return names
	end
	for _, name in COMMON_PROPERTIES do
		table.insert(names, name)
	end
	return names
end

function Instances.getProperties(args)
	local instance, problem = Util.resolve(args)
	if instance == nil then
		return { error = problem }
	end
	local wanted = if type(args.properties) == "table" and #args.properties > 0 then args.properties else propertyNames(instance)
	local properties = {}
	local types = {}
	local unreadable = {}
	for _, name in wanted do
		local ok, value = pcall(function()
			return instance[name]
		end)
		if ok then
			if typeof(value) ~= "RBXScriptSignal" and typeof(value) ~= "function" then
				properties[name] = Util.encode(value)
				types[name] = typeof(value)
			end
		elseif type(args.properties) == "table" then
			table.insert(unreadable, name)
		end
	end
	local attributes = {}
	for name, value in instance:GetAttributes() do
		attributes[name] = { value = Util.encode(value), type = typeof(value) }
	end
	local result = {
		path = Util.pathOf(instance),
		instanceRef = Util.refOf(instance),
		className = instance.ClassName,
		uniquePath = Util.isUniquePath(instance),
		properties = properties,
		types = types,
		attributes = attributes,
		tags = CollectionService:GetTags(instance),
		childCount = #instance:GetChildren(),
	}
	if instance:IsA("LuaSourceContainer") then
		local ok, source = pcall(function()
			return instance.Source
		end)
		if ok then
			result.sourceLength = #source
			result.note = "Read the script body with get_script_source."
		end
	end
	if #unreadable > 0 then
		result.unreadable = unreadable
	end
	return result
end

-- Converts every value first, then writes Parent last; any failure restores what was written.
local function applyProperties(instance: Instance, properties, attributes, tags)
	if properties.Source ~= nil then
		return nil, "Source cannot be set through set_properties; use set_script_source."
	end
	local names = {}
	for name in properties do
		table.insert(names, name)
	end
	table.sort(names, function(a, b)
		if a == "Parent" then
			return false
		elseif b == "Parent" then
			return true
		end
		return a < b
	end)

	local planned = {}
	for _, name in names do
		local ok, current = pcall(function()
			return instance[name]
		end)
		if not ok then
			return nil, string.format("%s has no readable property %s", instance.ClassName, name)
		end
		local value, problem = Util.decode(properties[name], current, name)
		if problem then
			return nil, string.format("%s: %s", name, problem)
		end
		if name == "Name" then
			value = tostring(value)
		end
		table.insert(planned, { kind = "property", name = name, old = current, new = value })
	end
	for name, raw in attributes or {} do
		local current = instance:GetAttribute(name)
		local value, problem = Util.decodeAttribute(raw, current)
		if problem then
			return nil, string.format("attribute %s: %s", name, problem)
		end
		table.insert(planned, { kind = "attribute", name = name, old = current, new = value })
	end
	for _, tag in (tags and tags.add) or {} do
		if not CollectionService:HasTag(instance, tag) then
			table.insert(planned, { kind = "addTag", name = tag })
		end
	end
	for _, tag in (tags and tags.remove) or {} do
		if CollectionService:HasTag(instance, tag) then
			table.insert(planned, { kind = "removeTag", name = tag })
		end
	end

	local applied = {}
	local function undo()
		local failures = {}
		for i = #applied, 1, -1 do
			local step = applied[i]
			local ok, err = pcall(function()
				if step.kind == "property" then
					instance[step.name] = step.old
				elseif step.kind == "attribute" then
					instance:SetAttribute(step.name, step.old)
				elseif step.kind == "addTag" then
					CollectionService:RemoveTag(instance, step.name)
				elseif step.kind == "removeTag" then
					CollectionService:AddTag(instance, step.name)
				end
			end)
			if not ok then
				table.insert(failures, step.name .. ": " .. tostring(err))
			end
		end
		return failures
	end

	for _, step in planned do
		local ok, err = pcall(function()
			if step.kind == "property" then
				instance[step.name] = step.new
				local now = instance[step.name]
				if not Util.same(now, step.new) and not (step.new == nil and now == nil) then
					error(string.format("%s did not take the requested value (Studio holds %s)", step.name, tostring(now)), 0)
				end
			elseif step.kind == "attribute" then
				instance:SetAttribute(step.name, step.new)
			elseif step.kind == "addTag" then
				CollectionService:AddTag(instance, step.name)
			else
				CollectionService:RemoveTag(instance, step.name)
			end
		end)
		if not ok then
			table.insert(applied, step)
			local failures = undo()
			return nil, tostring(err), failures
		end
		table.insert(applied, step)
	end
	return #planned, nil
end

function Instances.setProperties(args)
	local instance, problem = Util.resolve(args)
	if instance == nil then
		return { error = problem }
	end
	if instance == game or instance.Parent == game and type(args.properties) == "table" and args.properties.Parent ~= nil then
		return { error = "game and services cannot be reparented" }
	end
	local recording = Util.beginRecording("Set properties on " .. instance.Name)
	local count, err, rollbackFailures = applyProperties(instance, args.properties or {}, args.attributes, args.tags)
	if count == nil then
		Util.finishRecording(recording, false)
		return {
			error = err,
			rolledBack = rollbackFailures == nil or #rollbackFailures == 0,
			rollbackFailures = if rollbackFailures and #rollbackFailures > 0 then rollbackFailures else nil,
		}
	end
	Util.finishRecording(recording, true)
	return {
		success = true,
		path = Util.pathOf(instance),
		instanceRef = Util.refOf(instance),
		changed = count,
		undoable = recording ~= nil,
	}
end

function Instances.create(args)
	local items = args.instances
	if type(items) ~= "table" or #items == 0 then
		return { error = "instances must be a non-empty array" }
	end
	if #items > 200 then
		return { error = "at most 200 instances per call" }
	end
	local made = {}
	local byId = {}
	local attachments = {}
	local function cleanup()
		for _, entry in made do
			pcall(function()
				entry.instance:Destroy()
			end)
		end
	end
	for index, item in items do
		local prefix = string.format("instance %d: ", index)
		if type(item) ~= "table" or type(item.className) ~= "string" then
			cleanup()
			return { error = prefix .. "className is required", nothingChanged = true }
		end
		local ok, instance = pcall(Instance.new, item.className)
		if not ok then
			cleanup()
			return { error = prefix .. "cannot create " .. item.className, nothingChanged = true }
		end
		table.insert(made, { instance = instance, item = item })
		if type(item.name) == "string" and item.name ~= "" then
			instance.Name = item.name
		end
		local count, problem = applyProperties(instance, item.properties or {}, item.attributes, { add = item.tags })
		if count == nil then
			cleanup()
			return { error = prefix .. tostring(problem), nothingChanged = true }
		end
		local parentRef = item.parent
		if type(parentRef) ~= "string" or parentRef == "" then
			cleanup()
			return { error = prefix .. "parent is required", nothingChanged = true }
		end
		if string.sub(parentRef, 1, 1) == "$" then
			local parent = byId[string.sub(parentRef, 2)]
			if parent == nil then
				cleanup()
				return { error = prefix .. "unknown id " .. parentRef .. " (ids must come from earlier items)", nothingChanged = true }
			end
			instance.Parent = parent
		else
			local parent = Util.resolvePath(parentRef)
			if parent == nil or parent == game then
				cleanup()
				return { error = prefix .. "no instance at " .. parentRef, nothingChanged = true }
			end
			table.insert(attachments, { instance = instance, parent = parent })
		end
		if type(item.id) == "string" and item.id ~= "" then
			if byId[item.id] then
				cleanup()
				return { error = prefix .. "duplicate id " .. item.id, nothingChanged = true }
			end
			byId[item.id] = instance
		end
	end

	local recording = Util.beginRecording(string.format("Create %d instance(s)", #items))
	for i, attach in attachments do
		local ok, err = pcall(function()
			attach.instance.Parent = attach.parent
		end)
		if not ok then
			for j = i - 1, 1, -1 do
				attachments[j].instance.Parent = nil
			end
			Util.finishRecording(recording, false)
			cleanup()
			return { error = "attaching failed: " .. tostring(err), nothingChanged = true }
		end
	end
	Util.finishRecording(recording, true)
	local created = {}
	for _, entry in made do
		table.insert(created, {
			id = entry.item.id,
			className = entry.instance.ClassName,
			path = Util.pathOf(entry.instance),
			instanceRef = Util.refOf(entry.instance),
		})
	end
	return { success = true, created = created, undoable = recording ~= nil }
end

function Instances.delete(args)
	local targets = {}
	local missing = {}
	for _, path in args.paths or {} do
		local instance = type(path) == "string" and Util.resolvePath(path) or nil
		if instance then
			table.insert(targets, instance)
		else
			table.insert(missing, path)
		end
	end
	for _, ref in args.instanceRefs or {} do
		local instance, problem = Util.resolve({ instanceRef = ref })
		if instance then
			table.insert(targets, instance)
		else
			table.insert(missing, problem)
		end
	end
	if #targets == 0 then
		return { error = "Nothing to remove: no path or instanceRef matched.", missing = missing }
	end
	for _, instance in targets do
		if instance == game or instance.Parent == game or instance:IsA("Terrain") or instance:IsA("Camera") and instance.Parent:IsA("Workspace") then
			return { error = Util.pathOf(instance) .. " cannot be removed.", nothingChanged = true }
		end
	end
	local recording = Util.beginRecording(string.format("Remove %d instance(s)", #targets))
	local removed = {}
	for _, instance in targets do
		local path = Util.pathOf(instance)
		-- Unparented rather than destroyed, so undo brings it back like Studio's own Delete.
		local ok = pcall(function()
			instance.Parent = nil
		end)
		if ok then
			table.insert(removed, path)
		end
	end
	Util.finishRecording(recording, true)
	return {
		success = true,
		removed = removed,
		missing = if #missing > 0 then missing else nil,
		undoable = recording ~= nil,
	}
end

return Instances
