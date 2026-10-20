# Gallery of UI archetypes

Eighteen looks that real Roblox games use, described so you can build them from instances. Pick one archetype per game (see the table), then take its palette, type and signature components, and build the parts with the recipes in `construction.md`. `styles.md` has the five broad families; this file is the finer cut, and each archetype below names its nearest family.

Text on buttons, tiles, tabs, chips and titles is centred in every archetype (see SKILL.md); the entries note the few places where left alignment belongs (rows with a value on the right, lists, body copy).

Read these as styles, not as files to copy: never reproduce another game's art, logo or character. Palettes are approximate starting points; keep the relationships (base, light, dark, ink) when you shift the hue. Sizes are for a 1920x1080 design.

## Choosing quickly

| The user says                                                     | Use                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| "make it look good" with no genre                                 | Ask (see SKILL.md). Default suggestion for a simulator or tycoon: 7 Simulator white-panel cartoon |
| "like popular simulators", "pet sim", "tycoon"                    | 7 Simulator white-panel cartoon, with 8 Glossy HUD kit for the HUD                                |
| "brainrot", "clickbait", "loud", "MrBeast style", "kids buy this" | 9 Brainrot clickbait shop                                                                         |
| "professional", "AAA", "premium", "console game"                  | 1 AAA sleek black panels (2 for item cards)                                                       |
| "clean", "minimal", "simple"                                      | 3 Monochrome minimal (dark) or 4 Soft light kit                                                   |
| "modern"                                                          | 5 Flat windowed UI for tools and settings; 3 or 6 for game menus                                  |
| "cute", "kawaii", "pastel", "girly"                               | 4 Soft light kit, pink variant                                                                    |
| "cartoon", "colourful", "fun"                                     | 7, 9, 10 or 13, by how loud                                                                       |
| "blocky", "lego", "studs", "classic Roblox"                       | 14 Studded blocky                                                                                 |
| "fantasy", "RPG", "medieval", "anime story"                       | 15 Dark fantasy ornate (parchment alternative in `styles.md`, family 5)                           |
| "sci-fi", "futuristic", "robots", "space"                         | 16 Sci-fi chamfer                                                                                 |
| "mobile game", "Clash-like", "gacha"                              | 12 Ribbon and bevel shop, 13 Chunky slate kit, or 16 hex cards                                    |
| "admin panel", "settings window", "dev tool"                      | 5 Flat windowed UI (WindUI, see `windui.md`)                                                      |
| "show items in 3D", "character skins"                             | 2 Viewport-frame item cards                                                                       |
| "floating menu in the world", "VR-like", "diegetic"               | 17 or 18                                                                                          |
| "match my game"                                                   | Inspect StarterGui first; see SKILL.md                                                            |

Nearest family: 1, 3, 4, 5, 6 are Modern; 7, 8, 9, 10, 12, 13, 14 are Cartoon or Simulator; 15 is Fantasy; 16 is Sci-fi; 2 is Modern or Simulator depending on its card frame; 17 and 18 take the style of whatever screen is placed in world space.

---

## 1. AAA sleek black panels

**Use for:** shooters, horror, tactical, roleplay with a serious tone, console-style lobbies and settings, anything a teenager would call "like a real game". Also the amber-selection variant for SCP, military and dystopian games.

**Layout:**

- Menu is a vertical stack of wide thin rows on the left (x 0.04 to 0.30), the world or key art stays visible on the right.
- Top of screen: a title in the top-left ("WELCOME TO ...") with a small subtitle under it, and a single row of tab boxes under that or centred at the top with `Q` and `E` key caps at both ends.
- Bottom: one hint bar with key caps and short labels ("ENTER Select", "ESC Close"), centred or left, 14 to 16 px.
- Settings screens are a centred column, 0.45 to 0.55 of the width, rows 48 to 56 px high, label left, value or control right.

**Palette:**

- Backdrop: black at 0.35 to 0.55 transparency over the world, plus `BlurEffect` 12 to 20 in Lighting while open.
- Panel `#0B0B0B` at 0.15 to 0.3 transparency; row `#111111` at 0.3.
- Line `#FFFFFF` at 0.80 to 0.88 transparency, 1 px.
- Text `#F4F4F4`; muted `#8C8C8C`; disabled `#4A4A4A`.
- Selected: solid white fill with near-black text (`#0A0A0A`), or the amber variant: `#F5A623` 2 px outline with a faint amber glow behind it.
- Optional heat colour for one featured card: `#C98A2B` gold on its border and kicker text.

**Type:** body `GothamMedium` or `SourceSansSemibold`; headings and tabs `TitilliumWeb`, `Oswald` or `GothamBold`, uppercase. Roblox has no letter spacing: for the wide-tracked amber variant put a hair space (U+200A) between letters of short headings and check it renders. Body 18 to 22 px, headings 28 to 40, hints 14 to 16.

**Signature components:**

- _Box button:_ `Frame` black at 0.3 transparency, `UIStroke` 1 px white at 0.8, `UICorner` 0 to 2 px, `LineJoinMode = Miter`. No gradient, no lip. Hover: stroke to 0.3 transparency and fill to 0.1. Selected: `BackgroundColor3` white, text near-black, stroke off.
- _Featured card:_ a box button taller (90 to 110 px) with an `ImageLabel` thumbnail left (ScaleType Crop), a 12 px muted kicker line ("FEATURED MODE") above a bold name; one card may carry an amber 2 px stroke.
- _Key cap:_ small `Frame` white, `UICorner` 3, black bold 13 px letter, 22x22; the label sits right of it.
- _Segmented meter_ (volume): ten 12x12 frames with 4 px gaps, filled ones `#CFCFCF`, empty ones transparent with a 1 px stroke.
- _Stepper row:_ `<` and `>` as small square `TextButton`s around the value text, value centred in a fixed width so the arrows do not move.
- _Frame decoration:_ thin horizontal lines top and bottom of the screen with a short angled notch at the centre (two rotated 1 px frames), small corner brackets on the selected row.
- _Scroll bar:_ 2 to 3 px wide, white at 0.4 transparency, with tiny arrow nibs at both ends.
- Section headers: bold uppercase text with a 1 px white underline across the column.

**Spacing and density:** low density, generous margins (48 to 64 px from the screen edge), 8 px between rows, 16 px inside rows. Everything left-aligned in the column; values right-aligned.

