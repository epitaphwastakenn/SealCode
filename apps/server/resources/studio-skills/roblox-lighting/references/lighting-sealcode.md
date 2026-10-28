# Lighting playbook (Harp)

Written by Harp from live research in Roblox Studio on 2026-10-23. Eight atmosphere presets
were tuned on three test sets (a low-poly village with terrain, a fireplace room and a neon
corridor), each with a character as the subject. Every preset was checked in a screenshot and
measured from the rendered pixels (CaptureService plus EditableImage, section 6). Graphics quality
levels, skyboxes, a day-night cycle and the cost of each effect were measured too. Everything marked
"verified" was seen working in that session. Numbers marked "guideline" are Harp defaults, not
benchmarks.

Load this file when you must set up, change or review the look of a place. The property reference
is in `full.md`; this file is the practical layer on top of it. Building and dressing the scene is
`roblox-building/references/building-sealcode.md`.

## 1. Ground rules

- **A preset sets every field.** Lighting, Atmosphere, Sky, Bloom, ColorCorrection, SunRays and
  DepthOfField, all of them, every time. A preset that only changes a few values inherits the last
  mood and nobody can reproduce the result. `LightingPresets.apply` (section 2) does that.
- **Lighting style.** All presets were tuned with `Lighting.LightingStyle = Realistic` and
  `PrioritizeLightingQuality = true` (both settable from the bridge; a new place file started on
  Soft). Soft barely changed the sunny village (mean luminance 0.302 to 0.302) but lifted the
  fireplace room from 0.082 to 0.178 and its crushed blacks from 12.9 to 3.0 percent. Choose the
  style first, then tune. `Lighting.Technology` cannot even be read from the bridge; it is
  deprecated, so do not plan around it.
- **The sky lights the scene.** With `EnvironmentDiffuseScale = 1` the skybox colours the ambient
  light. A flat orange "sunset" skybox (627302570) turned every white wall pink. Pick the sky with
  the lighting, not after it.
- **Practical lights are part of the preset.** Night, horror and interiors need local lights at
  known values. `apply` sets every light tagged `PresetLamp`.
- **Test with a character in frame**, in the place's real colours, at the distance the player sees
  it (section 6). Dark-green trousers vanished on grass in the first test; any avatar colour can.

## 2. The presets (verified)

Measured from the third-person camera (8 studs behind and 6 above the character) on the village,
inside the room for CozyInterior and down the corridor for SciFiNeon. Columns: mean linear
luminance of the frame, crushed (pixels with every channel at most 20 of 255), clipped (every
channel at least 250), luminance contrast between the character's torso and its surroundings, and
the Oklab colour difference between them (section 6 says how to read these).

| Preset           | Mean  | Crushed | Clipped | Contrast | Colour diff | Look in the screenshot                                                                    |
| ---------------- | ----- | ------- | ------- | -------- | ----------- | ----------------------------------------------------------------------------------------- |
| SunnyDay         | 0.302 | 0.0%    | 0.1%    | 1.65     | 0.232       | clean, crisp shadows, blue sky, readable path                                             |
| Sunset           | 0.263 | 0.0%    | 0.1%    | 1.52     | 0.163       | low warm sun from the side, pink haze, golden clouds                                      |
| Night            | 0.052 | 0.3%    | 0.0%    | 1.77     | 0.199       | blue moonlight, warm lamp pools, starry sky                                               |
| Horror           | 0.032 | 0.0%    | 0.0%    | 1.47     | 0.119       | desaturated, grey fog, dim lamp pools; the character still reads                          |
| SciFiNeon        | 0.063 | 11-45%  | 0.0%    | 2.03     | 0.166       | dark metal, crisp cyan and magenta neon, character backlit by the door                    |
| Fantasy          | 0.209 | 0.0%    | 0.1%    | 1.10     | 0.231       | lavender sky with stylised clouds, purple haze, soft bloom                                |
| CozyInterior     | 0.085 | 10.3%   | 0.0%    | 2.58     | 0.319       | warm fire glow on plaster, dark corners, no blown-out walls                               |
| CartoonSimulator | 0.516 | 0.0%    | 3.0%    | 1.69     | 0.296       | saturated, bright, soft short shadows, cartoon clouds (the clipped pixels are the clouds) |

The SciFiNeon crushed figure moved between 11 and 45 percent across repeated captures because the
dark wall pixels sit right at the threshold; its mean and contrast were stable.

