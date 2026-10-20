# Animation playbook (SealCode)

Written by SealCode from live research in Roblox Studio on 2026-10-20: toolbox animation models
were inserted and inspected, animations were played on R15 humanoids, a non-humanoid rig and
Motor6D props in a playtest, KeyframeSequences were built by code and by the bridge `animation`
tool, and every R15 joint axis was checked on screen. Items marked "verified" were seen working in
that session. Ranges and timings marked "guideline" are SealCode defaults, not measurements.

Load this file when you must play, find, make, publish, review or procedurally animate something.
The generic API notes (loading, priorities, blending, markers) are in `full.md` sections 1 to 3.

## 1. Pick the route

| Need                                                              | Route                                                                                    |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A standard humanoid emote, idle, walk, run, climb                 | Roblox's own animation ids (section 2). They play in every place                         |
| A custom attack, ability, interaction on a humanoid or custom rig | Build a KeyframeSequence (section 6), preview it, ask the user to publish it (section 4) |
| A prop: door, chest, lever, coin, pickup, platform, turret        | Procedural tween (section 7). No publishing, replicates cheaply                          |
| A non-humanoid creature or machine with Motor6Ds                  | AnimationController plus Animator and a KeyframeSequence (section 3), or procedural      |
| A third-party animation found in the toolbox                      | Probably will not play (section 2). Treat it as reference only                           |

## 2. Toolbox animations and the ownership caveat

Verified storage forms seen in inserted models:

| Form                                                                                                                                  | Example                                                                                                       | How to use it                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Animation` object with an `rbxassetid://` id                                                                                         | The `Animate` script's StringValue folders (idle, walk, run, jump, climb, dance...)                           | `Animator:LoadAnimation(anim)`                                                              |
| `KeyframeSequence` saved in the model (usually under an `AnimSaves` model or ObjectValue, from the Animation Editor or Moon Animator) | The rigged cat (KFS Walk, Jump, TailUp, TailDown) and the Doors figure rig (Idle, Run, Ponder, AlarmClock...) | `KeyframeSequenceProvider:RegisterKeyframeSequence(kfs)` returns a temporary id (section 3) |
| `Animation` objects pointing at other creators' ids                                                                                   | The sword tool's swing (14366772760), the Doors figure's attack ids                                           | They fail to load (see below)                                                               |
| `AnimationController` + `Animator` on a non-humanoid rig                                                                              | The cat                                                                                                       | `LoadAnimation` on that Animator                                                            |
| `Humanoid` + Motor6D rig                                                                                                              | R15 rigs, the TIO monster (36 Motor6D)                                                                        | Animator under the Humanoid                                                                 |
| `AnimationRigData` children                                                                                                           | 25 of them inside the Doors player model                                                                      | Editor metadata, ignore                                                                     |

Packs can be enormous: the "Doors ALL Animation" model has 27 Animation objects and 40
KeyframeSequences with 94,334 Poses (107,795 descendants). Insert it only to read, then delete it.

### Ownership: most ids will not play

Animation ids are gated by ownership. An experience can play an animation only if it was uploaded
by the experience's owner (the user, or the group for a group game) or by Roblox itself. Verified
in a playtest on an R15 rig:

| Id                                           | Source                               | Result                                        |
| -------------------------------------------- | ------------------------------------ | --------------------------------------------- |
| 507771019, 507770677, 3333331310, 4940564896 | Roblox emotes and default animations | `track.Length` 1.08, 2.5, 11.47, 4.0 s; plays |
| 14366772760                                  | third-party sword swing              | `Length = 0`, never poses the rig             |
| 18688009620                                  | Doors figure animation               | `Length = 0`, never poses the rig             |

The only signs of failure are a warning in the output and `Length == 0` (and `IsPlaying` still
reads `true`):

```
ContentId: rbxassetid://14366772760 failed due to: User is not authorized to access Asset.
```

The bridge `animation inspect` tool reports it too: "Roblox would not return animation ... It may
be private or owned by someone this place cannot read."

Check an id before trusting it (both verified):

```luau
local KSP = game:GetService("KeyframeSequenceProvider")
local CP = game:GetService("ContentProvider")

local function animationIsPlayable(id: string): boolean
	local ok = pcall(function() return KSP:GetKeyframeSequenceAsync(id) end)
	if not ok then return false end
	local anim = Instance.new("Animation")
	anim.AnimationId = id
	local status
	CP:PreloadAsync({anim}, function(_, s) status = s end)
	anim:Destroy()
	return status == Enum.AssetFetchStatus.Success
end
```

