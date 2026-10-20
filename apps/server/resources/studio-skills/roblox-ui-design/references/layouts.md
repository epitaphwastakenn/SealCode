# Layouts: index and shared rules

A layout is a contract about what the screen does, not a look. A shop sells, an inventory manages what the player owns, a select screen commits to one option, a leaderboard only displays, a toast never waits. Pick the layout by the contract, then dress it with a theme (`references/themes/`) or a gallery archetype. If the picture looks right but breaks the contract (a "Challenge" button on every leaderboard row, a toast that says "click to continue"), it is the wrong layout.

Each layout has its own file under `references/layouts/`. Load only the one you need, plus its variant if you use one.

## Which layout

Ask these in order and stop at the first yes.

| The screen...                                                             | Layout file                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| lets the player buy things (packs, passes, bundles, a featured offer)     | `layouts/shop-grid.md`                               |
| shows what the player owns, with one selected and an Equip action         | `layouts/grid-inventory.md`                          |
| compares a few options and commits to exactly one (class, map, team)      | `layouts/select-screen.md`                           |
| is a checklist of goals with progress and a claim step                    | `layouts/progression-hub.md`                         |
| is a read-only ranking                                                    | `layouts/stat-leaderboard.md`                        |
| is a short message that leaves by itself and never needs a touch          | `layouts/notification-alert.md`                      |
| is a short prompt that waits for a decision (even if called a "toast")    | `layouts/centered-dialog.md`                         |
| fills the screen, hides the world, pushes one action (Play)               | `layouts/fullscreen-landing.md`                      |
| keeps the world visible and is one huge tap target plus a total           | `layouts/incremental-clicker.md`                     |
| is always-on stats, timers and bars along the screen edges                | `layouts/hud-zone-system.md`                         |
| is a rail of icon-and-label buttons on an edge, each opening its own menu | `layouts/vertical-navigation-sidebar.md`             |
| is a staff or owner command console                                       | `layouts/admin-control-panel.md`                     |
| is a radial prize wheel                                                   | `layouts/wheel-spin.md` (+ `specialized.md`)         |
| is a vertical crate, case or egg roulette                                 | `layouts/vertical-reel-roll.md` (+ `specialized.md`) |

Variants, each with its own short file: `loading-screen.md` (landing without buttons), `purchase-confirm.md` (small dialog), `inventory-detail.md` (grid plus detail pane), `collection-index.md` (discovered and undiscovered entries), `daily-rewards.md` (calendar of day tiles), `settings-panel.md` (toggles, sliders, steppers).

Neighbours that get confused:

- **HUD versus sidebar.** Icon-only stacks and number readouts are HUD. A rail where every button has an icon and a text label, and that is the whole UI, is the sidebar. A text-only rail is a defect.
- **Sidebar versus admin rail.** The admin rail sits inside a panel and switches the visible page. The sidebar sits on the world and each button opens a different menu.
- **Clicker versus landing.** Both have one big control. The clicker never blocks the world and has no backdrop; the landing blocks it.
- **Dialog versus toast.** Anything that waits for a click is a dialog.
- **Shop versus inventory.** Shop cells carry a price button and sit in titled sections. Inventory cells are square slots with a capacity counter and one shared action.
- **Leaderboard versus HUD.** Your own score is HUD. A ranking of other players is a leaderboard.
- **Requests that conflict with the contract.** A clicker "inside a centred opaque card" is either a clicker (keep the world visible) or a landing. A wheel "with frames instead of images" is still the wheel layout. Say which contract you kept and why.

Screens with no layout here (trading, tooltips, party lobby, emote wheel, minimap, tutorial prompt): build them from the surface kit of the active theme and the shared rules below, and keep them as small as a dialog or a toast.

## Footprint on a 1920x1080 screen

