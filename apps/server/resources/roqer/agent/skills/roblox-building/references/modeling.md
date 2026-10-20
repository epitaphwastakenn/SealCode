# Modeling a mesh

Use once [What gets modeled](mesh-boundary.md) has decided a component needs a
mesh, whatever makes it: the `blender` tool, `generate_model`, or a file the
user supplies. [Blender modeling](blender.md) covers the job itself; this
covers what to decide before it and what to check after.

## Write the brief first

Before the first job, settle these in your plan. A model built without them is
the wrong size, the wrong style, or arrives in one colour.

- **Role:** background prop, hero prop, held tool, vehicle body, building
  piece, or UI icon. The role sets the budget and whether it needs gameplay
  assembly afterwards ([Gameplay assembly](gameplay-assembly.md)).
- **Size in studs** for each major dimension, from the Player Scale table: a
  player is about 5 studs, a door 4 × 7, a seat 1.5 high, a counter 3.5–4. A
  barrel is about 4 studs tall; a sword about 4 long; a car about 12–16 long.
- **Style:** read WorldSpec `style` and palette when the place has one;
  otherwise take it from the request. Low-poly, chunky and faceted is the
  usual Roblox look; smooth and detailed needs a reason.
- **House style:** before the first job, inspect the meshes already in the
  place: their sizes, `Material`, `Color` and `TextureID`, and how their edges
  are finished (sharp, one-segment bevel, chipped). Match them: a new prop
  that is sharper, busier or textured where the rest is flat stands out.
- **Surfaces:** list the colours, and every region that needs its own Roblox
  `Material` or transparency (a glass window, a glowing lamp). Only those need
  their own material slot, which arrives as its own MeshPart.
- **Moving pieces:** list anything that must move or be touched on its own
  (a wheel, a door leaf, a lid, a trigger). Keep each as a separate object.
- **Rest point:** where it stands or is held. That is where its pivot goes.
- **Triangle budget** (design budgets, not platform limits): background prop
  up to about 300; ordinary prop up to 1,500; hero prop or vehicle body up to
  5,000. Count it against WorldSpec `budgets.maxMeshTriangles` when set.

## Shape

- Build from a few strong forms. Revolve a profile for round things (a ring of
  vertices per height); extrude a footprint for
  flat-sided things; combine simple solids for assemblies.
- Prefer placing a part that is not upright by its two ends
  (`roqer.box_between`, `roqer.cylinder_between`, `roqer.cone_between` in
  [Blender modeling](blender.md)): the direction of a rotation angle is easy
  to get backwards, and the ends are what the design knows.
- For the low-poly look use 6–12 segments around a curve, flat shading, and a
  one-segment bevel on hard edges so they catch light. Never smooth-shade a
  hard-edged model: boxes and panels come out looking puffy.
- Modifiers are not exported unless the export passes `export_apply=True`: by
  default Blender's glTF export drops them, so a bevel you can see in the
  script never reaches Roblox. Pass it on every export.
- Keep normals outward (`bmesh.ops.recalc_face_normals`) and avoid coincident
  faces; they flicker in Studio (z-fighting).
- Join pieces that share a material and never move apart into one object.
  Keep moving pieces separate and named for what they are (`WheelFrontLeft`),
  then read back how they arrived before relying on them.

## Topology

Roblox draws the triangles the model arrives as, and a wireframe shows a
generated mesh at once: long fans out of a corner, thin slivers, stray cuts.
Model it the way a person would.

- Build the mesh from vertices you place: rows and columns with `bmesh`
  (`bm.verts.new`, `bm.faces.new`), or a primitive you then edit. Never cut a
  visible face with a boolean; it leaves fans and slivers.
- Curves and arches: one column of quads per segment, running down to the
  base, so the side is a row of strips, not one face. Add a horizontal loop
  only where detail sits.
- Triangles only where the detail needs them, inside a tight frame around it
  (a rectangle hugging the lettering). Never leave a large ngon around a
  detail: it triangulates into a fan from a far corner.
- Faces nobody sees (a base on the ground) are quad strips too, not one ngon
  with vertices along its edges: those triangulate into zero-area slivers.
- Spend triangles on clean topology. A tombstone went from 290 to 424
  triangles when rebuilt this way and looked far better; stay in the budget,
  not under it.

### Lettering and engraving

Never boolean text or a carving into a face. Build it:

1. Letter outlines from the font: a text curve with `extrude = 0` and
   `resolution_u = 3`, converted to a mesh. Its boundary edges are the outline.
2. Walls: one quad per outline edge, from the front face back to the depth.
   The floor is the font's own faces, moved back by the depth.
3. Front face around the letters: `bmesh.ops.triangle_fill(use_beauty=True)`
   over the edges of a tight rectangle plus the outline, then delete the
   triangles whose centre falls inside a letter, and run
   `bmesh.ops.beautify_fill` on the inner edges only. Put the rectangle's
   sides on column edges and its top and bottom on horizontal loops, so the
   quads around it meet it vertex to vertex.
