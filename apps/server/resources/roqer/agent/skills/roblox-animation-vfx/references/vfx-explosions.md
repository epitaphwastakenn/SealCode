# VFX explosions and smoke

Load this with `vfx-design.md` and `vfx-craft.md` for any explosion, fireball,
blast, burning or smoke. It fills in the impact skeleton in `vfx-craft.md`
section 4. *(measured)* marks numbers from 5,010 studied emitters, 1,427
textures and 6 explosion videos stepped frame by frame; none was checked in
Studio.

## 1. The mass is a flipbook

297 studied fiery layers are big enough to be a body (camera-facing, 4 studs
or more, living 0.25 s or more) *(measured)*:
- 152 play a flipbook.
- Of the 145 that use one image, 138 use a soft light texture: a glow, flare,
  lens streak or ring.

**One image is for light.** Fire, smoke and bursts are sheets whose frames
grow, boil and break apart. A static puff that only scales reads as a growing
sticker. The built-in `explosion01_core_main.dds` and `smoke_main.dds` are
single images: stand-ins for blocking out only.

## 2. Anatomy and timing

From the flash, in three studied explosions *(measured)*:

| Beat | Stylized (two artists) | Realistic |
| --- | --- | --- |
| Flash | 1-2 frames: a big soft glow, a yellow-white core, a thin cross flare | a white-out that lights the floor |
| Fire body | 0.05-0.33 s: boiling flame shapes, yellow-white core, orange, red rim | to about 0.5 s, in burning patches by 0.3 s |
| Burn-out | 0.3-0.5 s: the core turns charcoal while red rims and cracks glow | 0.4-0.8 s: dark smoke eats the fire |
| Smoke peak | 0.33-0.6 s, half the fire body's area or less | 0.8 s, spreading low |
| Gone | 0.6-1.2 s, embers a little later | smoke lingers 2-3 s |

Brightness only falls. The body cools from yellow-white to orange to red,
then dark, and nothing re-ignites.

## 3. The fire body

The 152 fire-body flipbooks *(measured)*:

| Property | Measured |
| --- | --- |
| Sheet | 4x4 on 84; 8x8 (rendered, realistic) on 46; `OneShot` 97% |
| Count | 1-7 layers per explosion (median 3), each `EmitCount` 3-28 or a short `Rate` burst |
| Lifetime | 0.45-1 s in a hit; 1-7 s in a nuke or slam |
| Motion | Speed median 88 (up to 190-460), Drag about 3: they burst out, then hang |
| Size | 45% keep one `Size` and let the frames grow; the rest ease out |
| Variety | random `Rotation` on 73%, a Size spread on 60% |
| Light | `Brightness` median 5 (2.7-15), `LightEmission` median 0.2 (0-0.5); one hot layer may run 15-25 |
| Colour at the end | deeper in its hue 73%, grey 24%, black 3% |
| Frames | largest a median 27% of the way through; 55 of 79 sheets end blank |

A studied fireball boils by overlap: three drawn 4x4 flame sheets stream at
`Rate` 55-90, Speed 225-380, Drag 3-4, each particle easing out at a random
angle for 0.35-0.75 s.

A fire-body layer for a hit with R about 5, timed to the `vfx-craft.md` flash
at 0.14 s. Set `Texture` to your fire-burst sheet (no built-in is a sheet):

```json
{
  "op": "create", "className": "ParticleEmitter", "name": "FireBody",
  "properties": {
    "Rate": 0, "Enabled": false, "Lifetime": [0.45, 0.8], "Speed": [60, 140], "SpreadAngle": [180, 180], "Drag": 4,
    "FlipbookLayout": "Grid4x4", "FlipbookMode": "OneShot", "Rotation": [0, 360], "RotSpeed": [-40, 40],
    "LightEmission": 0.2, "LightInfluence": 0, "Brightness": 5, "ZOffset": 1,
    "Color": [{ "time": 0, "value": [1, 0.95, 0.75] }, { "time": 0.25, "value": [1, 0.6, 0.2] },
              { "time": 0.6, "value": [1, 0.3, 0.1] }, { "time": 1, "value": [0.6, 0.12, 0.05] }],
    "Size": [{ "time": 0, "value": 3 }, { "time": 0.3, "value": 8 }, { "time": 1, "value": 9 }],
    "Transparency": 0
  },
  "attributes": { "EmitCount": 8, "EmitDelay": 0.17 }
}
```

