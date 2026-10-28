--!nocheck
-- Animations on a rig: read one, play it on the rig's Animator (in a playtest, or as a posed
-- preview in edit), and build a KeyframeSequence from a compact description.

local RunService = game:GetService("RunService")
local KeyframeSequenceProvider = game:GetService("KeyframeSequenceProvider")

local Util = require(script.Parent.Parent.Util)

local Animation = {}

local LOAD_SECONDS = 4
local MAX_KEYFRAMES_SHOWN = 16
local MAX_JOINTS_SHOWN = 30

-- Tracks this plugin started, per Animator, so stop can end exactly those.
local started: { [Animator]: { AnimationTrack } } = {}

local function resolve(value: any, label: string): (Instance?, string?)
	if type(value) ~= "string" or value == "" then
		return nil, label .. " is required"
	end
	if string.sub(value, 1, 3) == "ir:" then
		return Util.resolve({ instanceRef = value })
	end
	return Util.resolve({ path = value })
end

local function round(value: number): number
	return math.floor(value * 1000 + 0.5) / 1000
end

local function enumItem(enum, name: any, label: string)
	if name == nil then
		return nil, nil
	end
	local ok, item = pcall(function()
		return enum[tostring(name)]
	end)
	if not ok or typeof(item) ~= "EnumItem" then
		return nil, label .. " " .. tostring(name) .. " is not valid"
	end
	return item, nil
end

local function vector(value: any): Vector3?
	if type(value) == "table" then
		local x, y, z = tonumber(value.x or value[1]), tonumber(value.y or value[2]), tonumber(value.z or value[3])
		if x and y and z then
			return Vector3.new(x, y, z)
		end
	end
	return nil
end

-- A registered hash is a bare 32+ character hex string; assets are numbers or rbxassetid links.
local function contentId(value: any): (string?, string?)
	local text = tostring(value or "")
	if string.match(text, "^%d+$") then
		return "rbxassetid://" .. text, nil
	end
	if string.match(text, "^rbxassetid://%d+$") or string.match(text, "^%x+$") and #text >= 32 then
		return text, nil
	end
	return nil, "animationId must be a number, rbxassetid://<number>, or the temporary id animation create returned"
end

local function animatorOf(rig: Instance, create: boolean): (Animator?, string?)
	if rig:IsA("Animator") then
		return rig, nil
	end
	local controller = if rig:IsA("Humanoid") or rig:IsA("AnimationController")
		then rig
		else rig:FindFirstChildWhichIsA("Humanoid", true) or rig:FindFirstChildWhichIsA("AnimationController", true)
	if controller == nil then
		return nil, Util.pathOf(rig) .. " has no Humanoid or AnimationController, so nothing can play animations on it"
	end
	local animator = controller:FindFirstChildOfClass("Animator")
	if animator == nil and create then
		animator = Instance.new("Animator")
		animator.Parent = controller
	end
	if animator == nil then
		return nil, Util.pathOf(controller) .. " has no Animator"
	end
	return animator, nil
end

-- The KeyframeSequence behind `args.sequence` or `args.animationId`, and its content id.
local function sequenceOf(args): (KeyframeSequence?, string?, string?, boolean)
	if args.sequence ~= nil then
		local instance, problem = resolve(args.sequence, "sequence")
		if instance == nil then
			return nil, nil, problem, false
		end
		if not instance:IsA("KeyframeSequence") then
			return nil, nil, Util.pathOf(instance) .. " is a " .. instance.ClassName .. ", not a KeyframeSequence", false
		end
		local ok, id = pcall(function()
			return KeyframeSequenceProvider:RegisterKeyframeSequence(instance)
		end)
		if not ok then
			return nil, nil, "Could not register the KeyframeSequence: " .. tostring(id), false
		end
		return instance, id, nil, false
	end
	local id, problem = contentId(args.animationId)
	if id == nil then
		return nil, nil, if args.animationId == nil then "sequence or animationId is required" else problem, false
	end
	local ok, fetched = pcall(function()
		return KeyframeSequenceProvider:GetKeyframeSequenceAsync(id)
	end)
	if not ok or typeof(fetched) ~= "Instance" or not fetched:IsA("KeyframeSequence") then
		return nil, id, "Roblox would not return animation " .. id .. " (" .. tostring(fetched) .. "). It may be private or owned by someone this place cannot read.", false
	end
	-- The provider may hand every caller the same cached object, and destroying it would leave the
	-- next read empty, so work on a copy.
	return fetched:Clone(), id, nil, true
