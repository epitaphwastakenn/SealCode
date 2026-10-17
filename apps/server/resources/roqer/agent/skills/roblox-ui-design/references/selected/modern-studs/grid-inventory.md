# MODERN STUDS selected body: grid-inventory

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: both reference games' Index/collection screens (5-column slot grids, rarity or world tab rails outside the panel, a detail pane on the right in one game, a "Discovered: N/M" counter). Slot semantics keep the CLASSIC STUDS inventory rules.

# SELECTED LAYOUT GUIDE (loaded via layout="grid-inventory")

For: inventories, pet/item storage, backpacks, lockers, collections you manage or complete (index screens): any screen where the player looks at what they own. NOT for shops (those sell), select screens (those commit to one option), or HUDs.

The defining trait: **a fixed grid of uniform square slots with a capacity counter, where empty and undiscovered slots stay visible.**

## Measurements (1080p)

- Panel: `Size = UDim2.fromScale(0.5, 0.6)`, centered, `makePanelDark` (default) or `makePanelLight`.
- Counter: "12/20" or "Discovered: 25/100" as the FIRST content row (a 36 px tall row), right-aligned, stroke 3, the number part in the gold gradient (a second label beside the caption). Never inside the header.
- Content: the variant's scrolling `Content` holds the counter row and the slot grid only. Everything in it is sized in pixels from `content.AbsoluteSize` (Scale heights inside a scrolling content overflow). Shorten it to leave the action row outside: `content.Size = content.Size - UDim2.fromScale(0, 0.12)`.
- Category or rarity tabs: the theme's tab rail on the panel's RIGHT edge (outside), as one reference game places it; the left edge only when nothing sits beside the panel there (a HUD's menu tiles usually do). One colour per rarity (Common grey, Uncommon green, Rare blue, Epic purple, Legendary gold, Mythic pink); the active tab at full colour and width, the others dimmed in their own colours (`setTab`). The visible slots always belong to the active tab.
- Slot grid: `UIGridLayout`, 5 columns, square cells at ~18% of content width, `CellPadding` ~2% of content width, computed from the content's `AbsoluteSize` to fill the width edge to edge. ~3-4 rows visible; the content scrolls for more.
- Render one slot per unit of CAPACITY (or per collectable entry): 3 pets out of 20 means 3 filled slots then 17 empty ones, filling left to right.
- Filled slot: a `tile` block (the slot IS the button: `makeSurface(grid, "tile", rarityColour, true)`). The art fills the slot, as both reference games draw it (modern-2: 0.9 of the slot): an art box covering the whole face (`Size = UDim2.fromScale(1, 1)`, `ScaleType.Fit`, no aspect constraint) with a `Fit` sunburst box the same size behind it, and the name over the art's bottom at 0.68-0.9 (stroke 2), wholly on the art's box (the theme's Text over art; checked live, audit clean). Optional rarity or count `chip` in the top-right at ~24% of cell width.
- Empty slot: the same block in `slate`, no content. Undiscovered collection entry: `slate`, the entry's art as a black silhouette (`ImageColor3 = Color3.new(0, 0, 0)`, ImageTransparency 0.2) and the name "???".
- Selection: the selected slot gets outline 5 and a `UIScale` of 1.05; every other slot outline 4, scale 1.
- When the game has no real item data, SEED 5-8 sample items with distinct names before building the grid.
- Action row: ONE action `button` (Equip/Unequip, or Claim for a collection reward) parented to the PANEL, not the content: `AnchorPoint = Vector2.new(0.5, 0.5)`, `Position = UDim2.fromScale(0.5, 0.92)`, `Size = UDim2.fromScale(0.26, 0.09)`.

## Detail-pane variant (item details, stats, or a selected collection entry)

- Build the panel with `scrolls = false`. Inside its `Content`: a ScrollingFrame for the grid on the LEFT at 62% of content width and full height (`AutomaticCanvasSize = Y`, `ScrollingDirection = Y`, cells in pixels, recomputed to 3 columns), ~3% gap. The panel-level action row above is not used in this variant.
- Detail card on the RIGHT: one `card` block, 35% of content width, full content height. Bands: art on a sunburst 0.06-0.46, name 0.5-0.6 (extruded), up to three stat lines 0.62-0.84, action button 0.86-0.96 (~0.7 card width). A collection reward version shows "Rewards:" with reward tiles in the stat band and a green Claim (or grey Claimed) button.
- The detail card always shows the selected slot's item; it is never empty.
- In this variant the action button lives on the detail card; there is no bottom action row.

## Rules

- Empty and undiscovered slots are visible; the counter shows current/max.
- Cells are square and uniform; never resize cells to fill leftover space or change the column count between rows.
- Slots select; ONE action button acts on the selection. A grid where every slot carries its own button is a defect.
- The item name belongs on the slot.
- No prices, purchase buttons, or banners in this layout.