Add a second layer from another sheet or seed, and a smaller hot copy at
Brightness 15-25 that dies by 0.3 s. Keep Transparency at 0: the sheet
breaks itself apart, and a fade on top only blurs it.

## 4. From fire to smoke

**Smoke fires in the same burst** as the fire, within 0.05 s, and outlives
it by up to 1 s in a hit, 2-11 s in a slam *(measured)*. Three ways:
- smoke layers living 1.5-3 times as long, often slowed (`TimeScale`
  0.55-0.9);
- a fire layer whose Colour ends grey: `#ff7f29` → `#ff5506` → `#313131`
  while Transparency rises 0 → 0.56 → 0.87;
- a rendered 8x8 sheet with the change baked in: fire for 24 frames, cooling
  for 8, dark smoke for 16, then wisps.

**The burn-out** is the charcoal core the fire leaves, with glowing cracks.
In the videos it is the darkest moment, lasting 0.1-0.3 s before it thins and
lightens. Put a burn-out sheet (section 6) just behind the fire body, so the
fire covers it until it breaks up:

```json
{
  "op": "create", "className": "ParticleEmitter", "name": "BurnOut",
  "properties": {
    "Rate": 0, "Enabled": false, "Lifetime": [0.5, 0.7], "Speed": [5, 15], "SpreadAngle": [180, 180], "Drag": 4,
    "FlipbookLayout": "Grid4x4", "FlipbookMode": "OneShot", "Rotation": [0, 360],
    "LightEmission": 0, "LightInfluence": 0, "Brightness": 2.5, "ZOffset": 0.5,
    "Color": [{ "time": 0, "value": [1, 0.45, 0.15] }, { "time": 1, "value": [0.9, 0.35, 0.12] }],
    "Size": [{ "time": 0, "value": 7 }, { "time": 1, "value": 9 }],
    "Transparency": [{ "time": 0, "value": 0.1 }, { "time": 0.6, "value": 0.3 }, { "time": 1, "value": 1 }]
  },
  "attributes": { "EmitCount": 2, "EmitDelay": 0.39 }
}
```

## 5. Smoke

320 studied smoke layers *(measured)*:

| Property | Measured |
| --- | --- |
| Lighting | `LightInfluence` 0 on 68%; 0.5 or more on 20%, mostly one piece |
| Sheet | a flipbook on 71%, mostly 4x4 `OneShot` |
| Value | about texture × Colour × Brightness; self-lit solid smoke has a median of 0.71 (0.34-1.2), mid to light grey |
| Opacity | at its most solid, a median Transparency of 0.59 (0.26-0.79); 20% go below 0.2; 23% fade in |
| Hue | grey 63%; tinted 30%, warm beside fire or in the effect's hue |
| Texture | soft or mottled 72%; cel puffs peak at Transparency 0.53 |
| Lifetime | median 1.0 s (0.56-1.39); 3-7 s only for a slam's last cloud |

**A dark Colour is not dark smoke.**
- At `LightInfluence` 0, Brightness multiplies Colour. Studied smoke of
  `#3f3f3f` at Brightness 16 and 5 renders white and light grey. A fire
  ending at `#2b190c` with Brightness 15-65 is a glowing brown.
- Copied at Brightness 1, both are black.
- Brightness with `LightInfluence` above 0 is unchecked.

**Dark smoke is a veil.**
- 40 of the 320 layers are dark, with a median peak Transparency of 0.5,
  many at 0.8-0.92. They are usually paired with light smoke: one fire
  dragon runs 18 black layers beside 15 white ones.
- Dense black that lingers is a ground crack, a sigil or linework.
- In the videos, smoke darkens what is behind it by 0.05-0.2 in luminance.

**Over a bright sky, half-transparent smoke turns into sky.** The measured
opacity comes from darker scenes than a new place's daylight. A fireball
run's grey smoke took the sky's hue within 3°, a pale blue cloud *(seen in a
run)*. In daylight make it more solid at its peak (Transparency 0.2-0.35)
so it shows its own grey, warm where the fire lights it *(starting point)*.

Cel puffs suit a clearly toon game, half transparent. Opaque two-tone puffs
read as cotton balls; otherwise use soft or mottled smoke.

