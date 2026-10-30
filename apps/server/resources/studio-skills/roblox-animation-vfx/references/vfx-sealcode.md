# VFX playbook (Harp)

Written by Harp from live research in Roblox Studio on 2026-10-20: 20 Creator Store VFX packs
were inserted, dumped property by property and rendered, and a from-scratch effect was built and
reviewed in a playtest. Everything marked "verified" was seen working in Studio in that session.
Numbers marked "guideline" are Harp defaults, not benchmarks.

Sections 13 to 21, and lines tagged "verified 2026-10-29" elsewhere, come from a second session on
2026-10-28/29: the ability effects of six character kits in a production game were reworked with
the Harp Studio tools, and the user approved the results. They were verified in Studio in that game
unless marked "guideline". Where the two sessions disagreed, the older line was rewritten.

Load this file when you must build, adapt, trigger or review a visual effect. The generic API notes
are in `full.md` (section 4 onward); this file is the practical layer on top of it.

## 1. Pick the route first

Read the taste defaults (section 13) before the first build: they decided more than any number in
this file. When the look of an ability is open, do not build one effect; prototype variants and let
the user pick (section 14).

| Situation                                                                                             | Route                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A standard effect (explosion, hit, slash, heal, aura, lightning, portal) and the look is not critical | Adapt a toolbox pack (section 6). It is faster and usually looks better than a first from-scratch try                                                                         |
| The effect needs your own colours, timing or a gameplay-driven shape                                  | Adapt a pack, then re-time and re-colour it                                                                                                                                   |
| Nothing fits, or the pack is far too heavy (the 356-emitter "Light Explosion" pack)                   | Build it from scratch with the verified textures in sections 8 and 21                                                                                                         |
| A game's ability whose look is open, or "make it cooler"                                              | Prototype the current effect plus 3 variants side by side; the user picks per ability (section 14)                                                                            |
| Big expanding shapes (dome, shockwave cone, lightning column)                                         | Particles and beams first: a flat ring at the gameplay radius, a lightning beam (sections 3 and 4). Neon/ForceField MeshParts (section 9) only as an option the user confirms |

Always check a pack before use: dump its emitters (section 6), read its scripts (they arrive
disabled from `insert_asset`; most packs have none), and play it once. A pack is only a candidate
until you have seen it render.

## 2. How a good effect is layered

Every effect that read as professional in the packs had most of these layers. A single emitter
never looks good.

The values below are pack numbers, for reference. For a game's own abilities start smaller: 3 or 4
layers per burst at Brightness 1 to 2 and small sizes, then grow only when the user asks (verified
2026-10-29: a first pass with 25 emitters at Brightness 3 to 5 was called "over the top").

| Layer              | Job                                                                | Typical values (verified in packs unless noted)                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core flash         | The first frame the player reads. Brief, brightest thing on screen | 1 particle, Lifetime 0.15 to 0.4, Size 10 to 25 studs growing then shrinking, soft round texture, LightEmission 1, Brightness 10 to 50, ZOffset 3                                                                                                                                      |
| Glare / star       | Anime or magic sparkle on top of the flash                         | 4-point star texture, Lifetime 0.25 to 0.4, rotating, ZOffset 2                                                                                                                                                                                                                        |
| Main body          | The shape of the effect: fireball, slash crescent, aura            | Flipbook (Grid4x4 or Grid8x8, OneShot) with Lifetime = animation length (0.4 to 0.8 s), or 3 to 6 soft puffs. LightEmission 0.3 to 1, ZOffset 1                                                                                                                                        |
| Sparks and streaks | Energy and direction                                               | Rate 0, Emit 20 to 40, Speed 30 to 75, Drag 3 to 12, Acceleration (0,-30..-60,0), Lifetime 0.3 to 1.1, `Orientation = VelocityParallel`, Squash -2 to -0.5 (stretch), Size 0.5 to 1.3 shrinking to 0, LightEmission 1                                                                  |
| Debris / specks    | Scale and chaos                                                    | tiny dot textures, Emit 20 to 50, Speed 15 to 30, Acceleration down, Lifetime 0.8 to 2.5                                                                                                                                                                                               |
| Smoke              | Weight and aftermath. Slow, dark, last                             | Lifetime 2 to 4, Size 4 growing to 13 or more, Transparency 1 to 0.3 to 1, LightEmission 0, Speed 4 to 16 with Drag 1.5 to 2.5, upward Acceleration 5 to 9, rotating. LightInfluence 0: lit smoke turned black in a dark map (verified 2026-10-29; see "Smoke and steam" in section 3) |
| Shockwave ring     | Reads the radius and impact point                                  | Ring sprite lying flat (`Orientation = VelocityPerpendicular`, `EmissionDirection = Top`, Speed 0.01 to 0.5 with zero Acceleration so it follows the attachment's tilt, verified 2026-10-29), Size 2 growing to 30+, Lifetime 0.35 to 0.5, Transparency 0.1 to 1                       |
| Light flash        | Lights the surroundings                                            | One PointLight, Brightness 6 to 8, Range 20 to 30, tweened to 0 in 0.35 to 0.5 s. `Shadows = false`                                                                                                                                                                                    |
| Sound              | Half of the impact                                                 | Short transient plus a tail. See `roblox-audio`. Sound asset ids are ownership-gated like animations: preload and test them                                                                                                                                                            |
| Camera shake       | Weight, client only                                                | Humanoid.CameraOffset decaying noise, 0.4 to 0.7 studs, 0.4 to 0.6 s (verified, section 5)                                                                                                                                                                                             |

Timing curve to aim for (explosion, 3 s total, taken from the "Boom" model of the Explosions pack):
glow and shockwave 0 to 0.375 s, glare 0 to 0.25 s, orange body 0 to 0.625 s, sparks 0 to 1.5 s,
smoke 0 to 2.9 s. Fast things first, slow things last, everything fading by transparency.

Stylised anime effects invert that: every layer is very short (0.1 to 0.2 s) and `TimeScale`
0.6 to 0.9, Brightness is huge (10 to 100) to bloom, and some layers use negative LightEmission to
draw dark smoky shapes on top of bright ones (see "Properties worth knowing").

## 3. Concrete recipes by effect type

Values are starting points taken from packs that rendered well; lines marked (guideline) are
Harp defaults that were not taken from a pack. Scale Size, Speed and Acceleration together
(section 6) for bigger or smaller versions.

### Explosion

- Realistic (sparks, smoke, orange, glow, shockwave, glare; 6 emitters, 3 s): use the layer table
  above. Orange body: texture 1084987899 or 7130084926, Color ff4b00, Drag 7.5, Speed -64..64,
  Lifetime 0.625, Size 0 to 6.5 to 5. Glow: 8120666025, Size 10 to 0, Lifetime 0.375, Brightness 50.
- Flipbook fireball: Lifetime 0.5, Speed 20, Drag 5, Size 10.7 to 12.7, Transparency 0 until 0.7
  then to 1, 4x4 fire flipbook (11395090403/11395089850/11395118687) at FlipbookFramerate 30,
  3 copies with different Rotation. Add dark smoke 2 to 4 s, Size 13 to 27, Specks Brightness up to 500.
- Stylised: 20 to 25 emitters, each `EmitCount = 1`, Lifetime 0.02 to 0.17, Speed up to 845 with
  Squash for streaks, Brightness 10 to 100, TimeScale 0.6 to 0.9 (the "FinalExplosion" model).

### Fire (looping)

- Torch or campfire: Rate 30, Lifetime 1, Speed 1, SpreadAngle 20, Size 0 to 0.9 to 1 to 0 (peak at
  9 percent), LightEmission 0.4, Acceleration (0,3,0), Drag 3, RotSpeed -50..50,
  `Orientation = VelocityParallel`, a spark emitter next to it (Rate 50, tiny, Acceleration up),
  one PointLight Range 14 colour ff5500. Flicker the light with a slow noise tween, never a
  `wait(0.001)` loop (the popular "Fire particles" pack does that; do not copy it).
- Large flames: flipbook sprites (16850891267 or 13847476967) rather than 20 puffs.
- Burning character: one emitter per limb at Rate 15 to 30, LockedToPart true (Dogmath pack).

### Magic aura and charge

- Aura: 3 emitters on the torso, steady, Enabled true while active: upward streaks (Lifetime 0.2 to
  0.3, Acceleration (0,375..475,0), Drag 10, `VelocityInheritance 1`, `TimeScale 0.5`, colour ramp
  ff470a to ffac05 to ffc439, Brightness 10), a back glow (Speed about 0.1, ZOffset -2), and ground
  sparks. Colours as ColorSequence so the whole aura recolours with one call.
- Charge-up: `EmitDuration` 0.5 s of inward flipbook sprites (Grid4x4, Lifetime 0.3, Size 3.7 to 1.1,
  Brightness 25) with a hard small core (Rate 150, Size 0.5, LockedToPart) and a final burst.
- Charge that builds in stacks (a weapon that charges per hit): section 19.
- Magic circle or rune on the ground (guideline): a flat ring sprite with `RotSpeed` 30 to 100, Size 4 to 10.

### Hit impact (melee, 0.15 to 0.4 s)

- 4 elements: ring (Lifetime 0.15 to 0.4, Size 0.7 to 4.4 to 5.3, LightEmission 0 or 1), flash
  (Size 3.5 to 0), spark lines (Emit 5 to 20, Speed 25 to 45, Drag 12, `VelocityParallel`,
  Lifetime 0.2 to 0.4), residue dots (Emit 20, Speed 5 to 15, Drag 2, Acceleration (0,-15,0)).
- All `LockedToPart` true with Speed about 0.01 for the flash and ring layers so they stay on the
  target; sparks and dots fly free.
- Colour carries meaning: warm orange for a player hit, blue 0044ff to 00c8ff for a weapon or
  block hit, white for a critical. Same emitters, new ColorSequences.
- Add a 0.05 to 0.08 s hit-stop in the animation plus a camera shake of 0.15 to 0.3 studs (guideline).
- Show marks only on real hits, mounted on the target's root at the contact frames and oriented
  toward the attacker (verified 2026-10-29, section 16).

### Slash (sword or claw arc)

- Crescent: a flipbook (Grid4x4, OneShot, Lifetime 0.4, Size 5 to 6, `VelocityPerpendicular`,
  Transparency 1,1,0,0,1 so it fades in and out) emitted when the animation marker `Hit` fires.
- Trail (verified 2026-10-29, the version the user approved): one `Trail` between two attachments
  at the blade's inner and outer edge, so it spans the whole weapon (measure the edges in blade
  space, section 15). No texture, Lifetime 0.2 to 0.26, WidthScale 1 to 0.45, Transparency 0.1 to
  0.45 to 1, LightEmission 0.6, Brightness 1.5, FaceCamera false, `Enabled` only during the
  measured swing window. The user rejected textured "sideways" trail textures, an edge trail plus a
  fill (it reads as two trails) and a trail that only covered the tip.
