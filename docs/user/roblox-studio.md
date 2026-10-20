# Roblox Studio

SealCode can drive Roblox Studio from any agent with [Roqer](https://github.com/S4US/Roqer)'s
harness: its Studio bridge and plugin, its checks on every Studio call, its Roblox skill pack and
its working instructions. Turn it on in **Settings → Connections → Roblox Studio**.

## Start

1. Choose **Roqer (full toolset)** under **Studio connection**. On Windows, SealCode turns this on
   by itself the first time it starts on a machine with Roblox Studio installed.
2. Fully close and reopen Roblox Studio once: SealCode installs the matching Studio plugin every
   time it starts, and Studio only loads plugins when it opens.
3. Open your place in Studio, then ask an agent in a Roblox project for something.

The status under the settings shows the bridge, the connected places, and when Studio must be
restarted because it still runs an older plugin. **Reconnect** restarts the bridge. A bridge that
stops on its own is restarted automatically.

## Which threads get it

Only threads in a Roblox project get the Studio tools and Roqer's instructions, so other projects
pay nothing for them. A Roblox project has a Rojo `*.project.json`, a place or model file, Roblox
tooling such as `wally.toml` or `rokit.toml`, or an empty `.roqer` file in its root. Choose **All
projects** to give them to every thread.

When the workspace holds a Rojo project, the agent is told about it and links the place to it with
`manage_instance`, so script edits are saved to your files.

## What the agent gets

- The Studio tools (`mcp__robloxstudio__…`): inspect and edit the place, atomic builds, script
  edits checked against the revision the agent read, playtests, runtime logs, screenshots, UI
  inspection, Creator Store assets, animation and profiling. Every script write is read back and
  checked, and Luau that would write a script's source is refused.
- `load_skill` for Roqer's Roblox skills, `resolve_icon` for UI icons, `upload_assets` for several
  uploads at once, and `get_bridge_status`.
- Roqer's instructions, once at the start of each conversation. Turn them off with **Roqer
  instructions and skills**; **Automatic playtests** says whether the agent playtests its changes
  without being asked.

Tool calls follow the thread's usual approval rules.

## Uploads

Uploading models, decals and animations needs a Roblox Open Cloud API key with the Assets API
(write). Paste it in **Open Cloud API key**; it is kept in the server's secret store and passed
only to the Studio bridge. **Upload as** sets the user or group that uploads publish as.

## Blender

- **Blender modeling (Roqer)** lets the agent run Blender jobs in the background: it models in
  stages, and each export is re-imported, measured and previewed for the agent before it uploads
  the model. SealCode finds Blender in its usual install folders and Steam libraries; otherwise set
  **Blender executable**. Each job runs a Python script with your permissions, so approve it as
  you would any script.
- **Blender MCP** connects an MCP server that drives your open Blender, such as MCP for Blender.
  SealCode runs your MCP for Blender install when it finds one, otherwise `uvx blender-mcp`, or the
  command you set.

## SealCode bridge (preview)

**SealCode bridge (preview)** under **Studio connection** runs SealCode's own Studio bridge inside
SealCode instead of Roqer. It covers the core tools so far (`mcp__studio__…`): the game tree,
search, typed properties, atomic property changes, creating and deleting instances, script reads
and edits checked against the revision the agent read and read back afterwards, Luau, playtests,
output logs, the Studio selection and screenshots of the edit viewport (not during playtests). Assets, uploads, builds, UI inspection and
Blender jobs still need Roqer.

- SealCode installs the **SealCode** plugin when the mode is on. Studio loads plugins when a place
  opens, so reopen places that were already open. The first time it connects, Studio asks whether
  the plugin may make HTTP requests: allow it.
- The **SealCode** button on Studio's Plugins tab opens a panel with the connection, what the agent
  is doing in that place, and switches to pause the agent, refuse changes, or refuse Luau. Studio
  enforces them, whatever the agent asks.
- The bridge listens on `127.0.0.1:58760`; set `SEALCODE_STUDIO_BRIDGE_PORT` before starting
  SealCode to use another port. Choosing another mode removes the plugin again.
- An unsaved place gets a `SealCodePlaceId` attribute on ServerStorage so SealCode recognizes it
  across restarts.

## Roblox's own MCP

**Roblox's own Studio MCP** connects only the MCP server Roblox Studio ships, without Roqer. With
Roqer on, **Also connect Roblox's own MCP** adds it for its mesh, texture and material generation.

## Other apps

Roqer's bridge listens on port 58741. If another app's bridge (Roqer itself, or a copy you added to
Claude Code) already holds the port, SealCode's forwards to it; keep both at the same Roqer version,
or Studio refuses the plugin of the other one.
