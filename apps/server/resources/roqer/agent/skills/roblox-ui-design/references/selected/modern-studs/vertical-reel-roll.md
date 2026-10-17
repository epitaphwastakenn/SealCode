# MODERN STUDS selected body: vertical-reel-roll

> Repository-authored. MODERN STUDS has no reel template of its own.

# SELECTED LAYOUT GUIDE (loaded via layout="vertical-reel-roll")

For: case/crate/egg opening screens where prizes roll vertically through a center window and decelerate onto the won item (limited-item unboxing, mystery box, item roulette). NOT for radial wheels (wheel-spin) or reward dialogs.

## Route

- A reel is a specialized template layout, and the maintained template exists only for SIM and CLASSIC STUDS. With MODERN STUDS active, deploy the **CLASSIC STUDS** reel exactly: load `references/specialized/vertical-reel-roll.md` and `templates/studs/vertical-reel-roll.lua` in the same route call, and follow that contract.
- Customize only the documented `CONFIG` values. Never restyle the template with the modern surface kit, redraw its geometry, or move its managed prefix: its bytes are protected.
- Tell the user once, in the run's reply, that the reel uses the CLASSIC STUDS construction because MODERN STUDS has no reel template yet.
- The rest of the screen (a HUD tile that opens the reel, a result dialog) still uses MODERN STUDS.
