import type { QuestionContextItem, SessionAccessScope, SourceAnchorSelection } from "./learning-application";

export type AuthenticationMethod = "chatgpt" | "apiKey";
export type ModelAccessCause = "network" | "authentication" | "subscriptionCapacity" | "quota" | "runtime";

export class ModelAccessError extends Error {
  constructor(readonly cause: ModelAccessCause, message: string) {
    super(message);
    this.name = "ModelAccessError";
  }
}

export type AuthenticationState =
  | { status: "signedOut" }
  | { status: "signingIn"; method: AuthenticationMethod }
  | { status: "signedIn"; method: AuthenticationMethod; accountLabel: string | null }
  | { status: "failed"; method: AuthenticationMethod | null; error: string };

export interface ChatGptLogin {
  loginId: string;
  authUrl: string;
}

export interface SessionProposal {
  learningGoal: string;
  scope: string;
  initialTeachingDirection: string;
  requiresConfirmation: boolean;
  confirmationReason: string | null;
  materialScope?: "focused" | "longOrMultiStage";
  argumentRoadmap?: ArgumentRoadmapProposal | null;
}

export interface ArgumentRoadmapProposal {
  title: string;
  stages: ArgumentRoadmapStageProposal[];
  proposedStage: number;
}

export interface ArgumentRoadmapStageProposal {
  title: string;
  majorClaim: string;
  dependsOn: number[];
  sourceExcerpt: string;
  learningGoal: string;
  boundary: string;
  immediatePrerequisites: string[];
}

export interface RuntimeAccessRequest {
  requestedPolicy: "workspace" | "full";
  reason: string;
  exactScope: string;
  intendedAction: string;
}

export interface RuntimeAccessDecision {
  status: "approved" | "narrowed" | "denied";
  policy: "focused" | "workspace" | "full";
}

export interface TeachingSourceContext {
  sourceId: string;
  name: string;
  mediaType: string;
  content: string;
}

export interface TeachingRequest {
  sessionId: string;
  mathematics: string;
  learningGoal: string;
  scope: string;
  initialTeachingDirection: string;
  learningSlice?: {
    roadmapTitle: string;
    stageTitle: string;
    boundary: string;
    immediatePrerequisites: string[];
    remainingStageTitles: string[];
  };
  accessScope: SessionAccessScope;
  sourceContext: TeachingSourceContext[];
  questionContext?: QuestionContextItem[];
  questionRevision?: { previousQuestion: string; previousContent: string };
  focus?: {
    kind: "sourceAnchor";
    sourceAnchorId: string;
    sourceId: string;
    selection: SourceAnchorSelection;
    instruction: string;
    previousContent: string | null;
    variantName: string | null;
  };
  onAccessRequest(request: RuntimeAccessRequest): Promise<RuntimeAccessDecision>;
  onDelta(delta: string): void;
  onRuntimeEvent?(event: ModelRuntimeEvent): void;
  signal: AbortSignal;
}

export interface ConceptPeekRequest {
  sessionId: string;
  prerequisite: string;
  mathematics: string;
  learningGoal: string;
  sourceAnchorId: string;
  sourceId: string;
  selection: SourceAnchorSelection;
  signal: AbortSignal;
  onRuntimeEvent?(event: ModelRuntimeEvent): void;
}

export interface ModelRuntimeEvent {
  type: "threadStarted" | "turnStarted" | "inputSubmitted" | "outputDelta" | "turnCompleted" | "turnFailed";
  threadId: string;
  turnId: string | null;
  detail: string;
}

export interface ModelRuntime {
  getAuthentication(): Promise<AuthenticationState>;
  startChatGptLogin(): Promise<ChatGptLogin>;
  loginWithApiKey(apiKey: string): Promise<void>;
  proposeSession(mathematics: string, onRuntimeEvent?: (event: ModelRuntimeEvent) => void): Promise<SessionProposal>;
  createConceptPeek(request: ConceptPeekRequest): Promise<string>;
  streamTeaching(request: TeachingRequest): Promise<void>;
  cancelTeaching(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}
