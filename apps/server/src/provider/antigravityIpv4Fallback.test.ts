// @effect-diagnostics nodeBuiltinImport:off - the fixtures are raw TCP and TLS servers and a CONNECT client.
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import {
  makeAntigravityIpv4Fallback,
  needsIpv4Fallback,
  probeIpFamilies,
  withIpv4ProxyEnvironment,
  type IpFamilyReachability,
} from "./antigravityIpv4Fallback.ts";

// Non-secret, self-signed certificate; the probe does not check certificates.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg3EwCztQysKTvzdcR
g0LWq+axzUd4tHi9PyMdqh7PlGShRANCAARfQpoLgv/tOsHWCLriDza7Ruaey2b7
mR/nS6mLu6W7+agkEqDm0mE3F/ngpPjL4Jj0IGadeMcKNKFRSBgiLdfn
-----END PRIVATE KEY-----
`;
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBsDCCAVagAwIBAgIUWbn2Wt5kTxii1UU57NJMt/wTaUgwCgYIKoZIzj0EAwIw
JDEiMCAGA1UEAwwZdDNjb2RlIG91dGJvdW5kIGh0dHAgdGVzdDAgFw0yNjEwMTEy
MjQyMzZaGA8yMTI2MDkxNzIyNDIzNlowJDEiMCAGA1UEAwwZdDNjb2RlIG91dGJv
dW5kIGh0dHAgdGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABF9CmguC/+06
wdYIuuIPNrtG5p7LZvuZH+dLqYu7pbv5qCQSoObSYTcX+eCk+MvgmPQgZp14xwo0
oVFIGCIt1+ejZDBiMB0GA1UdDgQWBBSsekAc30Q/zdIE/tvVDQKJL5oiCDAfBgNV
HSMEGDAWgBSsekAc30Q/zdIE/tvVDQKJL5oiCDAPBgNVHRMBAf8EBTADAQH/MA8G
A1UdEQQIMAaHBH8AAAEwCgYIKoZIzj0EAwIDSAAwRQIgebUrkyP56242EJB7nCV7
A+Ke/q0rNPya3fjQa9O5B+kCIQC1SfmdNaFcNJ4JINlus4FfrRnfKiADS2MIJR9f
99BN0A==
-----END CERTIFICATE-----
`;

const serve = (host: string, port: number, server: NodeNet.Server) => {
  const sockets = new Set<NodeNet.Socket>();
  server.on("connection", (socket: NodeNet.Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return Effect.acquireRelease(
    Effect.callback<NodeNet.Server, Error>((resume) => {
      server.once("error", (cause) => resume(Effect.fail(cause)));
      server.listen(port, host, () => resume(Effect.succeed(server)));
    }),
    () =>
      Effect.callback<void>((resume) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resume(Effect.void));
      }),
  ).pipe(Effect.map(() => ({ port: (server.address() as NodeNet.AddressInfo).port })));
};

const listen = (host: string, port: number, onSocket: (socket: NodeNet.Socket) => void) =>
  serve(host, port, NodeNet.createServer(onSocket));

// Answers any request after a full TLS handshake, like oauth2.googleapis.com does.
const listenHttps = (host: string, port: number) =>
  serve(
    host,
    port,
    NodeTls.createServer({ key: TEST_KEY, cert: TEST_CERT }, (socket) => {
      let request = "";
      socket.on("data", (chunk: Buffer) => {
        request += chunk.toString("latin1");
        if (request.endsWith("\r\n\r\n"))
          socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
      });
    }),
  );

// Takes the TCP connection and then never answers, like an IPv6 path that drops large packets.
const listenSilently = (host: string, port: number) => listen(host, port, () => {});

// An echo server that only listens on IPv4, so `localhost` works over IPv4 and fails over IPv6.
const ipv4OnlyEchoServer = listen("127.0.0.1", 0, (socket) => socket.pipe(socket));

const echoThroughProxy = (proxyUrl: string, target: string, payload: string) =>
  Effect.callback<string>((resume) => {
    const proxy = new URL(proxyUrl);
    const socket = NodeNet.connect({ host: proxy.hostname, port: Number(proxy.port) });
    let received = "";
    let tunnelOpen = false;
    socket.on("data", (chunk) => {
      received += chunk.toString();
      if (!tunnelOpen) {
        const headerEnd = received.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const status = received.slice(0, received.indexOf("\r\n"));
        if (!status.includes(" 200 ")) {
          socket.destroy();
          resume(Effect.die(new Error(status)));
          return;
        }
        tunnelOpen = true;
        received = received.slice(headerEnd + 4);
        socket.write(payload);
      }
      if (received.length >= payload.length) {
        socket.destroy();
        resume(Effect.succeed(received));
      }
    });
    socket.once("error", (cause) => resume(Effect.die(cause)));
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    return Effect.sync(() => socket.destroy());
  });

