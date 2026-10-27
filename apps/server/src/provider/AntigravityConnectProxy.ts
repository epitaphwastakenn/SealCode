// @effect-diagnostics nodeBuiltinImport:off - the proxy relays raw CONNECT tunnels and pins each dial to one address family.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

// The agent's bundled Python has no IPv4 fallback race, so broken IPv6 stalls each Google call
// for minutes. It sends every Google request through HTTPS_PROXY, so the agent always goes
// through this loopback proxy, which dials IPv4 first and IPv6 only when IPv4 fails.
const IPV4_CONNECT_TIMEOUT_MS = 3_000;
const IPV6_CONNECT_TIMEOUT_MS = 10_000;
const USER_PROXY_KEYS = new Set(["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "GRPC_PROXY"]);
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];
const GOOGLE_DOMAINS = ["google.com", "googleapis.com"];

interface DialTimeouts {
  readonly ipv4Ms: number;
  readonly ipv6Ms: number;
}

const dialFamily = (host: string, port: number, family: 4 | 6, timeoutMs: number) =>
  new Promise<NodeNet.Socket>((resolve, reject) => {
    const socket = NodeNet.connect({ host, port, family, autoSelectFamily: false });
    // The idle timeout covers the connect; tunnels themselves may sit idle for long.
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error(`IPv${family} connect timed out`));
    });
    socket.once("connect", () => {
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("error", (cause) => {
      socket.destroy();
      reject(cause);
    });
  });

/** IPv4 first; IPv6 when IPv4 has no address, is refused, or does not connect in time. */
const dialPreferringIpv4 = async (
  host: string,
  port: number,
  timeouts: DialTimeouts = { ipv4Ms: IPV4_CONNECT_TIMEOUT_MS, ipv6Ms: IPV6_CONNECT_TIMEOUT_MS },
) => {
  const literal = NodeNet.isIP(host);
  if (literal === 4) return dialFamily(host, port, 4, timeouts.ipv4Ms);
  if (literal === 6) return dialFamily(host, port, 6, timeouts.ipv6Ms);
  try {
    return await dialFamily(host, port, 4, timeouts.ipv4Ms);
  } catch {
    return await dialFamily(host, port, 6, timeouts.ipv6Ms);
  }
};

const hasUserProxy = (environment: NodeJS.ProcessEnv) =>
  Object.entries(environment).some(
    ([key, value]) => USER_PROXY_KEYS.has(key.toUpperCase()) && Boolean(value?.trim()),
  );

/** Python's NO_PROXY matching: `*`, or a host suffix with an optional leading `.` or `*.`. */
const bypassesGoogle = (entry: string) => {
  const host = entry
    .trim()
    .toLowerCase()
    .replace(/^\*?\./, "")
    .replace(/:\d+$/, "");
  return (
    host === "*" ||
    GOOGLE_DOMAINS.some(
      (domain) => host === domain || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`),
    )
  );
};

/**
 * Leaves a proxy the user configured alone; it already owns how the agent connects. Inherited
 * NO_PROXY entries that would send Google traffic around this proxy are dropped.
 */
export function withConnectProxyEnvironment(
  environment: NodeJS.ProcessEnv,
  proxyUrl: string,
): NodeJS.ProcessEnv {
  if (hasUserProxy(environment)) return environment;
  const next: NodeJS.ProcessEnv = {};
  const noProxy = new Set<string>();
  for (const [key, value] of Object.entries(environment)) {
    if (key.toUpperCase() !== "NO_PROXY") {
      next[key] = value;
      continue;
    }
    for (const entry of value?.split(",") ?? []) {
      if (entry.trim() && !bypassesGoogle(entry)) noProxy.add(entry.trim());
    }
  }
  // The agent reaches its own harness and credential proxy over loopback.
  for (const host of LOOPBACK_HOSTS) noProxy.add(host);
  const noProxyValue = [...noProxy].join(",");
  return {
    ...next,
    HTTPS_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: noProxyValue,
    no_proxy: noProxyValue,
  };
}

export interface RunningConnectProxy {
  readonly url: string;
  readonly server: NodeHttp.Server;
  readonly close: () => void;
}

/** A loopback HTTP CONNECT proxy. TLS stays end to end: it only relays bytes. */
export const startConnectProxy = (timeouts?: DialTimeouts) =>
  new Promise<RunningConnectProxy>((resolve, reject) => {
    const sockets = new Set<NodeNet.Socket>();
    const track = (socket: NodeNet.Socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    };
    const server = NodeHttp.createServer((_request, response) => {
      response.writeHead(405, { allow: "CONNECT" }).end();
    });
    server.on("connect", (request: NodeHttp.IncomingMessage, client: NodeNet.Socket, head) => {
      track(client);
      client.on("error", () => client.destroy());
      const target = /^(.+):(\d{1,5})$/.exec(request.url ?? "");
      const port = Number(target?.[2]);
      if (target === null || port < 1 || port > 65_535) {
        client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }
      const host = target[1]!.replace(/^\[(.*)\]$/, "$1");
      dialPreferringIpv4(host, port, timeouts).then(
        (upstream) => {
          track(upstream);
          if (client.destroyed) {
            upstream.destroy();
            return;
          }
          upstream.on("error", () => upstream.destroy());
          upstream.once("close", () => client.destroy());
          client.once("close", () => upstream.destroy());
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) upstream.write(head);
          upstream.pipe(client);
          client.pipe(upstream);
        },
        () => {
          if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        },
      );
    });
    // A server that only holds tunnels must not keep the process alive at shutdown.
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as NodeNet.AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        server,
        close: () => {
          for (const socket of sockets) socket.destroy();
          server.close();
        },
      });
    });
  });

/**
 * One proxy per server, shared by every Antigravity runtime. It starts on the first spawn and
 * starts again before the next spawn if it stopped listening.
 */
export const makeAntigravityConnectProxy = Effect.fn("makeAntigravityConnectProxy")(function* (
  options: { readonly start?: () => Promise<RunningConnectProxy> } = {},
) {
  const start = options.start ?? (() => startConnectProxy());
  const lock = yield* Semaphore.make(1);
  let current: RunningConnectProxy | undefined;
  yield* Effect.addFinalizer(() => Effect.sync(() => current?.close()));

  const ensureRunning = Effect.gen(function* () {
    if (current?.server.listening === true) return current.url;
    current?.close();
    current = undefined;
    const started = yield* Effect.tryPromise(start).pipe(Effect.option);
    if (started._tag === "None") {
      yield* Effect.logWarning("Could not start the Antigravity network proxy.");
      return undefined;
    }
    current = started.value;
    return current.url;
  });

  const environment = (base: NodeJS.ProcessEnv) =>
    lock.withPermit(
      Effect.gen(function* () {
        if (hasUserProxy(base)) return base;
        const url = yield* ensureRunning;
        return url === undefined ? base : withConnectProxyEnvironment(base, url);
      }),
    );

  return { environment };
});

export class AntigravityConnectProxy extends Context.Service<
  AntigravityConnectProxy,
  {
    /** The environment for a new agent process: through the proxy unless the user set one. */
    readonly environment: (base: NodeJS.ProcessEnv) => Effect.Effect<NodeJS.ProcessEnv>;
  }
>()("t3/provider/AntigravityConnectProxy") {
  static readonly layer = Layer.effect(AntigravityConnectProxy, makeAntigravityConnectProxy());
}
