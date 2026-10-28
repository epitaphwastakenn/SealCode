import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as RpcHttp from "../rpc/http.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import * as RemoteEnvironmentAuthorization from "./service.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const ENDPOINT = {
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
};
const DESCRIPTOR = {
  environmentId: ENVIRONMENT_ID,
  label: "Remote environment",
  platform: {
    os: "linux",
    arch: "x64",
  },
  serverVersion: "0.0.0-test",
  capabilities: {
    repositoryIdentity: true,
  },
};

type RecordedResponse = Response | ((init: RequestInit) => Response);

function recordedFetch(responses: ReadonlyArray<RecordedResponse>) {
  const calls: Array<readonly [RequestInfo | URL, RequestInit]> = [];
  let responseIndex = 0;
  const fetchFn = ((input, init) => {
    calls.push([input, init ?? {}]);
    const response = responses[responseIndex++];
    return response === undefined
      ? Promise.reject(new Error(`Unexpected fetch call to ${String(input)}`))
      : Promise.resolve(typeof response === "function" ? response(init ?? {}) : response);
  }) satisfies typeof fetch;
  return { calls, fetchFn };
}

const websocketTicket = (ticket: string) =>
  Response.json({
    ticket,
    expiresAt: "2026-06-06T01:00:00.000Z",
  });

describe("RemoteEnvironmentAuthorization", () => {
  it.effect("reuses a validated bearer descriptor while issuing fresh websocket tickets", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch([
        Response.json(DESCRIPTOR),
        websocketTicket("first-ticket"),
        websocketTicket("second-ticket"),
      ]);
      const layer = RemoteEnvironmentAuthorization.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            RpcHttp.layerRemoteHttpClient(fetch.fetchFn),
            Layer.succeed(
              ClientCapabilities.ClientPresentation,
              ClientCapabilities.ClientPresentation.of({
                metadata: {
                  label: "Harp Test",
                  deviceType: "mobile",
                  os: "test",
                },
              }),
            ),
          ),
        ),
      );

      const [first, second] = yield* Effect.gen(function* () {
        const remote = yield* RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization;
        const authorize = () =>
          remote.authorizeBearer({
            expectedEnvironmentId: ENVIRONMENT_ID,
            httpBaseUrl: ENDPOINT.httpBaseUrl,
            wsBaseUrl: ENDPOINT.wsBaseUrl,
            bearerToken: "bearer-token",
            connectionMethod: "direct",
          });
        return [yield* authorize(), yield* authorize()] as const;
      }).pipe(Effect.provide(layer));

      expect(first.socketUrl).toContain("wsTicket=first-ticket");
      expect(second.socketUrl).toContain("wsTicket=second-ticket");
      expect(
        fetch.calls.filter(([url]) => String(url).endsWith("/.well-known/t3/environment")),
      ).toHaveLength(1);
      expect(
        fetch.calls.filter(([url]) => String(url).endsWith("/api/auth/websocket-ticket/rpc")),
      ).toHaveLength(2);
    }),
  );
});