**Good:** hard edges, consistent 1 px lines, one white or amber selection state, text at 3 sizes only, and the world visible and blurred. **Cheap:** rounded corners, gradients, drop shadows, drop-shadowed text, more than one accent colour, or a panel so opaque the world disappears.

---

## 2. Viewport-frame item cards

**Use for:** skins, characters, towers, weapons, pets, crates: any shop or collection where the item is a 3D model. Works in the AAA, simulator and tower-defence looks.

**Layout:** a row of tall cards (aspect about 0.55 to 0.75). Name on top, the model filling the middle and standing on a soft ground shadow, a rarity chip bottom-left, and the buy or equip button across the bottom. Beside the row, a smaller panel of crates or bundles in a 2x2 grid with square thumbnails.

**Palette:**

- Dark card: gradient `#2A2A2A` top to `#0F0F0F` bottom for common; tint the whole card by rarity (green `#1F6B3A` to `#0D2A18` uncommon, blue `#1F4F9E` to `#0B1E3D` rare, purple `#6A2FB0` to `#25103F` epic, gold `#B8861B` to `#3D2A06` legendary).
- Text white; rarity chip `#000000` at 0.5 transparency with a small coloured star icon.
- Price button green `#2FD05A` fill, 3 px darker stroke `#12823A`, white bold price with a coin icon. Locked: grey `#8A8A8A` with a padlock, text `#1E1E1E`.
- Selected: 2 px white `UIStroke` on the card.

**Type:** names `GothamBlack` uppercase 26 to 34 px, a small subtitle `GothamMedium` 16 px under it, prices `GothamBold` 22 to 26 px. White with a 2 px black `UIStroke` if over art.

**Signature components:**

- _ViewportFrame:_ `BackgroundTransparency = 1` over a gradient `Frame`. Clone the model into it (strip scripts), set `Camera` as a new `Camera` and `viewport.CurrentCamera = camera`, frame it from `model:GetBoundingBox()`: camera at `center + Vector3.new(0, size.Y * 0.1, size.Magnitude * 0.9)` looking at the centre, `FieldOfView` 30 to 35. Set `Ambient` `#9A9A9A` and `LightColor` `#FFFFFF`, `LightDirection` `Vector3.new(-1, -1, -1)`. Anchor every part. If the model must animate, put a `WorldModel` inside and load an animation; otherwise a static pose is enough.
- _Turntable:_ rotate the model a few degrees per second only while the card is visible (one `Heartbeat` connection per open screen, disconnected on close), or tween a `CFrameValue`. Do not rotate 30 viewports at once; rotate the hovered or selected one.
- _Ground shadow:_ an elliptical `Frame` (`UICorner` 1,0), black at 0.6 transparency, 60% of the card width and 8% of its height, centred under the feet, with a `UIGradient` fading to the edges.
- _Rarity chip:_ pill `Frame` black at 0.45, 8 px padding, star icon plus the word.
- _Price strip:_ full card width, 44 to 52 px high, rectangular or 6 px corners, 3 px darker stroke.
- _Crate tiles:_ black `#0D0D0D` square with a 1.5 px white stroke, the crate rendered inside, the label above and a green price chip overlapping the bottom edge by half its height.

**Spacing and density:** 16 to 20 px between cards; the model fills 70% of the card height; 3 to 5 cards visible per row on PC, 2 on a phone.

**Good:** every model framed to the same size and camera angle, soft ground shadows, one rarity colour per card. **Cheap:** models of different scale, a model cropped by the card edge, a flat grey card with a stock icon, rarity shown only as a word.

---

## 3. Monochrome minimal (dark)

**Use for:** story, social, cosy, tycoon-lite and prototype games whose creator wants "simple, no clutter"; also a good default when you do not know the genre and the user said clean.

**Layout:** one large rounded dark panel centred (0.55 x 0.7). Inside it, an inset detail card at the top (icon left, title and description right, price pill under) and a row of three large square option tiles at the bottom (icon over a short label). A round red close button overlaps the panel's top-right corner by half its size.

**Palette:** panel `#23222A`; inset card `#323340`; text plates `#44445A` at 0.3 transparency or `#3C3C4C`; text `#FFFFFF`; description text `#D6D8E0`; one positive accent `#3CFF82` (price pill, with dark text `#1A1A1A`); highlight tile text in gold `#FFBE3C` for a premium option; close button `#FF3B3B` with a white X. Page behind it `#E4E4E4` in the mockups but the real game shows the world.

**Type:** `Montserrat` or `BuilderSans`; titles Bold 32 to 40 px uppercase; description Regular 20 px, centred, 2 lines max; tile labels Bold 20 px.

**Signature components:**

- _Panel:_ `UICorner` 24, no stroke, a 4 px soft shadow (9-slice shadow image or a frame at 0.85 transparency 4 px lower).
- _Tile button:_ `UICorner` 20, fill `#2D2D36`, icon at 55% of the tile, label under it; hover lifts the fill 8% lighter and scales 1.04.
- _Price pill:_ `UICorner` 12, green fill, currency icon plus number centred as one group (`UIListLayout` horizontal, centre aligned, 8 px gap).
- _Icons:_ flat, one colour, no outline: white, accent or gold. A ticket, crown or sparkle in solid shapes. Do not mix in glossy 3D icons.
- _Close:_ 64 px circle, `UICorner` 1,0, a thick white X made from two rotated 6 px frames or an icon.

**Spacing and density:** very airy. 32 px panel padding, 24 px between cards, one hero item at a time. Three clicks of information per screen at most.

**Good:** exactly one accent colour, large radius, large readable type, flat icons from one family. **Cheap:** strokes and gradients creeping in, five accent colours, small cramped text.

**Light variant:** panel `#F4F4F2`, cards `#FFFFFF` with a 1 px `#E3E3E0` stroke, text `#1C1C22`, same accent but darker (`#1FBF5E`).

---

## 4. Soft light kit (off-white, pastel and cute)

**Use for:** casual, cute, social, pet-care, dress-up, daily rewards, and "friendly modern" shops. The pink variant is the kawaii reward screen.

**Layout:**

- _Shop:_ a small, centred white card (0.5 x 0.6) with a header row (icon + title left, close right), a wide banner bundle across the top of the content with big art on both ends and a dark price pill overlapping its bottom edge, then a two-column grid of tinted item cards below. Currency pills sit top-left, a vertical rail of four square icon buttons on the right edge.
- _Daily reward:_ a pink panel with a banner title tab overlapping its top-left, 3 x 2 day cards and one tall "day 7" card on the right, each card with a small day label, a gift icon and a CLAIM button.

