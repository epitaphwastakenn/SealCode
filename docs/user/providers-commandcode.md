# CommandCode

Install the [CommandCode CLI](https://commandcode.ai/docs) on the machine hosting your
environment, then run `commandcode login` as the account that runs Harp:

```sh
npm install -g command-code
commandcode login
```

CommandCode is enabled by default. Open **Settings → Providers** in the web or desktop app,
select the environment, and set **Binary path** if `commandcode` is not on the host's `PATH`.
Refresh provider status after installation or login, then select CommandCode in a thread's
model picker.

Provider status does not check your login. If you are signed out, messages fail until you run
`commandcode login` on the host.

## How it runs

Harp starts one `commandcode --print` process for each message and resumes the same
CommandCode session on the next one, so CommandCode keeps its own conversation history under
`~/.commandcode`. Nothing stays running between messages. Stop ends the process; if you stop
the first message of a thread before it finishes, CommandCode has no session to resume and the
next message starts a fresh one.

## Models

Models come from `commandcode --list-models` on the selected host, with display names and
reasoning levels read from the CLI's bundled catalog. Reasoning levels appear only for models
that have them. Harp keeps the list for a CLI version for a day. After CommandCode changes its
catalog, refresh provider status to read it again. Add a model the list omits under **Custom
models** in the instance settings.

Usage limits appear when the host's login is signed in to a subscription. Harp reads them with
the same credential CommandCode saves in `~/.commandcode/auth.json`.

## Permissions and limitations

CommandCode's print mode cannot ask for approval, so it offers two
[permission modes](./permission-modes.md):

- **Supervised** lets CommandCode read and search the workspace. It refuses file edits and
  commands instead of asking.
- **Full access** allows edits and commands.

**Auto-accept edits** and **Auto** are not offered, because print mode refuses edits and commands
unless **Full access** is on. A thread already set to either runs in **Supervised**.

CommandCode does not offer approval requests, plan cards, or tools from Harp. Switching
providers and forking pass conversation context as a handoff, and conversation rewind is
unavailable. Text generation for thread titles and commit messages is not available on
CommandCode; choose another provider for those.

Updates run from **Settings → Providers** only when Harp can tell which installer owns the
CLI, such as a global npm install. Otherwise update CommandCode on the host.

To stop using CommandCode in an environment, disable it in **Settings → Providers**. This keeps
the host's login, session history, and workspace files.
