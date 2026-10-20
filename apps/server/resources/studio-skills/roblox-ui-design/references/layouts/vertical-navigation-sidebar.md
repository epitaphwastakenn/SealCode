# Layout: vertical-navigation-sidebar

A persistent rail of labelled buttons on one screen edge (Shop, Pets, Rewards, Codes, Settings) over the world. Each button opens its own menu. The rail is the whole UI of this layout.

**Use it when** the player needs quick access to three to six destinations and each button has both an icon and a text label. **Not when:** the buttons are icon-only (that is HUD: `hud-zone-system.md`), the rail sits inside a panel and switches pages (`admin-control-panel.md` or an inventory tab rail), or it expands into a panel.

Themes: `themes/cartoon-card.md` (sticker buttons), `themes/studs-modern.md` (HUD tile blocks, one colour each), `themes/studs-classic.md`.

## Zones

A transparent container `Rail` anchored at `(0, 0.5)`, `Position = {0.015, 0},{0.5, 0}`, with a `UIListLayout` (vertical, centred, gaps of about 1.2% of the screen height). There is no plate, strip, title or close.

| Element | Regular (PC)                                                                                              | Compact (phone)                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Button  | about 0.09 to 0.11 x 0.07 to 0.075 S (cartoon card pixel form: 176 x 74)                                  | 0.17 S wide x 0.14 S tall, at least 44 px tall; icon and label still both visible |
| Icon    | 55 to 78% of the button height, about 6% of the width from the left (cartoon card: 40 px at x 14)         | 60% of the height                                                                 |
| Label   | beside the icon, left aligned, 40 to 60% of the button height, stroked white text                         | 12 to 14 px minimum                                                               |
| Badge   | one per button at the top-right corner, about 28 to 40% of the button height; the label stops short of it | same                                                                              |
| Count   | three to six buttons, a single column, centred vertically on the edge                                     | three to five                                                                     |

One colour per destination: Shop gold or green, Pets green or blue, Rewards purple, Codes blue, Settings grey or blue. A secondary destination is never plain grey (reads disabled) unless the theme says Settings is grey.

## Components

Rail container, button (face, icon, label), badge ("!" or a count). Nothing else.

## Density

Compact over large: the rail occupies about 7 to 11% of the screen width. Uniform buttons, no featured larger button. The rail never expands, slides out or becomes a panel.

## States

Idle, hover (scale 1.06), pressed (0.94), one button with a badge, optionally the active destination dimmed while its menu is open. Hiding the rail while a full screen is open is a game decision; do it only on request.

## Phone and PC

Placement is Scale, so the rail holds on tall and wide windows. Pixel versions (the cartoon card 176 x 74) must scale with `viewport.Y / 1080` and keep the 44 px floor. On a phone the rail stays at the left edge but must not touch the thumbstick area; pick the right edge when the game's joystick sits at the left and the rail would collide, and keep at most four buttons. Keep clear of the top-left keep-out: the rail's top is at least 70 px below the top.

## Failures to avoid

Icon-only or text-only buttons; a label that escapes its button; a plate behind the rail; more than six buttons; two columns (a menu, not a rail); a rail tucked into a corner (a HUD zone); a bigger first button.

## Build order

1. ScreenGui (`ResetOnSpawn = false`), `Rail` container with a list layout.
2. Button builder from the theme taking `(label, icon, colour)`.
3. Add buttons from one data table; add badges last.
4. Open handlers per button (`openMenu(name)` stub).
5. Compact branch (sizes, edge choice).
6. Hover and press (`polish.md`); audit; screenshots with the world visible.
