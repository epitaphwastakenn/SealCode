--!nocheck
-- build_instances: a batch of create / clone / set / remove steps applied as one undo step.
-- Everything new is built detached first and every live edit is converted and snapshotted, so a
-- failure while preparing changes nothing; a failure while applying undoes what already ran.

local CollectionService = game:GetService("CollectionService")

local Util = require(script.Parent.Parent.Util)

local Build = {}

local MAX_OPERATIONS = 500
local MAX_INSTANCES = 20000

local function vector(value): Vector3?
	if type(value) == "table" and type(value[1]) == "number" and type(value[2]) == "number" and type(value[3]) == "number" then
		if value[1] ~= value[1] or value[2] ~= value[2] or value[3] ~= value[3] then
			return nil
		end
		return Vector3.new(value[1], value[2], value[3])
	end
	return nil
end

local function rotationOf(degrees: Vector3): CFrame
	return CFrame.fromOrientation(math.rad(degrees.X), math.rad(degrees.Y), math.rad(degrees.Z))
end

-- Pose for a part or model: position and/or absolute rotation, keeping the missing half.
local function posed(current: CFrame, position: Vector3?, rotation: Vector3?): CFrame
	local base = if position then CFrame.new(position) else CFrame.new(current.Position)
	local turn = if rotation then rotationOf(rotation) else current - current.Position
	return base * turn
end

local function pivotable(instance: Instance): boolean
	return instance:IsA("BasePart") or instance:IsA("Model")
end

local function sortedKeys(map)
	local keys = {}
	for key in map or {} do
		table.insert(keys, key)
	end
	table.sort(keys, function(a, b)
		if a == "Parent" then
			return false
		elseif b == "Parent" then
			return true
		end
		return a < b
	end)
	return keys
end

local function isUnder(instance: Instance, root: Instance): boolean
	return instance == root or instance:IsDescendantOf(root)
end

