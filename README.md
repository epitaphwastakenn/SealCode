# SealCode

SealCode is a local-first desktop and web control surface for coding-agent harnesses. It keeps projects, tools, diffs, terminals, usage, and multiple provider sessions in one visual thread.

The current restored harness supports Codex, Antigravity, Claude Code, Cursor, Grok Build, OpenCode, and CommandCode when their runtimes are installed and authenticated on your computer.

## "Wait, what are you selling me?"

Nothing. We built SealCode because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> SealCode currently supports Codex, Antigravity, Claude, Cursor, Grok Build, OpenCode, and CommandCode. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Antigravity: use **Settings > Providers** to install the official ACP runtime and sign in with Google, or use the Python SDK runtime (`google-antigravity==0.1.12` with `GEMINI_API_KEY` or Vertex AI ADC)
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - CommandCode: install its native `commandcode` CLI and authenticate it

### Run from source

SealCode currently ships from this fork. Install Node.js 24.13+ and pnpm, then run:

```bash
pnpm install
pnpm dev
```

This launches the local backend and web interface.

### Desktop app

Windows installer artifacts are published from [SealCode releases](https://github.com/epitaphwastakenn/SealCode/releases). To build the x64 NSIS installer locally:

```bash
pnpm dist:desktop:win:x64
```

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- Linux: [run SealCode as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

SealCode uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
