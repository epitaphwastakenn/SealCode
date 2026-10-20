# Icons: pick a style, then find a matching set

Icons are the fastest way for a screen to look made or look assembled. One screen, one icon family. If the user supplied icons, use theirs and match everything else to them. If not, take the ids in the catalogue below, which is one coherent set, and search the Creator Store only for what it lacks. Never use placeholders, text glyphs, emoji or empty squares.

## Resolution order

For every picture slot on a screen, decide in this order and stop at the first that fits:

1. **An id the theme, layout or template names** (the shop basket on a modern shop header, the coin beside coin prices, the sunburst under art, the lock, check, crown and gift). It overrides any catalogue match for the same meaning.
2. **Art already in the project** whose role and licence fit.
3. **The catalogue below.** An exact name hit is final. A hit found by a meaning hint (speed boost = shoe, quest = scroll) is a candidate: look at it in a screenshot before keeping it. No hit: leave the decoration out, or for essential content art use step 5.
4. **An image id the user supplied** and that you verified renders.
5. **Creator Store search** (below) for essential **content** art only: the thing a card sells or a reward shows. Take the texture id, never the wrapper id.
6. **Nothing.** A clean button with text beats one with a clashing icon.

Ids are never invented, computed or guessed from memory. Request every icon of a screen in one pass, put them in one table in the builder (name, id), and keep one icon per meaning across the whole game. Soft and hard currencies must look clearly different (coin against diamond or crystal). A list that needs distinct art per card and does not have enough icons sells fewer items rather than repeating art.

For pets and items that exist as models, show the model in a `ViewportFrame` instead of an icon (gallery 2; in the cartoon card theme the camera looks at the model from the front at a 30 degree field of view, at a distance of `max(width, height) / 2 / tan(15 degrees) + depth / 2`, raised by about 15% of the height).

Avatar pictures use `rbxthumb://type=AvatarHeadShot&id=<userId>&w=150&h=150`. A catalogue item can be shown with `rbxthumb://type=Asset&id=<id>&w=420&h=420`; it depends on external content that may be moderated or slow, so give it a fallback image.

## The icon families

Match the family to the archetype in `gallery.md`. The thing to copy is how an icon is drawn, not what it shows.

| Family                                | How it is drawn                                                                                                                                                                                                                                                                    | Fits archetypes              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Glossy 3D cartoon**                 | Heavy dark-navy outline (about 6% of the icon width), saturated fill with a lighter top half, a white highlight blob top-left, a darker bottom edge, a drop shadow or inner bevel; rounded, slightly oversized shapes. Coins, hearts, crowns, stars, gems, rockets, clocks, gears. | 7, 8, 9, 10, 12, 13          |
| **Flat solid glyph**                  | One or two flat colours, no outline, no gradient, geometric shapes (a ticket, a crown, sparkles, a gear). White, or one accent colour.                                                                                                                                             | 3, 4, 6                      |
| **Outlined line**                     | A single stroke weight (1.5 to 2 px at 24 px), round caps, no fill, one colour (the muted text colour; the accent when active). Lucide, Solar and SF-style packs are this.                                                                                                         | 1, 5                         |
| **Sci-fi glyph in a chamfered badge** | A white pictogram (play, bars, grid, gear, person) inside a dark octagon or chamfered tile with a bright cyan, violet or magenta rim and a lighter top band.                                                                                                                       | 16                           |
| **Studded tile**                      | A square coloured tile with a lighter inset and a white glyph, the tile carrying studs or a bevel (red X, green check, purple bolt, yellow star, pink heart, blue play and pause).                                                                                                 | 14                           |
| **Hex or gem badge**                  | A hexagon or faceted gem plate tinted by rarity with a small glyph on it; metal rims and a lighter facet.                                                                                                                                                                          | 16 (hex cards), 8 (blue gem) |
| **Painted fantasy**                   | Hand-drawn, textured, warm metal and parchment colours, no clean vector outline.                                                                                                                                                                                                   | 15                           |

### What a glossy 3D set looks like (typical needs)

