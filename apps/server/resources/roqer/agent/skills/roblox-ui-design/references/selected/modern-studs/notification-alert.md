# MODERN STUDS selected body: notification-alert

> Repository-authored from the modern-stud reference study; not yet benchmark-validated. Construction comes from `references/themes/modern-studs/part-1.md` and `part-2.md`; this body owns geometry and composition.
> Evidence: both reference games show transient messages as bare stroked text lines over the world, coloured by type (one game stacks them in the upper third, the other centres an announcement on a faded dark band). Lifetimes and stacking keep the CLASSIC STUDS notification rules.

# SELECTED LAYOUT GUIDE (loaded via layout="notification-alert")

For: toasts, popup notifications, reward and achievement banners, server announcements, error and status messages: transient feedback that appears, informs, and leaves on its own. NOT for dialogs that wait for a decision (centered-dialog) or always-on readouts (hud-zone-system).

The defining trait: **big, bare, coloured text lines in the upper third that never block play.** No blocks, no chips, no panel: the message IS the text.

## Measurements (1080p)

- Stack: ONE transparent Frame, `AnchorPoint = Vector2.new(0.5, 0)`, `Position = UDim2.fromScale(0.5, 0.1)`, `Size = UDim2.fromScale(0.6, 0.3)`, holding a vertical `UIListLayout` (`HorizontalAlignment = Center`, `Padding = UDim.new(0.01, 0)`). Newest message at the top.
- Toast: one line, a `makeText` label with `extrude = true`, stroke 3, `Size = UDim2.new(1, 0, 0.16, 0)` of the stack (~4.8% of the screen height), filled with the type's gradient:
  - success / reward: the cash gradient;
  - rare / achievement: the gold gradient;
  - information: the gem gradient;
  - error / warning: `ColorSequence.new(Color3.fromRGB(255, 120, 120), Color3.fromRGB(235, 30, 40))`.
- A reward toast may lead with its currency or item icon: the icon (Fit, square, the line's height) and the label as one centred horizontal row, icon left.
- Announcement variant: ONE faded dark band centred at y 0.15, `Size = UDim2.fromScale(0.62, 0.065)`: a black Frame whose `UIGradient` transparency runs 1 at both ends to 0.78 in the middle, with the message as an extruded white label (0.9 of its width, 0.6 of its height) on it. It replaces itself and never stacks; toasts sit under it.
- Static generation renders the system mid-life: 2-3 sample messages of different types in the stack (a reward, an achievement, an error), hardcoded.
- Behaviour, ONLY when a later task wires it: pop in with a `UIScale` 0.6 -> 1 (`Back`, `Out`, 0.2 s, a brief pop), hold 3 s, fade out by tweening the label's and its strokes' transparency to 1 over 0.3 s, then Destroy. At most 3 visible; a 4th removes the oldest. An announcement holds up to 8 s. Nothing pulses while it holds.

## Rules

- No backdrop, no blur, no blocks behind toasts, and no buttons on a message. A message that waits for a click is centered-dialog.
- The upper third only: never the centre of the screen.
- ONE line per message, short: a toast wrapping to two lines is a defect. Shorten the text rather than shrink the line.
- Messages are uniform in height; only colour, icon, and text vary.
- Messages stack; they never overlap or sit side by side.
