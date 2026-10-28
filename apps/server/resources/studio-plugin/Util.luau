--!nocheck
-- Paths, instance handles, typed values and source revisions shared by every handler.

local HttpService = game:GetService("HttpService")

local Util = {}

local KEYWORDS = {
	["and"] = true, ["break"] = true, ["continue"] = true, ["do"] = true, ["else"] = true,
	["elseif"] = true, ["end"] = true, ["export"] = true, ["false"] = true, ["for"] = true,
	["function"] = true, ["if"] = true, ["in"] = true, ["local"] = true, ["nil"] = true,
	["not"] = true, ["or"] = true, ["repeat"] = true, ["return"] = true, ["then"] = true,
	["true"] = true, ["type"] = true, ["typeof"] = true, ["until"] = true, ["while"] = true,
}

-- Services an agent works in; whole-place walks stay inside them.
Util.ROOT_SERVICES = {
	"Workspace", "ReplicatedStorage", "ReplicatedFirst", "ServerScriptService", "ServerStorage",
	"StarterGui", "StarterPack", "StarterPlayer", "Lighting", "SoundService", "Teams",
	"TextChatService", "MaterialService", "Players",
}

local function segment(name: string): string
	if string.match(name, "^[%a_][%w_]*$") and not KEYWORDS[name] then
		return "." .. name
	end
	local escaped = string.gsub(name, '[\\"]', function(c) return "\\" .. c end)
	escaped = string.gsub(escaped, "\n", "\\n")
	return '["' .. escaped .. '"]'
end

function Util.pathOf(instance: Instance?): string?
	if instance == nil then
		return nil
	end
	if instance == game then
		return "game"
	end
	local parts = {}
	local current: Instance? = instance
	while current and current ~= game do
		table.insert(parts, 1, segment(current.Name))
		current = current.Parent
	end
	if current ~= game then
		return nil
	end
	return "game" .. table.concat(parts)
end

