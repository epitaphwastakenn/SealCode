# MODERN STUDS selected body: shop-grid

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: both reference games' shops (one Dark, one Light panel): one vertically scrolling catalog of titled sections, no tabs. Panel width, card bands, and offer rows follow them; the height table keeps the classic STUDS shop's proven row-count sizing. Benchmarked once in Studio (6 cash packs, 2 passes, starter pack).

# SELECTED LAYOUT GUIDE (loaded via layout="shop-grid")

For: shops, stores, gamepass menus, bundle/offer screens: any screen selling multiple items. NOT for rebirth/confirm dialogs, inventories with selection panes, or HUDs.

The defining trait: **a sectioned catalog of studded cards and wide offer rows.** Every product is one card or one row with art on a sunburst and a green Robux price button.

## Measurements (1080p)

- Panel: `makePanelDark` (default) or `makePanelLight`, 0.46 screen width, centered. Height comes from THIS TABLE; copy the number for your content, never pick one by eye:
  - 1 card row, no offer row: `Size = UDim2.fromScale(0.46, 0.40)`
  - 2 card rows, no offer row: `Size = UDim2.fromScale(0.46, 0.53)`
  - 1 offer row + 1 card row: `Size = UDim2.fromScale(0.46, 0.56)`
  - 3+ rows, or an offer row + 2+ rows: `Size = UDim2.fromScale(0.46, 0.66)` (overflow scrolls)
  Content ending more than ~25% above the panel bottom means the panel is one row too tall.
- Header: the variant's own (Dark band 15% of panel height, or Light straddling title). Shop basket icon `rbxassetid://110972987269284`. Optional ONE purple "Gift" header action (Dark only, left of close).
- Content: the variant's `Content` ScrollingFrame. A `UIListLayout` (vertical, `Padding = UDim.new(0, 12)`, `SortOrder = LayoutOrder`) stacks the sections. Each section is a section title (`makeSectionTitle`, 44 px) followed by its rows.
- Card rows: a section Frame with `AutomaticSize = Enum.AutomaticSize.Y`, `Size = UDim2.new(1, 0, 0, 0)`, holding a `UIGridLayout` with 3 columns. Compute the cells from the content width, never by eye:

  ```lua
  local GAP = 14
  local grid = Instance.new("UIGridLayout")
  grid.CellPadding = UDim2.fromOffset(GAP, GAP)
  grid.SortOrder = Enum.SortOrder.LayoutOrder
  local function sizeCells()
  	local width = content.AbsoluteSize.X - content.ScrollBarThickness - 2
  	local cell = math.floor((width - 2 * GAP) / 3)
  	grid.CellSize = UDim2.fromOffset(cell, math.floor(cell * 0.92))
  end
  content:GetPropertyChangedSignal("AbsoluteSize"):Connect(sizeCells)
  sizeCells()
  ```
- Card: the theme's card (`card` block, bands name 0.04-0.18 extruded, art 0.18-0.75 at 0.9 of the band on a cropped wide sunburst, price row 0.77-0.96). Price row: green price button 0.74 card width centred, or price button 0.56 + purple gift square on its right. The art is the card: it should be the biggest thing on it, about half the card's height.
- Card colours step up in value (blue, green, cyan, purple, gold, pink); never grey on a card that is for sale.
- Art steps up with value too, and no two cards in a section share art. For a currency ladder use, in order: Coin `rbxassetid://84697600263846`, Cash `rbxassetid://70565105539676`, Ingot `rbxassetid://83606937519307`, pig and money `rbxassetid://103120983042082`, Chest `rbxassetid://76137715921998`, Crown `rbxassetid://78843852703854`. For other goods, ask `resolve_icon` for one distinct icon per card; with fewer distinct icons than cards, sell fewer packs rather than repeat art.
- A section title names the section's kind ("LIMITED OFFER", "CASH PACKS", "GAMEPASSES"), never the name of the one row under it: "STARTER PACK" above a row titled "Starter Pack" says it twice.
- The price label fills ~0.74 of the button face's height, so prices read at a glance.
- Wide offer row (featured pack, gamepass, starter pack): full content width, explicit pixel height = content width / 3.4 (set it in the same `sizeCells`), theme's wide offer row construction. Gamepasses and limited offers use offer rows; currency packs use cards.
- Categories are SECTIONS in the one scrolling catalog, every category on the same canvas, in this order: featured/limited offer rows first, then currency packs, then gamepasses, then codes or other extras. A shop has NO tabs: no tab rail, no tab row, no category buttons. This overrides the polish layer's tab row.
- Balances (when items cost soft currency): currency readouts on the first content row, left-aligned, never in the header.

## Rules

- Every product shows exactly ONE price button; Robux prices use the `ROBUX` glyph label, coin prices the coin icon group.
- Cards in a section are uniform and fill the row edge to edge (3 columns). Never scale cards up to fill vertical space; with few products, the panel shrinks to the table row that fits.
- Every card and offer row has art on a sunburst. A card with an empty art band is a defect; use `resolve_icon` for the art.
- Tier colours, tags, owned and discount states come from the polish layer, expressed with the theme: card face colour by tier, a bare red or gold text tag in the name band's right side (the theme's Tag), an owned card's button `paint`ed grey reading OWNED, a struck-through old price beside the new one in the price row.
- Section titles separate sections; a card row never appears without its section title when there are 2+ sections.
- No element sits outside the panel except the Light variant's straddling title, icon, and close.
- The catalog scrolls. Never shrink cards or rows to make a section fit without scrolling; the first section must show at least one full row at the panel's height.
- Card names are white (part 1, Text): a gradient amount on a same-colour card does not read.