A complete cartoon set covers: currency (coin, cash, gem, Robux-like hexagon), status (heart, broken heart, energy bolt, star, crown, skull), navigation (arrows up, down, left, right, hamburger menu, close X, green check, warning, info), social (chat, thumbs up and down, trade arrows, verified badge, bell), shop and play (cart, rocket, egg, paw, pin, clock), and brand icons (Discord, Twitch, Twitter, YouTube) in their own colours. Everything shares one outline weight, one light direction (top-left), one corner softness, and a dark navy outline rather than black.

## Matching rules

1. **One family per screen** (better: per game). A glossy heart next to a thin outlined gear is the most common amateur mistake.
2. **Match the outline.** If the UI strokes are 3 px navy `#12203A`, the icons need that outline weight and colour. Outlined-line icons on a thick-stroke cartoon screen look wrong, and so do cartoon icons on a hairline modern screen.
3. **Match the light.** Highlight on the top-left everywhere, shadow on the bottom-right. Mixed light directions look cheap even to people who cannot say why.
4. **Match the palette.** Icons may use the palette's hues; a stray neon green icon breaks a purple screen. Brand icons (Discord, Twitch, YouTube) keep their own colours as the only exception.
5. **Same size grid.** Icons sit at 55 to 65% of their button face and are the same size across a row. Currency icons are 1.0x the text height beside a number, centred vertically on it.
6. **Do not tint multi-colour icons** with `ImageColor3`; tint only flat white glyphs or outlined line icons (set `ImageColor3` to the text or accent colour).
7. **Keep a fallback.** Never leave an empty square when an image fails to load; hide the icon and let the label centre, or use a plain shape.
8. **Never emoji or letters as icons**, except a close X that is built from two rotated frames.

## The icon catalogue

107 image ids in the glossy 3D cartoon family: square, already coloured, thick navy outlines, bright two-stop gradients. They are the art the cartoon card theme is made for, and the studs themes borrow them. Every id below rendered in a Studio play test (`ImageLabel.Image = "rbxassetid://<id>"`, fit scaling, no decal conversion needed). The original creators and terms are not recorded, so treat the licence as unverified: keep them in one table so they can be swapped for the game's own art, and prefer the game's own art when it exists. Entries marked WEAK do not look like their name; do not use them for it.

Covers well: currencies, shop and navigation symbols, progression, rewards, pets (three animals), players and status marks. Covers poorly (use the Creator Store or a model): other animals, specific products, unusual weapons, scenery, backgrounds, game-specific objects, and social platforms beyond one.

Rows read `Name id (meaning)`. Meaning hints: speed boost is the shoe; a generic boost or buff the potion; luck the lucky block; a quest or mission the scroll; storage the backpack or box; a leaderboard the trophy; a world, zone or realm the planet; strength the arm; a ranking slot the player; a party or clan the four players; the clicker tap target the cursor; a locked or hidden slot the question mark; close is the X; bag and cart are interchangeable for the shop slot, pick one and keep it; Trade (exchange between players) and Upgrade (spend to improve) overlap, choose by function; Magical Teleport reads as a portal or warp.

