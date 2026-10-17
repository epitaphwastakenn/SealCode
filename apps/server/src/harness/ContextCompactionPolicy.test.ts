import { describe, expect, it } from "vite-plus/test";

import { decideContextCompaction, preserveCompactionSections } from "./ContextCompactionPolicy.ts";

describe("decideContextCompaction", () => {
  it("distinguishes native, harness-owned, and unsupported providers", () => {
    const usage = { usedTokens: 850, maxTokens: 1_000 } as const;
    expect(decideContextCompaction({ usage, mode: "provider-native" }).kind).toBe("native");
    expect(decideContextCompaction({ usage, mode: "harness-owned" }).kind).toBe("harness-owned");
    expect(decideContextCompaction({ usage, mode: "unsupported" }).kind).toBe("unsupported");
    expect(decideContextCompaction({ usage: { usedTokens: 100 }, mode: "unsupported" }).kind).toBe("none");
  });
});

describe("preserveCompactionSections", () => {
  it("keeps head, tail, and explicitly retained items", () => {
    expect(preserveCompactionSections({
      items: ["a", "b", "c", "d", "e"],
      firstCount: 1,
      lastCount: 1,
      keep: (item) => item === "c",
    })).toEqual(["a", "c", "e"]);
  });
});
