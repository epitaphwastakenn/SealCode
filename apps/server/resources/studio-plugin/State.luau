--!nocheck
-- What the panel shows, in one place: connection, peers, activity and the user's toggles.

local State = {}

local SETTINGS_PREFIX = "SealCodeStudio.v1."

State.plugin = nil
State.role = "edit"
State.connection = {
	phase = "idle", -- idle | connecting | retrying | connected | refused | duplicate
	failures = 0,
	detail = nil,
	lastError = nil,
	lastStatusCode = nil,
	retryAt = nil,
}
State.server = { build = nil, protocol = nil, agentLinked = false, agentActive = false, pluginUpdated = false, pluginOutdated = false }
State.peers = {}
State.instanceId = nil
State.placeName = nil
State.activity = {}
State.inFlight = 0
State.notice = nil
State.toggles = { paused = false, readOnly = false, allowLuau = true, disabledTools = {} }
State.transportLog = {}

local listeners = {}
State.onToggle = nil

function State.changed()
	for _, listener in listeners do
		task.spawn(listener)
	end
end

function State.onChanged(listener)
	table.insert(listeners, listener)
end

function State.getSetting(name: string)
	if State.plugin == nil then
		return nil
	end
	local ok, value = pcall(function()
		return State.plugin:GetSetting(SETTINGS_PREFIX .. name)
	end)
	return if ok then value else nil
end

function State.setSetting(name: string, value)
	if State.plugin == nil then
		return
	end
	pcall(function()
		State.plugin:SetSetting(SETTINGS_PREFIX .. name, value)
	end)
end

function State.loadToggles()
	local saved = State.getSetting("toggles")
	if type(saved) == "table" then
		local disabled = {}
		if type(saved.disabledTools) == "table" then
			for name, off in saved.disabledTools do
				if type(name) == "string" and off == true then
					disabled[name] = true
				end
			end
		end
		State.toggles = {
			paused = saved.paused == true,
			readOnly = saved.readOnly == true,
			allowLuau = saved.allowLuau ~= false,
			disabledTools = disabled,
		}
	end
end

function State.setToggle(name: string, value: boolean)
	State.toggles[name] = value
	State.setSetting("toggles", State.toggles)
	if State.onToggle then
		State.onToggle()
	end
	State.changed()
end

function State.setToolEnabled(name: string, enabled: boolean)
	local disabled = table.clone(State.toggles.disabledTools or {})
	disabled[name] = if enabled then nil else true
	State.setToggle("disabledTools", disabled)
end

function State.toolEnabled(name: string?): boolean
	return name == nil or not (State.currentToggles().disabledTools or {})[name]
end

-- Play DataModels read the toggles the user set in the edit window; settings are shared.
local lastToggleRead = 0
function State.currentToggles()
	if os.clock() - lastToggleRead > 1 then
		lastToggleRead = os.clock()
		State.loadToggles()
	end
	return State.toggles
end

function State.logTransport(text: string)
	table.insert(State.transportLog, os.date("%H:%M:%S") .. " " .. text)
	if #State.transportLog > 10 then
		table.remove(State.transportLog, 1)
	end
end

function State.recordActivity(entry)
	for i, existing in State.activity do
		if existing.id == entry.id then
			State.activity[i] = entry
			State.changed()
			return
		end
	end
	table.insert(State.activity, 1, entry)
	if #State.activity > 20 then
		table.remove(State.activity)
	end
	State.changed()
end

return State
