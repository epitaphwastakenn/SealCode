--!nocheck
-- The connection to SealCode: hello, then long-polls for work. A failed poll is the
-- disconnect signal; every answer is retried until the bridge acknowledges it.

local HttpService = game:GetService("HttpService")

local Config = require(script.Parent.Config)
local State = require(script.Parent.State)
local Router = require(script.Parent.Router)

local Transport = {}

local active = false
local generation = 0
local sessionToken = nil
local pendingResponses = {}
local identity = nil -- function returning the hello fields
local wakeRetry = nil
local onNotify = nil

local function post(route: string, body, timeoutHint: number?)
	local encoded
	local encodedOk, encodeError = pcall(function()
		encoded = HttpService:JSONEncode(body)
	end)
	if not encodedOk then
		return false, 0, nil, "could not encode request: " .. tostring(encodeError)
	end
	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = Config.baseUrl .. route,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				[Config.keyHeader] = Config.key,
			},
			Body = encoded,
		})
	end)
	if not ok then
		return false, 0, nil, tostring(response)
	end
	local decoded = nil
	if response.Body and response.Body ~= "" then
		pcall(function()
			decoded = HttpService:JSONDecode(response.Body)
		end)
	end
	return response.Success, response.StatusCode, decoded, if response.Success then nil else ("HTTP " .. tostring(response.StatusCode))
end

-- Turns a transport failure into words for the panel.
local function explain(err: string?, status: number?): string
	local text = tostring(err or "")
	if status == 426 then
		return "Restart Studio: the SealCode plugin was updated while Studio was open."
	elseif status == 401 then
		return "SealCode did not recognise this plugin's key. Restart Studio to load the plugin SealCode installed."
	elseif status == 409 then
		return "Another Studio window is linked for this place."
	elseif status and status >= 500 then
		return "SealCode's bridge reported an error."
	elseif string.find(text, "not enabled", 1, true) or string.find(text, "permission", 1, true) or string.find(text, "not allowed", 1, true) then
		return "Studio blocked the plugin's HTTP requests. Allow them in Plugins > Manage Plugins > SealCode > Allow HTTP Requests."
	elseif string.find(text, "ConnectFail", 1, true) or string.find(text, "refused", 1, true) or string.find(text, "Timedout", 1, true) then
		return "Nothing answered at " .. Config.baseUrl .. ". Open SealCode and set Roblox Studio to the SealCode bridge."
	end
	return text
end

local function setPhase(phase: string, detail: string?)
	State.connection.phase = phase
	State.connection.detail = detail
	State.changed()
end

local function sendResponse(id: string, response)
	pendingResponses[id] = response
	task.spawn(function()
		local delay = 0.5
		while pendingResponses[id] ~= nil do
			local ok, status, body = post("/studio/v1/response", { requestId = id, response = response })
			if ok and type(body) == "table" then
				if body.disposition == "unknown" then
					warn("[SealCode] The bridge no longer waited for a result (request " .. id .. "); it was dropped.")
				end
				pendingResponses[id] = nil
				break
			end
			if status == 413 then
				-- Too large ever to arrive: say so instead of retrying forever.
				response = { error = "The result was too large to send to SealCode." }
			end
			task.wait(delay)
			delay = math.min(delay * 2, 5)
		end
	end)
end

local function heldIds()
	local ids = Router.inFlightIds()
	for id in pendingResponses do
		table.insert(ids, id)
	end
	return ids
end

local function handle(message)
	if message.kind == "request" then
		Router.dispatch(message, sendResponse)
	elseif message.kind == "status" and type(message.status) == "table" then
		local status = message.status
		State.server.build = status.serverBuild
		State.server.protocol = status.protocol
		State.server.agentLinked = status.agentLinked == true
		State.server.agentActive = status.agentActive == true
		State.server.pluginUpdated = status.pluginUpdated == true
		State.server.pluginOutdated = status.pluginOutdated == true
		State.peers = if type(status.peers) == "table" then status.peers else {}
		State.changed()
	elseif message.kind == "notify" then
		if onNotify then
			onNotify(message)
		end
	end
end

