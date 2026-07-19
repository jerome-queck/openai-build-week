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
  runtimeSelection: {
    model: "runtimeDefault" | string;
    reasoningEffort: ReasoningEffort;
  };
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
  tutorFeedback?: Array<{ annotationId: string; sourceAnchorId: string; content: string }>;
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

export interface ArtifactSynthesisRequest {
  sessionId: string;
  learningGoal: string;
  artifactTitle: string;
  artifactContent: string;
  personalNotes: Array<{
    annotationId: string;
    sourceAnchorId: string;
    content: string;
  }>;
  signal: AbortSignal;
  onRuntimeEvent?(event: ModelRuntimeEvent): void;
}

export interface ArtifactSynthesisResult {
  content: string;
  noteInterpretations: Array<{
    annotationId: string;
    interpretation: string;
  }>;
}

export interface AgentBrief {
  learningGoal: string;
  sourceAnchors: Array<{
    sourceAnchorId: string;
    sourceId: string;
    selection: SourceAnchorSelection;
  }>;
  constraints: string[];
  learnerEvidence: string[];
  expectedOutput: string;
  verificationNeeds: string[];
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export interface RuntimeModelCapability {
  model: string;
  displayName: string;
  isDefault: boolean;
  supportedReasoningEfforts: ReasoningEffort[];
}

export interface ModelRuntimeCapabilities {
  models: RuntimeModelCapability[];
}

export interface AgentBudget {
  agentCount: number;
  concurrency: number;
  model: "runtimeDefault" | string;
  reasoningEffort: ReasoningEffort;
  tools: ["checkpointSpecialistResult"];
  maxTokens: number;
  maxLatencyMs: number;
}

export interface SpecialistAgentRequest {
  sessionId: string;
  purpose: string;
  brief: AgentBrief;
  budget: AgentBudget;
  signal: AbortSignal;
  onStatus(status: "working" | "waiting", message: string | null): void;
  onPartialResult(content: string): void;
  onRuntimeEvent?(event: ModelRuntimeEvent): void;
}

export interface SpecialistAgentResult {
  title: string;
  content: string;
}

export interface ModelRuntimeEvent {
  type: "threadStarted" | "turnStarted" | "inputSubmitted" | "toolCalled" | "outputDelta" | "turnCompleted" | "turnFailed";
  workKind?: "teaching" | "specialist";
  threadId: string;
  turnId: string | null;
  detail: string;
}

export interface ModelRuntime {
  getCapabilities(): Promise<ModelRuntimeCapabilities>;
  getAuthentication(): Promise<AuthenticationState>;
  startChatGptLogin(): Promise<ChatGptLogin>;
  loginWithApiKey(apiKey: string): Promise<void>;
  proposeSession(mathematics: string, onRuntimeEvent?: (event: ModelRuntimeEvent) => void): Promise<SessionProposal>;
  createConceptPeek(request: ConceptPeekRequest): Promise<string>;
  synthesizeArtifact(request: ArtifactSynthesisRequest): Promise<ArtifactSynthesisResult>;
  runSpecialistAgent(request: SpecialistAgentRequest): Promise<SpecialistAgentResult>;
  streamTeaching(request: TeachingRequest): Promise<void>;
  cancelTeaching(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}
