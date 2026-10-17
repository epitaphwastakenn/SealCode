import { beforeEach, describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as NodeEvents from "node:events";
import * as Effect from "effect/Effect";
import { probeAntigravitySubscriptionUsage } from "./antigravityUsage.ts";

const { readFile, request, execFile } = vi.hoisted(() => ({
  readFile: vi.fn(),
  request: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ readFile }));
vi.mock("node:https", () => ({ request }));
vi.mock("node:child_process", () => ({ execFile }));

const quota = {
  groups: [
    {
      displayName: "Gemini Models",
      buckets: [{ displayName: "Five Hour Limit Remaining", remainingFraction: 0.75 }],
    },
  ],
};
const probe = (account: string) =>
  probeAntigravitySubscriptionUsage({
    environment: {},
    platform: "win32",
    binaryPath: "must-not-read.exe",
    acpTokenPath: `/profiles/${account}/antigravity-acp/acp_token.json`,
    checkedAt: "2026-09-06T12:00:00Z",
  });

describe("ACP account usage", () => {
  const requests: Array<{ url: string; body: string; authorization?: string }> = [];
  beforeEach(() => {
    vi.clearAllMocks();
    requests.length = 0;
    request.mockImplementation((url: string, options, callback) => {
      const response = Object.assign(new NodeEvents.EventEmitter(), {
        statusCode: 200,
        setEncoding: vi.fn(),
      });
      return {
        setTimeout: vi.fn(),
        on: vi.fn(),
        end(body: string) {
          requests.push({ url, body, authorization: options.headers.Authorization });
          callback(response);
          const token = new URLSearchParams(body).get("refresh_token");
          response.emit(
            "data",
            JSON.stringify(
              url.endsWith("/token")
                ? { access_token: `access-${token}`, expires_in: 3600 }
                : url.endsWith(":loadCodeAssist")
                  ? { paidTier: { name: "Google AI Pro" }, cloudaicompanionProject: "project" }
                  : quota,
            ),
          );
          response.emit("end");
        },
      };
    });
  });

  it.effect(
    "uses each ACP instance's OAuth client and keeps refreshed tokens account-specific",
    () =>
      Effect.gen(function* () {
        readFile.mockImplementation((path: string) =>
          Promise.resolve(
            JSON.stringify({
              refresh_token: path.includes("account-a") ? "refresh-a" : "refresh-b",
              client_id: "acp-client",
              client_secret: "acp-client-secret",
            }),
          ),
        );
        for (const account of ["account-a", "account-b"]) {
          const usage = yield* probe(account);
          expect(usage?.plan).toBe("Google AI Pro");
          expect(usage?.windows[0]?.usedPercent).toBe(25);
        }
        expect(
          requests
            .filter((item) => item.url.endsWith("/token"))
            .map((item) => new URLSearchParams(item.body).get("client_id")),
        ).toEqual(["acp-client", "acp-client"]);
        expect(
          requests
            .filter((item) => item.url.endsWith(":loadCodeAssist"))
            .map((item) => item.authorization),
        ).toEqual(["Bearer access-refresh-a", "Bearer access-refresh-b"]);
        expect(readFile.mock.calls.map((call) => call[0])).toEqual([
          "/profiles/account-a/antigravity-acp/acp_token.json",
          "/profiles/account-b/antigravity-acp/acp_token.json",
        ]);
        expect(execFile).not.toHaveBeenCalled();
      }),
  );

  it.effect("does not substitute CLI or IDE credentials when the ACP instance is signed out", () =>
    Effect.gen(function* () {
      readFile.mockRejectedValue(new Error("ENOENT"));
      expect(yield* probe("signed-out")).toBeUndefined();
      expect(request).not.toHaveBeenCalled();
      expect(execFile).not.toHaveBeenCalled();
    }),
  );

  it.effect("does not inspect a large executable if the ACP OAuth client is missing", () =>
    Effect.gen(function* () {
      readFile.mockResolvedValue(JSON.stringify({ refresh_token: "incomplete" }));
      expect(yield* probe("incomplete")).toBeUndefined();
      expect(readFile).toHaveBeenCalledTimes(1);
      expect(request).not.toHaveBeenCalled();
      expect(execFile).not.toHaveBeenCalled();
    }),
  );
});
