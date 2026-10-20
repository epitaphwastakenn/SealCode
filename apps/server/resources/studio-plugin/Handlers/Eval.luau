--!nocheck
-- Evaluates Luau inside a playtest's own script VM, so `require` returns the live modules with
-- their runtime state (a plugin VM only sees fresh copies). A small bridge script, created only
-- in play DataModels and never saved, requires a payload module and runs it.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local Eval = {}

local BRIDGE_NAME = "__SealCodeEval"

local BRIDGE_SOURCE = [[
if not game:GetService("RunService"):IsStudio() then return end
local invoke = Instance.new("BindableFunction")
invoke.Name = "Invoke"
invoke.OnInvoke = function(payload)
	local ok, run = pcall(require, payload)
	if not ok then
		return { ok = false, error = "The code did not load: " .. tostring(run) }
	end
	return run()
end
invoke.Parent = script
]]

-- Wraps agent code so prints are captured and the result crosses a BindableFunction safely.
local function payloadSource(code: string): string
	return [[
local __out, __bytes = {}, 0
local function __push(prefix, ...)
	local parts = table.pack(...)
	local texts = {}
	for i = 1, parts.n do texts[i] = tostring(parts[i]) end
	local line = prefix .. table.concat(texts, " ")
	if __bytes + #line <= 65536 and #__out < 400 then
		table.insert(__out, line)
		__bytes += #line
	end
end
local print = function(...) __push("", ...) print(...) end
local warn = function(...) __push("[warn] ", ...) warn(...) end
local function __ser(value, depth)
	local kind = typeof(value)
	if kind == "table" then
		if depth > 5 then return "<table>" end
		local out, n = {}, 0
		for k, v in value do
			n += 1
			if n > 300 then break end
			out[if type(k) == "number" then k else tostring(k)] = __ser(v, depth + 1)
		end
		return out
	elseif kind == "Instance" then
		return value:GetFullName()
	elseif kind == "number" or kind == "string" or kind == "boolean" or kind == "nil" then
		return value
	end
	return tostring(value)
end
return function()
	local results = table.pack(xpcall(function()
]] .. code .. [[

	end, function(e) return debug.traceback(tostring(e), 2) end))
	if results[1] then
		return { ok = true, result = __ser(results[2], 0), output = __out }
	end
	return { ok = false, error = tostring(results[2]), output = __out }
end
]]
end

local function bridgeParent(): Instance?
	if RunService:IsServer() and Players.LocalPlayer == nil then
		return game:GetService("ServerScriptService")
	end
	local player = Players.LocalPlayer
	if player then
		return player:FindFirstChildOfClass("PlayerScripts") or player:WaitForChild("PlayerScripts", 2)
	end
	return nil
end

local function ensureBridge()
	local parent = bridgeParent()
	if parent == nil then
		return nil, "No place to run code in this DataModel."
	end
	local bridge = parent:FindFirstChild(BRIDGE_NAME)
	if bridge == nil then
		bridge = Instance.new(if Players.LocalPlayer then "LocalScript" else "Script")
		bridge.Name = BRIDGE_NAME
		bridge.Archivable = false
		bridge.Source = BRIDGE_SOURCE
		bridge.Parent = parent
	end
	local invoke = bridge:FindFirstChild("Invoke") or bridge:WaitForChild("Invoke", 3)
	if invoke == nil then
		return nil, "The game-VM bridge did not start; scripts may be disabled in this playtest."
	end
	return bridge, nil
end

function Eval.run(args)
	if not RunService:IsRunning() then
		return { error = "eval runs only in a running playtest." }
	end
	local code = args.code
	if type(code) ~= "string" or code == "" then
		return { error = "code is required" }
	end
	if loadstring then
		local ok, fn, err = pcall(loadstring, "return function() " .. code .. "\nend", "=user_code")
		if ok and fn == nil and type(err) == "string" and not string.find(err, "not available", 1, true) then
			return { success = false, error = "Compile error: " .. err }
		end
	end
	local bridge, problem = ensureBridge()
	if bridge == nil then
		return { success = false, error = problem, bridge = "missing" }
	end
	local payload = Instance.new("ModuleScript")
	payload.Name = "__SealCodeEvalPayload"
	payload.Archivable = false
	payload.Source = payloadSource(code)
	payload.Parent = bridge
	local ok, result = pcall(function()
		return bridge.Invoke:Invoke(payload)
	end)
	payload:Destroy()
	if not ok then
		return { success = false, error = tostring(result), bridge = "ok" }
	end
	if type(result) ~= "table" then
		return { success = true, bridge = "ok", returnValue = result }
	end
	return {
		success = result.ok == true,
		bridge = "ok",
		returnValue = result.result,
		error = if result.ok then nil else string.gsub(tostring(result.error), "user_code:", "line "),
		output = result.output or {},
	}
end

-- A bridge left in the edit DataModel (a crash mid-playtest) must not be saved with the place.
function Eval.cleanEdit()
	if not RunService:IsEdit() then
		return
	end
	local stale = game:GetService("ServerScriptService"):FindFirstChild(BRIDGE_NAME)
	if stale then
		stale:Destroy()
	end
end

return Eval
