# Building playbook (SealCode)

Written by SealCode from live research in Roblox Studio on 2026-10-23: 20 free Creator Store assets
were inserted and measured, a small village (terrain, four kit houses, a well, 105 props, tree
clusters, a pond and three paths) was built and reviewed from four camera angles, character
traversal was measured in a playtest, and streaming was checked on the client. Everything marked
"verified" was seen working in that session. Numbers marked "guideline" are SealCode defaults, not
benchmarks.

Load this file when you must build, dress or review a map or scene that has to look good. The
generic API notes (CSG, validation, folder layout, acceptance gates) are in `full.md`; this file is
the practical layer on top of it. Lighting is its own playbook:
`roblox-lighting/references/lighting-sealcode.md`.

## 1. Pick the route first

| Situation                                                      | Route                                                                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Outdoor map, natural ground, hills, water                      | Terrain for the ground (section 6), kits or parts on top                                                             |
| A town, a village, a city block                                | A modular kit on an 8-stud grid (section 4), assembled by code, then dressed (section 5)                             |
| One hero prop (a fountain, a statue, a landmark)               | Build it from parts or pieces of a kit (the well in section 3 is 14 stones, 2 posts and a scaled kit roof)           |
| Many copies of foliage, rocks, clutter                         | A low-poly pack, placed with the `put` helper (section 4): raycast to the ground, random yaw, scale 0.4 to 1.25      |
| Nothing in the store fits the style                            | Model it (`full.md`, "Modeling a custom mesh") or `generate_procedural_model`, then review it like a kit (section 4) |
| Obby, tower, arena: gameplay geometry where every stud matters | Parts, sized from the traversal table (section 2), never a kit whose collision you have not checked                  |

A store asset is only a candidate until you have audited it (section 4) and seen it in a screenshot
next to a character.

## 2. Human scale, measured

Default R15 character created with `Players:CreateHumanoidModelFromDescription` (verified):

| Measure                         | Value                                                        |
| ------------------------------- | ------------------------------------------------------------ |
| Bounding box (arms out)         | 3.95 wide, 5.46 tall, 1.16 deep                              |
| Head centre (use as eye height) | 4.87 above the feet                                          |
| HipHeight                       | 2.19                                                         |
| StarterPlayer defaults          | WalkSpeed 16, JumpHeight 7.2, JumpPower 50, MaxSlopeAngle 89 |

Traversal at those defaults, measured in a playtest by driving the character with `Humanoid:Move`
and `Humanoid.Jump` on the client (verified):

| Obstacle                            | Passes                       | Fails             |
| ----------------------------------- | ---------------------------- | ----------------- |
| Step, walking (no jump)             | 1, 1.5 and 2 studs           | 2.5 studs         |
| Ledge with a jump                   | up to 7.5 studs              | 8 studs and above |
| Gap with a running jump at the edge | 6, 8 and 9 studs             | 9.5 and 10 studs  |
| Wedge ramp                          | 30 to 60 degrees all climbed | (none failed)     |

So: a step that must not need a jump is at most 2 studs; a wall the player must not climb is at
least 8.5 studs (one stud of margin); an obby gap is easy at 6, medium at 8 and the hardest fair
gap is 9. A 60-degree wedge is still walkable with `MaxSlopeAngle` 89, so a steep slope is not a
wall: use a vertical part, an invisible blocker or lower `StarterPlayer.CharacterMaxSlopeAngle`.

Dimensions that read right next to that character (guideline, checked on the village):

