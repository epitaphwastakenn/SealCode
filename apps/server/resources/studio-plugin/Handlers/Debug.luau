--!nocheck
-- Playtest debugging aids: simulated network conditions for a client, and logpoints (breakpoints
-- that print instead of pausing, so an unattended playtest never freezes).

local Util = require(script.Parent.Parent.Util)

local Debug = {}

-- Network ----------------------------------------------------------------------------------------

local NETWORK_KEYS = {
	"InboundNetworkMinDelayMs",
	"OutboundNetworkMinDelayMs",
	"InboundNetworkJitterMs",
	"OutboundNetworkJitterMs",
	"InboundNetworkLossPercent",
	"OutboundNetworkLossPercent",
}
local MAX_LOSS_PERCENT = 0.5

function Debug.network(args)
	local ok, network = pcall(function()
		return settings():GetService("NetworkSettings")
	end)
	if not ok or network == nil then
		return { error = "This Studio does not expose NetworkSettings to plugins: " .. tostring(network) }
	end
	local function read()
		local values = {}
		for _, key in NETWORK_KEYS do
			values[key] = network[key]
		end
		return values
	end
	local before = read()
	if type(args.values) == "table" then
		for _, key in NETWORK_KEYS do
			local wanted = args.values[key]
			if wanted ~= nil then
				local number = tonumber(wanted)
				if number == nil or number < 0 then
					return { error = key .. " must be a number of 0 or more" }
				end
				if string.find(key, "Loss", 1, true) then
					number = math.min(number, MAX_LOSS_PERCENT)
				end
				local applied, why = pcall(function()
					network[key] = number
				end)
				if not applied then
					return { error = "Studio refused to set " .. key .. ": " .. tostring(why), before = before, after = read() }
				end
			end
		end
	end
	return { success = true, before = before, after = read() }
end

-- Logpoints ---------------------------------------------------------------------------------------

local registry: { [string]: any } = {}

local function service()
	local ok, found = pcall(function()
		return game:GetService("ScriptDebuggerService")
	end)
	if ok and found then
		return found, nil
	end
	return nil, "This Studio has no ScriptDebuggerService. The Luau debugger API is a Studio beta feature: ask the user to turn it on in File, Beta Features, then restart Studio."
end

local function scriptAt(path: any): (LuaSourceContainer?, string?)
	if type(path) ~= "string" or path == "" then
		return nil, "script is required"
	end
	local instance, problem = Util.resolve({ path = path })
	if instance == nil then
		return nil, problem
	end
	if not instance:IsA("LuaSourceContainer") then
		return nil, path .. " is a " .. instance.ClassName .. ", not a script"
	end
	return instance, nil
end

local function listing()
	local entries = {}
	for _, entry in registry do
		table.insert(entries, entry)
	end
	table.sort(entries, function(a, b)
		if a.script ~= b.script then
			return a.script < b.script
		end
		return a.line < b.line
	end)
	return entries
end

function Debug.breakpoints(args)
	local action = args.action
	if action == "list" then
		return {
			success = true,
			breakpoints = listing(),
			note = "Only logpoints set through this tool are listed; breakpoints the user set in Studio are not visible here.",
		}
	end
	local debugger, missing = service()
	if debugger == nil then
		return { error = missing }
	end

	if action == "clear" then
		local cleared = 0
		if args.all == true then
			local ok, why = pcall(function()
				debugger:ClearBreakpoints()
			end)
			if not ok then
				return { error = "Could not clear breakpoints: " .. tostring(why) }
			end
			cleared = #listing()
			table.clear(registry)
			return { success = true, cleared = cleared, note = "Every breakpoint in Studio was removed, including any the user set by hand." }
		end
		for key, entry in registry do
			local instance = Util.resolvePath(entry.script)
			local removed = false
			if instance and instance:IsA("LuaSourceContainer") then
				removed = pcall(function()
					debugger:RemoveBreakpoint(instance, entry.line)
				end)
			end
			if removed or instance == nil then
				registry[key] = nil
				cleared += 1
			end
		end
		return { success = true, cleared = cleared, remaining = #listing(), note = "Removed the logpoints this tool set; breakpoints the user set by hand stay. Pass all=true to clear every breakpoint in Studio." }
	end

	local instance, problem = scriptAt(args.script)
	if instance == nil then
		return { error = problem }
	end
	local path = Util.pathOf(instance)
	local line = math.floor(tonumber(args.line) or 0)
	if line < 1 then
		return { error = "line must be a 1-based line number" }
	end
	local key = path .. ":" .. line

	if action == "remove" then
		local ok, removed = pcall(function()
			return debugger:RemoveBreakpoint(instance, line)
		end)
		if not ok then
			return { error = "Could not remove the breakpoint: " .. tostring(removed) }
		end
		registry[key] = nil
		return { success = true, removed = removed ~= false, script = path, line = line }
	end

	if action ~= "set" then
		return { error = "action must be set, remove, clear or list" }
	end
	-- Each hit prints "[breakpoint path:line]" and then the values asked for, so the lines are easy
	-- to pick out of the Output with get_output_logs.
	local message = string.format("%q", "[breakpoint " .. key .. "]")
	if type(args.logMessage) == "string" and args.logMessage ~= "" then
		message ..= ", " .. args.logMessage
	end
	local spec = {
		Line = line,
		Enabled = args.enabled ~= false,
		ContinueExecution = true,
		LogMessage = message,
	}
	if type(args.condition) == "string" and args.condition ~= "" then
		spec.Condition = args.condition
	end
	local ok, result = pcall(function()
		return debugger:AddBreakpoint(instance, spec)
	end)
	if not ok then
		return { error = "Studio would not set the breakpoint: " .. tostring(result) }
	end
	if type(result) == "table" and result.Verified == false then
		return {
			error = "Studio could not place a breakpoint at " .. key .. ": " .. tostring(result.Message or "no code on that line"),
		}
	end
	local placed = if type(result) == "table" and type(result.Line) == "number" then result.Line else line
	local entry = {
		script = path,
		line = placed,
		requestedLine = if placed ~= line then line else nil,
		condition = spec.Condition,
		logMessage = args.logMessage,
		enabled = spec.Enabled,
	}
	registry[path .. ":" .. placed] = entry
	return { success = true, breakpoint = entry }
end

return Debug
