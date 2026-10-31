# What's new in SealCode

<!--
SealCode shows this file in its What's New screen, and the release workflow publishes
each version's section as that release's notes. Newest version first:

## <version> · <YYYY-MM-DD>
> One-sentence headline
### New | Improved | Fixed
- **Title** — description   (under New, titled items show as cards)
-->

## 2.17.16 · 2026-10-31

> Harp gets one consistent look everywhere, a screenshot gallery after each turn, per-thread Studio controls, and Ultracode with any effort.

### New

- **Screenshot gallery** — When an agent finishes, every screenshot it took during that turn (Roblox Studio, browser, computer use) is collected in one row after its final reply. Open it to flip through them with the arrows, a swipe or the thumbnail strip.
- **Studio controls per thread** — The new Agent menu next to the composer, and Studio places in the thread details, let you stop an agent from running playtests or deselect a connected place so the agent ignores it, for that thread only. Harp enforces both on the server, and Roblox's own MCP is hidden while a thread has restrictions.
- **Ultracode with any effort** — Ultracode is now its own switch in the model picker, so you can pair it with any reasoning effort, as in Claude Code. A saved Ultracode choice becomes Extra high with Ultracode on.

### Improved

- **One look everywhere** — The old and new designs are merged into one. The sidebar, the Working and Worked for rows, the composer and the new-thread screen, the model picker, Settings, dialogs, menus, toasts and side panels now share the same colours, corners, glass and controls. The Beta page and its "New design" switch are gone.
- **Roblox VFX skill** — Agents building visual effects now prototype several variants side by side for you to pick from, measure animations before timing effects, and follow tested recipes for trails, tracers, projectiles and textures.

> See your words while you dictate, take Claude's guess at your next prompt with Tab, and give the sidebar header art a style and color of your own.

### New

- **Live transcription preview** — While a voice note records, the words you say appear dimmed in the composer, like in Claude Code. A Whisper model runs on your GPU inside Harp; it downloads once (about 600 MB) and then loads from disk. The final text still comes from your transcription server, and if that fails, Harp keeps the preview text instead of losing what you said. Turn it off in Settings → General.
- **Next prompt suggestions** — When a Claude turn ends, Claude's guess at your next message appears dimmed in the empty composer. Press Tab to use it, or just type. It runs inside Claude's own session, so it costs almost nothing. Settings → General can turn it off, or turn it on for other providers through your text generation model, which uses extra quota.
- **Header art styles and color** — The sidebar header art now comes in Blueprint, Night sky, Waves, Ice floe, Dots, Pixels and Aurora, and follows your theme or a color you pick. Settings → Appearance → Interface.

### Fixed

- **Antigravity terminal window** — On Windows, Antigravity no longer opens a terminal window, and closing such a window no longer ends its turn with an error. Its tools now run hidden in the background.

## 2.17.14 · 2026-10-28

> SealCode is now Harp, with a new icon and a seal mascot, and Claude Code no longer burns through its 5-hour limit faster in Harp.

### New

- **Harp** — SealCode is now called Harp, after the harp seal. The app, its icon, the installer and the Roblox Studio plugin all say Harp. Your projects, threads and settings stay exactly where they were, and updates keep working.
- **A mascot** — Harp the seal rests above the new-thread prompt, types on a tiny laptop while an agent works, balances its ball while a worktree is set up, and naps when there is nothing to show.
- **Sidebar header art** — The colored grid from the web version now sits behind the sidebar header, tinted by your theme. Turn it off in Settings → Appearance → Interface.

### Fixed

- **Claude Code usage drained faster** — Claude Code counted Harp's sessions as SDK traffic, which uses up the 5-hour limit roughly 1.8 times faster than the CLI. Harp now identifies its own Claude sessions, so the same work costs the usual share of your limit.

## 2.17.13 · 2026-10-27

> SealCode opens faster, uses about a quarter less memory, and changes themes without freezing.

### Improved

