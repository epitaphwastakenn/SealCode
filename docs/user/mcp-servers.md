# MCP servers

Connect an MCP server once in **Settings → Connections** and every agent in this environment can
use its tools, instead of configuring the same server separately in each provider. Harp runs
or connects to the server itself and shares one connection between all threads.

Add a server by choosing its transport:

- **stdio** runs a local command. Give it the command, arguments, working directory, and any
  environment variables.
- **Streamable HTTP** and **SSE** connect to a URL. Add headers such as an authorization token.

Mark a variable or header as sensitive to keep its value out of `settings.json`; it is stored in
the server's secret store and never sent back to the client. The status beside each server shows
whether it is connecting, ready, or failing. **Reconnect** restarts a stdio process or reopens a
remote connection without touching the other servers. New tools appear in new sessions; agents whose
MCP client handles tool list updates also see them in a running one.

Once Harp has seen a stdio server's tools, it lists them without running the server. The server
starts when an agent first calls one of its tools and stops after 30 minutes without a call, so a
server that keeps state between calls loses it after that quiet period. Its tools stay listed, and
**Reconnect** starts it right away and reads its tools again.

Agents see the tools as `mcp__<server id>__<tool name>` under a `sealcode-global` MCP server. Tool
calls follow the thread's usual approval rules: Harp does not pre-approve them. Two servers
whose names normalize to the same tool name both go into an error state until one is renamed.

Roblox Studio and Blender servers are set up under **Roblox Studio** instead; see
[Roblox Studio](roblox-studio.md). A server you add here with the same id replaces Harp's.

A server that stops or drops its connection is reconnected automatically a few times before it is
left in its error.

Pi and the newer OpenCode runtime do not receive these tools.
