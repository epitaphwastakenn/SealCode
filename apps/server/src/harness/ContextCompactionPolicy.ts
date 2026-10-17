import type {
  ContextCompactionPayload,
  ProviderContextCompactionMode,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";

export type { ProviderContextCompactionMode } from "@t3tools/contracts";

export interface ContextBudgetPolicy {
  readonly softThresholdRatio: number;
  readonly hardThresholdRatio: number;
  readonly targetRatio: number;
}

export const DEFAULT_CONTEXT_BUDGET_POLICY: ContextBudgetPolicy = {
  softThresholdRatio: 0.7,
  hardThresholdRatio: 0.85,
  targetRatio: 0.55,
};

export type ContextCompactionDecision =
  | { readonly kind: "none"; readonly reason: "missing-window" | "below-soft-threshold" }
  | {
      readonly kind: "native" | "harness-owned" | "unsupported";
      readonly reason: "soft-threshold" | "hard-threshold";
      readonly currentRatio: number;
      readonly targetTokens: number;
      readonly payload: ContextCompactionPayload;
    };

export function decideContextCompaction(input: {
  readonly usage: ThreadTokenUsageSnapshot | undefined;
  readonly mode: ProviderContextCompactionMode | undefined;
  readonly policy?: ContextBudgetPolicy;
}): ContextCompactionDecision {
  const policy = input.policy ?? DEFAULT_CONTEXT_BUDGET_POLICY;
  const usage = input.usage;
  if (usage?.maxTokens === undefined || usage.maxTokens <= 0) {
    return { kind: "none", reason: "missing-window" };
  }
  const currentRatio = usage.usedTokens / usage.maxTokens;
  if (currentRatio < policy.softThresholdRatio) {
    return { kind: "none", reason: "below-soft-threshold" };
  }
  const reason =
    currentRatio >= policy.hardThresholdRatio ? ("hard-threshold" as const) : ("soft-threshold" as const);
  const targetTokens = Math.max(1, Math.floor(usage.maxTokens * policy.targetRatio));
  return {
    kind:
      input.mode === "provider-native"
        ? "native"
        : input.mode === "harness-owned"
          ? "harness-owned"
          : "unsupported",
    reason,
    currentRatio,
    targetTokens,
    payload: {
      mode: input.mode ?? "unsupported",
      reason,
      beforeTokens: usage.usedTokens,
      targetTokens,
      maxTokens: usage.maxTokens,
    },
  };
}

export function preserveCompactionSections<T>(input: {
  readonly items: ReadonlyArray<T>;
  readonly firstCount: number;
  readonly lastCount: number;
  readonly keep: (item: T, index: number) => boolean;
}): ReadonlyArray<T> {
  const retained = new Set<number>();
  for (let index = 0; index < Math.min(input.firstCount, input.items.length); index += 1) {
    retained.add(index);
  }
  for (
    let index = Math.max(0, input.items.length - input.lastCount);
    index < input.items.length;
    index += 1
  ) {
    retained.add(index);
  }
  input.items.forEach((item, index) => {
    if (input.keep(item, index)) retained.add(index);
  });
  return input.items.filter((_, index) => retained.has(index));
}

export const __testing = { DEFAULT_CONTEXT_BUDGET_POLICY };