function Build.run(args)
	local operations = args.operations
	if type(args.path) ~= "string" or args.path == "" then
		return { error = "path (the build root) is required" }
	end
	if type(operations) ~= "table" or #operations == 0 then
		return { error = "operations must be a non-empty array" }
	end
	if #operations > MAX_OPERATIONS then
		return { error = string.format("at most %d operations per build", MAX_OPERATIONS) }
	end

	-- The root: an existing instance, a service (add-only), or a Model created under an existing parent.
	local names = Util.parsePath(args.path)
	if names == nil or #names == 0 then
		return { error = "path is not a valid instance path: " .. args.path }
	end
	local root = Util.resolvePath(args.path)
	local createdRoot = false
	local serviceRoot = false
	local rootParent
	if root == game then
		return { error = "game itself cannot be a build root" }
	end
	if root ~= nil then
		serviceRoot = root.Parent == game
	else
		local parentNames = table.clone(names)
		local rootName = table.remove(parentNames)
		if #parentNames == 0 then
			return { error = "a path directly under game must be an existing service" }
		end
		local parentPath = "game"
		for _, name in parentNames do
			parentPath ..= '["' .. string.gsub(name, '[\\"]', "\\%0") .. '"]'
		end
		rootParent = Util.resolvePath(parentPath)
		if rootParent == nil then
			return { error = "Neither the build root nor its parent exists: " .. args.path }
		end
		root = Instance.new("Model")
		root.Name = rootName
		createdRoot = true
	end
	local rootPathText = args.path

	local made = {} -- every instance this batch made (detached until applied)
	local madeSet = {}
	local topLevel = {} -- made instances that get a live parent
	local ids = {}
	local idOrder = {}
	local actions = {}
	local usedTags = {}
	local counts = { created = 0, cloned = 0, updated = 0, removed = 0 }
	local soleRootRemoval = false

	local function track(instance)
		table.insert(made, instance)
		madeSet[instance] = true
	end
	if createdRoot then
		track(root)
		table.insert(actions, {
			label = "attach root",
			apply = function()
				root.Parent = rootParent
			end,
			undo = function()
				root.Parent = nil
			end,
		})
	end

	local function fail(index, op, message)
		for _, instance in made do
			pcall(function()
				instance:Destroy()
			end)
		end
		return { error = string.format("step %d (%s): %s Nothing was changed.", index, tostring(op), message) }
	end

	-- Resolves a path or $id. Paths see the tree as it was before the batch.
	local function lookup(ref)
		if type(ref) ~= "string" or ref == "" then
			return nil, "a path or $id is required"
		end
		if string.sub(ref, 1, 1) == "$" then
			local found = ids[string.sub(ref, 2)]
			if found == nil then
				return nil, "unknown " .. ref .. " (an id must come from an earlier step)"
			end
			return found, nil
		end
		if createdRoot and ref == rootPathText then
			return root, nil
		end
		local found = Util.resolvePath(ref)
		if found == nil then
			return nil, "no instance at " .. ref
		end
		return found, nil
	end

	local function parentFor(step)
		if step.parent == nil then
			return root, nil
		end
		local parent, problem = lookup(step.parent)
		if parent == nil then
			return nil, problem
		end
		if not madeSet[parent] and not isUnder(parent, root) then
			return nil, "parent must be the build root or inside it"
		end
		return parent, nil
	end

	-- Detached instances take their edits right away.
	local function editMade(instance, step)
		for _, name in sortedKeys(step.properties) do
			if name == "Source" then
				return "Source is written with the script tools, not build_instances"
			end
			local ok, current = pcall(function()
				return instance[name]
			end)
			if not ok then
				return string.format("%s has no property %s", instance.ClassName, name)
			end
			local raw = step.properties[name]
			if name == "PrimaryPart" and type(raw) == "string" and string.sub(raw, 1, 1) == "$" then
				local target, problem = lookup(raw)
				if target == nil then
					return problem
				end
				instance.PrimaryPart = target
			else
				local value, problem = Util.decode(raw, current, name)
				if problem then
					return name .. ": " .. problem
				end
				local setOk, err = pcall(function()
					instance[name] = if name == "Name" then tostring(value) else value
				end)
				if not setOk then
					return name .. ": " .. tostring(err)
				end
			end
		end
		for key, raw in step.attributes or {} do
			local value, problem = Util.decodeAttribute(raw, instance:GetAttribute(key))
			if problem then
				return "attribute " .. key .. ": " .. problem
			end
			instance:SetAttribute(key, value)
		end
		if step.tags ~= nil and type(step.tags) ~= "table" then
			return "tags must be an array of strings"
		end
		for _, tag in step.tags or {} do
			CollectionService:AddTag(instance, tag)
			usedTags[tag] = true
		end
		local position, rotation = vector(step.position), vector(step.rotation)
		if (step.position ~= nil and position == nil) or (step.rotation ~= nil and rotation == nil) then
			return "position and rotation are [x, y, z] arrays of finite numbers"
		end
		if position or rotation then
			if not pivotable(instance) then
				return "position and rotation apply to parts and models only; place the parts inside instead"
			end
			instance:PivotTo(posed(instance:GetPivot(), position, rotation))
		end
		return nil
	end

	local function attach(instance, parent)
		if madeSet[parent] then
			instance.Parent = parent
		else
			table.insert(topLevel, instance)
			table.insert(actions, {
				label = "attach " .. instance.Name,
				apply = function()
					instance.Parent = parent
				end,
				undo = function()
					instance.Parent = nil
				end,
			})
		end
	end

	local function register(index, step, instance)
		if step.id == nil then
			return nil
		end
		if type(step.id) ~= "string" or step.id == "" then
			return "id must be a non-empty string"
		end
		if ids[step.id] then
			return "id " .. step.id .. " is used twice"
		end
		ids[step.id] = instance
		table.insert(idOrder, step.id)
		return nil
	end

	for index, step in operations do
		local op = type(step) == "table" and step.op or nil
		if op == "scatter" then
			return fail(index, op, "scatter is not supported by this version of the SealCode bridge.")
		elseif op == "create" then
			if type(step.className) ~= "string" then
				return fail(index, op, "className is required.")
			end
			local ok, instance = pcall(Instance.new, step.className)
			if not ok then
				return fail(index, op, "cannot create " .. step.className .. ".")
			end
			track(instance)
			if type(step.name) == "string" and step.name ~= "" then
				instance.Name = step.name
			end
			local problem = editMade(instance, step)
			if problem then
				return fail(index, op, problem)
			end
			local parent, parentProblem = parentFor(step)
			if parent == nil then
				return fail(index, op, parentProblem)
			end
			attach(instance, parent)
			local idProblem = register(index, step, instance)
			if idProblem then
				return fail(index, op, idProblem)
			end
			counts.created += 1
		elseif op == "clone" then
			local source, problem = lookup(step.source)
			if source == nil then
				return fail(index, op, "source: " .. tostring(problem))
			end
			local transforms = step.transforms
			if transforms ~= nil and (type(transforms) ~= "table" or #transforms == 0) then
				return fail(index, op, "transforms must be a non-empty array.")
			end
			transforms = transforms or { {} }
			if step.id ~= nil and #transforms > 1 then
				return fail(index, op, "an id needs a single transform.")
			end
			local parent, parentProblem = parentFor(step)
			if parent == nil then
				return fail(index, op, parentProblem)
			end
			for _, transform in transforms do
				local copyOk, copy = pcall(function()
					return source:Clone()
				end)
				if not copyOk or copy == nil then
					return fail(index, op, "the source cannot be cloned (is it Archivable?).")
				end
				track(copy)
				if type(step.name) == "string" and step.name ~= "" then
					copy.Name = step.name
				end
				local editProblem = editMade(copy, { properties = step.properties, attributes = step.attributes, tags = step.tags })
				if editProblem then
					return fail(index, op, editProblem)
				end
				if type(transform) ~= "table" then
					return fail(index, op, "each transform is an object.")
				end
				local scale = transform.scale
				if scale ~= nil then
					if type(scale) ~= "number" or scale ~= scale or scale < 0.05 or scale > 20 then
						return fail(index, op, "scale is a number from 0.05 to 20.")
					end
					if copy:IsA("Model") then
						copy:ScaleTo(copy:GetScale() * scale)
					elseif copy:IsA("BasePart") then
						copy.Size *= scale
					else
						return fail(index, op, "scale applies to parts and models only.")
					end
				end
				local position, rotation = vector(transform.position), vector(transform.rotation)
				if (transform.position ~= nil and position == nil) or (transform.rotation ~= nil and rotation == nil) then
					return fail(index, op, "transform position and rotation are [x, y, z] arrays of finite numbers.")
				end
				if position or rotation then
					if not pivotable(copy) then
						return fail(index, op, "transforms apply to parts and models only.")
					end
					copy:PivotTo(posed(copy:GetPivot(), position, rotation))
				end
				attach(copy, parent)
				local idProblem = register(index, step, copy)
				if idProblem then
					return fail(index, op, idProblem)
				end
				counts.cloned += 1
			end
		elseif op == "set" then
			local target, problem = lookup(step.target)
			if target == nil then
				return fail(index, op, "target: " .. tostring(problem))
			end
			if madeSet[target] then
				local editProblem = editMade(target, step)
				if editProblem then
					return fail(index, op, editProblem)
				end
				if type(step.name) == "string" and step.name ~= "" then
					target.Name = step.name
				end
			else
				if not isUnder(target, root) then
					return fail(index, op, "target must be the build root or inside it.")
				end
				if serviceRoot then
					return fail(index, op, "a service root only adds: set works on instances made by this batch.")
				end
				local properties = table.clone(step.properties or {})
				if type(step.name) == "string" and step.name ~= "" then
					properties.Name = step.name
				end
				for _, name in sortedKeys(properties) do
					if name == "Source" then
						return fail(index, op, "Source is written with the script tools, not build_instances.")
					end
					local ok, current = pcall(function()
						return target[name]
					end)
					if not ok then
						return fail(index, op, string.format("%s has no property %s.", target.ClassName, name))
					end
					local raw = properties[name]
					local value, convertProblem
					if type(raw) == "string" and string.sub(raw, 1, 1) == "$" and name == "PrimaryPart" then
						value, convertProblem = lookup(raw)
					else
						value, convertProblem = Util.decode(raw, current, name)
					end
					if convertProblem then
						return fail(index, op, name .. ": " .. convertProblem)
					end
					if name == "Name" then
						value = tostring(value)
					end
					local path = Util.pathOf(target) or target.Name
					table.insert(actions, {
						label = path .. "." .. name,
						apply = function()
							target[name] = value
							local now = target[name]
							if not Util.same(now, value) and not (value == nil and now == nil) then
								error(string.format("%s.%s did not take the requested value", path, name), 0)
							end
						end,
						undo = function()
							target[name] = current
						end,
					})
				end
				for key, raw in step.attributes or {} do
					local old = target:GetAttribute(key)
					local value, attributeProblem = Util.decodeAttribute(raw, old)
					if attributeProblem then
						return fail(index, op, "attribute " .. key .. ": " .. attributeProblem)
					end
					table.insert(actions, {
						label = "attribute " .. key,
						apply = function()
							target:SetAttribute(key, value)
						end,
						undo = function()
							target:SetAttribute(key, old)
						end,
					})
				end
				for _, tag in step.tags or {} do
					usedTags[tag] = true
					if not CollectionService:HasTag(target, tag) then
						table.insert(actions, {
							label = "tag " .. tag,
							apply = function()
								CollectionService:AddTag(target, tag)
							end,
							undo = function()
								CollectionService:RemoveTag(target, tag)
							end,
						})
					end
				end
				local position, rotation = vector(step.position), vector(step.rotation)
				if position or rotation then
					if not pivotable(target) then
						return fail(index, op, "position and rotation apply to parts and models only.")
					end
					local before = target:GetPivot()
					local after = posed(before, position, rotation)
					table.insert(actions, {
						label = "pivot",
						apply = function()
							target:PivotTo(after)
						end,
						undo = function()
							target:PivotTo(before)
						end,
					})
				end
			end
			counts.updated += 1
		elseif op == "remove" then
			local target, problem = lookup(step.target)
			if target == nil then
				return fail(index, op, "target: " .. tostring(problem))
			end
			if madeSet[target] then
				return fail(index, op, "cannot remove an instance created in this batch.")
			end
			if target == root then
				if #operations ~= 1 or serviceRoot then
					return fail(index, op, "removing the root must be the only step, and services cannot be removed.")
				end
				soleRootRemoval = true
			elseif not isUnder(target, root) then
				return fail(index, op, "target must be inside the build root.")
			end
			if serviceRoot then
				return fail(index, op, "a service root only adds: remove is refused.")
			end
			local oldParent = target.Parent
			table.insert(actions, {
				label = "remove " .. target.Name,
				apply = function()
					target.Parent = nil
				end,
				undo = function()
					target.Parent = oldParent
				end,
			})
			counts.removed += 1
		else
			return fail(index, op, "op must be create, clone, set or remove.")
		end
		if #made > MAX_INSTANCES then
			return fail(index, op, string.format("the batch would make more than %d instances.", MAX_INSTANCES))
		end
	end

	-- Apply: one recording, every action in order, undone in reverse on the first failure.
	local rootName = root.Name
	local recording = Util.beginRecording((if soleRootRemoval then "Remove " else "Build ") .. rootName)
	local started = {}
	for _, action in actions do
		table.insert(started, action)
		local ok, err = pcall(action.apply)
		if not ok then
			local undoErrors = {}
			for i = #started, 1, -1 do
				local undoOk, undoErr = pcall(started[i].undo)
				if not undoOk then
					table.insert(undoErrors, started[i].label .. ": " .. tostring(undoErr))
				end
			end
			Util.finishRecording(recording, false)
			for _, instance in made do
				pcall(function()
					instance:Destroy()
				end)
			end
			return {
				error = tostring(err),
				rolledBack = #undoErrors == 0,
				undoErrors = if #undoErrors > 0 then undoErrors else nil,
			}
		end
	end
	Util.finishRecording(recording, true)

	if soleRootRemoval then
		return {
			success = true,
			path = rootPathText,
			removedRoot = true,
			created = 0,
			cloned = 0,
			updated = 0,
			removed = 1,
			undoable = recording ~= nil,
		}
	end

	-- Summary of what is now under the root (for a service root: only what this batch added).
	local scope = {}
	if serviceRoot then
		for _, instance in topLevel do
			table.insert(scope, instance)
			for _, child in instance:GetDescendants() do
				table.insert(scope, child)
			end
		end
	else
		scope = root:GetDescendants()
	end
	local classCounts = {}
	local tagCounts = {}
	local minCorner, maxCorner
	for _, instance in scope do
		classCounts[instance.ClassName] = (classCounts[instance.ClassName] or 0) + 1
		for tag in usedTags do
			if CollectionService:HasTag(instance, tag) then
				tagCounts[tag] = (tagCounts[tag] or 0) + 1
			end
		end
		if instance:IsA("BasePart") then
			local half = instance.Size / 2
			local cf = instance.CFrame
			for _, sign in { Vector3.new(1, 1, 1), Vector3.new(1, 1, -1), Vector3.new(1, -1, 1), Vector3.new(1, -1, -1), Vector3.new(-1, 1, 1), Vector3.new(-1, 1, -1), Vector3.new(-1, -1, 1), Vector3.new(-1, -1, -1) } do
				local corner = cf:PointToWorldSpace(half * sign)
				minCorner = if minCorner then minCorner:Min(corner) else corner
				maxCorner = if maxCorner then maxCorner:Max(corner) else corner
			end
		end
	end
	local classes = {}
	for className, count in classCounts do
		table.insert(classes, { className = className, count = count })
	end
	table.sort(classes, function(a, b)
		return a.count > b.count or (a.count == b.count and a.className < b.className)
	end)
	while #classes > 12 do
		table.remove(classes)
	end
	local idPaths = {}
	for i, id in idOrder do
		if i > 50 then
			break
		end
		idPaths[id] = Util.pathOf(ids[id])
	end
	local function round(v: Vector3)
		return { math.round(v.X * 100) / 100, math.round(v.Y * 100) / 100, math.round(v.Z * 100) / 100 }
	end
	return {
		success = true,
		path = Util.pathOf(root),
		instanceRef = Util.refOf(root),
		createdRoot = createdRoot,
		serviceRoot = if serviceRoot then true else nil,
		created = counts.created,
		cloned = counts.cloned,
		updated = counts.updated,
		removed = counts.removed,
		undoable = recording ~= nil,
		descendants = #scope,
		classes = classes,
		tags = if next(tagCounts) then tagCounts else nil,
		ids = if next(idPaths) then idPaths else nil,
		idsOmitted = if #idOrder > 50 then #idOrder - 50 else nil,
		bounds = if minCorner then { min = round(minCorner), max = round(maxCorner), size = round(maxCorner - minCorner) } else nil,
	}
end

return Build