```luau
-- LightingPresets: every preset sets every field, so switching never leaves the previous mood behind.
local Lighting = game:GetService("Lighting")
local rgb = Color3.fromRGB

local function faces(bk, dn, ft, lf, rt, up)
	local function id(n) return "rbxassetid://" .. n end
	return { SkyboxBk = id(bk), SkyboxDn = id(dn), SkyboxFt = id(ft), SkyboxLf = id(lf), SkyboxRt = id(rt), SkyboxUp = id(up) }
end

-- Skybox faces that rendered in Studio (section 3). nil = the engine's default sky.
local SKY = {
	SunsetGold = faces(600830446, 600831635, 600832720, 600886090, 600833862, 600835177),
	CartoonPastel = faces(15114954171, 15114958869, 15114963740, 15114957947, 15114955238, 15114948718),
	NightFog = faces(1370717244, 1370717336, 1370717438, 1370717567, 1370717698, 1370717782),
}

local P = {}

P.SunnyDay = {
	lighting = { ClockTime = 14, GeographicLatitude = 35, Brightness = 3, ExposureCompensation = 0,
		Ambient = rgb(40, 40, 50), OutdoorAmbient = rgb(120, 125, 135),
		ColorShift_Top = rgb(255, 245, 225), ColorShift_Bottom = rgb(0, 0, 0),
		EnvironmentDiffuseScale = 1, EnvironmentSpecularScale = 1, ShadowSoftness = 0.2, GlobalShadows = true },
	atmosphere = { Density = 0.3, Offset = 0.25, Color = rgb(199, 213, 232), Decay = rgb(106, 124, 155), Glare = 0, Haze = 1 },
	sky = { SunAngularSize = 14, MoonAngularSize = 11, StarCount = 3000, CelestialBodiesShown = true },
	bloom = { Intensity = 0.6, Size = 24, Threshold = 2 },
	colorCorrection = { Brightness = 0, Contrast = 0.05, Saturation = 0.1, TintColor = rgb(255, 255, 255) },
	sunRays = { Intensity = 0.06, Spread = 0.8 },
}

P.Sunset = {
	lighting = { ClockTime = 17.3, GeographicLatitude = 35, Brightness = 3, ExposureCompensation = 0.15,
		Ambient = rgb(60, 45, 50), OutdoorAmbient = rgb(165, 120, 110),
		ColorShift_Top = rgb(255, 170, 110), ColorShift_Bottom = rgb(60, 40, 90),
		EnvironmentDiffuseScale = 1, EnvironmentSpecularScale = 1, ShadowSoftness = 0.3, GlobalShadows = true },
	atmosphere = { Density = 0.38, Offset = 0.1, Color = rgb(255, 190, 150), Decay = rgb(180, 100, 90), Glare = 2.5, Haze = 2 },
	sky = { faces = SKY.SunsetGold, SunAngularSize = 18, MoonAngularSize = 11, StarCount = 3000, CelestialBodiesShown = true },
	bloom = { Intensity = 0.8, Size = 30, Threshold = 1.6 },
	colorCorrection = { Brightness = 0, Contrast = 0.1, Saturation = 0.15, TintColor = rgb(255, 235, 220) },
	sunRays = { Intensity = 0.15, Spread = 0.5 },
	lamps = { Brightness = 1, Range = 14, Color = rgb(255, 190, 120) },
}

P.Night = {
	lighting = { ClockTime = 0, GeographicLatitude = 35, Brightness = 1.5, ExposureCompensation = 0.3,
		Ambient = rgb(40, 45, 70), OutdoorAmbient = rgb(70, 80, 120),
		ColorShift_Top = rgb(150, 170, 255), ColorShift_Bottom = rgb(0, 0, 0),
		EnvironmentDiffuseScale = 1, EnvironmentSpecularScale = 0.5, ShadowSoftness = 0.3, GlobalShadows = true },
	atmosphere = { Density = 0.35, Offset = 0, Color = rgb(60, 70, 110), Decay = rgb(20, 25, 50), Glare = 0, Haze = 1 },
	sky = { SunAngularSize = 14, MoonAngularSize = 14, StarCount = 3000, CelestialBodiesShown = true },
	bloom = { Intensity = 1, Size = 30, Threshold = 1.2 },
	colorCorrection = { Brightness = 0.02, Contrast = 0.1, Saturation = -0.1, TintColor = rgb(215, 225, 255) },
	lamps = { Brightness = 1.5, Range = 18, Color = rgb(255, 190, 120) },
}

P.Horror = {
	lighting = { ClockTime = 0.5, GeographicLatitude = 35, Brightness = 1, ExposureCompensation = 0.5,
		Ambient = rgb(40, 40, 48), OutdoorAmbient = rgb(70, 75, 85),
		ColorShift_Top = rgb(90, 100, 110), ColorShift_Bottom = rgb(0, 0, 0),
		EnvironmentDiffuseScale = 1, EnvironmentSpecularScale = 0.3, ShadowSoftness = 0.5, GlobalShadows = true },
	atmosphere = { Density = 0.5, Offset = 0, Color = rgb(90, 96, 100), Decay = rgb(35, 38, 42), Glare = 0, Haze = 2 },
	sky = { faces = SKY.NightFog, StarCount = 0, CelestialBodiesShown = false },
	bloom = { Intensity = 0.4, Size = 20, Threshold = 1.5 },
	colorCorrection = { Brightness = 0, Contrast = 0, Saturation = -0.45, TintColor = rgb(215, 225, 220) },
	depthOfField = { FarIntensity = 0.3, FocusDistance = 20, InFocusRadius = 30, NearIntensity = 0 },
	lamps = { Brightness = 1.5, Range = 14, Color = rgb(255, 170, 110) },
}

P.SciFiNeon = {
	lighting = { ClockTime = 22, GeographicLatitude = 35, Brightness = 1, ExposureCompensation = 0.3,
		Ambient = rgb(50, 50, 75), OutdoorAmbient = rgb(40, 30, 70),
		ColorShift_Top = rgb(120, 80, 255), ColorShift_Bottom = rgb(0, 0, 0),
		EnvironmentDiffuseScale = 0.6, EnvironmentSpecularScale = 1, ShadowSoftness = 0.2, GlobalShadows = true },
	atmosphere = { Density = 0.4, Offset = 0, Color = rgb(60, 40, 110), Decay = rgb(20, 10, 50), Glare = 0, Haze = 2 },
	sky = { StarCount = 3000, CelestialBodiesShown = false },
	bloom = { Intensity = 0.6, Size = 24, Threshold = 1.3 },
	colorCorrection = { Brightness = 0, Contrast = 0.1, Saturation = 0.2, TintColor = rgb(230, 225, 255) },
}

P.Fantasy = {
	lighting = { ClockTime = 16.5, GeographicLatitude = 35, Brightness = 2.5, ExposureCompensation = 0,
		Ambient = rgb(70, 50, 90), OutdoorAmbient = rgb(150, 120, 170),
		ColorShift_Top = rgb(255, 200, 240), ColorShift_Bottom = rgb(80, 40, 120),
		EnvironmentDiffuseScale = 1, EnvironmentSpecularScale = 1, ShadowSoftness = 0.4, GlobalShadows = true },
	atmosphere = { Density = 0.4, Offset = 0.15, Color = rgb(235, 190, 255), Decay = rgb(140, 90, 200), Glare = 0, Haze = 2.2 },
	sky = { faces = SKY.CartoonPastel, SunAngularSize = 16, CelestialBodiesShown = true },
	bloom = { Intensity = 0.8, Size = 36, Threshold = 1.7 },
	colorCorrection = { Brightness = 0.02, Contrast = 0.05, Saturation = 0.3, TintColor = rgb(255, 232, 255) },
	sunRays = { Intensity = 0.12, Spread = 0.7 },
	depthOfField = { FarIntensity = 0.15, FocusDistance = 40, InFocusRadius = 60, NearIntensity = 0 },
}

P.CozyInterior = {
	lighting = { ClockTime = 19, GeographicLatitude = 35, Brightness = 1, ExposureCompensation = 0.2,
		Ambient = rgb(80, 62, 48), OutdoorAmbient = rgb(70, 60, 80),
		ColorShift_Top = rgb(255, 190, 130), ColorShift_Bottom = rgb(0, 0, 0),
		EnvironmentDiffuseScale = 0.5, EnvironmentSpecularScale = 0.5, ShadowSoftness = 0.4, GlobalShadows = true },
	atmosphere = { Density = 0.3, Offset = 0, Color = rgb(120, 100, 110), Decay = rgb(60, 50, 70), Glare = 0, Haze = 0 },
	sky = { SunAngularSize = 14, MoonAngularSize = 11, StarCount = 3000, CelestialBodiesShown = true },
	bloom = { Intensity = 0.7, Size = 24, Threshold = 1.2 },
	colorCorrection = { Brightness = 0, Contrast = 0.1, Saturation = 0.1, TintColor = rgb(255, 235, 210) },
}

P.CartoonSimulator = {
	lighting = { ClockTime = 13, GeographicLatitude = 0, Brightness = 3.5, ExposureCompensation = 0,
		Ambient = rgb(110, 110, 120), OutdoorAmbient = rgb(170, 170, 180),
		ColorShift_Top = rgb(255, 250, 240), ColorShift_Bottom = rgb(0, 0, 0),
		EnvironmentDiffuseScale = 1, EnvironmentSpecularScale = 0.3, ShadowSoftness = 0.6, GlobalShadows = true },
	atmosphere = { Density = 0.2, Offset = 0.5, Color = rgb(200, 230, 255), Decay = rgb(150, 200, 255), Glare = 0, Haze = 0 },
	sky = { faces = SKY.CartoonPastel, SunAngularSize = 14, CelestialBodiesShown = true },
	bloom = { Intensity = 0.4, Size = 24, Threshold = 2 },
	colorCorrection = { Brightness = 0.03, Contrast = 0.1, Saturation = 0.35, TintColor = rgb(255, 255, 255) },
}

local EFFECTS = { BloomEffect = "bloom", ColorCorrectionEffect = "colorCorrection", SunRaysEffect = "sunRays", DepthOfFieldEffect = "depthOfField" }

local function child(class)
	local c = Lighting:FindFirstChildWhichIsA(class)
	if not c then c = Instance.new(class) c.Parent = Lighting end
	return c
end

-- Applies one preset. Lights tagged "PresetLamp" take the preset's lamp values (or switch off).
function P.apply(p)
	for k, v in p.lighting do Lighting[k] = v end
	local a = child("Atmosphere")
	for k, v in p.atmosphere do a[k] = v end
	local old = Lighting:FindFirstChildWhichIsA("Sky")
	if old then old:Destroy() end
	local sky = Instance.new("Sky")
	for k, v in p.sky.faces or {} do sky[k] = v end
	for k, v in p.sky do if k ~= "faces" then sky[k] = v end end
	sky.Parent = Lighting
	for class, key in EFFECTS do
		local e = child(class)
		local cfg = p[key]
		e.Enabled = cfg ~= nil
		for k, v in cfg or {} do e[k] = v end
	end
	for _, light in game:GetService("CollectionService"):GetTagged("PresetLamp") do
		light.Enabled = p.lamps ~= nil
		if p.lamps then light.Brightness, light.Range, light.Color = p.lamps.Brightness, p.lamps.Range, p.lamps.Color end
	end
end

P.SKY = SKY
return P
```

