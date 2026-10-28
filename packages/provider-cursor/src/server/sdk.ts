// @effect-diagnostics nodeBuiltinImport:off -- The SDK must load from disk beside its Webpack chunks.
import * as NodeModule from "node:module";

// createRequire loads the disk-backed SDK and adjacent chunks even from a Node SEA executable.
const requireCursorSdk = NodeModule.createRequire(import.meta.url);

function readCursorSdk() {
  const sdk = requireCursorSdk("@cursor/sdk") as typeof import("@cursor/sdk");
  const { SqliteLocalAgentStore } = requireCursorSdk(
    "@cursor/sdk/sqlite",
  ) as typeof import("@cursor/sdk/sqlite");
  return {
    Agent: sdk.Agent,
    AuthenticationError: sdk.AuthenticationError,
    ConfigurationError: sdk.ConfigurationError,
    createAgentPlatform: sdk.createAgentPlatform,
    Cursor: sdk.Cursor,
    CursorSdkError: sdk.CursorSdkError,
    InMemoryCredentialStore: sdk.InMemoryCredentialStore,
    SqliteLocalAgentStore,
  };
}

let cursorSdk: ReturnType<typeof readCursorSdk> | undefined;

/** The SDK, with its protobuf and Connect stacks, costs about 40 MB; only a Cursor user pays it. */
export function loadCursorSdk() {
  cursorSdk ??= readCursorSdk();
  return cursorSdk;
}

/** An SDK error cannot exist before the SDK loads, so these never load it. */
export const isCursorConfigurationError = (
  value: unknown,
): value is InstanceType<ReturnType<typeof readCursorSdk>["ConfigurationError"]> =>
  cursorSdk !== undefined && value instanceof cursorSdk.ConfigurationError;

export const isCursorAuthenticationError = (
  value: unknown,
): value is InstanceType<ReturnType<typeof readCursorSdk>["AuthenticationError"]> =>
  cursorSdk !== undefined && value instanceof cursorSdk.AuthenticationError;

export const isCursorSdkError = (
  value: unknown,
): value is InstanceType<ReturnType<typeof readCursorSdk>["CursorSdkError"]> =>
  cursorSdk !== undefined && value instanceof cursorSdk.CursorSdkError;