Self-lit smoke that bursts out with the fire, fades in, hangs and fades.
Swap the stand-in for a smoke sheet with its flipbook settings:

```json
{
  "op": "create", "className": "ParticleEmitter", "name": "Smoke",
  "properties": {
    "Texture": "rbxasset://textures/particles/smoke_main.dds",
    "Rate": 0, "Enabled": false, "Lifetime": [0.9, 1.4], "Speed": [40, 80],
    "SpreadAngle": [180, 180], "Drag": 6, "Acceleration": [0, 2, 0], "TimeScale": 0.75,
    "Rotation": [0, 360], "RotSpeed": [-20, 20],
    "LightEmission": 0, "LightInfluence": 0, "Brightness": 1.6,
    "Color": [0.55, 0.53, 0.5],
    "Size": [{ "time": 0, "value": 4 }, { "time": 1, "value": 10 }],
    "Transparency": [{ "time": 0, "value": 0.75 }, { "time": 0.15, "value": 0.45 }, { "time": 1, "value": 1.15 }]
  },
  "attributes": { "EmitCount": 5, "EmitDelay": 0.19 }
}
```

- **Beside fire,** add a twin whose Colour runs from the fire's orange to
  grey.
- **Away from fire,** pair a warm grey with a cool one.

## 6. Drawing the sheets

A fire burst and a burn-out with the `roqer` helpers (`vfx-textures.md`),
checked tinted:
- **Fire burst:** a white-hot puff grows by a third of the way and breaks
  up. Its value falls: under the FireBody Colour it runs white, yellow,
  orange, then chars inside while its edges glow red in places. At
  Brightness 5 only a value under about 0.1 reads dark; one flat value stays
  one flat orange, a paper cut-out.
- **Burn-out:** mottled charcoal that swells, churns and lifts while its few
  cracks cool and it thins and tears.

Neither holds a shape: their outlines move a median 30% and 20% a frame,
studied sheets about 40% (`vfx-textures.md`).

