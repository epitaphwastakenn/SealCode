# Visual review

A screen is reviewed by looking at it in a Play test, the way a player sees it. **Take a screenshot after every visual change**, however small (a colour, a font, an icon swap, a spacing tweak), compare it with the chosen theme or archetype and with the request, and fix and look again before you say it is done. Never report a visual result you have not seen in a screenshot, and make claims about the picture only after the image arrived.

## The loop

1. Build or change the screen (one `build_instances` call or one builder script).
2. Start a Play test. Run `inspect_ui` with `mode: "audit"` first: it is cheap text, and its findings must be fixed before judging pixels.
3. `capture_device_matrix` with `restoreAfter: true` on at least: a phone in landscape (iPhone), a phone in portrait if the game allows it, a tablet, and a 1080p PC.
4. Compare each capture with the checklist below, with the theme or archetype (palette, type, construction, density: is it the look described, or a weaker default?) and with the request. Write down every defect.
5. Fix all defects in one batch, stop the test, start a fresh one, capture again. Stop when nothing on the checklist fails; two or three rounds is normal.
6. Stop the test. The simulator must be back to its starting state.

Report which devices you checked and what changed between rounds. A screen checked only in the edit viewport is not reviewed.

## The audit

`inspect_ui` with `mode: "audit"` reports these finding kinds. Fix every one and run it again; an audit that ran before the very last change counts as unverified.

