# Install SealCode

SealCode is a web and desktop GUI for running coding agents on your machine.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10` on the machine that runs the SealCode server.

At least one provider CLI, installed and authenticated. See [Providers](#providers) below.

## Run From Source

```bash
pnpm install
pnpm dev
```

This starts the SealCode server on your machine and opens the local web app.

## Desktop App

Download the latest build from
[SealCode Releases](https://github.com/epitaphwastakenn/SealCode/releases).

To build the Windows x64 NSIS installer locally:

```bash
pnpm dist:desktop:win:x64
```

## Providers

SealCode drives provider CLIs; it does not ship them. Install the CLI for each provider you want
to use, then authenticate it.

| Provider   | CLI                                                   | Default binary | Log in with           |
| ---------- | ----------------------------------------------------- | -------------- | --------------------- |
| Codex      | [Codex CLI](https://developers.openai.com/codex/cli)  | `codex`        | `codex login`         |
| Claude     | [Claude Code](https://claude.com/product/claude-code) | `claude`       | `claude auth login`   |
| Cursor     | [Cursor CLI](https://cursor.com/cli)                  | `cursor-agent` | `agent login`         |
| Grok Build | [Grok Build CLI](https://x.ai/cli)                    | `grok`         | `grok login`          |
| OpenCode   | [OpenCode](https://opencode.ai)                       | `opencode`     | `opencode auth login` |

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
SealCode looks for, but authenticate with `agent login`, not `cursor-agent login`.

Run the login command on the machine running the SealCode server, not on the device you browse
from.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started SealCode.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
SealCode. You can install SealCode, open it, and add providers afterwards. A provider that is not
authenticated shows its status in **Settings** and fails at session start with the login command
to run.

For multi-account setups, see [Codex](./providers-codex.md) and [Claude](./providers-claude.md).

## Next Steps

- [Permission modes](./permission-modes.md): how much SealCode asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop
- [Keeping SealCode in sync](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux background service
