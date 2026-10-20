--!nocheck
-- Endpoint table and the plugin's own authority over what may run: the user's toggles are
-- enforced here, not on the server. Requests for a playtest client go through the broker.

local Config = require(script.Parent.Config)
local Logs = require(script.Parent.Logs)
local State = require(script.Parent.State)
local Broker = require(script.Parent.Broker)
local Place = require(script.Parent.Handlers.Place)
local Instances = require(script.Parent.Handlers.Instances)
local Scripts = require(script.Parent.Handlers.Scripts)
local Luau = require(script.Parent.Handlers.Luau)
local Runtime = require(script.Parent.Handlers.Runtime)
local Build = require(script.Parent.Handlers.Build)
local Eval = require(script.Parent.Handlers.Eval)
local Ui = require(script.Parent.Handlers.Ui)
local Input = require(script.Parent.Handlers.Input)
local Device = require(script.Parent.Handlers.Device)
local Camera = require(script.Parent.Handlers.Camera)
local Assets = require(script.Parent.Handlers.Assets)
local Mesh = require(script.Parent.Handlers.Mesh)

local Router = {}

local ROUTES = {
	["place-info"] = Place.info,
	["project-structure"] = Place.structure,
	["search-objects"] = Place.search,
	["selection"] = Place.selection,
	["get-properties"] = Instances.getProperties,
	["set-properties"] = Instances.setProperties,
	["create-instances"] = Instances.create,
	["delete-instances"] = Instances.delete,
	["build-instances"] = Build.run,
	["get-script-source"] = Scripts.get,
	["set-script-source"] = Scripts.set,
	["edit-script"] = Scripts.edit,
	["grep-scripts"] = Scripts.grep,
	["execute-luau"] = Luau.execute,
	["eval-runtime"] = Eval.run,
	["start-playtest"] = Runtime.start,
	["stop-playtest"] = Runtime.endTest,
	["end-test"] = Runtime.endTest,
	["playtest-state"] = Runtime.state,
	["multiplayer-start"] = Runtime.multiplayerStart,
	["multiplayer-state"] = Runtime.multiplayerState,
	["add-players"] = Runtime.addPlayers,
	["leave-test"] = Runtime.leaveTest,
	["get-logs"] = Logs.read,
	["capture-screenshot"] = Runtime.capture,
	["capture-begin"] = Runtime.captureBegin,
	["capture-read"] = Runtime.captureRead,
	["inspect-ui"] = Ui.inspect,
	["interact-ui"] = Ui.interact,
	["simulate-mouse-input"] = Input.mouse,
	["simulate-keyboard-input"] = Input.keyboard,
	["device-get"] = Device.get,
	["device-set"] = Device.set,
	["camera"] = Camera.run,
	["insert-asset"] = Assets.insert,
	["import-mesh"] = Mesh.import,
}

local MUTATING = {}
for _, name in Config.mutatingEndpoints do
	MUTATING[name] = true
end

-- Requests already running or recently answered are not run twice when redelivered.
local inFlight = {}
local answered = {}
local answeredOrder = {}
local mutationBusy = false

function Router.inFlightIds()
	local ids = {}
	for id in inFlight do
		table.insert(ids, id)
	end
	return ids
end

local function remember(id: string, response)
	answered[id] = response
	table.insert(answeredOrder, id)
	if #answeredOrder > 256 then
		answered[table.remove(answeredOrder, 1)] = nil
	end
end

local function refusal(endpoint: string, tool: string?)
	local toggles = State.currentToggles()
	if toggles.paused then
		return "The user paused the agent in Studio's SealCode panel. Ask them to resume it."
	end
	if not State.toolEnabled(tool) then
		return "The user turned off the " .. tostring(tool) .. " tool in Studio's SealCode panel. Work without it, or ask them to turn it back on."
	end
	if MUTATING[endpoint] and toggles.readOnly then
		return "The user set Studio's SealCode panel to read-only, so changes are refused."
	end
	if (endpoint == "execute-luau" or endpoint == "eval-runtime") and not toggles.allowLuau then
		return "The user turned off Luau execution in Studio's SealCode panel."
	end
	return nil
end

-- Runs one endpoint in this DataModel, with the toggles applied. Used by the client broker too.
function Router.runLocal(endpoint: string, data)
	local blocked = refusal(endpoint)
	if blocked then
		return { error = blocked, errorCode = "refused_in_studio" }
	end
	local handler = ROUTES[endpoint]
	if handler == nil then
		return { error = "Unknown endpoint: " .. tostring(endpoint) }
	end
	local mutating = MUTATING[endpoint] == true
	-- One mutation at a time per DataModel; reads run alongside.
	if mutating then
		while mutationBusy do
			task.wait()
		end
		mutationBusy = true
	end
	local ok, result = xpcall(handler, function(err)
		return debug.traceback(tostring(err), 2)
	end, if type(data) == "table" then data else {})
	if mutating then
		mutationBusy = false
	end
	if not ok then
		return { error = "The Studio plugin failed: " .. string.sub(tostring(result), 1, 1500) }
	end
	return if type(result) == "table" then result else { result = result }
end

-- Runs one request and hands its answer to `send` (which retries until the bridge has it).
function Router.dispatch(message, send: (string, any) -> ())
	local id = message.requestId
	if type(id) ~= "string" then
		return
	end
	if inFlight[id] then
		return
	end
	if answered[id] ~= nil then
		send(id, answered[id])
		return
	end
	local endpoint = message.endpoint
	local meta = type(message.meta) == "table" and message.meta or {}
	local entry = {
		id = id,
		tool = meta.tool or endpoint,
		summary = meta.summary,
		mutating = MUTATING[endpoint] == true,
		startedAt = os.clock(),
		time = os.date("%H:%M:%S"),
		state = "running",
		peer = if message.logicalId then "client" else nil,
	}
	inFlight[id] = true
	State.inFlight += 1
	State.recordActivity(entry)
	task.spawn(function()
		local response
		if type(message.logicalId) == "string" then
			local blocked = refusal(endpoint, meta.tool)
			response = if blocked
				then { error = blocked, errorCode = "refused_in_studio" }
				else Broker.forward(message.logicalId, endpoint, message.data)
		else
			local blocked = refusal(endpoint, meta.tool)
			response = if blocked
				then { error = blocked, errorCode = "refused_in_studio" }
				else Router.runLocal(endpoint, message.data)
		end
		entry.durationMs = math.floor((os.clock() - entry.startedAt) * 1000)
		entry.state = if response.error ~= nil or response.success == false then "error" else "ok"
		entry.error = if entry.state == "error" then string.sub(tostring(response.error or response.message), 1, 200) else nil
		State.recordActivity(entry)
		remember(id, response)
		State.inFlight -= 1
		send(id, response)
		inFlight[id] = nil
	end)
end

return Router
