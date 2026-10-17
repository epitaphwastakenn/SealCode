import { describe, expect, it } from "vite-plus/test";

import {
  isAntigravityQuotaErrorMessage,
  isAntigravityQuotaExhausted,
  extractAntigravityOAuthClient,
  mapAntigravitySubscriptionUsage,
  parseAntigravityCredentials,
} from "./antigravityUsage.ts";

describe("Antigravity subscription usage", () => {
  it("detects exhausted five-hour usage and quota-limit errors", () => {
    expect(
      isAntigravityQuotaExhausted({
        plan: null,
        windows: [
          {
            id: "antigravity-gemini-5-hour",
            label: "Gemini 5 hour",
            usedPercent: 100,
            windowDurationMins: 300,
            resetsAt: null,
          },
        ],
        metrics: [],
        checkedAt: "2026-08-15T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(isAntigravityQuotaErrorMessage("You've reached your 5-hour usage limit.")).toBe(true);
    expect(isAntigravityQuotaErrorMessage("HTTP 429: quota exceeded")).toBe(true);
    expect(isAntigravityQuotaErrorMessage("Authentication failed")).toBe(false);
  });

  it("maps quota-summary groups into model family windows", () => {
    const usage = mapAntigravitySubscriptionUsage({
      checkedAt: "2026-08-10T12:00:00.000Z",
      payload: {
        response: {
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  bucketId: "gemini-5h",
                  remaining: { remainingFraction: 0.75 },
                  resetTime: { seconds: "1786381200" },
                },
                { bucketId: "gemini-5h", remaining: { remainingFraction: 0.6 } },
                { bucketId: "gemini-weekly", remaining: { remainingFraction: 0.5 } },
              ],
            },
            {
              displayName: "Claude and GPT models",
              buckets: [{ bucketId: "claude-weekly", remaining: { remainingFraction: 0.2 } }],
            },
          ],
        },
      },
    });

    expect(usage?.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ["Gemini 5 hour", 40],
      ["Gemini Weekly", 50],
      ["Claude + GPT Weekly", 80],
    ]);
    expect(usage?.windows[0]?.resetsAt).toBe("2026-08-10T17:00:00.000Z");
  });

  it("maps the legacy model-config payload when summary groups are absent", () => {
    const usage = mapAntigravitySubscriptionUsage({
      checkedAt: "2026-08-10T12:00:00.000Z",
      payload: {
        userStatus: {
          planName: "AI Pro",
          cascadeModelConfigData: {
            clientModelConfigs: [
              { model: "gemini-3.6-flash", quotaInfo: { remainingFraction: 0.9 } },
              { model: "claude-sonnet", quotaInfo: { remainingFraction: 0.4 } },
            ],
          },
        },
      },
    });

    expect(usage?.plan).toBe("AI Pro");
    expect(usage?.windows.map((window) => window.id)).toEqual(
      expect.arrayContaining(["antigravity-gemini-5-hour", "antigravity-claude-gpt-5-hour"]),
    );
    expect(usage?.windows.map((window) => window.usedPercent)).toEqual(
      expect.arrayContaining([expect.closeTo(10), expect.closeTo(60)]),
    );
  });

  it("maps the cloud quota summary returned without a local language server", () => {
    const usage = mapAntigravitySubscriptionUsage({
      checkedAt: "2026-08-12T12:00:00.000Z",
      payload: {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                displayName: "Weekly Limit Remaining",
                remainingFraction: 0.8,
                resetTime: "2026-08-17T12:00:00Z",
              },
              {
                displayName: "Five Hour Limit Remaining",
                remainingFraction: 0.25,
                resetTime: "2026-08-12T17:00:00Z",
              },
            ],
          },
        ],
      },
    });

    expect(usage?.windows.map((window) => [window.label, window.usedPercent])).toEqual([
      ["Gemini Weekly", expect.closeTo(20)],
      ["Gemini 5 hour", 75],
    ]);
  });

  it("normalizes keyring and OAuth-file credentials", () => {
    expect(
      parseAntigravityCredentials({
        token: {
          access_token: "keyring-access",
          refresh_token: "keyring-refresh",
          expiry: "2026-08-12T13:00:00Z",
        },
      }),
    ).toEqual({
      accessToken: "keyring-access",
      refreshToken: "keyring-refresh",
      expiresAt: Date.parse("2026-08-12T13:00:00Z"),
    });
    expect(
      parseAntigravityCredentials({
        access_token: "file-access",
        refresh_token: "file-refresh",
        expiry_date: 1_786_539_600_000,
      }),
    ).toEqual({
      accessToken: "file-access",
      refreshToken: "file-refresh",
      expiresAt: 1_786_539_600_000,
    });
  });

  it("extracts Antigravity's OAuth client without consuming adjacent binary text", () => {
    const clientSecret = `GOCSPX-${"a".repeat(28)}`;
    const binary = Buffer.from(
      `884354919052-other.apps.googleusercontent.com\0${clientSecret}trailing\0` +
        "107100606059-antigravity.apps.googleusercontent.com",
      "latin1",
    );

    expect(extractAntigravityOAuthClient(binary)).toEqual({
      clientId: "107100606059-antigravity.apps.googleusercontent.com",
      clientSecret,
    });
  });
});
