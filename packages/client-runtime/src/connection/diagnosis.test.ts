import { describe, expect, it } from "@effect/vitest";

import { presentConnectionDiagnosis } from "./diagnosis.ts";
import { mapRemoteEnvironmentError } from "./errors.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  type ConnectionAttemptError,
  type SupervisorConnectionState,
} from "./model.ts";
import { RemoteEnvironmentAuthFetchError } from "../rpc/http.ts";

const backoff = (lastFailure: ConnectionAttemptError): SupervisorConnectionState => ({
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "backoff",
  attempt: 3,
  lastFailure,
  retryAt: Date.UTC(2026, 9, 19, 12, 0, 30),
});

const diagnose = (state: SupervisorConnectionState) =>
  presentConnectionDiagnosis({ hostLabel: "Mac mini", state });

describe("presentConnectionDiagnosis", () => {
  it("says nothing while nothing has failed", () => {
    expect(diagnose({ ...AVAILABLE_CONNECTION_STATE, network: "online" })).toBeNull();
  });

  it("blames this device while it is offline", () => {
    const diagnosis = diagnose({ ...AVAILABLE_CONNECTION_STATE, network: "offline" });
    expect(diagnosis?.headline).toBe("This device is offline");
    expect(diagnosis?.hops.map((hop) => `${hop.hop}:${hop.result}`)).toEqual([
      "device:failed",
      "server:unchecked",
    ]);
  });

  it("blames the host when a request never reaches it", () => {
    const failure = mapRemoteEnvironmentError(
      new RemoteEnvironmentAuthFetchError({
        message: "Failed to fetch remote environment endpoint.",
        cause: new TypeError("Failed to fetch"),
      }),
    );
    const diagnosis = diagnose(backoff(failure));
    expect(diagnosis?.headline).toBe("Harp on Mac mini did not answer");
    expect(diagnosis?.hops.map((hop) => `${hop.hop}:${hop.result}`)).toEqual([
      "device:ok",
      "server:failed",
    ]);
  });
});