Use it from the server (Lighting replicates) for a fixed mood, or from the client for local
effects such as a zone change. Lamps are `PointLight`s tagged `PresetLamp` with `Shadows = false`.

### Per-preset notes

- **SunnyDay.** Brightness 3 and a cool OutdoorAmbient give contrast without washing out. Bloom
  threshold 2 means only HDR highlights bloom.
- **Sunset.** The sun must be at least 10 degrees up where the player looks. At ClockTime 17.8 the
  sun was 3 degrees up and the hills around the valley put the whole village in shadow (mean 0.074,
  contrast 1.15); 17.3 (10.3 degrees) fixed it. Check `math.deg(math.asin(Lighting:GetSunDirection().Y))`.
  The SunsetGold sky raised the contrast from 1.23 (default sky) to 1.52.
- **Night.** Exposure +0.3 and a blue OutdoorAmbient keep the ground visible; lamps do the rest.
  Lamps at Brightness 2 next to white plaster overexposed the walls; 1.5 at Range 18 did not.
- **Horror.** The first version (Brightness 0.5, Ambient 15,15,20, ColorCorrection Contrast 0.25)
  was 93.7 percent crushed and the character disappeared. ColorCorrection Contrast was the main
  culprit (section 4). The working recipe: darkness from the sky and fog, a grey fog lighter than
  the objects so silhouettes read against it, and colour removed with Saturation, never with
  Contrast.
