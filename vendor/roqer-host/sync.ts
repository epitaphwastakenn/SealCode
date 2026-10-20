#!/usr/bin/env node
/**
 * Rebuilds `apps/server/resources/roqer` from a Roqer checkout (github.com/S4US/Roqer):
 * the Studio bridge bundled into one file with its tool catalog, the Studio plugin, the agent
 * skill pack with SealCode's adapted instructions, and the host in `vendor/roqer-host`.
 *
 *   node vendor/roqer-host/sync.ts --roqer <checkout> [--skip-build]
 *
 * The checkout needs `npm ci` once; without `--skip-build` this runs Roqer's own bridge and
 * plugin builds (the plugin build fetches LibMP from Roblox's GitHub releases). The patches in
 * `vendor/roqer-host/patches` are applied to the checkout first.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);
const outputRoot = NodePath.join(repoRoot, "apps/server/resources/roqer");
const hostSource = NodePath.join(repoRoot, "vendor/roqer-host");

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const roqerArgument = argument("--roqer");
if (roqerArgument === undefined) {
  console.error("usage: node vendor/roqer-host/sync.ts --roqer <Roqer checkout> [--skip-build]");
  process.exit(2);
}
const roqer = NodePath.resolve(roqerArgument);
const skipBuild = process.argv.includes("--skip-build");
const isWindows = NodeOS.platform() === "win32";

function npm(script: string) {
  console.log(`[sync-roqer] npm run ${script}`);
  NodeChildProcess.execFileSync("npm", ["run", script], {
    cwd: roqer,
    stdio: "inherit",
    shell: isWindows,
  });
}

// Run through Node rather than the .cmd shim, which would need a shell to parse the banner.
const esbuild = NodePath.join(roqer, "node_modules/esbuild/bin/esbuild");
if (!NodeFS.existsSync(esbuild)) {
  console.error(`[sync-roqer] ${esbuild} is missing: run npm ci in the Roqer checkout first.`);
  process.exit(1);
}

// SealCode's own changes to Roqer's sources, applied in the checkout so the next sync from a
// fresh checkout keeps them. A patch already applied (it reverses cleanly) is left as it is.
const patchesRoot = NodePath.join(hostSource, "patches");
const patches = NodeFS.readdirSync(patchesRoot)
  .filter((file) => file.endsWith(".patch"))
  .sort();
for (const name of patches) {
  const patch = NodePath.join(patchesRoot, name);
  const git = (...args: string[]) =>
    NodeChildProcess.spawnSync("git", ["apply", ...args, patch], { cwd: roqer, encoding: "utf8" });
  if (git("--check", "--reverse").status === 0) {
    console.log(`[sync-roqer] patch ${name} already applied`);
    continue;
  }
  const applied = git();
  if (applied.status !== 0) {
    console.error(`[sync-roqer] patch ${name} does not apply to this checkout:\n${applied.stderr}`);
    process.exit(1);
  }
  console.log(`[sync-roqer] applied patch ${name}`);
}

if (!skipBuild) {
  npm("build");
  // `--build-only`: the build must not install the plugin into this machine's Studio.
  npm("build:plugin:artifact");
}

const rootPackage = JSON.parse(
  NodeFS.readFileSync(NodePath.join(roqer, "package.json"), "utf8"),
) as {
  version: string;
};
const commit = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: roqer,
  encoding: "utf8",
}).trim();

NodeFS.rmSync(outputRoot, { recursive: true, force: true });
NodeFS.mkdirSync(outputRoot, { recursive: true });

// CommonJS dependencies inside an ESM bundle still call require for Node built-ins.
const requireBanner =
  "import { createRequire as __sealcodeCreateRequire } from 'node:module'; const require = __sealcodeCreateRequire(import.meta.url);";

function bundle(
  entry: string,
  outfile: string,
  extra: ReadonlyArray<string> = [],
  env: NodeJS.ProcessEnv = process.env,
) {
  console.log(`[sync-roqer] esbuild ${NodePath.relative(repoRoot, entry)}`);
  NodeChildProcess.execFileSync(
    process.execPath,
    [
      esbuild,
      entry,
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--target=node20",
      "--legal-comments=none",
      `--banner:js=${requireBanner}`,
      `--outfile=${outfile}`,
      "--log-level=warning",
      ...extra,
    ],
    { cwd: roqer, stdio: "inherit", env },
  );
}

// Bridge: Roqer's own build keeps its npm dependencies external; one file installs faster.
const bridgeRoot = NodePath.join(outputRoot, "bridge");
const bridgeDist = NodePath.join(roqer, "packages/robloxstudio-mcp/dist");
bundle(NodePath.join(bridgeDist, "index.js"), NodePath.join(bridgeRoot, "dist/index.mjs"));
NodeFS.cpSync(NodePath.join(bridgeDist, "assets"), NodePath.join(bridgeRoot, "dist/assets"), {
  recursive: true,
});
NodeFS.writeFileSync(
  NodePath.join(bridgeRoot, "package.json"),
  `${JSON.stringify({ name: "@roqer/mcp", version: rootPackage.version, type: "module", private: true }, null, 2)}\n`,
);

// Plugin.
NodeFS.mkdirSync(NodePath.join(outputRoot, "plugin"), { recursive: true });
NodeFS.copyFileSync(
  NodePath.join(roqer, "studio-plugin/MCPPlugin.rbxmx"),
  NodePath.join(outputRoot, "plugin/MCPPlugin.rbxmx"),
);

// Agent bundle and SealCode's adapted instructions with the skill catalog.
const agentSource = NodePath.join(roqer, "apps/desktop/agent");
const agentRoot = NodePath.join(outputRoot, "agent");
NodeFS.cpSync(NodePath.join(agentSource, "skills"), NodePath.join(agentRoot, "skills"), {
  recursive: true,
});
for (const file of ["manifest.json", "PROVENANCE.md", "system.md", "developer.md"]) {
  NodeFS.copyFileSync(NodePath.join(agentSource, file), NodePath.join(agentRoot, file));
}

function frontmatterField(source: string, field: string): string {
  const match = source.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  if (!match?.[1]) throw new Error(`SKILL.md is missing ${field}`);
  const value = match[1].trim();
  if (value.startsWith('"')) return JSON.parse(value) as string;
  if (value.startsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

const catalog = NodeFS.readdirSync(NodePath.join(agentRoot, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((name) => {
    const source = NodeFS.readFileSync(
      NodePath.join(agentRoot, "skills", name, "SKILL.md"),
      "utf8",
    );
    return `- \`${frontmatterField(source, "name")}\`: ${frontmatterField(source, "description")}`;
  });
const template = NodeFS.readFileSync(
  NodePath.join(hostSource, "agent/sealcode-instructions.md"),
  "utf8",
);
NodeFS.writeFileSync(
  NodePath.join(agentRoot, "sealcode-instructions.md"),
  template.replace(
    "{{SKILL_CATALOG}}",
    [
      "## Available skills",
      "",
      "Load a matching entrypoint with `load_skill`.",
      "",
      ...catalog,
    ].join("\n"),
  ),
);

// Host.
// The host's MCP SDK is the server's own, which pnpm keeps under apps/server.
bundle(
  NodePath.join(hostSource, "src/main.ts"),
  NodePath.join(outputRoot, "host/main.mjs"),
  [`--alias:@roqer=${roqer}`, "--tsconfig-raw={}"],
  { ...process.env, NODE_PATH: NodePath.join(repoRoot, "apps/server/node_modules") },
);

// The bridge's tool catalog, so the host can list tools before the bridge has started.
async function dumpBridgeTools(): Promise<unknown[]> {
  const child = NodeChildProcess.spawn(
    process.execPath,
    [NodePath.join(bridgeRoot, "dist/index.mjs")],
    {
      // A private port so a bridge already serving Studio on this machine is left alone.
      env: {
        ...process.env,
        ROBLOX_STUDIO_PORT: String(40_000 + Math.floor(Math.random() * 20_000)),
      },
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    },
  );
  const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return await new Promise<unknown[]>((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error("the bridge did not list its tools")), 30_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffered += chunk;
      let newline: number;
      while ((newline = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line.length === 0) continue;
        const message = JSON.parse(line) as { id?: number; result?: { tools?: unknown[] } };
        if (message.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (message.id === 2) {
          clearTimeout(timer);
          child.stdin.end();
          child.kill();
          resolve(message.result?.tools ?? []);
        }
      }
    });
    child.on("error", reject);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "sync-roqer", version: "1.0.0" },
      },
    });
  });
}

const tools = await dumpBridgeTools();
if (tools.length === 0) throw new Error("the bridge listed no tools");
NodeFS.writeFileSync(NodePath.join(bridgeRoot, "tools.json"), `${JSON.stringify(tools)}\n`);

for (const file of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) {
  NodeFS.copyFileSync(NodePath.join(roqer, file), NodePath.join(outputRoot, file));
}

const pluginHash = NodeCrypto.createHash("sha256")
  .update(NodeFS.readFileSync(NodePath.join(outputRoot, "plugin/MCPPlugin.rbxmx")))
  .digest("hex");
NodeFS.writeFileSync(
  NodePath.join(outputRoot, "manifest.json"),
  `${JSON.stringify(
    {
      source: "https://github.com/S4US/Roqer",
      commit,
      patches,
      version: rootPackage.version,
      bridgeTools: tools.length,
      skills: catalog.length,
      pluginSha256: pluginHash,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `[sync-roqer] Roqer ${rootPackage.version} (${commit.slice(0, 7)}): ${tools.length} bridge tools, ${catalog.length} skills -> ${NodePath.relative(repoRoot, outputRoot)}`,
);
