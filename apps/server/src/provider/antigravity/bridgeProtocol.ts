/**
 * bridgeProtocol.ts — Schema decoders and encoders for the Antigravity Python bridge protocol.
 */

import * as Schema from "effect/Schema";

export const BRIDGE_PROTOCOL_VERSION = "1.0.0";
export const PINNED_SDK_VERSION = "0.1.12";

export const BridgeHelloPayload = Schema.Struct({
  protocolVersion: Schema.String,
  sdkVersion: Schema.String,
  pythonVersion: Schema.String,
  platform: Schema.String,
  arch: Schema.String,
  supportedFeatures: Schema.Array(Schema.String),
});
export type BridgeHelloPayload = typeof BridgeHelloPayload.Type;

export const BridgeProbeResult = Schema.Struct({
  ready: Schema.Boolean,
  sdkVersion: Schema.String,
  protocolVersion: Schema.String,
  defaultModel: Schema.String,
  authMode: Schema.String,
  pythonVersion: Schema.String,
});
export type BridgeProbeResult = typeof BridgeProbeResult.Type;

export const BridgeSessionStartResult = Schema.Struct({
  sessionId: Schema.String,
  conversationId: Schema.String,
  model: Schema.String,
});
export type BridgeSessionStartResult = typeof BridgeSessionStartResult.Type;

export const BridgeTurnStartResult = Schema.Struct({
  turnId: Schema.String,
  status: Schema.String,
});
export type BridgeTurnStartResult = typeof BridgeTurnStartResult.Type;

export const BridgeMcpServerConfig = Schema.Struct({
  name: Schema.String,
  transport: Schema.Literal("http"),
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
});
export type BridgeMcpServerConfig = typeof BridgeMcpServerConfig.Type;

export const BridgeApprovalRequestedPayload = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  requestId: Schema.String,
  toolName: Schema.String,
  args: Schema.Record(Schema.String, Schema.Unknown),
  itemType: Schema.String,
  message: Schema.optionalKey(Schema.String),
  serverId: Schema.optionalKey(Schema.String),
  upstreamToolName: Schema.optionalKey(Schema.String),
  canonicalToolName: Schema.optionalKey(Schema.String),
  providerToolName: Schema.optionalKey(Schema.String),
});
export type BridgeApprovalRequestedPayload = typeof BridgeApprovalRequestedPayload.Type;

export const BridgeQuestionOption = Schema.Union([
  Schema.String,
  Schema.Struct({
    label: Schema.String,
    description: Schema.optionalKey(Schema.String),
  }),
]);

export const BridgeQuestionItem = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  header: Schema.optionalKey(Schema.String),
  question: Schema.String,
  options: Schema.Array(BridgeQuestionOption),
  is_multi_select: Schema.optionalKey(Schema.Boolean),
  multiSelect: Schema.optionalKey(Schema.Boolean),
});

export const BridgeUserInputRequestedPayload = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  requestId: Schema.String,
  questions: Schema.Array(BridgeQuestionItem),
});
export type BridgeUserInputRequestedPayload = typeof BridgeUserInputRequestedPayload.Type;

export const BridgeUsageUpdatedPayload = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedInputTokens: Schema.optionalKey(Schema.Number),
  reasoningOutputTokens: Schema.optionalKey(Schema.Number),
  totalTurnTokens: Schema.optionalKey(Schema.Number),
  totalProcessedTokens: Schema.optionalKey(Schema.Number),
});
export type BridgeUsageUpdatedPayload = typeof BridgeUsageUpdatedPayload.Type;

export const BridgeTurnCompletedPayload = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  state: Schema.Literals(["completed", "cancelled", "failed"]),
  stopReason: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
});
export type BridgeTurnCompletedPayload = typeof BridgeTurnCompletedPayload.Type;

export const BridgeContentDeltaPayload = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  delta: Schema.String,
});
export type BridgeContentDeltaPayload = typeof BridgeContentDeltaPayload.Type;

export const BridgeReasoningDeltaPayload = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  delta: Schema.String,
});
export type BridgeReasoningDeltaPayload = typeof BridgeReasoningDeltaPayload.Type;

export const BridgeToolStartedPayload = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  callId: Schema.String,
  toolName: Schema.String,
  args: Schema.Record(Schema.String, Schema.Unknown),
  isMcp: Schema.optionalKey(Schema.Boolean),
  serverId: Schema.optionalKey(Schema.String),
  upstreamToolName: Schema.optionalKey(Schema.String),
  canonicalToolName: Schema.optionalKey(Schema.String),
  providerToolName: Schema.optionalKey(Schema.String),
});
export type BridgeToolStartedPayload = typeof BridgeToolStartedPayload.Type;

export const BridgeToolCompletedPayload = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  callId: Schema.String,
  toolName: Schema.String,
  result: Schema.Unknown,
  isMcp: Schema.optionalKey(Schema.Boolean),
  serverId: Schema.optionalKey(Schema.String),
  upstreamToolName: Schema.optionalKey(Schema.String),
  canonicalToolName: Schema.optionalKey(Schema.String),
  providerToolName: Schema.optionalKey(Schema.String),
});
export type BridgeToolCompletedPayload = typeof BridgeToolCompletedPayload.Type;

export const BridgeToolFailedPayload = Schema.Struct({
  sessionId: Schema.String,
  turnId: Schema.String,
  callId: Schema.String,
  toolName: Schema.String,
  error: Schema.String,
  isMcp: Schema.optionalKey(Schema.Boolean),
  serverId: Schema.optionalKey(Schema.String),
  upstreamToolName: Schema.optionalKey(Schema.String),
  canonicalToolName: Schema.optionalKey(Schema.String),
  providerToolName: Schema.optionalKey(Schema.String),
});
export type BridgeToolFailedPayload = typeof BridgeToolFailedPayload.Type;

export type BridgeNotification =
  | { readonly method: "bridge.hello"; readonly params: BridgeHelloPayload }
  | { readonly method: "session.ready"; readonly params: { readonly sessionId: string; readonly conversationId: string } }
  | { readonly method: "turn.started"; readonly params: { readonly sessionId: string; readonly turnId: string; readonly model?: string } }
  | { readonly method: "content.delta"; readonly params: BridgeContentDeltaPayload }
  | { readonly method: "reasoning.delta"; readonly params: BridgeReasoningDeltaPayload }
  | { readonly method: "tool.started"; readonly params: BridgeToolStartedPayload }
  | { readonly method: "tool.completed"; readonly params: BridgeToolCompletedPayload }
  | { readonly method: "tool.failed"; readonly params: BridgeToolFailedPayload }
  | { readonly method: "approval.requested"; readonly params: BridgeApprovalRequestedPayload }
  | { readonly method: "user_input.requested"; readonly params: BridgeUserInputRequestedPayload }
  | { readonly method: "usage.updated"; readonly params: BridgeUsageUpdatedPayload }
  | { readonly method: "turn.completed"; readonly params: BridgeTurnCompletedPayload }
  | { readonly method: "runtime.warning"; readonly params: { readonly message: string } };