Rules:

- Never wire a toolbox animation id into gameplay without that check, and say in the answer when
  an id could not be verified.
- Roblox-owned ids (the default Animate script ids, official emotes) are safe. Prefer them for
  idle, walk, run, jump, fall, climb and standard emotes.
- When a model's `AnimSaves` holds KeyframeSequences, you can use those directly (section 3)
  without an owned asset id. They only exist for that session until the user publishes them.
- If the user needs a third-party animation in the game, they must re-upload it themselves under
  their own account or group (or get permission); an agent must not claim it will work.

## 3. Playing KeyframeSequences stored in a model

Verified on the non-humanoid cat and on the Doors figure (a Humanoid rig):

```luau
local KSP = game:GetService("KeyframeSequenceProvider")
local function playSaved(model: Model, controllerOrHumanoid: Instance, kfsName: string)
	local animator = controllerOrHumanoid:FindFirstChildOfClass("Animator") or Instance.new("Animator", controllerOrHumanoid)
	local kfs = model.AnimSaves:FindFirstChild(kfsName, true)
	local anim = Instance.new("Animation")
	anim.AnimationId = KSP:RegisterKeyframeSequence(kfs :: KeyframeSequence) -- hash id, no rbxassetid:// prefix
	local track = animator:LoadAnimation(anim)
	track.Looped = true
	track:Play()
	return track
end
```

- `RegisterKeyframeSequence` returned ids such as `0780890736255333d6703e3f35ff7207` (a hash). A
  track started from the playtest server showed the walking cat on the client too, and the client
  reported the same id in `GetPlayingAnimationTracks`. A sequence registered only on one client
  plays only for that client.
- The ids are valid only in the Studio session that created them. They are never a shippable
  value; see publishing (section 4).
- Rigs with `Motor6D` joints need an anchored root (`RootPart.Anchored = true`) and a floor. The
  cat's unanchored parts fell into the void and were destroyed when the playtest started, which
  looked like "the toolbox model is broken".
- Priorities of saved sequences vary (the cat is `Action`, the Doors idle is `Movement`); set
  `track.Priority` deliberately when you play more than one track.

## 4. Publishing: ask the user

A KeyframeSequence made by code or by the `animation create` tool is saved with the place, but
its temporary id works only in the current Studio session. A real animation id comes from
publishing. The agent cannot assume which way the user wants to do it, so it must ask once:

> I built the animation `SwingTest` as a KeyframeSequence under the rig. To use it in the game it
> has to be published as an animation asset. Do you want me to publish it through the Roblox
> Assistant, or will you publish it yourself from the Animation Editor?

- Roblox Assistant: use it only if the user says so, and have the user approve the creator
  (their account, or the group that owns the experience). Report the returned asset id.
- User publishes (not tested in this research; menu names can vary by Studio version): open the
  Animation Editor, select the rig, load or import the KeyframeSequence saved under it, open the
  editor's menu and choose Publish to Roblox, pick the same creator as the experience (user or
  group), copy the animation id from the dialog or from the asset page.
- Never ship an animation id the user did not publish. After the id arrives: put it in one
  ModuleScript (`Animations = { Swing = "rbxassetid://..." }`), check it with `animationIsPlayable`
  in a playtest, replace every temporary id, and delete the preview Animation objects.
- Until the user answers, keep working with the temporary id (it plays in Studio) and say so in
  the summary: "preview only, not published".

## 5. R15 joints and axes (verified)

