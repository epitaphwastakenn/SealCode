# Style families

Each family fixes colour, type, shape and depth. Pick one per game and keep every screen in it. Hex values are starting points: keep the relationships (base, light, dark, ink) when you change hue.

## 1. Cartoon (bouncy, playful)

For casual, kid-friendly, party, obby and minigame titles.

- **Shape:** pill buttons (`CornerRadius` 0.3 to 0.5 scale), chunky panels (16 to 24 px radius), slight rotation on the title (-4 to -6 degrees) and on stickers or badges.
- **Outline:** thick, dark, warm ink around everything: `UIStroke` 3 to 4 px, colour `#2B1B3D` (deep purple-brown) rather than pure black.
- **Depth:** every button and card has a lip: a darker copy 5 px below. Add a glossy highlight: a white frame with 0.75 transparency covering the top 35% of the button, inset 6 px, same corner.
- **Colour:** saturated primaries with a light and a dark shade each.
  - Green `#3DDC5A` / light `#7CF08F` / dark `#1F9E3A` (primary action)
  - Orange `#FF9A2E` / `#FFC06B` / `#C96A0A`
  - Blue `#3B8BFF` / `#7DB4FF` / `#1D5BC4`
  - Pink `#FF5FA2` / `#FF9AC6` / `#C2306F`
  - Yellow `#FFD23F` / `#FFE58A` / `#C99A08`
  - Background: a vertical gradient between two saturated colours (purple `#7B4DFF` to pink `#FF5FA2`, or sky `#4FC3FF` to teal `#3DDCB0`), never flat grey.
- **Type:** `FredokaOne` or `LuckiestGuy`, white fill with the dark ink stroke (2 to 4 px). Titles may use yellow or cream fill (`#FFF1B8`) with ink stroke and a second, offset text copy in the dark shade 4 px lower as a drop shadow.
- **Decoration:** confetti dots and rounded squares in the palette, 5 to 12% of the background area, rotated, partly transparent (0.2 to 0.5); a sticker-like badge ("NEW!", "x2") on one element at most.

## 2. Simulator (clean cartoon cards)

For simulators, tycoons and idle games: lots of items and numbers.

- **Shape:** white or near-white rounded cards (radius 12 to 18 px) on a tinted backdrop, soft lip under each card in a grey-blue (`#C9D3E6`).
- **Outline:** 3 px stroke in a dark navy `#1E2A4A` on buttons; cards may use a lighter 2 px stroke `#AFC0DA`.
- **Colour:** white cards, navy ink, and category colours for rarity and currency: common `#B8C2CC`, rare `#3B8BFF`, epic `#A15CFF`, legendary `#FFB224`, mythic `#FF4D6D`. Primary buy button green as in Cartoon.
- **Type:** `FredokaOne` or `GothamBlack` for numbers and titles, `GothamBold`/`BuilderSans` bold for labels. Currency amounts always paired with the currency icon on the left.
- **Decoration:** rarity colour as a top band or glow behind the item icon; price chips at the card bottom.

## 3. Modern (flat, calm)

For realistic, horror, story, roleplay and social games, or when the user says clean, minimal or modern.

- **Shape:** 6 to 10 px radius, no lip; depth from a soft shadow: an `ImageLabel` 9-slice shadow or a frame 2 px below at 0.85 transparency.
- **Outline:** 1 px `UIStroke` at 0.7 to 0.85 transparency in white (dark theme) or black (light theme).
- **Colour:** one accent on a neutral base. Dark: background `#111318` at 0.15 transparency over the world, surfaces `#1B1F27`, raised `#252B36`, ink `#F2F4F8`, muted `#9AA3B2`, accent `#4C8DFF` or the game's brand colour. Light: background `#F5F6F8`, surfaces white, ink `#1C2230`.
- **Type:** `BuilderSans` or `Montserrat`; weights Bold for titles, Medium for buttons, Regular for body. Letter case: sentence case, no all-caps body text.
- **Decoration:** none beyond icons and dividers. Blur the world behind modal screens with a `BlurEffect` (size 12 to 18) in Lighting while the screen is open.

## 4. Sci-fi / esports (sharp, glowing)

For shooters, space and competitive games.

- **Shape:** sharp or 2 px corners; angled ends made with rotated frames or images; thin frames around panels.
- **Outline:** 1 to 2 px strokes in the accent colour; a glow from a duplicate stroke at higher thickness and 0.6 transparency.
- **Colour:** near-black navy `#0A0F1C`, panel `#111A2E` at 0.1 transparency, cyan accent `#2EE6FF`, warning amber `#FFB020`, danger `#FF3B5C`, ink `#E6F1FF`.
- **Type:** `Michroma`, `Oxanium` or `Orbitron`-like faces for headings (check `Font.fromName` exists), `BuilderSans` for body; uppercase headings with letter spacing simulated by wider `TextSize` boxes.
- **Decoration:** scanline or grid texture at 0.9 transparency; small corner brackets on the active card.

## 5. Fantasy / medieval (warm, textured)

For RPG, adventure and medieval games.

- **Shape:** 8 to 12 px radius panels with a double border (outer dark, inner gold).
- **Colour:** parchment `#F1E3C3`, wood `#6B4423`, dark wood `#3E2615`, gold `#E2B33C`, ink `#2B1A0E`, accent crimson `#A4262C` or emerald `#2F8F5B`.
- **Type:** `Merriweather`-like serif for titles if available, otherwise `GothamBlack` in gold with a dark brown stroke.
- **Decoration:** gold divider lines, corner ornaments from Creator Store decals when the user allows assets.

## Mixing rules

- Never mix families inside one game except a deliberate "event" skin.
- If the game already has UI, match its family, palette and font before adding anything.
- When unsure between Cartoon and Simulator, ask whether the screen is mostly buttons (Cartoon) or mostly items and numbers (Simulator).
