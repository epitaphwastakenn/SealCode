import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { JSONRPCMessage, Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Roqer's supervision rules for the Studio bridge (desktop `mcp-server-process.ts`), applied to a
 * bridge this host talks to over stdio. A bridge whose HTTP port is already taken by another one
 * (Roqer's app, Claude Code's own copy) becomes a follower that proxies to it, so a stdio child
 * always works and nothing has to be adopted here.
 */
export const STARTUP_TIMEOUT_MS = 20_000;
export const MAX_START_ATTEMPTS = 4;
export const RESTART_BACKOFF_MS: readonly number[] = [500, 1_500, 4_000];
export const HEALTHY_RUN_MS = 60_000;
const STOP_GRACE_MS = 4_000;
const KEPT_LOG_LINES = 40;
const MAX_LOG_LINE_CHARACTERS = 2_000;

/** Written by the bridge's `--auto-install-plugin`; see `packages/robloxstudio-mcp/src/index.ts`. */
export const STUDIO_RESTART_MARKER = "[install-plugin] studio-restart-required";
export const PLUGIN_PROBLEM_MARKER = "[install-plugin] plugin-install-failed:";
/** Written by the bridge's `/ready` when a Studio still runs an older plugin. */
export const PLUGIN_REJECTED_MARKER = "[plugin-version-rejected]";

export type BridgeState =
  | { readonly kind: "starting" }
  | { readonly kind: "running"; readonly since: number }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "stopped" };

export type BridgeOptions = {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly onLog?: (line: string) => void;
  readonly onToolsChanged?: () => void;
};

