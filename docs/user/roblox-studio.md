# Roblox Studio

Harp connects agents to Roblox Studio through its own Studio plugin. Agents can read and build in
your open place, write scripts, playtest, move the camera, take screenshots, use Creator Store assets
and model in Blender, while you watch and control everything from a panel inside Studio.

Turn it on in **Settings → Connections → Roblox Studio**.

## Start

1. Choose **Harp** under **Studio connection**. On Windows, Harp turns this on by itself the
   first time it starts on a machine with Roblox Studio installed.
2. Open your place in Studio. Harp installs its plugin automatically; a Studio that was already
   open loads it the next time a place opens.
3. Ask an agent in a Roblox project for something.

The plugin updates itself in place when Harp updates, so you do not need to reopen Studio after
an update. The status in Settings shows the connected places and whether the plugin is current.

## The Studio panel

Open it from the **Harp** button on Studio's Plugins tab. It shows:

- **Connection:** the place, the playtest peers, and buttons to disconnect or retry.
- **Agent activity:** each action the agent takes, with its result and duration.
- **Safety:** pause the agent, make the place read-only, or turn off running Luau.
- **Agent tools:** every tool the agent can use, with its own switch. Search to find one quickly.
  A tool you switch off is refused, whatever the agent asks.

These switches are enforced in Studio and in Harp.

## Which threads get it

Only threads in a Roblox project get the Studio tools and instructions, so other projects pay
nothing for them. A Roblox project has a Rojo `*.project.json`, a place or model file, Roblox tooling
such as `wally.toml` or `rokit.toml`, or an empty `.sealcode-roblox` file in its root. Choose
**All projects** to give them to every thread.

## What agents can do

- Read the place: the tree, properties, scripts and the user's selection.
- Build and edit: atomic builds that are one undo step, properties, instances, and scripts with
  revision checks and automatic read-back.
- Playtest: solo and multiplayer tests, code inside the running game, output logs.
- See: move the camera, frame what they built, and take screenshots. **Screenshots appear in the
  chat** under the action that took them while the agent works. When the turn finishes they are
  collected in one **Screenshots** row after the final reply. Click one to open the viewer, then flip
  through them with the arrow keys, the thumbnail strip or a swipe.
- Check UI: inspect and audit screens, click and type in them, and compare phones, tablets and PCs
  with the device simulator.
- Use the Creator Store: search free assets, check their details and thumbnail, and insert them.
  Scripts inside inserted assets arrive disabled until the agent has reviewed them.
- Model in Blender: run Blender jobs headless, with a topology report and a preview render, and
  bring the model into Studio.
- Manage Studio windows: open a place, and close older windows of it so they do not pile up.

Every tool call follows the thread's usual approval rules. Agents load Harp's Roblox skills
(design, building, scripting, networking, data and more) when a task needs them.

## Limit what the agent does in a thread

The **Agent** menu next to the composer, and **Studio places** in the thread details panel, set two
limits for one thread:

- **Playtests:** switch off `Let the agent start playtests` and the agent cannot start a solo or
  multiplayer test. Stopping or ending a test that is already running still works, so a stuck test
  can be cleaned up. Running Luau that starts a playtest is refused too, but that check is a guard,
  not a sandbox: to rule it out completely, turn off running Luau in the Studio panel.
- **Studio places:** switch off a place and the agent no longer sees it. It is left out of the
  list of connected places, and a call that names it is refused with a message that says why.
  A place you turn off stays listed, dimmed, when it is not connected, so you can turn it back on.

New threads start with every place on and playtests allowed. Forks and threads the agent delegates
to keep the limits of the thread they came from. The limits belong to the thread: they do not change
the Studio panel's own switches, which stay the outer limit, and they are separate from the
**Automatic playtests** setting, which only tells the agent when it may test on its own. A thread
with any limit does not get Roblox's own Studio MCP, which would bypass them.

## Blender

Harp finds Blender in its usual install folders and Steam libraries; otherwise set **Blender
executable**. Each Blender job runs a Python script with your permissions, so approve it as you
would any script. Models brought in from Blender live in the current Studio session: publish them as
assets before a saved or published place relies on them.

**Blender MCP** connects a separate MCP server that drives your open Blender, such as MCP for
Blender.

## Roblox's own MCP

**Roblox's own Studio MCP** as the Studio connection uses only the MCP server Roblox Studio ships.

## Publishing assets

Agents never publish on their own. When something needs publishing, such as a model from Blender, an
image or an animation, the agent asks whether to publish it through the Roblox Assistant (it then
shows on your profile as published by the Assistant) or whether you prefer to publish it yourself and
name it your way.

## AI model generation

**Also connect Roblox's own MCP** (on by default) gives agents the Roblox Assistant's tools: AI model,
mesh, texture and material generation, and publishing. Agents prefer Blender jobs and good Creator
Store assets, and use AI generation when you ask for it or nothing better fits.
