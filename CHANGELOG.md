# What's new in SealCode

<!--
SealCode shows this file in its What's New screen, and the release workflow publishes
each version's section as that release's notes. Newest version first:

## <version> · <YYYY-MM-DD>
> One-sentence headline
### New | Improved | Fixed
- **Title** — description   (under New, titled items show as cards)
-->

## 2.17.1 · 2026-10-20

> See a look before you apply it, and switch looks without a blank background.

### Improved

- **Preset previews** — Each appearance preset shows a small preview of the app with its colours, background image and effects.
- **Instant look switching** — Switching presets keeps the current background until the new image is ready, so the app never goes blank.

### Fixed

- **Corners in fullscreen** — On Windows, maximized and fullscreen windows have square corners, so the desktop no longer shows through.
- **Floating panels on Windows** — No more grey outline around the window or slivers at the panel corners.

## 2.17.0 · 2026-10-20

> A complete UI library of SealCode's own, so agents build shops, wheels and menus that look finished.

### New

- **20 screen layouts** — Shops, inventories, select screens, quests, daily rewards, leaderboards, notifications, dialogs, landing and loading screens, HUDs, side menus, admin panels and settings, each with sizes for PC and phones.
- **Three complete themes** — Cartoon card, classic studs and modern studs, each with its own panels, buttons, cards, tabs and bars.
- **Prize wheel and crate reel** — Ready-made templates for a spinning prize wheel and a vertical case roll, with the result decided by the server.

### Improved

- **Polish and review** — Agents add motion, sounds, shop states (tiers, tags, owned, discounts) and check every screen against its layout before finishing.

> Every Studio tool agents were missing, a UI library built from real references, and agents that ask before they style or publish.

### New

- **Animation tools** — Agents inspect, create, play and stop animations on rigs. They use Roblox's own animations from the toolbox when they fit, and animate by code when nothing fits.
- **Performance and debugging** — Script profiler in playtests, memory by category, a scene analysis of what makes a place heavy, network lag simulation, and logpoints that print values without pausing the game.
- **Import and export models** — Agents save instances to .rbxm files and load .rbxm/.rbxmx files into the place.
- **Roblox docs lookup** — Agents read the official API reference for any class, enum or datatype instead of guessing.
- **AI model generation** — Roblox's own Assistant tools are connected by default, so agents can generate models, meshes and textures with Roblox's AI when you want them.
- **UI library** — 18 UI archetypes (AAA sleek, simulator cartoon, brainrot clickbait, studded, monochrome, fantasy, sci-fi, 3D UI and more), icon matching from the toolbox, and WindUI for sleek windowed interfaces.
- **VFX and animation playbooks** — Learned from real toolbox packs: how good effects are layered and timed, how to adapt packs, and how to build effects from scratch.
- **DataService (typed)** — Agents use Leif's DataService for player data unless you ask otherwise, with its documentation at hand.

### Improved

- **Agents ask about UI style** — With no UI in the game, agents ask which style you want; with existing UI, they ask whether to match it or start fresh, and remember your answer in the place.
- **Publishing** — Agents never upload on their own: they ask whether to publish through the Roblox Assistant or let you publish and name the assets yourself. Open Cloud key uploads are gone.
- **Cleaner game code** — Agents trust what they verified instead of filling scripts with defensive checks, and use WaitForChild only where Roblox really delivers things late.
- **Whole screens in one step** — Builds can refer to children of things made in the same step, so a full UI is one undo.

## 2.15.0 · 2026-10-20

> SealCode now has its own Roblox Studio plugin: agents see their work, use the Creator Store and Blender, and you control every tool from Studio.

### New

- **SealCode's own Studio plugin** — A new plugin and connector built for agents replace the old third-party harness. Choose **SealCode** in Settings → Connections → Roblox Studio; the plugin installs itself, and settings from before switch over automatically.
- **Screenshots in the chat** — When an agent takes a screenshot of Studio, it appears right in the conversation, so you see what the agent sees without opening anything.
- **Camera control** — Agents move Studio's camera and frame what they built from any angle (overview, front, top, eye level) before taking a screenshot, and check their work from more than one side.
- **Studio panel** — A panel in Studio's own look shows the connection and every action the agent takes. Pause the agent, make the place read-only, turn off running Luau, or switch off any single tool, with a search box to find it.
- **Updates without reopening Studio** — The plugin updates itself in place when SealCode updates. When an agent does need to reopen a place, it closes the older window first instead of piling up Studio windows.
- **Creator Store assets** — Agents search free assets, check their details and thumbnails, and insert them. Scripts inside arrive disabled until the agent has read them, and assets load even in places that are not published.
- **Blender to Studio** — Agents model in Blender headless, get a topology report and a four-view preview in the model's colours for every job, and bring the model straight into Studio, no upload needed.
- **Publish to Roblox** — With an Open Cloud key in settings, agents publish Blender models, images and sounds as Roblox assets and insert them, so they stay with the place.
- **UI design skill** — A new skill teaches agents to build screens that look designed: cartoon, simulator, modern, sci-fi and fantasy styles, buttons with depth and readable text, layouts, motion, and a visual review on phones, tablets and PCs.

### Improved

- **More forgiving tools** — Studio tools accept the argument spellings agents commonly use, the device simulator skips settings a device does not support instead of failing, and closed Studio windows disappear from the connection list right away.
- **Agent instructions** — Agents follow a clear work loop: read, load the right skills, build in steps, look at the result, fix, and finish with a final screenshot.

## 2.14.0 · 2026-10-20

> See what changed after every update.

### New

- **What's new** — After an update, SealCode shows what changed since the version you last used. Open it again any time from Settings → General or the command palette.

### Fixed

- **App version in Settings** — Settings → General shows the installed SealCode version instead of 0.1.0.

## 2.13.0 · 2026-10-19

> Roblox agents build cleaner meshes and interfaces that fit every screen.

### Improved

- **Clean Blender topology** — When an agent models in Blender, SealCode now checks the mesh for ngons, loose geometry, flipped normals and other topology problems before exporting to Roblox, and follows clean-topology rules while modeling.
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
