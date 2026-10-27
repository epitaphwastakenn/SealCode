import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  /**
   * The user's configured MCP servers, proxied under the same credential. Adapters attach it as
   * a second server named `sealcode-global` beside `t3-code`.
   */
  readonly globalEndpoint?: string;
  /**
   * Present only when the user turned computer use on and this server runs
   * beside the desktop app; adapters attach it as a server named `computer-use`.
   */
  readonly computerUseEndpoint?: string;
  readonly authorizationHeader: string;
  /** Omit preview_* instructions when the user withholds agent browser access. */
  readonly browserToolsAvailable: boolean;
  readonly capabilities?: ReadonlySet<string>;
}
