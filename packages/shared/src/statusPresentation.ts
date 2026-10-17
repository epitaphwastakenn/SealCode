export const THREAD_STATE_KEYS = [
  "working",
  "connecting",
  "needs-approval",
  "needs-input",
  "plan-ready",
  "monitoring",
  "completed",
  "failed",
  "stopped",
  "ready",
] as const;

export type ThreadStateKey = (typeof THREAD_STATE_KEYS)[number];

export interface StatePresentation {
  readonly label: string;
  readonly shortLabel: string;
  readonly tone: "info" | "attention" | "success" | "danger" | "muted";
  readonly live: boolean;
}

const STATE_PRESENTATIONS: Record<ThreadStateKey, StatePresentation> = {
  working: { label: "Working", shortLabel: "Working", tone: "info", live: true },
  connecting: { label: "Connecting", shortLabel: "Connecting", tone: "info", live: true },
  "needs-approval": {
    label: "Needs approval",
    shortLabel: "Approval",
    tone: "attention",
    live: false,
  },
  "needs-input": {
    label: "Needs input",
    shortLabel: "Input",
    tone: "attention",
    live: false,
  },
  "plan-ready": { label: "Plan ready", shortLabel: "Plan", tone: "info", live: false },
  monitoring: { label: "Monitoring", shortLabel: "Monitoring", tone: "info", live: false },
  completed: { label: "Completed", shortLabel: "Done", tone: "success", live: false },
  failed: { label: "Failed", shortLabel: "Failed", tone: "danger", live: false },
  stopped: { label: "Stopped", shortLabel: "Stopped", tone: "muted", live: false },
  ready: { label: "Ready", shortLabel: "Ready", tone: "muted", live: false },
};

export function presentThreadState(state: ThreadStateKey): StatePresentation {
  return STATE_PRESENTATIONS[state];
}

export type RuntimeSubagentStatus =
  | "pending"
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export function stateForRuntimeSubagentStatus(status: RuntimeSubagentStatus): ThreadStateKey {
  switch (status) {
    case "pending":
    case "running":
    case "waiting":
      return "working";
    case "idle":
      return "ready";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
    case "interrupted":
      return "stopped";
  }
}

export type AgentActivityPhase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "stale";

export function stateForAgentActivityPhase(phase: AgentActivityPhase): ThreadStateKey {
  switch (phase) {
    case "starting":
      return "connecting";
    case "running":
      return "working";
    case "waiting_for_approval":
      return "needs-approval";
    case "waiting_for_input":
      return "needs-input";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stale":
      return "monitoring";
  }
}
