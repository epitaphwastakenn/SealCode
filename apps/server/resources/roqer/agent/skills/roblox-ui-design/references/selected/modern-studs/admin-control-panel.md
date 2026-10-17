# MODERN STUDS selected body: admin-control-panel

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: none in the reference games. The tree and its numbers are carried from the CLASSIC STUDS admin body and re-skinned with the modern surface kit.

# SELECTED LAYOUT GUIDE (loaded via layout="admin-control-panel")

For: admin panels, staff/mod/owner panels, event and troll panels, developer spawn tools: any restricted console where an operator runs commands on the game or on another player. NOT for shops, settings dialogs, or player-facing menus.

The defining trait: **a two-pane console: categories on the left, a dense grid of labelled command buttons on the right.** Commands are plain labelled buttons, never cards.

## Build this tree (Scale unless marked Offset)

```
ScreenGui (ZIndexBehavior = Sibling)
└─ Panel: makePanelDark(gui, "AdminPanel", panelW, panelH, "blue", "Admin", <shield/crown icon from resolve_icon>, false)
   panelW = 0.55 * math.min(1, 1.78 / (viewport.X / viewport.Y)); panelH from the table in Rules.
   The Dark variant is mandatory here: an operator console is never the Light card.
   ├─ Rail Frame: Position (0, 14, 0.15, 16), Size (0.22, 0, 0.85, -30), transparent,
   │  UIListLayout vertical, Padding (0, 8).
   │  └─ one `chip` block per category, Size (1, 0, 0, 52), its name centred.
   │     EXACTLY ONE is in colour (blue, the active category); the others are grey.
   └─ ContentPane Frame: Position (0.26, 0, 0.15, 16), Size (0.72, 0, 0.85, -30), transparent.
      ├─ TargetRow Frame: Size (1, 0, 0, 46), top. Only when a command acts on a player.
      │  ├─ TargetBox: the theme's text input, Size (0.7, 0, 1, 0), placeholder "Player name".
      │  └─ AmountBox: same, Size (0.28, 0, 1, 0), right-aligned, only when a command takes a number.
      └─ CommandScroll ScrollingFrame: Position (0, 0, 0, 54), Size (1, 0, 1, -54),
         AutomaticCanvasSize Y, ScrollBarThickness 6, transparent.
         └─ UIGridLayout: CellSize (0.313, 0, 0, H), CellPadding (0.03, 0, 0, 10).
            H from the ACTIVE page's row count: 1-2 rows → 145; 3 rows → 96; 4+ rows → 64.
            └─ one `button` block per command, label only.
```

Call `makePanelDark` with `scrolls = false`; it provides the header band and close. Leave its `Content` frame empty and build the rail and pane directly on the panel as above. Only `CommandScroll` scrolls, and its cells are pixel heights.

Only the active category's page exists under CommandScroll at any moment: destroy the previous page's buttons before building the next.

## Rules

- Copy the tree's numbers; 3 x 0.313 + 2 x 0.03 = 1.0 makes the three columns fill the pane.
- Colour encodes danger: destructive commands (kick, ban, freeze, jail, kill) are red blocks; every other command is a non-red block (green, blue, purple, orange). Players-page entries are blue.
- The highlighted category MUST be the one whose commands are on screen. Recolour with `paint` when switching.
- Commands are label-only `button` blocks: no icon, art, price, or description child.
- Panel height comes from THIS TABLE, keyed by the active page's grid rows (3 columns, rows = ceil(commands / 3)):
  - 1-2 rows: `0.42` · 3 rows: `0.47` · 4 rows: `0.51` · 5+ rows: `0.55` (overflow scrolls)
  Size.X stays at panelW whatever the command count; only the height changes. Never below 0.42.
- Categories live in the left rail inside the panel: never a top tab strip, never the outside tab rail.
- No banners, featured slots, sunbursts, or artwork anywhere in this layout.
- Player targeting: player names are ordinary label-only buttons under a "Players" category; clicking one writes `TargetBox.Text`. Pad the Players page with demo names to at least 6 (real players first).
- The default active category on build is the action-command category, never Players.
- This screen does not blur the world: an operator needs to see the game. Call `panel.Visible = true` instead of `openPanel`, and keep the polish pop on its `UIScale` only.
