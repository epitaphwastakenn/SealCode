// @effect-diagnostics nodeBuiltinImport:off - the fixtures are raw TCP servers and a CONNECT client.
import * as NodeNet from "node:net";

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

const listen = (host: string, port: number, onSocket: (socket: NodeNet.Socket) => void) =>
  Effect.acquireRelease(
    Effect.callback<NodeNet.Server, Error>((resume) => {
      const server = NodeNet.createServer(onSocket);
      server.once("error", (cause) => resume(Effect.fail(cause)));
      server.listen(port, host, () => resume(Effect.succeed(server)));
    }),
    (server) => Effect.callback<void>((resume) => void server.close(() => resume(Effect.void))),
  ).pipe(Effect.map((server) => ({ port: (server.address() as NodeNet.AddressInfo).port })));

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
      const server = yield* ipv4OnlyEchoServer;
      const reachability = yield* probeIpFamilies("localhost", server.port, 1_000);
      assert.deepEqual(reachability, { ipv6: false, ipv4: true });
      assert.isTrue(needsIpv4Fallback(reachability));
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

  it("keeps the user's own proxy settings", () => {
    const environment = { HTTP_PROXY: "http://corp.example:3128" };
    assert.strictEqual(withIpv4ProxyEnvironment(environment, "http://127.0.0.1:1"), environment);
  });
});