- Beams for arcs: Width0 8 to 10, Width1 0, Segments 18, CurveSize0 = CurveSize1 about 9 (negative
  for the other direction), TextureSpeed 1.2, TextureLength 0.5, FaceCamera true. The slash pack
  gates them with attributes `StartDelay`/`EndDelay` (a script is needed to enable and disable them).
- Impact 0.1 s after the arc: sparks (Emit 25, Speed 25, Acceleration (10,-10,0)) and a short flash.

### Lightning

- Bolt: flipbook of a bolt (14862694841 Grid4x4, 12390063093 Grid8x8) on `Orientation =
  VelocityParallel`, Speed 313 to 448 with Drag 25, Lifetime 0.1 to 0.15, Size 6 to 8, SpreadAngle 2
  to 5, `Squash` alternating -0.19 to 0.9 to 1.1 (jitter), EmissionDirection Bottom for a strike
  from above, `EmitDelay 0.06`. Emit 1 to 3 copies.
- Add a ground flash (core layer) and 5 to 10 thin sparks. For a hero strike column, default to a
  Beam with the thin lightning texture (next bullet); a Neon mesh column (mesh 6553232712 is a
  3 x 137 x 3 column, tween its Transparency 0 to 1 in 0.25 s) is an option to confirm with the user
  (section 13).
- Beams between two attachments for chain lightning or a lightning tracer: the thin lightning
  texture 15270205079 with `CurveSize0` and `CurveSize1` randomised every frame for flicker
  (verified 2026-10-29); Segments 10 to 20, Width 1 to 3 (guideline).

### Portal

- Steady loop, all `LockedToPart`: vortex sprites (Size 10 to 0, RotSpeed 360), rays (Lifetime 5,
  Size 0 to 10, RotSpeed 30, Transparency 0.7), glow (Size 5), wave (Size 10 to 4, RotSpeed 360),
  inward sparkles (`Shape = Sphere`, `ShapeInOut = Inward`, Speed 7). 8 to 11 emitters, 2 to 20 rate each.

### Healing

- Rising stars and sparkles (Rate 20 to 30, Lifetime 0.3 to 1, Speed 5 to 15, Acceleration (0,3,0),
  Size 0 to 0.7 to 0), plus two ground spirals (`VelocityPerpendicular`, RotSpeed 100 to 400,
  Lifetime 1, Size 3 to 0.75, Transparency 1, 0.03, 0, 0.9, 1). Green 00ff26 or 1aff1a, Brightness 10.

### Shockwave and ground burst

- Particle ring (section 2) sized to the real gameplay radius: raycast down for the floor and lay a
  flat `VelocityPerpendicular` ring there. Measure your ring texture once (verified 2026-10-29: a
  ring with Size 17.5 drew a 15-stud radius).
- Add dust: 10 smoke puffs at Speed 15 to 25 along the ground, Lifetime 1 to 1.5, or the ground dust
  ring Fog Smoke Circle 12656890572 (Grid8x8, verified 2026-10-29).
- Never give ground particles a negative `ZOffset`: they sink below the floor and vanish (verified
  2026-10-29).
- A Neon or ForceField mesh dome tweened from 20 percent to 100 percent of its final Size in 0.3 s
  while Transparency goes 0.2 to 1 (section 9) is an option to offer, not the default (section 13).

### Gun shots: tracers and muzzle (verified 2026-10-29)

- Tracers are Beams between two world attachments parented to `workspace.Terrain`, fixed where the
  shot happened. Attaching them to the moving barrel looked wrong.
- Layer three beams: a soft glow (thin energy texture 15507852294, wider, transparency 0.3), a
  texture layer (helix 12781785184 with TextureSpeed 4 for a railgun, or the thin lightning
  15270205079 with `CurveSize0`/`CurveSize1` randomised every frame) and a bright core. Fade them
  out over 0.12 to 0.22 s by rewriting the Transparency keypoints, and scale the widths with the
  charge level.
- A flat ring at the muzzle (`VelocityPerpendicular`, Speed 5) sells a coil weapon.
- Fire burst for a shotgun: 16 puffs of Coloured Fire Glow 13470068974 (Grid4x4, a 13° cone, Speed
  20 to 60, Size 1.5 to 5.5) plus one Fire coloured blast 13990048171, then ember streaks and smoke
  0.12 s later.
- Find the muzzle axis before placing anything (section 15), and keep projectiles on the client
  (section 16).

### Smoke and steam (verified 2026-10-29)

- Use the smooth flipbook "Dark Grey Smoke 2" 11627083142 (Grid8x8, OneShot) with LightEmission 0
  and LightInfluence 0. Lit smoke turned black in a dark map, and the "realistic" and "stylised"
  smoke-burst flipbooks that were tried read as pixelated or outlined.

## 4. Properties worth knowing (verified in the packs)

