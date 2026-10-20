--!nocheck
-- Runs agent Luau with captured output. Script bodies must change through the script tools,
-- so sources are snapshotted before the run and anything the code changed is put back.

local RunService = game:GetService("RunService")

local Util = require(script.Parent.Parent.Util)

local Luau = {}

-- Set by the main script: module environments have no `plugin` global of their own.
Luau.plugin = nil

local MAX_OUTPUT_BYTES = 64 * 1024
local MAX_OUTPUT_LINES = 400

local function snapshotSources()
	local sources = {}
	Util.walk(nil, function(instance)
		if instance:IsA("LuaSourceContainer") then
			local ok, source = pcall(function()
				return instance.Source
			end)
			if ok then
				sources[instance] = source
			end
		end
		return false
	end)
	return sources
end

local function compile(code: string)
	if loadstring then
		local ok, fn, err = pcall(loadstring, code, "=user_code")
		if ok and fn then
			return fn, nil
		end
		if ok and type(err) == "string" and not string.find(err, "not available", 1, true) then
			return nil, "Compile error: " .. err
		end
	end
	-- Without loadstring, a temporary module compiles the same code.
	local module = Instance.new("ModuleScript")
	module.Name = "__SealCodeRun"
	module.Archivable = false
	module.Source = "return function(...)\n" .. code .. "\nend"
	module.Parent = game:GetService("ServerStorage")
	local ok, result = pcall(require, module)
	module:Destroy()
	if not ok then
		return nil, "Compile error: " .. tostring(result)
	end
	return result, nil
end

function Luau.execute(args)
	local code = args.code
	if type(code) ~= "string" or code == "" then
		return { error = "code is required" }
	end
	local output = {}
	local outputBytes = 0
	local outputCut = false
	local function capture(prefix: string, ...)
		local parts = table.pack(...)
		local texts = {}
		for i = 1, parts.n do
			texts[i] = tostring(parts[i])
		end
		local line = prefix .. table.concat(texts, " ")
		if outputBytes + #line > MAX_OUTPUT_BYTES or #output >= MAX_OUTPUT_LINES then
			outputCut = true
			return
		end
		outputBytes += #line
		table.insert(output, Util.safeText(line))
	end

	local fn, compileError = compile(code)
	if fn == nil then
		return { success = false, error = compileError }
	end
	local env = setmetatable({
		print = function(...)
			capture("", ...)
			print(...)
		end,
		warn = function(...)
			capture("[warn] ", ...)
			warn(...)
		end,
		plugin = Luau.plugin,
	}, { __index = getfenv(1) })
	pcall(setfenv, fn, env)

	local guardScripts = RunService:IsEdit() and args.allowScriptChanges ~= true
	local before = if RunService:IsEdit() then snapshotSources() else nil
	local recording = Util.beginRecording("Run Luau")
	local results = table.pack(xpcall(fn, function(err)
		local trace = debug.traceback(tostring(err), 2)
		return trace
	end))
	Util.finishRecording(recording, true)

	local changed = {}
	local reverted = {}
	if before then
		for instance, source in before do
			local ok, now = pcall(function()
				return instance.Source
			end)
			if ok and now ~= source then
				local path = Util.pathOf(instance) or instance.Name
				if guardScripts then
					instance.Source = source
					table.insert(reverted, path)
				else
					table.insert(changed, path)
				end
			end
		end
	end

	local result = {
		success = results[1],
		output = output,
		outputTruncated = if outputCut then true else nil,
		scriptsReverted = if #reverted > 0 then reverted else nil,
		scriptsChanged = if #changed > 0 then changed else nil,
		undoable = recording ~= nil,
	}
	if #reverted > 0 then
		result.warning = "The code changed script sources, which were put back. Write script bodies with set_script_source or edit_script."
	end
	if results[1] then
		if results.n >= 2 then
			result.returnValue = Util.jsonSafe(results[2])
		end
	else
		local message = tostring(results[2])
		message = string.gsub(message, "user_code:", "line ")
		result.error = string.sub(message, 1, 4000)
	end
	return result
end

return Luau