**Palette:**

- Soft white: card `#FFFFFF`, border `#C9D4DE` (3 to 4 px), banner plate `#D5DEE6`, title text `#B6C4D1` (pale) or `#2E4458` (dark slate for body).
- Tint cards: yellow `#FFE35A` with orange text `#B8631A`, blue `#33B5FF` with navy text `#123C8F`, green `#7BE06A`.
- Rail buttons: sky `#8AD4FF`, coral `#FF8F88`, sun `#FFC93C`, grey `#D3D9DF`, each with a 3 px darker rim and an icon inside.
- Close: coral-red `#F05A6A`, white X.
- Pink reward variant: panel `#FF9CC8`, rim white 4 px, cards `#FFC4DD` with inner `#FF84B5`, buttons `#8A2FD6` with white text, title ribbon `#FF6FAE`.

**Type:** `FredokaOne` for titles and prices, `BuilderSansBold`/`GothamBold` for small text. Titles can be pale on the plate (`#B6C4D1`) with a very light stroke; item names in the card's dark tint colour, uppercase, 22 to 26 px.

**Signature components:**

- _Card:_ `UICorner` 12 to 14, a 3 px darker rim (`UIStroke` Border) in the card's own hue, a 4 px lip, and a soft inner highlight (top 30% white at 0.85).
- _Banner plate:_ grey-blue frame with the title centred and art overhanging the plate's left and right edges (`ClipsDescendants = false`).
- _Price pill:_ dark navy `#2B3F52` pill, white bold number, overlapping the bottom edge of its card by half its height.
- _Currency pill:_ white pill with a grey inset field holding the number right-aligned, a round currency icon overlapping the left end, and a square "+" button on the right in the currency's colour.
- _Rail button:_ 72 px square, `UICorner` 14, rim 3 px, icon at 60%; active one is lighter.
- _Reward card (pink):_ white-rimmed rounded card, glossy highlight along the top, a sparkle sticker in one corner, the CLAIM button in a contrasting purple at the bottom.

**Spacing and density:** medium. 12 px grid gap, 16 px card padding, plenty of art per card. 6 to 8 cards visible.

**Good:** pale plates with dark slate text, saturated art on tinted cards, round overlapping badges. **Cheap:** pure black text, neon fills on white, rims in black instead of a darker tint of the fill.

---

## 5. Flat windowed UI (admin, settings, tools)

**Use for:** admin panels, developer tools, settings windows, map editors, configuration screens, "script hub" looks, anything with many toggles, sliders and tabs. Not for kids' HUDs. Build it with WindUI when it saves effort (`windui.md`), otherwise by hand as below.

**Layout:** a floating, draggable window (about 0.4 x 0.6 of the screen, max 900x600) with a title bar (icon, title, small author line, minimise, maximise, close), a left tab list 190 to 220 px wide, and a content pane of grouped rows on the right. The world stays visible behind it; a soft shadow separates the window.

**Palette (dark):** window `#101010`; sidebar `#0F0F0F`; content pane `#1B1B1D`; element `#2A2A2C`; text `#FFFFFF`; secondary text `#9A9AA0`; icon `#A1A1AA`; toggle on `#33C759`; slider fill `#0091FF`; destructive `#FF453A`. Light: window `#FFFFFF`, pane `#F4F4F5`, element `#EDEDEF`, text `#111111`.

**Type:** `BuilderSans` or `GothamMedium`; title SemiBold 18; element titles 16; descriptions 13 to 14 in secondary colour. No all-caps.

**Signature components:**

- _Window:_ `UICorner` 16 to 20, shadow, a thin 1 px white stroke at 0.9 transparency.
- _Tab item:_ 40 px row, `UICorner` 10, icon (outlined, 18 px) + name; active tab fill white at 0.93 transparency, text full white; inactive text at 0.3 transparency.
- _Element row:_ `UICorner` 12, fill `#2A2A2C`, 56 px high, title left, description under it, control right.
- _Toggle:_ 44x24 pill, knob a 20 px white circle, tween the knob and track colour in 0.15 s.
- _Slider:_ 6 px track, filled part in the accent, 18 px white thumb, value text right in a small rounded box.
- _Dropdown:_ element row with a chevron; the menu is a floating panel under it in a darker fill.
- _Notification:_ toast stack at the bottom-right, same element styling, icon left.

**Spacing and density:** medium-high. 8 px between rows, 12 to 16 px row padding, group headers 14 px muted. Content scrolls; keep the window itself fixed.

**Good:** consistent row height, one accent for "on" and one blue for values, outlined icons from one pack. **Cheap:** rainbow buttons, tab labels in another font than the content, rows of different heights.

---

## 6. Colour-tile menu

**Use for:** a hub menu or "game selection" overlay that is mostly a few big destinations (Shop, Ranks, Game Passes, Help), in a modern flat game.

**Layout:** one white frame (0.55 x 0.5) with a black title bar (title left, a minimise dash right) and a mosaic below: one large tile on the left (about 40% of the width, full height) and a 2 x 2 arrangement on the right where the bottom tile spans both columns. 12 px white gutters between tiles.

**Palette:** frame `#FFFFFF`; bar `#1E1E1E`; tiles are vertical gradients: orange `#F7C466` to `#F07A28`, pink `#EFA6F0` to `#E1307F`, green `#9DF59A` to `#6EE53C`, blue `#6EEFF2` to `#3B86E8`. Labels white.

**Type:** `SourceSansBold` or `GothamBold`, uppercase, 40 to 64 px for the big tile, 32 to 40 for small ones. The reference sets labels at the bottom-left of each tile with 24 px padding; this skill's rule is to centre labels, so centre them (bottom-centre) unless the user asks for the reference look, and then keep every tile consistent.

**Signature components:**

- _Tile:_ `TextButton` or `Frame` with `UIGradient` Rotation 90, no corner or 2 px corner, a 12 px inner lighter inset (a child frame at 0.85 white transparency, inset 14 px) that gives the soft panel feel.
- _Hero tile:_ a character render or key art `ImageLabel` behind the label, tinted with the tile colour (a gradient overlay at 0.3 transparency).
- _Hover:_ the inset brightens and the tile scales 1.02; no outline.

**Spacing and density:** very low density, 4 to 6 tiles, huge type.

**Good:** hard rectangles, gradients that are clearly one hue each, large type tied to the tile edge. **Cheap:** rounded pill corners and dark outlines (that is a different style), or six different fonts.

---