```python
import numpy

NOISE = roqer.tex_noise(256, scale=6, seed=1)

# Fire burst: a lopsided body ringed with flickering tongues. Value: a hot heart (1) in a body
# (0.55) that chars (0.05) while edges glow (0.35).
RNG = numpy.random.default_rng(3)
TONGUES = [(RNG.uniform(-0.6, 0.6) + (numpy.pi / 2 if i % 3 else RNG.uniform(0, 2 * numpy.pi)),   # most lick upward
            RNG.uniform(0.15, 0.4), RNG.uniform(0.07, 0.13), RNG.choice([-1, 1])) for i in range(11)]
CHURN = roqer.tex_noise(256, scale=5, octaves=4, seed=8)
RAG = roqer.tex_noise(256, scale=12, octaves=3, seed=4)

def fire_burst(t, size):
    x, y = roqer.tex_coords(size)
    wx, wy = roqer.tex_warp(x, y, amount=0.1, scale=4, seed=2, t=t * 1.6)   # drifts fast: boils
    grow = roqer.tex_ease(t * 3)   # full size by a third
    radius = 0.16 + 0.22 * grow
    body = roqer.tex_blob(wx, wy, radius=radius, lumps=9, roughness=0.75, seed=5)
    for n, (angle, reach, width, curl) in enumerate(TONGUES):   # uneven tongues that flicker
        base = (numpy.cos(angle) * radius * 0.7, numpy.sin(angle) * radius * 0.7)
        lick = reach * grow * (0.7 + 0.3 * numpy.sin(t * 19 + n * 2.3))
        tip = (base[0] + numpy.cos(angle) * lick, base[1] + numpy.sin(angle) * lick + 0.05 * t)
        bend = ((base[0] + tip[0]) / 2 - numpy.sin(angle) * 0.06 * curl, (base[1] + tip[1]) / 2 + numpy.cos(angle) * 0.06 * curl)
        path = roqer.tex_curve([base, bend, tip], 16)
        body = numpy.maximum(body, roqer.tex_stroke(wx, wy, path, [width * (1 - 0.5 * t), 0.0]))
    body = body + (roqer.tex_sample(RAG, wx * 0.5 + t * 0.2, wy * 0.5 - t * 0.5) - 0.5) * 0.08   # ragged rim
    burn = roqer.tex_sample(CHURN, x * 0.6 + 0.3, y * 0.6 - t * 0.4) - max(0.0, t - 0.2) * 1.4 + 0.1 + body * 0.6   # holes from 20%
    cool = min(max((t - 0.2) / 0.4, 0.0), 1.0)   # hot to 20%, charred by 60%
    alpha = roqer.tex_edge(body, soft=0.008 + 0.03 * cool) * roqer.tex_edge(burn, soft=0.02 + 0.06 * cool)
    mottle = roqer.tex_sample(RAG, wx * 0.4 - t * 0.2, wy * 0.4 + t * 0.3) - 0.5
    rim = (1 - roqer.tex_edge(numpy.minimum(body, burn / 3), 0.035 + mottle * 0.06, soft=0.015)) * roqer.tex_edge(mottle, -0.1, soft=0.1)
    heat = roqer.tex_sample(CHURN, wx * 0.5 - t * 0.3, wy * 0.5 + t * 0.6) + body * 2.5 - 0.05 - t * 1.5   # shrinking heart
    core = (0.55 + mottle * 0.3) * (1 - 0.9 * cool)
    value = core + (0.7 - 0.35 * cool - core) * rim * cool   # edges glow, in places
    return alpha * (1 - 0.3 * cool * (1 - rim)), numpy.maximum(value, roqer.tex_edge(heat, 0.5, soft=0.06))

# Burn-out: charcoal (value about 0.15) with thin cracks (1). Under a warm Color at Brightness
# 2-3: charcoal with embers.
RIDGES = roqer.tex_noise(256, scale=7, octaves=4, seed=12)
MOTTLE = roqer.tex_noise(256, scale=8, octaves=4, seed=13)

def burn_out(t, size):
    x, y = roqer.tex_coords(size)
    wx, wy = roqer.tex_warp(x, y, amount=0.16, scale=4, seed=6, t=t * 2.2)   # churns as it rises
    body = roqer.tex_blob(wx, wy - 0.15 * t, radius=0.3 + 0.25 * roqer.tex_ease(t * 1.5), lumps=10, roughness=0.8, seed=7)   # swells and lifts
    holes = roqer.tex_sample(NOISE, x * 0.5 + 0.1, y * 0.5 + t * 0.6) - t * 1.4 + 0.45
    alpha = roqer.tex_edge(body, soft=0.04) * roqer.tex_edge(holes + body * 0.3, soft=0.08) * (0.9 - 0.4 * t)
    ridge = 1 - numpy.abs(roqer.tex_sample(RIDGES, wx * 0.5 + 0.5, wy * 0.5 + 0.5) * 2 - 1)   # wandering lines
    patches = roqer.tex_edge(roqer.tex_sample(MOTTLE, x * 0.25 + 0.4, y * 0.25), 0.5, soft=0.05)   # only in places
    crack = roqer.tex_edge(ridge, 0.95 + 0.03 * t, soft=0.01) * patches * roqer.tex_edge(body, 0.08, soft=0.04) * (1 - t) ** 1.5
    smoke = 0.1 + 0.12 * roqer.tex_sample(MOTTLE, wx * 0.5 + t * 0.1, wy * 0.5 - t * 0.2)
    return alpha, smoke + (1 - smoke) * crack

roqer.draw_flipbook("FireBurst", fire_burst, grid=4, fps=30)
roqer.draw_flipbook("BurnOut", burn_out, grid=4, fps=16)
```

Draw two or three bursts with other seeds so overlapping layers differ.

**Realistic explosions** use 8x8 sheets rendered from a fire and smoke
simulation, with the colour baked in. Roqer cannot render one yet. For a
realistic brief, say so and look for an explosion flipbook in the Creator
Store (`search_assets`).

## 7. Checks

Add these to `vfx-craft.md` section 6:
- At 0.1-0.3 s, is the body a boiling mass of overlapping sheets, or one
  image scaling up?
- Does it cool from yellow-white to a charred centre with red edges and
  break up by about 0.5 s in a hit, or end as one flat orange?
- Is the darkest moment the burn-out, gone within about 0.3 s?
- Is any smoke darker than what is behind it by more than about 0.2 for
  longer than that, or dark and below Transparency 0.5?
- Is any dark Colour at Brightness 1 where the studied ones used 5-60?
- Is a hit's smoke gone by about 1.5 s?
