import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** Values reported by a provider are kept separate from local estimates. */
export const HarnessCacheStatus = Schema.Literals([
  "reported-hit",
  "reported-miss",
  "not-reported",
]);
export type HarnessCacheStatus = typeof HarnessCacheStatus.Type;

export const PromptAssemblyMetadata = Schema.Struct({
  stablePrefixHash: Schema.optional(TrimmedNonEmptyString),
  stablePrefixVersion: Schema.optional(NonNegativeInt),
  cacheStatus: Schema.optional(HarnessCacheStatus),
});
export type PromptAssemblyMetadata = typeof PromptAssemblyMetadata.Type;

export const ProviderContextCompactionMode = Schema.Literals([
  "provider-native",
  "harness-owned",
  "unsupported",
]);
export type ProviderContextCompactionMode = typeof ProviderContextCompactionMode.Type;

export const ProviderPromptCacheMode = Schema.Literals([
  "provider-managed",
  "explicit",
  "unsupported",
]);
export type ProviderPromptCacheMode = typeof ProviderPromptCacheMode.Type;

export const ProviderToolTransport = Schema.Literals(["mcp", "provider-native", "opaque"]);
export type ProviderToolTransport = typeof ProviderToolTransport.Type;

export const ProviderHarnessCapabilities = Schema.Struct({
  stablePromptPrefix: Schema.Boolean,
  contextCompaction: ProviderContextCompactionMode,
  promptCaching: ProviderPromptCacheMode,
  toolTransport: ProviderToolTransport,
  detachedDelegation: Schema.Boolean,
});
export type ProviderHarnessCapabilities = typeof ProviderHarnessCapabilities.Type;

export const ContextCompactionPayload = Schema.Struct({
  mode: ProviderContextCompactionMode,
  reason: Schema.Literals(["soft-threshold", "hard-threshold"]),
  beforeTokens: NonNegativeInt,
  targetTokens: NonNegativeInt,
  maxTokens: NonNegativeInt,
});
export type ContextCompactionPayload = typeof ContextCompactionPayload.Type;

export const EfficiencyEstimates = Schema.Struct({
  toolUses: Schema.optional(NonNegativeInt),
  inlineToolResultBytes: Schema.optional(NonNegativeInt),
  artifactBytes: Schema.optional(NonNegativeInt),
  helperModelCalls: Schema.optional(NonNegativeInt),
  delegatedTasks: Schema.optional(NonNegativeInt),
  parallelTasks: Schema.optional(NonNegativeInt),
  toolWaitMs: Schema.optional(NonNegativeInt),
});
export type EfficiencyEstimates = typeof EfficiencyEstimates.Type;

export const EfficiencySnapshot = Schema.Struct({
  inputTokens: Schema.optional(NonNegativeInt),
  cachedInputTokens: Schema.optional(NonNegativeInt),
  outputTokens: Schema.optional(NonNegativeInt),
  reasoningTokens: Schema.optional(NonNegativeInt),
  toolUses: Schema.optional(NonNegativeInt),
  inlineToolResultBytes: Schema.optional(NonNegativeInt),
  artifactBytes: Schema.optional(NonNegativeInt),
  helperModelCalls: Schema.optional(NonNegativeInt),
  delegatedTasks: Schema.optional(NonNegativeInt),
  parallelTasks: Schema.optional(NonNegativeInt),
  timeToFirstOutputMs: Schema.optional(NonNegativeInt),
  durationMs: Schema.optional(NonNegativeInt),
  estimatedContextTokensBefore: Schema.optional(NonNegativeInt),
  estimatedContextTokensAfter: Schema.optional(NonNegativeInt),
  estimatedContextTokensSaved: Schema.optional(NonNegativeInt),
  compaction: Schema.optional(ContextCompactionPayload),
  estimates: Schema.optional(EfficiencyEstimates),
  prompt: Schema.optional(PromptAssemblyMetadata),
  providerValuesReported: Schema.optional(Schema.Boolean),
});
export type EfficiencySnapshot = typeof EfficiencySnapshot.Type;

export const ContextReferenceKind = Schema.Literals(["file", "folder", "diff"]);
export type ContextReferenceKind = typeof ContextReferenceKind.Type;

export const ContextReference = Schema.Struct({
  kind: ContextReferenceKind,
  target: TrimmedNonEmptyString,
  startLine: Schema.optional(NonNegativeInt),
  endLine: Schema.optional(NonNegativeInt),
});
export type ContextReference = typeof ContextReference.Type;

export const ResolvedContextReference = Schema.Struct({
  reference: ContextReference,
  resolvedPath: Schema.optional(TrimmedNonEmptyString),
  content: Schema.String,
  contentHash: TrimmedNonEmptyString,
  byteCount: NonNegativeInt,
  truncated: Schema.Boolean,
});
export type ResolvedContextReference = typeof ResolvedContextReference.Type;

export const SkillScope = Schema.Literals(["user", "project", "provider"]);
export type SkillScope = typeof SkillScope.Type;

