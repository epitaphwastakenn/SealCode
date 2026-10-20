--!nocheck
-- SealCode's Studio plugin. One copy runs in every DataModel Studio creates: the edit window
-- (with the panel), and the play server while a playtest runs. Client DataModels cannot make
-- HTTP requests and stay idle.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local Selection = game:GetService("Selection")

local root = script
local Config = require(root.Config)
local State = require(root.State)
local Logs = require(root.Logs)
local Util = require(root.Util)
local Transport = require(root.Transport)
local Place = require(root.Handlers.Place)
local Luau = require(root.Handlers.Luau)

State.plugin = plugin
Luau.plugin = plugin

local role
if RunService:IsEdit() then
	role = "edit"
elseif Players.LocalPlayer ~= nil then
	role = "client"
else
	role = "server"
end
State.role = role

if role == "client" then
	return
end

Logs.start()
State.loadToggles()

local pluginSessionId = HttpService:GenerateGUID(false)
local PLACE_ID_ATTRIBUTE = "SealCodePlaceId"

-- Published places are `place:<id>`; unsaved ones get a GUID kept on ServerStorage so it
-- travels with the file and into its playtests. Only the edit window ever creates one.
local function instanceId(): string
	if game.PlaceId ~= 0 then
		return "place:" .. tostring(game.PlaceId)
	end
	local storage = game:GetService("ServerStorage")
	local id = storage:GetAttribute(PLACE_ID_ATTRIBUTE)
	if type(id) ~= "string" and role == "edit" then
		id = string.lower(string.gsub(HttpService:GenerateGUID(false), "-", ""))
		pcall(function()
			storage:SetAttribute(PLACE_ID_ATTRIBUTE, id)
		end)
	end
	if type(id) ~= "string" then
		return "anon:unsaved-" .. pluginSessionId
	end
	return "anon:" .. id
end

local CAPABILITIES = { "events" }
local function probe(name: string, check: () -> boolean)
	local ok, result = pcall(check)
	if ok and result then
		table.insert(CAPABILITIES, name)
	end
end
probe("scriptEditor", function()
	return game:GetService("ScriptEditorService") ~= nil
end)
probe("loadstring", function()
	return loadstring ~= nil and loadstring("return 1") ~= nil
end)
probe("capture", function()
	return game:GetService("CaptureService") ~= nil
end)
probe("studioTest", function()
	return game:GetService("StudioTestService") ~= nil
end)
probe("reflection", function()
	return game:GetService("ReflectionService") ~= nil
end)

local function identity()
	State.placeName = Place.placeName()
	return {
		protocol = Config.protocol,
		build = Config.build,
		pluginSessionId = pluginSessionId,
		instanceId = instanceId(),
		role = role,
		placeId = game.PlaceId,
		gameId = game.GameId,
		placeName = State.placeName,
		dataModelName = game.Name,
		isRunning = RunService:IsRunning(),
		studioVersion = version(),
		capabilities = CAPABILITIES,
		toggles = State.currentToggles(),
	}
end

Transport.configure({
	identity = identity,
	onNotify = function(message)
		local text = "[SealCode] " .. tostring(message.title) .. (if message.body then ": " .. tostring(message.body) else "")
		if message.level == "error" or message.level == "warning" then
			warn(text)
		else
			print(text)
		end
		State.notice = tostring(message.title)
		State.changed()
		task.delay(15, function()
			if State.notice == tostring(message.title) then
				State.notice = nil
				State.changed()
			end
		end)
	end,
})

plugin.Unloading:Connect(function()
	Transport.byeSync()
end)

if role == "server" then
	-- No UI in a play DataModel: connect at once so the playtest's peer shows up.
	Transport.start()
	return
end

-- Edit window from here on.
local Panel = require(root.Panel)

local AUTO_CONNECT = "autoConnect"
local widget = Panel.create(plugin, {
	toggleConnection = function()
		if Transport.isActive() then
			Transport.stop()
			State.setSetting(AUTO_CONNECT, false)
		else
			State.setSetting(AUTO_CONNECT, true)
			Transport.start()
		end
		State.changed()
	end,
	retryNow = function()
		if not Transport.isActive() then
			Transport.start()
		else
			Transport.retryNow()
		end
	end,
	isActive = Transport.isActive,
})

task.delay(1, function()
	local ok, toolbar = pcall(function()
		return plugin:CreateToolbar(Config.productName)
	end)
	if not ok then
		return
	end
	local button = toolbar:CreateButton(
		"SealCodeStudioToggle",
		"Show the SealCode panel: connection, agent activity and safety toggles",
		"",
		Config.productName
	)
	button.ClickableWhenViewportHidden = true
	button.Click:Connect(function()
		widget.Enabled = not widget.Enabled
	end)
	widget:GetPropertyChangedSignal("Enabled"):Connect(function()
		button:SetActive(widget.Enabled)
	end)
end)

-- Say once in Output when the link fails, since the panel starts closed.
local warnedPhase = nil
State.onChanged(function()
	local phase = State.connection.phase
	if (phase == "refused" or (phase == "retrying" and State.connection.failures == 6)) and warnedPhase ~= phase then
		warnedPhase = phase
		warn("[SealCode] Studio is not linked to SealCode: " .. tostring(State.connection.detail) .. " (open the SealCode panel from the Plugins tab for details)")
	elseif phase == "connected" and warnedPhase ~= nil then
		warnedPhase = nil
		print("[SealCode] Studio is linked to SealCode.")
	end
end)

local autoConnect = State.getSetting(AUTO_CONNECT)
if autoConnect ~= false then
	task.delay(2, Transport.start)
end

-- Publishing or renaming the place changes its identity: tell the bridge.
local lastIdentity = nil
local function checkIdentity()
	local current = instanceId() .. "|" .. game.Name
	if lastIdentity ~= nil and current ~= lastIdentity then
		Transport.refreshIdentity()
	end
	lastIdentity = current
end
game:GetPropertyChangedSignal("PlaceId"):Connect(checkIdentity)
game:GetPropertyChangedSignal("Name"):Connect(checkIdentity)
task.spawn(function()
	while true do
		task.wait(2)
		checkIdentity()
	end
end)

-- Events for SealCode: the user's selection (debounced, compact) and new errors.
local selectionVersion = 0
Selection.SelectionChanged:Connect(function()
	selectionVersion += 1
	local mine = selectionVersion
	task.delay(0.3, function()
		if mine ~= selectionVersion then
			return
		end
		local selected = Selection:Get()
		local items = {}
		for i, instance in selected do
			if i > 20 then
				break
			end
			table.insert(items, { path = Util.pathOf(instance), className = instance.ClassName })
		end
		Transport.emit({ type = "selection_changed", count = #selected, items = items })
	end)
end)

local errorsThisSecond = 0
local errorWindow = 0
Logs.onEntry(function(entry)
	if entry.level ~= "ERR" or string.sub(entry.message, 1, 10) == "[SealCode]" then
		return
	end
	local now = os.clock()
	if now - errorWindow > 1 then
		errorWindow = now
		errorsThisSecond = 0
	end
	errorsThisSecond += 1
	if errorsThisSecond <= 10 then
		Transport.emit({ type = "log_error", message = string.sub(entry.message, 1, 2000), seq = entry.seq })
	end
end)

State.onToggle = function()
	Transport.emit({ type = "toggles_changed", toggles = State.toggles })
end
