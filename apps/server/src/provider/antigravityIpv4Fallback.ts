// @effect-diagnostics nodeBuiltinImport:off - the probe pins a TLS connection to one address family and the proxy relays raw CONNECT tunnels.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";

import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

// The agent's bundled Python has no IPv4 fallback race, so broken IPv6 stalls each Google call
// for minutes. It sends every Google request through HTTPS_PROXY, so a loopback proxy that only
// dials IPv4 sidesteps the broken route without touching the machine's network settings.
const GOOGLE_PROBE_HOST = "oauth2.googleapis.com";
const GOOGLE_PROBE_PORT = 443;
const PROBE_TIMEOUT_MS = 4_000;
// Laptops change networks; a later runtime start checks again.
const PROBE_TTL_MS = 5 * 60_000;
const USER_PROXY_KEYS = new Set(["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "GRPC_PROXY"]);
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

export interface IpFamilyReachability {
  readonly ipv6: boolean;
  readonly ipv4: boolean;
}

// A half-broken IPv6 path (a PMTU black hole, for one) accepts TCP and then drops the large
// TLS and HTTP replies, so only a full handshake and a response prove the family works. The
// certificate is not checked: this measures reachability, and TLS-inspecting networks re-sign.
export const canReachHttpsOverFamily = (input: {
  readonly host: string;
  readonly port: number;
  readonly family: 4 | 6;
  readonly timeoutMs: number;
}) =>
  Effect.callback<boolean>((resume) => {
    const tcp = NodeNet.connect({
      host: input.host,
      port: input.port,
      family: input.family,
      autoSelectFamily: false,
    });
    const socket = NodeTls.connect({
      socket: tcp,
      servername: input.host,
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    });
    let reply = "";
    let finished = false;
    const finish = (reached: boolean) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      tcp.destroy();
      resume(Effect.succeed(reached));
    };
    socket.once("secureConnect", () => {
      socket.write(`HEAD / HTTP/1.1\r\nHost: ${input.host}\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      reply += chunk.toString("latin1");
      if (reply.length >= 5) finish(reply.startsWith("HTTP/"));
    });
    tcp.once("error", () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    return Effect.sync(() => {
      socket.destroy();
      tcp.destroy();
    });
  }).pipe(Effect.timeoutOrElse({ duration: input.timeoutMs, orElse: () => Effect.succeed(false) }));

export const probeIpFamilies = Effect.fn("probeIpFamilies")(function* (
  target: { readonly host: string; readonly port: number; readonly timeoutMs: number } = {
    host: GOOGLE_PROBE_HOST,
    port: GOOGLE_PROBE_PORT,
    timeoutMs: PROBE_TIMEOUT_MS,
  },
) {
  const [ipv6, ipv4] = yield* Effect.all(
    [
      canReachHttpsOverFamily({ ...target, family: 6 }),
      canReachHttpsOverFamily({ ...target, family: 4 }),
    ],
    { concurrency: 2 },
  );
  return { ipv6, ipv4 } satisfies IpFamilyReachability;
});

export const needsIpv4Fallback = (reachability: IpFamilyReachability) =>
  !reachability.ipv6 && reachability.ipv4;

const hasUserProxy = (environment: NodeJS.ProcessEnv) =>
  Object.entries(environment).some(
    ([key, value]) => USER_PROXY_KEYS.has(key.toUpperCase()) && Boolean(value?.trim()),
  );

/** Leaves a proxy the user configured alone; it already owns how the agent connects. */
export function withIpv4ProxyEnvironment(
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
      if (entry.trim()) noProxy.add(entry.trim());
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

/** A loopback HTTP CONNECT proxy that dials every target over IPv4. */
export const startIpv4ConnectProxy = Effect.acquireRelease(
  Effect.callback<
    {
      readonly url: string;
      readonly server: NodeHttp.Server;
      readonly sockets: Set<NodeNet.Socket>;
    },
    Error
  >((resume) => {
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
      const target = /^(.+):(\d{1,5})$/.exec(request.url ?? "");
      const port = Number(target?.[2]);
      if (target === null || port < 1 || port > 65_535) {
        client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }
      const host = target[1]!.replace(/^\[(.*)\]$/, "$1");
      const upstream = NodeNet.connect({ host, port, family: 4, autoSelectFamily: false }, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      track(upstream);
      upstream.once("error", () => {
        if (client.writable) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        else client.destroy();
      });
      client.once("error", () => upstream.destroy());
      client.once("close", () => upstream.destroy());
      upstream.once("close", () => client.destroy());
    });
    server.once("error", (cause) => resume(Effect.fail(cause)));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as NodeNet.AddressInfo;
      resume(Effect.succeed({ url: `http://127.0.0.1:${address.port}`, server, sockets }));
    });
  }),
  ({ server, sockets }) =>
    Effect.callback<void>((resume) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resume(Effect.void));
    }),
);

/**
 * Checks whether IPv6 to Google is broken while IPv4 works, and if so routes the agent
 * through a loopback IPv4-only proxy that lives as long as the driver.
 */
export const makeAntigravityIpv4Fallback = Effect.fn("makeAntigravityIpv4Fallback")(function* (
  options: { readonly probe?: Effect.Effect<IpFamilyReachability> } = {},
) {
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const probe = options.probe ?? probeIpFamilies();
  let checked: { readonly at: number; readonly useIpv4: boolean } | undefined;
  let proxyUrl: string | undefined;

  const decide = Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    const useIpv4 = needsIpv4Fallback(yield* probe);
    if (useIpv4 && checked?.useIpv4 !== true) {
      yield* Effect.logWarning(
        "IPv6 to Google is unreachable while IPv4 works; Antigravity will connect over IPv4.",
      );
    }
    checked = { at, useIpv4 };
    return useIpv4;
  });

  const environment = (base: NodeJS.ProcessEnv) =>
    lock.withPermit(
      Effect.gen(function* () {
        if (hasUserProxy(base)) return base;
        const now = yield* Clock.currentTimeMillis;
        const useIpv4 =
          checked === undefined || now - checked.at >= PROBE_TTL_MS
            ? yield* decide
            : checked.useIpv4;
        if (!useIpv4) return base;
        if (proxyUrl === undefined) {
          const started = yield* startIpv4ConnectProxy.pipe(
            Effect.provideService(Scope.Scope, scope),
            Effect.option,
          );
          if (started._tag === "None") {
            yield* Effect.logWarning("Could not start the IPv4 proxy for Antigravity.");
            return base;
          }
          proxyUrl = started.value.url;
        }
        return withIpv4ProxyEnvironment(base, proxyUrl);
      }),
    );

  /**
   * Probes again, ignoring the cache, after the agent went silent. True when IPv4 has just
   * become the way through, so a runtime started from now on would get the proxy.
   */
  const recheck = (base: NodeJS.ProcessEnv) =>
    lock.withPermit(
      Effect.gen(function* () {
        if (hasUserProxy(base)) return false;
        const wasUsingIpv4 = checked?.useIpv4 === true;
        return (yield* decide) && !wasUsingIpv4;
      }),
    );

  return { environment, recheck };
});