4. Put the engraving in its own object (its own MeshPart) when it needs
   another colour.
5. Keep the glyphs as the font draws them. Space letters that touch
   (`space_character`) rather than overlapping them, and never merge outline
   vertices to remove short edges: it bends the letters. A few thin triangles
   at a glyph's corners are fine; check in the solid preview that the word
   still reads.

### Chips and wear

Chip a corner with `bmesh.ops.bevel(affect="VERTICES", segments=1)` and a worn
edge with `affect="EDGES"`; on an older Blender pass `vertex_only=True`
instead of `affect` (inside `try`/`except TypeError`). Never cut chips with
`bisect_plane` and `holes_fill`: they leave thin slivers. Chip where the faces
around the corner are small; on a large face the chip's new corner fans across
it, so first add a loop near the corner (a `bisect_plane` cut that clears and
fills nothing).

If a `bisect_plane` cut must be closed, fill only that cut's edges (the
`geom_cut` it returns). Never run `holes_fill` over every edge of the mesh: it
also closes the openings you made on purpose, such as an engraving, and the
cap sits on another face and flickers.

## Scale, orientation, pivot

- One Blender unit arrives as one stud. Model at the brief's size.
- Model with Z up, as Blender does; the glTF export converts to Roblox's Y up,
  so the model arrives upright.
- Stand the model on Z = 0 with its footprint centred on the origin.
- Face the model's front toward Blender −Y, as Blender's own Front view does.
  A point at Blender (x, y, z) arrives in Roblox at (−x, z, y), so −Y becomes
  Roblox's forward, −Z, the direction a part's `LookVector` points and a seat
  faces. A front modeled toward +Y arrives facing backwards. Measured from two
  uploads, by comparing each wheel's Blender position with its position in
  Studio.
- After insert, set the Model's pivot to its rest point (base centre for a
  prop, grip for a tool) with `WorldPivot` or a `PrimaryPart`, so later clones
  and `PivotTo` land it correctly.

## Colour and material

Colour the model in Blender. A Roblox Model upload keeps two kinds of colour,
verified by uploading one cube of each (`npm run eval:colors`), and loses one:

- **Vertex colours** (kept): one colour per face or per corner, in a colour
  attribute. The natural fit for low-poly: flat faces in a small palette, with
  no texture to make and every colour in one MeshPart. Paint the attribute's
  corners, and wire a Color Attribute node into the Principled Base Color, or
  the glTF export leaves the colours out.
- **A packed image texture** (kept, as the MeshPart's `TextureID`): for what
  faces cannot carry, such as wood grain, a painted logo, a gradient or
  lettering. Generate or draw the image in the script, keep it square and at
  most 1024 pixels a side, `image.pack()` it, wire it into Base Color, and
  UV-unwrap the mesh.
- **Flat material colours** (lost): a Principled base colour on its own arrives
  white. Use it only for a slot you will paint in Studio.
- **Flat colour per MeshPart, set in Studio** (`Color` plus `Material`
  `Plastic`): the usual convention where a place's props use no texture. Make
  each region of another colour its own object, so it arrives as its own
  MeshPart, export it untextured, and paint each part after insert. Use it
  when the place's existing meshes are coloured that way.

Roqer's inspection reports which one each exported model uses, and its preview
shows it. After insert:

- Leave `Color` white on a vertex-coloured or textured MeshPart: white shows the
  colour unchanged.
- Give a region its own material slot only when it needs its own Roblox
  `Material` or transparency: `Glass` for a window, `Neon` only for things that
  glow, or a physical material a player hears or feels. Changing `Material`
  also changes how the surface is lit and patterned, so screenshot it
  afterwards.
- For a slot painted in Studio, set `Color` and `Material` on its MeshPart:
  `Wood`, `WoodPlanks`, `Metal`, `DiamondPlate`, `Slate`, `Brick`, `Fabric` or
  `SmoothPlastic`.

## Accept it

1. The preview matches the brief: silhouette, proportions and colours.
2. The wireframe is clean (see "Topology"): quads and strips, triangles only
   inside the frame around a detail, and no topology findings left that you
   cannot explain.
3. Triangles are within budget; the measured size is within about 10% of the
   brief.
4. After insert, read back the MeshParts, size, pivot and anchoring. Set
   collision deliberately: `CollisionFidelity` `Box` for small props, `Hull`
   for convex shapes, the detailed default only where players need it; turn
   `CanCollide`, `CanTouch` and `CanQuery` off on purely visual pieces.
5. Screenshot it at the distance players will see it.
6. Record provenance: a `RoqerAssetId` string attribute on the Model with the
   uploaded asset ID. If it is a kit, register it as one and follow the kit
   revision steps in [World intent](world-intent.md) when it changes later.
