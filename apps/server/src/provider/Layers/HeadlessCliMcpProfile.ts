// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  makeSealCodeMcpEndpoints,
  type McpProviderSessionConfig,
} from "../../mcp/McpProviderSession.ts";

import type { HeadlessCliProtocol } from "./HeadlessCliAdapter.ts";

const PROFILE_ROOT_NAME = "sealcode-headless-mcp";
const STALE_PROFILE_AGE_MS = 24 * 60 * 60 * 1000;

const AUTH_FILES_BY_PROTOCOL: Readonly<Record<"commandcode", ReadonlyArray<string>>> = {
  commandcode: [".commandcode/auth.json"],
};

export interface HeadlessCliMcpProfile {
  readonly root: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly cleanup: () => Promise<void>;
}

const makeConfig = (session: McpProviderSessionConfig) => {
  const endpoints = makeSealCodeMcpEndpoints(session);
  return {
    mcpServers: Object.fromEntries(
      endpoints.map((endpoint) => [
        endpoint.name,
        {
          transport: "http",
          url: endpoint.url,
          headers: { Authorization: endpoint.authorizationHeader },
        },
      ]),
    ),
  };
};

const removeStaleProfiles = async (root: string): Promise<void> => {
  await NodeFSP.mkdir(root, { recursive: true });
  const entries = await NodeFSP.readdir(root, { withFileTypes: true });
  const cutoff = Date.now() - STALE_PROFILE_AGE_MS;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profilePath = NodePath.join(root, entry.name);
    const stats = await NodeFSP.stat(profilePath);
    if (stats.mtimeMs < cutoff) {
      await NodeFSP.rm(profilePath, { recursive: true, force: true });
    }
  }
};

const copyIfPresent = async (source: string, target: string): Promise<void> => {
  try {
    await NodeFSP.copyFile(source, target);
  } catch (cause) {
    if (cause !== null && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
      return;
    }
    throw cause;
  }
};

export async function createHeadlessCliMcpProfile(
  protocol: HeadlessCliProtocol,
  session: McpProviderSessionConfig,
  baseEnvironment: NodeJS.ProcessEnv,
): Promise<HeadlessCliMcpProfile> {
  const rootDirectory = NodePath.join(NodeOS.tmpdir(), PROFILE_ROOT_NAME);
  await removeStaleProfiles(rootDirectory);
  const root = await NodeFSP.mkdtemp(NodePath.join(rootDirectory, `${protocol}-`));

  const baseHome = baseEnvironment.USERPROFILE ?? baseEnvironment.HOME ?? NodeOS.homedir();
  for (const relativePath of AUTH_FILES_BY_PROTOCOL[protocol]) {
    const target = NodePath.join(root, relativePath);
    await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
    await copyIfPresent(NodePath.join(baseHome, relativePath), target);
  }

  const configPath = NodePath.join(root, ".commandcode", "mcp.json");
  await NodeFSP.mkdir(NodePath.dirname(configPath), { recursive: true });
  await NodeFSP.writeFile(configPath, `${JSON.stringify(makeConfig(session), null, 2)}\n`, "utf8");

  const environment: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    HOME: root,
    USERPROFILE: root,
  };
  return {
    root,
    environment,
    cleanup: () => NodeFSP.rm(root, { recursive: true, force: true }),
  };
}
