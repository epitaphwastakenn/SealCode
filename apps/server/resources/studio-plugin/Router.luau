--!nocheck
-- Endpoint table and the plugin's own authority over what may run: the user's toggles are
-- enforced here, not on the server.

local Config = require(script.Parent.Config)
local Logs = require(script.Parent.Logs)
local State = require(script.Parent.State)
local Place = require(script.Parent.Handlers.Place)
local Instances = require(script.Parent.Handlers.Instances)
local Scripts = require(script.Parent.Handlers.Scripts)
local Luau = require(script.Parent.Handlers.Luau)
local Runtime = require(script.Parent.Handlers.Runtime)

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
	["get-script-source"] = Scripts.get,
	["set-script-source"] = Scripts.set,
	["edit-script"] = Scripts.edit,
	["grep-scripts"] = Scripts.grep,
	["execute-luau"] = Luau.execute,
	["start-playtest"] = Runtime.start,
	["stop-playtest"] = Runtime.endTest,
	["end-test"] = Runtime.endTest,
	["playtest-state"] = Runtime.state,
	["get-logs"] = Logs.read,
	["capture-screenshot"] = Runtime.capture,
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

function Router.storedResponse(id: string)
	return answered[id]
end

local function remember(id: string, response)
	answered[id] = response
	table.insert(answeredOrder, id)
	if #answeredOrder > 256 then
		answered[table.remove(answeredOrder, 1)] = nil
	end
end

local function refusal(endpoint: string)
	local toggles = State.currentToggles()
	if toggles.paused then
		return "The user paused the agent in Studio's SealCode panel. Ask them to resume it."
	end
	if MUTATING[endpoint] and toggles.readOnly then
		return "The user set Studio's SealCode panel to read-only, so changes are refused."
	end
	if endpoint == "execute-luau" and not toggles.allowLuau then
		return "The user turned off Luau execution in Studio's SealCode panel."
	end
	return nil
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
	}
	inFlight[id] = true
	State.inFlight += 1
	State.recordActivity(entry)
	task.spawn(function()
		local response
		local blocked = refusal(endpoint)
		local handler = ROUTES[endpoint]
		if blocked then
			response = { error = blocked, errorCode = "refused_in_studio" }
		elseif handler == nil then
			response = { error = "Unknown endpoint: " .. tostring(endpoint) }
		else
			-- One mutation at a time per DataModel; reads run alongside.
			if entry.mutating then
				while mutationBusy do
					task.wait()
				end
				mutationBusy = true
			end
			local ok, result = xpcall(handler, function(err)
				return debug.traceback(tostring(err), 2)
			end, type(message.data) == "table" and message.data or {})
			if entry.mutating then
				mutationBusy = false
			end
			if ok then
				response = if type(result) == "table" then result else { result = result }
			else
				response = { error = "The Studio plugin failed: " .. string.sub(tostring(result), 1, 1500) }
			end
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
