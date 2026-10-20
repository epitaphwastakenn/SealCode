--!nocheck
-- What makes a place or a playtest heavy: script CPU time, memory by developer tag, and the
-- cost of the scene itself.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local Util = require(script.Parent.Parent.Util)

local Perf = {}

local function round(value: number, places: number?): number
	local scale = 10 ^ (places or 0)
	return math.floor(value * scale + 0.5) / scale
end

-- Script profiler ------------------------------------------------------------------------------

local NATIVE_FLAG, PLUGIN_FLAG = 1, 2

local function flagged(entry, flag: number): boolean
	return type(entry.Flags) == "number" and bit32.band(entry.Flags, flag) ~= 0
end

-- Installed plugins load from cloud_<id>, built-in ones from sabuiltin_, local ones from user_.
local function isPluginSource(source: string?): boolean
	return source ~= nil
		and (string.find(source, "^cloud_") ~= nil or string.find(source, "^sabuiltin_") ~= nil or string.find(source, "^user_") ~= nil or string.find(string.lower(source), "sealcode", 1, true) ~= nil)
end

local function lowerContains(text: any, needle: string): boolean
	return type(text) == "string" and string.find(string.lower(text), needle, 1, true) ~= nil
end

local function summarizeProfile(profile, args, durationMs: number)
	local functions = if type(profile.Functions) == "table" then profile.Functions else {}
	local filter = if type(args.filter) == "string" and args.filter ~= "" then string.lower(args.filter) else nil
	local includeNative = args.includeNative == true
	local includePlugins = args.includePlugins == true
	local limit = math.clamp(math.floor(tonumber(args.maxFunctions) or 20), 1, 100)
	local rows = {}
	local omitted = { native = 0, plugin = 0, filtered = 0 }
	for _, entry in functions do
		if type(entry) ~= "table" then
			continue
		end
		local source = if type(entry.Source) == "string" then entry.Source else nil
		if (flagged(entry, NATIVE_FLAG) or source == "[C]") and not includeNative then
			omitted.native += 1
		elseif not includePlugins and (flagged(entry, PLUGIN_FLAG) or isPluginSource(source)) then
			-- Studio plugins (this one included) run in the playtest's VM too; they are not the game's.
			omitted.plugin += 1
		elseif filter and not (lowerContains(entry.Name, filter) or lowerContains(source, filter)) then
			omitted.filtered += 1
		else
			table.insert(rows, entry)
		end
	end
	table.sort(rows, function(a, b)
		return (tonumber(a.TotalDuration) or 0) > (tonumber(b.TotalDuration) or 0)
	end)
	local captureUs = durationMs * 1000
	local top = {}
	for index = 1, math.min(limit, #rows) do
		local entry = rows[index]
		local microseconds = tonumber(entry.TotalDuration) or 0
		local name = if type(entry.Name) == "string" and entry.Name ~= "" then entry.Name else "<anonymous>"
		table.insert(top, {
			rank = index,
			name = name,
			script = if type(entry.Source) == "string" and entry.Source ~= "" then entry.Source else nil,
			line = if type(entry.Line) == "number" and entry.Line > 0 then entry.Line else nil,
			totalMicroseconds = round(microseconds),
			percentOfCapture = round(microseconds / captureUs * 100, 2),
			native = if flagged(entry, NATIVE_FLAG) then true else nil,
		})
	end
	return {
		success = true,
		durationMs = durationMs,
		functionsSeen = #functions,
		top = top,
		omitted = omitted,
		note = if #top == 0
			then "No game functions took measurable time: nothing ran in the game's scripts during the capture. Make the slow thing happen while it runs, or pass includeNative / includePlugins to see the rest."
			else nil,
	}
end

function Perf.profile(args)
	if not RunService:IsRunning() then
		return { error = "The script profiler needs a running playtest. Start one with playtest, then target server or client-N." }
	end
	local ok, service = pcall(function()
		return game:GetService("ScriptProfilerService")
	end)
	if not ok or service == nil then
		return { error = "ScriptProfilerService is not available in this Studio: " .. tostring(service) }
	end
	local durationMs = math.clamp(math.floor((tonumber(args.seconds) or 1) * 1000), 100, 15000)
	local frequency = math.clamp(math.floor(tonumber(args.frequency) or 1000), 1, 10000)
	local isServer = RunService:IsServer()
	local player = nil
	if not isServer then
		local waited = os.clock()
		player = Players.LocalPlayer
		while player == nil and os.clock() - waited < 5 do
			task.wait(0.05)
			player = Players.LocalPlayer
		end
		if player == nil then
			return { error = "This client has no LocalPlayer yet." }
		end
	end

	local json = nil
	local connection = service.OnNewData:Connect(function(_, data)
		if json == nil then
			json = data
		end
	end)
	local started, startError = pcall(function()
		if isServer then
			service:ServerStart(frequency)
		else
			service:ClientStart(player, frequency)
		end
	end)
	if not started then
		connection:Disconnect()
		return { error = "Could not start the profiler: " .. tostring(startError) }
	end
	task.wait(durationMs / 1000)
	local stopped, stopError = pcall(function()
		if isServer then
			service:ServerStop()
			service:ServerRequestData()
		else
			service:ClientStop(player)
			service:ClientRequestData(player)
		end
	end)
	if not stopped then
		connection:Disconnect()
		return { error = "Could not stop the profiler: " .. tostring(stopError) }
	end
	local waitedSince = os.clock()
	while json == nil and os.clock() - waitedSince < 8 do
		task.wait(0.05)
	end
	connection:Disconnect()
	if json == nil then
		return { error = "The profiler produced no data. Is the playtest still running?" }
	end
	local decoded, profile = pcall(function()
		return HttpService:JSONDecode(json)
	end)
	if not decoded or type(profile) ~= "table" then
		return { error = "The profiler data could not be read: " .. tostring(profile) }
	end
	local result = summarizeProfile(profile, args, durationMs)
	result.peer = if isServer then "server" else "client"
	result.frequency = frequency
	return result
end

-- Memory by developer tag ----------------------------------------------------------------------

function Perf.memory(args)
	local Stats = game:GetService("Stats")
	if not Stats.MemoryTrackingEnabled then
		return { error = "Memory tracking is off in this peer." }
	end
	local wanted = nil
	if type(args.tags) == "table" and #args.tags > 0 then
		wanted = {}
		for _, tag in args.tags do
			wanted[tostring(tag)] = true
		end
	end
	local tags = {}
	for _, item in Enum.DeveloperMemoryTag:GetEnumItems() do
		if wanted == nil or wanted[item.Name] then
			local ok, megabytes = pcall(function()
				return Stats:GetMemoryUsageMbForTag(item)
			end)
			if ok and megabytes > 0 then
				table.insert(tags, { tag = item.Name, megabytes = round(megabytes, 2) })
			end
			if wanted then
				wanted[item.Name] = nil
			end
		end
	end
	table.sort(tags, function(a, b)
		return a.megabytes > b.megabytes
	end)
	local unknown = {}
	if wanted then
		for tag in wanted do
			table.insert(unknown, tag)
		end
	end
	return {
		success = true,
		role = if not RunService:IsRunning() then "edit" elseif RunService:IsServer() then "server" else "client",
		totalMegabytes = round(Stats:GetTotalMemoryUsageMb(), 2),
		tags = tags,
		unknownTags = if #unknown > 0 then unknown else nil,
	}
end

-- Scene analysis -------------------------------------------------------------------------------

local function topEntries(counts: { [string]: number }, limit: number)
	local list = {}
	for name, count in counts do
		table.insert(list, { name = name, count = count })
	end
	table.sort(list, function(a, b)
		if a.count ~= b.count then
			return a.count > b.count
		end
		return a.name < b.name
	end)
	local out = {}
	for index = 1, math.min(limit, #list) do
		out[index] = list[index]
	end
	return out
end

local function renderedCost()
	local ok, tree = pcall(function()
		return game:GetService("SceneAnalysisService"):GetTriangleCompositionAsync()
	end)
	if not ok or type(tree) ~= "table" or type(tree.Sizes) ~= "table" then
		return nil
	end
	local categories = {}
	for _, child in tree.Children or {} do
		if type(child.Sizes) == "table" and (child.Sizes.Triangles or 0) > 0 then
			categories[child.Name] = child.Sizes.Triangles
		end
	end
	return { triangles = tree.Sizes.Triangles, drawCalls = tree.Sizes.Drawcalls, byCategory = categories }
end

function Perf.scene(args)
	local topN = math.clamp(math.floor(tonumber(args.topN) or 8), 1, 25)
	local root = nil
	if type(args.path) == "string" and args.path ~= "" then
		local found, problem = Util.resolve({ path = args.path })
		if found == nil then
			return { error = problem }
		end
		root = found
	end
	local roots = {}
	if root then
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

	local total = 0
	local byClass: { [string]: number } = {}
	local byService: { [string]: number } = {}
	local parts = { total = 0, anchored = 0, unanchored = 0, meshParts = 0, unions = 0, cannotCollide = 0, transparent = 0 }
	local scripts = { server = 0, client = 0, module = 0, disabled = 0, sourceKilobytes = 0 }
	local lights = { total = 0, shadowed = 0 }
	local emitters = { total = 0, enabled = 0, ratePerSecond = 0, estimatedLiveParticles = 0 }
	local other = { beams = 0, trails = 0, sounds = 0, decals = 0, humanoids = 0, constraints = 0, guiObjects = 0 }
	-- Each instance counts toward its nearest Model only, so models are not charged for their
	-- children's contents twice and the list names where the weight really sits.
	local owned: { [Instance]: { instances: number, parts: number, unanchored: number } } = {}
	local readSources = true
	local lastYield = os.clock()

	for _, base in roots do
		local count = 0
		local function visit(instance: Instance)
			count += 1
			total += 1
			byClass[instance.ClassName] = (byClass[instance.ClassName] or 0) + 1

			local isPart = instance:IsA("BasePart")
			local model = instance:FindFirstAncestorOfClass("Model")
			local entry = nil
			if model then
				entry = owned[model]
				if entry == nil then
					entry = { instances = 0, parts = 0, unanchored = 0 }
					owned[model] = entry
				end
				entry.instances += 1
			end

			if isPart then
				parts.total += 1
				if instance.Anchored then
					parts.anchored += 1
				else
					parts.unanchored += 1
				end
				if entry then
					entry.parts += 1
					if not instance.Anchored then
						entry.unanchored += 1
					end
				end
				if instance:IsA("MeshPart") then
					parts.meshParts += 1
				elseif instance:IsA("UnionOperation") then
					parts.unions += 1
				end
				if not instance.CanCollide then
					parts.cannotCollide += 1
				end
				if instance.Transparency >= 1 then
					parts.transparent += 1
				end
			elseif instance:IsA("LuaSourceContainer") then
				if instance:IsA("ModuleScript") then
					scripts.module += 1
				elseif instance:IsA("LocalScript") or (instance:IsA("Script") and instance.RunContext == Enum.RunContext.Client) then
					scripts.client += 1
				else
					scripts.server += 1
				end
				if instance:IsA("BaseScript") and not instance.Enabled then
					scripts.disabled += 1
				end
				if readSources then
					local ok, source = pcall(function()
						return instance.Source
					end)
					if ok then
						scripts.sourceKilobytes += #source / 1024
					end
					if total > 60000 then
						readSources = false
					end
				end
			elseif instance:IsA("Light") then
				lights.total += 1
				if instance.Shadows then
					lights.shadowed += 1
				end
			elseif instance:IsA("ParticleEmitter") then
				emitters.total += 1
				if instance.Enabled then
					emitters.enabled += 1
					emitters.ratePerSecond += instance.Rate
					emitters.estimatedLiveParticles += instance.Rate * (instance.Lifetime.Min + instance.Lifetime.Max) / 2
				end
			elseif instance:IsA("Beam") then
				other.beams += 1
			elseif instance:IsA("Trail") then
				other.trails += 1
			elseif instance:IsA("Sound") then
				other.sounds += 1
			elseif instance:IsA("Decal") then
				other.decals += 1
			elseif instance:IsA("Humanoid") then
				other.humanoids += 1
			elseif instance:IsA("Constraint") then
				other.constraints += 1
			elseif instance:IsA("GuiObject") then
				other.guiObjects += 1
			end
		end
		visit(base)
		for _, descendant in base:GetDescendants() do
			visit(descendant)
			if os.clock() - lastYield > 0.008 then
				task.wait()
				lastYield = os.clock()
			end
		end
		byService[base.Name] = count + (byService[base.Name] or 0)
	end

	local heaviest = {}
	for model, entry in owned do
		table.insert(heaviest, { model = model, entry = entry })
	end
	table.sort(heaviest, function(a, b)
		return a.entry.instances > b.entry.instances
	end)
	local largestModels = {}
	for index = 1, math.min(topN, #heaviest) do
		local item = heaviest[index]
		local descendants = #item.model:GetDescendants()
		table.insert(largestModels, {
			path = Util.pathOf(item.model),
			instances = descendants,
			ownInstances = item.entry.instances,
			parts = item.entry.parts,
			unanchoredParts = item.entry.unanchored,
		})
	end
	table.sort(largestModels, function(a, b)
		return a.ownInstances > b.ownInstances
	end)

	local unanchoredModels = {}
	for model, entry in owned do
		if entry.unanchored > 0 then
			table.insert(unanchoredModels, { path = Util.pathOf(model), unanchoredParts = entry.unanchored })
		end
	end
	table.sort(unanchoredModels, function(a, b)
		return a.unanchoredParts > b.unanchoredParts
	end)
	while #unanchoredModels > 5 do
		table.remove(unanchoredModels)
	end

	-- Plain-language pointers, only for what actually looks costly.
	local hints = {}
	if parts.unanchored > 300 then
		table.insert(hints, parts.unanchored .. " unanchored parts: each one is simulated by physics every frame. Anchor what never moves.")
	end
	if emitters.ratePerSecond > 2000 then
		table.insert(hints, "Enabled emitters spawn about " .. round(emitters.ratePerSecond) .. " particles per second; lower Rate or Lifetime on the heaviest.")
	end
	if lights.shadowed > 20 then
		table.insert(hints, lights.shadowed .. " lights cast shadows; turn Shadows off on the ones that do not need it.")
	end
	if parts.total > 30000 then
		table.insert(hints, parts.total .. " parts: consider StreamingEnabled, MeshPart merging or fewer decorative parts.")
	end
	if parts.transparent > 500 then
		table.insert(hints, parts.transparent .. " fully transparent parts still cost memory and replication.")
	end

	scripts.sourceKilobytes = round(scripts.sourceKilobytes, 1)
	emitters.ratePerSecond = round(emitters.ratePerSecond)
	emitters.estimatedLiveParticles = round(emitters.estimatedLiveParticles)
	return {
		success = true,
		scope = if root then Util.pathOf(root) else "the places agents work in",
		role = if not RunService:IsRunning() then "edit" elseif RunService:IsServer() then "server" else "client",
		instances = { total = total, byService = byService, topClasses = topEntries(byClass, 12) },
		parts = parts,
		scripts = scripts,
		lights = lights,
		particleEmitters = emitters,
		other = other,
		largestModels = largestModels,
		modelsWithMostUnanchoredParts = if #unanchoredModels > 0 then unanchoredModels else nil,
		rendered = renderedCost(),
		renderedNote = "rendered counts what this peer's camera draws right now, so frame the area you care about first (camera).",
		hints = if #hints > 0 then hints else nil,
	}
end

return Perf