| Element                | Size                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| Door opening           | 4 wide, 7 tall (the medieval kit's 3.6 x 6.6 opening fits the 5.46 character) |
| Storey / wall height   | 10 (kit walls), ceilings 10 to 12 inside                                      |
| Footpath               | 6 to 8 wide (8 for the main path, 6 for a side path)                          |
| Corridor               | 8 for one player, 12 for two side by side or a combat space                   |
| Plaza                  | radius 20 to 26 (26 in the village: four houses and a well fit around it)     |
| Lamp post              | 7 to 7.5 tall, every 30 degrees around a plaza, at 28 studs from its centre   |
| Table / counter / seat | 3 / 3.5 to 4 / 1.5 to 2                                                       |
| Barrel / crate         | 2.5 to 3 tall / 2 to 2.3 cube                                                 |
| Tree                   | 15 to 20 for a normal tree, 25 to 30 for a landmark                           |

Measure a store asset against the character before you place it: "Realistic Trees" (3256343670)
are 103 studs tall and "Realistic moss covered rocks" (13877742951) span 290 x 43 x 183. Use
`Model:ScaleTo(factor)` (verified: scales parts, meshes and offsets together) and never resize
parts one by one.

## 3. Composition: what made the village read

Verified by building it twice: first a blockout (terrain, four houses), then dressed. The blockout
read as "four boxes on a lawn"; the dressed version read as a place. The dressing, not the houses,
made the difference.

- **One focal point**, visible from every entrance: the well in the middle of the plaza, with the
  tallest thing in the scene (a sakura tree, 28 studs at scale 0.75) placed right behind it on the
  line of the main path. From the eye-level shot at the path entrance both line up.
- **Buildings face the focal point.** Each house is built in a local frame whose front faces the
  plaza centre (`CFrame.lookAt(housePos, plazaCentre)`), at 44 to 46 studs from it. Leave a gap in
  the ring wherever a path leaves.
- **Paths curve and lead somewhere.** Three quadratic-bezier paths leave the plaza between houses
  (8 and 6 studs wide), each bending once. A straight path from the spawn to the focal point is
  fine; every other path should bend so the player sees new things.
- **Three height layers**, all present in every view:
  - ground clutter, 0 to 2 studs: rocks, grass tufts, logs;
  - human layer, 2 to 12 studs: walls, doors, barrels, crates, fences, lamps;
  - skyline, 15 to 45 studs: roofs, trees, the landmark, hills.
- **Hills close the map.** Terrain rises outside a 70-stud radius to 8 to 42 studs. From eye level
  they hide the edge of the map; the top-down shot shows a square island with cliffs at the
  border, so never let the player get high enough to see it, or add an outer ring.
- **Groups, not grids.** Trees in 14 clusters of 3 to 5 (cluster spread 9 degrees and 10 studs),
  mixed models and scales 0.8 to 1.25 (round kit trees 1.3 to 2). Evenly spaced single trees look
  placed by a machine.
- **Where two things meet, hide the seam.** Bushes and rocks along every wall base, props at every
  door, rocks and grass along path edges (section 5).

## 4. Kits and free models

### Audit before use (verified)

Run this on anything you insert. It reports what matters for scale, cost and safety:

```luau
local function audit(root: Instance): string
	local c = {parts = 0, mesh = 0, union = 0, scripts = 0, decal = 0, tex = 0, sa = 0, light = 0, shadow = 0, unanchored = 0, tiny = 0, colors = {}, mats = {}}
	local minV, maxV = Vector3.one * 1e9, -Vector3.one * 1e9
	for _, x in root:GetDescendants() do
		if x:IsA("BasePart") then
			c.parts += 1
			if x:IsA("MeshPart") then c.mesh += 1 end
			if x:IsA("UnionOperation") then c.union += 1 end
			if x.CastShadow then c.shadow += 1 end
			if not x.Anchored then c.unanchored += 1 end
			if x.Size.Magnitude < 1 then c.tiny += 1 end
			c.mats[x.Material.Name] = (c.mats[x.Material.Name] or 0) + 1
			c.colors[x.Color:ToHex()] = true
			local cf, s = x.CFrame, x.Size / 2
			for _, p in {cf * s, cf * -s, cf * Vector3.new(s.X, -s.Y, -s.Z), cf * Vector3.new(-s.X, s.Y, s.Z)} do
				minV, maxV = minV:Min(p), maxV:Max(p)
			end
		elseif x:IsA("LuaSourceContainer") then c.scripts += 1
		elseif x:IsA("Texture") then c.tex += 1
		elseif x:IsA("Decal") then c.decal += 1
		elseif x:IsA("SurfaceAppearance") then c.sa += 1
		elseif x:IsA("Light") then c.light += 1 end
	end
	local mats, ncol = {}, 0
	for k, v in c.mats do table.insert(mats, k .. ":" .. v) end
	for _ in c.colors do ncol += 1 end
	local size = maxV - minV
	return string.format("%s parts=%d mesh=%d union=%d scripts=%d decal=%d texture=%d surfaceAppearance=%d lights=%d castShadow=%d unanchored=%d tiny=%d colours=%d size=%.0fx%.0fx%.0f materials=%s",
		root.Name, c.parts, c.mesh, c.union, c.scripts, c.decal, c.tex, c.sa, c.light, c.shadow, c.unanchored, c.tiny, ncol, size.X, size.Y, size.Z, table.concat(mats, ","))
end
```

Then read every script (`grep_scripts` or a dump of `Source`) and look at the asset next to a
character in a screenshot. What the audit caught in this session:

- **Hidden payloads.** "Corn Field" (8770128876) is a corn field with a hidden "Jeff the Killer" NPC
  inside (7 enabled scripts, including a respawn and AI script) and a copied "Bee Swarm Simulator"
  model. It came up in a search filtered to verified creators. Delete it; never ship it.
- **Unanchored parts.** Low Poly Nature Pack had 25 unanchored parts and Rocks (10355509588) had
  all 10 unanchored: they fall or roll on Play. Anchor every decoration part on insert.
- **Wrong scale.** See section 2 (103-stud pines, 290-stud boulders).
- **Hidden cost.** M2BK (13218099036) is 1,286 parts in a 12 x 5 x 15 box, 498 of them under 1
  stud. The Roblox city kit (13168370735) is 3,360 parts and 2,165 SurfaceAppearances in one
  folder. Take the pieces you need, not the whole kit.
- **Not a model.** "sci fi tiles pbr" (12300306502) inserts a `MaterialVariant`; move it to
  `MaterialService` and set `MaterialVariant` on parts.
- **Default collision on everything.** The medieval kit leaves `CollisionFidelity = Default` on
  every mesh, even 0.7-stud apples. Section 7 fixes that.
- Insert names lose spaces and symbols, and search results include keyword-stuffed listings with
  unicode creator names (for example a creator shown as "Robloxᅠᅠ"). Read the creator, not the
  title.

### Assets measured (all free, inserted on 2026-10-23)

"Used" means placed in the village and seen in screenshots; "inserted" means measured and seen in
the gallery shot only.

| Asset id        | Name (creator)                                       | Measured                                                                                                                                                                                                                   | Verdict                                                                                                                                 |
| --------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 70880145003040  | Medieval Village Kit - Lite (dgd419)                 | 10 models, 33 MeshParts, flat SmoothPlastic colours, no scripts; walls 8 x 10 x 1, roof 9.2 x 5.2 x 10.3, floor tile 8 x 0.5 x 8, lantern post 7.5, fence 8 x 3.3; every pivot at the bottom centre                        | Used. Best starting point for a stylised village: snaps to an 8-stud grid, harmonious palette (section 5). Set collision fidelity       |
| 9682467046      | Low Poly Nature Pack (Proudism)                      | 51 parts (47 MeshParts), no scripts, 25 unanchored; Normal Tree 15.9 x 17.9 x 17.1, Low Poly Tree 12.8 x 16.1, bushes 3 to 8, rocks 0.5 to 6, a 5.5-stud realistic grass tuft                                              | Used (trees, bushes, rocks, small grass). Anchor everything; recolour the rocks (section 5); drop the realistic tuft in low-poly scenes |
| 3725991689      | Sakura Tree (plentune)                               | 2 parts, 15 x 38 x 20                                                                                                                                                                                                      | Used as the landmark at scale 0.75                                                                                                      |
| 13168370735     | Modular Building Kit - Modern City (Roblox)          | 3,360 parts (3,025 MeshParts), 2,165 SurfaceAppearances, 734 Textures, 27 lights, 8 sit scripts (ProximityPrompt benches); 11 prefab buildings plus wall, cornice, awning, balcony and fire-escape pieces; 783 x 247 x 282 | Inserted and streamed (section 7). Realistic city style; copy single prefabs or pieces, never the whole folder                          |
| 112259601470653 | Hollowbrook Sampler (stayrot)                        | 4 textured MeshParts (fence 4 x 3, barrel, crate, lantern post with a PointLight), Box/Hull collision already set, no scripts                                                                                              | Inserted. Clean voxel-style props                                                                                                       |
| 580221169       | Tree (SheriffTaco)                                   | 36 MeshParts with Grass material leaves, 39 x 38 x 39                                                                                                                                                                      | Inserted. Big; scale 0.4 to 0.5                                                                                                         |
| 3256343670      | Realistic Trees (Chr1sDevv)                          | 7 pines, Fabric material, 103 studs tall                                                                                                                                                                                   | Inserted. Scale 0.3; realistic style only                                                                                               |
| 563810465       | Classic Tree (bloxiank)                              | 3 parts, 11 x 20 x 12                                                                                                                                                                                                      | Inserted. Classic blocky Roblox tree                                                                                                    |
| 10355509588     | Rocks (1Keeth)                                       | 10 MeshParts, one colour, all unanchored                                                                                                                                                                                   | Inserted. Anchor first                                                                                                                  |
| 14603612772     | Low Poly Rocks (neervu)                              | 1 MeshPart, 5 x 3 x 5                                                                                                                                                                                                      | Inserted. Fine filler rock                                                                                                              |
| 13877742951     | Realistic moss covered rocks (LcsLaur)               | 116 parts, 26 SurfaceAppearances, 72 decals, 290 x 43 x 183                                                                                                                                                                | Inserted. Huge boulders; realistic style; scale 0.1 to 0.3                                                                              |
| 18907927816     | Lamp & Bench (edeman1000)                            | 5 unions, 2 unanchored, 11 x 17 x 2                                                                                                                                                                                        | Inserted. Anchor; the lamp is 17 studs, too tall for a village                                                                          |
| 11886415505     | Official NDC Build Kit (Nostalgic Designs Co.)       | 529 parts (280 MeshParts), 95 colours, no scripts                                                                                                                                                                          | Inserted. Classic-brick style pieces                                                                                                    |
| 12082453761     | Texture Kit (Adventurous Towers)                     | 121 parts carrying 624 Texture objects                                                                                                                                                                                     | Inserted. A material sample board, not decoration                                                                                       |
| 13218099036     | M2BK Mini Modular Building Kit 2.0 test (Jump_Driv3) | 1,286 parts in 12 x 5 x 15, 498 under 1 stud                                                                                                                                                                               | Inserted. Counter-example: miniature detail costs as much as a full town                                                                |
| 2690222444      | Log House (StarModelX)                               | 221 parts (66 MeshParts), Wood, 41 x 22 x 48                                                                                                                                                                               | Inserted. Usable cabin                                                                                                                  |
| 9040395729      | Abandoned House (Pink2RosePetals)                    | 443 parts, 31 unions, 5 lights, 14 materials, 43 x 48 x 42                                                                                                                                                                 | Inserted. Horror set dressing; check its lights                                                                                         |
| 7111068101      | Concrete Sci-Fi Wall (WilliamBosso)                  | 79 parts, 36 Textures, 1 light, 15 x 13 x 31                                                                                                                                                                               | Inserted. One wall section                                                                                                              |
| 12300306502     | sci fi tiles pbr (thewarrior2446)                    | a MaterialVariant                                                                                                                                                                                                          | Inserted. Move to MaterialService                                                                                                       |
| 8770128876      | Corn Field (emi0606)                                 | 483 parts, 12 scripts, hidden NPC and copied model                                                                                                                                                                         | Rejected (see above)                                                                                                                    |

### Placing props (verified)

Raycast down to the ground, drop the bottom of the bounding box onto it, sink it a little so it
does not float on slopes, random yaw. `ScaleTo` before measuring.

```luau
local params = RaycastParams.new()
params.FilterType = Enum.RaycastFilterType.Exclude
params.FilterDescendantsInstances = {workspace.Village} -- whatever holds the props, so rays hit terrain
local rng = Random.new(7) -- fixed seed: the same layout every run

local function ground(x: number, z: number): number
	local hit = workspace:Raycast(Vector3.new(x, 200, z), Vector3.new(0, -400, 0), params)
	return if hit then hit.Position.Y else 0
end

local function put(src: Instance, x: number, z: number, scale: number?, yaw: number?, sink: number?): Model
	local clone = src:Clone()
	local m: Model
	if clone:IsA("Model") then
		m = clone
	else -- a bare MeshPart: wrap it so every prop is a Model
		m = Instance.new("Model")
		m.Name = src.Name
		clone.Parent = m
	end
	for _, d in m:GetDescendants() do if d:IsA("BasePart") then d.Anchored = true end end
	if scale and scale ~= 1 then m:ScaleTo(scale) end
	local cf, s = m:GetBoundingBox()
	local target = CFrame.new(x, ground(x, z) + s.Y / 2 - (sink or 0), z) * CFrame.Angles(0, yaw or rng:NextNumber(0, math.pi * 2), 0)
	m:PivotTo(target * cf:ToObjectSpace(m:GetPivot()))
	m.Parent = workspace.Village.Dressing
	return m
end
```

Sink values that looked right: trees 0.3, bushes 0.4 to 0.5, rocks 0.4 to 0.5, grass 0.2, props 0.

### Assembling a modular kit (verified)

Kit pieces with the pivot at the bottom centre and the decorated face on local -Z assemble from a
single frame per building. A two-cell cottage (16 x 8, 10 tall, two roofs):

```luau
local kit = workspace.Kits.MedievalVillageLite["Medieval Village Kit - Lite"]
local function piece(name) return kit[name]:Clone() end
local function place(m, cf, parent) m:PivotTo(cf) m.Parent = parent return m end

local function house(name: string, pos: Vector3, facing: Vector3, frontA: string, frontB: string): Model
	local hcf = CFrame.lookAt(pos, Vector3.new(facing.X, pos.Y, facing.Z)) -- local -Z faces the plaza
	local h = Instance.new("Model") h.Name = name
	for i, lx in {-4, 4} do
		local cell = hcf * CFrame.new(lx, 0, 0)
		place(piece(i == 1 and frontA or frontB), cell * CFrame.new(0, 0, -3.5), h)
		place(piece(i == 1 and "MV_wall_plain.001" or "MV_wall_window.001"), cell * CFrame.new(0, 0, 3.5) * CFrame.Angles(0, math.pi, 0), h)
		place(piece("MV_roof_single.001"), cell * CFrame.new(0, 10, 0), h)
	end
	place(piece("MV_wall_window.001"), hcf * CFrame.new(-7.5, 0, 0) * CFrame.Angles(0, -math.pi / 2, 0), h)
	place(piece("MV_wall_plain.001"), hcf * CFrame.new(7.5, 0, 0) * CFrame.Angles(0, math.pi / 2, 0), h)
	h.Parent = workspace.Village
	return h
end
-- house("HouseNE", centre + Vector3.new(36, 0, 25), centre, "MV_wall_door.001", "MV_wall_window.001")
```

Walls sit at +-3.5 from the cell centre (half the 8-stud cell minus half the 1-stud thickness),
side walls at +-7.5. Mix the door and window walls between houses so they do not repeat.

## 5. Materials, colour and detail

### Palette

The medieval kit's palette is a good model of a palette that works: warm neutrals for most of the
surface, one saturated accent, greens for life.

| Role              | Colours (hex)                       |
| ----------------- | ----------------------------------- |
| Walls (most area) | plaster efe0c1                      |
| Structure         | dark wood 6b4223, light wood b78249 |
| Accent (one only) | roof red a83f2b, shadow side 7f2b1e |
| Stone             | 999991, dark 6b6b68                 |
| Foliage           | 66a847, dark 3f7f38                 |
| Metal             | 474951                              |

Rules learned from the village screenshots:

- **Make terrain match the props.** Default terrain colours (Grass 6a7f3f, Ground 665c3b,
  Rock 666c6f) are olive and dull next to saturated low-poly props, and the default Ground on Grass
  nearly disappears at eye level, so the path did not read. These fixed both (verified):

```luau
local T = workspace.Terrain
T:SetMaterialColor(Enum.Material.Grass, Color3.fromRGB(96, 142, 64))
T:SetMaterialColor(Enum.Material.Ground, Color3.fromRGB(140, 110, 74))
T:SetMaterialColor(Enum.Material.Rock, Color3.fromRGB(128, 122, 114))
```

- **No cool bright greys.** The pack's rocks (9fa1ac on SmoothPlastic) read as plastic or ice
  under a blue sky. Warm grey 8a837a sat into the scene.
- **One style.** A realistic grass mesh in a low-poly scene was the first thing the eye found in
  the eye-level shot. Delete it rather than scale it.
- **Path contrast first.** The path must be clearly lighter or darker than the ground around it at
  eye level, in every lighting preset you ship. Check it in the night preset too.

### Detail that made the difference (verified in the dressed screenshots)

- At every door: a barrel 4.2 studs to one side, a crate 5 studs to the side and 1.6 out, a bush on
  the other side.
- Along each house: 5 bushes or rocks, 1 stud out from the wall (60 percent bushes), scale 0.5 to
  1.1, sunk 0.4 to 0.5. This removes the hard line where every wall meets the ground.
- Along each path: 14 to 22 rocks or small grass tufts, 5.5 to 8 studs from the centre line (just
  outside the path), random side, scale 0.4 to 1.1.
- Around water: rocks and tufts every 25 degrees at 17 to 21 studs from the pond centre, on a sand
  shore.
- One fenced garden behind a house with a log, so the back of the village is not empty.
- Wear (guideline, not tested here): use the kit's dark and light variants of the same material
  side by side, and the chips and wear rules in `full.md` for custom meshes. A uniform colour on a
  large surface reads as a placeholder.

## 6. Terrain

Terrain is stored in 4-stud voxels. Everything below follows from that (verified):

- **Fills thinner than 4 studs vanish or half-apply.** A 2-stud cobblestone cylinder and 2-stud
  paths left the ground mostly unchanged.
- **Repainting existing terrain needs full voxel coverage.** On solid grass, an axis-aligned
  4 x 4 x 4 `FillBlock` on the voxel grid turned Grass into Ground; the same block rotated by 0.3
  radians left the voxel as it was, and so did the partial edge voxels of a `FillCylinder`. Paint with
  grid-aligned cells (code below), or use `Terrain:ReplaceMaterial` on a grid-aligned region.
- **Order matters.** Fill first, carve (`Enum.Material.Air`) after. A sand ball placed before the
  air carve left a hollow sand dome on top of the pond.
- **`Terrain.Decoration` is not scriptable** from a plugin or a script. Set animated grass in the
  Properties panel (Terrain, Decoration) and tell the user.

Rolling hills outside a play area: 1,237 columns took 3.15 s and smoothed well because terrain
interpolates the 8-stud steps:

```luau
local T = workspace.Terrain
local C = Vector3.new(0, 0, -700) -- play area centre, ground top at y = 0
T:FillBlock(CFrame.new(C + Vector3.new(0, -8, 0)), Vector3.new(320, 16, 320), Enum.Material.Grass)
local step = 8
for x = -160, 156, step do
	for z = -160, 156, step do
		local r = Vector2.new(x, z).Magnitude
		if r > 70 then
			local edge = math.clamp((r - 70) / 80, 0, 1)
			local n = math.noise(x / 60, z / 60, 3.7) * 0.5 + 0.5
			local h = math.floor((edge ^ 1.6) * (8 + n * 34))
			if h > 1 then
				local mat = if h > 26 then Enum.Material.Rock elseif h > 16 then Enum.Material.Ground else Enum.Material.Grass
				T:FillBlock(CFrame.new(C + Vector3.new(x + step / 2, h / 2, z + step / 2)), Vector3.new(step, h, step), mat)
			end
		end
	end
	task.wait() -- one yield per row keeps Studio responsive
end
```

Painting a plaza and curved paths into the top voxel layer (y -4 to 0):

```luau
local function snap(v: number) return math.floor(v / 4 + 0.5) * 4 end
local function paintDisc(cx: number, cz: number, r: number, mat: Enum.Material)
	for x = -r, r, 4 do for z = -r, r, 4 do
		if x * x + z * z <= r * r then
			T:FillBlock(CFrame.new(snap(C.X + cx + x) + 2, -2, snap(C.Z + cz + z) + 2), Vector3.new(4, 4, 4), mat)
		end
	end end
end
local function paintPath(p0: Vector2, p1: Vector2, p2: Vector2, width: number, mat: Enum.Material)
	local n = math.ceil((p2 - p0).Magnitude / 2)
	for i = 0, n do
		local t = i / n
		local p = (1 - t) ^ 2 * p0 + 2 * (1 - t) * t * p1 + t ^ 2 * p2 -- quadratic bezier
		paintDisc(p.X, p.Y, width / 2, mat)
	end
end
paintDisc(0, 0, 26, Enum.Material.Cobblestone)
paintPath(Vector2.new(0, 24), Vector2.new(30, 70), Vector2.new(10, 150), 8, Enum.Material.Ground)
```

A pond (rendered correctly, water surface just below the ground):

```luau
local P = C + Vector3.new(-55, 0, 50)
T:FillBall(P + Vector3.new(0, 2, 0), 16, Enum.Material.Air)                          -- dig the bowl
T:FillBlock(CFrame.new(P + Vector3.new(0, 10, 0)), Vector3.new(50, 20, 50), Enum.Material.Air)
T:FillBall(P + Vector3.new(0, 2, 0), 15, Enum.Material.Water)                        -- fill it
T:FillBlock(CFrame.new(P + Vector3.new(0, 9.5, 0)), Vector3.new(50, 20, 50), Enum.Material.Air) -- cut the water flat
for a = 0, 355, 6 do                                                                  -- sand shore
	local d = Vector2.new(math.cos(math.rad(a)), math.sin(math.rad(a)))
	paintDisc(-55 + d.X * 16, 50 + d.Y * 16, 4, Enum.Material.Sand)
end
```

Check terrain with `Terrain:ReadVoxels(region:ExpandToGrid(4), 4)` at a few points after each step;
the village plaza first read Cobblestone at 20 studs from the centre and Grass at 22, which is how
the voxel-coverage rule above was found.

## 7. Performance

### What the village cost (verified, Stats service in Studio)

| Measure                                     | Village (whole scene)                             |
| ------------------------------------------- | ------------------------------------------------- |
| Parts                                       | 572 (553 MeshParts, 52 unique MeshIds)            |
| Draw calls / triangles, wide eye-level view | 109 / 73k                                         |
| Terrain                                     | about 49,000 solid voxels in a 320 x 64 x 320 box |

Read these live with `game:GetService("Stats")`: `SceneDrawcallCount`, `SceneTriangleCount`,
`ShadowsDrawcallCount`, `RenderCPUFrameTime`, `RenderGPUFrameTime`, `InstanceCount`,
`PrimitivesCount` (all readable from the bridge in Studio). Average them over a couple of seconds
of `RenderStepped` from the camera the player will use.

Budgets (guideline): reuse the same few meshes (52 unique ids made the whole village; copies of a
mesh with the same material are cheap to draw), keep a scene that runs on phones to a few hundred
draw calls and a few hundred thousand triangles in view, and keep tiny parts rare (M2BK spent 498
parts under 1 stud on a 12 x 15 footprint).

### Optimisation pass for decoration (verified)

On the village it left 286 parts without shadows, 138 without collision and 437 MeshParts on Box
or Hull collision. Changing `CollisionFidelity` rebuilds collision geometry: the first unchunked
run over 553 MeshParts outlasted the tool call, so yield every 100 parts.

```luau
-- Only for decoration (props, foliage, clutter). Never run it on gameplay geometry.
local function optimiseDressing(root: Instance): number
	local changed = 0
	for i, d in root:GetDescendants() do
		if d:IsA("BasePart") then
			local diag = d.Size.Magnitude
			if diag < 4 then
				d.CastShadow = false
				d.CanCollide, d.CanQuery, d.CanTouch = false, false, false
				changed += 1
			elseif d:IsA("MeshPart") and d.CanCollide and d.CollisionFidelity == Enum.CollisionFidelity.Default then
				d.CollisionFidelity = if diag < 12 then Enum.CollisionFidelity.Box else Enum.CollisionFidelity.Hull
				changed += 1
			end
		end
		if i % 100 == 0 then task.wait() end
	end
	return changed
end
```

Keep collision on anything a player must stand on or be blocked by (walls, floors, fences at the
map edge); turn it off on clutter the player walks through anyway.

### StreamingEnabled (verified on the client)

- `workspace.StreamingEnabled` can be set from the bridge; `StreamingMinRadius`,
  `StreamingTargetRadius`, `StreamOutBehavior` and `ModelStreamingBehavior` could not even be
  read from it. Set those in the Properties panel and say so.
- With the defaults, a 3,360-part city 1,200 studs from the spawn was absent on the client (0 parts)
  while the server had all of it; a village 700 studs away was fully present. Teleporting next to
  the city streamed all 3,360 parts in within 1 second.
- Walking away did not stream anything out: 1,850 studs from the village all 572 parts stayed. The
  default stream-out only happens under memory pressure, so streaming reduces join time and memory
  on big maps but does not cap what a desktop renders. Use distance-based culling or
  `Model.LevelOfDetail` for that.
- With streaming on, client code must not assume a far part exists: `WaitForChild` with a timeout,
  `Player:RequestStreamAroundAsync(position)` before a teleport (verified: returned without error),
  and `ModelStreamingMode = Atomic` on models that must arrive whole.

## 8. Review checklist (screenshots from several angles)

Capture each of these after the last change (`capture_screenshot` with a camera position and target,
or the `camera` tool). Use the real lighting preset.

| Shot          | Camera                                                                                                         | What it catches                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Eye level     | 5 to 6 studs above the ground at each entrance, looking at the focal point                                     | composition, path readability, scale, style mismatches |
| Third person  | 8 studs behind and 5 to 7 above a character, looking at it                                                     | what the player actually sees most of the time         |
| Three-quarter | 40 to 45 up and 60 back from the centre                                                                        | layout, spacing, clusters, empty zones                 |
| Top-down      | 200 up, 80 to the side of the centre (a perfectly vertical look-at flipped the camera and dropped the terrain) | paths, map edges, symmetry, holes                      |

Check each item against the screenshots:

- Is there one focal point that every entrance looks at, with the tallest element behind it?
- Do all three height layers (clutter, human, skyline) appear in the eye-level shot?
- Does everything read at the character's scale: doors at least 4 x 7, steps at most 2 unless a
  jump is intended, gaps at most 9, walls that must block at least 8.5?
- Does the path contrast with the ground at eye level, in every lighting preset?
- Do terrain colours match the props, and is there only one art style?
- Is every wall base, door and path edge dressed, with no prop floating or buried?
- Are trees and rocks in groups with varied scale and yaw, not grids?
- Is the map edge hidden from every place the player can stand?
- Is every decoration part anchored, with no unread script and no stray asset (audit, section 4)?
- Did the optimisation pass run on the dressing, and are the counts within budget (section 7)?
- With StreamingEnabled, does client code survive a part that has not streamed in yet?
- Does the place still play: run the traversal checks from section 2 on the real paths?
