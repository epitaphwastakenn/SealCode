--!nocheck
-- Playtest clients cannot make HTTP requests, so the play server registers one logical session
-- per player with the bridge and relays requests to the player's client over a RemoteEvent.
-- Every relay has a deadline: a frozen or departed client answers "client_unresponsive" instead
-- of holding the request until the bridge gives up.

local Lifetime = require(script.Parent.Lifetime)
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Broker = {}

local BROKER_NAME = "__SealCodeBroker"
local DEFAULT_TIMEOUT = 25

-- Endpoints a client DataModel serves. One table for both sides of the relay.
Broker.CLIENT_ENDPOINTS = {
	["place-info"] = true,
	["execute-luau"] = true,
	["eval-runtime"] = true,
	["get-logs"] = true,
	["capture-begin"] = true,
	["inspect-ui"] = true,
	["interact-ui"] = true,
	["simulate-mouse-input"] = true,
	["simulate-keyboard-input"] = true,
	["device-get"] = true,
	["device-set"] = true,
	["leave-test"] = true,
	["animation-inspect"] = true,
	["animation-play"] = true,
	["script-profiler"] = true,
	["memory-breakdown"] = true,
	["scene-analysis"] = true,
	["network-profile"] = true,
}

-- Server side ---------------------------------------------------------------------------------

local remote = nil
local logicalByPlayer = {} -- Player -> logical id
local playerByLogical = {} -- logical id -> Player
local waiting = {} -- relay id -> { done, response }

function Broker.startServer(options)
	-- options.register(logicalId, player) -> boolean, options.unregister(logicalId)
	local existing = ReplicatedStorage:FindFirstChild(BROKER_NAME)
	if existing and existing:IsA("RemoteEvent") then
		remote = existing
	else
		remote = Instance.new("RemoteEvent")
		remote.Name = BROKER_NAME
		remote.Archivable = false
		remote.Parent = ReplicatedStorage
	end
	Lifetime.connect(remote.OnServerEvent, function(player, relayId, response)
		local entry = waiting[relayId]
		if entry and entry.player == player then
			entry.response = response
			entry.done = true
		end
	end)

	local function add(player)
		if logicalByPlayer[player] then
			return
		end
		local id = HttpService:GenerateGUID(false)
		logicalByPlayer[player] = id
		playerByLogical[id] = player
		task.spawn(function()
			local delay = 0.5
			while logicalByPlayer[player] == id do
				if options.register(id, player) then
					return
				end
				task.wait(delay)
				delay = math.min(delay * 2, 5)
			end
		end)
	end
	local function remove(player)
		local id = logicalByPlayer[player]
		if id == nil then
			return
		end
		logicalByPlayer[player] = nil
		playerByLogical[id] = nil
		task.spawn(options.unregister, id)
	end
	Lifetime.connect(Players.PlayerAdded, add)
	Lifetime.connect(Players.PlayerRemoving, remove)
	for _, player in Players:GetPlayers() do
		add(player)
	end
end

-- After the server peer registers again (bridge restart), every player registers again.
function Broker.reregisterAll(register)
	for player, id in logicalByPlayer do
		task.spawn(register, id, player)
	end
end

function Broker.forward(logicalId: string, endpoint: string, data)
	if not Broker.CLIENT_ENDPOINTS[endpoint] then
		local allowed = {}
		for name in Broker.CLIENT_ENDPOINTS do
			table.insert(allowed, name)
		end
		table.sort(allowed)
		return { error = "Playtest clients do not serve " .. tostring(endpoint) .. ". They serve: " .. table.concat(allowed, ", ") }
	end
	local player = playerByLogical[logicalId]
	if player == nil or player.Parent == nil or remote == nil then
		return { error = "That playtest client has left.", errorCode = "client_gone" }
	end
	local relayId = HttpService:GenerateGUID(false)
	local entry = { player = player, done = false, response = nil }
	waiting[relayId] = entry
	local timeout = math.clamp(tonumber(type(data) == "table" and data.__timeout) or DEFAULT_TIMEOUT, 1, 120)
	remote:FireClient(player, relayId, endpoint, data)
	local deadline = os.clock() + timeout
	while not entry.done and os.clock() < deadline and player.Parent ~= nil do
		task.wait(0.05)
	end
	waiting[relayId] = nil
	if entry.done then
		return if type(entry.response) == "table" then entry.response else { result = entry.response }
	end
	return {
		error = "The playtest client did not answer in time; it may be frozen or leaving.",
		errorCode = "client_unresponsive",
	}
end

-- Client side ---------------------------------------------------------------------------------

function Broker.startClient(handle: (string, any) -> any)
	task.spawn(function()
		local event = ReplicatedStorage:WaitForChild(BROKER_NAME, math.huge)
		if not event:IsA("RemoteEvent") then
			return
		end
		Lifetime.connect(event.OnClientEvent, function(relayId, endpoint, data)
			task.spawn(function()
				local response
				if not Broker.CLIENT_ENDPOINTS[endpoint] then
					response = { error = "Playtest clients do not serve " .. tostring(endpoint) }
				else
					local ok, result = pcall(handle, endpoint, if type(data) == "table" then data else {})
					response = if ok then result else { error = "The Studio plugin failed in the client: " .. tostring(result) }
				end
				event:FireServer(relayId, response)
			end)
		end)
	end)
end

return Broker
