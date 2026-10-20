# Visual review

A screen is reviewed by looking at it in a Play test, the way a player sees it.

## The loop

1. Build or change the screen (one `build_instances` call or one builder script).
2. Start a Play test. Run `inspect_ui` with `mode: "audit"` first: it is cheap text, and its findings (text cut off, overlapping, outside the safe area) must be fixed before judging pixels.
3. `capture_device_matrix` with `restoreAfter: true` on at least: a phone in landscape (iPhone), a phone in portrait if the game allows it, a tablet, and a 1080p PC.
4. Compare each capture with the checklist below and the request. Write down every defect.
5. Fix all defects in one batch, stop the test, start a fresh one, and capture again. Repeat until the checklist passes. Two or three rounds is normal; stop when nothing on the checklist fails.
6. Stop the test. The simulator must be back to its starting state.

## Checklist

- **Readable:** every label legible at phone size; contrast between text and its fill is strong (white on saturated, dark on light); no outline-only text.
- **Hierarchy:** title largest, primary action largest and in the accent colour, secondary smaller.
- **Style:** matches the chosen family (outline thickness, lip, corner radius, fonts, palette). No default grey frames, no default fonts.
- **Fit:** nothing cut off, overlapping, outside the safe area, or under the thumbstick and jump button on touch.
- **Spacing:** gaps from the spacing scale, equal between equal things, nothing touching edges.
- **Background:** not flat grey; the world is either blocked by a designed backdrop (menus) or visible behind a light vignette (HUD).
- **Polish:** hover and press motion, entrance animation, button states.

Report which devices you checked and what changed between rounds. A screen checked only in the edit viewport is not reviewed.
