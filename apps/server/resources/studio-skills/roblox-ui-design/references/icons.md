# Icons: pick a style, then find a matching set

Icons are the fastest way for a screen to look made or look assembled. One screen, one icon family. If the user supplied icons, use theirs and match everything else to them. If they did not, **search the Creator Store for the best icons for the chosen style** (below) instead of drawing placeholders, using text glyphs, or leaving empty squares.

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

- A Decal asset id can go straight into `ImageLabel.Image` as `rbxassetid://<id>` and often shows correctly. If it renders blank or white in the Play test, insert the Decal with `insert_asset`, read its `Texture` property, and use that image id instead. Delete the inserted Decal afterwards.
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