## 7. Simulator white-panel cartoon

**Use for:** pet simulators, clicker and idle games, tycoons, "collect and upgrade" games, shops, inventories. The default for anything with lots of items and numbers aimed at kids and teens.

**Layout:**

- _Window:_ centred panel 0.42 to 0.5 of the width. A coloured header band (red-orange `#E2553A` or red `#E8283A`) holds a short uppercase title left and a white X right. Content sits on a light card with the window outline in thick black-navy.
- _Inventory:_ grid of square slots on the left (about 65%), a detail column on the right (portrait, name, big multiplier, EQUIP / DELETE row, a wide MERGE button), a footer row of utility buttons ("Equip Best", "Merge All") and counters ("Equip: 0/3", "Own: 6/50").
- _Shop:_ a stack of wide offer rows (full-width banners with a big icon left, title and tagline, a price chip right) and rows of three small cards, separated by thin black dividers.
- _HUD:_ left vertical grid of icon buttons (shop, gift, settings, pets), bottom-left a currency icon row, bottom-centre a huge green cash bar with a thin level bar under it, bottom-right a help button.

**Palette:** panel white `#FFFFFF` with a 4 px outline `#12203A`; slot fill `#6E7480` to `#4A4F5A` or tinted by rarity; rarity outlines common green `#74E04B`, rare blue `#3CA8FF`, epic purple `#9A4CFF`, legendary yellow `#FFC93C`; header red `#E2553A`; primary action green `#3DDC5A` with dark rim `#1C9E3A`; info blue `#2F9BFF` rim `#1B63B8`; delete dark red `#9E1F2A`; cash text white on green.

**Type:** `FredokaOne` or `BuilderSansExtraBold`; white fill with a 2 to 3 px dark navy `UIStroke` on every label that sits on colour; rarity names in the rarity colour with the same stroke; small stats 14 to 16 px.

**Signature components:**

- _Window:_ `UICorner` 16, `UIStroke` 4 px `#12203A`, header band with only the top corners rounded (a square frame under its bottom half).
- _Pill button:_ the lip button from `construction.md` with `CornerRadius` 0.5, 3 px outline, a top shine; sizes by importance (MERGE wide, EQUIP and DELETE half each).
- _Slot:_ rounded square, 3 px rarity-coloured stroke, a multiplier label (`x1.2`) at the top in small white text and the item name at the bottom in the rarity colour, the pet or item rendered as a `ViewportFrame` or image in the centre.
- _Cash bar:_ wide pill, green gradient, huge white number, 4 px navy outline; a thin XP bar below with a left "Lvl. 0" and right "0/100" caption.
- _Icon rail:_ 56 to 64 px icon buttons with a glossy 3D icon, no frame, a tiny red dot for notifications.
- _Offer row:_ 3D art bursts out of the left (`ClipsDescendants = false`), the title at the top right in white with a stroke, a tagline underneath in small yellow, and a green price chip bottom-right; behind it a checker or dot pattern tinted a lighter shade of the row colour.

**Spacing and density:** high density but even: 8 to 12 px gaps, slots 72 to 96 px, rows 90 to 120 px. Legible at phone size because labels stay 14 px or more with a stroke.

**Good:** thick uniform outlines, rarity colour only on outlines and names, the same pill button everywhere, 3D icons from one family. **Cheap:** thin grey strokes, default fonts, plain grey slots with no multiplier or name, buttons with no lip.

---

## 8. Glossy HUD kit (currency pills, bars, portraits)

**Use for:** the always-on layer of a cartoon or fantasy game: currency counters, health and energy bars, a player card, a vertical rail of round menu buttons, and settings with toggles. Pair it with archetype 7, 9, 12 or 16 for the screens.

**Layout:** top-left or top-centre row of currency pills; left or right edge a column of round icon buttons (5 at most); bottom or top-left a player card (portrait, name plate, bars); a settings panel with toggle rows.

**Palette (purple variant):** panel `#3A1E8F` with a 4 px outer rim `#7C3AED`, inner field `#1E1050`; row `#2B1A6E` at 0.2 with a 2 px light rim `#6C4DE0`; text white; toggle off `#FF6B8A`, on `#3DE0C0`; round buttons ringed in different hues (red `#E8284A`, purple, blue `#2F9BFF`, orange `#FF8A1F`, pink `#FF2D87`). **Blue gem variant:** crystal blue frame `#3F8FE0` with a lighter bevel `#8ED0FF` and dark core `#1E3F8F`, bars cyan `#35C8FF`, red `#E8283A`, green `#47D94A`, orange `#FFA11E`, pink `#FF3DA8`.

