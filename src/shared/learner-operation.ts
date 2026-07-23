import type { LearnerAction, LearningApplicationState } from "./learning-application";

export type LearnerOperationKind = "sessionProposal" | "modelTeaching" | "accessTransition";
export type LearnerOperationPhase =
  | "proposing"
  | "preparingTeaching"
  | "streamingTeaching"
  | "waitingForAccessDecision"
  | "awaitingFullAccessConfirmation"
  | "changingAccessPolicy";

export interface LearnerOperationRecord {
  id: string;
  kind: LearnerOperationKind;
  phase: LearnerOperationPhase;
  sessionId: string | null;
  label: string;
}

export interface QueuedLearnerAction {
  id: string;
  type: LearnerAction["type"];
  sessionId: string | null;
  label: string;
}

export interface LearnerOperationFeedback {
  id: string;
  actionType: LearnerAction["type"];
  disposition: Exclude<LearnerActionDisposition, "allowed">;
  message: string;
}

export interface LearnerOperationState {
  active: LearnerOperationRecord | null;
  queued: QueuedLearnerAction[];
  feedback: LearnerOperationFeedback | null;
}

export type LearnerActionDisposition = "allowed" | "blocked" | "queued" | "superseded";

export interface LearnerActionAvailability {
  disposition: LearnerActionDisposition;
  message: string;
  label: string;
}

export function idleLearnerOperationState(): LearnerOperationState {
  return { active: null, queued: [], feedback: null };
}

export function learnerActionAvailability(
  state: LearningApplicationState,
  action: LearnerAction
): LearnerActionAvailability {
  const active = state.learnerOperation.active;
  const sessionId = actionSessionId(action, state.activeSessionId);
  const session = sessionId ? state.sessions.find((candidate) => candidate.id === sessionId) : null;
  const actionLabel = learnerActionLabel(action);

  if (action.type === "decideFullAccessConfirmation") {
    const confirmation = session?.pendingFullAccessConfirmationId;
    if (!session?.pendingFullAccessConfirmation || !confirmation) {
      return blocked(actionLabel, "There is no current Full Access confirmation.");
    }
    if (action.confirmationId !== confirmation) {
      return superseded(actionLabel, "This Full Access confirmation was superseded. Use the fresh confirmation shown for this Learning Session.");
    }
    return allowed(actionLabel);
  }

  if (action.type === "decideAccessRequest") {
    if (!session?.accessRequests.some((request) => request.id === action.requestId && request.status === "pending")) {
      return blocked(actionLabel, "This Access Request is no longer pending.");
    }
    return allowed(actionLabel);
  }

  if (action.type === "cancelModelWork" || action.type === "cancelSessionModelWork"
    || action.type === "retrySessionModelStop") {
    return allowed(actionLabel);
  }

  if (action.type === "selectSessionAccessPolicy") {
    if (session?.pendingFullAccessConfirmation && active?.kind === "accessTransition" && action.policy === "full") {
      return queued(actionLabel, "The current Full Access decision is settling. This fresh request will be queued behind it.");
    }
    if (session?.pendingFullAccessConfirmation || session?.accessRequests.some((request) => request.status === "pending")) {
      return blocked(actionLabel, "Finish the current Access transition before choosing another Session Access Policy.");
    }
  }

  if (!active) return allowed(actionLabel);

  if (isModelAction(action)) {
    if (action.type === "createSourceAnchor" && (action.paletteAction === "explain" || action.paletteAction === "question")) {
      return queued(actionLabel, `${active.label} is active. ${actionLabel} will be queued and start when it settles.`);
    }
    if (action.type === "submitSessionIntake" || action.type === "startQuickStudy") {
      return queued(actionLabel, `${active.label} is active. This Learning Session request will be queued and preserved.`);
    }
    return blocked(actionLabel, `${active.label} is active. Finish it before starting ${actionLabel.toLocaleLowerCase()}.`);
  }

  if (active.kind === "accessTransition") {
    return blocked(actionLabel, `The Session Access Policy is changing. Finish that transition before ${actionLabel.toLocaleLowerCase()}.`);
  }

  return allowed(actionLabel);
}

export function learnerActionLabel(action: LearnerAction): string {
  if (action.type === "createSourceAnchor") {
    return action.paletteAction === "explain" ? "anchored explanation"
      : action.paletteAction === "question" ? "anchored question" : "Source Anchor action";
  }
  if (action.type === "submitSessionIntake" || action.type === "startQuickStudy") return "new Learning Session";
  if (action.type === "selectSessionAccessPolicy") return "Session Access Policy change";
  if (action.type === "decideFullAccessConfirmation") return "Full Access confirmation";
  if (action.type === "decideAccessRequest") return "Access Request decision";
  if (action.type === "submitQuestion" || action.type === "submitPendingQuestion") return "Question Card";
  if (action.type === "reviseTeachingCard" || action.type === "retryAnchoredTeachingCard") return "Teaching Card revision";
  return action.type.replace(/[A-Z]/g, (letter) => ` ${letter.toLocaleLowerCase()}`);
}

function isModelAction(action: LearnerAction): boolean {
  return action.type === "submitSessionIntake" || action.type === "startQuickStudy"
    || action.type === "submitQuestion" || action.type === "submitPendingQuestion"
    || action.type === "reviseTeachingCard" || action.type === "createTeachingVariant"
    || action.type === "retryAnchoredTeachingCard" || action.type === "requestSpecialistReview"
    || action.type === "retryModelWork" || action.type === "resumeAgentTask"
    || action.type === "retryAgentTask" || action.type === "createSourceAnchor"
      && (action.paletteAction === "explain" || action.paletteAction === "question");
}

function actionSessionId(action: LearnerAction, activeSessionId: string | null): string | null {
  return "sessionId" in action && typeof action.sessionId === "string" ? action.sessionId : activeSessionId;
}

function allowed(label: string): LearnerActionAvailability {
  return { disposition: "allowed", message: "", label };
}

function blocked(label: string, message: string): LearnerActionAvailability {
  return { disposition: "blocked", message, label };
}

function queued(label: string, message: string): LearnerActionAvailability {
  return { disposition: "queued", message, label };
}

function superseded(label: string, message: string): LearnerActionAvailability {
  return { disposition: "superseded", message, label };
}