- `Brightness` (ParticleEmitter, default 1): HDR multiplier. With bloom on, 3 to 50 gives the
  glowing look; the packs go up to 100 and, for specks, 500. Without bloom it only brightens.
- `LightEmission`: 1 is fully additive (black disappears). Negative values (-1 to -5) paint darker
  shapes on top of the scene; the stylised packs use them for smoky edges.
- `Squash`: negative stretches along the particle's long axis; with `VelocityParallel` it makes
  speed streaks. Animate it with a sequence (-0.3 to 0 to 3) for a snap.
- `Orientation`: `FacingCamera` for puffs and flashes, `VelocityParallel` for streaks,
  `VelocityPerpendicular` for flat rings and flipbooks that should lie on a surface.
- `VelocityParallel` aligns the texture's horizontal axis with the velocity at Rotation 0, so
  vertical textures (spark streaks such as `ember_` 138928814236581, rising flames) need Rotation 90
  or -90 or they fly sideways. Speed 0.01 is too slow to orient anything (verified 2026-10-29).
- Flat rings (`VelocityPerpendicular`) at Speed 0 ignore the attachment's tilt: use Speed 0.01 to
  0.5 and zero Acceleration (verified 2026-10-29).
- `ZOffset`: positive pulls a particle toward the camera (documented behaviour; the packs order
  their layers this way: glow 3, glare 2, body 1, smoke 0, sparks -1). Do not use huge values, and
  never a negative value on particles that sit on the ground: they sink below the floor and vanish
  (verified 2026-10-29).
- `Color`: changing it recolours particles that are already alive. To show two colours or two hits
  at once, clone the host (attachment and emitters) per colour and per hit (verified 2026-10-29).
- `TimeScale`: slows or speeds the whole simulation of that emitter. It also makes slow-motion
  review possible (section 11).
- `LockedToPart`: particles move with the part. True for effects on a character or projectile and
  for flipbooks that ride a weapon, false for debris and trails of particles that should stay where
  they were released (verified 2026-10-29).
- `Shape`, `ShapeStyle`, `ShapeInOut`, `ShapePartial`: `Sphere` plus `Inward` for portals and
  absorption, `Disc` for rings of sparks, `ShapePartial 2.5 to 7` for wide arcs.
- `FlipbookLayout` Grid4x4 or Grid8x8 with `FlipbookMode OneShot`: Lifetime is the animation time.
  `FlipbookFramerate` only matters for Loop.
- `VelocityInheritance 1`: aura particles follow a moving character.
- Some sprite textures are drawn on black. If you see a dark square behind a sprite, set
  `LightEmission` 1, or pick another texture, and check on both a dark and a bright background.
  Before using a texture below LightEmission 1, check its alpha in a contact sheet (section 21): a
  pure black tile means it has none (verified 2026-10-29).
- Big sprites (glints, sniper stars) need 1024 px textures with alpha, such as the 4-point flare
  80768860709156. A low-resolution 2x2 star flipbook showed pixelated edges (verified 2026-10-29).

## 5. Triggering: Emit from one controller

Pattern verified in the packs and in a playtest:

1. All burst emitters are `Rate = 0` or `Enabled = false`. Nothing runs by itself.
2. One controller emits them: `emitter:Emit(count)` for bursts, `Enabled = true` for a duration.
3. The counts and delays live on the emitters as attributes, so artists tune the effect without
   editing code:
   - `EmitCount` (number): how many to `Emit`. A name suffix like `Sparks (30)` appears in some packs.
   - `EmitDelay` (seconds): wait before emitting, to sequence layers (flash at 0, sparks at 0.05,
     smoke at 0.1).
   - `EmitDuration` (seconds): keep `Enabled` true for that long instead of a burst.
   - Some packs add `TimeScale_Duration` and `Size_Start/Size_End/Size_Curve` for tweened emitters;
     treat those as pack-specific.
   - The prototype stage (section 14) extends this with `EmitDelays`, `Tint`, `Continuous`,
     `TrailOn`/`TrailOff`, `BeamOn`/`BeamOff` and `FadeTime` (verified 2026-10-29).
4. Time the delays to the animation: use its markers when it has them, or the measured peaks when
   it has none (section 15).

A client-side player for that convention (verified: emitters with `EmitDuration` switched on for
0.5 s then off, `EmitCount` emitters burst, and the clone was removed by Debris):

```luau
--!strict
local Debris = game:GetService("Debris")
local VfxPlayer = {}

local function effectsFolder(): Folder
	local f = workspace:FindFirstChild("Effects")
	if f then return f :: Folder end
	local n = Instance.new("Folder")
	n.Name = "Effects"
	n.Parent = workspace
	return n
end

function VfxPlayer.play(template: Instance, cf: CFrame): Instance
	local fx = template:Clone()
	for _, d in fx:GetDescendants() do
		if d:IsA("LuaSourceContainer") then d:Destroy() end -- packs ship scripts we do not run
	end
	if fx:IsA("Model") then fx:PivotTo(cf) elseif fx:IsA("BasePart") then fx.CFrame = cf end
	for _, d in fx:GetDescendants() do
		if d:IsA("BasePart") then
			d.Anchored, d.CanCollide, d.CanQuery, d.CanTouch, d.Massless, d.Transparency = true, false, false, false, true, 1
		end
	end
	if fx:IsA("BasePart") then
		fx.Anchored, fx.CanCollide, fx.CanQuery, fx.CanTouch, fx.Transparency = true, false, false, false, 1
	end
	fx.Parent = effectsFolder()

	local longest = 0.5
	for _, d in fx:GetDescendants() do
		if d:IsA("ParticleEmitter") then
			local count = d:GetAttribute("EmitCount")
			local delay = (d:GetAttribute("EmitDelay") or 0) :: number
			local dur = d:GetAttribute("EmitDuration") :: number?
			if count ~= nil or dur ~= nil or not d.Enabled then
				d.Enabled = false
				task.delay(delay, function()
					if not d.Parent then return end
					if dur and dur > 0 then
						d.Enabled = true
						task.delay(dur, function() if d.Parent then d.Enabled = false end end)
					else
						d:Emit((count or math.max(1, math.floor(d.Rate * 0.1))) :: number)
					end
				end)
			end
			longest = math.max(longest, delay + (dur or 0) + d.Lifetime.Max / math.max(d.TimeScale, 0.05))
		end
	end
	Debris:AddItem(fx, longest + 0.5)
	return fx
end

return VfxPlayer
```

Keep templates in `ReplicatedStorage.VfxTemplates`, not in Workspace. Emitters that stay `Enabled`
with no attributes (steady layers such as a glow core) simply keep running until Debris removes the
clone.

## 6. Where effects run, and how to adapt a pack

### Client versus server

- Run visuals on the client. The server decides what happened (a hit, a kill, a placed trap); it
  sends one small RemoteEvent (`FxEvent:FireAllClients("explosion", position, scale)`, or
  `FireClient` for one player) and each client builds the effect. Verified: the client handler
  received `("explosion", Vector3, 1)` and ran the effect.
- Measured surprise: in a Studio playtest, a server-side `ParticleEmitter:Emit(30)` and a
  server-side `Enabled = true` were both visible on the client. So the old rule "Emit does not
  replicate" did not hold here. Still prefer client-side emission: it costs no bandwidth, it is
  instant, you can scale it by the viewer's graphics quality, and you can skip it for far-away
  players. Use server-side emitters only for rare, gameplay-critical visuals that must exist for
  everyone, such as a persistent area marker, or a state the server already owns: server-side
  changes to an emitter's `Rate` and `Enabled` reached every client again on 2026-10-29, which the
  charge indicator in section 19 relies on.
- Projectiles are the strongest case for the client: never render the server's moving parts
  (section 16).
- Server only for gameplay: damage, hitboxes, kill credit, state. Never wait for an effect to end
  to apply gameplay.
