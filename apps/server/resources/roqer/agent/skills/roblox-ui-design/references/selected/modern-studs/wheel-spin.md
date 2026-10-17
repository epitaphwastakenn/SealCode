# MODERN STUDS selected body: wheel-spin

> Repository-authored. The MODERN STUDS wheel is its own template, built from the CLASSIC STUDS wheel with the MODERN STUDS surface kit in place of its buttons and labels.

# SELECTED LAYOUT GUIDE (loaded via layout="wheel-spin")

For: prize wheel / lucky wheel / spin-to-win screens: a radial wheel of 8 prize wedges, a pointer, a SPIN button, and spin-pack purchase buttons. NOT for vertical rolling reels (vertical-reel-roll), shops, or reward dialogs.

## Route

- A wheel is a specialized template layout. With MODERN STUDS active, deploy `templates/modern-studs/wheel-spin.lua` exactly: load `references/specialized/wheel-spin.md` and that template in the same route call, and follow that contract.
- Customize only the documented `CONFIG` values. Never redraw its geometry, rebuild its blocks by hand, or move its managed prefix: its bytes are protected.
- The template already uses the theme's blocks and text; do not restyle it further with the rest of the kit.
- The rest of the screen (a HUD tile that opens the wheel, a confirmation) uses the MODERN STUDS theme parts as usual.
