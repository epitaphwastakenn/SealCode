# Roqer host

SealCode runs Roqer's Roblox Studio harness as this separate program. It is an MCP server over
stdio that SealCode manages like any other MCP server (`robloxstudio`), and it:

- supervises Roqer's Studio bridge (`bridge/dist/index.mjs`) as a child, restarting it with
  backoff and installing the matching Studio plugin on every start;
- proxies the bridge's tools with the checks Roqer's desktop applies (no script `Source` written
  from Luau, read-back of every script write, skill templates as script sources, empty scripts
  need no revision, bounded results);
- adds Roqer's own tools: `load_skill`, `resolve_icon`, `upload_assets`, `blender` (when a Blender
  executable is configured) and `get_bridge_status`.

The source here imports Roqer's desktop runtime modules from a Roqer checkout, so it is not part
of SealCode's workspace, lint or typecheck. `sync.ts` (`vp run sync:roqer -- --roqer <checkout>`) builds it, together with the
bridge, the Studio plugin and the agent bundle, into `apps/server/resources/roqer`.

SealCode's own changes to Roqer's sources (for example the Blender topology inspection and the
`roblox-building` topology rules) live in `patches/` as `git diff` output against the commit in
`manifest.json`. `sync.ts` applies them to the checkout before building; to change one, edit the
patched checkout and regenerate the patch with `git diff` there.

Roqer is © S4US and contributors, licensed under the GNU Affero General Public License v3 or
later. This host and the files built from Roqer are distributed under the same licence; see
`apps/server/resources/roqer/LICENSE` and `NOTICE.md`.