- Camera shake and screen flashes are client only.

### Adapting a toolbox pack

1. `insert_asset` it; read its scripts (they arrive disabled). Most VFX packs have none or a
   README script. Do not enable anything you have not read.
2. Find the effect parts: group by Part or Attachment name. Packs name them well (`Hit-03`,
   `Explosion-01`, `Boom 1`). Dump emitter properties with `execute_luau` (Texture, Rate, Lifetime,
   Speed, Size, Color, LightEmission, ZOffset, Orientation, Flipbook*, attributes) before touching.
3. Copy the effect out as a template (Part with Attachment and emitters, or Model). Make parts
   `Transparency = 1`, `Anchored`, `CanCollide`/`CanQuery`/`CanTouch` false. A pack part left
   visible shows as a coloured square at the impact point (seen with the Yona pack).
4. Re-time: change `EmitDelay` attributes, Lifetime, or `TimeScale` (scales the whole emitter).
5. Re-colour with ColorSequence, keeping whites neutral. Verified helper:

```luau
local function mapSeq(seq, f)
	local k = {}
	for _, kp in seq.Keypoints do table.insert(k, f(kp)) end
	return k
end
local function recolor(root: Instance, hue: number, satMul: number?)
	for _, d in root:GetDescendants() do
		if d:IsA("ParticleEmitter") or d:IsA("Beam") or d:IsA("Trail") then
			d.Color = ColorSequence.new(mapSeq(d.Color, function(kp)
				local _, s, v = kp.Value:ToHSV()
				if s < 0.12 then return kp end -- keep whites and greys
				return ColorSequenceKeypoint.new(kp.Time, Color3.fromHSV(hue, math.clamp(s * (satMul or 1), 0, 1), v))
			end))
		elseif d:IsA("Light") then
			local _, s, v = d.Color:ToHSV()
			if s >= 0.12 then d.Color = Color3.fromHSV(hue, s, v) end
		end
	end
end
```

6. Scale size and speed together, or a bigger effect looks like slow motion:

```luau
local function scaleNS(seq: NumberSequence, m: number)
	return NumberSequence.new(mapSeq(seq, function(kp) return NumberSequenceKeypoint.new(kp.Time, kp.Value * m, kp.Envelope * m) end))
end
local function scale(root: Instance, m: number)
	for _, d in root:GetDescendants() do
		if d:IsA("ParticleEmitter") then
			d.Size = scaleNS(d.Size, m)
			d.Speed = NumberRange.new(d.Speed.Min * m, d.Speed.Max * m)
			d.Acceleration = d.Acceleration * m
		elseif d:IsA("Beam") then
			d.Width0, d.Width1 = d.Width0 * m, d.Width1 * m
			d.CurveSize0, d.CurveSize1 = d.CurveSize0 * m, d.CurveSize1 * m
		elseif d:IsA("Trail") then
			d.WidthScale = scaleNS(d.WidthScale, m)
		elseif d:IsA("Light") then
			d.Range *= m
		end
	end
end
```

Verified on the Dogmath "Hit" model: orange original, green at hue 0.38, pink-purple at hue 0.75
and scale 2 all rendered correctly. Do not scale Lifetime; scale Drag only if the motion feels wrong.

7. Place it at the hit point with `VfxPlayer.play(template, CFrame.new(pos) * CFrame.lookAt(...))`
   (or an Attachment on the target so `LockedToPart` layers follow it).
8. Replace pack sounds and any `Decal`/`Texture` ids you cannot verify; test every asset id in a
   playtest (some are private and will silently not render).

### Pack hygiene

- Heavy packs exist: "Light Explosion VFX" has 356 emitters and 254 beams for one explosion;
  "BIG VFX PACK" has 16,300 descendants. Never clone these per hit. Use their idea, rebuild lighter.
- Remove unused layers. An effect with 6 well-tuned emitters beats one with 60.

## 7. Performance budgets (guideline)

- Hit or cast impact: 5 to 10 emitters at most, about 60 live particles, Lifetime at most 0.6 s.
  Start with 3 or 4 (section 13).
- Hero explosion: 8 to 15 emitters, about 150 live particles, 3 to 4 s total.
- Looping ambient effect (torch, aura): at most 3 emitters, about 30 live particles per emitter;
  disable beyond about 100 studs and when off screen.
- On mobile keep the total live particles in view near 1,000 or fewer, and test on the device
  matrix (see `roblox-performance`).
- Overdraw is the real cost: ten 25-stud smoke sprites covering the screen cost more than 500
  small sparks. Keep large sprites few, with a short Lifetime and a transparency fade.
- `LightInfluence`: 0 for glowing layers (flash, sparks, magic), and 0 for smoke too, with
  LightEmission 0: lit smoke turned black in a dark map (verified 2026-10-29). Use 1 only for dust
  or smoke that must take a bright scene's lighting (guideline).
- PointLights: one per effect, `Shadows = false`, tween Brightness to 0, remove with the effect.
- Particles are destroyed with their emitter: always use `Debris:AddItem(root, longest + 0.5)` or a
  pool of anchored parts; never leave an `Enabled` emitter running.
- Cap simultaneous instances (for example 8 explosions at once) and drop the oldest.
- `Rate` high with `Enabled = false` is harmless, but a stray `Enabled = true` on a Rate 1000
  emitter (some packs use that in sparks) is not.

## 8. Building an effect from scratch (verified textures)

Use these assets only after you re-test them in your place. All of them rendered in Studio on
2026-10-20 (in a texture contact sheet of 48 ids). More ids that shipped in a game on 2026-10-29,
and how to find new ones, are in section 21; for smoke bursts prefer 11627083142 over the smoke
rows below (section 3, "Smoke and steam").

| Texture                                                                                          | What it is                                                | Use for                                 |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------- |
| `rbxasset://textures/particles/sparkles_main.dds`                                                | 8-point sparkle (built in)                                | magic glints                            |
| `rbxasset://textures/particles/fire_main.dds`                                                    | speckled flame (built in)                                 | old-style fire                          |
| `rbxasset://textures/particles/smoke_main.dds`                                                   | soft cloud (built in)                                     | smoke                                   |
| 1084987899                                                                                       | fluffy bright puff                                        | glare, orange body, smoke (dark colour) |
| 243664672                                                                                        | soft round glow                                           | core flash, light bloom                 |
| 867619398                                                                                        | large soft orb                                            | halo, portal glow                       |
| 1084982817                                                                                       | soft disc                                                 | hard core                               |
| 6673021984                                                                                       | wide radial glow                                          | big flare                               |
| 8120666025                                                                                       | 4-point star                                              | glint, magic spark                      |
| 8611887703                                                                                       | 4-point star, thinner                                     | glint                                   |
| 8952335649                                                                                       | thick soft ring                                           | shockwave                               |
| 1084991215                                                                                       | thin circle outline                                       | shockwave ring (cleaner)                |
| 7083340510                                                                                       | arc ring                                                  | spinning hit ring                       |
| 7919579655                                                                                       | wide thin ring                                            | hit ring                                |
| 7541669000                                                                                       | radial shard burst                                        | impact star                             |
| 2850138336                                                                                       | streak burst, dark centre                                 | hit flash                               |
| 6967022163                                                                                       | spiky burst with ring                                     | hit star                                |
| 311395391                                                                                        | firework spark burst                                      | impact sparks                           |
| 7451822955                                                                                       | round dot glow                                            | spark core (squash to a streak)         |
| 7587238412                                                                                       | capsule                                                   | sparks with `VelocityParallel`          |
| 6660412891                                                                                       | long vertical streak                                      | speed line                              |
| 6763809313                                                                                       | short diamond streak                                      | spark                                   |
| 7845168136                                                                                       | spiky line                                                | speed lines                             |
| 8068783649                                                                                       | tiny specks                                               | embers, dust                            |
| 1084976679                                                                                       | scattered dots                                            | dust, stars                             |
| 1053548563                                                                                       | vertical ray                                              | god rays, beams of light                |
| 1084969997                                                                                       | vortex streaks                                            | portal, tornado (RotSpeed 360)          |
| 297744035, 10180479311, 9232117588                                                               | cloud puff, wispy smoke, soft smoke                       | smoke                                   |
| 7130084926                                                                                       | wavy blob                                                 | flame body                              |
| 160041569                                                                                        | flame sprite                                              | classic fire                            |
| 15194500627 (Grid8x8)                                                                            | explosion flipbook                                        | fireball                                |
| 11395090403, 16850891267 (Grid4x4), 13847476967 (Grid8x8)                                        | fire flipbooks                                            | flames                                  |
| 10034873151 (Grid8x8)                                                                            | smoke flipbook                                            | smoke                                   |
| 13780268621 (Grid4x4)                                                                            | air swirl or slash crescent flipbook                      | slashes                                 |
| 14862694841 (Grid4x4), 12390063093 (Grid8x8)                                                     | lightning flipbooks                                       | bolts                                   |
| 8620925368, 8133845150, 8133994161, 8047533775, 8612048548, 14480500149, 11197917329, 8114157061 | wave, aura streaks, heal wave, fire sprite, lines, sparks | see the Dogmath and Slash packs         |

