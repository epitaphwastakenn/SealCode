# Provenance

These skills are vendored from [roblox-brain](https://github.com/TabooHarmony/roblox-brain)
by TabooHarmony, MIT License (see `ROBLOX-BRAIN-LICENSE.txt`), at commit
`ceee4aaa5004502e2a51d78b3c33bba44d84742b` (v2.3.1). The category folders upstream
(`core/`, `design/`, `gameplay/`, `tools/`) are flattened, and `roblox-studio-mcp`, which is about
Roblox's own Studio MCP, is left out.

## Harp additions

Harp adds its own guidance on top of roblox-brain, written by Harp (not part of the MIT
upstream text):

- `roblox-building/references/full.md`: the section "Modeling a custom mesh (Harp additions)"
  (house style, flat colour per MeshPart, topology, lettering and engraving, chips and wear,
  reviewing a model before upload), and the matching Quick Reference line in `SKILL.md`.
- `roblox-gui/SKILL.md`: the Quick Reference lines on viewport sizing, text that always fits, touch
  target size and the device matrix (and `last_reviewed`).
- `roblox-gui/references/full.md`: "Scaling rules that survive every device" (§3), "Text must always
  fit" (§4), "11.9 Device matrix", and the last three UI checklist items.
- `roblox-ui-design/` (all files): Harp's own visual design skill for Roblox screens (style
  families, component construction, layouts, polish and visual review), written by Harp.
- `roblox-data/references/dataservice-typed.md` (all of it), the "Harp default: DataService (typed)" section and edited Quick Reference lines in `roblox-data/SKILL.md`, matching notes in `roblox-data/references/full.md` (intro, §4, §8) and one line in `roblox-server-data/SKILL.md`: Harp's default of using DataService (typed) by Leif for player data instead of a custom wrapper, checked against its repo and docs on 2026-10-20.
- `roblox-ui-design/references/gallery.md`, `icons.md`, `windui.md` and the style-choice rules in `roblox-ui-design/SKILL.md` and `validation.md`: 18 UI archetypes written from the owner's private reference images (described in words, no images or paths copied), icon style matching and Creator Store search, and a guide to loading WindUI (Footagesus/WindUI, MIT; API checked against its docs and source at v1.6.66 on 2026-10-20, nothing copied).
- `roblox-animation-vfx/references/vfx-sealcode.md` and `animation-sealcode.md` (all of both) and the "Harp playbooks" section in `roblox-animation-vfx/SKILL.md`: Harp's own VFX and animation playbooks, written from live Roblox Studio research on 2026-10-20 (about 20 free Creator Store VFX packs and 12 animation models inserted, dumped and rendered; layered effects, the Emit/attribute trigger pattern, ownership-gated animation ids, R15 joint axes, KeyframeSequence building and publishing flow checked in playtests); no text copied from the packs, only measured property values and asset ids.
- `roblox-building/references/building-sealcode.md` and `roblox-lighting/references/lighting-sealcode.md` (all of both) and the "Harp playbooks" sections in `roblox-building/SKILL.md` and `roblox-lighting/SKILL.md`: Harp's own building and lighting playbooks, written from live Roblox Studio research on 2026-10-23 (20 free Creator Store assets inserted and audited, a village scene built with terrain and kit pieces and reviewed from several angles, character traversal measured in a playtest, streaming checked on the client, eight lighting presets tuned and measured from captured pixels, six skyboxes rendered, graphics quality levels and effect costs compared, a day-night cycle tested); no text copied from the assets, only measured property values and asset ids.
- `roblox-ui-design/references/layouts.md` and `layouts/`, `references/themes/`, `references/specialized.md`, `templates/` (the wheel and reel scripts), and the expanded `polish.md`, `validation.md` and `icons.md`: Harp-authored layouts, themes, widgets and templates, written from a study of common Roblox UI practice (all prose, code and numbers are Harp's own; asset ids were each checked to render in Roblox Studio).
