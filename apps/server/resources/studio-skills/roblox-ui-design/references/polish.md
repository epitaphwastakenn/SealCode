# Polish

Polish is what makes a screen feel made, not generated. Add it after the layout passes review, in a LocalScript next to the ScreenGui (or in the existing UI controller).

## Motion

- **Hover** (mouse): tween a `UIScale` on the button to 1.06 over 0.12 s, `Enum.EasingStyle.Back`, `Out`. Leave: back to 1.
- **Press:** `UIScale` 0.94 and move the face down onto its lip; release: back up with Back easing.
- **Entrance:** the content frame's `UIScale` from 0.8 to 1 and transparency in over 0.35 s, buttons staggered by 0.05 s each.
- **Title idle:** at most a gentle bob (2 to 3 px up and down, 2 s period) or a slow rotation wobble of 1 to 2 degrees. Only on the title or a badge, never on the whole screen.
- Tween with `TweenService` and keep references so tweens are cancelled when the screen closes. No `RenderStepped` loops for UI motion.

## Sound

Hover tick and click sounds (short, quiet: volume 0.3 to 0.5) from the Creator Store, one pair for the whole game, played from `SoundService` with `SoundService:PlayLocalSound`.

## States

Every button has hover, pressed and disabled looks. Disabled: desaturate (fill to grey `#9AA3B2`), text at 0.4 transparency, no hover motion. Purchasable vs owned vs equipped items must look different at a glance.

## Finishing details

- Text shadows or strokes on all text over gradients.
- A highlight shine on Cartoon and Simulator buttons.
- Consistent icon sizes and baseline alignment with their text.
- Close buttons with a clear X made from two rotated frames or an icon, never the letter X in a random font.
- Numbers formatted with separators or suffixes (1,250 or 1.25K), never raw floats.