A layered explosion built from those, reviewed in a playtest (flash, glare, flipbook fire, body
puffs, sparks, smoke, flat ring, light). It looked right at scale 1 once the smoke was lightened
and made less opaque; tune further for your game. It is a hero explosion at pack brightness: for an
ability, drop to 3 or 4 layers at Brightness 1 to 2 (section 13), and in a dark map swap the smoke
layer for 11627083142 (Grid8x8, OneShot) with LightInfluence 0 (verified 2026-10-29).

```luau
local TweenService = game:GetService("TweenService")
local Debris = game:GetService("Debris")

local function ns(...) local k = {} for _, p in {...} do table.insert(k, NumberSequenceKeypoint.new(p[1], p[2])) end return NumberSequence.new(k) end
local function cs(...) local k = {} for _, p in {...} do table.insert(k, ColorSequenceKeypoint.new(p[1], p[2])) end return ColorSequence.new(k) end
local function layer(att: Attachment, props)
	local e = Instance.new("ParticleEmitter")
	e.Rate, e.LightInfluence, e.EmissionDirection = 0, 0, Enum.NormalId.Top
	for k, v in props do e[k] = v end
	e.Parent = att
	return e
end

local function explosion(position: Vector3, s: number)
	s = s or 1
	local anchor = Instance.new("Part")
	anchor.Name, anchor.Anchored, anchor.CanCollide, anchor.CanQuery, anchor.CanTouch = "ExplosionFx", true, false, false, false
	anchor.Transparency, anchor.Size, anchor.CFrame = 1, Vector3.one, CFrame.new(position)
	anchor.Parent = workspace
	local att = Instance.new("Attachment") att.Parent = anchor

	local flash = layer(att, {Texture = "rbxassetid://243664672", Lifetime = NumberRange.new(0.16), Speed = NumberRange.new(0),
		Size = ns({0, 4 * s}, {0.25, 18 * s}, {1, 22 * s}), Transparency = ns({0, 0}, {0.4, 0.15}, {1, 1}),
		Color = cs({0, Color3.new(1, 1, 1)}, {1, Color3.fromRGB(255, 200, 90)}), LightEmission = 1, Brightness = 8, ZOffset = 3})
	local glare = layer(att, {Texture = "rbxassetid://8120666025", Lifetime = NumberRange.new(0.3), Speed = NumberRange.new(0),
		Size = ns({0, 6 * s}, {0.2, 20 * s}, {1, 0}), Transparency = ns({0, 0}, {1, 1}), Rotation = NumberRange.new(0, 90), RotSpeed = NumberRange.new(-60, 60),
		Color = ColorSequence.new(Color3.fromRGB(255, 220, 140)), LightEmission = 1, Brightness = 6, ZOffset = 2})
	local fire = layer(att, {Texture = "rbxassetid://11395090403", FlipbookLayout = Enum.ParticleFlipbookLayout.Grid4x4, FlipbookMode = Enum.ParticleFlipbookMode.OneShot,
		Lifetime = NumberRange.new(0.55, 0.8), Speed = NumberRange.new(2 * s, 8 * s), SpreadAngle = Vector2.new(180, 180), Drag = 5,
		Size = ns({0, 5 * s}, {0.4, 11 * s}, {1, 13 * s}), Transparency = ns({0, 0}, {0.65, 0}, {1, 1}),
		Color = ColorSequence.new(Color3.fromRGB(255, 130, 70)), LightEmission = 0.6, Brightness = 3, Rotation = NumberRange.new(-180, 180), ZOffset = 1})
	local body = layer(att, {Texture = "rbxassetid://1084987899", Lifetime = NumberRange.new(0.35, 0.6), Speed = NumberRange.new(10 * s, 30 * s), SpreadAngle = Vector2.new(180, 180), Drag = 7,
		Size = ns({0, 3 * s}, {0.3, 9 * s}, {1, 6 * s}), Transparency = ns({0, 0.3}, {0.6, 0.45}, {1, 1}),
		Color = cs({0, Color3.fromRGB(255, 220, 120)}, {0.5, Color3.fromRGB(255, 100, 30)}, {1, Color3.fromRGB(120, 30, 10)}),
		LightEmission = 1, Brightness = 2, Rotation = NumberRange.new(-180, 180), ZOffset = 0.5})
	local sparks = layer(att, {Texture = "rbxassetid://7587238412", Orientation = Enum.ParticleOrientation.VelocityParallel,
		Lifetime = NumberRange.new(0.5, 1.1), Speed = NumberRange.new(35 * s, 75 * s), SpreadAngle = Vector2.new(180, 180), Drag = 3, Acceleration = Vector3.new(0, -55, 0),
		Size = ns({0, 0.7 * s}, {1, 0}), Squash = ns({0, -1.2}, {1, -0.5}), Transparency = ns({0, 0}, {0.8, 0}, {1, 1}),
		Color = cs({0, Color3.fromRGB(255, 230, 150)}, {1, Color3.fromRGB(255, 80, 20)}), LightEmission = 1, Brightness = 5, ZOffset = -1})
	local smoke = layer(att, {Texture = "rbxassetid://9232117588", Lifetime = NumberRange.new(2, 3.2), Speed = NumberRange.new(7 * s, 16 * s), SpreadAngle = Vector2.new(70, 70),
		Drag = 2.2, Acceleration = Vector3.new(0, 6, 0), Size = ns({0, 3 * s}, {0.25, 8 * s}, {1, 12 * s}), Transparency = ns({0, 1}, {0.08, 0.35}, {0.5, 0.72}, {1, 1}),
		Color = cs({0, Color3.fromRGB(95, 80, 70)}, {0.3, Color3.fromRGB(70, 66, 64)}, {1, Color3.fromRGB(90, 90, 92)}),
		LightEmission = 0, LightInfluence = 1, Rotation = NumberRange.new(-180, 180), RotSpeed = NumberRange.new(-25, 25)})
	local ring = layer(att, {Texture = "rbxassetid://1084991215", Orientation = Enum.ParticleOrientation.VelocityPerpendicular, Lifetime = NumberRange.new(0.45), Speed = NumberRange.new(0.01),
		Size = ns({0, 2 * s}, {1, 36 * s}), Transparency = ns({0, 0.1}, {0.6, 0.5}, {1, 1}), Color = ColorSequence.new(Color3.fromRGB(255, 200, 130)), LightEmission = 1, Brightness = 3})

	flash:Emit(1) glare:Emit(1) fire:Emit(4) body:Emit(6) sparks:Emit(math.floor(28 * s)) smoke:Emit(6) ring:Emit(1)

	local light = Instance.new("PointLight")
	light.Color, light.Range, light.Brightness, light.Shadows = Color3.fromRGB(255, 160, 70), 26 * s, 8, false
	light.Parent = att
	TweenService:Create(light, TweenInfo.new(0.45, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {Brightness = 0, Range = 4}):Play()
	Debris:AddItem(anchor, 4)
end
```

