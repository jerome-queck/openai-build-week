import type {
  CorroborationPass,
  EvidenceTransfer,
  EvidenceTransferContext,
  InteractionPreferenceReuse,
  PriorUnderstandingEvidence,
  QuestionContextItem,
  SessionAccessScope,
  SourceAnchorSelection,
  TeachingMove
} from "./learning-application";

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
  evidenceTransferContext?: EvidenceTransferContext | null;
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
  adaptiveTeaching?: Pick<TeachingMove, "kind" | "route" | "reason">;
  learnerModelGuidance?: {
    evidenceTransfers: EvidenceTransfer[];
    priorUnderstandingEvidence: PriorUnderstandingEvidence[];
    interactionPreferences: InteractionPreferenceReuse[];
  };
  corroboration: TeachingCorroborationContext | null;
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

export type TeachingCorroborationContext = Pick<CorroborationPass,
  | "relevantResult" | "assumptionComparison" | "conclusionComparison" | "errataCheck" | "independentSupport" | "message"
> & { status: Exclude<CorroborationPass["status"], "running"> };

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

export interface DelayedTransferTask {
  prompt: string;
  concept: string;
  taskDemand: string;
  structuralComparison: string;
  mathematicalContext: EvidenceTransferContext;
}

export interface DelayedTransferTaskRequest {
  checkId: string;
  originatingSessionId: string;
  originatingLearningGoal: string;
  originatingSessionTarget: string;
  originatingConcepts: string[];
  intendedTransferGoal: string;
  originatingMathematics: string;
  signal: AbortSignal;
  onRuntimeEvent?(event: ModelRuntimeEvent): void;
}

export interface DelayedTransferClarificationRequest {
  checkId: string;
  task: DelayedTransferTask;
  question: string;
  signal: AbortSignal;
  onRuntimeEvent?(event: ModelRuntimeEvent): void;
}

export interface DelayedTransferAssessment {
  result: "demonstrated" | "partial" | "difficulty";
  reasoningQuality: "strong" | "developing" | "unclear";
  confidenceCalibration: "aligned" | "overconfident" | "underconfident" | "notExpressed";
  misconceptionOrStrength: string;
  recommendedNextAction: string;
  refresherGoal: string | null;
}

export interface DelayedTransferAssessmentRequest {
  checkId: string;
  task: DelayedTransferTask;
  work: string;
  reasoning: string;
  confidence: "low" | "medium" | "high" | null;
  clarifications: Array<{ question: string; response: string }>;
  signal: AbortSignal;
  onRuntimeEvent?(event: ModelRuntimeEvent): void;
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
  onTokenUsage?(totalTokens: number): void;
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
  createDelayedTransferTask(request: DelayedTransferTaskRequest): Promise<DelayedTransferTask>;
  clarifyDelayedTransferTask(request: DelayedTransferClarificationRequest): Promise<string>;
  assessDelayedTransferWork(request: DelayedTransferAssessmentRequest): Promise<DelayedTransferAssessment>;
  createConceptPeek(request: ConceptPeekRequest): Promise<string>;
  synthesizeArtifact(request: ArtifactSynthesisRequest): Promise<ArtifactSynthesisResult>;
  runSpecialistAgent(request: SpecialistAgentRequest): Promise<SpecialistAgentResult>;
  streamTeaching(request: TeachingRequest): Promise<void>;
  cancelTeaching(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export function isEvidenceTransferContext(value: unknown): value is EvidenceTransferContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;
  return [context.concepts, context.mathematicalStructures, context.taskDemands]
    .every((terms) => Array.isArray(terms)
      && terms.every((term) => typeof term === "string" && Boolean(term.trim())))
    && Array.isArray(context.prerequisiteRelationships)
    && context.prerequisiteRelationships.every((relationship) => {
      if (!relationship || typeof relationship !== "object") return false;
      const candidate = relationship as Record<string, unknown>;
      return typeof candidate.prerequisiteConcept === "string" && Boolean(candidate.prerequisiteConcept.trim())
        && typeof candidate.supportsConcept === "string" && Boolean(candidate.supportsConcept.trim())
        && candidate.relationship === "requiredFor";
    });
}

export function isCompleteEvidenceTransferContext(value: unknown): value is EvidenceTransferContext {
  return isEvidenceTransferContext(value) && value.concepts.length > 0
    && value.mathematicalStructures.length > 0 && value.prerequisiteRelationships.length > 0
    && value.taskDemands.length > 0;
}