- **Lighter while opening** — SealCode no longer starts a full Claude Code session, the CommandCode CLI or MCP servers such as Blender's while it opens. Status comes from quick checks and saved results, and an MCP server starts on its first tool call. In our tests, memory right after opening went from about 980 MB to 730 MB, and idle memory from about 880 MB to 600 MB.
- **The window shows sooner** — The window is prepared while the server starts, the Windows PATH lookup is remembered between launches, and the first screen loads 11% less code.
- **Smooth theme changes** — Changing the theme or applying a preset happens in one step: colors apply at once, only what depends on light or dark repaints, and the backdrop image is not processed again.
- **Threads open faster** — Messages are parsed once and reused, very large code blocks appear right away and get their colors afterwards, and the server no longer reads command output and diffs the thread view doesn't show.
- **Quieter in the background** — Updates are checked every 4 hours instead of every 4 minutes, and the app no longer polls itself every few seconds.
- **SealCode everywhere** — The app, its messages and its docs now say SealCode, with credit to T3 Code's creators in Settings → About. Command hints use SealCode's own `t3` command instead of `npx t3`, which installed T3 Code.

## 2.17.12 · 2026-10-27

> SealCode drops the parts of T3 Code that have nothing to do with making games, and no longer sends usage data to T3.

### Improved

- **No usage data sent to T3** — SealCode inherited anonymous usage reporting to T3's analytics service, on by default. It is gone.
- **Leaner app** — Removed T3 Cloud sign-in and its relay, guest sharing, the phone and emulator device hub, webhook triggers for scheduled tasks, and the Azure DevOps, Bitbucket, Forgejo, GitCafe and GitLab integrations. Scheduled tasks, GitHub, and remote access over SSH, Tailscale and WSL stay. Settings and threads that mention removed features still open; a scheduled task that ran from a webhook is paused, and you can switch it to a schedule.

## 2.17.11 · 2026-10-27

> Antigravity starts on Windows PCs where it used to get stuck, and starts faster everywhere.

### Fixed

- **Antigravity stuck on "starting"** — Google's Antigravity program unpacked about 7,400 files into the temporary folder every time it started, and on some Windows PCs that never finished. SealCode now unpacks it once, in the background, and it starts in about 3 seconds without touching the temporary folder.

## 2.17.10 · 2026-10-27

> Antigravity starts on slow machines and tells you exactly why it cannot connect.

### New

- **Antigravity diagnostics** — A Diagnostics button next to the Antigravity account (and `t3 antigravity diagnose`) builds a report you can copy and send: versions, proxy and VPN, DNS, HTTPS over IPv4 and IPv6, the clock, and a real sign-in test. Tokens, emails and your user folder are left out.

### Fixed

- **Slow first start** — On slower laptops, where Antigravity can take a while to unpack, SealCode no longer restarts it halfway through. It shows that it is still starting, often because of antivirus scanning.
- **Security software and filtered networks** — On Windows, Antigravity trusts the same certificates Windows does, so networks or software that inspect HTTPS no longer block it.
- **Clear sign-in errors** — When sign-in cannot connect, the message names the cause: inspected HTTPS, a wrong clock, DNS, or an unreachable proxy.

## 2.17.9 · 2026-10-27

> Antigravity works on networks with broken IPv6.

### Fixed

- **Antigravity on broken IPv6** — Antigravity now always connects through SealCode, which tries IPv4 first and falls back to IPv6 only when IPv4 fails. Sign-in, sign-out and turns no longer hang on networks where IPv6 half-works. If the agent still goes quiet, SealCode restarts it once on its own before showing an error. A proxy you set yourself is still used.

## 2.17.8 · 2026-10-26

> Much faster: threads open with far less data, and streaming and connecting do less work.

### Improved

- **Faster threads** — Opening a thread loads about 85% less data, and live updates send each message once instead of repeating it.
- **Faster connect** — Connecting skips idle subagent threads and older settled threads, so the first load is much smaller.
- **Lighter streaming** — Replaced streaming text is merged before it is sent, and code highlighting is lighter.
- **Big files and PRs** — Large file previews scroll smoothly, and pull request timelines, code tabs and diffs load faster.
- **Less background work** — Hidden preview tabs slow down instead of running at full speed, and unchanged settings are no longer rewritten.
- **Settings and Usage in a window** — Settings and Usage open in a window over your work, with SealCode's look and panels.

## 2.17.7 · 2026-10-26

> Gemini 4 Argon in Antigravity, every usage limit, and an app that no longer freezes on its database.