- **Animal (3):** Bunny `97628616133746`; Cat `136373929646470`; Dog `94785235613863`.
- **Currency (8):** Cash `70565105539676` (soft currency, bills); Coin `84697600263846` (soft currency); Crystal `73150429062000` (hard currency); Diamond `75581768563141` (hard currency); Ingot `83606937519307` (gold bar, mid currency); Premium `78918235954057` (premium pass); Ticket `123370754779214` (voucher, coupon); Robux `87608142780557` (Robux logo).
- **Exclusive (4):** Angel Heart `77354444720914` (revive, blessing); Magical Teleport `125856842589066` (portal, warp); Tung `98107998829029` (WEAK: renders as a sparkling character, not a horn); VIP `97092630460629` (membership, pro).
- **Food (3):** Burger `131831653905006`; Cookie `92727662543456`; Pizza `118662104704624`.
- **Item (36):** Axe `75127143522091`; Backpack `118915534669949`; Balloon `86067946513885`; Bomb `96872034340553`; Book `117316658726625` (index, catalog); Box `99990137483704` (crate, loot, collection); Bubble Gum `119328274787822` (WEAK: a plain orange disc); Calendar `108944239950574` (daily reward, event); Chest `76137715921998`; Clock `109014091086075` (timer); Coil `121041765810680`; Credit Card `72685970590604` (WEAK: carries "roblox bank" lettering); Crown `78843852703854` (rank 1, VIP, luxury); Dice `125278872428987`; Egg `113316632422703` (hatch); Gift `122416766679510` (reward); Hammer `95064026158349`; Key `96066489256923`; Location Pin `108187453204701` (zone, waypoint); Lock `113981661296218`; Lucky Block `115410948249385`; Magnet `113237606120555`; Medal `136770365348318` (badge, rank, XP); Newspaper `106567385913035` (document, note); Pencil `84252310370894`; Potion `71202349341308`; Rocket `93379001930135`; Scroll `76733867334368`; Shield `93114601642790`; Shoe `100402338773449`; Shovel `84998465111718`; Sword `94091032987086`; Target `120517988406723`; Teleporter `121913397438916` (WEAK: renders as a bottle with a red dot); Torch `121599159289303` (light, flashlight); Trophy `77830885604568`.
- **Main (23):** Broken Heart `112993477288479`; Codes `83034712079665` (redeem, coupon); Fire `73214946386499` (boost, hot); Heart `133958322179641`; House `101953044632807` (home, spawn); Lighting `91519647625054` (energy, bolt); Magnifying Glass `124585991248748` (search); Music ON `136121323044955`; Paw `88750231673471` (pet); Rebirth and Auto Open `80234316052758` (prestige, auto-hatch); Save `128628918523248` (save); Settings `119570973950437` (gear); Shopping Bag `120628031716892`; Shopping Cart `123838677183783`; Sound OFF `130491537894606`; Sound ON `78863931900480`; Star `112684829478873` (favourite, XP, rare); Stats `92574857197960` (chart); Trade `71704954911252` (exchange); Trash Can `72745454842879`; Upgrade `124300905660565` (level up); Verify `104406265234482` (verified); Wheel `120233256572525` (spin).
- **Nature (9):** Apple `120786616810420`; Banana `126823412198932`; Cloud `104293709713395` (weather); Leaf `122842695290895` (WEAK: renders as a yellow crescent); Orange `90219705854308`; Planet `126361365802334` (world, zone); Strawberry `74842913450679`; Thunderstorm `72607541698873` (rain, storm); Wheat `117191338665794` (grass, farm).
- **Player (9):** 4 Players `135436588486118` (party, clan, team); Add Player `121328279027494` (invite); Arm `134595823778256` (strength); Friend `87070401810152` (friends); Full Body `89448335631573` (avatar, skin); Player `99097554161865`; RIP `78429385384235` (respawn); Skull `126528254643859` (enemy); Smiling Face With Horns `111585498610164` (demon, boss).
- **Social (1):** Twitter `95030464833532`.
- **UI (11):** Chat `94298126681415`; Checkmark `128850290702187` (claim, confirm); Cursor `83339102562613` (tap target (clicker)); Exclamation Mark `99848348794456` (notification); Info `119677199991519`; Minus `115333097448632`; Plus `127726919558379`; Question Mark `80027380832882`; Skip `75745436562174` (skip, fast forward); Warning `122437442880819` (announcement); X `138478881597994` (close, cancel).

Other ids that rendered: textures and backdrops are in the theme files (stud tiles, sunburst, star pattern); sounds in `polish.md`; the shop basket `110972987269284` (a red basket), pig and money `103120983042082`; a red pair of dice `110883654232694`; a soft white glow `4925956526` (tint it with `ImageColor3`); the wheel's prize icons come from the table above. The wheel needs no ring, divider, hub or pointer pictures: its template draws them natively.

## Checking that ids render

Never trust an id you have not seen. In a play test, build a grid of `ImageLabel`s with the ids (a number over each), call `ContentProvider:PreloadAsync` on the labels and print the statuses that are not `Success`, then take a screenshot and look. A blank or white square means a wrapper (decal) id, a moderated asset or a wrong id. Remove it from the table and take another. The three decal wrappers that failed as images (`6927295857`, `12055407253`, `14605469461`) have working image ids in the theme files.

