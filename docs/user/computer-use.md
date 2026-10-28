# Computer use

Agents in Claude threads can see this computer's screen and use its mouse and keyboard, for tasks
in desktop apps that have no other integration. It needs the Harp desktop app on Windows, with
the agent running on the backend that app started. Turn it on in **Settings → Connections → Uso do
computador**; it is off by default and applies to agent sessions that start afterwards.

## Start

Ask for something in a desktop app, such as "open Paint and write Oi". Before it touches an app,
the agent asks for it, and Harp shows a dialog listing each app and what the agent may do
there:

- **Browsers** are read-only: the agent can see them in screenshots but not click or type. Web pages
  go through the browser tools instead.
- **Terminals and IDEs** take plain left clicks and scrolling only. Shell work goes through the
  agent's own command tool.
- **Everything else** is fully usable.

Access lasts for the thread while Harp runs. The agent asks again for any app it did not get.

## While the agent works

The Harp window shrinks into a small panel in the corner of the screen, and windows of apps the
agent was not given are minimized. Neither Harp nor its panel appears in the agent's
screenshots. Press **Esc** or **Parar** on the panel to stop the turn.

When the turn ends or is stopped, the Harp window comes back. The minimized windows come back
too, unless **Reexibir aplicativos quando o agente terminar** is off.

Apps running as administrator do not accept the agent's input.