**Type:** `FredokaOne` white with a 2 to 3 px dark stroke for titles ("Settings" tilted -3 degrees, overlapping the panel's top edge); numbers `FredokaOne` or `GothamBlack` 22 to 26 px; row labels `FredokaOne` 22 px.

**Signature components:**

- _Currency pill:_ a dark inner field, a 3 px bright rim, a round glossy currency icon overlapping the left end, the number centred, and a small round "+" button in teal at the right end.
- _Round icon button:_ 76 px circle, 4 px rim in the button's hue, a dark inner disc `#1E1050`, a glossy icon at 60%; pressed state scales 0.94.
- _Toggle:_ a 64x28 track with a 22 px knob; the knob is a coloured dot (pink off, teal on) inside a dark track with a 2 px rim, much like a status light.
- _Bar:_ 28 px high, 4 px dark rim, fill is a two-stop vertical gradient with a 1 px lighter top line, an icon at the left end overlapping the rim.
- _Portrait frame (gem):_ an octagon or rounded-square frame image with the player headshot (`rbxthumb://type=AvatarHeadShot&id=<userId>&w=150&h=150`) inside a clip.
- _Name plate:_ a bevelled bar with the name in bold white and a slightly lighter top edge.
- _Settings row:_ 44 px, `UICorner` 10, label left, toggle right; scrollbar a thin pill on the panel's right edge.

**Spacing and density:** compact: 8 px between pills and bars, 12 px between round buttons. The whole HUD stays in the corners.

**Good:** consistent rim thickness on every piece, icons overlapping the ends of pills, one hue family per panel. **Cheap:** flat bars with no rim, floating numbers with no pill, icons in a different art style from the pill frames.

---

## 9. Brainrot clickbait shop

**Use for:** "brainrot", meme and trend games, content-creator-style games, anything whose shop must feel urgent and loud: Robux offers, limited items, character shops, trail and effect shops.

**Layout:**

- Background world blurred and tinted (`BlurEffect` 18 to 24, a purple-teal wash) so the colours pop.
- _Character shop:_ a modest panel with a light header strip (tiny bag icon, title, red X) and a vertical scrolling list of wide banners; each banner is a scene illustration with the 3D character on the left, name top-right, a small dark stat box (health, damage, type) and two stacked buy buttons right.
- _Trail shop (grid):_ a purple panel, big pill title bar with a white title and a red X, a 2 x 2 grid of tier cards each tinted by its colour (grey, green, blue, purple), a dark preview window showing the item in action with its stat under it, the price with an icon, and a full-width button at the bottom (green EQUIP or grey LOCKED with the requirement in red).
- Tags: MOST POPULAR (red) and LIMITED (red) corner ribbons, top-left of the card.

**Palette:** purple panel `#3A1FA0` with a `#7B2FD6` header, rim `#1A0F4A`; green `#2FD34F` / dark `#12842E`; Robux green button `#3DD65A`; currency purple `#8A2BE2` / dark `#4B1590`; blue card `#1F5FD0`; grey card `#6B7280`; locked `#4B5563`; red `#FF2D55`; white text with a thick dark stroke; selected character gets a white glow outline.

**Type:** `FredokaOne` or `GothamBlack`, white with a 3 to 4 px dark `UIStroke` (use `#1B1030`, not black); titles 40 to 56 px, item names 28 to 34, prices 26 to 30, small caps tags 14 px bold.

**Signature components:**

- _Scene banner:_ `ImageLabel` art full width (ScaleType Crop), a left-to-right dark `UIGradient` overlay at 0.5 to 0.8 transparency for text legibility, `UICorner` 10, a 3 px dark stroke.
- _Stat box:_ `Frame` black at 0.55 transparency, `UICorner` 8, three rows of icon + tiny label + bold value.
- _Dual buy buttons:_ green Robux button (hexagon icon + "25R$") above a purple currency button (drop or brain icon + amount), each with lip, shine and stroke.
- _Rarity or tier card:_ gradient fill from the tier colour to a darker one, inner dark window `#0B1020` with a 2 px stroke, the item name on top in white with stroke.
- _Glow outline:_ a `UIStroke` 4 px white on an `ImageLabel` cut-out, plus a soft white glow `ImageLabel` behind; use on exactly one hero item.
- _Badge ribbon:_ small rotated rectangle (-45 degree corner strip) in red with bold white text, `ClipsDescendants = true` on the card so it stays inside.
- _Close button:_ 40 px red rounded square with a thick white X, overlapping the title bar's right end.

**Spacing and density:** high, almost no empty space: 8 px between rows, art touching panel edges, price buttons always visible without scrolling.

**Good:** huge price buttons, one tag per row at most, strong colour per tier, clear LOCKED states with the requirement printed. **Cheap:** every row has a tag, art stretched, unreadable stats at 10 px, no distinction between owned and buyable.

**Ethics:** clickbait energy is the style, not a licence to deceive. Prices and odds are shown truthfully, and a child can see what a button costs before they press it.

---

## 10. Patterned cartoon cards (checker and dots)

**Use for:** teleporters, shops, menus and event screens that need to feel busy and colourful but still tidy; a Cartoon look with a background pattern.

**Layout:** a large thick-outlined panel on a gradient backdrop. An inset, darker content frame holds stacked wide rows (teleporter) or a grid of tinted cards (shop). The title sits on a line across the top with a 3D icon hanging off its left end, and a tilted red X overlaps the top-right corner.

**Palette:** outer panel `#8F6BC5` with a checker of `#A583D6` squares; inset `#2F2540` at 0.35 transparency; black outline `#0A0A0A` 8 px outer and 4 px inner; rows are art banners; action buttons yellow `#FFC21F` with an orange rim `#E07A00` and white text; red X `#E8283A`. Shop cards (dots): blue `#2F9BFF` with white dots, pink `#E02F8C`, orange `#FF9A2E`, cream text frames.

**Type:** `GothamBlack` or `FredokaOne`, white with a 3 to 4 px black stroke; titles 64 px, row names 36 px, buttons 28 px.

**Signature components:**

- _Pattern:_ a full-size `ImageLabel` with `ScaleType = Tile`, `TileSize = UDim2.fromOffset(96, 96)`, a seamless checker or dot texture from the toolbox (search "checker pattern seamless", "polka dot pattern"), `ImageColor3` the lighter tint, `ImageTransparency` 0.6 to 0.85, `UICorner` matching the panel. Without a texture, 12 to 20 large rotated squares at 0.8 transparency are acceptable.
- _Banner row:_ 90 to 110 px, a scene `ImageLabel` with `UICorner` 12 and a black 3 px stroke, the name over the left side, the action button flush right.
- _Panel:_ two nested frames (outer black 8 px stroke, inner 4 px) so the border reads thick and doubled.
- _Hanging icon:_ a 3D icon `ImageLabel` rotated -10 degrees, overlapping the top-left corner by a third of its size.
- _Offer card:_ tint, white dots pattern, a heading in white with a 2 px stroke, a tagline in yellow 12 px, a stack of two buy buttons (green primary, purple secondary) at the bottom.

**Spacing and density:** medium-high. 12 px between rows, 16 px inset padding; patterns never cross text without a stroke or a darker plate.

**Good:** the pattern is faint and the same tint family as the fill; strokes are thick and consistent. **Cheap:** a loud pattern behind text with no plate, patterns in a third unrelated colour, thin strokes.

---

## 11. Banner-art gamepass shop (dark steel)

**Use for:** action and RPG games whose gamepass shop wants big illustrated offers: VIP, 2x damage, 2x coins, gem packs. Works with a metal-industrial or fantasy-dark world.

**Layout:** a dark panel with chamfered metal corner brackets and a wide title plate. A top block of promo banners (one wide, one tall, two wide ones) built from full-bleed artwork with the price pasted over the bottom-right corner, then rows of gem packs on dark blue panels with the gem art at left, a bold name and a one-line joke subtitle, and the price in green below.

**Palette:** panel `#252827` with a 3 px `#4A4F4C` rim; blue panels `#1B3D86` to `#0C1F4A` with a thin lighter rim `#3F7BFF`; promo banners keep their own art colours with a 2 px yellow or white border; price text `#5BFF6A` with a dark stroke; sale tag red `#E02424`; title plate `#2B2E2D` with white text.

**Type:** title `GothamBlack` 56 px white, with a 3 px black stroke, centred; offer name `GothamBold` 26 px white; subtitle `GothamMedium` 14 px in muted `#C9D4F2`; prices `GothamBlack` 28 px green with a 2 px dark stroke.

**Signature components:**

- _Corner brackets:_ four small L-shaped pieces (two thin frames each, 24 px, `#9AA0A6`) at the panel corners; or four rotated square frames hidden under the border.
- _Title plate:_ wide rectangle with 4 px stroke, a darker inner frame and a subtle top highlight.
- _Banner:_ art `ImageLabel` full-bleed in a rectangular frame with a 2 px border; a text lockup in huge white outlined letters ("1.5X DAMAGE"); the price sits bottom-right inside a dark translucent chip.
- _Corner ribbon:_ a rotated strip ("SALE!", "LIMITED", "BEST DEAL!") across a card's top-left corner, `ClipsDescendants = true` on the card, red with white bold text.
- _Blue offer panel:_ gradient fill, subtle sunburst rays (`ImageLabel` at 0.9 transparency) behind the art, rim 2 px.

**Spacing and density:** high, 8 px gutters, art bleeds to the edges.

**Good:** art is the hero, prices always bottom-right and green, ribbons clip cleanly. **Cheap:** every banner a different font and price style, tags floating outside the card, art with visible stretching.

---

## 12. Ribbon-and-bevel casual shop (mobile game style)

**Use for:** gacha, idle RPG and tycoon games with a coin or gem economy and a big "Premium Shop": it should look like the paid-currency screen of a mobile game.

**Layout:** a purple stone panel with a bold red ribbon banner overlapping its top edge (title in gold). A tab row of four bevelled coloured buttons under it (Gamepasses green, Boosts purple, Coins orange, Bundles blue; the active one pops forward). Below, a two-column grid of horizontal offer rows (icon box left, amount in white or gold, price button below it right) and one tall "Best value" column on the right with a small ribbon, the old percentage, a big art piece and a wide price button. A red square close button hangs off the panel's top-right corner.

**Palette:** panel `#5A4478` with a darker rim `#2F2150`; inner trays `#3C2D63`; rows `#4B3A72` with a `#2A1F4E` stroke; ribbon `#C13A4A` with darker folds `#8E2536`, gold text `#FFC83A` and a dark brown stroke `#3A1A00`; tabs green `#7FD234`, purple `#B84CF0`, orange `#E0821A`, blue `#2FA8F0` with rims about 35% darker; price button green `#3FC73A` with a `#1B7A1F` rim and dark text; close `#C0392B`.

**Type:** title `LuckiestGuy` or `GothamBlack` 64 px in gold with a dark stroke and a 5 px drop shadow copy; tab labels `GothamBlack` 36 px dark ink on the bright tab; amounts `GothamBold` 28 px white; "Most popular!" small 14 px muted.

**Signature components:**

- _Ribbon:_ a centre banner `Frame` (red, 2 px gold-brown stroke, top highlight), two darker tail frames behind and below it extending outward and cut at the ends with a 45-degree rotated square in the panel colour for a swallow-tail notch; a darker triangle fold where tail meets banner. If an image of a ribbon is available from the toolbox, use it instead.
- _Bevel tab:_ chamfer-looking rectangle: a base frame, a 3 px lighter top edge and a 5 px darker bottom edge, `UICorner` 6, so it reads as a raised slab; active tab 8 px taller with a glow.
- _Offer row:_ tray frame with a square icon well on the left (darker inset, 2 px rim), amount text top, price button bottom-right.
- _Price button:_ slab like the tabs, number plus currency icon centred.
- _Best-value column:_ taller tray with a small red ribbon header, sunburst rays behind the hero art.
- _Star badge:_ a 28 px circle with a star at an offer's top-left corner for "most popular".

**Spacing and density:** high, tight gutters (6 to 10 px), heavy decoration. Keep art at least 60 px so it reads on a phone.

**Good:** every raised thing has a light top edge and a dark bottom edge; gold only for titles and top offers. **Cheap:** flat fills without edges, ribbon as a plain rectangle, coin art in three different styles.

---

## 13. Chunky slate kit (candy buttons on dark blue-grey)

**Use for:** cartoon platformers, puzzle and mobile-style games: main menu, pause, settings, level select; also component sets with many button colours and sizes.

**Layout:** a dark slate panel with a thick black outline and a blue header tab (title centred in white, an X at the right). Inside: stacked candy buttons in different colours (Play orange, Load pink, Settings teal, Credits sky), or a 2 x 2 grid of square icon buttons (play, restart, settings, list). Settings rows are dark inset bars with a small toggle at the right.

**Palette:** panel `#2F3E52` with a 4 px black outline `#10161F`; header `#3F72C4` with a lighter top `#6FA0F0`; inset bars `#1F2A3B`; candy buttons with a lighter top and a darker bottom lip: orange `#FFB22E` / `#D9801A`, pink `#E84FD2` / `#A82E96`, teal `#17B890` / `#0E7A60`, sky `#9FD8F0` / `#5FA6C6`, red `#E8283A`; button label dark ink `#2B1B0E` on light colours, white on dark ones.

**Colour ramp for price buttons:** build one `ButtonColor` table (name, top, base, lip) of ten ramps (red, orange, yellow, green, light blue, blue, purple, pink, white, grey) so every price button, currency button and tab stays within the family. Sizes in four steps (small, medium, large, extra large) with the label scaling in proportion.

**Type:** `LuckiestGuy` or `FredokaOne`, uppercase, white with a thick dark stroke for titles; dark ink with no stroke for labels on light buttons; 36 to 48 px for buttons.

**Signature components:**

- _Candy button:_ `UICorner` 10, a vertical `UIGradient` (top light to base), 3 px black `UIStroke` Border, a 6 px darker lip frame beneath, a thin white highlight line along the top edge inside the face.
- _Icon button:_ square, 96 px, `UICorner` 16, icon in dark ink at 55%.
- _Progress bar with plus:_ long dark inset bar, 3 px black stroke, a square coloured "+" button fixed at its right end.
- _Toggle:_ a white-and-colour two-segment slider (left white, right green or red) in a rounded track with a black stroke: the coloured half marks the state.
- _Panel header:_ a tab that sits slightly wider than the panel and overlaps its top edge by 8 px.

**Spacing and density:** medium. Buttons 72 px high with 12 px gaps, panel padding 24.

**Good:** every colour has a lip and a stroke, label colour chosen by the fill's brightness, ramps defined once. **Cheap:** a different corner radius per button, strokes of two thicknesses, bright text on yellow.

---

## 14. Studded blocky

**Use for:** Roblox-native, "classic bricks", farming and garden games, obbies, anything where the world itself is studs and plastic. The stud pattern makes the UI feel made of the same material as the game.

**Layout:** a framed panel, a header bar with title left, a coloured action button (RESTOCK) and a red close tile right, and below it inset cards (item art square left, name, status, rarity tag and price buttons right). Menus are blue brick sheets with stacked labelled buttons.

**Palette:** garden: frame green `#3FA83A` with a darker rim `#1F6B1C`, soil `#8A4B1E` card field with a `#6B3A14` inset, buttons green `#2FA82F`, red close `#D8302F`, blue action `#33B8E8`, rarity tags white `#F2F2F2` with dark text. Brick blue: sheet `#1FB0F2`, studs `#6FD0F8`, orange action `#FF9A1F`, green confirm `#3CC03C`, red close `#E04545`.

**Type:** `FredokaOne` or `GothamBlack`, white with a black stroke 2 to 3 px; small caps captions 14 to 16 px; prices 24 px white.

**Signature components:**

- _Stud overlay:_ `ImageLabel` with `ScaleType = Tile`, a stud texture (search the toolbox "lego stud pattern seamless", or "brick studs texture"), `TileSize` 24 to 40 px square, `ImageTransparency` 0.55, same `UICorner` as the face. Sit it above the face fill and under the text. Check the studs read at phone size: if the texture turns to noise, raise the tile size.
- _Bevel stack:_ a dark base (`UIStroke` 4 px black) with a bright face above it, the face a vertical `UIGradient` white to the colour; square corners or 4 px.
- _Square icon tiles:_ a coloured tile with a white glyph inside a smaller lighter inset (icons: X, check, bolt, star, heart, play, pause, speaker, gear, list).
- _Slider:_ long brick track with studs, a round orange knob; progress bar with a green fill inside a blue studded trough.
- _Card:_ soil field with studs at low contrast, art tile left with a darker border, name white with stroke, status in green or red below it.

**Spacing and density:** medium, 8 px gaps, chunky 56 to 64 px buttons, 2 to 3 px strokes, nothing thin.

**Good:** studs at low contrast so text still wins, one material colour per panel, square corners. **Cheap:** studs at full contrast behind text, round pill buttons with studs (mixed shape language), no outline.

---

## 15. Dark fantasy ornate

**Use for:** anime and RPG story games, dialogue boxes, objective trackers, quest logs, boss intros, souls-like and Demon-Slayer-style experiences. For parchment-and-wood RPGs see `styles.md` family 5.

**Layout:** a dialogue box across the lower half of the screen with a portrait window at the left and a name tag above its top-left; two or more answer buttons below it in a row; a left column of objective cards in the world's corner; a timer badge top-right with a clock icon; the game's logo top-left.

**Palette:** black `#0A0A0A` at 0.2 transparency for panels; frame metal `#2C2C2E` with a copper-gold edge `#C98B4B` and an ember highlight `#F2B26B`; text `#EDE6D8`; muted `#9A9486`; objective card `#101010` at 0.3 with a fading brush edge; timer ring copper.

**Type:** names `Antique` or `Fondamento` in cream; body `Merriweather` or `SourceSans` 18 to 22 px; objective titles bold. Keep the body line length under 60 characters.

**Signature components:**

- _Ornate frame:_ a 9-slice `ImageLabel` border (search the toolbox "ornate frame 9 slice", "fantasy border") over a dark fill; if no asset, a double border (outer 3 px dark stroke, inner 1 px copper stroke 6 px in) with four small corner flourishes made from rotated diamonds.
- _Portrait window:_ square with a double border and a vignette `UIGradient` overlay (transparent centre to black edges).
- _Answer button:_ the same frame style, text centred, hover brightens the copper edge and adds a small glow; each prefixed by its number.
- _Objective card:_ a dark translucent strip with a rough torn edge (an image mask) or a 2 px copper left rule; title bold, a two-line description and a time stamp.
- _Brush logo or title:_ an image (never plain text) at the top-left.

**Spacing and density:** medium, text-heavy but with 24 px inner padding so the ornament never touches words.

**Good:** copper accents used sparingly, a calm dark ground, readable body text in a serif at 20 px. **Cheap:** gold gradient on everything, ornaments touching the text, small low-contrast body copy.

---

## 16. Sci-fi chamfer (neon rim) and hex cards

**Use for:** space, robot, shooter, mech and cyber games; also gacha-like "bot" collections. The hex-card version suits unit and pet collections with level and power on each card.

**Layout:**

- _Panels:_ dark rectangle buttons with cut corners and a coloured rim; navigation as a row of octagon icon buttons.
- _Collection:_ a deep blue panel with a tab row across the top (the active tab bright cyan, the others dark blue with cyan text, each with a clipped top-right corner), a hex-card grid left (4 columns) and a detail column right (name, portrait, rarity, level, LEVEL UP), and a white footer strip with counters and action buttons.

**Palette:** panel `#13222B` with a cyan rim `#3FC8F0` (gradient `#6FE0FF` to `#1E7FB0`); violet variant rim `#7A4BE0` to `#3A1E80`; magenta variant rim `#C84BE0`; glyphs white `#FFFFFF`. Collection: panel `#174C8A`, inner `#1A5FA8`, tab active `#25C8F0`, text `#1BE6FF`, card colours by rarity (cyan `#8FD0F0`, purple `#B070E0`, gold `#D9A030`, grey `#9AA8B0`), action orange `#F59A1F`, positive teal `#1BC6A0`, level-up purple `#8A5CF0`.

**Type:** `Michroma`, `Sarpanch` or `TitilliumWeb` bold uppercase for tabs and headings; `GothamBold` for numbers. White or cyan on dark, dark navy on bright cyan.

**Signature components:**

- _Chamfer without images:_ a rectangle `Frame` with a 2 px corner, a 2 px coloured `UIStroke`, and short corner brackets (two thin frames per corner, 10 px) in the rim colour; a bright 1 px line across the top at 0.5 transparency. For true cut corners use a 9-slice chamfer `ImageLabel` from the toolbox (search "sci-fi button frame").
- _Rim gradient:_ `UIGradient` on the `UIStroke` (light to dark, Rotation 90) gives the metallic edge.
- _Octagon button:_ a toolbox octagon or hex image tinted with `ImageColor3`, the glyph (play, chart, grid, gear, person) as a white icon centred at 55%.
- _Hex card:_ a hexagon image (`ImageLabel`, tinted per rarity) with the unit render as a `ViewportFrame` clipped by the hex, a small hex badge with a class icon at the top, a padlock chip top-right, the power number with a bolt icon at the bottom.
- _Tab:_ a bright cyan tab with the active label in dark navy, the inactive ones a darker blue with a cyan label.
- _Detail column:_ darker panel, large render, rarity word in its colour, a level line and two stats side by side, one wide action button.

**Spacing and density:** high for the collection (6 to 10 px gaps), low for the icon rows. Glow (a wider `UIStroke` copy at 0.6 transparency) only on the active or selected piece.

**Good:** a thin bright rim on a dark body, glyphs white, rarity colours confined to the card fill. **Cheap:** glow on everything, rainbow rims on one screen, round corners mixed with chamfers.

---

## 17. 3D UI in front of the player (BillboardGui)

**Use for:** things that belong to a place or character rather than the screen: overhead name and health tags, shop prices above products, NPC speech bubbles, interaction prompts, quest markers, a floating menu that follows the player, and a tilted info panel placed beside the player (the diegetic inventory look).

**Choose the container:**

- `BillboardGui` always faces the camera. Use it for tags, bubbles, markers and a floating panel that should stay readable.
- `SurfaceGui` on an anchored `Part` is a real slab in the world: tilted, lit, and seen at an angle. Use it for a panel in front of the player or on a wall.

**Build (billboard):** `BillboardGui` with `Adornee` the head or a part, `Size = UDim2.fromOffset(220, 60)` for a constant on-screen size (use Scale to shrink with distance), `StudsOffset = Vector3.new(0, 2.5, 0)`, `MaxDistance` 50 to 80, `LightInfluence = 0`, `AlwaysOnTop = false` for tags, true for markers. Parent in `PlayerGui` so only the local player sees it, or in the part for everyone.

**Build (slab):** anchored `Part` (CanCollide, CanQuery, CanTouch all false, Transparency 1) 6 x 4 studs, `SurfaceGui` with `Face = Front`, `SizingMode = PixelsPerStud`, `PixelsPerStud = 100`, `LightInfluence = 0`. Place it with `HumanoidRootPart.CFrame * CFrame.new(3, 1, -5) * CFrame.Angles(0, math.rad(-20), 0)` so it faces the player with a slight turn, and optionally a soft cone light on it. Check mouse and touch input in a Play test; fall back to a `ProximityPrompt` to open it if touch does not work.

**Look:** the reference is deliberately plain: translucent grey panels, a title bar, grid of item thumbnails with labels, a detail panel with a scroll bar. Improve it, but keep it readable at distance:

- 2 to 3 sizes of text only, large (min 24 px at the surface's pixel density), white on dark `#101010` at 0.2 transparency with a 2 px stroke.
- Panel `UICorner` 12 and a 2 px rim in the accent; thumbnails in 3D with `ViewportFrame` where possible.
- Selection: a bright 3 px stroke, not a colour change alone.
- Fade the panel with distance (`MaxDistance` on billboards; on slabs tween `GroupTransparency` of a `CanvasGroup` as the player leaves).

**Spacing and density:** fewer, larger elements than a screen UI: a world panel is read from 6 to 30 studs away, so aim for 40% fewer items and 1.5x the type size.

**Good:** crisp text, no more than one panel per object, a name or price that stays in view. **Cheap:** tiny text, a tag on every part, panels clipping into walls, `AlwaysOnTop` on everything so tags show through buildings.

---

## 18. Camera-attached 3D HUD (SurfaceGui on a part)

**Use for:** a HUD with depth: an ammo and health slab at the lower right that tilts toward the player, a mission readout at the edge of vision, VR-like and sci-fi suits, cinematic shooters. It looks designed only if it is subtle.

**Build:**

- Anchored `Part` (`Transparency = 1`, `CanCollide`, `CanQuery`, `CanTouch` false, `CastShadow` false) parented to `workspace.CurrentCamera`; client-only.
- `SurfaceGui` on it: `Face = Front`, `SizingMode = PixelsPerStud`, `PixelsPerStud = 100`, `LightInfluence = 0`, `AlwaysOnTop = true` (so walls never cut through it).
- Position every frame with `RunService:BindToRenderStep("CameraHud", Enum.RenderPriority.Camera.Value + 1, fn)`, which is the one place a per-frame loop is right. Place it relative to the camera: `camera.CFrame * CFrame.new(x, y, -depth) * CFrame.Angles(0, math.rad(-18), 0)`. Compute `x` and `y` from the field of view so it hugs the same screen corner on every aspect ratio: `halfH = depth * math.tan(math.rad(camera.FieldOfView) / 2)`, `halfW = halfH * camera.ViewportSize.X / camera.ViewportSize.Y`, then `x = halfW * 0.62`, `y = -halfH * 0.55` for a lower-right slab at `depth = 4`. Re-read `ViewportSize` each frame.
- Unbind in `Destroying` or when the screen closes. Panels attached to the camera cannot be clicked reliably: use them for display and keep buttons on the normal 2D `ScreenGui`.

**Look:** a translucent grey-white slab with a coloured top strip (the reference shows a white bar with an orange progress stripe), a big number in bold white, a muted sub-number under it, thin hairlines. Keep it light:

- Slab `#FFFFFF` at 0.7 to 0.85 transparency or black at 0.6; `UICorner` 6 to 10; a 1 px rim at 0.5.
- One accent for progress (orange `#FF7A1A`, cyan `#3FD0FF`), the number `GothamBlack` 72 px, labels `GothamMedium` 24 px.
- Tilt 10 to 25 degrees and a tiny sway (1 to 2 degrees from the camera's turn velocity), no more.

**Spacing and density:** two or three numbers at most. This is an instrument, not a menu.

**Good:** subtle tilt, stable on every aspect ratio, readable against bright skies (dark plate behind white text). **Cheap:** a strong tilt that makes text hard to read, clipping through terrain, drifting out of the corner on ultrawide screens, anything interactive on it.

---

## Using several archetypes in one game

The HUD and the menus may belong to different archetypes only when they share palette and type: for example 8 (HUD) plus 7 (menus) in a simulator, or 1 (menus) plus 17 (in-world tags) in a shooter. The world-space ones (17, 18) borrow the colours of the 2D screens so the game reads as one product.
