export type HarnessSoundEvent = "error" | "permission" | "finished" | "question";

export interface HarnessSoundSnapshot {
  readonly threadKey: string | null;
  readonly completedAt: string | null;
  readonly error: string | null;
  readonly approvalRequestId: string | null;
  readonly questionRequestId: string | null;
}

export const HARNESS_SOUND_URLS: Readonly<Record<HarnessSoundEvent, string>> = {
  error: "/sounds/error.mp3",
  permission: "/sounds/permission.mp3",
  finished: "/sounds/finished.mp3",
  question: "/sounds/question.mp3",
};

export function resolveHarnessSoundEvent(
  previous: HarnessSoundSnapshot,
  current: HarnessSoundSnapshot,
): HarnessSoundEvent | null {
  if (previous.threadKey !== current.threadKey || current.threadKey === null) return null;
  if (current.error !== null && current.error !== previous.error) return "error";
  if (
    current.approvalRequestId !== null &&
    current.approvalRequestId !== previous.approvalRequestId
  ) {
    return "permission";
  }
  if (
    current.questionRequestId !== null &&
    current.questionRequestId !== previous.questionRequestId
  ) {
    return "question";
  }
  if (current.completedAt !== null && current.completedAt !== previous.completedAt)
    return "finished";
  return null;
}