## Searching the Creator Store

Use `search_assets` with `type: "Decal"`. Query by subject plus style words, short, in English, one icon per query:

- Glossy cartoon: `coin icon cartoon`, `gem icon glossy`, `heart icon game ui`, `crown icon cartoon`, `shop cart icon game`, `settings gear icon cartoon`, `close button x red game ui`, `arrow icon game ui`.
- Flat: `settings gear icon flat`, `crown icon flat white`, `ticket icon flat`, `sparkle icon flat`, `star icon flat`.
- Outlined: `gear icon outline`, `home icon line`, `user icon outline`, `bell icon outline`.
- Sci-fi: `sci-fi icon hexagon`, `futuristic ui icon cyan`, `tech icon octagon`.
- Studded: `lego icon`, `brick icon button`, `studs button`.
- Currency and rarity: `robux icon`, `diamond icon cartoon`, `star badge rarity`, `rarity gem icon`.
- Packs: try `icon pack`, `ui icon set`, `game icons` with `sortBy: "Top"` and open the best sets first; a set gives you coherent icons in one go.

Habits:

- `maxResults` 12 to 20, `sortBy: "Relevance"` first, then `"Top"` or `"Ratings"` if the results look poor. Free items only.
- Reword rather than scroll: add `cartoon`, `flat`, `outline`, `glossy`, `3d`, `ui`, `game` or `transparent background`. Drop brand names.
- Look for a creator who published many icons in one style (a set). Take the whole set from one creator when you can; a mixed set from five creators never matches.
- Shortlist two or three per icon, then check each with `get_asset_details`: it shows the thumbnail. Reject an icon with a visible background, a watermark, mismatched outline, or JPEG noise. Prefer verified creators and high up-votes.
- Check the set side by side: after picking, line the icons up on one screen and compare outline weight, light direction and saturation. Replace the odd one out.

## Using a result

- A Decal asset id from `search_assets` is a wrapper: used as an image it usually fails (`Asset type does not match requested type`) or shows blank. Resolve it first: `get_asset_details` shows the thumbnail; `insert_asset` the Decal, read its `Texture` property, and use that image id (`rbxassetid://<texture id>`). If the texture id is missing or 0, drop the candidate rather than use the wrapper id. Delete the inserted Decal afterwards.
- `ScaleType = Fit`, with `BackgroundTransparency = 1`, inside a square (`UIAspectRatioConstraint` 1). Do not stretch.
- Put every icon id in one table in the screen's builder script (name, id), so a bad one is replaced in one place.
- Treat the asset as art only: never insert or enable scripts that arrive with an inserted asset.
- Check the result in a Play test screenshot: icons crisp, centred on their buttons, same visual weight.

## When the search gives nothing good

1. Try two more query phrasings and a different `type` (`Model` sets sometimes hold icon decals; `Decal` is the main one).
2. Build from basic shapes: a coin is a circle with a ring and a letter, a heart or star is a rotated-square plus two circles, a plus or X is two frames. Only for simple shapes and only in the flat solid or outlined families.
3. Generate or draw it if the project has an image tool, upload it, and keep it in the same style.
4. If none of that gives a quality result, drop the icon and let the text carry the button. A clean button with text beats one with a clashing icon.

## Per-archetype quick picks

- **Simulator and cartoon shops** (7, 9, 10, 12, 13): glossy 3D cartoon, navy outline, bold coin/gem/cash for currency, red X for close.
- **AAA** (1, 2): outlined line or none at all; white text carries most buttons; key caps for input hints.
- **Minimal** (3, 4, 6): flat solid glyphs or soft 2D pictograms, one accent colour, one weight.
- **Windowed tools** (5): outlined line icons (Lucide), 18 px, muted colour; WindUI ships such packs (see `windui.md`).
- **Sci-fi** (16): white pictogram in a chamfered or octagon badge; rim colour carries the state.
- **Studded** (14): coloured square tiles with a white glyph.
- **Fantasy** (15): painted or engraved icons; avoid glossy cartoon.
