# Harp

**Made by a game developer, for game developers.**

Harp is a desktop app for working with AI coding agents on games. It started as a fork of
[T3 Code](https://github.com/pingdotgg/t3code) and grew into a workspace for game development: Roblox Studio,
Blender and your agents in one window. Projects, threads, diffs, terminals and usage all stay together.

Harp was formerly called SealCode. It is the same app, and installed copies update in place.

Bring your own subscriptions. Harp runs the agents you already pay for, on your own machine:
Claude Code, Codex, Antigravity, Cursor, Grok Build, OpenCode and CommandCode.

## Why Harp

Generic coding agents know code, but they don't know your engine. They can't see your place in Studio,
check the UI they just built on a phone screen, or tell whether a mesh will import cleanly. Harp
gives agents the tools and the know-how to work inside your game, not just next to it.

You stay the designer and decide what the game should be. The agent does the repetitive work: building,
scripting, wiring up UI, testing and checking. You review each change in a diff before you keep it.

## Roblox development

Harp has its own Roblox Studio plugin and connector, built for agents. Any agent can work directly in
your open place, and you watch and steer it from a panel inside Studio:

- **Live Studio tools.** Read and edit the place, run atomic builds that are one undo step, and edit
  scripts. Every script edit is checked against the version the agent read and read back afterwards.
  Agents also playtest (solo and multiplayer), run code inside the running game and read the output.
- **Agents that look at their work.** Agents move Studio's camera, frame what they built and take
  screenshots, and every screenshot appears right in the chat, so you see what the agent sees.
- **Creator Store assets.** Agents search free assets, check their details and thumbnails, and insert
  them. Scripts inside arrive disabled until the agent has read them.
- **UI that looks designed and fits every device.** A design skill for cartoon, simulator, modern,
  sci-fi and fantasy styles, plus checks on phones, tablets, PCs and TV with Studio's device simulator.
- **A Studio panel you control.** See every action as it happens, pause the agent, make the place
  read-only, or switch off any single tool.
- **Updates without restarts.** The plugin updates itself in place when Harp updates, and agents
  close old Studio windows instead of piling new ones up.
- **31 Roblox skills.** Luau and types, architecture, networking and security, DataStores, UI design,
  game design, monetization, performance, lighting, audio, physics, NPC AI, localization, analytics and
  a publish checklist, loaded only when a task needs them.
- **Rojo aware.** When your workspace has a Rojo project, script edits are saved to your files.
- **Roblox's own Studio MCP** can run next to Harp's for mesh, texture and material generation.

Only Roblox projects get the Studio tools, so other projects don't pay for them. See
[Roblox Studio](./docs/user/roblox-studio.md).

## 3D with Blender

- **Background modeling.** Agents run Blender jobs headless. Each result is measured and rendered as a
  preview, then brought into Studio.
- **Clean topology checks.** Meshes are checked for ngons, loose geometry, flipped normals and other
  problems before export.
- **Blender MCP.** Agents can drive your open Blender directly.

## Computer use

On Windows, Claude threads can see your screen and use the mouse and keyboard. They can work in desktop
tools that have no other integration, and they ask before touching each app. See
[Computer use](./docs/user/computer-use.md).

## Make it yours

The tools you work in all day should feel like yours:

- **Themes** for light and dark mode, plus contrast, corner radius, fonts and motion settings.
- **Glass.** Make the whole app translucent, with control over how much of each panel shows through.
- **Background images.** Use your own image or animation behind the app, with blur and other effects.
- **Appearance presets.** Save a whole look and switch between looks in one click.
- **Sounds and notifications** for when an agent finishes or needs you.

## Built for long sessions

- **Many agents, one window.** Run several providers and threads side by side, each with its own diffs,
  terminal and checkpoints, so you can roll any turn back.
- **Usage at a glance.** A usage ring in the composer, plus a thread panel showing the session, the context
  window and the MCP servers in use.
- **Automatic updates.** Harp updates itself from GitHub releases. After every update, **What's new**
  shows what changed.
- **Remote ready.** Drive your desktop's agents from a phone or another machine. See
  [Remote access](./docs/user/remote-access.md).

## Coming next: UEFN

Roblox is the first engine, not the last. Support for **UEFN** (Unreal Editor for Fortnite) is planned,
bringing the same approach to Fortnite islands: engine tools for agents, Verse know-how, and checks that
verify the result in the editor.

## Install

Download the Windows installer from [Releases](https://github.com/epitaphwastakenn/SealCode/releases). It
updates itself afterwards.

Then install and sign in to at least one agent:

- **Claude:** install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
- **Codex:** install the [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- **Antigravity:** enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No
  CLI is required.
- **Cursor:** install the [Cursor CLI](https://cursor.com/cli) and run `agent login`
- **Grok Build:** install the [Grok Build CLI](https://x.ai/cli) and run `grok login`
- **OpenCode:** install [OpenCode](https://opencode.ai) and run `opencode auth login`
- **CommandCode:** install its `commandcode` CLI and sign in

For Roblox, open **Settings → Connections → Roblox Studio** and choose **Harp**. The Studio plugin installs itself.

### Run from source

Install Node.js 24.13+ and [Vite+](https://viteplus.dev/guide/) (`vp`), then run:

```bash
vp i
vp run dev
```

To build the Windows installer:

```bash
vp run dist:desktop:win:x64
```

## Documentation

User guides live in [docs/user](./docs/user):

- [Install and first run](./docs/user/install.md)
- [Roblox Studio](./docs/user/roblox-studio.md)
- [Appearance and themes](./docs/user/appearance.md)
- [Computer use](./docs/user/computer-use.md)
- [MCP servers](./docs/user/mcp-servers.md)
- [Usage](./docs/user/usage.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Remote access](./docs/user/remote-access.md)

Working on Harp itself? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## Status

Harp is early and changes quickly, so expect rough edges.

We are not accepting contributions yet: please don't open pull requests for now. Bug reports and ideas are
welcome as issues.

## Credits

Harp is a fork of [T3 Code](https://github.com/pingdotgg/t3code) by Theo Browne, Julius
Marminge and the T3 Code contributors, released under the MIT license. Thank you for the foundation.
Its Roblox skills build on [roblox-brain](https://github.com/TabooHarmony/roblox-brain) by
TabooHarmony (MIT). See [open source licenses](./docs/user/open-source-licenses.md).