local function hello()
	local fields = identity()
	local ok, status, body, err = post("/studio/v1/hello", fields)
	State.connection.lastStatusCode = status
	if ok and type(body) == "table" and body.success == true and type(body.sessionToken) == "string" then
		sessionToken = body.sessionToken
		State.instanceId = body.instanceId
		State.server.build = body.serverBuild
		State.server.protocol = body.protocol
		State.logTransport("hello ok as " .. tostring(body.assignedRole))
		return true, nil
	end
	local reason = if type(body) == "table" and type(body.message) == "string" then body.message else err
	State.logTransport("hello failed: " .. tostring(status) .. " " .. tostring(reason))
	return false, status, reason
end

local function loop(myGeneration: number)
	while active and generation == myGeneration do
		setPhase(if State.connection.failures > 5 then "retrying" else "connecting", nil)
		local ok, status, reason = hello()
		if not active or generation ~= myGeneration then
			break
		end
		if not ok then
			State.connection.failures += 1
			State.connection.lastError = string.sub(tostring(reason), 1, 300)
			local delay = math.min(0.5 * 2 ^ (State.connection.failures - 1), 5)
			if status == 426 or status == 401 then
				setPhase("refused", explain(reason, status))
				delay = 5
			elseif status == 409 then
				setPhase("duplicate", explain(reason, status))
				delay = 1
			else
				setPhase(if State.connection.failures > 5 then "retrying" else "connecting", explain(reason, status))
			end
			State.connection.retryAt = os.clock() + delay
			local waited = 0
			wakeRetry = false
			while waited < delay and active and not wakeRetry do
				task.wait(0.25)
				waited += 0.25
			end
			continue
		end
		State.connection.failures = 0
		State.connection.lastError = nil
		setPhase("connected", nil)
		-- Poll until the session ends.
		while active and generation == myGeneration do
			local pollOk, pollStatus, body, err = post("/studio/v1/poll", {
				sessionToken = sessionToken,
				inFlight = heldIds(),
				waitSeconds = Config.pollWaitSeconds,
				toggles = State.currentToggles(),
			})
			if not active or generation ~= myGeneration then
				break
			end
			if pollStatus == 404 then
				State.logTransport("bridge forgot this session; saying hello again")
				break
			end
			if not pollOk or type(body) ~= "table" then
				State.connection.failures += 1
				State.connection.lastError = string.sub(tostring(err), 1, 300)
				State.logTransport("poll failed: " .. tostring(err))
				setPhase("connecting", explain(err, pollStatus))
				task.wait(math.min(0.5 * 2 ^ (State.connection.failures - 1), 5))
				break
			end
			if State.connection.phase ~= "connected" then
				setPhase("connected", nil)
			end
			for _, message in body.messages or {} do
				handle(message)
			end
		end
	end
end

function Transport.configure(options)
	identity = options.identity
	onNotify = options.onNotify
end

function Transport.isActive(): boolean
	return active
end

function Transport.start()
	if active then
		return
	end
	active = true
	generation += 1
	State.connection.failures = 0
	task.spawn(loop, generation)
end

function Transport.stop()
	if not active then
		return
	end
	active = false
	generation += 1
	local token = sessionToken
	sessionToken = nil
	if token then
		task.spawn(post, "/studio/v1/bye", { sessionToken = token })
	end
	setPhase("idle", nil)
end

-- Re-announces the place after a rename or publish, keeping the same session.
function Transport.refreshIdentity()
	if active and sessionToken then
		task.spawn(hello)
	end
end

function Transport.retryNow()
	wakeRetry = true
end

-- Batched, rate-limited events; their text is data for SealCode, never instructions.
local eventQueue = {}
local droppedEvents = 0
function Transport.emit(event)
	if not active or sessionToken == nil then
		return
	end
	if #eventQueue >= 64 then
		table.remove(eventQueue, 1)
		droppedEvents += 1
	end
	table.insert(eventQueue, event)
end

task.spawn(function()
	while true do
		task.wait(1)
		if #eventQueue > 0 and sessionToken then
			local batch = eventQueue
			eventQueue = {}
			local dropped = droppedEvents
			droppedEvents = 0
			if dropped > 0 then
				table.insert(batch, { type = "peer_note", note = "dropped_events", count = dropped })
			end
			post("/studio/v1/events", { sessionToken = sessionToken, events = batch })
		end
	end
end)

function Transport.byeSync()
	if sessionToken then
		pcall(post, "/studio/v1/bye", { sessionToken = sessionToken })
	end
end

return Transport