Minimal versions of the other types follow the same shape: a hit is `flash` (Speed 0) + `ring`
(Speed 0.01, section 4), both LockedToPart, + `sparks` (Emit 15, Speed 25 to 45, Drag 12) with colours changed; a heal is
two `Rate 20` emitters of 8120666025 and 1084982817 with `Acceleration (0,3,0)` and green colours
plus a spinning ring layer with `Orientation = VelocityPerpendicular`.

Camera shake, client only (verified: peak offset about 0.54 studs for magnitude 0.6, returned to
zero):

```luau
local RunService = game:GetService("RunService")
local function shake(humanoid: Humanoid, magnitude: number, duration: number)
	local t0 = os.clock()
	local conn
	conn = RunService.RenderStepped:Connect(function()
		local t = os.clock() - t0
		if t > duration then
			humanoid.CameraOffset = Vector3.zero
			conn:Disconnect()
			return
		end
		local f = (1 - t / duration) ^ 2 * magnitude
		humanoid.CameraOffset = Vector3.new((math.random() - 0.5) * 2 * f, (math.random() - 0.5) * 2 * f, 0)
	end)
end
```

## 9. Mesh-based effects (ask first)

Many professional-looking domes, columns and shockwaves in the packs are static MeshParts with
`Material = Neon` (or `ForceField`), a flat colour, `CanCollide = false`, tweened in Size and
Transparency. They are an option, not the default: in a production rework the user rejected
visible parts as the effect (neon domes, ForceField spheres, tweened rings) and approved particles,
trails and beams instead (verified 2026-10-29). Offer a mesh with a one-line description of the
look and build it only when the user confirms. Invisible host parts and debris are fine.

Verified meshes (they loaded and rendered in a place that does not own them):

| MeshId                                                     | Shape                              | Notes from the pack                |
| ---------------------------------------------------------- | ---------------------------------- | ---------------------------------- |
| 437347603                                                  | shockwave mesh                     | ForceField material, white         |
| 903888897                                                  | rough electric shockwave disc      | Neon, 0.7 to 0.9 transparency      |
| 5696416905, 452960473, 5139788115                          | waves / cones                      | Neon, orange or grey               |
| 4933939180                                                 | dome / sphere                      | Slate, 0.5 transparency            |
| 5694662480, 5922911757, 6026280687, 6071327170, 3375161112 | lightning shock shapes, spiky ball | Neon, 04afec                       |
| 6553232712                                                 | thin tall column, size 3 x 137 x 3 | lightning strike, 0.6 transparency |

Tween pattern: start at 20 percent of the final Size and Transparency 0.2, tween to 100 percent and
Transparency 1 over 0.3 to 0.5 s with `Quad Out`, then `Debris`. Pair with particles for texture;
a bare mesh looks cheap. Remove meshes after the tween; they are heavier than particles.

To animate a model rather than a part, tween a `CFrameValue` and `PivotTo` from `Changed` (verified).

## 10. Pitfalls found

- Packs that look great in the thumbnail may contain 300+ emitters (see section 6).
- A `wait(0.001)` flicker loop on a light (in a popular fire pack) burns a thread. Replace it.
- Toolbox names include unicode padding and spoofed "Roblox" creators with 0 percent votes; prefer
  packs with many votes and a high upvote percentage, and read the creator, not only the title.
- Scripts in packs are disabled on insert. Leaving them disabled is almost always correct.
- Spaces and `!` in pack object names are sanitised on insert (`README!!!!` becomes `READ ME!!!!`);
  find children with `FindFirstChildWhichIsA` rather than by exact name.
- Particle `Texture` ids from other creators render, but their sounds and animations may not.
- A stale Studio camera can make a good effect look wrong; frame it (`camera` tool) before judging.
- In Edit mode, Rate-based emission does not advance: emit bursts when previewing (verified
  2026-10-29).
- Rigs often name Motor6Ds and Welds after the parts they drive, so `FindFirstChild(name, true)`
  can return the joint instead of the part (verified 2026-10-29, helper in section 15).
- Instances passed through a RemoteEvent arrive as nil when they have not streamed in yet; tag
  them with CollectionService instead (verified 2026-10-29, section 16).

## 11. Review checklist (playtest screenshot)

Use the `camera` tool to frame the effect at its real play distance, trigger it from the real
controller, and capture. Burst effects are over in 0.3 s, so slow them down while reviewing: set
`TimeScale = 0.2` to `0.25` on every emitter and the light tween duration divided by the same
factor, then capture at 0.7 s and 1.5 s (verified: the flash, fire and smoke phases are visible).
Remember to restore `TimeScale` after the review. Freezing Edit-mode previews, locking the camera
in Play mode and what to do when captures come back dark are in section 20.

Check each item against the screenshot:

- Does the first frame read in under 0.1 s: a bright core, not a slow fade-in?
- Are there 3 or 4 layers (flash, body, sparks, smoke or ring) with different lifetimes, and no
  more than the effect needs (section 13)?
- Do colours stay inside two or three related hues, with a hot centre and a darker edge, and in the
  character's own colour and theme?
- Is the silhouette clear on both a dark and a bright background (dark squares behind sprites,
  white-on-white washout)?
- Is the ring flat on the floor (raycast), at the real gameplay radius, and not sunk by a negative
  `ZOffset`?
- Does each layer land on the measured contact frame (section 15), do projectile trails connect to
  the projectile's glint, and do tracers start where the shot happened?
- Does smoke stay lighter than a black blob, and does it fade fully?
- Is the effect centred on the gameplay point, not on a part's pivot?
- Does it clean up (no emitters left, no PointLight left lit, no visible pack parts)?
- Particle count and overdraw within section 7; no `Enabled` emitter with a huge Rate.
- Is there a sound, a camera shake or a hit-stop that matches its weight, and can the player
  turn effects down?
- Does the server never wait for the visual to decide gameplay?

## 12. Assets found useful (all free, inserted successfully on 2026-10-20)

Inserted with `insert_asset`; "verified" means it was dumped and rendered.

