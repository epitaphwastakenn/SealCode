# Specialized Layout: wheel-spin

## Canonical implementation availability

This package contains an exact template for each theme:

- SIM: `templates/sim/wheel-spin.lua`
- CLASSIC STUDS: `templates/studs/wheel-spin.lua`
- MODERN STUDS: `templates/modern-studs/wheel-spin.lua` (repository-authored from the CLASSIC STUDS template; see its adapter below)

Roqer has no server-side `layoutTemplate` operation. Load the exact body matching the selected theme and edit only `CONFIG`. The files are distinct; never substitute one theme's body for another.

## Contract

Do not hand-write this UI. Load `templates/<theme>/wheel-spin.lua`. Use `execute_luau` only to create or find the stable `WheelSpinUI` `LocalScript` without assigning `Source`, then write the customized full body through `set_script_source`.

Customize only `CONFIG`. Keep the managed prefix, `-- layout: wheel-spin`, and everything outside `CONFIG` byte-for-byte unchanged.

The maintained template owns chrome, geometry, sounds, themed buttons, and animation.

## CONFIG API

- exactly 8 prizes in wedge order;
- chances sum to 100;
- prize icons use exact theme/layout assets, verified project art, or the bounded Creator Store search and preview flow;
- demo counters;
- spin-pack prices;
- wedge accent colors, with no two adjacent wedges sharing an accent.

## Fixed chrome assets

- ring base: `rbxassetid://110833418157060`
- wedge divider overlay: `rbxassetid://134944584099686`, black tint
- center hub: `rbxassetid://132449669432787`
- pointer: `rbxassetid://121446361788141`, aspect 1.319, points DOWN at wheel top
- HUD/open wheel icon: `rbxassetid://79841360279510`

Positional wedge masks 1–8, never reorder:
1. `93917478516867`
2. `126317571251493`
3. `85329237473568`
4. `139163490421697`
5. `79640255136580`
6. `116368159017334`
7. `107141681148446`
8. `104881857625848`

Sounds:
- hover `99955064134003`
- click `87437544236708`
- spin loop `5406934065`
- reward `4612378086`

Prize art is **content**, not chrome.

## Composition

- no card/panel/titlebar/backdrop;
- world remains visible;
- wheel square ~27% screen width;
- center around `(0.5,0.46)`;
- pointer over top rim;
- close just right of wheel top;
- below wheel:
  1. spins remaining;
  2. free-spin timer beside SPIN;
  3. row of three buy-pack buttons with `+ N Spins`;
- HUD open button at left edge around `(0.032,0.46)` with red timer chip;
- generate OPEN and spinnable for screenshot evaluation.

All exact geometry stays in template tables.

## Theme adapter

### SIM
- template uses canonical `makeStickerButton`;
- buy packs green with Robux icon;
- SPIN blue-cyan;
- close red;
- wedge accents in bright candy palette.

### STUDS
- template uses studded bevel-stack buttons;
- buy packs green with exact Robux icon;
- SPIN gold;
- close bright red;
- wedge accents bright saturated.

### MODERN STUDS
- the same wheel as CLASSIC STUDS: identical managed prefix, `CONFIG` API, chrome assets, wedge geometry, sounds and spin animation;
- every block is a MODERN STUDS `makeSurface` block (rounded, outlined, lipped, studded face) and every label a `makeText` label. The template inlines that kit from `themes/modern-studs/part-1.md`, so a change to the kit is a template change with a new hash;
- buy packs: green `button` blocks with the price as the Robux text glyph (`ROBUX .. " 99"`); the `+ N Spins` caption sits under each block, clear of its edge;
- SPIN: a larger gold `button`, 0.09 x 0.052 of the screen, at least 44 px tall;
- close: the theme's red `tile` with a white X;
- open button: a gold `tile` with the wheel icon and the timer as a red `chip` on its bottom edge;
- the spins-left line is extruded, and the free-spin time is green;
- blocks are named `Spin`, `Close`, `BuyPack1`-`BuyPack3` and `OpenWheel`.
- Checked live: spin, close and reopen work. The UI audit reports the 16 wedge labels as covered by the divider overlay, as it does for the CLASSIC STUDS wheel; that overlay is transparent between its lines, so those reports are expected.

## Runtime boundary

The maintained animation is allowed even though ordinary UI generation is static.
Do not add:
- remotes;
- MarketplaceService;
- server scripts.

Real purchase fulfillment and spin inventory are follow-up gameplay wiring. Initial buy buttons may animate only.

## Failures

- native-frame recreation of ring/slices/hub/pointer;
- swapped/reordered wedge masks;
- non-8 prize count;
- chances !=100;
- adjacent same accents;
- hand-written ScreenGui builder;
- edits outside CONFIG;
- card/backdrop behind wheel;
- closed initial state that cannot be visually checked.
