# What's new in SealCode

<!--
SealCode shows this file in its What's New screen, and the release workflow publishes
each version's section as that release's notes. Newest version first:

## <version> · <YYYY-MM-DD>
> One-sentence headline
### New | Improved | Fixed
- **Title** — description   (under New, titled items show as cards)
-->

## 2.14.0 · 2026-10-20

> See what changed after every update.

### New

- **What's new** — After an update, SealCode shows what changed since the version you last used. Open it again any time from Settings → General or the command palette.

### Fixed

- **App version in Settings** — Settings → General shows the installed SealCode version instead of 0.1.0.

## 2.13.0 · 2026-10-19

> Roblox agents build cleaner meshes and interfaces that fit every screen.

### Improved

- **Clean Blender topology** — When Roqer models in Blender, it now checks the mesh for ngons, loose geometry, flipped normals and other topology problems before exporting to Roblox, and follows clean-topology rules while modeling.
- **Roblox UI that fits every device** — The roblox-gui skill now sizes interfaces with Scale and constraints, keeps text from being cut off or overflowing, keeps touch targets large enough, and checks each screen on phones, tablets, laptops, desktops and TV before calling it done.

## 2.12.0 · 2026-10-19

> Claude threads can use your Windows desktop.

### New

- **Computer use** — Claude threads on the Windows desktop app can take screenshots, move the mouse, click and type to work in other apps, after you allow it.

### Fixed

- **Typing with computer use** — Text typed through computer use now arrives one character at a time, so apps such as Paint no longer drop letters.

## 2.11.0 · 2026-10-19

> Dozens of fixes from upstream T3 Code.

### Fixed

- **Provider settings at startup** — Provider settings saved while the app was still starting are no longer lost.
- **Thread switching** — Switching threads shows only the selected thread's messages.
- **Mermaid while streaming** — Finished Mermaid diagrams render while the reply is still streaming.
- **Settings search** — Search now reaches settings inside collapsed sections.
- **And more** — Around forty other fixes for providers, worktrees, pull requests, SSH hosts and the chat view.

## 2.10.0 · 2026-10-19

> Save your whole look and switch between looks in one click.

### New

- **Appearance presets** — Settings → Appearance → Presets saves the theme, glass, background image and its effects, corners, fonts and motion as a named look. Click a preset to switch to it.

## 2.9.0 · 2026-10-18

> See where your context and usage are going.

### New

- **Thread environment panel** — The thread panel shows the session, the context window and the MCP servers in use.
- **Usage ring** — The composer shows how much of the selected model's usage you have left.

## 2.8.1 · 2026-10-18

> Antigravity installs reliably.

### Fixed

- **Antigravity install** — Installing Antigravity no longer launches its runtime first, and a slow first start no longer makes the install fail.

## 2.8.0 · 2026-10-18

> SealCode now updates itself.

### New

- **Automatic updates** — SealCode checks GitHub for new versions and offers to install them from the update button.