| Asset id        | Name (creator)                            | Rating           | Good for                                                                                                                                                                                                       |
| --------------- | ----------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 88358016376585  | Explosions VFx (cyncxx12)                 | 92%, 10 votes    | `Boom 1/3/5/7`: realistic layered explosions (6 emitters, 3 s). `FinalExplosion`: stylised, 76 emitters, `EmitCount = 1` each, up to Brightness 100. `Explosion effect`: 8x8 flipbook with EmitCount/EmitDelay |
| 8621531267      | Free VFX Pack #1 (DogmathPan)             | 99%, 70 votes    | 12 small effects, no scripts: Hit, WeaponHit, Heal, Aura, Burning, Explosion, Block. Names carry the count, `EmitCount` attribute. Best starting point for combat feedback                                     |
| 18170940328     | Yona VFX Pack (horte132)                  | 99%, 200 votes   | Combat (Hit-01..05, Slash-01/02, Block, sparks), Explosion (Explosion-01/02, Red-Explosion, Lightning, Electricity Impact, Ground-Crack), Blood, Fire, Player auras. EmitCount/EmitDelay. 1 README script      |
| 112672322113504 | VFX PACK (Euphoric Games Community)       | 98%, 1000+ votes | Big (Explosion-01, Tornado, Big-Crack, Lighting), Anime (Charge, Slashes, ForceField-Break, Fire, Water, Wind), Beams, Auras. 281 emitters, no scripts                                                         |
| 85889779196357  | Slash VFX (Metamorphosis643)              | 100%, 10 votes   | Crescent slash with flipbooks, beams (StartDelay/EndDelay), Trail; 27 emitters. README only                                                                                                                    |
| 107157303748652 | Fire slash attack VFX [Free] (SquavRblx)  | 100%, 20 votes   | Compact fire slash, 8 emitters, one-shot, negative LightEmission layers                                                                                                                                        |
| 9373307685      | Sparks Effect (J3xetor)                   | 97%, 200 votes   | 4-emitter spark and core loop, good small impact                                                                                                                                                               |
| 8786154423      | Portal Effect (monsterbear2930)           | 96%, 20 votes    | Cyan vortex portal, 11 emitters, no scripts                                                                                                                                                                    |
| 15943117223     | Hit effect (mardy2014)                    | 90%, 30 votes    | One 4x4 flipbook flash (texture 10198439352)                                                                                                                                                                   |
| 15050195723     | dramatic explosion vfx (Foil_UVE)         | 96%, 20 votes    | 13 Neon/Slate/ForceField meshes, no emitters; tween them                                                                                                                                                       |
| 9684371256      | lightning strike vfx (pasmeko)            | 87%, 10 votes    | Neon lightning meshes including a 137-stud column                                                                                                                                                              |
| 6244321362      | Slam Shockwave (Kyle8300)                 | 94%, 10 votes    | 3 ForceField shockwave meshes                                                                                                                                                                                  |
| 7564537285      | VFX Pack (synmade)                        | 96%, 1000+ votes | About 200 effect meshes (slashes, circles, cylinders, stars)                                                                                                                                                   |
| 108812638060941 | Light Explosion VFX (brain123idontknow)   | 97%, 200 votes   | Anime light blast. Study only: 356 emitters and 254 beams                                                                                                                                                      |
| 11365590395     | Realistic Fire With Smoke (agentphilip07) | 90%, 1000+ votes | One Part: a Fire emitter plus legacy Smoke. Fine as a starting point, not as a hero fire                                                                                                                       |
| 6961173623      | Fire particles (FireBIaze_Alt)            | 92%, 300 votes   | Counter-example: flipbook-free fire with a bad flicker script                                                                                                                                                  |

Inserted but only skimmed (not recommended as a reference): 17290956157 BIG VFX PACK (16,300
descendants), 8903469227 vfx explosion, 9079631589 Free-to-use VFX Pack #1 (static meshes spun by
a `while wait()` script).

The mesh packs in this table (15050195723, 9684371256, 6244321362, 7564537285) serve the mesh route
of section 9: confirm it with the user first.

## 13. Taste defaults (ask, then default to these)

Guidelines from the user's verdicts on effects built in Studio during the 2026-10-28/29 rework.
Ask when the user's taste is unknown; otherwise start here.

- Start simple: 3 or 4 layers per burst, Brightness 1 to 2, small sizes. A first pass with 25
  emitters at Brightness 3 to 5 was called "over the top".
- Effects are particles, trails and beams. No visible Parts as the effect (neon domes, ForceField
  spheres, tweened rings); invisible hosts and debris are fine. A mesh (section 9) is an option to
  offer, not a default.
- Keep each character's identity (colour and theme), and do not restyle effects the user already
  likes. Rework from them: "a better version of the old one, same style".
- "Make it cooler" means a signature element (stars left along a trail, confetti, afterimages,
  wisps), not more brightness.
- Projectile trails connect to the projectile's glint, and tracers start where the shot happened.

## 14. Prototype stage: variants side by side (verified 2026-10-28/29)

This is the workflow that won the user over. When the look of an ability is open, build the current
effect plus 3 variants side by side, let the user pick per ability, and let them mix ("the charge
particles of variant C plus everything from variant A").

The stage, an Edit-only Model far from the map (spacings are guidelines that worked):

- One shelf per ability, rows about 14 studs apart; 4 columns about 26 studs apart (current, A, B, C).
- A neutral grey backdrop, `Color3.fromRGB(120, 126, 142)`, so bright and dark effects both read.
- SurfaceGui signs on the backdrop naming each cell, such as "M1 · A Trilho".
- Real rig clones: scripts removed, HumanoidRootPart anchored, the other parts unanchored so the
  Animator moves them.
- A target board or enemy dummy about 18 studs ahead for projectiles.

The logic:

- A ModuleScript with one function per ability and variant. Each fires a single cycle at the real
  gameplay timings.
- A server Script loop that plays the real animation on each rig and calls the matching function.
  Put the place in Run mode and let the user watch the loop live.

Attributes on the templates, extending section 5:

| Attribute              | Meaning                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `EmitCount`            | particles per emit                                             |
| `EmitDelays`           | seconds from the cycle start, comma-separated: `"0.38,0.71"`   |
| `Tint`                 | colour applied at runtime, so one template serves several kits |
| `Continuous`           | Rate-based: enable the emitter instead of calling `Emit`       |
| `TrailOn` / `TrailOff` | seconds from the cycle start to enable and disable a Trail     |
| `BeamOn` / `BeamOff`   | the same for a Beam                                            |
| `FadeTime`             | seconds a Beam or Trail takes to fade out                      |

Presenting and finishing:

- Give each variant a descriptive name in the user's language and a one-line description.
- Expect feedback rounds. "Keep the flames coming out of the shotgun, but no glints spraying in
  every direction" led to a second round of 6 variants, and the user picked one.
- After the pick, promote the chosen templates into the game's template folder (that game used
  `ReplicatedStorage.Visual.Attachments.<Class>`; section 5 suggests `ReplicatedStorage.VfxTemplates`),
  delete the stage, implement in the real ability code, and verify in a playtest.

## 15. Measure before you design (verified 2026-10-29)

- Sample each ability animation in Edit: preload the Animation, wait until `track.Length > 0`, then
  call `Animator:StepAnimations(1/30)` in a loop and log the weapon tip's speed and position in root
  space. Time trails and marks to the measured peaks (two slashes at 0.53 s and 0.86 s; a swing
  active from 0.02 to 0.36 s). An empty AnimationId means the ability has no animation.
- Prefer the animation's markers when it has them (`full.md` section 2); measure when it has none
  and you cannot republish it (guideline).
- Find blade edges and muzzle axes by parenting small neon marker balls to the part in an Edit
  preview and taking a screenshot; delete them afterwards. One gun's muzzle was the -Y end of an
  invisible "barrel" part.
- Rigs often name Motor6Ds and Welds after the parts they drive, so `FindFirstChild(name, true)` can
  return the joint. Use a helper that returns BaseParts only.
- Read the server code for when damage and resources apply (hitbox delays, per-hit gains) so the
  visuals coincide with them.

A sketch of the sampling loop and the helper (the method is verified; this exact code is a
guideline). Run it from `execute_luau` in Edit:

```luau
local ContentProvider = game:GetService("ContentProvider")

local function findPart(root: Instance, name: string): BasePart?
	for _, d in root:GetDescendants() do
		if d.Name == name and d:IsA("BasePart") then return d end
	end
	return nil
end

local function sample(rig: Model, animationId: string, tip: Attachment)
	local animator = rig:FindFirstChildWhichIsA("Animator", true) :: Animator
	local root = findPart(rig, "HumanoidRootPart") :: BasePart
	local animation = Instance.new("Animation")
	animation.AnimationId = animationId
	ContentProvider:PreloadAsync({ animation })
	local track = animator:LoadAnimation(animation)
	local deadline = os.clock() + 5
	while track.Length == 0 and os.clock() < deadline do task.wait() end
	track:Play(0)
	local dt, last = 1 / 30, nil
	for i = 0, math.ceil(track.Length / dt) do
		animator:StepAnimations(dt)
		local p = root.CFrame:PointToObjectSpace(tip.WorldPosition)
		print(string.format("%.2f s  speed %.1f  pos %s", i * dt, last and (p - last).Magnitude / dt or 0, tostring(p)))
		last = p
	end
	track:Stop(0)
end
```

