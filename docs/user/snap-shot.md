# SnapShots

A SnapShot captures the window you are working in and attaches it to your current draft. The
attachment carries the app name and window title, and when available the app icon and the window's
accessibility data (its controls, text, and their positions in the image). Agents can use that data
to reason about the screenshot.

SnapShots are off by default and available in the desktop app on macOS and Windows.

## Turning it on

Open **Settings** > **SnapShots** and turn the feature on. Setup has two steps: allow capture, then
choose a shortcut. **Finish later** turns capture back off so you can resume where you left off.

- **macOS** asks for Screen Recording during setup. It asks for Accessibility only when **Include
  app text** is on.
- **Windows** needs no setup or permission.

## Taking a capture

Switch to the window you want and press the shortcut. The default is both Shift keys together.
Harp attaches the image to your draft and brings itself forward. If no thread is open it starts
a draft in the current project.

Pressing the shortcut while Harp is in front captures Harp itself.

Pending captures are kept on disk until the attachment is saved to the draft, so a capture survives
closing the app mid-way and is attached on the next launch. Captures rejected because the image is
too large are discarded.

## Changing the shortcut

Select the shortcut in Settings, press the new keys, then **Save**. You can use a modifier pair such
as Command+Command or Ctrl+Ctrl, or a key chord. Harp refuses shortcuts that collide with its own
keybindings or that the operating system already reserves.

## Include app text

**Include app text** controls whether captures include the window's accessibility data. Turn it off
to attach screenshots only. On macOS this also drops the Accessibility permission requirement.

Availability depends on the app. Some apps expose only their window controls, not the document or
terminal contents. If an app is slow to answer, Harp attaches the screenshot without the data
rather than waiting.

An icon beside the app name on an attachment shows whether accessibility data was included. Select
it to inspect what was captured.

## Sound, flash, and animation

Settings controls the capture sound, the brief flash on the captured window, and the animation that
flies the image into your draft. Each can be turned off independently. The operating system's
reduced-motion setting also disables the animation.