Every R15 Motor6D has an identity `C0` rotation, so a joint's `Transform` (and a `Pose.CFrame`) is
expressed in the character's frame: X is the character's right, Y is up, Z is back. The character
faces -Z. Rotation follows the right-hand rule, and child joints inherit the parent's rotated
frame (raise the shoulder and the elbow's axes rotate with the arm). Verified on screen by posing
dummies one joint at a time.

What a positive rotation does:

| Axis | Upper body (Root, Waist, Neck)                | Limb that hangs down (shoulder, elbow, hip, knee, wrist, ankle)                                                                           |
| ---- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| +X   | leans or looks back; -X bows or looks down    | swings the limb forward and up (arm raise, forearm bend, thigh raise); at the knee -X folds the shin back; at the ankle +X lifts the toes |
| +Y   | turns to the character's left; -Y turns right | twists the limb about its length; on a raised arm it swings it sideways                                                                   |
| +Z   | tilts to the character's left                 | right limbs: moves the limb outward (arm raise sideways, leg abduction); left limbs: -Z is outward                                        |

Joint table. Parent is `Part0`, child `Part1`. Ranges are degrees of `Transform` offset from the
rest pose (guideline, from natural motion):

| Joint                 | Parent to child                | X                         | Y                | Z                                                    |
| --------------------- | ------------------------------ | ------------------------- | ---------------- | ---------------------------------------------------- |
| Root                  | HumanoidRootPart to LowerTorso | -15 to +10 (lean)         | +-25 (hip twist) | +-10 (sway). For bob use `position`, 0 to -0.3 studs |
| Waist                 | LowerTorso to UpperTorso       | -45 to +20                | +-45             | +-25                                                 |
| Neck                  | UpperTorso to Head             | -40 to +40                | +-70             | +-30                                                 |
| RightShoulder         | UpperTorso to RightUpperArm    | -60 to +180               | +-90             | -30 to +170                                          |
| LeftShoulder          | UpperTorso to LeftUpperArm     | -60 to +180               | +-90             | -170 to +30                                          |
| RightElbow, LeftElbow | UpperArm to LowerArm           | 0 to +145, never negative | +-20             | 0                                                    |
| RightWrist, LeftWrist | LowerArm to Hand               | -60 to +60                | +-45             | +-30                                                 |
| RightHip              | LowerTorso to RightUpperLeg    | -35 to +120               | +-30             | -10 to +45                                           |
| LeftHip               | LowerTorso to LeftUpperLeg     | -35 to +120               | +-30             | -45 to +10                                           |
| RightKnee, LeftKnee   | UpperLeg to LowerLeg           | -145 to 0, never positive | 0                | 0                                                    |
| RightAnkle, LeftAnkle | LowerLeg to Foot               | -45 to +25                | +-15             | +-15                                                 |

Seen on screen: RightShoulder `Z +90` raised the arm out to the character's right; RightShoulder
`X +90` raised it forward; RightElbow `X +90` bent the forearm forward; RightHip `X +60` with
RightKnee `X -90` lifted the thigh and tucked the shin back; Waist `X -45` bowed forward;
LeftShoulder `Z -90` raised the left arm sideways. The `animation` bridge tool uses the same
convention (its `rotation` is a degrees offset from the rest pose).

Pose names in a KeyframeSequence are the child part names (`RightUpperArm`, not `RightShoulder`),
nested along the rig: `HumanoidRootPart > LowerTorso > UpperTorso > RightUpperArm >
RightLowerArm > RightHand`. Intermediate poses you do not move have `Weight = 0`.

## 6. Making an animation by code

### A reusable R15 builder (verified)

```luau
local PARENT = {
	LowerTorso = "HumanoidRootPart", UpperTorso = "LowerTorso", Head = "UpperTorso",
	LeftUpperArm = "UpperTorso", LeftLowerArm = "LeftUpperArm", LeftHand = "LeftLowerArm",
	RightUpperArm = "UpperTorso", RightLowerArm = "RightUpperArm", RightHand = "RightLowerArm",
	LeftUpperLeg = "LowerTorso", LeftLowerLeg = "LeftUpperLeg", LeftFoot = "LeftLowerLeg",
	RightUpperLeg = "LowerTorso", RightLowerLeg = "RightUpperLeg", RightFoot = "RightLowerLeg",
}
local function deg(x, y, z) return CFrame.Angles(math.rad(x or 0), math.rad(y or 0), math.rad(z or 0)) end

local function build(name: string, looped: boolean, priority: Enum.AnimationPriority, frames)
	local kfs = Instance.new("KeyframeSequence")
	kfs.Name, kfs.Loop, kfs.Priority = name, looped, priority
	for _, f in frames do
		local kf = Instance.new("Keyframe")
		kf.Time = f.t
		local made = {}
		local function ensure(part: string): Pose
			if made[part] then return made[part] end
			local p = Instance.new("Pose")
			p.Name, p.Weight, p.CFrame = part, 0, CFrame.identity
			p.EasingStyle, p.EasingDirection = Enum.PoseEasingStyle.Cubic, Enum.PoseEasingDirection.InOut
			local par = PARENT[part]
			p.Parent = par and ensure(par) or kf
			made[part] = p
			return p
		end
		for part, cf in f.poses do
			local p = ensure(part)
			p.CFrame, p.Weight = cf, 1
		end
		for _, m in f.markers or {} do
			local mk = Instance.new("KeyframeMarker")
			mk.Name = m
			mk.Parent = kf
		end
		kf.Parent = kfs
	end
	return kfs
end
```

Wave, played and reviewed in a playtest (length 1.4 s, the marker fired at 0.61 s for a marker at
0.6 s, the arm rose to the right with a bent forearm):

```luau
local KSP = game:GetService("KeyframeSequenceProvider")
local wave = build("Wave", true, Enum.AnimationPriority.Action, {
	{t = 0,    poses = {}},
	{t = 0.35, poses = {RightUpperArm = deg(0, 0, 150), RightLowerArm = deg(30, 0, 0), UpperTorso = deg(0, 0, -4), Head = deg(0, -10, 0)}},
	{t = 0.6,  poses = {RightUpperArm = deg(0, 0, 150), RightLowerArm = deg(30, 0, -25), UpperTorso = deg(0, 0, -4)}, markers = {"Hello"}},
	{t = 0.85, poses = {RightUpperArm = deg(0, 0, 150), RightLowerArm = deg(30, 0, 25), UpperTorso = deg(0, 0, -4)}},
	{t = 1.1,  poses = {RightUpperArm = deg(0, 0, 150), RightLowerArm = deg(30, 0, -25), UpperTorso = deg(0, 0, -4)}},
	{t = 1.4,  poses = {}},
})
local anim = Instance.new("Animation")
anim.AnimationId = KSP:RegisterKeyframeSequence(wave)
local track = rig.Humanoid.Animator:LoadAnimation(anim)
track:GetMarkerReachedSignal("Hello"):Connect(function() print("hello at", track.TimePosition) end)
track.Looped = true
track:Play(0.2)
```

Put the KeyframeSequence under the rig (or `ServerStorage`) when you want it saved with the place
for publishing; a sequence that is only registered at runtime is lost when the playtest ends.

### The bridge `animation` tool (verified)

`node mcp.mjs list` shows `animation` when the bridge has it. Actions:

- `create`: `{ action: "create", rig: "game.Workspace.R15Test", name, looped, priority,
easingStyle, easingDirection, keyframes: [{ time, name?, markers?, poses: { Joint:
{ rotation: [x, y, z], position: [x, y, z] } } }] }`. A joint may be the Motor6D name
  (`RightShoulder`) or the part it moves (`RightUpperArm`). Rotations are degrees offset from the
  rest pose (section 5), positions are studs, times rise from 0. It returns the saved path, a
  `temporaryId`, `duration` and the joints touched. The default peer is edit; for a rig that exists
  only in a playtest (created by `eval_server_runtime`) pass `target: "server"`, otherwise it fails
  with "Instance not found".
- `play`: `{ action: "play", rig, animationId | sequence, speed?, weight?, fadeTime?, time? }`.
  During a playtest it plays on the server's Animator (reply `mode: "playtest"`, and clients see it).
  In edit mode (`mode: "edit-preview"`) it poses the rig at `time` and holds it, so you can frame
  it with `camera` and `capture_screenshot`, step through times, then `stop` to restore the rest
  pose. Playing a one-shot at `speed` 0.15 gives time to screenshot the pose you want.
- `list`: the tracks currently playing on the rig (animationId, timePosition, weight, speed).
- `stop`: `{ action: "stop", rig, all: true }`.
- `inspect`: duration, looped, priority, keyframes and joints of a KeyframeSequence path or a
  published id; it errors clearly for ids the place cannot read.

Verified sample (a 0.9 s swing, 4 keyframes): `Windup` at 0.25 s with RightShoulder `[-40, 0, 60]`,
RightElbow `[90, 0, 0]`, Waist `[0, -25, 0]`; `Hit` at 0.45 s (marker `Hit`) with RightShoulder
`[90, 0, 10]`, RightElbow `[10, 0, 0]`, Waist `[-10, 35, 0]`. The screenshot at the hit showed the
arm thrust forward with a torso bow and twist.

Review the first draft in a screenshot, then adjust the numbers and play again. The result is a
preview until the user publishes it.

## 7. Recipe: a hand-made animation

1. Decide the purpose, the priority and whether it loops before posing anything.
   - Priorities, low to high: `Core`, `Idle`, `Movement`, `Action`, `Action2`, `Action3`,
     `Action4`. Idle loops use `Idle`, walk and run use `Movement`, attacks, interactions and
     emotes use `Action` or higher. A higher priority overrides the lower one only on the joints it
     poses, so an upper-body attack that poses arms and waist leaves the legs walking.
2. Block the key poses at 0.05 s resolution (about 30 fps) with a neutral first keyframe.
   Pose only the joints that matter; leave the others out so lower priorities keep animating them.
3. Add anticipation: a short move in the opposite direction before the action, 15 to 25 percent of
   the total length, 10 to 25 degrees (guideline). The windup in the sample above is 0.25 of 0.9 s.
4. Make the action fast and the hold readable: strike in 0.1 to 0.2 s with `Cubic Out` or
   `Quad Out`, hold 2 to 4 frames at contact (this reads as weight), put a `KeyframeMarker` named
   `Hit` at contact and spawn the effect and damage window from `GetMarkerReachedSignal("Hit")`.
5. Add follow-through and overlap: forearm, hand, head and waist peak 2 to 4 frames after the
   shoulder, and settle with a small overshoot.
6. Recover slower than the strike (about 40 percent of the total length) and return to the neutral
   pose so the next animation blends cleanly.
7. Easing: `Cubic InOut` (the builder default) for most poses, `Linear` for cycles, `Constant` for
   snaps and stop-motion, `Back` or `Elastic` for a bounce on props, `Bounce` almost never on
   humanoids.
8. Loop: make the last keyframe equal the first and set `Loop = true`; check there is no pop at
   the seam. An idle should never be fully still: breathe in 3 s, `UpperTorso` X +-1.5, `Head` X
   the opposite by -1 offset 0.3 s later, shoulders Z +-2, root position +-0.04 studs, all `Cubic
InOut` (guideline).
9. Walk cycle starting points (guideline, 0.7 to 0.8 s loop): hips X +-30 opposite, knee -70 on
   the swing phase and about -15 on contact, arms X +-25 opposite to the legs with elbows +15 to
   +30, waist Y +-8 counter to the hips, root bob 0.12 studs twice per cycle, head level.
10. Play it with a fade: `Play(0.1)` for attacks, `0.2` for idles; change weapon speed with
    `AdjustSpeed`, not by retiming keyframes.
11. Preview it (section 6), review (section 9), then ask the user to publish (section 4).

Play the local player's character on the client for instant feedback; animations played on a
client-owned character replicate to the server. Server-driven NPCs play on the server.

## 8. Procedural animation

Use TweenService, `Heartbeat` or springs for props and secondary motion. No rig animation, no
publishing, and the property tweens replicate for free.

### Which property replicates (verified)

- Tweening `Motor6D.C0` on the server replicated: the client read the same final C0. This is the
  right way to open a door, raise a bridge or swing a lever for everyone.
- `Motor6D.Transform` set on the server did not replicate to the client (the client read the
  identity). Transform is for client-side cosmetic offsets (head look-at, recoil, lean) and is
  rewritten each frame by any playing track; layering it over a playing animation was not tested.
- A `Model` cannot be tweened directly. Tween a `CFrameValue` and `PivotTo` in `Changed` (verified:
  a two-part model moved up 5 studs).

### Hinged door with a Motor6D (verified; opened 100 degrees with `Back Out`)

```luau
local TweenService = game:GetService("TweenService")
local frame = Instance.new("Part") -- anchored post
frame.Name, frame.Anchored, frame.Size, frame.Position = "Frame", true, Vector3.new(0.6, 8, 0.6), Vector3.new(0, 4, 0)
local door = Instance.new("Part")
door.Name, door.Size, door.CanCollide, door.Massless = "Door", Vector3.new(4, 7, 0.4), false, true
local hinge = Instance.new("Motor6D")
hinge.Name, hinge.Part0, hinge.Part1 = "Hinge", frame, door
hinge.C0 = CFrame.new(0.3, -0.5, 0) -- hinge point on the frame
hinge.C1 = CFrame.new(-2, 0, 0)     -- same point on the door (its left edge)
hinge.Parent = frame
-- parent frame and door to a Model, then:
local closedC0 = hinge.C0
local function setOpen(open: boolean)
	TweenService:Create(hinge, TweenInfo.new(1.2, Enum.EasingStyle.Back, Enum.EasingDirection.Out),
		{C0 = open and closedC0 * CFrame.Angles(0, math.rad(-100), 0) or closedC0}):Play()
end
```

Set `CanCollide` on the door only while it is closed, or open it with a short tween so players are
not trapped. Hold the open or closed state on the server; trigger from a ProximityPrompt.

### Spinning and bobbing pickup

A cylinder's long axis is X, so a standing coin faces +-X and spins about Y with no extra rotation
(an extra 90 degree roll lays it flat, which is what the first test showed). Use one driver per
part: a single `Heartbeat` connection that writes the whole `CFrame`. (A `Sine InOut` tween with
`RepeatCount -1` and `Reverses true` also bobbed a coin by 1.2 studs in the playtest; use that
alone for pickups that do not spin, and do not let a tween and a `Heartbeat` write the same
`CFrame` in the same frame.)

```luau
local RunService = game:GetService("RunService")
type Pickup = {part: BasePart, base: CFrame, phase: number}
local pickups: {Pickup} = {}

local function register(part: BasePart)
	table.insert(pickups, {part = part, base = part.CFrame, phase = math.random() * math.pi * 2})
end

RunService.Heartbeat:Connect(function()
	local t = os.clock()
	for i = #pickups, 1, -1 do
		local p = pickups[i]
		if not p.part.Parent then
			table.remove(pickups, i)
		else
			local bob = math.sin(t * math.pi + p.phase) * 0.6 + 0.6 -- 0 to 1.2 studs
			p.part.CFrame = p.base * CFrame.new(0, bob, 0) * CFrame.Angles(0, t * 4 + p.phase, 0)
		end
	end
end)
```

Cosmetic loops belong in a client script; one shared connection serves dozens of pickups.

### Other recipes

- Collect: tween `Size` to 0 and lift 2 studs with `Back In` in 0.2 s, burst a hit effect, play a
  sound, then `Destroy`. Do the pickup gameplay on the server first.
- Platform or lift: tween an anchored part between waypoints on the server with `Quad InOut`;
  characters standing on anchored moving parts are carried by the engine, check it in a playtest.
- Lever, chest lid, drawbridge: Motor6D `C0` tween as above, with an `Elastic` or `Back` easing on
  the last 10 percent for weight.
- Rotating hazard: `RunService.Heartbeat` on the server, `CFrame` += small angle times `dt`; keep
  the angle small so the physics engine sees continuous motion.

### When each route is right

- Toolbox or Roblox-owned animation: standard humanoid motions where an owned id exists.
- Code or tool-built KeyframeSequence: custom attacks and emotes, non-humanoid rigs, quick
  previews; it needs the user to publish before it ships.
- Procedural: everything that is not a character pose. Cheaper, no assets, easy to retime.

## 9. Review checklist

Capture with `animation play` in edit-preview at several `time` values (or a playtest at low
`speed`), framed with `camera`, then check:

- Does the silhouette read at the camera distance of the game, including at the key poses?
- Is there anticipation, a clear action, a hold at contact, then follow-through and recovery?
- Does the weight feel right: heavy things anticipate longer and hold longer, light things snap?
- Are any joints bent the wrong way (a knee with positive X, an elbow with negative X, a shoulder
  Z with the wrong sign on the left side)?
- Do limbs clip into the torso or the floor at any key pose? Do the feet slide in a locomotion cycle?
- Does the loop have a seam pop, is the idle alive but subtle, and is the first pose the neutral one?
- Is the priority right: does it override only the joints it should, and does it blend back to
  idle on stop (`Play`/`Stop` fade times)?
- Is the `Hit` marker at the frame of contact, and are effect, sound and damage driven from it?
- Are all animation ids owned, verified with `animationIsPlayable`, and not temporary ids?
- Was the user asked how to publish, and is the answer in the summary (published, or preview only)?
- For procedural motion: does the server own the gameplay state, the client the cosmetic loop, and
  is every tween or connection cleaned up when its owner is destroyed?