/** An MCP transport over a child this host spawned itself, so it can be started hidden on Windows. */
class ChildProcessTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly buffer = new ReadBuffer();
  private closed = false;

  constructor(readonly child: ChildProcessWithoutNullStreams) {}

  async start(): Promise<void> {
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer.append(chunk);
      for (;;) {
        let message: JSONRPCMessage | null;
        try {
          message = this.buffer.readMessage();
        } catch (error) {
          this.onerror?.(error instanceof Error ? error : new Error(String(error)));
          continue;
        }
        if (message === null) break;
        this.onmessage?.(message);
      }
    });
    this.child.on("error", (error) => this.onerror?.(error));
    this.child.on("close", () => this.finish());
    this.child.stdin.on("error", (error) => this.onerror?.(error));
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error("The Studio bridge is not running."));
        return;
      }
      this.child.stdin.write(serializeMessage(message), (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    // Closing stdin is the bridge's own shutdown path; the kill is the fallback.
    try {
      this.child.stdin.end();
    } catch {
      // Already torn down.
    }
    const exited = new Promise<void>((resolve) => this.child.once("close", () => resolve()));
    const timer = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), STOP_GRACE_MS).unref(),
    );
    if ((await Promise.race([exited, timer])) === "timeout") {
      try {
        this.child.kill();
      } catch {
        // Already gone.
      }
    }
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer.clear();
    this.onclose?.();
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class BridgeSupervisor {
  private client: Client | undefined;
  private current: BridgeState = { kind: "stopped" };
  private starting: Promise<Client> | undefined;
  private stopping = false;
  private attempts = 0;
  private restarts = 0;
  private readonly log: string[] = [];
  private liveTools: readonly Tool[] | undefined;
  /** Sticky: a Studio opened before this plugin install keeps the old plugin until it restarts. */
  private pluginUpdated = false;
  private pluginProblem: string | undefined;
  private pluginRejected: string | undefined;

  constructor(private readonly options: BridgeOptions) {}

  get state(): BridgeState {
    return this.current;
  }

  get tools(): readonly Tool[] | undefined {
    return this.liveTools;
  }

  status() {
    return {
      state: this.current.kind,
      ...(this.current.kind === "failed" ? { error: this.current.message } : {}),
      restarts: this.restarts,
      pluginUpdated: this.pluginUpdated,
      ...(this.pluginProblem === undefined ? {} : { pluginProblem: this.pluginProblem }),
      ...(this.pluginRejected === undefined ? {} : { pluginRejected: this.pluginRejected }),
      recentLog: this.log.slice(-12),
    };
  }

  /** The connected bridge, starting or restarting it when needed. Rejects with a readable reason. */
  async ready(): Promise<Client> {
    if (this.client !== undefined && this.current.kind === "running") return this.client;
    if (this.starting !== undefined) return this.starting;
    // A bridge that gave up after its start budget gets a fresh budget when something needs it,
    // as Roqer's `recover` does: the failure may have been a port held for a moment.
    this.attempts = 0;
    return this.startSupervised();
  }

  start(): void {
    void this.ready().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const client = this.client;
    this.client = undefined;
    this.current = { kind: "stopped" };
    await client?.close().catch(() => undefined);
  }

  private startSupervised(): Promise<Client> {
    this.stopping = false;
    this.current = { kind: "starting" };
    const starting = this.supervise().finally(() => {
      if (this.starting === starting) this.starting = undefined;
    });
    this.starting = starting;
    return starting;
  }

  private async supervise(): Promise<Client> {
    for (;;) {
      if (this.stopping) throw new Error("The Studio bridge was stopped.");
      try {
        const client = await this.runOnce();
        this.client = client;
        this.current = { kind: "running", since: Date.now() };
        this.note("bridge running");
        return client;
      } catch (error) {
        this.attempts += 1;
        const reason = describe(error);
        this.note(`bridge start failed: ${reason}`);
        if (this.attempts >= MAX_START_ATTEMPTS) {
          const message = `The Studio bridge could not be started after ${MAX_START_ATTEMPTS} attempts. ${reason}`;
          this.current = { kind: "failed", message };
          throw new Error(message);
        }
        await sleep(
          RESTART_BACKOFF_MS[Math.min(this.attempts - 1, RESTART_BACKOFF_MS.length - 1)] ?? 4_000,
        );
      }
    }
  }

  private async runOnce(): Promise<Client> {
    const child = spawn(this.options.command, [...this.options.args], {
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.record(chunk));
    const transport = new ChildProcessTransport(child);
    const client = new Client(
      { name: "SealCode Roqer host", version: "1.0.0" },
      { capabilities: {} },
    );
    let connected = false;
    transport.onclose = () => {
      if (!connected) return;
      this.note(`bridge exited (code ${child.exitCode ?? "unknown"})`);
      if (this.client === client) this.onUnexpectedExit();
    };
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("It did not answer in time.")), STARTUP_TIMEOUT_MS).unref(),
    );
    try {
      await Promise.race([client.connect(transport), timeout]);
      const listed = await client.listTools(undefined, { timeout: STARTUP_TIMEOUT_MS });
      const previous = this.liveTools?.map((tool) => tool.name).join("\u0000");
      this.liveTools = listed.tools;
      if (
        previous !== undefined &&
        previous !== listed.tools.map((tool) => tool.name).join("\u0000")
      ) {
        this.options.onToolsChanged?.();
      }
      connected = true;
      return client;
    } catch (error) {
      await client.close().catch(() => undefined);
      const exited =
        child.exitCode === null ? "" : ` The bridge exited with code ${child.exitCode}.`;
      throw new Error(`${describe(error)}${exited}${this.lastLines()}`);
    }
  }

  private onUnexpectedExit(): void {
    if (this.stopping) return;
    const since = this.current.kind === "running" ? this.current.since : Date.now();
    this.client = undefined;
    // A crash after a long healthy run is not evidence of a broken install.
    if (Date.now() - since >= HEALTHY_RUN_MS) this.attempts = 0;
    this.restarts += 1;
    this.note("the bridge stopped unexpectedly; restarting it");
    void this.startSupervised().catch(() => undefined);
  }

  private lastLines(): string {
    const tail = this.log.filter((line) => !line.startsWith("[roqer-host]")).slice(-3);
    return tail.length === 0 ? "" : ` Last output: ${tail.join(" | ")}`;
  }

  private note(line: string): void {
    this.record(`[roqer-host] ${line}`);
  }

  private record(chunk: string): void {
    for (const raw of chunk.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0) continue;
      if (line.includes(STUDIO_RESTART_MARKER)) {
        this.pluginUpdated = true;
        this.pluginProblem = undefined;
      }
      const problem = line.indexOf(PLUGIN_PROBLEM_MARKER);
      if (problem !== -1 && !this.pluginUpdated) {
        this.pluginProblem =
          line.slice(problem + PLUGIN_PROBLEM_MARKER.length).trim() ||
          "The Studio plugin could not be installed.";
      }
      if (line.includes(PLUGIN_REJECTED_MARKER)) {
        this.pluginRejected = line
          .slice(line.indexOf(PLUGIN_REJECTED_MARKER) + PLUGIN_REJECTED_MARKER.length)
          .trim();
      }
      const kept = line.slice(0, MAX_LOG_LINE_CHARACTERS);
      this.log.push(kept);
      this.options.onLog?.(kept);
    }
    if (this.log.length > KEPT_LOG_LINES) this.log.splice(0, this.log.length - KEPT_LOG_LINES);
  }

  /** A Studio that connected with the matching plugin has replaced whatever was rejected before. */
  clearRejection(): void {
    this.pluginRejected = undefined;
  }
}
