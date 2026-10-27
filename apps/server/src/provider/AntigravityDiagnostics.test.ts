import { assert, describe, it } from "@effect/vitest";

import { redactDiagnosticText } from "./AntigravityDiagnostics.ts";

describe("redactDiagnosticText", () => {
  it("keeps credentials, emails and the home directory out of the report", () => {
    const home = "C:\\Users\\Ana Souza";
    const text = [
      "Failed to refresh token at WindowsPath('C:/Users/Ana Souza/.t3/acp_token.json')",
      "{'refresh_token': '1//0gAbCdEf-secret', 'access_token': \"ya29.a0Secret\"}",
      'client_secret="GOCSPX-abc123" key=AIzaSyA1234567890abcdefghijklmnopqrstu',
      "Signed in as ana.souza@example.com via https://user:pass@proxy.example:3128",
      `Gemini home resolved to ${home}\\.t3\\userdata`,
    ].join("\n");
    const redacted = redactDiagnosticText(text, home);
    for (const secret of [
      "Ana Souza",
      "0gAbCdEf",
      "a0Secret",
      "GOCSPX",
      "AIzaSy",
      "ana.souza@example.com",
      "user:pass",
    ]) {
      assert.notInclude(redacted, secret);
    }
    assert.include(redacted, "~/.t3/acp_token.json");
  });
});
