--!nocheck
-- Saving instances to bytes and loading them back. The plugin only handles bytes (base64 on the
-- wire); the bridge reads and writes the .rbxm file on disk.

local SerializationService = game:GetService("SerializationService")
local EncodingService = game:GetService("EncodingService")

local Util = require(script.Parent.Parent.Util)

local Files = {}

function Files.export(args)
	local paths = args.paths
	if type(paths) ~= "table" or #paths == 0 then
		return { error = "paths must list at least one instance to export" }
	end
	local instances = {}
	for _, path in paths do
		local instance, problem = Util.resolve({ path = path })
		if instance == nil then
			return { error = problem }
		end
		table.insert(instances, instance)
	end
	local ok, bytes = pcall(function()
		return SerializationService:SerializeInstancesAsync(instances)
	end)
	if not ok then
		return { error = "Studio could not serialize those instances: " .. tostring(bytes) }
	end
	local encoded, base64 = pcall(function()
		return buffer.tostring(EncodingService:Base64Encode(bytes))
	end)
	if not encoded then
		return { error = "Could not encode the file: " .. tostring(base64) }
	end
	local described = {}
	for _, instance in instances do
		table.insert(described, { path = Util.pathOf(instance), className = instance.ClassName })
	end
	return { success = true, base64 = base64, bytes = buffer.len(bytes), instances = described }
end

function Files.import(args)
	if type(args.base64) ~= "string" or args.base64 == "" then
		return { error = "base64 file contents are required" }
	end
	local parent = game:GetService("Workspace")
	if type(args.parentPath) == "string" and args.parentPath ~= "" then
		local found, problem = Util.resolve({ path = args.parentPath })
		if found == nil then
			return { error = problem }
		end
		parent = found
	end
	local decoded, bytes = pcall(function()
		return EncodingService:Base64Decode(buffer.fromstring(args.base64))
	end)
	if not decoded then
		return { error = "The file contents were not valid base64: " .. tostring(bytes) }
	end
	local ok, loaded = pcall(function()
		return SerializationService:DeserializeInstancesAsync(bytes)
	end)
	if not ok or type(loaded) ~= "table" then
		return { error = "Studio could not read that file as a model: " .. tostring(loaded) }
	end

	local recording = Util.beginRecording("import file")
	local attached = {}
	local failure = nil
	for _, instance in loaded do
		local parented, why = pcall(function()
			instance.Parent = parent
		end)
		if not parented then
			failure = "Could not put " .. instance.Name .. " (" .. instance.ClassName .. ") under " .. tostring(Util.pathOf(parent)) .. ": " .. tostring(why)
			break
		end
		table.insert(attached, instance)
	end
	if failure then
		-- All or nothing: a half-imported model is worse than none.
		for _, instance in loaded do
			pcall(function()
				instance:Destroy()
			end)
		end
		Util.finishRecording(recording, false)
		return { error = failure }
	end
	Util.finishRecording(recording, true)

	local roots = {}
	local scriptCount, partCount = 0, 0
	local function tally(instance: Instance)
		if instance:IsA("LuaSourceContainer") then
			scriptCount += 1
		elseif instance:IsA("BasePart") then
			partCount += 1
		end
	end
	for _, instance in attached do
		table.insert(roots, { path = Util.pathOf(instance), className = instance.ClassName })
		tally(instance)
		for _, descendant in instance:GetDescendants() do
			tally(descendant)
		end
	end
	return {
		success = true,
		parent = Util.pathOf(parent),
		imported = roots,
		scripts = scriptCount,
		parts = partCount,
		note = if scriptCount > 0
			then "The file held " .. scriptCount .. " script(s) and they are enabled as saved. Read them with grep_scripts or get_script_source before running a playtest."
			else nil,
	}
end

return Files