- **SciFiNeon.** Neon parts glow but do not light anything: add a `PointLight` (Range 10,
  Brightness 1.2, the strip's colour, no shadows) next to each strip. Bloom 1.5/40/0.9 turned the
  strips into blobs and hid the character (colour difference 0.060); 0.6/24/1.3 kept the neon
  crisp.
- **Fantasy.** Glare 1.5 with Haze 2.5 clipped 6 percent of the frame toward the sun; Glare 0 with
  Haze 2.2 kept the lavender air without blowing out. The default sky stayed plain blue whatever
  the Atmosphere did; the CartoonPastel sky gave the fantasy look.
- **CozyInterior.** The fire `PointLight` at Brightness 2.5, Range 22 turned the plaster wall 7
  studs away solid orange; 1.8 at Range 18 (lamp 1.2 at Range 14) with Ambient 80,62,48 and
  Exposure +0.2 looked warm without hot spots. Practical lights used: fire 255,140,60 with
  shadows, lamp 255,190,120 with shadows.
- **CartoonSimulator.** Latitude 0 at 13:00 puts the sun almost overhead, so shadows are short and
  soft (ShadowSoftness 0.6). EnvironmentSpecularScale 0.3 removes plastic shine. Saturation 0.35
  is the ceiling before greens look radioactive.

## 3. Skyboxes (checked in Studio on 2026-10-23)

| Model id    | Name (creator)                            | Faces                      | Result                                                                                                                 |
| ----------- | ----------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 5186800496  | Sunset SkyBox with sun (DotDDotexe)       | 600830446 to 600886090     | Verified: golden low clouds, warm horizon. `SKY.SunsetGold`                                                            |
| 15387348852 | Cartoon SkyBox (DobbiyBlox)               | 15114948718 to 15114963740 | Verified: stylised streak clouds; cyan by day, pastel lavender with the Fantasy atmosphere. `SKY.CartoonPastel`        |
| 1864839162  | Night Fog Skybox (empIoyer)               | 1370717244 to 1370717782   | Verified: dark grey murk, no stars. `SKY.NightFog`                                                                     |
| 15803128405 | Night Skybox (STREETBALL by JakeGreenway) | 5346760450 to 5346761509   | Renders flat black with stars. The default sky at night has a blue gradient and looked better                          |
| 627302570   | Sunset Skybox (TracyCyanne)               | 541743435 to 541743453     | Flat saturated orange; with EnvironmentDiffuseScale 1 it tinted the whole scene. Only for an alien or apocalyptic look |
| 136402262   | Realistic Space Skybox (Hydrablox)        | 155441777 to 155441936     | Rendered black: the faces do not load. Rejected; use the default sky with stars                                        |
| (none)      | default `Sky`                             | engine textures            | Good day sky; turns to a starry gradient at night by itself, so the day-night cycle uses it                            |

Insert a sky model in Studio, copy its six `Skybox*` ids into code (as `faces` does) and delete
the model. A model you cannot insert at runtime is no use to a running game; ids are.

## 4. What breaks a look (all measured)

| Change                                                        | Effect                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| ColorCorrection Contrast 0.15 in a dark scene                 | crushed pixels from 4.4% to 78.4%                                      |
| Atmosphere Density 0.9 in daylight                            | character colour difference from 0.232 to 0.056: it melts into the fog |
| Bloom 1 / 56 / Threshold 0.3                                  | mean from 0.30 to 0.60, contrast 1.65 to 1.06                          |
| Atmosphere Glare 1.5 + Haze 2.5 looking toward the sun        | 6% of the frame clipped                                                |
| Sun 3 degrees above the horizon behind hills                  | the whole valley in shadow (mean 0.074)                                |
| A saturated skybox with EnvironmentDiffuseScale 1             | white walls turned the sky's colour                                    |
| A PointLight at Brightness 2.5, Range 22, 7 studs from a wall | the wall clips to flat orange                                          |

Raising Exposure, OutdoorAmbient, Brightness or switching ClockTime barely moved the broken horror
version (mean 0.009 to 0.019); disabling ColorCorrection moved it to 0.020 and 4.4 percent crushed.
When a scene looks crushed, toggle each post effect first.

## 5. Day-night cycle (verified)

Each client derives the clock from `workspace:GetServerTimeNow()`, so every player sees the same sky
with no remotes and no replication traffic. Verified in a playtest: server and client computed the
same clock (a 4.06 s gap between the two calls was 0.135 in-game hours, exactly 4.06 x 24 / 720),
and a client-side change did not touch the server's Lighting (server stayed at its own ClockTime).
Server code that needs "is it night" calls the same `clockAt`.

```luau
-- DayNight: blends Lighting, Atmosphere, ColorCorrection and Bloom between presets by time of day.
local Lighting = game:GetService("Lighting")
local CollectionService = game:GetService("CollectionService")

local DayNight = {}

DayNight.DAY_SECONDS = 720 -- one in-game day lasts 12 real minutes
DayNight.START_CLOCK = 9 -- clock when server time is 0

-- keys: { {t = hour, p = preset}, ... } with presets from LightingPresets
function DayNight.new(keys)
	table.sort(keys, function(a, b) return a.t < b.t end)
	return keys
end

local function lerp(a, b, f)
	if typeof(a) == "number" then return a + (b - a) * f end
	if typeof(a) == "Color3" then return a:Lerp(b, f) end
	return f < 0.5 and a or b -- booleans and anything else switch at the midpoint
end

local function blendGroup(target, a, b, f)
	if not target then return end
	for k, va in a do
		local vb = b[k]
		if vb ~= nil and k ~= "ClockTime" then target[k] = lerp(va, vb, f) end
	end
end

function DayNight.clockAt(serverTime)
	return (DayNight.START_CLOCK + serverTime / DayNight.DAY_SECONDS * 24) % 24
end

function DayNight.apply(keys, clock)
	-- find the keys around clock, wrapping past midnight
	local prev, nxt = keys[#keys], keys[1]
	for i, k in keys do
		if k.t <= clock then prev, nxt = k, keys[i + 1] or keys[1] end
	end
	local span = (nxt.t - prev.t) % 24
	local f = span == 0 and 0 or ((clock - prev.t) % 24) / span
	f = f * f * (3 - 2 * f) -- smoothstep: no visible kink at each key
	Lighting.ClockTime = clock
	blendGroup(Lighting, prev.p.lighting, nxt.p.lighting, f)
	blendGroup(Lighting:FindFirstChildWhichIsA("Atmosphere"), prev.p.atmosphere, nxt.p.atmosphere, f)
	local cc = Lighting:FindFirstChildWhichIsA("ColorCorrectionEffect")
	if cc and prev.p.colorCorrection and nxt.p.colorCorrection then blendGroup(cc, prev.p.colorCorrection, nxt.p.colorCorrection, f) end
	local bloom = Lighting:FindFirstChildWhichIsA("BloomEffect")
	if bloom and prev.p.bloom and nxt.p.bloom then blendGroup(bloom, prev.p.bloom, nxt.p.bloom, f) end
	-- practical lights tagged "NightLight" switch on between dusk and dawn
	local night = clock >= 18.3 or clock < 6.2
	for _, light in CollectionService:GetTagged("NightLight") do light.Enabled = night end
end

function DayNight.run(keys, hz)
	local period = 1 / (hz or 10)
	task.spawn(function()
		while true do
			DayNight.apply(keys, DayNight.clockAt(workspace:GetServerTimeNow()))
			task.wait(period)
		end
	end)
end

return DayNight
```

A LocalScript in `StarterPlayerScripts` (these keys were swept hour by hour in Studio):

```luau
local P = require(game.ReplicatedStorage.LightingPresets)
local DayNight = require(game.ReplicatedStorage.DayNight)
P.apply(P.SunnyDay) -- creates the Atmosphere, effects and a default Sky once
DayNight.run(DayNight.new({
	{t = 0, p = P.Night}, {t = 5, p = P.Night}, {t = 6.6, p = P.Sunset}, {t = 8.5, p = P.SunnyDay},
	{t = 16.3, p = P.SunnyDay}, {t = 17.6, p = P.Sunset}, {t = 19.4, p = P.Night},
}), 10)
```

Measured on the village: one `apply` costs 16 microseconds, so 10 updates a second is free; do not
run it every frame. The cycle keeps the default Sky (it handles sunrise, stars and the moon by
itself) and ignores the presets' `sky` and `lamps` fields; tag lamps `NightLight` instead. The
frame's mean luminance fell from 0.23 to 0.065 between 17.5 and 18.0 and rose from 0.029 to 0.185
between 6.0 and 6.5: that is the sun crossing the horizon, which no blend can smooth. With
`DAY_SECONDS = 720` half an in-game hour is 15 real seconds, which read as a natural dusk. Do
not tween ClockTime with TweenService across midnight; the modulo above wraps correctly.

## 6. Measuring legibility (verified)

`CaptureService:CaptureScreenshot` returns an `rbxtemp://` content id that
`AssetService:CreateEditableImageAsync(Content.fromUri(id))` opens as pixels (1247 x 804, the
viewport size) from the bridge in Edit mode. This meter turns a frame into the numbers used in
section 2:

```luau
local CaptureService = game:GetService("CaptureService")
local AssetService = game:GetService("AssetService")
local RunService = game:GetService("RunService")

local function lin(c) c = c / 255 return c <= 0.04045 and c / 12.92 or ((c + 0.055) / 1.055) ^ 2.4 end
local LUT = {} for i = 0, 255 do LUT[i] = lin(i) end
local function oklab(r, g, b)
	local l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ^ (1 / 3)
	local m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ^ (1 / 3)
	local s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ^ (1 / 3)
	return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
end

-- Renders from cam, returns frame statistics and, with a subject Model, how well it stands out.
local function measure(cam: CFrame, subject: Model?)
	local camera = workspace.CurrentCamera
	camera.CFrame = cam
	for _ = 1, 4 do RunService.RenderStepped:Wait() end
	task.wait(0.4)
	local id
	CaptureService:CaptureScreenshot(function(c) id = c end)
	local t0 = os.clock()
	while not id and os.clock() - t0 < 8 do task.wait(0.05) end
	assert(id, "capture timed out")
	local img = AssetService:CreateEditableImageAsync(Content.fromUri(id))
	local size = img.Size
	local buf = img:ReadPixelsBuffer(Vector2.zero, size)
	img:Destroy()
	local W, H = size.X, size.Y
	local vals, sum, crushed, clipped = {}, 0, 0, 0
	for y = 0, H - 1, 4 do
		for x = 0, W - 1, 4 do
			local o = (y * W + x) * 4
			local r, g, b = buffer.readu8(buf, o), buffer.readu8(buf, o + 1), buffer.readu8(buf, o + 2)
			local l = 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b]
			table.insert(vals, l) sum += l
			if math.max(r, g, b) <= 20 then crushed += 1 end
			if math.min(r, g, b) >= 250 then clipped += 1 end
		end
	end
	table.sort(vals)
	local n = #vals
	local res = {mean = sum / n, p5 = vals[math.floor(n * 0.05)], p95 = vals[math.floor(n * 0.95)], crushedPct = crushed / n * 100, clippedPct = clipped / n * 100}
	if subject then
		local cf, s = subject:GetBoundingBox()
		local minX, minY, maxX, maxY = math.huge, math.huge, -math.huge, -math.huge
		for _, dx in {-1, 1} do for _, dy in {-1, 1} do for _, dz in {-1, 1} do
			local v = camera:WorldToViewportPoint(cf:PointToWorldSpace(Vector3.new(dx * s.X / 2, dy * s.Y / 2, dz * s.Z / 2)))
			minX, maxX, minY, maxY = math.min(minX, v.X), math.max(maxX, v.X), math.min(minY, v.Y), math.max(maxY, v.Y)
		end end end
		local function box(x0, y0, x1, y1, ex)
			local R, G, B, c = 0, 0, 0, 0
			for y = math.max(0, math.floor(y0)), math.min(H - 1, math.floor(y1)) do
				for x = math.max(0, math.floor(x0)), math.min(W - 1, math.floor(x1)) do
					if not ex or x < ex[1] or x > ex[3] or y < ex[2] or y > ex[4] then
						local o = (y * W + x) * 4
						R += LUT[buffer.readu8(buf, o)] G += LUT[buffer.readu8(buf, o + 1)] B += LUT[buffer.readu8(buf, o + 2)] c += 1
					end
				end
			end
			R, G, B = R / c, G / c, B / c
			return 0.2126 * R + 0.7152 * G + 0.0722 * B, {oklab(R, G, B)}
		end
		local w, h = maxX - minX, maxY - minY
		-- torso box against a ring around the whole body
		local yi, li = box(minX + w * 0.3, minY + h * 0.25, maxX - w * 0.3, minY + h * 0.6)
		local yr, lr = box(minX - w * 0.8, minY - h * 0.3, maxX + w * 0.8, maxY + h * 0.3, {minX, minY, maxX, maxY})
		res.contrast = (math.max(yi, yr) + 0.05) / (math.min(yi, yr) + 0.05)
		res.colourDiff = math.sqrt((li[1] - lr[1]) ^ 2 + (li[2] - lr[2]) ^ 2 + (li[3] - lr[3]) ^ 2)
	end
	return res
end
```

How to read it (guideline thresholds, set from the eight presets that looked right):

| Number         | Healthy                                                                                             | Problem                                              |
| -------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Mean luminance | 0.20 to 0.35 for day styles, 0.5 for a bright cartoon, 0.03 to 0.09 for night, horror and interiors | below 0.02: players turn up their brightness or quit |
| Crushed        | under 1% outdoors, under 25% for dark interiors                                                     | the horror draft hit 78 to 94%                       |
| Clipped        | under 1% outside the sky                                                                            | 6% was the blown-out fantasy draft                   |
| Contrast       | 1.5 or more                                                                                         | under 1.2, check the colour difference               |
| Colour diff    | 0.15 or more                                                                                        | under 0.10 the character is lost (fog 0.9: 0.056)    |

Contrast is luminance only: the fantasy and sunset presets read well at 1.1 to 1.5 because the
character differs in hue (colour difference 0.16 to 0.23). Judge both numbers together, and the
screenshot over both.

Practical points found while measuring:

- Wait at least 1.5 s after switching a preset before capturing. A capture taken right after a
  sky swap returned the previous preset's frame (the horror preset read 0.161 instead of 0.001).
- The screenshot tool's JPEG looks brighter than the linear numbers suggest; 0.03 linear is about
  19 percent grey on screen.
- Measure with the same camera every time; the wide eye-level shot and the third-person shot of the
  same night differ by 3x (0.02 against 0.06).

## 7. Cost and mobile

Graphics quality decides which effects exist at all. Measured in Studio by switching
`settings().Rendering.EditQualityLevel` (settable from the bridge) and comparing captures with each
effect exaggerated against it disabled:

| Quality level | Bloom | SunRays | DepthOfField | Cast shadows            | ColorCorrection, Atmosphere |
| ------------- | ----- | ------- | ------------ | ----------------------- | --------------------------- |
| 1 to 2        | off   | off     | off          | none (seen at 1)        | on                          |
| 3 to 4        | on    | off     | off          | none (seen at 4)        | on                          |
| 8             | on    | off     | off          | faint, short range only | on                          |
| 10 to 15      | on    | off     | off          | (not checked)           | on                          |
| 16 to 21      | on    | on      | on           | full at 21              | on                          |

What that means for a game played on phones (many run the low levels):

- Never rely on SunRays or DepthOfField for readability or mood; at most levels they do not exist.
- Never rely on shadows for gameplay (platform edges, depth in an obby, hiding spots). At levels
  1 to 4 there are none. Give edges a colour or material change instead.
- ColorCorrection and Atmosphere always apply, so they carry the mood on every device. That is
  also why a bad ColorCorrection (section 4) hurts everyone.
- Bloom carries neon at level 3 and above, but at levels 1 and 2 neon is just a flat colour: the
  neon strips need their PointLights to light the corridor.
- At level 1 the night village was brighter (0.084 against 0.065) because lamp light is no longer
  blocked by shadows.

Desktop GPU timings (Stats `RenderGPUFrameTime`, averaged over 3 s on the village): the full post
stack (with DepthOfField) added 0.8 to 2.6 ms over none across runs, and Bloom, ColorCorrection
and SunRays alone were within run-to-run noise (about 0.5 ms). DepthOfField was the one effect
that measurably added work (about +1 ms and 2 extra draw calls). Otherwise draw calls (109) and
triangles (73k) did not change with any lighting setting. Treat these as relative: no phone was measured. Guideline for phones: one
Atmosphere, at most Bloom plus ColorCorrection as the always-on stack, DepthOfField only for
menus and cutscenes, and `Shadows = false` on every practical light except one or two hero lights
(the fireplace).

## 8. Review checklist

Apply the preset, wait 1.5 s, and capture: the third-person view of a character at gameplay
distance, a wide eye-level view, and one view toward the sun. Run the meter on the third-person
view. Then check:

- Does every preset set every field (Lighting, Atmosphere, Sky, all four effects, lamps)?
- Is LightingStyle chosen deliberately, and was the preset tuned in that style?
- Mean, crushed, clipped, contrast and colour difference inside section 6's ranges, and does the
  screenshot agree?
- Is the sun at least 10 degrees up where players look at sunrise and sunset?
- Is ColorCorrection Contrast 0 to 0.1 in dark presets, and Saturation doing the desaturation?
- Does neon have a light next to it, and do lamps avoid blowing out nearby walls?
- Does the sky match the light (a saturated skybox tints everything)?
- Does the scene still read with shadows, SunRays and DepthOfField gone (quality level 1)?
- Does the day-night cycle use server time, update at about 10 Hz, and switch night lights?
- Is the path and every gameplay edge readable in every preset the game ships?
