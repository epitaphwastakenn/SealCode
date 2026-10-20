# Visual review

A screen is reviewed by looking at it in a Play test, the way a player sees it. **Take a screenshot after every visual change**, however small (a colour, a font, an icon swap, a spacing tweak), compare it with the chosen archetype in `gallery.md` and with the request, and fix and look again before you say it is done. Never report a visual result you have not seen in a screenshot.

## The loop

1. Build or change the screen (one `build_instances` call or one builder script).
2. Start a Play test. Run `inspect_ui` with `mode: "audit"` first: it is cheap text, and its findings (text cut off, overlapping, outside the safe area) must be fixed before judging pixels.
3. `capture_device_matrix` with `restoreAfter: true` on at least: a phone in landscape (iPhone), a phone in portrait if the game allows it, a tablet, and a 1080p PC.
4. Compare each capture with the checklist below, with the chosen archetype (palette, type, component construction, density: is it the look the gallery describes, or a weaker default?) and with the request. Write down every defect.
5. Fix all defects in one batch, stop the test, start a fresh one, and capture again. Repeat until the checklist passes. Two or three rounds is normal; stop when nothing on the checklist fails.
6. Stop the test. The simulator must be back to its starting state.

## Checklist

- **Centred:** button labels, titles, tabs, badges and chips are centred horizontally and vertically in their box (`TextXAlignment` and `TextYAlignment` Center); only body copy, lists and inputs are left aligned. Look at the picture: a label sitting high, low or hugging the left edge of a button is a defect even if the properties look right. Icon plus text groups are centred as one group.
- **Readable:** every label legible at phone size; contrast between text and its fill is strong (white on saturated, dark on light); no outline-only text.
- **Hierarchy:** title largest, primary action largest and in the accent colour, secondary smaller.
- **Style:** matches the chosen archetype and the `SealCodeUiStyle` recorded on StarterGui (outline thickness, lip, corner radius, fonts, palette, icon family). If the style is `match-existing`, it is indistinguishable in style from the game's other screens. No default grey frames, no default fonts, one icon family, no emoji.
- **Fit:** nothing cut off, overlapping, outside the safe area, or under the thumbstick and jump button on touch.
- **Spacing:** gaps from the spacing scale, equal between equal things, nothing touching edges.
- **Background:** not flat grey; the world is either blocked by a designed backdrop (menus) or visible behind a light vignette (HUD).
- **Polish:** hover and press motion, entrance animation, button states.

Report which devices you checked and what changed between rounds. A screen checked only in the edit viewport is not reviewed.