export const SkillSummary = Schema.Struct({
  name: TrimmedNonEmptyString,
  displayName: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(TrimmedNonEmptyString),
  scope: SkillScope,
  path: Schema.optional(TrimmedNonEmptyString),
  managed: Schema.Boolean,
  enabled: Schema.Boolean,
});
export type SkillSummary = typeof SkillSummary.Type;

export const SkillDocument = Schema.Struct({
  summary: SkillSummary,
  body: TrimmedNonEmptyString,
  contentHash: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});
export type SkillDocument = typeof SkillDocument.Type;

export const SkillProposalStatus = Schema.Literals(["pending", "approved", "rejected"]);
export type SkillProposalStatus = typeof SkillProposalStatus.Type;

export const SkillProposal = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  scope: Schema.Literals(["user", "project"]),
  body: TrimmedNonEmptyString,
  reason: TrimmedNonEmptyString,
  status: SkillProposalStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SkillProposal = typeof SkillProposal.Type;

export const SessionSearchQuery = Schema.Struct({
  query: TrimmedNonEmptyString,
  threadId: Schema.optional(ThreadId),
  projectId: Schema.optional(ProjectId),
  scope: Schema.optional(Schema.Literals(["thread", "project"])),
  limit: Schema.optional(NonNegativeInt),
  cursor: Schema.optional(TrimmedNonEmptyString),
});
export type SessionSearchQuery = typeof SessionSearchQuery.Type;

export const SessionSearchResult = Schema.Struct({
  messageId: TrimmedNonEmptyString,
  threadId: ThreadId,
  role: TrimmedNonEmptyString,
  snippet: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type SessionSearchResult = typeof SessionSearchResult.Type;

export const SessionSearchMessage = Schema.Struct({
  messageId: TrimmedNonEmptyString,
  threadId: ThreadId,
  role: TrimmedNonEmptyString,
  text: Schema.String,
  createdAt: IsoDateTime,
});
export type SessionSearchMessage = typeof SessionSearchMessage.Type;

export const MemoryEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  scope: Schema.Literals(["user", "project"]),
  projectId: Schema.optional(ProjectId),
  key: TrimmedNonEmptyString,
  value: TrimmedNonEmptyString,
  source: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MemoryEntry = typeof MemoryEntry.Type;

export const MemoryProposal = Schema.Struct({
  id: TrimmedNonEmptyString,
  scope: Schema.Literals(["user", "project"]),
  projectId: Schema.optional(ProjectId),
  key: TrimmedNonEmptyString,
  value: TrimmedNonEmptyString,
  reason: TrimmedNonEmptyString,
  status: Schema.Literals(["pending", "approved", "rejected"]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MemoryProposal = typeof MemoryProposal.Type;

export const MemorySnapshot = Schema.Struct({
  text: Schema.String,
  userCharacters: NonNegativeInt,
  projectCharacters: NonNegativeInt,
  contentHash: Schema.optional(TrimmedNonEmptyString),
});
export type MemorySnapshot = typeof MemorySnapshot.Type;

export const ArtifactRef = Schema.Struct({
  id: TrimmedNonEmptyString,
  mediaType: TrimmedNonEmptyString,
  byteCount: NonNegativeInt,
  checksum: TrimmedNonEmptyString,
  source: TrimmedNonEmptyString,
  expiresAt: Schema.optional(IsoDateTime),
});
export type ArtifactRef = typeof ArtifactRef.Type;

export const WorkflowOperation = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literals(["workspace-search", "file-read", "session-search", "artifact-slice"]),
  input: Schema.Record(Schema.String, Schema.Unknown),
});
export type WorkflowOperation = typeof WorkflowOperation.Type;

export const WorkflowDefinition = Schema.Struct({
  operations: Schema.Array(WorkflowOperation),
  output: TrimmedNonEmptyString,
});
export type WorkflowDefinition = typeof WorkflowDefinition.Type;

export const WorkflowResult = Schema.Struct({
  output: Schema.Unknown,
  operationCount: NonNegativeInt,
  artifact: Schema.optional(ArtifactRef),
});
export type WorkflowResult = typeof WorkflowResult.Type;

export const DelegatedTaskRequest = Schema.Struct({
  objective: TrimmedNonEmptyString,
  context: Schema.Array(ContextReference),
  modelSelection: Schema.optional(Schema.Unknown),
  readOnly: Schema.optional(Schema.Boolean),
});
export type DelegatedTaskRequest = typeof DelegatedTaskRequest.Type;

export const DelegatedTaskResult = Schema.Struct({
  taskId: TrimmedNonEmptyString,
  status: Schema.Literals(["completed", "failed", "cancelled", "unsupported"]),
  summary: Schema.optional(TrimmedNonEmptyString),
  artifact: Schema.optional(ArtifactRef),
});
export type DelegatedTaskResult = typeof DelegatedTaskResult.Type;