| Layout                      | Container        | Share of the screen                                     |
| --------------------------- | ---------------- | ------------------------------------------------------- |
| shop-grid                   | centred panel    | 46% wide, 40 to 66% tall (by row count)                 |
| centered-dialog             | centred panel    | 36 to 45% wide, 51 to 56% tall; small confirm 30% x 34% |
| fullscreen-landing          | the whole screen | content inside the centre 70% width                     |
| admin-control-panel         | centred panel    | 55% wide, 42 to 55% tall                                |
| hud-zone-system             | edge zones       | each zone at most 22% wide (top and bottom centre 40%)  |
| select-screen               | centred panel    | 45 to 60% wide, about 55% tall                          |
| grid-inventory              | centred panel    | 50% x 60%                                               |
| vertical-navigation-sidebar | edge rail        | buttons 9 to 11% x 7 to 7.5% each                       |
| progression-hub             | centred panel    | 52% x 62%; daily calendar 50% x 56%                     |
| stat-leaderboard            | centred panel    | 38% x 68%                                               |
| incremental-clicker         | none             | click target about 15% of the width                     |
| notification-alert          | top stack        | toast about 24% x 5.5%                                  |
| wheel-spin                  | none             | wheel fits a 36% x 60% box                              |
| vertical-reel-roll          | overlay + window | window fits 30% x 78%, aspect 1:2                       |

These are the PC numbers. Every layout file also gives a compact column for phones.

## Shared rules

### Size classes

Choose the class from `workspace.CurrentCamera.ViewportSize` when the screen opens and again when it changes: **compact** when `Y < 520` or `X / Y < 1.3` (phones, small tablets in portrait), **regular** otherwise. Layout files give panel Scale sizes and column counts for both. Never decide from `UserInputService.TouchEnabled` alone: a touch laptop is still regular, and a phone in a desktop emulator is still compact.

### Panels

A panel is a transparent or painted `Frame`, `AnchorPoint = (0.5, 0.5)`, `Position = {0.5, 0},{0.5, 0}`, with:

- `Size` = the width and height fractions of the layout.
- `UIAspectRatioConstraint` with `AspectRatio = width * 16 / (height * 9)` (PC) or the compact ratio from the layout file, `AspectType = FitWithinMaxSize`. Odd windows then shrink the panel instead of squashing it.
- `UISizeConstraint` with a `MinSize` (about 320 x 220) so it never collapses, and a `MaxSize` (about 1100 x 760) so a 4K display does not inflate it.

Derive every inner pixel number (stroke, lip, padding) from `unit = panelHeight / designHeight`, floored at 1, where the design height is the panel's height at 1080p (0.66 x 1080 for a shop). Targets stay at 44 px or more whatever the unit. Read the panel's real size from the usable area of its `ScreenGui` (the viewport minus `GuiService:GetGuiInset()`; the whole viewport when `ScreenInsets = None`), not from `CurrentCamera.ViewportSize`: on a phone the top bar costs about 58 px and a panel sized from the raw viewport is wrong by that much. Never compute a panel position or size in pixels at build time; that is the usual cause of panels pinned to a corner.

Panel height stays between 0.40 and 0.66 of the screen on regular windows (leaderboard up to 0.68). Content ends within about 12% of the panel bottom (8% in the cartoon card theme). Short content in a floor-height panel: enlarge the content. Long content in a ceiling-height panel: pack tighter or scroll. Never leave a dead band.

### Scrolling and exact fit

- A last row that is half inside the scroll window reads as a bug. Size rows so a whole number of rows fits at first render and extra rows start fully below the fold. In a mixed list (banner, headings, grids) you cannot always do that by size, so after the first layout find the first row that crosses the fold by less than a third of its height and add that visible amount to the scroller's top padding: it then starts below the fold instead of showing a few pixels.
- With `AutomaticCanvasSize = Y`, anything sized in vertical Scale resolves against the growing canvas and overflows. Children of a scroller get **pixel heights**; Scale width is fine. A panel that never scrolls (dialog, select, console, calendar) is a plain `Frame`, so Scale heights mean a share of the visible area.
- Reserve the scrollbar gutter (`ScrollBarThickness` 6 to 15, `VerticalScrollBarInset = Always`) so rows stop short of the bar.
- Grid cells are square-ish and need a pixel height. Measure the scroller and apply it:

```lua
local function fitGrid(scroller, grid, columns, gap, heightOverWidth)
	local function apply()
		local width = scroller.AbsoluteWindowSize.X - scroller.ScrollBarThickness - 2 * gap
		local cell = math.floor((width - gap * (columns - 1)) / columns)
		grid.CellSize = UDim2.fromOffset(cell, math.floor(cell * heightOverWidth))
	end
	apply()
	scroller:GetPropertyChangedSignal("AbsoluteWindowSize"):Connect(apply)
end
```

### Placement

- A layout object (`UIListLayout`, `UIGridLayout`) places its children. Always set `SortOrder = Enum.SortOrder.LayoutOrder` and give the children a `LayoutOrder`: the default sorts by name and shuffles a row of buttons (SHOP, SETTINGS, CODES came out as CODES, SETTINGS, SHOP). A child of a layout never gets its own Position, and a label floating over a grid is the top cause of unreadable shops.
- Every label lives in its own band of its own cell (name band, art band, price band). Bands do not overlap.
- A section heading takes a whole row between two sections. It is never laid over cards.
- Action rows: buttons in a row have identical sizes, the affirmative action on the left in the accent colour and the decline or cancel on the right (the simulator convention all three themes use; the AAA and minimal archetypes put the primary action on the right), a gap of about 3% between two buttons, never full width unless the layout says so.
- Interactive targets are at least 44 px tall and wide.
- Icons are square (`UIAspectRatioConstraint` 1), `ScaleType = Fit`, never stretched, never tinted unless they are flat white glyphs. Never give a square element a Scale width of 0 with an aspect constraint: it collapses to nothing.
- Text on a coloured block follows the theme (white with a dark stroke in all three themes). Text on a white card in the cartoon card theme is navy without a stroke.

### Core keep-out and insets

Roblox draws its menu button and chat in the top-left corner (about 350 x 70 px, more with voice chat). Nothing custom goes there. A `ScreenGui` with the default `ScreenInsets = CoreUISafe` already starts below the top bar; if you set `ScreenInsets = None` (needed for full-screen backdrops), offset anything near that corner by 70 px or more, never by a small Scale value. Treat the size as perishable: read `GuiService:GetGuiInset()` and test on a phone and a PC.

### Safe areas and touch

On phones keep interactive content inside the safe area (see `roblox-gui`), leave the bottom-left free for the thumbstick and the bottom-right for the jump button, and give every control at least a 44 px hit area even when its picture is smaller.

### Seed every state on first render

A screen that shows only the happy path hides its defects. Build with believable demo data so the first screenshot shows the states of the layout:

- shop: tiers, one to three tags, one owned item, one discount, a featured offer with a cue;
- inventory: filled and empty slots, one selected, a counter;
- progression: incomplete, claimable, claimed and barely started rows;
- leaderboard: strictly descending values and the local row;
- notifications: two or three toasts of different kinds at once;
- wheel: open and spinnable; reel: a long strip with a configured winner;
- admin: one active category with commands; select: one selected, one locked.

Data is demo literals in one table; the game's real data, purchases and remotes are wired in a later step through one named handler per action (`onPurchase`, `onClaim`, `onSelect`). Presentation (hover, tabs, tweens) is live.

### Order of authority when rules clash

1. The specialised template and its contract (`specialized.md`).
2. A reference image the user supplied, for composition (footprint, proportions, density, negative space). It replaces the layout's default geometry; the theme still supplies construction.
3. The layout file.
4. The theme or gallery archetype.
5. `polish.md` (it only adds; it never moves, resizes or recolours).
6. `roblox-gui` engine advice (it must not override a layout's geometry).

### Editing an existing screen

Find its builder, keep the ScreenGui and script identity, keep panel size and section order, change only what was asked, copy the neighbouring elements' construction for anything new, then screenshot and check nothing else moved. Do not switch layout or theme unless the user asks for a redesign. Moving a screen to another theme means rebuilding it.

## Layouts and themes

Layouts say where things go and how many. Themes say how a block is built. The theme files list surface kit names (Panel, Header, Close, Button, Card, Chip, Tab, Bar, Toggle, Badge); the layout files use those names. Do not blend two theme constructions on one screen.
