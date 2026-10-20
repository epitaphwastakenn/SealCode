# Provenance

These skills are vendored from [roblox-brain](https://github.com/TabooHarmony/roblox-brain)
by TabooHarmony, MIT License (see `ROBLOX-BRAIN-LICENSE.txt`), at commit
`ceee4aaa5004502e2a51d78b3c33bba44d84742b` (v2.3.1). The category folders upstream
(`core/`, `design/`, `gameplay/`, `tools/`) are flattened, and `roblox-studio-mcp`, which is about
Roblox's own Studio MCP, is left out.

## SealCode additions

SealCode adds its own guidance on top of roblox-brain, written by SealCode (not part of the MIT
upstream text):

- `roblox-building/references/full.md`: the section "Modeling a custom mesh (SealCode additions)"
  (house style, flat colour per MeshPart, topology, lettering and engraving, chips and wear,
  reviewing a model before upload), and the matching Quick Reference line in `SKILL.md`.
- `roblox-gui/SKILL.md`: the Quick Reference lines on viewport sizing, text that always fits, touch
  target size and the device matrix (and `last_reviewed`).
- `roblox-gui/references/full.md`: "Scaling rules that survive every device" (§3), "Text must always
  fit" (§4), "11.9 Device matrix", and the last three UI checklist items.
- `roblox-ui-design/` (all files): SealCode's own visual design skill for Roblox screens (style
  families, component construction, layouts, polish and visual review), written by SealCode.
- `roblox-data/references/dataservice-typed.md` (all of it), the "SealCode default: DataService (typed)" section and edited Quick Reference lines in `roblox-data/SKILL.md`, matching notes in `roblox-data/references/full.md` (intro, §4, §8) and one line in `roblox-server-data/SKILL.md`: SealCode's default of using DataService (typed) by Leif for player data instead of a custom wrapper, checked against its repo and docs on 2026-10-20.
- `roblox-ui-design/references/gallery.md`, `icons.md`, `windui.md` and the style-choice rules in `roblox-ui-design/SKILL.md` and `validation.md`: 18 UI archetypes written from the owner's private reference images (described in words, no images or paths copied), icon style matching and Creator Store search, and a guide to loading WindUI (Footagesus/WindUI, MIT; API checked against its docs and source at v1.6.66 on 2026-10-20, nothing copied); ideas also drawn from Roqer's older UI skill, rewritten.
- `roblox-animation-vfx/references/vfx-sealcode.md` and `animation-sealcode.md` (all of both) and the "SealCode playbooks" section in `roblox-animation-vfx/SKILL.md`: SealCode's own VFX and animation playbooks, written from live Roblox Studio research on 2026-10-20 (about 20 free Creator Store VFX packs and 12 animation models inserted, dumped and rendered; layered effects, the Emit/attribute trigger pattern, ownership-gated animation ids, R15 joint axes, KeyframeSequence building and publishing flow checked in playtests); no text copied from the packs, only measured property values and asset ids.