| Finding                                                                          | Meaning and fix                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text_obscured`                                                                  | something drawn later hides letters (a badge on a title): move it off, or give the text space                                                                                             |
| `text_straddles_edge`                                                            | text only partly on a painted element (a balance sliding under its "+" button, a discount label hanging over a price button): arrange side by side or keep the text wholly on the element |
| `content_beyond_scroll`                                                          | content lies past the canvas of its scroller: use `AutomaticCanvasSize` or enlarge the canvas by content plus padding                                                                     |
| `text_overflow`                                                                  | the string does not fit its label: widen, wrap or shorten (scaled text hides this by shrinking, so also look at the size)                                                                 |
| `fully_clipped_interactive`, `zero_size_interactive`, `element_outside_viewport` | a control nobody can see or press                                                                                                                                                         |

Construction habits the audit rewards: a decoration is a **child** of what it decorates (title, icon and close inside the panel body; badges inside the owning block's face; labels over art as children of the art; the light copy of an extruded label inside the dark copy; a progress bar as one object whose gradient is the fill). A child that crosses its parent's edge counts as placed on purpose; a sibling that crosses a painted edge counts as a collision. Expected reports: wedge labels covered by a transparent divider overlay in a wheel.

`inspect_ui` with `mode: "inspect"` returns hierarchy, bounds and styles when you need to measure a rectangle. The audit result lists the findings before the element list and is cut at about 24,000 characters, so on a big screen narrow `root` to a subtree rather than raising the limits. If a screenshot shows a black world behind a screen, the Studio window lost focus and stopped rendering 3D: bring it to the front and capture again.

## Order of the visual review

1. Footprint and scale. 2. Panel and card proportions. 3. Density and dead space. 4. Clipping, overflow, overlap, partial rows. 5. Hierarchy and relative scale of titles, actions, text, icons, buttons. 6. Fidelity to the theme. 7. Polish states. 8. Fine cosmetics. Having a screenshot does not mean passing; structural errors first, cosmetics after.

## Checklist

- **Centred:** button labels, titles, tabs, badges and chips are centred horizontally and vertically in their box (`TextXAlignment` and `TextYAlignment` Center); only body copy, lists and inputs are left aligned. Look at the picture: a label sitting high, low or hugging the left edge is a defect even if the properties look right. Icon plus text groups are centred as one group.
- **Readable:** every label legible at phone size; strong contrast (white on saturated, dark on light); no outline-only text; text 14 px or larger on phones (12 for captions).
- **Hierarchy:** title largest, primary action largest and in the accent colour, secondary smaller.
- **Style:** matches the theme or archetype and the `SealCodeUiStyle` on StarterGui (outline thickness, lip, corner radius, fonts, palette, icon family). With `match-existing` it is indistinguishable from the game's other screens. No default grey frames, default fonts, mixed icon families or emoji.
- **Fit:** nothing cut off, overlapping, outside the safe area, or under the thumbstick and jump button; nothing in the top-left keep-out.
- **Spacing:** gaps from the spacing scale (4, 8, 12, 16, 24, 32, 48), equal between equal things, nothing touching an edge.
- **Background:** not flat grey; a designed backdrop (menus) or the world visible behind a light vignette (HUD).
- **Structure:** one layout; the right theme parts; demo data present; every state of the layout visible at first render; one product per shop card; leaderboard descending; progression rows complete; exactly one selection; admin page matching the lit category; the template's own geometry untouched.
- **Assets:** only ids from the theme, the layout or `icons.md`, or verified project art; art sets coherent; no wrapper (decal) ids; fit scaling; coloured icons not tinted; no invented ids, no emoji.
- **Polish:** hover and press motion, entrance animation, button states; no ambient loop on text.

### Theme checks

- **Cartoon card:** white rounded card with the ink outline and lower hard shadow; a bare stroked title with its icon beside it; a corner-straddling red close; Border-mode ink strokes on buttons; semantic gradients; tier tiles with the price beneath.
- **Classic studs:** square four-layer bevels; black stroke 4 on bases; gradient faces except the title bar; legible studs; title icon, title and close geometry; adequate targets.
- **Modern studs:** every block from the kit; one panel flavour; red-tile close; no stud pixels beyond rounded corners; art on sunbursts; Robux glyph prices; one tab at full strength with the rest dimmed and the rail outside the panel; blur and pop on panels but not on HUD, sidebar, clicker or toast; green never on cancel or destructive; nothing for sale in grey; owned and claimed grey; empty and locked slate; no size-pulsing text; badges at z-index 4 on the face.

## Rejection thresholds

A screen that crosses any of these is rejected and repaired, not shipped.

- **Panels:** height outside 0.40 to 0.66 of the screen on regular windows (0.68 for leaderboards, a floor of 0.38 for admin); content ending more than 12% (studs) or 8% (cartoon card) above the panel bottom, or more than about 25% for the shop height table.
- **Targets and corners:** any interactive element under 44 px tall; any square element with a zero Scale width; anything inside the 350 x 70 top-left corner.
- **Landing:** backdrop RGB channel above about 0.2 or transparency above about 0.30; title glyphs below 10 to 11% of the screen height; two CTAs of the same size; buttons on a loading screen; anything wider than 30% of the screen besides title, tagline and backdrop.
- **HUD:** an element in the centre 50 x 50 area; a zone wider than 22% (40% for top and bottom centre); zones closer than 2%; more than six zones; a number with no icon.
- **Clicker:** a target under 10% of the screen height or under twice the largest other button; more than two secondary tiles; any upgrade list.
- **Sidebar:** more than six buttons; icon-only or text-only buttons; any plate or strip.
- **Leaderboard:** values not descending; rank 1 hidden; a button on any row; values not sharing a right edge.
- **Progression:** fewer than five visible rows; green on a non-claimable row; a fill that disagrees with the count; rows missing goal, progress or reward.
- **Inventory:** non-square slots; a cell taller than 1.15 times its width; fewer rendered slots than the capacity; an action button on each slot.
- **Select:** not exactly one selected; prices present; per-tile buttons with four or more options.
- **Toasts:** two lines; overlapping; centred; with buttons; more than three visible.
- **Wheel:** other than eight prizes; chances not totalling 100; equal adjacent colours; a rebuilt wheel instead of the template; edits outside the config and style tables. **Reel:** a strip under 20 cards; a winner before the 15th; rarity colours that differ from the game's table; extra buttons; an automatic roll.
- **Audit:** not clean after the final change.

## Repair and stopping rules

- A clear structural or proportion error gets one focused repair that keeps what is right, then a fresh render. Examples: a panel far larger or smaller than the layout says; distorted cards; large unused areas; a panel that could be shorter because content ends well before its bottom; tiny text, icons or actions; clipped, overlapping or half-shown content; blatant departures from the theme.
- At most two repair rounds. If a serious defect survives, stop and report that verification is incomplete. No redesigning for taste.
- Give up on a defect after three failed fixes, or if it is unchanged after two fixes in a row.
- **Freshness:** a Play test reflects only the UI as it was when it began. A UI change after that needs a stop and a restart; an unchanged revision needs no restart; never start a test while one is running. (For a fast loop on one element you may rebuild it in the live client with `eval_client_runtime` and capture again, then confirm with a fresh test at the end.)
- **Interaction testing is conditional:** only when behaviour was requested, when the layout is not complete without its action (the wheel and reel), or when a state hides behind an interaction (another tab). Exercise the smallest representative set once, prefer `interact_ui` with a selector that matches exactly one element, fall back to coordinates from the audit or screenshot, and check the resulting state (delivery of input proves nothing). On a static screen do not press Close just to see it hide. A self-vanishing message (a toast, "Coming soon") must be checked by script right after the click, because a screenshot arrives too late.

## Test prompts worth reusing

Use these to check that routing and construction still hold. Each should land in one layout without ambiguity.

| Prompt                                                                  | Layout                      |
| ----------------------------------------------------------------------- | --------------------------- |
| a pet shop with eight coin packs, four passes and a limited offer       | shop-grid                   |
| a rebirth confirmation with multipliers and a requirement bar           | centered-dialog             |
| a blocking title screen with PLAY and some secondary buttons            | fullscreen-landing          |
| an owner console with four categories                                   | admin-control-panel         |
| a HUD with currencies, a timer, a health bar, menu icons and one action | hud-zone-system             |
| a six-class picker with two locked                                      | select-screen               |
| a twenty-slot pet inventory with a detail pane and Equip                | grid-inventory (+ detail)   |
| a persistent labelled left menu                                         | vertical-navigation-sidebar |
| Daily and Weekly quests with all three claim states                     | progression-hub             |
| a ten-player richest board with no row actions                          | stat-leaderboard            |
| a tap simulator with one huge button and two shortcuts                  | incremental-clicker         |
| top-centre auto-dismissing reward, achievement and error messages       | notification-alert          |
| an eight-slice lucky wheel with three spin packs                        | wheel-spin                  |
| a crate opening with twenty-plus prizes rolling through a centre window | vertical-reel-roll          |

Conflict probes: a leaderboard whose rows each need a Challenge button is not a leaderboard; a toast that says "click to continue" is a dialog; a clicker inside a centred opaque card must either keep the world visible or become a landing; a wheel "with frames instead of images" is still the wheel template.

Marks for a review out of ten, if you want to score: classification 1, skeleton 2, the layout's interaction contract 2, theme construction 2, asset correctness 1, a demo state that can be judged 1, validation behaviour 1.
