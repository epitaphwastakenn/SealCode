--!nocheck
-- A ring buffer of this DataModel's output, filled from load so a later read sees what ran.

local LogService = game:GetService("LogService")

local Util = require(script.Parent.Util)

local MAX_TEXT_BYTES = 64 * 1024
local MAX_ENTRIES = 5000
local MAX_MESSAGE = 4000

local Logs = {}

local entries = {}
local head = 1
local textBytes = 0
local seq = 0
local dropped = 0
local listeners = {}

local LEVELS = {
	[Enum.MessageType.MessageOutput] = "OUT",
	[Enum.MessageType.MessageInfo] = "INFO",
	[Enum.MessageType.MessageWarning] = "WARN",
	[Enum.MessageType.MessageError] = "ERR",
}

local function push(message: string, level: string, ts: number)
	if #message > MAX_MESSAGE then
		message = string.sub(message, 1, MAX_MESSAGE) .. "…"
	end
	message = Util.safeText(message)
	seq += 1
	local entry = { seq = seq, ts = ts, level = level, message = message }
	table.insert(entries, entry)
	textBytes += #message
	while (#entries - head + 1) > MAX_ENTRIES or textBytes > MAX_TEXT_BYTES do
		local old = entries[head]
		entries[head] = nil
		head += 1
		textBytes -= #old.message
		dropped += 1
	end
	-- Compact occasionally so the array does not grow without bound.
	if head > 2048 then
		local fresh = {}
		for i = head, #entries do
			table.insert(fresh, entries[i])
		end
		entries = fresh
		head = 1
	end
	for _, listener in listeners do
		task.spawn(listener, entry)
	end
end

function Logs.start()
	local ok, history = pcall(function()
		return LogService:GetLogHistory()
	end)
	if ok and type(history) == "table" then
		local first = math.max(1, #history - 500)
		for i = first, #history do
			local item = history[i]
			push(tostring(item.message), LEVELS[item.messageType] or "OUT", tonumber(item.timestamp) or os.time())
		end
	end
	require(script.Parent.Lifetime).connect(LogService.MessageOut, function(message, messageType)
		push(message, LEVELS[messageType] or "OUT", DateTime.now().UnixTimestampMillis / 1000)
	end)
end

function Logs.onEntry(listener)
	table.insert(listeners, listener)
end

function Logs.read(args)
	local since = tonumber(args.since) or 0
	local tail = math.clamp(tonumber(args.tail) or 200, 1, 2000)
	local filter = type(args.filter) == "string" and args.filter ~= "" and args.filter or nil
	local levels = nil
	if type(args.levels) == "table" and #args.levels > 0 then
		levels = {}
		for _, level in args.levels do
			levels[level] = true
		end
	end
	local matched = {}
	for i = head, #entries do
		local entry = entries[i]
		if entry.seq > since
			and (levels == nil or levels[entry.level])
			and (filter == nil or string.find(entry.message, filter, 1, true))
		then
			table.insert(matched, entry)
		end
	end
	local first = math.max(1, #matched - tail + 1)
	local out = {}
	for i = first, #matched do
		table.insert(out, matched[i])
	end
	return { entries = out, nextSince = seq, totalDropped = dropped }
end

return Logs