end

-- Facts about a sequence an agent can act on: length, flags, and which joints move.
local function summarize(sequence: KeyframeSequence)
	local frames = sequence:GetKeyframes()
	table.sort(frames, function(a, b)
		return a.Time < b.Time
	end)
	local joints: { [string]: { keyframes: number, rotation: number, offset: number } } = {}
	local poseCount, markerCount = 0, 0
	local listed = {}
	for _, frame in frames do
		local framePoses = 0
		local function visit(pose: Pose)
			poseCount += 1
			framePoses += 1
			if pose.Weight > 0 then
				local stat = joints[pose.Name]
				if stat == nil then
					stat = { keyframes = 0, rotation = 0, offset = 0 }
					joints[pose.Name] = stat
				end
				stat.keyframes += 1
				local rx, ry, rz = pose.CFrame:ToEulerAnglesXYZ()
				stat.rotation = math.max(stat.rotation, math.deg(math.max(math.abs(rx), math.abs(ry), math.abs(rz))))
				stat.offset = math.max(stat.offset, pose.CFrame.Position.Magnitude)
			end
			for _, child in pose:GetSubPoses() do
				visit(child)
			end
		end
		for _, pose in frame:GetPoses() do
			visit(pose)
		end
		local markers = {}
		pcall(function()
			for _, marker in frame:GetMarkers() do
				markerCount += 1
				table.insert(markers, marker.Name)
			end
		end)
		table.insert(listed, {
			time = round(frame.Time),
			name = if frame.Name ~= "Keyframe" then frame.Name else nil,
			poses = framePoses,
			markers = if #markers > 0 then markers else nil,
		})
	end
	-- A baked animation has a keyframe per frame; show the named ones and an even spread.
	if #listed > MAX_KEYFRAMES_SHOWN then
		local shown = {}
		for index, entry in listed do
			local stride = math.ceil(#listed / MAX_KEYFRAMES_SHOWN)
			if entry.name or entry.markers or (index - 1) % stride == 0 or index == #listed then
				table.insert(shown, entry)
			end
		end
		listed = shown
	end
	local names = {}
	for name in joints do
		table.insert(names, name)
	end
	table.sort(names, function(a, b)
		local sa, sb = joints[a], joints[b]
		if sa.rotation ~= sb.rotation then
			return sa.rotation > sb.rotation
		end
		return a < b
	end)
	local moving = {}
	for index, name in names do
		if index > MAX_JOINTS_SHOWN then
			break
		end
		local stat = joints[name]
		table.insert(moving, {
			name = name,
			keyframes = stat.keyframes,
			maxRotationDegrees = math.floor(stat.rotation * 10 + 0.5) / 10,
			maxOffsetStuds = round(stat.offset),
		})
	end
	return {
		duration = if #frames > 0 then round(frames[#frames].Time) else 0,
		looped = sequence.Loop,
		priority = sequence.Priority.Name,
		keyframeCount = #frames,
		poseCount = poseCount,
		markerCount = markerCount,
		jointCount = #names,
		joints = moving,
		jointsOmitted = if #names > #moving then #names - #moving else nil,
		keyframes = listed,
	}
end

local function describeTrack(track: AnimationTrack)
	local animation = track.Animation
	return {
		name = track.Name,
		animationId = if animation then animation.AnimationId else nil,
		length = round(track.Length),
		timePosition = round(track.TimePosition),
		speed = round(track.Speed),
		weight = round(track.WeightCurrent),
		priority = track.Priority.Name,
		looped = track.Looped,
		playing = track.IsPlaying,
	}
end

function Animation.inspect(args)
	local action = args.action
	if action == "list" then
		local rig, problem = resolve(args.rig, "rig")
		if rig == nil then
			return { error = problem }
		end
		local animator, why = animatorOf(rig, false)
		if animator == nil then
			return { error = why }
		end
		local tracks = {}
		for _, track in animator:GetPlayingAnimationTracks() do
			table.insert(tracks, describeTrack(track))
		end
		return {
			success = true,
			rig = Util.pathOf(rig),
			animator = Util.pathOf(animator),
			peerRunning = RunService:IsRunning(),
			playing = tracks,
			note = if #tracks == 0 then "Nothing is playing on this rig in this peer." else nil,
		}
	end

	local sequence, id, problem, temporary = sequenceOf(args)
	if sequence == nil then
		return { error = problem }
	end
	local summary = summarize(sequence)
	local path = if temporary then nil else Util.pathOf(sequence)
	local name = sequence.Name
	if temporary then
		sequence:Destroy()
	end
	summary.success = true
	summary.note = if summary.keyframeCount == 0
		then "Roblox returned no keyframes for this animation (it may be curve-based or unavailable to read here). animation play still loads it and reports its length."
		else nil
	summary.name = name
	summary.path = path
	summary.animationId = if args.sequence == nil then id else nil
	return summary
end

local function stopTracks(animator: Animator, all: boolean, fade: number)
	local stopped = 0
	local list = if all then animator:GetPlayingAnimationTracks() else started[animator] or {}
	for _, track in list do
		if track.IsPlaying then
			stopped += 1
			track:Stop(fade)
		end
	end
	started[animator] = nil
	return stopped
end

-- Edit mode has no animation clock: joints only move when the Animator is stepped.
local function resetPose(rig: Instance, animator: Animator)
	pcall(function()
		animator:StepAnimations(0)
	end)
	for _, descendant in rig:GetDescendants() do
		if descendant:IsA("Motor6D") and descendant.Transform ~= CFrame.identity then
			descendant.Transform = CFrame.identity
		end
	end
end

function Animation.play(args)
	local running = RunService:IsRunning()
	local rig, problem = resolve(args.rig, "rig")
	if rig == nil then
		return { error = problem }
	end
	local recording = if running then nil else Util.beginRecording("animation preview")
	local animator, why = animatorOf(rig, args.action ~= "stop")
	Util.finishRecording(recording, animator ~= nil)
	if animator == nil then
		return { error = why }
	end

	if args.action == "stop" then
		local stopped = stopTracks(animator, args.all == true, tonumber(args.fadeTime) or 0)
		if not running then
			resetPose(rig, animator)
		else
			-- A stopped track leaves the playing list on the next step.
			task.wait()
		end
		return {
			success = true,
			action = "stop",
			rig = Util.pathOf(rig),
			stopped = stopped,
			stillPlaying = #animator:GetPlayingAnimationTracks(),
			note = if stopped == 0 then "Nothing this tool started was playing; pass all=true to stop every track on the rig." else nil,
		}
	end

	local sequence, id, sequenceProblem, temporary = sequenceOf(args)
	if sequence == nil then
		return { error = sequenceProblem }
	end
	local summary = summarize(sequence)
	if temporary then
		sequence:Destroy()
	end

	-- A preview shows one animation at a time; a playtest layers them like a game would.
	if not running then
		stopTracks(animator, false, 0)
	end
	local animation = Instance.new("Animation")
	animation.Name = if args.sequence ~= nil then sequence.Name else "HarpPreview"
	animation.AnimationId = id
	local loaded, track = pcall(function()
		return animator:LoadAnimation(animation)
	end)
	if not loaded then
		return { error = "Studio could not load the animation: " .. tostring(track) }
	end
	if type(args.priority) == "string" then
		local priority = enumItem(Enum.AnimationPriority, args.priority, "priority")
		if priority == nil then
			return { error = "priority must be Core, Idle, Movement, Action, Action2, Action3 or Action4" }
		end
		track.Priority = priority
	end
	if type(args.looped) == "boolean" then
		track.Looped = args.looped
	end
	local speed = tonumber(args.speed) or 1
	track:Play(tonumber(args.fadeTime) or (if running then 0.1 else 0), tonumber(args.weight) or 1, speed)
	local deadline = os.clock() + LOAD_SECONDS
	while track.Length == 0 and os.clock() < deadline do
		task.wait(0.05)
	end
	if track.Length == 0 then
		track:Stop(0)
		return { error = "The animation never loaded. The id may be wrong, private, or not an animation." }
	end
	started[animator] = started[animator] or {}
	table.insert(started[animator], track)

	local at = math.clamp(tonumber(args.time) or 0, 0, track.Length)
	local result = {
		success = true,
		action = "play",
		mode = if running then "playtest" else "edit-preview",
		rig = Util.pathOf(rig),
		animator = Util.pathOf(animator),
		animationId = id,
		length = round(track.Length),
		looped = track.Looped,
		priority = track.Priority.Name,
		speed = round(speed),
		joints = summary.jointCount,
	}
	if running then
		if at > 0 then
			track.TimePosition = at
		end
		result.next = "It plays in this peer. Read it back with animation list, end it with animation stop, and check the result with a screenshot."
	else
		-- Posed at `time` and held: edit mode never advances it on its own.
		pcall(function()
			animator:StepAnimations(0)
			animator:StepAnimations(at)
		end)
		result.posedAt = round(at)
		result.next = "The rig is posed at that time and stays there. Frame it with camera and capture_screenshot, step through it with other time values, then animation stop to restore the rest pose."
	end
	return result
end

-- Joints a rig can animate: Motor6Ds, and AnimationConstraints on newer rigs.
local function jointsOf(rig: Instance)
	local joints = {}
	local byPart1: { [BasePart]: any } = {}
	for _, descendant in rig:GetDescendants() do
		local part0, part1
		if descendant:IsA("Motor6D") then
			part0, part1 = descendant.Part0, descendant.Part1
		elseif descendant:IsA("AnimationConstraint") then
			local a0, a1 = descendant.Attachment0, descendant.Attachment1
			part0, part1 = a0 and a0.Parent, a1 and a1.Parent
		end
		if part0 and part1 and part0:IsA("BasePart") and part1:IsA("BasePart") and byPart1[part1] == nil then
			local joint = { name = descendant.Name, part0 = part0, part1 = part1 }
			byPart1[part1] = joint
			table.insert(joints, joint)
		end
	end
	local rootPart = nil
	for _, joint in joints do
		if byPart1[joint.part0] == nil then
			if rootPart == nil or joint.part0.Name == "HumanoidRootPart" then
				rootPart = joint.part0
			end
		end
	end
	return joints, byPart1, rootPart
end

local function findJoint(joints, name: string)
	local lowered = string.lower(name)
	for _, joint in joints do
		if joint.name == name or joint.part1.Name == name then
			return joint
		end
	end
	for _, joint in joints do
		if string.lower(joint.name) == lowered or string.lower(joint.part1.Name) == lowered then
			return joint
		end
	end
	return nil
end

local function jointNames(joints): string
	local names = {}
	for index, joint in joints do
		if index > 40 then
			table.insert(names, "...")
			break
		end
		table.insert(names, if joint.name == joint.part1.Name then joint.name else joint.name .. " (" .. joint.part1.Name .. ")")
	end
	return table.concat(names, ", ")
end

function Animation.create(args)
	local rig, problem = resolve(args.rig, "rig")
	if rig == nil then
		return { error = problem }
	end
	local description = args.keyframes
	if type(description) ~= "table" or #description == 0 then
		return { error = "keyframes must be a non-empty array of { time, poses }" }
	end
	if #description > 200 then
		return { error = "At most 200 keyframes." }
	end
	local joints, byPart1, rootPart = jointsOf(rig)
	if rootPart == nil then
		return { error = Util.pathOf(rig) .. " has no Motor6D or AnimationConstraint joints to animate" }
	end

	local priority, priorityProblem = enumItem(Enum.AnimationPriority, args.priority or "Action", "priority")
	if priority == nil then
		return { error = priorityProblem }
	end
	local style, styleProblem = enumItem(Enum.PoseEasingStyle, args.easingStyle or "Linear", "easingStyle")
	if style == nil then
		return { error = styleProblem }
	end
	local direction, directionProblem = enumItem(Enum.PoseEasingDirection, args.easingDirection or "In", "easingDirection")
	if direction == nil then
		return { error = directionProblem }
	end

	-- Check everything before building anything, so a mistake leaves the place untouched.
	local frames = {}
	local previous = -1
	for index, entry in description do
		if type(entry) ~= "table" then
			return { error = "keyframes[" .. index .. "] must be an object" }
		end
		local time = tonumber(entry.time)
		if time == nil or time < 0 then
			return { error = "keyframes[" .. index .. "].time must be a number of seconds, 0 or more" }
		end
		if time <= previous then
			return { error = "keyframes[" .. index .. "].time must be later than the keyframe before it" }
		end
		previous = time
		local poses = {}
		if entry.poses ~= nil and type(entry.poses) ~= "table" then
			return { error = "keyframes[" .. index .. "].poses must be an object of joint name to { position, rotation }" }
		end
		for jointName, pose in entry.poses or {} do
			local joint = findJoint(joints, tostring(jointName))
			if joint == nil then
				return { error = "keyframes[" .. index .. "] names a joint this rig does not have: " .. tostring(jointName) .. ". Joints: " .. jointNames(joints) }
			end
			if type(pose) ~= "table" then
				return { error = "keyframes[" .. index .. "].poses." .. tostring(jointName) .. " must be { position?, rotation? }" }
			end
			local position = if pose.position ~= nil then vector(pose.position) else Vector3.zero
			local rotation = if pose.rotation ~= nil then vector(pose.rotation) else Vector3.zero
			if position == nil or rotation == nil then
				return { error = "keyframes[" .. index .. "].poses." .. tostring(jointName) .. ": position and rotation are [x, y, z] (rotation in degrees)" }
			end
			table.insert(poses, {
				joint = joint,
				cframe = CFrame.new(position) * CFrame.fromEulerAnglesXYZ(math.rad(rotation.X), math.rad(rotation.Y), math.rad(rotation.Z)),
			})
		end
		table.insert(frames, { time = time, name = entry.name, poses = poses, markers = entry.markers })
	end

	local parent: Instance = rig
	if args.parent ~= nil and args.parent ~= "rig" then
		local target, parentProblem = resolve(if args.parent == "ServerStorage" then "game.ServerStorage" else args.parent, "parent")
		if target == nil then
			return { error = parentProblem }
		end
		parent = target
	end
	local sequenceName = if type(args.name) == "string" and args.name ~= "" then args.name else "HarpAnimation"

	local recording = Util.beginRecording("create animation " .. sequenceName)
	local ok, built = pcall(function()
		local sequence = Instance.new("KeyframeSequence")
		sequence.Name = sequenceName
		sequence.Loop = args.looped == true
		sequence.Priority = priority

		local function addFrame(time: number, name: any, poses, markers)
			local frame = Instance.new("Keyframe")
			frame.Time = time
			if type(name) == "string" and name ~= "" then
				frame.Name = name
			end
			local made: { [BasePart]: Pose } = {}
			local function poseFor(part: BasePart, depth: number): Pose
				if made[part] then
					return made[part]
				end
				if depth > 64 then
					error("The rig's joints loop back on themselves")
				end
				local pose = Instance.new("Pose")
				pose.Name = part.Name
				pose.Weight = 0
				pose.EasingStyle = style
				pose.EasingDirection = direction
				local joint = byPart1[part]
				if part == rootPart or joint == nil then
					pose.Parent = frame
				else
					pose.Parent = poseFor(joint.part0, depth + 1)
				end
				made[part] = pose
				return pose
			end
			poseFor(rootPart, 0)
			for _, entry in poses do
				local pose = poseFor(entry.joint.part1, 0)
				pose.CFrame = entry.cframe
				pose.Weight = 1
			end
			if type(markers) == "table" then
				for _, marker in markers do
					if type(marker) == "string" and marker ~= "" then
						local keyMarker = Instance.new("KeyframeMarker")
						keyMarker.Name = marker
						keyMarker.Parent = frame
					end
				end
			end
			frame.Parent = sequence
		end

		-- Roblox expects a pose at time 0 to start from.
		local addedRest = frames[1].time > 0
		if addedRest then
			addFrame(0, nil, {}, nil)
		end
		for _, frame in frames do
			addFrame(frame.time, frame.name, frame.poses, frame.markers)
		end
		local existing = parent:FindFirstChild(sequenceName)
		if existing and existing:IsA("KeyframeSequence") then
			existing:Destroy()
		end
		sequence.Parent = parent
		return { sequence = sequence, addedRest = addedRest }
	end)
	if not ok then
		Util.finishRecording(recording, false)
		return { error = "Could not build the animation: " .. tostring(built) }
	end
	Util.finishRecording(recording, true)

	local sequence = built.sequence
	local registered, id = pcall(function()
		return KeyframeSequenceProvider:RegisterKeyframeSequence(sequence)
	end)
	local summary = summarize(sequence)
	return {
		success = true,
		path = Util.pathOf(sequence),
		instanceRef = Util.refOf(sequence),
		duration = summary.duration,
		looped = summary.looped,
		priority = summary.priority,
		keyframeCount = summary.keyframeCount,
		joints = summary.joints,
		addedRestKeyframe = built.addedRest or nil,
		temporaryId = if registered then id else nil,
		note = (if registered
			then "temporaryId plays in this Studio session only: put it, exactly as given, in Animation.AnimationId (no rbxassetid:// prefix), or play it with animation play. "
			else "Registering it failed (" .. tostring(id) .. "); animation play can still use the sequence path. ")
			.. "The KeyframeSequence itself is saved with the place, but a published animation id needs the user: open it in the Animation Editor and publish it, then use the id Roblox gives.",
	}
end

return Animation
