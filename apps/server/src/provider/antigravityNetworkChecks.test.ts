// @effect-diagnostics nodeBuiltinImport:off - loopback servers stand in for Google and a broken proxy.
import * as NodeNet from "node:net";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { startConnectProxy } from "./AntigravityConnectProxy.ts";
import { interceptingIssuer, probeTls } from "./antigravityNetworkChecks.ts";

const listen = (onConnection: (socket: NodeNet.Socket) => void) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<NodeNet.Server>((resolve) => {
          const server = NodeNet.createServer(onConnection);
          server.listen(0, "127.0.0.1", () => resolve(server));
        }),
    ),
    (server) => Effect.sync(() => server.close()),
  ).pipe(Effect.map((server) => (server.address() as NodeNet.AddressInfo).port));

describe("antigravityNetworkChecks", () => {
  it("names the issuer of a certificate Google did not issue", () => {
    assert.isUndefined(interceptingIssuer({ issuer: { O: "Google Trust Services", CN: "WR2" } }));
    assert.equal(
      interceptingIssuer({ issuer: { O: "Contoso Web Shield", CN: "Contoso Root" } }),
      "Contoso Web Shield / Contoso Root",
    );
    assert.equal(interceptingIssuer({ issuer: { CN: "Filter CA" } }), "Filter CA");
  });

  it.live("reports the stage where the path to Google breaks", () =>
    Effect.gen(function* () {
      // Accepts TCP, then drops the TLS handshake, like a filter resetting HTTPS.
      const resettingPort = yield* listen((socket) => {
        socket.on("error", () => {});
        socket.once("data", () => socket.destroy());
      });
      const direct = yield* Effect.promise(() =>
        probeTls("oauth2.googleapis.com", { address: "127.0.0.1", family: 4 }, resettingPort),
      );
      assert.equal(direct.failedAt, "tls");
      assert.isDefined(direct.connectMs);

      const proxy = yield* Effect.acquireRelease(
        Effect.promise(() => startConnectProxy()),
        (running) => Effect.sync(() => running.close()),
      );
      const proxied = yield* Effect.promise(() =>
        probeTls("localhost", { proxyUrl: proxy.url }, resettingPort),
      );
      assert.equal(proxied.failedAt, "tls");

      const unreachable = yield* Effect.promise(() =>
        probeTls("oauth2.googleapis.com", { proxyUrl: "http://127.0.0.1:1" }),
      );
      assert.equal(unreachable.failedAt, "proxy");
    }).pipe(Effect.scoped),
  );
});