## 16. Projectiles and hit feedback on the client (verified 2026-10-29)

- Never render server-moved anchored parts as projectiles: they update at about 30 Hz and look
  choppy.
- Two routes shipped. Either share a deterministic flight module between the server (damage) and
  the clients (visuals), or have the server send origin, directions, speed and range once and let
  every client simulate its own copy with the same raycast rules. Impacts are client-side.
- Physics objects the server must move (thrown bombs): tag them with CollectionService (instances
  passed through RemoteEvents arrive nil before they stream in), hide the server part on each client
  with `LocalTransparencyModifier`, and draw a client carrier interpolated 0.08 s behind buffered
  position samples.
- Hit-only feedback: the attacker's client resolves its own hits (filtering self, allies and
  summons) and sends the targets through the replicate-VFX remote; every client mounts the marks on
  the target's root with `EmitDelays` matching the contact frames, oriented toward the attacker.
  Those targets drive visuals only; the server still decides damage (section 6), and the remote
  needs the usual validation and rate limit (`roblox-networking`, guideline).
- Tracers are in section 3 ("Gun shots").

## 17. Resource-drain wisps (verified 2026-10-29)

For life steal, essence and similar drains:

- The wisp is a 0.2-stud part carrying a Trail (no texture, a colour gradient) and a glow.
- Fly it on a cubic bezier from a random visible body part of the target (parts of at least 1 stud;
  start point within 35 percent of the part's extents) to the caster's chest in 0.3 to 0.42 s,
  eased with `progress ^ 1.4`.
- Bend it with two random perpendicular offsets on the control points: about 2.4 studs, the second
  scaled by 0.6.
- Play an absorb flash on arrival, at most one per frame.
- Time the wisps to when the server grants the resource, and skip them when it is already full.

A sketch of the path (guideline; the numbers are the verified ones):

```luau
local function bezier(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): Vector3
	local u = 1 - t
	return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
end

local function randomPerpendicular(axis: Vector3): Vector3
	local v = axis:Cross(Vector3.new(math.random() - 0.5, math.random() - 0.5, math.random() - 0.5))
	return if v.Magnitude > 1e-3 then v.Unit else randomPerpendicular(axis)
end

-- each frame: t = math.clamp(elapsed / duration, 0, 1) ^ 1.4; p3 = the caster's chest now
local function wispPoint(p0: Vector3, p3: Vector3, bend1: Vector3, bend2: Vector3, t: number): Vector3
	local d = p3 - p0
	return bezier(p0, p0 + d / 3 + bend1, p0 + d * 2 / 3 + bend2, p3, t)
end
-- bend1 = randomPerpendicular(d.Unit) * 2.4; bend2 = randomPerpendicular(d.Unit) * 2.4 * 0.6
```

## 18. Dash afterimages (verified 2026-10-29)

The user preferred these to a trail for dashes:

- 3 or 4 afterimages: clones of the character with scripts, highlights, GUIs, sounds and lights
  stripped, and every part anchored.
- Spawn them 0.05 s apart with Transparency 0.8, 0.68, 0.55 and 0.42 (the oldest is the most
  transparent), and tween each to 1 over 0.35 s, then destroy it.
- Player characters are not Archivable, so `Clone()` returns nil until you set `Archivable = true`
  on the model; also keep parts that were invisible (HumanoidRootPart) at Transparency 1 and turn
  off CanCollide, CanQuery and CanTouch (guideline).

## 19. Charge indicators per stack (verified 2026-10-29)

For a weapon that charges in stacks:

- A persistent emitter on the weapon whose `Rate` is `stacks * 6` (crackling arcs).
- For each new stack, a ring pulse and an inward "absorb" flipbook (Inward Dust 16511173887).
- A flash at max stacks.
- Drive it from the server's charge state: emitter `Rate` and `Enabled` changes replicate to every
  client (section 6).

## 20. Capturing and reviewing in Studio (verified 2026-10-29)

Edit-mode captures:

- Pose rigs with `StepAnimations` (section 15), emit, wait, then freeze with `TimeScale = 0` on every
  emitter, plus a `Paused` flag your own scripts check for scripted motion such as beams and
  projectiles.
- Preload textures first (`ContentProvider:PreloadAsync` on the emitters), or the first capture
  renders blank.
- Rate-based emission does not advance in Edit mode: emit bursts when previewing.
- A StarterGui UI or a plugin's CoreGui overlay can cover the edit viewport: set
  `StarterGui.ShowDevelopmentGui = false` or disable the overlay for the capture, and restore it
  afterwards.

Play-mode captures:

- Hide the PlayerGui ScreenGuis.
- Lock the camera with `BindToRenderStep` at `Enum.RenderPriority.Last.Value + 1` (menu and
  class-selection scripts steal the camera otherwise).
- Raycast the camera spot so it is not inside a wall, and remember that the character turns to face
  the camera's look direction.
- For slow motion, set emitter `TimeScale` to 0.1 to 0.25 and divide `FadeTime` by the same factor,
  on the test client only.
- To catch a projectile mid-flight, wait for its instance (`ChildAdded`) instead of guessing the
  latency.

When captures fail: screenshots fail in Run mode, and the viewport returns a uniform dark frame
while the Studio window is in the background. Say so and continue with functional checks (counts of
spawned effects, damage dealt, attribute changes) instead of retrying.

## 21. Sourcing textures (verified 2026-10-29)

Ask which catalog the user likes. One that worked well is Zonito Visuals, a JSON list at
`https://raw.githubusercontent.com/ZonitoVFX/ZonitoVisuals/refs/heads/main/NewTextures.txt`:
category, then name, then `Texture`, `Type` and `Resolution` (some categories are lists).

1. Filter by keyword.
2. Render 18 to 24 candidates into one contact sheet: the thumbnails API
   (`https://thumbnails.roblox.com/v1/assets?assetIds=<ids>&size=420x420&format=Png`) returns one
   image URL per id.
3. Check alpha by counting transparent pixels per tile; a pure black tile has no alpha and needs
   LightEmission 1.
4. Prefer 1024 px textures, especially for big sprites.

Ids that shipped (all rendered in Studio):

| Id                       | Name                   | Notes                                                |
| ------------------------ | ---------------------- | ---------------------------------------------------- |
| 11627083142              | Dark Grey Smoke 2      | Grid8x8 OneShot; the only smoke to use (section 3)   |
| 16877842776              | clean ring             | Grid4x4                                              |
| 12656890572              | Fog Smoke Circle       | Grid8x8, ground dust ring                            |
| 138928814236581          | `ember_` streak        | vertical: Rotation 90 or -90 with `VelocityParallel` |
| 80768860709156           | 4-point flare          | 1024 px with alpha; big glints, sniper stars         |
| 13801456121              | Sparked Impact         | Grid2x2                                              |
| 12781785184              | helix beam             | railgun tracer, TextureSpeed 4                       |
| 15507852294              | thin energy beam       | tracer glow                                          |
| 15270205079              | thin lightning beam    | CurveSize randomised every frame                     |
| 14366190868, 14953431234 | Lightning Impact       | impacts                                              |
| 12800313372              | Bolt                   | Grid2x2                                              |
| 18765294301              | Lightning Orb          | Grid8x8, colour baked in (does not tint)             |
| 131880846582449          | Energy Spec            | specks                                               |
| 16504098653              | Basic Flame Wisp       | flames                                               |
| 119136869476760          | X Sketched             | hit mark                                             |
| 13466174548              | Thick Slash            | slashes                                              |
| 13992224965, 13463784319 | 3D Circle, 3D Triangle | confetti that tints well                             |
| 16511173887              | Inward Dust            | absorb, charge stacks                                |
| 136244099631576          | Heart flipbook         | hearts                                               |
| 13470068974              | Coloured Fire Glow     | Grid4x4, muzzle fire                                 |
| 13990048171              | Fire coloured blast    | muzzle blast                                         |