### New

- **Gemini 4 Argon** — Antigravity now runs the newer agent, so Gemini 4 Argon is in the model picker.
- **All Antigravity limits** — Usage shows the Gemini and Gemini 4 Argon limits next to the shared Claude & GPT ones.
- **PDF attachments** — PDFs you attach go to Claude and Antigravity as documents.

### Improved

- **Antigravity on tricky networks** — When Antigravity cannot reach Google over IPv6, it switches to IPv4 by itself. If a sign-in or turn still stalls, SealCode says so instead of thinking forever.
- **New threads remember your setup** — A new thread starts with the model and modes you last used in that project.
- **Ctrl+W on Windows** — Closing the last window with Ctrl+W asks before quitting.

### Fixed

- **Freezes** — The app no longer freezes when a slow database read blocks every write, old turn snapshots are compacted, and screenshots saved before 2.17.6 move out of the database.
- **Chat jumping to the bottom** — Scrolling up during a turn keeps your place.
- **Large reasoning blocks** — Opening a thread with long reasoning no longer freezes the window.
- **CommandCode reasoning** — The reasoning slider runs from off up to max, and models no longer default to off.
- **Antigravity usage** — Each call is counted once, and untouched limits no longer show a moving reset countdown.

## 2.17.6 · 2026-10-23

> Antigravity cleans up after itself, and long sessions stay responsive.

### New

- **Building and lighting playbooks** — Roblox agents build scenes and set the lighting from guides researched live in Studio: human scale, kits from the Creator Store, terrain, and eight measured lighting presets with a day-night cycle.

### Fixed

- **Leftover Antigravity processes** — On Windows, Antigravity runtimes left behind when SealCode closed or crashed kept running and used memory. SealCode now stops them when it starts.
- **Freezes in long sessions** — Screenshots from Roblox Studio tools are saved as files instead of inside SealCode's database, so long sessions no longer stall on disk writes.
- **Floating panels while streaming** — With floating panels on, the window no longer re-measures itself on every streamed word.

## 2.17.5 · 2026-10-22

> Caught up with 700 upstream T3 Code changes, a theme brightness slider and tidier settings.

### New

- **Theme brightness** — When you create or edit a theme, a brightness slider makes the whole theme darker or lighter without changing each colour. Back in the middle, the theme is exactly as before.

### Improved

- **Up to date with T3 Code** — About 700 upstream changes: faster performance, provider and model compatibility, server and web fixes. Everything SealCode adds stays as it was.
- **Settings descriptions** — Section descriptions such as Roblox Studio, Computer Use and Global MCP Servers now sit under the section title as a quieter subtitle, instead of as a row of plain text.

## 2.17.4 · 2026-10-22

> A bolder effort slider and a composer that stays tidy at any size.

### Improved

- **Effort slider** — The effort slider is thicker and easier to grab. Its fill warms up from blue to purple to amber as effort rises, and the active level glows softly. Reduced motion turns the transitions off.
- **Claude effort levels** — Claude's effort levels now end at Ultracode. Ultrathink is no longer an effort level: type "ultrathink" in your message when you want it. Threads saved with Ultrathink open at Max.

### Fixed

- **Usage meter overlap** — In a small window, or when the composer collapses, the usage meter no longer covers the other composer controls.

## 2.17.3 · 2026-10-21

> Scrollbars sized the way you like, with room to breathe.

### Improved

- **Scrollbar size slider** — Set the scrollbar width anywhere from 6 to 20 px in Settings → Appearance. Your earlier Thin, Medium or Thick choice carries over.
- **Easier-to-use scrollbars** — The thumb is a rounded pill set in from the window edge, with arrows at both ends.

### Fixed

- **Scrollbars covering content** — Wide scrollbars no longer sit on top of items along the right edge.

## 2.17.2 · 2026-10-21

> Scrollbars you can actually grab on a touchpad.

### Improved

- **Wider scrollbars** — Scrollbars are wider by default and easier to drag on a touchpad. Pick Thin, Medium or Thick in Settings → Appearance; presets save your choice.

### Fixed

- **Computer use in English** — The computer use settings and messages, and a hint in the image viewer, were in Portuguese. They are in English now, like the rest of the app.

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
