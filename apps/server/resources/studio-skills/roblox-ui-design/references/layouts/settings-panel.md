# Layout variant: settings-panel

A list of settings rows: toggles, sliders, steppers, keybinds. A component list, not a catalogue.

**Use it when** the player changes options (audio, graphics, controls). **Not when:** the controls are staff commands (`admin-control-panel.md`) or the window is a developer tool (gallery 5 and `windui.md`).

Themes: any. Gallery 1 for a sleek settings column, gallery 13 for candy rows, gallery 8 for toggles with status lights.

## Zones

Panel `P`: 0.40 x 0.62 S regular (ratio about 1.15), 0.92 x 0.90 compact (ratio 1.5). A header with close, an optional tab row (Audio, Graphics, Controls), then a scroller of rows.

| Row type     | Construction                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Row          | 44 to 56 px high, 12 px between rows; the label at the left (text cap 18 to 24 px), the control in the right 40%                                                       |
| Toggle       | a 64 x 28 track with a 22 px knob; on and off differ by colour and by knob position, never by colour alone; the cartoon card theme uses a sticker chip on a grey track |
| Slider       | a track with a fill and a knob and the value text beside it; a hit area at least 44 px high around a thinner track                                                     |
| Stepper      | `<` and `>` square buttons around a value centred in a fixed width, so the arrows do not move                                                                          |
| Keybind      | a key cap showing the current key; click it, then press a key                                                                                                          |
| Section head | a centred label between two thin lines, on a row of its own                                                                                                            |

Group rows under section headings; no more than eight rows without a scroller.

## States

Each control has default, hover, pressed and disabled looks, and toggles have on and off. A changed value applies at once; there is no Save button unless a change needs a restart.

## Phone and PC

Rows are full width and at least 48 px high on compact; sliders need a wide track; keep a slider knob out of the thumbstick corner. Controller navigation is not covered here; say so if it is asked for.

## Failures to avoid

Colour-only on and off; labels that wrap; controls that move when the value text changes length; a Save button for instant settings; tiny knobs.

## Build order

1. Panel, header, tabs, scroller with a list layout.
2. One builder per row type taking `(label, value, onChange)`.
3. Rows from a settings table; defaults from the game's saved values.
4. Hover and press (`polish.md`); audit; screenshots.
