import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";
import { WorkflowDefinition, WorkflowResult } from "@t3tools/contracts";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as HarnessStore from "../../McpHarnessStore.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, HarnessStore.McpHarnessStore];

const SkillScopeInput = Schema.Struct({
  scope: Schema.optional(Schema.Literals(["user", "project"])),
});

export const HarnessSkillListTool = Tool.make("skill_list", {
  description:
    "List SealCode-managed skills by metadata only. Full SKILL.md bodies are loaded only with skill_view.",
  parameters: SkillScopeInput,
  success: Schema.Unknown,
  failure: Schema.String,
  dependencies,
}).annotate(Tool.Title, "List SealCode skills").annotate(Tool.Readonly, true);

export const HarnessSkillViewTool = Tool.make("skill_view", {
  description: "Load one managed SealCode SKILL.md by name and scope.",
  parameters: Schema.Struct({
    name: Schema.String,
    scope: Schema.Literals(["user", "project"]),
  }),
  success: Schema.Unknown,
  failure: Schema.String,
  dependencies,
}).annotate(Tool.Title, "View SealCode skill").annotate(Tool.Readonly, true);

export const HarnessSkillProposeTool = Tool.make("skill_propose", {
  description:
    "Create a staged managed-skill proposal. The proposal is not written to the workspace until the user approves it.",
  parameters: Schema.Struct({
    name: Schema.String,
    scope: Schema.Literals(["user", "project"]),
    body: Schema.String,
    reason: Schema.String,
  }),
  success: Schema.Unknown,
  failure: Schema.String,
  dependencies,
}).annotate(Tool.Title, "Propose SealCode skill");

export const HarnessSkillManageTool = Tool.make("skill_manage", {
  description:
    "Explicitly save or delete a managed SealCode skill. Use skill_propose for automatic learning; writes are never implicit.",
  parameters: Schema.Struct({
    action: Schema.Literals(["save", "delete"]),
    name: Schema.String,
    scope: Schema.Literals(["user", "project"]),
    body: Schema.optional(Schema.String),
  }),
  success: Schema.Unknown,
  failure: Schema.String,
  dependencies,
}).annotate(Tool.Title, "Manage SealCode skill");

export const HarnessSessionSearchTool = Tool.make("session_search", {
  description:
    "Search prior SealCode messages with local full-text search. Returns bounded snippets and never calls a model.",
  parameters: Schema.Struct({
    query: Schema.String,
    scope: Schema.optional(Schema.Literals(["thread", "project"])),
    limit: Schema.optional(Schema.Int),
    cursor: Schema.optional(Schema.String),
  }),
  success: Schema.Unknown,
  failure: Schema.String,
  dependencies,
}).annotate(Tool.Title, "Search SealCode sessions").annotate(Tool.Readonly, true);

export const HarnessSessionOpenTool = Tool.make("session_open", {
  description: "Open one bounded historical SealCode message returned by session_search.",
  parameters: Schema.Struct({
    messageId: Schema.String,
    scope: Schema.optional(Schema.Literals(["thread", "project"])),
  }),
  success: Schema.Unknown,
  failure: Schema.String,
  dependencies,
}).annotate(Tool.Title, "Open SealCode session message").annotate(Tool.Readonly, true);

export const HarnessMemoryListTool = Tool.make("memory_view", {
  description: "View bounded user and current-project SealCode memory.",
  parameters: Schema.Struct({}),
  success: Schema.Unknown,
  failure: Schema.String,
  dependencies,
}).annotate(Tool.Title, "View SealCode memory").annotate(Tool.Readonly, true);

export const HarnessMemoryProposeTool = Tool.make("memory_propose", {
  description: "Stage one bounded user or project memory fact for explicit approval.",
  parameters: Schema.Struct({
    scope: Schema.Literals(["user", "project"]),
    key: Schema.String,
    value: Schema.String,
    reason: Schema.String,
  }),
  success: Schema.Unknown,
  failure: Schema.String,
  dependencies,
}).annotate(Tool.Title, "Propose SealCode memory");

export const HarnessMemoryUpsertTool = Tool.make("memory_manage", {
  description:
    "Save or delete one bounded memory fact. Values are size-limited and secret-like values are rejected.",
  parameters: Schema.Struct({
    action: Schema.Literals(["save", "delete", "approve"]),
    key: Schema.optional(Schema.String),
    value: Schema.optional(Schema.String),
    source: Schema.optional(Schema.String),
    scope: Schema.optional(Schema.Literals(["user", "project"])),
    proposalId: Schema.optional(Schema.String),
  }),
  success: Schema.Unknown,
  failure: Schema.String,
  dependencies,
}).annotate(Tool.Title, "Manage SealCode memory");

export const HarnessArtifactReadTool = Tool.make("artifact_read", {
  description: "Read a bounded slice of a SealCode artifact created for this thread.",
  parameters: Schema.Struct({
    id: Schema.String,
    start: Schema.optional(Schema.Int),
    end: Schema.optional(Schema.Int),
  }),
  success: Schema.Unknown,
  failure: Schema.String,
  dependencies,
}).annotate(Tool.Title, "Read SealCode artifact").annotate(Tool.Readonly, true);

export const HarnessWorkflowTool = Tool.make("execute_workflow", {
  description:
    "Run a bounded, read-only workflow of workspace, session, and artifact operations and return only its selected final result.",
  parameters: WorkflowDefinition,
  success: WorkflowResult,
  failure: Schema.String,
  dependencies,
}).annotate(Tool.Title, "Execute SealCode workflow").annotate(Tool.Readonly, true);

export const HarnessToolkit = Toolkit.make(
  HarnessSkillListTool,
  HarnessSkillViewTool,
  HarnessSkillProposeTool,
  HarnessSkillManageTool,
  HarnessSessionSearchTool,
  HarnessSessionOpenTool,
  HarnessMemoryListTool,
  HarnessMemoryProposeTool,
  HarnessMemoryUpsertTool,
  HarnessArtifactReadTool,
  HarnessWorkflowTool,
);
