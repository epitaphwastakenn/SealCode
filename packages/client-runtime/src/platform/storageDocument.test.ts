import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  SshConnectionProfile,
  SshConnectionRegistration,
} from "../connection/catalog.ts";
import {
  BearerConnectionTarget,
  ConnectionTransientError,
  SshConnectionTarget,
} from "../connection/model.ts";
import {
  PullRequestRoutingPermissions,
  makePullRequestRoutingPermissions,
} from "../connection/pullRequestRoutingPermissions.ts";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  dropLegacyCloudRecords,
  registerConnectionInCatalog,
  removeConnectionFromCatalog,
  setConnectionEnabledInCatalog,
} from "./storageDocument.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const decodeCatalogDocument = Schema.decodeUnknownSync(ConnectionCatalogDocument);

const BEARER_TARGET = new BearerConnectionTarget({
  environmentId: ENVIRONMENT_ID,
  label: "Remote",
  connectionId: "bearer-1",
});
const BEARER_PROFILE = new BearerConnectionProfile({
  connectionId: BEARER_TARGET.connectionId,
  environmentId: ENVIRONMENT_ID,
  label: BEARER_TARGET.label,
  httpBaseUrl: "https://remote.example.test",
  wsBaseUrl: "wss://remote.example.test",
});
const BEARER_CREDENTIAL = new BearerConnectionCredential({
  token: "bearer-token",
});
describe("ConnectionCatalogDocument", () => {
  it("drops relay routes and the routes learned through them before decoding a saved catalog", () => {
    const decoded = decodeCatalogDocument(
      dropLegacyCloudRecords({
        schemaVersion: 1,
        targets: [
          { _tag: "RelayConnectionTarget", environmentId: ENVIRONMENT_ID, label: "Remote" },
          {
            _tag: "BearerConnectionTarget",
            environmentId: ENVIRONMENT_ID,
            label: "Remote",
            connectionId: "learned:cloud",
          },
          {
            _tag: "BearerConnectionTarget",
            environmentId: ENVIRONMENT_ID,
            label: "Remote",
            connectionId: BEARER_TARGET.connectionId,
          },
        ],
        profiles: [
          {
            _tag: "BearerConnectionProfile",
            connectionId: "learned:cloud",
            environmentId: ENVIRONMENT_ID,
            label: "Remote",
            httpBaseUrl: "https://learned.example.test",
            wsBaseUrl: "wss://learned.example.test",
            learned: true,
            authorization: "t3-connect",
          },
          { ...BEARER_PROFILE },
        ],
        credentials: [],
        remoteDpopTokens: [{ environmentId: ENVIRONMENT_ID }],
      }),
    );
    expect(decoded.targets.map((target) => target._tag)).toEqual(["BearerConnectionTarget"]);
    expect(decoded.profiles.map((profile) => profile.connectionId)).toEqual([
      BEARER_TARGET.connectionId,
    ]);
  });

  it.effect("does not enable GitHub routing when permission persistence fails", () =>
    Effect.gen(function* () {
      const entry = { target: BEARER_TARGET, profile: Option.some(BEARER_PROFILE), enabled: true };
      expect(yield* (yield* PullRequestRoutingPermissions).get(entry)).toBe("off");
      const permissions = yield* makePullRequestRoutingPermissions({
        read: Effect.succeed([]),
        write: () =>
          Effect.fail(
            new ConnectionTransientError({
              reason: "remote-unavailable",
              detail: "storage unavailable",
            }),
          ),
      });
      yield* permissions.set(entry, "read-write").pipe(Effect.flip);
      expect(yield* permissions.get(entry)).toBe("off");
    }),
  );

  it("switches a saved environment off and back on without touching its records", () => {
    const registered = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new BearerConnectionRegistration({
        target: BEARER_TARGET,
        profile: BEARER_PROFILE,
        credential: BEARER_CREDENTIAL,
      }),
    );

    const disabled = setConnectionEnabledInCatalog(registered, ENVIRONMENT_ID, false);
    expect(disabled.disabledEnvironmentIds).toEqual([ENVIRONMENT_ID]);
    expect(disabled.targets).toEqual(registered.targets);
    expect(disabled.credentials).toEqual(registered.credentials);
    expect(
      setConnectionEnabledInCatalog(disabled, ENVIRONMENT_ID, false).disabledEnvironmentIds,
    ).toEqual([ENVIRONMENT_ID]);

    expect(
      setConnectionEnabledInCatalog(disabled, ENVIRONMENT_ID, true).disabledEnvironmentIds,
    ).toEqual([]);
    expect(
      registerConnectionInCatalog(
        disabled,
        new BearerConnectionRegistration({
          target: BEARER_TARGET,
          profile: BEARER_PROFILE,
          credential: BEARER_CREDENTIAL,
        }),
      ).disabledEnvironmentIds,
    ).toEqual([ENVIRONMENT_ID]);
    expect(removeConnectionFromCatalog(disabled, ENVIRONMENT_ID).disabledEnvironmentIds).toEqual(
      [],
    );
  });

  it("persists the normalized SSH profile and its paired token beside its target", () => {
    const target = new SshConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "SSH",
      connectionId: "ssh-1",
    });
    const profile = new SshConnectionProfile({
      connectionId: target.connectionId,
      environmentId: target.environmentId,
      label: target.label,
      target: {
        alias: "devbox",
        hostname: "devbox.example.test",
        username: "developer",
        port: 22,
      },
    });
    const document = registerConnectionInCatalog(
      EMPTY_CONNECTION_CATALOG_DOCUMENT,
      new SshConnectionRegistration({ target, profile, credential: BEARER_CREDENTIAL }),
    );

    expect(document.targets).toEqual([target]);
    expect(document.profiles).toEqual([profile]);
    expect(document.credentials).toEqual([
      { connectionId: target.connectionId, credential: BEARER_CREDENTIAL },
    ]);
    // Removing the route forgets its token too.
    expect(removeConnectionFromCatalog(document, ENVIRONMENT_ID).credentials).toEqual([]);
  });
});