describe("antigravityIpv4Fallback", () => {
  it.live("detects an address family that cannot connect while the other can", () =>
    Effect.gen(function* () {
      const server = yield* listenHttps("127.0.0.1", 0);
      const reachability = yield* probeIpFamilies({
        host: "localhost",
        port: server.port,
        timeoutMs: 1_000,
      });
      assert.deepEqual(reachability, { ipv6: false, ipv4: true });
      assert.isTrue(needsIpv4Fallback(reachability));
    }).pipe(Effect.scoped),
  );

  it.live("counts a family that connects but never finishes TLS as broken", () =>
    Effect.gen(function* () {
      const server = yield* listenHttps("127.0.0.1", 0);
      yield* listenSilently("::1", server.port);
      const reachability = yield* probeIpFamilies({
        host: "localhost",
        port: server.port,
        timeoutMs: 1_000,
      });
      assert.deepEqual(reachability, { ipv6: false, ipv4: true });
    }).pipe(Effect.scoped),
  );

  it("only falls back when IPv6 fails and IPv4 works", () => {
    assert.isFalse(needsIpv4Fallback({ ipv6: true, ipv4: true }));
    assert.isFalse(needsIpv4Fallback({ ipv6: true, ipv4: false }));
    assert.isFalse(needsIpv4Fallback({ ipv6: false, ipv4: false }));
  });

  it.live("sends the agent through a proxy that reaches the target over IPv4", () =>
    Effect.gen(function* () {
      const server = yield* ipv4OnlyEchoServer;
      // The same port on ::1 answers differently, so an IPv6 dial would show in the reply.
      yield* listen("::1", server.port, (socket) => socket.end("ipv6"));
      const fallback = yield* makeAntigravityIpv4Fallback({
        probe: Effect.succeed({ ipv6: false, ipv4: true }),
      });
      const environment = yield* fallback.environment({
        PATH: "bin",
        no_proxy: "corp.example",
      });
      const proxyUrl = environment.HTTPS_PROXY!;
      assert.match(proxyUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(environment.https_proxy, proxyUrl);
      assert.equal(environment.PATH, "bin");
      assert.equal(environment.NO_PROXY, "corp.example,localhost,127.0.0.1,::1");

      const echoed = yield* echoThroughProxy(proxyUrl, `localhost:${server.port}`, "ping");
      assert.equal(echoed, "ping");
    }).pipe(Effect.scoped),
  );

  it.effect("leaves the environment alone when IPv6 works or the user set a proxy", () =>
    Effect.gen(function* () {
      let probes = 0;
      let reachability: IpFamilyReachability = { ipv6: true, ipv4: true };
      const fallback = yield* makeAntigravityIpv4Fallback({
        probe: Effect.sync(() => {
          probes += 1;
          return reachability;
        }),
      });
      const base = { PATH: "bin" };
      assert.strictEqual(yield* fallback.environment(base), base);

      const withUserProxy = { PATH: "bin", Https_Proxy: "http://corp.example:3128" };
      assert.strictEqual(yield* fallback.environment(withUserProxy), withUserProxy);
      assert.equal(probes, 1);

      // A laptop that moves to a network with broken IPv6 is caught on a later start.
      reachability = { ipv6: false, ipv4: true };
      assert.strictEqual(yield* fallback.environment(base), base);
      yield* TestClock.adjust("5 minutes");
      assert.isDefined((yield* fallback.environment(base)).HTTPS_PROXY);
      assert.equal(probes, 2);
    }).pipe(Effect.scoped),
  );

  it.effect("switches to IPv4 when a recheck after silence finds IPv6 broken", () =>
    Effect.gen(function* () {
      let reachability: IpFamilyReachability = { ipv6: true, ipv4: true };
      const fallback = yield* makeAntigravityIpv4Fallback({
        probe: Effect.sync(() => reachability),
      });
      const base = { PATH: "bin" };
      assert.strictEqual(yield* fallback.environment(base), base);

      reachability = { ipv6: false, ipv4: true };
      assert.isTrue(yield* fallback.recheck(base));
      assert.isDefined((yield* fallback.environment(base)).HTTPS_PROXY);
      // A runtime that already had the proxy gains nothing from a restart.
      assert.isFalse(yield* fallback.recheck(base));
      assert.isFalse(yield* fallback.recheck({ ...base, HTTPS_PROXY: "http://corp.example:3128" }));
    }).pipe(Effect.scoped),
  );

  it("keeps the user's own proxy settings", () => {
    const environment = { HTTP_PROXY: "http://corp.example:3128" };
    assert.strictEqual(withIpv4ProxyEnvironment(environment, "http://127.0.0.1:1"), environment);
  });
});