-- Splits `game.Workspace["My Part"].Child` into names; nil when malformed.
function Util.parsePath(path: string): { string }?
	local text = string.gsub(path, "^%s+", "")
	text = string.gsub(text, "%s+$", "")
	local names = {}
	local i = 1
	if string.sub(text, 1, 4) == "game" and (#text == 4 or string.match(string.sub(text, 5, 5), "[%.%[]")) then
		i = 5
	end
	local first = true
	while i <= #text do
		local c = string.sub(text, i, i)
		if c == "." then
			local name = string.match(text, "^[^%.%[]+", i + 1)
			if not name then
				return nil
			end
			table.insert(names, name)
			i += 1 + #name
		elseif c == "[" then
			local quote = string.sub(text, i + 1, i + 1)
			if quote ~= '"' and quote ~= "'" then
				return nil
			end
			local j = i + 2
			local buf = {}
			while j <= #text do
				local ch = string.sub(text, j, j)
				if ch == "\\" then
					local nxt = string.sub(text, j + 1, j + 1)
					table.insert(buf, nxt == "n" and "\n" or nxt)
					j += 2
				elseif ch == quote then
					break
				else
					table.insert(buf, ch)
					j += 1
				end
			end
			if string.sub(text, j, j + 1) ~= quote .. "]" then
				return nil
			end
			table.insert(names, table.concat(buf))
			i = j + 2
		elseif first then
			-- A bare leading segment, as in "Workspace.Part".
			local name = string.match(text, "^[^%.%[]+", i)
			if not name then
				return nil
			end
			table.insert(names, name)
			i += #name
		else
			return nil
		end
		first = false
	end
	return names
end

function Util.resolvePath(path: string): Instance?
	local names = Util.parsePath(path)
	if names == nil then
		return nil
	end
	local current: Instance = game
	for index, name in names do
		local nextInstance: Instance? = nil
		if index == 1 then
			local ok, service = pcall(function()
				return game:FindService(name)
			end)
			nextInstance = (ok and service) or game:FindFirstChild(name)
		elseif name == "LocalPlayer" and current:IsA("Players") then
			nextInstance = (current :: Players).LocalPlayer
		else
			nextInstance = current:FindFirstChild(name)
		end
		if nextInstance == nil then
			return nil
		end
		current = nextInstance
	end
	return current
end

-- Opaque handles that survive renames and reparenting for the life of this plugin VM.
local namespace = string.sub(string.gsub(HttpService:GenerateGUID(false), "-", ""), 1, 12)
local counter = 0
-- Strong tables: Roblox may hand out a fresh proxy for the same Instance, so weak keys would
-- forget handles that are still in use. Dead entries are pruned instead.
local refToInstance: { [string]: Instance } = {}
local instanceToRef: { [Instance]: string } = {}
local refCount = 0
local MAX_REFS = 20000

local function isLive(instance: Instance): boolean
	return instance == game or instance:IsDescendantOf(game)
end

local function prune()
	for ref, instance in refToInstance do
		if not isLive(instance) then
			refToInstance[ref] = nil
			instanceToRef[instance] = nil
			refCount -= 1
		end
	end
end

function Util.refOf(instance: Instance): string
	local existing = instanceToRef[instance]
	if existing then
		return existing
	end
	if refCount >= MAX_REFS then
		prune()
		if refCount >= MAX_REFS then
			refToInstance = {}
			instanceToRef = {}
			refCount = 0
		end
	end
	counter += 1
	refCount += 1
	local ref = "ir:" .. namespace .. ":" .. tostring(counter)
	instanceToRef[instance] = ref
	refToInstance[ref] = instance
	return ref
end

-- Resolves `{path, instanceRef}`; the ref wins. Returns the instance or an error text.
function Util.resolve(args: any): (Instance?, string?)
	local ref = args and args.instanceRef
	if type(ref) == "string" and ref ~= "" then
		local instance = refToInstance[ref]
		if instance == nil or not isLive(instance) then
			return nil, "Instance reference is invalid or no longer live: " .. ref
		end
		return instance, nil
	end
	local path = args and args.path
	if type(path) ~= "string" or path == "" then
		return nil, "path or instanceRef is required"
	end
	local instance = Util.resolvePath(path)
	if instance == nil then
		return nil, "Instance not found: " .. path
	end
	return instance, nil
end

-- Whether `instance` is the only child of its parent with its name.
function Util.isUniquePath(instance: Instance): boolean
	local parent = instance.Parent
	if parent == nil then
		return true
	end
	local count = 0
	for _, child in parent:GetChildren() do
		if child.Name == instance.Name then
			count += 1
			if count > 1 then
				return false
			end
		end
	end
	return true
end

function Util.describe(instance: Instance): { [string]: any }
	return {
		name = instance.Name,
		className = instance.ClassName,
		path = Util.pathOf(instance),
		instanceRef = Util.refOf(instance),
	}
end

-- Every instance under the agent-facing services (or under `root`), yielding as it goes so
-- large places do not freeze Studio.
function Util.walk(root: Instance?, visit: (Instance) -> boolean?)
	local roots: { Instance } = {}
	if root and root ~= game then
		table.insert(roots, root)
	else
		for _, name in Util.ROOT_SERVICES do
			local ok, service = pcall(function()
				return game:FindService(name)
			end)
			if ok and service then
				table.insert(roots, service)
			end
		end
	end
	local seen = 0
	local started = os.clock()
	for _, base in roots do
		local stop = visit(base)
		if stop then
			return
		end
		for _, instance in base:GetDescendants() do
			seen += 1
			if os.clock() - started > 0.008 then
				task.wait()
				started = os.clock()
			end
			if visit(instance) then
				return
			end
		end
	end
	return seen
end

local function round(value: number): number
	if value ~= value or value == math.huge or value == -math.huge then
		return value
	end
	return math.round(value * 10000) / 10000
end

-- Property values as JSON, in the same shapes `decode` accepts.
function Util.encode(value: any): any
	local kind = typeof(value)
	if kind == "number" then
		if value ~= value or value == math.huge or value == -math.huge then
			return tostring(value)
		end
		return value
	elseif kind == "string" or kind == "boolean" or kind == "nil" then
		return value
	elseif kind == "Vector3" then
		return { round(value.X), round(value.Y), round(value.Z) }
	elseif kind == "Vector2" then
		return { round(value.X), round(value.Y) }
	elseif kind == "Color3" then
		return { round(value.R), round(value.G), round(value.B) }
	elseif kind == "UDim2" then
		return { round(value.X.Scale), value.X.Offset, round(value.Y.Scale), value.Y.Offset }
	elseif kind == "UDim" then
		return { round(value.Scale), value.Offset }
	elseif kind == "CFrame" then
		local rx, ry, rz = value:ToEulerAnglesXYZ()
		return {
			position = { round(value.X), round(value.Y), round(value.Z) },
			rotation = { round(math.deg(rx)), round(math.deg(ry)), round(math.deg(rz)) },
		}
	elseif kind == "EnumItem" then
		return value.Name
	elseif kind == "BrickColor" then
		return value.Name
	elseif kind == "Instance" then
		return Util.pathOf(value)
	elseif kind == "NumberRange" then
		return { round(value.Min), round(value.Max) }
	elseif kind == "Rect" then
		return { round(value.Min.X), round(value.Min.Y), round(value.Max.X), round(value.Max.Y) }
	elseif kind == "NumberSequence" then
		local points = {}
		for _, point in value.Keypoints do
			table.insert(points, { time = round(point.Time), value = round(point.Value), envelope = round(point.Envelope) })
		end
		return points
	elseif kind == "ColorSequence" then
		local points = {}
		for _, point in value.Keypoints do
			table.insert(points, { time = round(point.Time), value = { round(point.Value.R), round(point.Value.G), round(point.Value.B) } })
		end
		return points
	elseif kind == "Font" then
		return { family = value.Family, weight = value.Weight.Name, style = value.Style.Name }
	end
	return tostring(value)
end

local function numbers(value: any, count: number): { number }?
	if type(value) ~= "table" then
		return nil
	end
	local out = {}
	for i = 1, count do
		local n = value[i]
		if type(n) ~= "number" or n ~= n then
			return nil
		end
		out[i] = n
	end
	return out
end

local function vector3(value: any): Vector3?
	local list = numbers(value, 3)
	if list then
		return Vector3.new(list[1], list[2], list[3])
	end
	if type(value) == "table" then
		local x, y, z = value.X or value.x, value.Y or value.y, value.Z or value.z
		if type(x) == "number" and type(y) == "number" and type(z) == "number" then
			return Vector3.new(x, y, z)
		end
	end
	return nil
end

local function color3(value: any): (Color3?, string?)
	local list = numbers(value, 3)
	if list == nil and type(value) == "table" then
		local r, g, b = value.R or value.r, value.G or value.g, value.B or value.b
		if type(r) == "number" and type(g) == "number" and type(b) == "number" then
			list = { r, g, b }
		end
	end
	if list == nil then
		if type(value) == "string" and string.match(value, "^#%x%x%x%x%x%x$") then
			return Color3.fromHex(value), nil
		end
		return nil, nil
	end
	for _, n in list do
		if n < 0 or n > 1 + 1e-6 then
			return nil, "Color3 components are numbers from 0 to 1; divide 0-255 values by 255"
		end
	end
	return Color3.new(list[1], list[2], list[3]), nil
end

local function cframe(value: any): CFrame?
	local list = numbers(value, 12)
	if list then
		return CFrame.new(table.unpack(list))
	end
	if type(value) == "table" then
		local position = vector3(value.position or value.Position)
		if position then
			local rotation = vector3(value.rotation or value.Rotation) or Vector3.zero
			return CFrame.new(position)
				* CFrame.fromEulerAnglesXYZ(math.rad(rotation.X), math.rad(rotation.Y), math.rad(rotation.Z))
		end
	end
	return nil
end

-- Converts JSON to the type the property currently holds. Returns (value, error).
function Util.decode(value: any, current: any, propertyName: string?): (any, string?)
	local kind = typeof(current)
	if value == nil then
		return nil, nil
	end
	if kind == "Vector3" then
		local v = vector3(value)
		return v, if v then nil else "expected [x, y, z]"
	elseif kind == "Vector2" then
		local list = numbers(value, 2)
		if list then
			return Vector2.new(list[1], list[2]), nil
		end
		if type(value) == "table" and type(value.X) == "number" and type(value.Y) == "number" then
			return Vector2.new(value.X, value.Y), nil
		end
		return nil, "expected [x, y]"
	elseif kind == "Color3" then
		local c, problem = color3(value)
		return c, problem or (if c then nil else "expected [r, g, b] from 0 to 1")
	elseif kind == "UDim2" then
		local list = numbers(value, 4)
		if list then
			return UDim2.new(list[1], list[2], list[3], list[4]), nil
		end
		if type(value) == "table" and type(value.X) == "table" and type(value.Y) == "table" then
			return UDim2.new(value.X.Scale or 0, value.X.Offset or 0, value.Y.Scale or 0, value.Y.Offset or 0), nil
		end
		return nil, "expected [xScale, xOffset, yScale, yOffset]"
	elseif kind == "UDim" then
		local list = numbers(value, 2)
		return if list then UDim.new(list[1], list[2]) else nil, if list then nil else "expected [scale, offset]"
	elseif kind == "CFrame" then
		local c = cframe(value)
		return c, if c then nil else "expected {position: [x,y,z], rotation: [x,y,z] degrees}"
	elseif kind == "EnumItem" then
		local enumType = (current :: EnumItem).EnumType
		if type(value) == "string" then
			local name = string.match(value, "([%w_]+)$") or value
			for _, item in enumType:GetEnumItems() do
				if item.Name == name then
					return item, nil
				end
			end
		elseif type(value) == "number" then
			for _, item in enumType:GetEnumItems() do
				if item.Value == value then
					return item, nil
				end
			end
		end
		return nil, "not an item of Enum." .. tostring(enumType)
	elseif kind == "BrickColor" then
		if type(value) == "string" or type(value) == "number" then
			return BrickColor.new(value :: any), nil
		end
		return nil, "expected a BrickColor name"
	elseif kind == "NumberRange" then
		if type(value) == "number" then
			return NumberRange.new(value), nil
		end
		local list = numbers(value, 2)
		return if list then NumberRange.new(list[1], list[2]) else nil, if list then nil else "expected [min, max]"
	elseif kind == "NumberSequence" then
		if type(value) == "number" then
			return NumberSequence.new(value), nil
		end
		if type(value) == "table" then
			local points = {}
			for _, point in value do
				if type(point) ~= "table" or type(point.time) ~= "number" or type(point.value) ~= "number" then
					return nil, "expected [{time, value, envelope?}]"
				end
				table.insert(points, NumberSequenceKeypoint.new(point.time, point.value, point.envelope or 0))
			end
			local ok, sequence = pcall(NumberSequence.new, points)
			return if ok then sequence else nil, if ok then nil else tostring(sequence)
		end
		return nil, "expected a number or keypoints"
	elseif kind == "ColorSequence" then
		local constant = color3(value)
		if constant then
			return ColorSequence.new(constant), nil
		end
		if type(value) == "table" then
			local points = {}
			for _, point in value do
				local c, problem = color3(type(point) == "table" and point.value or nil)
				if type(point) ~= "table" or type(point.time) ~= "number" or c == nil then
					return nil, problem or "expected [{time, value: [r,g,b]}]"
				end
				table.insert(points, ColorSequenceKeypoint.new(point.time, c))
			end
			local ok, sequence = pcall(ColorSequence.new, points)
			return if ok then sequence else nil, if ok then nil else tostring(sequence)
		end
		return nil, "expected [r,g,b] or keypoints"
	elseif kind == "Rect" then
		local list = numbers(value, 4)
		return if list then Rect.new(list[1], list[2], list[3], list[4]) else nil, if list then nil else "expected [minX, minY, maxX, maxY]"
	elseif kind == "boolean" then
		if type(value) == "boolean" then
			return value, nil
		end
		if value == "true" or value == "false" then
			return value == "true", nil
		end
		return nil, "expected true or false"
	elseif kind == "number" then
		local n = if type(value) == "number" then value else tonumber(value)
		return n, if n then nil else "expected a number"
	elseif kind == "string" then
		if type(value) == "string" or type(value) == "number" then
			return tostring(value), nil
		end
		return nil, "expected a string"
	elseif kind == "Content" then
		if type(value) == "string" then
			return Content.fromUri(value), nil
		end
		return nil, "expected an asset URI string"
	elseif kind == "Instance" or kind == "nil" then
		if type(value) == "string" then
			local target = Util.resolvePath(value)
			if target == nil then
				return nil, "no instance at " .. value
			end
			return target, nil
		end
		if kind == "nil" and propertyName ~= "Parent" then
			return value, nil
		end
		return nil, "expected an instance path"
	end
	return value, nil
end

local function close(a: number, b: number, tolerance: number): boolean
	return math.abs(a - b) <= tolerance * math.max(1, math.abs(a), math.abs(b))
end

-- Whether a read-back value matches what was written (Color storage quantises to 8 bits).
function Util.same(a: any, b: any): boolean
	local kind = typeof(a)
	if kind ~= typeof(b) then
		return false
	end
	if kind == "number" then
		return close(a, b, 1e-6)
	elseif kind == "Vector3" then
		return close(a.X, b.X, 1e-5) and close(a.Y, b.Y, 1e-5) and close(a.Z, b.Z, 1e-5)
	elseif kind == "Vector2" then
		return close(a.X, b.X, 1e-5) and close(a.Y, b.Y, 1e-5)
	elseif kind == "Color3" then
		return math.abs(a.R - b.R) <= 1 / 255 + 1e-6 and math.abs(a.G - b.G) <= 1 / 255 + 1e-6 and math.abs(a.B - b.B) <= 1 / 255 + 1e-6
	elseif kind == "CFrame" then
		local ac, bc = { a:GetComponents() }, { b:GetComponents() }
		for i = 1, 12 do
			if not close(ac[i], bc[i], 1e-4) then
				return false
			end
		end
		return true
	elseif kind == "UDim2" then
		return close(a.X.Scale, b.X.Scale, 1e-5) and a.X.Offset == b.X.Offset and close(a.Y.Scale, b.Y.Scale, 1e-5) and a.Y.Offset == b.Y.Offset
	elseif kind == "NumberSequence" or kind == "ColorSequence" then
		return #a.Keypoints == #b.Keypoints
	end
	return a == b
end

-- `r1:<bytes>:<16 hex>` from two independent 32-bit hashes of the exact text: a cheap,
-- deterministic change detector, not a security measure.
function Util.revision(text: string): string
	local data = buffer.fromstring(text)
	local length = buffer.len(data)
	local fnv = 2166136261
	local djb = 5381
	for i = 0, length - 1 do
		local byte = buffer.readu8(data, i)
		fnv = bit32.bxor(fnv, byte)
		-- fnv * 16777619 without losing precision: 16777619 = 2^24 + 403.
		fnv = (bit32.lshift(fnv, 24) + fnv * 403) % 4294967296
		djb = bit32.bxor((djb * 33) % 4294967296, byte)
	end
	return string.format("r1:%d:%08x%08x", length, fnv, djb)
end

-- JSON for any Luau value, falling back to text where JSON has no equivalent.
function Util.jsonSafe(value: any, depth: number?): any
	local level = depth or 0
	local kind = typeof(value)
	if kind == "table" then
		if level > 6 then
			return "<table>"
		end
		local out = {}
		local count = 0
		for key, entry in value do
			count += 1
			if count > 500 then
				break
			end
			out[if type(key) == "number" then key else tostring(key)] = Util.jsonSafe(entry, level + 1)
		end
		return out
	elseif kind == "function" or kind == "thread" or kind == "userdata" or kind == "buffer" then
		return tostring(value)
	end
	return Util.encode(value)
end

-- Makes arbitrary bytes safe to JSON-encode: invalid UTF-8 becomes \xNN.
function Util.safeText(text: string): string
	if utf8.len(text) ~= nil then
		return text
	end
	return (string.gsub(text, "[\128-\255]", function(c)
		return string.format("\\x%02X", string.byte(c))
	end))
end

local ChangeHistoryService = game:GetService("ChangeHistoryService")

-- One undo step per agent operation; nil when Studio cannot record (play DataModels).
function Util.beginRecording(name: string): string?
	local ok, id = pcall(function()
		return ChangeHistoryService:TryBeginRecording("Harp: " .. name)
	end)
	return if ok then id else nil
end

function Util.finishRecording(id: string?, commit: boolean)
	if id == nil then
		return
	end
	pcall(function()
		ChangeHistoryService:FinishRecording(
			id,
			if commit then Enum.FinishRecordingOperation.Commit else Enum.FinishRecordingOperation.Cancel
		)
	end)
end

-- Attribute values travel as plain JSON, or {type, value} for Roblox types.
function Util.decodeAttribute(value: any, current: any): (any, string?)
	if value == nil then
		return nil, nil
	end
	if current ~= nil then
		return Util.decode(value, current, nil)
	end
	local kind = type(value)
	if kind == "number" or kind == "string" or kind == "boolean" then
		return value, nil
	end
	if kind == "table" and type(value.type) == "string" then
		local samples = {
			Vector3 = Vector3.zero, Vector2 = Vector2.zero, Color3 = Color3.new(), UDim2 = UDim2.new(),
			UDim = UDim.new(), CFrame = CFrame.identity, BrickColor = BrickColor.new("White"),
			NumberRange = NumberRange.new(0), Rect = Rect.new(0, 0, 0, 0),
		}
		local sample = samples[value.type]
		if sample == nil then
			return nil, "unsupported attribute type " .. value.type
		end
		return Util.decode(value.value, sample, nil)
	end
	return nil, "expected a number, string, boolean or {type, value}"
end

return Util
