// @effect-diagnostics nodeBuiltinImport:off - the fixtures are raw TCP servers and a CONNECT client.
import * as NodeNet from "node:net";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

import {
  makeAntigravityConnectProxy,
  startConnectProxy,
  withConnectProxyEnvironment,
  type RunningConnectProxy,
} from "./AntigravityConnectProxy.ts";

const listen = (host: string, port: number, onSocket: (socket: NodeNet.Socket) => void) => {
  const sockets = new Set<NodeNet.Socket>();
  const server = NodeNet.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    onSocket(socket);
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

const echo = (tag: string) => (socket: NodeNet.Socket) =>
  socket.on("data", (chunk: Buffer) => socket.write(`${tag}:${chunk.toString()}`));

// Takes the TCP connection and never answers, like an IPv6 path that drops large packets.
const silent = () => {};

/** Opens a tunnel through the proxy and returns the first reply to `payload`. */
const throughProxy = (proxyUrl: string, target: string, payload: string) =>
  Effect.callback<string>((resume) => {
    const proxy = new URL(proxyUrl);
    const socket = NodeNet.connect({ host: proxy.hostname, port: Number(proxy.port) });
    let received = "";
    let tunnelOpen = false;
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString();
      if (!tunnelOpen) {
        const headerEnd = received.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const status = received.slice(0, received.indexOf("\r\n"));
        if (!status.includes(" 200 ")) {
          socket.destroy();
          resume(Effect.succeed(status));
          return;
        }
        tunnelOpen = true;
        received = received.slice(headerEnd + 4);
        socket.write(payload);
      }
      if (received.length > 0) {
        socket.destroy();
        resume(Effect.succeed(received));
      }
    });
    socket.once("error", (cause) => resume(Effect.die(cause)));
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    return Effect.sync(() => socket.destroy());
  });

const proxyEnvironment = Effect.gen(function* () {
  const proxy = yield* makeAntigravityConnectProxy();
  const environment = yield* proxy.environment({ PATH: "bin", no_proxy: "corp.example" });
  return environment.HTTPS_PROXY!;
});

describe("AntigravityConnectProxy", () => {
  it.live("uses IPv4 first, so an IPv6 path that never answers stalls nothing", () =>
    Effect.gen(function* () {
      const ipv4 = yield* listen("127.0.0.1", 0, echo("ipv4"));
      yield* listen("::1", ipv4.port, silent);
      const proxyUrl = yield* proxyEnvironment;
      assert.equal(yield* throughProxy(proxyUrl, `localhost:${ipv4.port}`, "ping"), "ipv4:ping");
    }).pipe(Effect.scoped),
  );

  it.live("falls back to IPv6 when IPv4 is unavailable", () =>
    Effect.gen(function* () {
      const ipv6 = yield* listen("::1", 0, echo("ipv6"));
      const proxyUrl = yield* proxyEnvironment;
      assert.equal(yield* throughProxy(proxyUrl, `localhost:${ipv6.port}`, "ping"), "ipv6:ping");
    }).pipe(Effect.scoped),
  );

  it.live("sends the agent through the proxy and keeps loopback direct", () =>
    Effect.gen(function* () {
      const proxy = yield* makeAntigravityConnectProxy();
      const environment = yield* proxy.environment({ PATH: "bin", no_proxy: "corp.example" });
      assert.match(environment.HTTPS_PROXY!, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(environment.https_proxy, environment.HTTPS_PROXY);
      assert.equal(environment.PATH, "bin");
      assert.equal(environment.NO_PROXY, "corp.example,localhost,127.0.0.1,::1");
      // One proxy serves every runtime.
      assert.equal((yield* proxy.environment({})).HTTPS_PROXY, environment.HTTPS_PROXY);
    }).pipe(Effect.scoped),
  );

  it("keeps Google traffic on the proxy when an inherited NO_PROXY would bypass it", () => {
    const environment = withConnectProxyEnvironment(
      { NO_PROXY: "*.googleapis.com,.google.com,corp.example,oauth2.googleapis.com:443,com,*" },
      "http://127.0.0.1:1",
    );
    assert.equal(environment.NO_PROXY, "corp.example,localhost,127.0.0.1,::1");
    assert.equal(environment.no_proxy, environment.NO_PROXY);
  });

  it.live("leaves a proxy the user configured alone", () =>
    Effect.gen(function* () {
      let starts = 0;
      const proxy = yield* makeAntigravityConnectProxy({
        start: () => {
          starts += 1;
          return startConnectProxy();
        },
      });
      const withUserProxy = { PATH: "bin", Https_Proxy: "http://corp.example:3128" };
      assert.strictEqual(yield* proxy.environment(withUserProxy), withUserProxy);
      const withHttpProxy = { HTTP_PROXY: "http://corp.example:3128" };
      assert.strictEqual(withConnectProxyEnvironment(withHttpProxy, "http://x"), withHttpProxy);
      assert.equal(starts, 0);
    }).pipe(Effect.scoped),
  );

  it.live("starts a new proxy before the next spawn after the old one died", () =>
    Effect.gen(function* () {
      const target = yield* listen("127.0.0.1", 0, echo("ipv4"));
      const started: Array<RunningConnectProxy> = [];
      const proxy = yield* makeAntigravityConnectProxy({
        start: () =>
          startConnectProxy().then((running) => {
            started.push(running);
            return running;
          }),
      });
      yield* proxy.environment({});
      started[0]!.close();

      const environment = yield* proxy.environment({});
      assert.lengthOf(started, 2);
      assert.equal(environment.HTTPS_PROXY, started[1]!.url);
      assert.equal(
        yield* throughProxy(environment.HTTPS_PROXY!, `127.0.0.1:${target.port}`, "ping"),
        "ipv4:ping",
      );
    }).pipe(Effect.scoped),
  );

  it.live("closes open tunnels when the server shuts down", () =>
    Effect.gen(function* () {
      const target = yield* listen("127.0.0.1", 0, silent);
      const scope = yield* Scope.make();
      const proxy = yield* makeAntigravityConnectProxy().pipe(Scope.provide(scope));
      const proxyUrl = new URL((yield* proxy.environment({})).HTTPS_PROXY!);
      const tunnel = yield* Effect.callback<NodeNet.Socket>((resume) => {
        const socket = NodeNet.connect({ host: proxyUrl.hostname, port: Number(proxyUrl.port) });
        socket.once("data", () => resume(Effect.succeed(socket)));
        socket.once("error", () => {});
        socket.write(`CONNECT 127.0.0.1:${target.port} HTTP/1.1

`);
      });
      yield* Scope.close(scope, Exit.void);
      yield* Effect.callback<void>((resume) => {
        if (tunnel.destroyed) resume(Effect.void);
        else tunnel.once("close", () => resume(Effect.void));
      });
      assert.isTrue(tunnel.destroyed);
    }).pipe(Effect.scoped),
  );
});
