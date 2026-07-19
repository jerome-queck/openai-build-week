import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  ModelAccessError,
  type ArtifactSynthesisResult,
  type AgentBrief,
  type AgentBudget,
  type AuthenticationState,
  type ModelAccessCause,
  type ModelRuntime,
  type ModelRuntimeCapabilities,
  type ModelRuntimeEvent,
  type ReasoningEffort,
  type RuntimeAccessDecision,
  type RuntimeAccessRequest,
  type TeachingRequest,
  type TeachingSourceContext,
  type SessionProposal,
  type ArgumentRoadmapProposal,
  type SpecialistAgentResult
} from "./model-runtime";
import { annotationPurposeLabel, type AnnotationPurpose, type SourceAnnotation } from "./annotations";
export type { AnnotationPurpose, SourceAnnotation } from "./annotations";
import { sessionAccessPolicyLabel, type SessionAccessPolicy } from "./session-access";
import { coordinateAgentTasks } from "./agent-task-coordinator";
export type { SessionAccessPolicy } from "./session-access";

const MAX_TEACHING_SOURCE_CONTEXT_CHARACTERS = 60_000;
// Preserve issue #22's shipped numeric safety bounds while the broader supported-macOS benchmark work
// in parent issue #2 remains pending. #23 applies the token number to runtime-reported total use, making
// the inherited bound deliberately conservative instead of presenting it as an empirical universal threshold.
const BOUNDED_SPECIALIST_BUDGET_V1 = Object.freeze({ maxTokens: 512, maxLatencyMs: 120_000 });

export type SessionStatus = "active" | "paused" | "consolidated";
export type TargetDisposition = "addressed" | "deferred" | "unresolved";
export type ReasoningPreference = "faster" | "balanced" | "deeper";
export interface RuntimeOverride { model: string; reasoningEffort: ReasoningEffort }

export interface SessionAccessScope {
  policy: SessionAccessPolicy;
  sourceIds: string[];
  allowsBroadLocalRead: boolean;
  allowsSourceModification: false;
}

export interface SessionAccessRequest {
  id: string;
  requestedPolicy: Exclude<SessionAccessPolicy, "focused">;
  reason: string;
  exactScope: string;
  intendedAction: string;
  status: "pending" | "approved" | "denied" | "narrowed";
  decidedPolicy: SessionAccessPolicy | null;
}

export type ModelAccessState =
  | { status: "available" }
  | { status: "unavailable"; cause: ModelAccessCause; message: string };

export interface PendingQuestion {
  id: string;
  text: string;
  contextIds: string[];
}

export type QuestionContextKind = "sourceAnchor" | "learningGoal" | "sessionContext" | "source";

export interface QuestionContextItem {
  id: string;
  kind: QuestionContextKind;
  typeLabel: string;
  identity: string;
  location: string;
  preview: string;
  sourceId: string | null;
  sourceAnchorId: string | null;
}

export interface AskBarContext {
  items: QuestionContextItem[];
  includedIds: string[];
  customized: boolean;
}

export interface QuestionCardRevision extends TeachingCardState {
  id: string;
  question: string;
  selectedContext: QuestionContextItem[];
  contextUsed: QuestionContextItem[];
  agentWorkLogReference: TeachingCardRevision["agentWorkLogReference"];
}

export interface QuestionCard {
  id: string;
  question: string;
  currentRevision: QuestionCardRevision;
  revisions: QuestionCardRevision[];
}

export type SourceAnchorPaletteAction = "explain" | "question" | "addNote" | "tellTutor" | "addToLearningTrail";

export interface SourceTextLocation {
  startOffset: number;
  endOffset: number;
  exactText: string;
  prefix: string;
  suffix: string;
}

export interface NormalizedSourceRegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SourceAnchorSelection =
  | ({ kind: "text" } & SourceTextLocation)
  | ({
      kind: "equation";
      equationIndex: number;
    } & SourceTextLocation)
  | {
      kind: "diagramRegion";
      bounds: NormalizedSourceRegionBounds;
    };

export interface SourceAnchor {
  id: string;
  sourceId: string;
  sourceRevisionId: string | null;
  selection: SourceAnchorSelection;
}

export interface ReanchoringDecision {
  id: string;
  sessionId: string;
  sourceId: string;
  sourceAnchorId: string;
  fromRevisionId: string | null;
  toRevisionId: string;
  oldSelection: SourceAnchorSelection;
  proposedSelection: SourceAnchorSelection | null;
  status: "automatic" | "learnerConfirmed" | "unresolved" | "leftUnresolved";
}

export interface SourceAnchorRequest {
  id: string;
  sourceAnchorId: string;
  action: SourceAnchorPaletteAction;
}

export interface SubmittedPendingQuestion {
  id: string;
  text: string;
  teachingCard: TeachingCardState;
}

export interface TeachingCardState {
  status: "idle" | "streaming" | "completed" | "stopped" | "failed";
  content: string;
  error: string | null;
  retryable: boolean;
}

export interface TeachingCardRevision extends TeachingCardState {
  id: string;
  instruction: string;
  contextUsed: Array<{
    sourceId: string;
    sourceName: string;
    location: string;
  }>;
  agentWorkLogReference: {
    sessionId: string;
    fromSequence: number;
    toSequence: number;
  } | null;
}

export interface TeachingVariant {
  id: string;
  name: string;
  revision: TeachingCardRevision;
}

export interface AnchoredTeachingCard {
  id: string;
  sourceAnchorId: string;
  title: string;
  currentRevision: TeachingCardRevision;
  revisions: TeachingCardRevision[];
  variants: TeachingVariant[];
  artifactId: string | null;
}

export interface LearningArtifact {
  id: string;
  title: string;
  kind: "learningArtifact" | "reformulatedProof";
  originatingSessionId: string;
  currentRevision: LearningArtifactRevision;
  revisions: LearningArtifactRevision[];
  sourceAnchorIds: string[];
  pinned: true;
}

export interface LearningArtifactRevision {
  id: string;
  content: string;
  claimOrigin: "modelGenerated" | "learner" | "mixed";
  verificationLevel: "notIndependentlyChecked";
  verificationCurrency: "current";
  personalNoteContributions: PersonalNoteContribution[];
  provenance: {
    action: "promoted" | "edited" | "restored" | "synthesized";
    createdAt: string | null;
    priorRevisionId: string | null;
  };
}

export interface PersonalNoteContribution {
  annotationId: string;
  sourceAnchorId: string;
  verbatim: string;
  interpretation: string | null;
}

export interface ArtifactPortableCopy {
  artifactId: string;
  originatingSessionId: string;
  suggestedFilename: string;
  mediaType: "text/markdown";
  content: string;
}

export type ArtifactExportResult = { status: "canceled" } | { status: "exported"; path: string };
export interface ArtifactShareResult { status: "shared"; path: string }
export interface ArtifactSharing {
  share(copy: ArtifactPortableCopy): Promise<ArtifactShareResult>;
}

export const TRAIL_ITEM_KINDS = [
  "concept", "reasoningStep", "learningArtifact", "evidence", "unresolvedQuestion", "nextStep"
] as const;
export type TrailItemKind = typeof TRAIL_ITEM_KINDS[number];

export interface TrailItemLinks {
  sourceAnchorIds: string[];
  teachingCardIds: string[];
  learningArtifactIds: string[];
  understandingEvidenceIds: string[];
}

export interface TrailItem {
  id: string;
  kind: TrailItemKind;
  content: string;
  required: boolean;
  origin: "learner" | "teachingAgent";
  links: TrailItemLinks;
  curationKey: string | null;
}

export interface TrailDraft {
  items: TrailItem[];
}

export interface SessionConsolidationDraft {
  centralInsight: string;
  learningProgress: string;
  unresolvedQuestions: string[];
  nextStep: string;
  includedArtifactIds: string[];
  targetDisposition: TargetDisposition | null;
}

export interface ConsolidatedSessionOutcome extends Omit<SessionConsolidationDraft, "targetDisposition"> {
  id: string;
  targetDisposition: TargetDisposition;
  trailItems: TrailItem[];
}

export interface ContinuationLink {
  sessionId: string;
  outcomeId: string;
}

export interface ModelStopConfirmation {
  attemptId: string;
  status: "pending" | "unconfirmed";
  message: string;
}

export interface AgentWorkLogEvidence {
  sequence: number;
  type: ModelRuntimeEvent["type"];
  summary: string;
}

export type AgentTaskStatus = "working" | "waiting" | "failed" | "stopped" | "complete";
export const AGENT_TASK_COORDINATIONS = ["single", "dependent", "independent"] as const;
export type AgentTaskCoordination = typeof AGENT_TASK_COORDINATIONS[number];

export function isAgentTaskCoordination(value: unknown): value is AgentTaskCoordination {
  return AGENT_TASK_COORDINATIONS.includes(value as AgentTaskCoordination);
}

export interface AgentTask {
  id: string;
  purpose: string;
  status: AgentTaskStatus;
  statusMessage: string | null;
  identifiedNeed: {
    kind: "hiddenAssumptionReview";
    requestedBy: "learner";
    description: string;
  };
  brief: AgentBrief;
  specialistBriefs: AgentBrief[];
  coordination: AgentTaskCoordination;
  budget: AgentBudget;
  integratedTeachingCard: TeachingCardState & { title: string };
  agentWorkLogReference: TeachingCardRevision["agentWorkLogReference"];
  priorAgentWorkLogReferences: Array<NonNullable<TeachingCardRevision["agentWorkLogReference"]>>;
}

interface ModelTeachingTarget {
  start(sourceContext: TeachingSourceContext[], nextLogSequence: number): void;
  isStreaming(): boolean;
  append(delta: string): void;
  complete(): void;
  fail(error: unknown): void;
  stop(): void;
  markUnconfirmed(): void;
  recordRuntimeSequence(sequence: number): void;
}

export interface SessionSearchResult {
  sessionId: string;
  workspaceId: string;
  missionId: string;
  learningGoal: string;
  sessionTarget: string;
  workspaceName: string;
  missionName: string;
  status: SessionStatus;
}

export interface SourceIndexBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceIndexRegion {
  kind: "text" | "equation";
  text: string;
  bounds: SourceIndexBounds;
  sourceStartOffset?: number;
  sourceEndOffset?: number;
}

export interface SourceIndexPage {
  pageNumber: number;
  width: number;
  height: number;
  thumbnailDataUrl: string;
  regions: SourceIndexRegion[];
}

export interface SourceIndexExtraction {
  extractionMethod: "embeddedText" | "pdfText" | "ocr";
  pages: SourceIndexPage[];
}

export interface SourceIndexExtractionResult extends SourceIndexExtraction {
  fingerprint: SourceFingerprint;
  linkRefresh?: SourceLinkRefresh;
}

export interface SourceIndexSummary {
  sourceId: string;
  status: "ready" | "cleared" | "unavailable";
  extractionMethod: SourceIndexExtraction["extractionMethod"] | null;
  pageCount: number;
  equationCount: number;
  error: string | null;
}

export interface SourceSearchResult {
  id: string;
  sourceId: string;
  sourceName: string;
  workspaceName: string;
  locationLabel: string;
  preview: string;
  thumbnailDataUrl: string;
  match: {
    pageNumber: number;
    bounds: SourceIndexBounds;
    kind: SourceIndexRegion["kind"];
    sourceStartOffset?: number;
    sourceEndOffset?: number;
  };
}

export type OpenedSourceSearchResult = LinkedSourceView & {
  highlight?: {
    pageNumber: number;
    exactText: string;
    bounds: SourceIndexBounds;
    thumbnailDataUrl: string;
    sourceStartOffset?: number;
    sourceEndOffset?: number;
  };
};

interface CachedSourceIndexRegion extends Omit<SourceIndexRegion, "text"> {
  termHashes: string[];
}

interface CachedSourceIndexPage extends Omit<SourceIndexPage, "regions"> {
  regions: CachedSourceIndexRegion[];
}

interface SourceIndexDocument {
  sourceId: string;
  sourceName: string;
  workspaceId: string;
  fingerprint: SourceFingerprint;
  extractionMethod: SourceIndexExtraction["extractionMethod"];
  pages: CachedSourceIndexPage[];
}

export interface QuickStudyHome {
  workspace: {
    id: "quick-study-workspace";
    kind: "system";
    name: "Quick Study";
  };
  mission: {
    id: "quick-study-unfiled-mission";
    kind: "unfiled";
    workspaceId: "quick-study-workspace";
  };
}

export interface StudyWorkspace {
  id: string;
  kind: "system" | "named";
  name: string;
  context: WorkspaceContext;
}

export interface WorkspaceContext {
  sourceIds: string[];
  learnerContextIds: string[];
  primaryFolderSourceId: string | null;
}

export interface SourceFingerprint {
  size: number;
  modifiedAtMs: number;
  contentHash?: string;
}

export type LocalSourceAccessGrant = { kind: "securityScopedBookmark"; bookmarkData: string } | null;

export interface SelectedLocalSource {
  name: string;
  resourceType: "file" | "folder";
  lastKnownPath: string;
  canonicalPath: string;
  accessGrant: LocalSourceAccessGrant;
  fingerprint: SourceFingerprint;
}

export type SourceLinkRefresh = Pick<SelectedLocalSource, "lastKnownPath" | "canonicalPath" | "accessGrant">;

export interface LinkedSource {
  id: string;
  kind: "linkedSource";
  role: "primaryFolder" | "externalAttachment";
  workspaceId: string;
  name: string;
  resourceType: "file" | "folder";
  link: {
    lastKnownPath: string;
    canonicalPath: string;
    accessGrant: LocalSourceAccessGrant;
    fingerprint: SourceFingerprint;
    accessStatus: "available" | "unavailable";
    error: string | null;
    currentRevisionId: string;
  };
}

export interface SourceRevision {
  id: string;
  sourceId: string;
  fingerprint: SourceFingerprint;
  snapshotAssetId: string | null;
}

export interface ManagedAsset {
  id: string;
  kind: "managedAsset";
  workspaceId: string;
  name: string;
  mediaType: AvailableLinkedSourceView["mediaType"] | "application/vnd.quick-study.folder-snapshot+json";
  content: string;
  sourceSnapshot?: {
    linkedSourceId: string;
    sourceRevisionId: string;
    encoding: "base64";
  };
}

export type WorkspaceSource = LinkedSource | ManagedAsset;

export interface AvailableLinkedSourceView {
  sourceId: string;
  resourceType: "file" | "folder";
  content: string;
  mediaType: "text/plain" | "application/pdf" | "image/png" | "image/jpeg" | "inode/directory" | "application/octet-stream";
  fingerprint: SourceFingerprint;
  linkRefresh?: SourceLinkRefresh;
}

export interface LocalSourceAccess {
  read(source: LinkedSource): Promise<AvailableLinkedSourceView>;
  extractForIndex(source: LinkedSource): Promise<SourceIndexExtractionResult>;
  snapshot(source: LinkedSource): Promise<{
    mediaType: ManagedAsset["mediaType"];
    contentBase64: string;
    fingerprint: SourceFingerprint;
    linkRefresh?: SourceLinkRefresh;
  }>;
}

export type LinkedSourceView =
  | ({ status: "available" } & AvailableLinkedSourceView)
  | { status: "unavailable"; sourceId: string; error: string };

export interface StudyMission {
  id: string;
  kind: "unfiled" | "named";
  workspaceId: string;
  name: string;
}

export interface ArgumentRoadmapStage {
  id: string;
  title: string;
  majorClaim: string;
  dependsOnStageIds: string[];
  sourceAnchorId: string;
  sessionId: string;
}

export interface ArgumentRoadmap {
  id: string;
  missionId: string;
  sourceId: string;
  title: string;
  selectedStageId: string;
  stages: ArgumentRoadmapStage[];
}

export interface LearningSlice {
  roadmapId: string;
  stageId: string;
  boundary: string;
  immediatePrerequisites: string[];
}

export interface ConceptPeek {
  id: string;
  sourceAnchorId: string;
  prerequisite: string;
  content: string;
  status: "open" | "closed";
}

export interface PrerequisiteBranchProposal {
  id: string;
  sourceAnchorId: string;
  prerequisite: string;
  status: "pending" | "accepted" | "deferred" | "overridden";
  branchSessionId: string | null;
}

export interface PrerequisiteBranch {
  prerequisite: string;
  returnPoint: {
    originSessionId: string;
    sourceId: string;
    sourceAnchorId: string;
    activeTeachingCardId: string | null;
    label: string;
  };
}

export interface StudyLocation {
  workspaceId: string;
  missionId: string;
}

export interface LearningSession {
  id: string;
  workspaceId: string;
  missionId: string;
  mathematics: string;
  sourceIds: string[];
  learningGoal: string;
  sessionTarget: string;
  status: SessionStatus;
  activityOrder: number;
  returnContext: {
    label: string;
    nextAction: string;
  };
  proposal: {
    scope: string;
    initialTeachingDirection: string;
    status: "accepted" | "awaitingConfirmation";
    confirmationReason: string | null;
  };
  teachingCard: TeachingCardState;
  teachingCardHistory: TeachingCardState[];
  submittedPendingQuestions: SubmittedPendingQuestion[];
  currentTeachingInput: { kind: "sessionIntake"; text: string } | { kind: "pendingQuestion"; submissionId: string; text: string };
  pendingQuestion: PendingQuestion | null;
  askBarContext: AskBarContext;
  questionCards: QuestionCard[];
  activeQuestionCardId: string | null;
  accessPolicy: SessionAccessPolicy;
  accessRequests: SessionAccessRequest[];
  pendingFullAccessConfirmation: boolean;
  sourceAnchors: SourceAnchor[];
  sourceAnchorRequests: SourceAnchorRequest[];
  annotations: SourceAnnotation[];
  activeSourceAnchorId: string | null;
  anchoredTeachingCards: AnchoredTeachingCard[];
  activeTeachingCardId: string | null;
  learningArtifacts: LearningArtifact[];
  trailDraft: TrailDraft;
  consolidationDraft: SessionConsolidationDraft | null;
  consolidatedOutcome: ConsolidatedSessionOutcome | null;
  continuationOf: ContinuationLink | null;
  modelStopConfirmation: ModelStopConfirmation | null;
  learningSlice: LearningSlice | null;
  conceptPeeks: ConceptPeek[];
  pendingConceptPeek: { sourceAnchorId: string; prerequisite: string } | null;
  prerequisiteBranchProposals: PrerequisiteBranchProposal[];
  prerequisiteBranch: PrerequisiteBranch | null;
  agentTasks: AgentTask[];
  activeAgentTaskId: string | null;
  reasoningPreference: ReasoningPreference;
  runtimeOverride: RuntimeOverride | null;
}

export interface LearningApplicationState {
  screen: "dashboard" | "workbench";
  quickStudy: QuickStudyHome;
  workspaces: StudyWorkspace[];
  missions: StudyMission[];
  argumentRoadmaps: ArgumentRoadmap[];
  sessions: LearningSession[];
  sources: WorkspaceSource[];
  sourceIndexes: SourceIndexSummary[];
  sourceRevisions: SourceRevision[];
  reanchoringDecisions: ReanchoringDecision[];
  activeSessionId: string | null;
  resumeSessionId: string | null;
  navigation: {
    workspaceId: string;
    missionId: string | null;
  };
  activityOrder: number;
  authentication: {
    status: "signedOut" | "signingIn" | "signedIn" | "failed";
    method: "chatgpt" | "apiKey" | null;
    accountLabel: string | null;
    loginUrl: string | null;
    error: string | null;
  };
  intakeError: string | null;
  runtimeAvailable: boolean;
  runtimeCapabilities: ModelRuntimeCapabilities;
  modelAccess: ModelAccessState;
  accessConfirmationPreference: {
    confirmFullAccess: boolean;
  };
  personalNoteSynthesisPreference: {
    includePersonalNotes: boolean;
  };
}

export type LearnerAction =
  | { type: "startQuickStudy"; mathematics: string; location?: StudyLocation }
  | { type: "submitSessionIntake"; mathematics: string; location?: StudyLocation }
  | { type: "confirmSessionProposal" }
  | { type: "cancelModelWork" }
  | { type: "cancelSessionModelWork"; sessionId: string }
  | { type: "retryModelWork" }
  | { type: "requestSpecialistReview"; coordination?: AgentTaskCoordination }
  | { type: "retryAgentTask"; taskId: string }
  | { type: "setReasoningPreference"; preference: ReasoningPreference }
  | { type: "setRuntimeOverride"; override: RuntimeOverride | null }
  | { type: "startChatGptLogin" }
  | { type: "loginWithApiKey"; apiKey: string }
  | { type: "refreshAuthentication" }
  | { type: "savePendingQuestion"; text: string }
  | { type: "editPendingQuestion"; text: string }
  | { type: "discardPendingQuestion" }
  | { type: "submitPendingQuestion" }
  | { type: "setAskBarContextItem"; contextId: string; included: boolean }
  | { type: "submitQuestion"; text: string }
  | { type: "startNewQuestion" }
  | { type: "retryQuestionCard"; cardId: string }
  | { type: "activateSourceAnchor"; sourceAnchorId: string }
  | { type: "resolveReanchoring"; decisionId: string; resolution: "acceptProposal" | "leaveUnresolved" }
  | {
      type: "resolveReanchoring";
      decisionId: string;
      resolution: "selectReplacement";
      selection: SourceAnchorSelection;
    }
  | { type: "addSourceToSession"; sourceId: string }
  | {
      type: "createSourceAnchor";
      sourceId: string;
      selection: SourceAnchorSelection;
      paletteAction: SourceAnchorPaletteAction;
    }
  | { type: "createAnnotation"; sourceAnchorId: string; purpose: AnnotationPurpose; content: string }
  | { type: "convertAnnotation"; annotationId: string; purpose: AnnotationPurpose }
  | { type: "reviseTeachingCard"; cardId: string; instruction: string }
  | { type: "restoreTeachingCardRevision"; cardId: string; revisionId: string }
  | { type: "createTeachingVariant"; cardId: string; name: string; instruction: string }
  | { type: "retryAnchoredTeachingCard"; cardId: string; variantId?: string }
  | { type: "pinTeachingCardArtifact"; cardId: string; artifactKind?: LearningArtifact["kind"] }
  | { type: "synthesizeLearningArtifact"; sessionId?: string; artifactId: string }
  | { type: "editLearningArtifact"; sessionId?: string; artifactId: string; content: string }
  | { type: "restoreLearningArtifactRevision"; sessionId?: string; artifactId: string; revisionId: string }
  | { type: "addTrailItem"; kind: TrailItemKind; content: string }
  | { type: "editTrailItem"; trailItemId: string; content: string }
  | { type: "removeTrailItem"; trailItemId: string }
  | { type: "moveTrailItem"; trailItemId: string; direction: "up" | "down" }
  | { type: "setTrailItemRequired"; trailItemId: string; required: boolean }
  | { type: "beginSessionConsolidation" }
  | ({ type: "reviseSessionConsolidation" } & SessionConsolidationDraft)
  | { type: "consolidateSession" }
  | { type: "continueSession"; sessionId: string }
  | { type: "retrySessionModelStop"; sessionId: string }
  | { type: "selectSessionAccessPolicy"; policy: SessionAccessPolicy }
  | { type: "setFullAccessConfirmation"; enabled: boolean }
  | { type: "setPersonalNoteSynthesis"; enabled: boolean }
  | { type: "decideFullAccessConfirmation"; decision: "confirm" | "cancel" }
  | {
      type: "decideAccessRequest";
      requestId: string;
      decision: "approve" | "deny" | "narrow";
      narrowedPolicy?: SessionAccessPolicy;
    }
  | {
      type: "reviseSessionProposal";
      learningGoal: string;
      scope: string;
      initialTeachingDirection: string;
    }
  | {
      type: "applySessionProposalRevision";
      learningGoal: string;
      scope: string;
      initialTeachingDirection: string;
    }
  | { type: "editLearningGoal"; value: string }
  | { type: "editSessionTarget"; value: string }
  | { type: "selectRoadmapStage"; roadmapId: string; stageId: string }
  | { type: "reviseLearningSlice"; boundary: string; immediatePrerequisites: string[] }
  | { type: "openConceptPeek"; sourceAnchorId: string; prerequisite: string }
  | { type: "closeConceptPeek"; conceptPeekId: string }
  | { type: "proposePrerequisiteBranch"; sourceAnchorId: string; prerequisite: string }
  | {
      type: "decidePrerequisiteBranch";
      proposalId: string;
      decision: "accept" | "defer" | "keepInline";
    }
  | { type: "returnToPrerequisiteOrigin" }
  | { type: "leaveSession" }
  | { type: "resumeSession"; sessionId: string }
  | { type: "createWorkspace"; name: string }
  | { type: "renameWorkspace"; workspaceId: string; name: string }
  | { type: "createMission"; workspaceId: string; name: string }
  | { type: "navigateToWorkspace"; workspaceId: string }
  | ({ type: "navigateToMission" } & StudyLocation)
  | ({ type: "fileSession"; sessionId: string } & StudyLocation);

export class LearningApplication {
  private state: LearningApplicationState = initialState();
  private readonly statePath: string;
  private readonly sourceIndexPath: string;
  private modelRuntime: ModelRuntime | null;
  private persistence = Promise.resolve();
  private sourceIndexWork = Promise.resolve();
  private sourceSnapshotWork = Promise.resolve();
  private readonly modelWorks = new Map<string, {
    controller: AbortController;
    promise: Promise<unknown>;
    stop(): void;
    markUnconfirmed(): void;
    restart(): Promise<void>;
  }>();
  private readonly accessDecisionWaiters = new Map<string, (decision: RuntimeAccessDecision) => void>();
  private readonly stateListeners = new Set<(state: LearningApplicationState) => void>();
  private agentWorkLogs: Record<string, Array<ModelRuntimeEvent & { sequence: number }>> = {};
  private sourceIndexDocuments = new Map<string, SourceIndexDocument>();
  private sourceSearchResults = new Map<string, SourceSearchResult>();

  private constructor(
    dataDirectory: string,
    modelRuntime: ModelRuntime | null,
    private readonly sourceAccess: LocalSourceAccess | null,
    private readonly artifactSharing: ArtifactSharing | null
  ) {
    this.statePath = join(dataDirectory, "learning-application.json");
    this.sourceIndexPath = join(dataDirectory, "source-index.json");
    this.modelRuntime = modelRuntime;
  }

  static async launch(
    dataDirectory: string,
    modelRuntime: ModelRuntime | null = null,
    sourceAccess: LocalSourceAccess | null = null,
    artifactSharing: ArtifactSharing | null = null
  ): Promise<LearningApplication> {
    const application = new LearningApplication(dataDirectory, modelRuntime, sourceAccess, artifactSharing);
    try {
      const stored = JSON.parse(await readFile(application.statePath, "utf8")) as Record<string, unknown>;
      const { agentWorkLogs, ...storedState } = stored;
      const persisted = migratePersistedState(storedState);
      application.agentWorkLogs = migrateAgentWorkLogs(agentWorkLogs);
      for (const session of persisted.sessions) {
        if (session.status === "active") session.status = "paused";
        session.pendingConceptPeek = null;
        session.pendingFullAccessConfirmation = false;
        for (const request of session.accessRequests) {
          if (request.status === "pending") request.status = "denied";
        }
        if (session.teachingCard.status === "streaming") {
          replaceTeachingCard(session, interruptedTeachingCard(session.teachingCard.content));
        }
        for (const card of session.anchoredTeachingCards) {
          interruptCardRevision(card.currentRevision);
          for (const variant of card.variants) interruptCardRevision(variant.revision);
        }
        const activeQuestionCard = session.questionCards.find((card) => card.id === session.activeQuestionCardId);
        if (activeQuestionCard) interruptCardRevision(activeQuestionCard.currentRevision);
        const activeAgentTask = session.agentTasks.find((task) => task.id === session.activeAgentTaskId);
        if (activeAgentTask && (activeAgentTask.status === "working" || activeAgentTask.status === "waiting")) {
          activeAgentTask.status = "stopped";
          activeAgentTask.statusMessage = "Specialist work stopped when the application closed. Retry when ready.";
          Object.assign(activeAgentTask.integratedTeachingCard, {
            status: "stopped", error: activeAgentTask.statusMessage, retryable: true
          });
        }
        refreshAskBarContext(persisted, session);
      }
      persisted.activeSessionId = null;
      persisted.resumeSessionId = mostRecentPausedSessionId(persisted.sessions);
      persisted.screen = "dashboard";
      application.state = persisted;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    await application.loadSourceIndexCache();
    if (modelRuntime) {
      application.state.runtimeAvailable = true;
      try {
        application.updateAuthentication(await modelRuntime.getAuthentication());
      } catch (error) {
        application.state.authentication = failedAuthentication(null, error);
        application.applyModelAccessFailure(error);
      }
      try {
        application.state.runtimeCapabilities = validatedRuntimeCapabilities(await modelRuntime.getCapabilities());
        clearUnsupportedRuntimeOverrides(application.state.sessions, application.state.runtimeCapabilities);
      } catch (error) {
        application.applyModelAccessFailure(new ModelAccessError(
          "runtime",
          `Codex Runtime could not report supported model choices. ${usefulRuntimeError(error)}`
        ));
      }
    } else {
      application.state.runtimeAvailable = false;
      const error = new Error("Codex Runtime is unavailable. Restart Codex and try again.");
      application.state.authentication = failedAuthentication(null, error);
      application.state.modelAccess = unavailableModelAccess(error);
    }
    return application;
  }

  getState(): LearningApplicationState {
    return structuredClone(this.state);
  }

  createArtifactPortableCopy(sessionId: string, artifactId: string): ArtifactPortableCopy {
    const session = this.requireSession(sessionId);
    const artifact = requireLearningArtifact(session, artifactId);
    const kindLabel = artifact.kind === "reformulatedProof" ? "Reformulated Proof" : "Learning Artifact";
    const anchors = artifact.sourceAnchorIds.map((sourceAnchorId) => {
      const anchor = requireSourceAnchor(session, sourceAnchorId);
      const location = anchor.selection.kind === "diagramRegion"
        ? "selected diagram region"
        : `\`${anchor.selection.exactText.replaceAll("`", "\\`")}\``;
      return `- ${sourceAnchorId}: ${location}`;
    });
    const filenameStem = artifact.title.trim().toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "learning-artifact";
    return {
      artifactId: artifact.id,
      originatingSessionId: artifact.originatingSessionId,
      suggestedFilename: `${filenameStem}.md`,
      mediaType: "text/markdown",
      content: [
        `# ${kindLabel}: ${artifact.title}`,
        "",
        `- Originating Learning Session: ${artifact.originatingSessionId}`,
        `- Claim Origin: ${artifact.currentRevision.claimOrigin}`,
        "- Verification Level: Not independently checked",
        `- Revision action: ${artifact.currentRevision.provenance.action}`,
        `- Revision created: ${artifact.currentRevision.provenance.createdAt ?? "Unavailable for migrated revision"}`,
        "",
        "## Source Anchors",
        "",
        ...anchors,
        "",
        "## Content",
        "",
        artifact.currentRevision.content,
        ...artifact.currentRevision.personalNoteContributions.flatMap((note) => [
          "",
          `## Personal Note ${note.annotationId}`,
          `- Original annotation: ${note.annotationId}`,
          `- Source Anchor: ${note.sourceAnchorId}`,
          "",
          "### Verbatim original",
          "",
          note.verbatim,
          ...(note.interpretation === null ? [] : [
            "",
            "### Note Interpretation",
            "",
            note.interpretation
          ])
        ]),
        ""
      ].join("\n")
    };
  }

  async exportLearningArtifact(sessionId: string, artifactId: string, destinationPath: string): Promise<ArtifactPortableCopy> {
    if (!isAbsolute(destinationPath)) throw new Error("Choose an absolute destination for the Artifact Export.");
    const portableCopy = this.createArtifactPortableCopy(sessionId, artifactId);
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, portableCopy.content, "utf8");
    return portableCopy;
  }

  async shareLearningArtifact(sessionId: string, artifactId: string): Promise<ArtifactShareResult> {
    if (!this.artifactSharing) throw new Error("Artifact Share is unavailable on this platform.");
    return this.artifactSharing.share(this.createArtifactPortableCopy(sessionId, artifactId));
  }

  getAgentWorkLogEvidence(sessionId: string, fromSequence: number, toSequence: number): AgentWorkLogEvidence[] {
    this.requireSession(sessionId);
    if (!Number.isInteger(fromSequence) || !Number.isInteger(toSequence) || fromSequence < 1 || toSequence < fromSequence) {
      throw new Error("Choose a valid Agent Work Log evidence range.");
    }
    return (this.agentWorkLogs[sessionId] ?? []).filter(
      (event) => event.sequence >= fromSequence && event.sequence <= toSequence
    ).map((event) => ({
      sequence: event.sequence,
      type: event.type,
      summary: agentWorkEvidenceSummary(event)
    }));
  }

  getSessionAccessScope(sessionId: string): SessionAccessScope {
    const session = this.requireSession(sessionId);
    const workspace = this.requireWorkspace(session.workspaceId);
    const sourceIds = session.accessPolicy === "focused"
      ? session.sourceIds
      : session.accessPolicy === "workspace"
        ? [...session.sourceIds, ...workspace.context.sourceIds]
        : this.state.sources.map((source) => source.id);
    return {
      policy: session.accessPolicy,
      sourceIds: [...new Set(sourceIds)],
      allowsBroadLocalRead: session.accessPolicy === "full",
      allowsSourceModification: false
    };
  }

  async requestSessionAccess(
    sessionId: string,
    request: Pick<SessionAccessRequest, "requestedPolicy" | "reason" | "exactScope" | "intendedAction">
  ): Promise<LearningApplicationState> {
    const session = this.requireSession(sessionId);
    this.addAccessRequest(session, request);
    return this.publishAndPersist();
  }

  subscribe(listener: (state: LearningApplicationState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  searchSessions(query: string): SessionSearchResult[] {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return this.state.sessions.flatMap((session) => {
      const workspace = this.state.workspaces.find((candidate) => candidate.id === session.workspaceId);
      const mission = this.state.missions.find((candidate) => candidate.id === session.missionId);
      if (!workspace || !mission) return [];
      const searchable = [session.learningGoal, session.sessionTarget, workspace.name, mission.name]
        .join(" ")
        .toLocaleLowerCase();
      if (!terms.every((term) => searchable.includes(term))) return [];
      return [{
        sessionId: session.id,
        workspaceId: session.workspaceId,
        missionId: session.missionId,
        learningGoal: session.learningGoal,
        sessionTarget: session.sessionTarget,
        workspaceName: workspace.name,
        missionName: mission.name,
        status: session.status
      }];
    });
  }

  searchSourceIndex(workspaceId: string, query: string): Promise<SourceSearchResult[]> {
    return this.serializeSourceIndexOperation(() => this.searchSourceIndexNow(workspaceId, query));
  }

  private async searchSourceIndexNow(
    workspaceId: string,
    query: string,
    allowChangedSourceRetry = true
  ): Promise<SourceSearchResult[]> {
    this.requireWorkspace(workspaceId);
    if (query.length > 500) throw new Error("Source Index search is limited to 500 characters.");
    const terms = searchTerms(query);
    const termHashes = terms.map(sourceIndexTermHash);
    if (terms.length === 0) return [];
    this.sourceSearchResults.clear();
    const workspace = this.requireWorkspace(workspaceId);
    const results: SourceSearchResult[] = [];
    const seenLocations = new Set<string>();
    for (const cachedDocument of this.sourceIndexDocuments.values()) {
      let document = cachedDocument;
      if (document.workspaceId !== workspaceId || this.sourceIndexStatus(document.sourceId)?.status !== "ready") continue;
      const source = this.state.sources.find((candidate): candidate is LinkedSource =>
        candidate.id === document.sourceId && candidate.kind === "linkedSource"
      );
      if (!source) continue;
      const opened = await this.readLinkedSourceNow(document.sourceId);
      const view = opened.view;
      if (view.status === "unavailable") {
        await this.markSourceIndexUnavailable(document.sourceId, view.error);
        continue;
      }
      if (opened.changed || !sameFingerprint(document.fingerprint, source.link.fingerprint)) {
        await this.indexSourceNow(document.sourceId, true);
        const rebuilt = this.sourceIndexDocuments.get(document.sourceId);
        if (!rebuilt) continue;
        document = rebuilt;
      }
      const hasCachedMatch = document.pages.some((page) => page.regions.some(
        (region) => termHashes.every((termHash) => region.termHashes.includes(termHash))
      ));
      if (!hasCachedMatch) continue;
      let liveExtraction: SourceIndexExtractionResult;
      try {
        liveExtraction = validatedSourceIndexExtractionResult(await this.sourceAccess!.extractForIndex(source));
      } catch (error) {
        await this.markSourceIndexUnavailable(document.sourceId, usefulSourceError(error));
        continue;
      }
      if (!sameFingerprint(document.fingerprint, liveExtraction.fingerprint)) {
        this.recordSourceFingerprint(source, liveExtraction.fingerprint);
        await this.indexSourceNow(document.sourceId, true);
        return allowChangedSourceRetry ? this.searchSourceIndexNow(workspaceId, query, false) : [];
      }
      for (const page of document.pages) {
        for (const region of page.regions) {
          if (!termHashes.every((termHash) => region.termHashes.includes(termHash))) continue;
          const livePage = liveExtraction.pages.find((candidate) => candidate.pageNumber === page.pageNumber);
          const liveRegion = livePage?.regions.find((candidate) => sameIndexMatch(candidate, {
            pageNumber: page.pageNumber,
            bounds: region.bounds,
            kind: region.kind,
            ...(region.sourceStartOffset === undefined ? {} : { sourceStartOffset: region.sourceStartOffset }),
            ...(region.sourceEndOffset === undefined ? {} : { sourceEndOffset: region.sourceEndOffset })
          }));
          if (!livePage || !liveRegion) continue;
          const locationKey = [document.sourceId, page.pageNumber, region.bounds.x, region.bounds.y,
            region.bounds.width, region.bounds.height, region.sourceStartOffset, region.sourceEndOffset].join(":");
          if (seenLocations.has(locationKey)) continue;
          seenLocations.add(locationKey);
          const result: SourceSearchResult = {
            id: crypto.randomUUID(),
            sourceId: document.sourceId,
            sourceName: document.sourceName,
            workspaceName: workspace.name,
            locationLabel: `Page ${page.pageNumber}`,
            preview: searchPreview(liveRegion.text, terms),
            thumbnailDataUrl: livePage.thumbnailDataUrl,
            match: {
              pageNumber: page.pageNumber,
              bounds: region.bounds,
              kind: region.kind,
              ...(region.sourceStartOffset === undefined ? {} : { sourceStartOffset: region.sourceStartOffset }),
              ...(region.sourceEndOffset === undefined ? {} : { sourceEndOffset: region.sourceEndOffset })
            }
          };
          results.push(result);
          this.sourceSearchResults.set(result.id, result);
        }
      }
    }
    return results;
  }

  indexSource(sourceId: string): Promise<LearningApplicationState> {
    return this.serializeSourceIndexOperation(() => this.indexSourceNow(sourceId));
  }

  private async indexSourceNow(sourceId: string, sourceAlreadyOpened = false): Promise<LearningApplicationState> {
    const source = this.state.sources.find((candidate): candidate is LinkedSource =>
      candidate.id === sourceId && candidate.kind === "linkedSource"
    );
    if (!source) throw new Error("Choose an indexable Linked Source.");
    try {
      if (!sourceAlreadyOpened) {
        const opened = await this.readLinkedSourceNow(sourceId);
        if (opened.view.status === "unavailable") return this.markSourceIndexUnavailable(sourceId, opened.view.error);
      }
      const extraction = validatedSourceIndexExtractionResult(await this.sourceAccess!.extractForIndex(source));
      if (extraction.linkRefresh) Object.assign(source.link, extraction.linkRefresh);
      this.recordSourceFingerprint(source, extraction.fingerprint);
      this.reanchorSourceAnchors(source, extraction);
      source.link.accessStatus = "available";
      source.link.error = null;
      const document: SourceIndexDocument = {
        sourceId,
        sourceName: source.name,
        workspaceId: source.workspaceId,
        fingerprint: extraction.fingerprint,
        extractionMethod: extraction.extractionMethod,
        pages: extraction.pages.map((page) => ({
          ...page,
          regions: page.regions.map(({ text, ...region }) => ({
            ...region,
            termHashes: [...new Set(searchTerms(text).map(sourceIndexTermHash))]
          }))
        }))
      };
      this.sourceIndexDocuments.set(sourceId, document);
      this.removeSourceSearchResults(sourceId);
      this.upsertSourceIndexSummary({
        sourceId,
        status: "ready",
        extractionMethod: extraction.extractionMethod,
        pageCount: extraction.pages.length,
        equationCount: extraction.pages.flatMap((page) => page.regions).filter((region) => region.kind === "equation").length,
        error: null
      });
      await this.persistSourceIndexCache();
      return this.publishAndPersist();
    } catch (error) {
      return this.markSourceIndexUnavailable(sourceId, usefulSourceError(error));
    }
  }

  clearSourceIndex(sourceId: string): Promise<LearningApplicationState> {
    return this.serializeSourceIndexOperation(() => this.clearSourceIndexNow(sourceId));
  }

  private async clearSourceIndexNow(sourceId: string): Promise<LearningApplicationState> {
    if (!this.state.sources.some((source) => source.id === sourceId)) throw new Error("Choose an existing source.");
    this.sourceIndexDocuments.delete(sourceId);
    this.removeSourceSearchResults(sourceId);
    this.upsertSourceIndexSummary({
      sourceId,
      status: "cleared",
      extractionMethod: null,
      pageCount: 0,
      equationCount: 0,
      error: null
    });
    await this.persistSourceIndexCache();
    return this.publishAndPersist();
  }

  rebuildSourceIndex(sourceId: string): Promise<LearningApplicationState> {
    return this.indexSource(sourceId);
  }

  openSourceSearchResult(resultId: string): Promise<OpenedSourceSearchResult> {
    return this.serializeSourceIndexOperation(() => this.openSourceSearchResultNow(resultId));
  }

  private async openSourceSearchResultNow(resultId: string): Promise<OpenedSourceSearchResult> {
    const result = this.sourceSearchResults.get(resultId);
    if (!result || this.sourceIndexStatus(result.sourceId)?.status !== "ready") {
      throw new Error("Search this Source Index again before opening the result.");
    }
    const opened = await this.readLinkedSourceNow(result.sourceId);
    const view = opened.view;
    if (view.status === "unavailable") return view;
    const source = this.state.sources.find((candidate): candidate is LinkedSource =>
      candidate.id === result.sourceId && candidate.kind === "linkedSource"
    );
    if (!source) throw new Error("Search this Source Index again before opening the result.");
    if (opened.changed) {
      await this.indexSourceNow(result.sourceId, true);
      throw new Error("This source changed. Search its rebuilt Source Index again before opening the result.");
    }
    let extraction: SourceIndexExtraction;
    let extracted: SourceIndexExtractionResult;
    try {
      extracted = validatedSourceIndexExtractionResult(await this.sourceAccess!.extractForIndex(source));
    } catch (error) {
      await this.markSourceIndexUnavailable(result.sourceId, usefulSourceError(error));
      throw error;
    }
    if (!sameFingerprint(source.link.fingerprint, extracted.fingerprint)) {
      this.recordSourceFingerprint(source, extracted.fingerprint);
      await this.indexSourceNow(result.sourceId, true);
      throw new Error("This source changed. Search its rebuilt Source Index again before opening the result.");
    }
    extraction = extracted;
    const page = extraction.pages.find((candidate) => candidate.pageNumber === result.match.pageNumber);
    const region = page?.regions.find((candidate) => sameIndexMatch(candidate, result.match));
    if (!page || !region) throw new Error("Search this Source Index again before opening the result.");
    return {
      ...view,
      highlight: {
        pageNumber: result.match.pageNumber,
        exactText: region.text,
        bounds: region.bounds,
        thumbnailDataUrl: page.thumbnailDataUrl,
        ...(region.sourceStartOffset === undefined ? {} : { sourceStartOffset: region.sourceStartOffset }),
        ...(region.sourceEndOffset === undefined ? {} : { sourceEndOffset: region.sourceEndOffset })
      }
    };
  }

  async restoreModelRuntime(modelRuntime: ModelRuntime): Promise<LearningApplicationState> {
    if (this.modelRuntime && this.modelRuntime !== modelRuntime) {
      await this.modelRuntime.shutdown().catch(() => undefined);
    }
    this.modelRuntime = modelRuntime;
    this.state.runtimeAvailable = true;
    try {
      this.updateAuthentication(await modelRuntime.getAuthentication());
    } catch (error) {
      this.state.authentication = failedAuthentication(null, error);
      this.applyModelAccessFailure(error);
    }
    try {
      this.state.runtimeCapabilities = validatedRuntimeCapabilities(await modelRuntime.getCapabilities());
      clearUnsupportedRuntimeOverrides(this.state.sessions, this.state.runtimeCapabilities);
    } catch (error) {
      this.applyModelAccessFailure(new ModelAccessError(
        "runtime",
        `Codex Runtime could not report supported model choices. ${usefulRuntimeError(error)}`
      ));
    }
    return this.publishAndPersist();
  }

  async reportModelRuntimeFailure(error: unknown): Promise<LearningApplicationState> {
    this.state.runtimeAvailable = false;
    this.state.modelAccess = unavailableModelAccess(
      error instanceof ModelAccessError ? error : new ModelAccessError("runtime", usefulRuntimeError(error))
    );
    return this.publishAndPersist();
  }

  async linkPrimaryFolder(
    workspaceId: string,
    selection: SelectedLocalSource
  ): Promise<LearningApplicationState> {
    const workspace = this.requireWorkspace(workspaceId);
    if (selection.resourceType !== "folder") throw new Error("Choose a folder for the Primary Folder.");
    if (workspace.context.primaryFolderSourceId) throw new Error("This Study Workspace already has a Primary Folder.");
    this.requireSourcePlacement(workspace, "primaryFolder", selection.canonicalPath);
    const source = linkedSource(workspaceId, "primaryFolder", selection);
    this.state.sources.push(source);
    this.state.sourceRevisions.push(sourceRevision(source));
    workspace.context.primaryFolderSourceId = source.id;
    workspace.context.sourceIds.push(source.id);
    return this.publishAndPersist();
  }

  async linkExternalAttachment(
    workspaceId: string,
    selection: SelectedLocalSource
  ): Promise<LearningApplicationState> {
    const workspace = this.requireWorkspace(workspaceId);
    if (selection.resourceType !== "file") throw new Error("Choose a file for an External Attachment.");
    this.requireSourcePlacement(workspace, "externalAttachment", selection.canonicalPath);
    const source = linkedSource(workspaceId, "externalAttachment", selection);
    this.state.sources.push(source);
    this.state.sourceRevisions.push(sourceRevision(source));
    workspace.context.sourceIds.push(source.id);
    return this.publishAndPersist();
  }

  async relocateLinkedSource(sourceId: string, selection: SelectedLocalSource): Promise<LearningApplicationState> {
    const source = this.state.sources.find(
      (candidate): candidate is LinkedSource => candidate.id === sourceId && candidate.kind === "linkedSource"
    );
    if (!source) throw new Error("Choose an existing Linked Source.");
    if (selection.resourceType !== source.resourceType) {
      throw new Error(source.resourceType === "file" ? "Locate the Linked Source file again." : "Locate the Primary Folder again.");
    }
    const changed = !sameFingerprint(source.link.fingerprint, selection.fingerprint);
    source.name = selection.name;
    Object.assign(source.link, {
      lastKnownPath: selection.lastKnownPath,
      canonicalPath: selection.canonicalPath,
      accessGrant: selection.accessGrant,
      accessStatus: "available" as const,
      error: null
    });
    if (changed) {
      this.recordSourceFingerprint(source, selection.fingerprint);
    }
    await this.publishAndPersist();
    if (changed || this.sourceIndexStatus(sourceId)?.status === "unavailable") {
      await this.serializeSourceIndexOperation(() => this.indexSourceNow(sourceId, true));
    }
    return this.getState();
  }

  preserveSourceSnapshot(sourceId: string): Promise<LearningApplicationState> {
    const result = this.sourceSnapshotWork.catch(() => undefined).then(() => this.preserveSourceSnapshotNow(sourceId));
    this.sourceSnapshotWork = result.then(() => undefined, () => undefined);
    return result;
  }

  private async preserveSourceSnapshotNow(sourceId: string): Promise<LearningApplicationState> {
    let source = this.state.sources.find(
      (candidate): candidate is LinkedSource => candidate.id === sourceId && candidate.kind === "linkedSource"
    );
    if (!source) throw new Error("Choose an existing Linked Source.");
    if (!this.sourceAccess) throw new Error("Local source access is unavailable.");
    const opened = await this.readLinkedSourceNow(sourceId);
    if (opened.view.status === "unavailable") return this.getState();
    if (opened.changed) await this.serializeSourceIndexOperation(() => this.indexSourceNow(sourceId, true));
    source = this.state.sources.find(
      (candidate): candidate is LinkedSource => candidate.id === sourceId && candidate.kind === "linkedSource"
    )!;
    const revision = this.state.sourceRevisions.find(
      (candidate) => candidate.id === source.link.currentRevisionId && candidate.sourceId === source.id
    );
    if (!revision) throw new Error("The current Source Revision is unavailable.");
    if (revision.snapshotAssetId) return this.getState();
    const snapshot = await this.sourceAccess.snapshot(source);
    if (snapshot.linkRefresh) Object.assign(source.link, snapshot.linkRefresh);
    if (!sameFingerprint(source.link.fingerprint, snapshot.fingerprint)) {
      throw new Error("This source changed before its Source Snapshot could be preserved. Open it and review the new revision first.");
    }
    const asset: ManagedAsset = {
      id: crypto.randomUUID(),
      kind: "managedAsset",
      workspaceId: source.workspaceId,
      name: `${source.name} — Source Snapshot`,
      mediaType: snapshot.mediaType,
      content: snapshot.contentBase64,
      sourceSnapshot: { linkedSourceId: source.id, sourceRevisionId: revision.id, encoding: "base64" }
    };
    this.state.sources.push(asset);
    this.requireWorkspace(source.workspaceId).context.sourceIds.push(asset.id);
    revision.snapshotAssetId = asset.id;
    return this.publishAndPersist();
  }

  async openLinkedSource(sourceId: string): Promise<LinkedSourceView> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const opened = await this.readLinkedSourceNow(sourceId);
      if (opened.view.status === "unavailable") return opened.view;
      if (opened.changed) await this.serializeSourceIndexOperation(() => this.indexSourceNow(sourceId, true));
      const source = this.state.sources.find(
        (candidate): candidate is LinkedSource => candidate.id === sourceId && candidate.kind === "linkedSource"
      )!;
      if (sameFingerprint(opened.view.fingerprint, source.link.fingerprint)) return opened.view;
    }
    return {
      status: "unavailable",
      sourceId,
      error: "This source kept changing while it was being opened. Retry after the source is stable."
    };
  }

  private async readLinkedSourceNow(sourceId: string): Promise<{ view: LinkedSourceView; changed: boolean }> {
    const source = this.state.sources.find(
      (candidate): candidate is LinkedSource => candidate.id === sourceId && candidate.kind === "linkedSource"
    );
    if (!source) throw new Error("Choose an existing Linked Source.");
    if (!this.sourceAccess) throw new Error("Local source access is unavailable.");
    try {
      const view = await this.sourceAccess.read(source);
      if (view.linkRefresh) Object.assign(source.link, view.linkRefresh);
      const changed = !sameFingerprint(source.link.fingerprint, view.fingerprint);
      if (changed) this.recordSourceFingerprint(source, view.fingerprint);
      source.link.accessStatus = "available";
      source.link.error = null;
      await this.publishAndPersist();
      return { view: { status: "available", ...view }, changed };
    } catch (error) {
      const message = usefulSourceError(error);
      source.link.accessStatus = "unavailable";
      source.link.error = message;
      await this.publishAndPersist();
      return { view: { status: "unavailable", sourceId, error: message }, changed: false };
    }
  }

  async waitForModelWork(): Promise<void> {
    await Promise.all([...this.modelWorks.values()].map((work) => work.promise));
    await this.persistence;
  }

  async shutdown(): Promise<void> {
    for (const session of this.state.sessions) {
      for (const request of session.accessRequests) {
        if (request.status !== "pending") continue;
        request.status = "denied";
        this.resolveAccessDecision(request.id, { status: "denied", policy: session.accessPolicy });
      }
    }
    const activeWorks = [...this.modelWorks.entries()];
    for (const [, work] of activeWorks) {
      work.stop();
      work.controller.abort();
    }
    if (activeWorks.length > 0) {
      this.emitState();
      this.queuePersistence();
    }
    await Promise.all(activeWorks.map(([sessionId]) => this.modelRuntime?.cancelTeaching(sessionId).catch(() => undefined)));
    await this.waitForModelWork();
    await this.modelRuntime?.shutdown();
  }

  async submit(action: LearnerAction): Promise<LearningApplicationState> {
    switch (action.type) {
      case "createWorkspace": {
        const workspace: StudyWorkspace = {
          id: crypto.randomUUID(),
          kind: "named",
          name: requiredName(action.name, "Study Workspace"),
          context: emptyWorkspaceContext()
        };
        this.state.workspaces.push(workspace);
        this.state.navigation = { workspaceId: workspace.id, missionId: null };
        this.state.screen = "dashboard";
        break;
      }
      case "renameWorkspace": {
        const workspace = this.state.workspaces.find((candidate) => candidate.id === action.workspaceId);
        if (!workspace || workspace.kind !== "named") throw new Error("Choose a named Study Workspace to rename.");
        workspace.name = requiredName(action.name, "Study Workspace");
        break;
      }
      case "createMission": {
        this.requireNamedWorkspace(action.workspaceId);
        const mission: StudyMission = {
          id: crypto.randomUUID(),
          kind: "named",
          workspaceId: action.workspaceId,
          name: requiredName(action.name, "Study Mission")
        };
        this.state.missions.push(mission);
        this.state.navigation = { workspaceId: action.workspaceId, missionId: mission.id };
        break;
      }
      case "resolveReanchoring": {
        const decision = this.state.reanchoringDecisions.find((candidate) => candidate.id === action.decisionId);
        if (!decision || (decision.status !== "unresolved" && decision.status !== "leftUnresolved")) {
          throw new Error("Choose an unresolved Re-anchoring review.");
        }
        if (action.resolution === "leaveUnresolved") {
          decision.status = "leftUnresolved";
          break;
        }
        const session = this.state.sessions.find((candidate) => candidate.id === decision.sessionId);
        const anchor = session?.sourceAnchors.find((candidate) => candidate.id === decision.sourceAnchorId);
        const source = this.state.sources.find((candidate) => candidate.id === decision.sourceId);
        if (!session || !anchor || !source || source.kind !== "linkedSource"
          || source.link.currentRevisionId !== decision.toRevisionId) {
          throw new Error("This Re-anchoring review no longer matches the current Source Revision.");
        }
        const requested = action.resolution === "selectReplacement" ? action.selection : decision.proposedSelection;
        if (!requested) throw new Error("Select a replacement location for this Unresolved Anchor.");
        const selection = await this.validatedSourceAnchorSelection(requested, source);
        anchor.selection = selection;
        anchor.sourceRevisionId = decision.toRevisionId;
        decision.proposedSelection = structuredClone(selection);
        decision.status = "learnerConfirmed";
        refreshAskBarContext(this.state, session, true);
        break;
      }
      case "createSourceAnchor": {
        const session = this.requireActiveSession();
        if (!isSourceAnchorPaletteAction(action.paletteAction)) throw new Error("Choose an available Selection Palette action.");
        if (action.paletteAction === "explain" && this.state.modelAccess.status === "available" && this.modelWorks.has(session.id)) {
          throw new Error("Wait for the current model teaching to finish before requesting an anchored explanation.");
        }
        const source = this.state.sources.find((candidate) => candidate.id === action.sourceId);
        if (!source || !session.sourceIds.includes(source.id)) {
          throw new Error("Choose a source attached to the active Learning Session.");
        }
        const selection = await this.validatedSourceAnchorSelection(action.selection, source);
        const anchor: SourceAnchor = {
          id: crypto.randomUUID(),
          sourceId: source.id,
          sourceRevisionId: source.kind === "linkedSource" ? source.link.currentRevisionId : null,
          selection
        };
        session.sourceAnchors.push(anchor);
        session.sourceAnchorRequests.push({
          id: crypto.randomUUID(),
          sourceAnchorId: anchor.id,
          action: action.paletteAction
        });
        session.activeSourceAnchorId = anchor.id;
        if (action.paletteAction === "addToLearningTrail") {
          session.trailDraft.items.push({
            id: crypto.randomUUID(),
            kind: "concept",
            content: sourceAnchorMathematics(anchor),
            required: true,
            origin: "learner",
            links: {
              ...emptyTrailItemLinks(),
              sourceAnchorIds: [anchor.id]
            },
            curationKey: null
          });
        }
        refreshAskBarContext(this.state, session, true);
        if (action.paletteAction === "explain" || action.paletteAction === "question") {
          const isExplanation = action.paletteAction === "explain";
          const card: AnchoredTeachingCard = {
            id: crypto.randomUUID(),
            sourceAnchorId: anchor.id,
            title: sourceAnchorTeachingTitle(selection, isExplanation ? "Explain" : "Question about"),
            currentRevision: teachingCardRevision(isExplanation
              ? "Explain or unpack this source anchor."
              : "Ask a question about this source anchor."),
            revisions: [],
            variants: [],
            artifactId: null
          };
          session.anchoredTeachingCards.push(card);
          session.activeTeachingCardId = card.id;
          if (isExplanation && this.state.modelAccess.status === "available") {
            await this.beginAnchoredTeaching(session, anchor, card.currentRevision);
          } else if (isExplanation) {
            card.currentRevision.status = "failed";
            card.currentRevision.error = "Model teaching is unavailable. The anchored explanation request is saved for later.";
            card.currentRevision.retryable = true;
          }
        }
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        break;
      }
      case "createAnnotation": {
        const session = this.requireActiveSession();
        requireSourceAnchor(session, action.sourceAnchorId);
        if (!isAnnotationPurpose(action.purpose)) throw new Error("Choose Personal Note or Tutor Feedback.");
        const annotation: SourceAnnotation = {
          id: crypto.randomUUID(),
          sourceAnchorId: action.sourceAnchorId,
          purpose: action.purpose,
          content: requiredVerbatimText(action.content, annotationPurposeLabel(action.purpose)),
          purposeChanges: []
        };
        session.annotations.push(annotation);
        session.activeSourceAnchorId = action.sourceAnchorId;
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        let card = session.anchoredTeachingCards.find((candidate) => candidate.sourceAnchorId === action.sourceAnchorId);
        if (annotation.purpose === "tutorFeedback" && !card) {
          const anchor = requireSourceAnchor(session, action.sourceAnchorId);
          card = {
            id: crypto.randomUUID(),
            sourceAnchorId: anchor.id,
            title: sourceAnchorTeachingTitle(anchor.selection, "Tutor Feedback for"),
            currentRevision: teachingCardRevision(annotation.content),
            revisions: [],
            variants: [],
            artifactId: null
          };
          session.anchoredTeachingCards.push(card);
        }
        if (annotation.purpose === "tutorFeedback" && card && this.state.modelAccess.status === "available"
          && !this.modelWorks.has(session.id) && card.currentRevision.status !== "streaming") {
          const previous = structuredClone(card.currentRevision);
          if (previous.status !== "idle") {
            card.revisions.push(previous);
            card.currentRevision = teachingCardRevision(annotation.content);
          }
          session.activeTeachingCardId = card.id;
          await this.beginAnchoredTeaching(session, requireSourceAnchor(session, action.sourceAnchorId), card.currentRevision,
            previous.status === "idle" ? null : previous.content);
        } else if (annotation.purpose === "tutorFeedback" && card && this.state.modelAccess.status !== "available") {
          card.currentRevision.status = "failed";
          card.currentRevision.error = "Model teaching is unavailable. Tutor Feedback is saved for a later Teaching Move.";
          card.currentRevision.retryable = true;
          session.activeTeachingCardId = card.id;
        }
        break;
      }
      case "convertAnnotation": {
        const session = this.requireActiveSession();
        if (!isAnnotationPurpose(action.purpose)) throw new Error("Choose Personal Note or Tutor Feedback.");
        const annotation = session.annotations.find((candidate) => candidate.id === action.annotationId);
        if (!annotation) throw new Error("Choose an annotation in this Learning Session.");
        if (annotation.purpose !== action.purpose) {
          annotation.purposeChanges.push({ from: annotation.purpose, to: action.purpose });
          annotation.purpose = action.purpose;
        }
        session.activeSourceAnchorId = annotation.sourceAnchorId;
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        break;
      }
      case "reviseTeachingCard": {
        const session = this.requireActiveSession();
        this.requireModelAccess();
        if (this.modelWorks.has(session.id)) throw new Error("Wait for the current model teaching to finish before revising this Teaching Card.");
        const card = requireAnchoredTeachingCard(session, action.cardId);
        if (card.currentRevision.status === "streaming") throw new Error("Wait for the current Teaching Card revision to finish.");
        const anchor = requireSourceAnchor(session, card.sourceAnchorId);
        const previous = structuredClone(card.currentRevision);
        if (previous.status !== "idle") card.revisions.push(previous);
        card.currentRevision = teachingCardRevision(requiredText(action.instruction, "Teaching Card revision instruction"));
        session.activeTeachingCardId = card.id;
        session.activeSourceAnchorId = anchor.id;
        await this.beginAnchoredTeaching(session, anchor, card.currentRevision, previous.status === "idle" ? null : previous.content);
        break;
      }
      case "restoreTeachingCardRevision": {
        const session = this.requireActiveSession();
        const card = requireAnchoredTeachingCard(session, action.cardId);
        if (card.currentRevision.status === "streaming") throw new Error("Wait for the current Teaching Card revision to finish.");
        const revisionIndex = card.revisions.findIndex((revision) => revision.id === action.revisionId);
        if (revisionIndex < 0) throw new Error("Choose an earlier Teaching Card revision to restore.");
        const [restored] = card.revisions.splice(revisionIndex, 1, structuredClone(card.currentRevision));
        card.currentRevision = restored;
        session.activeTeachingCardId = card.id;
        session.activeSourceAnchorId = card.sourceAnchorId;
        break;
      }
      case "createTeachingVariant": {
        const session = this.requireActiveSession();
        this.requireModelAccess();
        if (this.modelWorks.has(session.id)) throw new Error("Wait for the current model teaching to finish before creating a Teaching Variant.");
        const card = requireAnchoredTeachingCard(session, action.cardId);
        if (card.currentRevision.status === "streaming") throw new Error("Wait for the current Teaching Card revision to finish.");
        const name = requiredName(action.name, "Teaching Variant");
        if (card.variants.some((variant) => variant.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
          throw new Error("Choose a distinct Teaching Variant name.");
        }
        const anchor = requireSourceAnchor(session, card.sourceAnchorId);
        const variant: TeachingVariant = {
          id: crypto.randomUUID(),
          name,
          revision: teachingCardRevision(requiredText(action.instruction, "Teaching Variant instruction"))
        };
        card.variants.push(variant);
        session.activeTeachingCardId = card.id;
        session.activeSourceAnchorId = anchor.id;
        await this.beginAnchoredTeaching(session, anchor, variant.revision, card.currentRevision.content, variant.name);
        break;
      }
      case "retryAnchoredTeachingCard": {
        const session = this.requireActiveSession();
        this.requireModelAccess();
        if (this.modelWorks.has(session.id)) throw new Error("Wait for the current model teaching to finish before retrying this Teaching Card.");
        const card = requireAnchoredTeachingCard(session, action.cardId);
        const anchor = requireSourceAnchor(session, card.sourceAnchorId);
        const variant = action.variantId
          ? card.variants.find((candidate) => candidate.id === action.variantId)
          : null;
        if (action.variantId && !variant) throw new Error("Choose a Teaching Variant in this Teaching Card.");
        const revision = variant?.revision ?? card.currentRevision;
        if (!revision.retryable) throw new Error("This anchored Teaching Card is not ready to retry.");
        const previousContent = variant
          ? card.currentRevision.content
          : card.revisions.at(-1)?.content ?? null;
        session.activeTeachingCardId = card.id;
        session.activeSourceAnchorId = anchor.id;
        await this.beginAnchoredTeaching(session, anchor, revision, previousContent, variant?.name ?? null);
        break;
      }
      case "pinTeachingCardArtifact": {
        const session = this.requireActiveSession();
        if (action.artifactKind !== undefined
          && action.artifactKind !== "learningArtifact" && action.artifactKind !== "reformulatedProof") {
          throw new Error("Choose Learning Artifact or Reformulated Proof for this promotion.");
        }
        const card = requireAnchoredTeachingCard(session, action.cardId);
        if (card.currentRevision.status !== "completed" || !card.currentRevision.content.trim()) {
          throw new Error("Complete the Teaching Card before pinning it as a Learning Artifact.");
        }
        const existing = card.artifactId
          ? session.learningArtifacts.find((artifact) => artifact.id === card.artifactId)
          : null;
        if (!existing) {
          const artifact: LearningArtifact = {
            id: crypto.randomUUID(),
            title: card.title,
            kind: action.artifactKind ?? "learningArtifact",
            originatingSessionId: session.id,
            currentRevision: {
              id: crypto.randomUUID(),
              content: card.currentRevision.content,
              claimOrigin: "modelGenerated",
              verificationLevel: "notIndependentlyChecked",
              verificationCurrency: "current",
              personalNoteContributions: [],
              provenance: {
                action: "promoted",
                createdAt: new Date().toISOString(),
                priorRevisionId: null
              }
            },
            revisions: [],
            sourceAnchorIds: [card.sourceAnchorId],
            pinned: true
          };
          session.learningArtifacts.push(artifact);
          card.artifactId = artifact.id;
        }
        const artifact = requireLearningArtifact(session, card.artifactId!);
        upsertSuggestedTrailItem(session, `learning-artifact:${artifact.id}`, "learningArtifact", artifact.title, {
          sourceAnchorIds: [card.sourceAnchorId],
          teachingCardIds: [card.id],
          learningArtifactIds: [artifact.id],
          understandingEvidenceIds: []
        });
        session.activeTeachingCardId = card.id;
        session.activeSourceAnchorId = card.sourceAnchorId;
        break;
      }
      case "synthesizeLearningArtifact": {
        const session = this.requireArtifactEditingSession(action.sessionId);
        this.requireModelAccess();
        if (this.modelWorks.has(session.id)) {
          throw new Error("Wait for the current model work to finish before synthesizing this Learning Artifact.");
        }
        const artifact = requireLearningArtifact(session, action.artifactId);
        const personalNotes = this.state.personalNoteSynthesisPreference.includePersonalNotes
          ? session.annotations.filter((annotation) => annotation.purpose === "personalNote").map((annotation) => ({
              annotationId: annotation.id,
              sourceAnchorId: annotation.sourceAnchorId,
              content: annotation.content
            }))
          : [];
        const controller = new AbortController();
        const log = this.agentWorkLogs[session.id] ??= [];
        const promise = Promise.resolve().then(() => this.modelRuntime!.synthesizeArtifact({
          sessionId: session.id,
          learningGoal: session.learningGoal,
          artifactTitle: artifact.title,
          artifactContent: artifact.currentRevision.content,
          personalNotes,
          signal: controller.signal,
          onRuntimeEvent: (event) => {
            if (!controller.signal.aborted) log.push({ ...event, sequence: log.length + 1 });
          }
        }));
        this.modelWorks.set(session.id, {
          controller,
          promise,
          stop: () => undefined,
          markUnconfirmed: () => undefined,
          restart: () => this.submit(action).then(() => undefined)
        });
        let result: ArtifactSynthesisResult;
        try {
          result = await promise;
        } catch (error) {
          if (controller.signal.aborted) throw new Error("Learning Artifact synthesis was stopped.");
          this.recordModelAccessLoss(error);
          throw error;
        } finally {
          if (this.modelWorks.get(session.id)?.promise === promise) this.modelWorks.delete(session.id);
        }
        const synthesized = validatedArtifactSynthesisResult(result, personalNotes.map((note) => note.annotationId));
        const interpretations = new Map(synthesized.noteInterpretations.map((item) => [item.annotationId, item.interpretation]));
        artifact.revisions.push(structuredClone(artifact.currentRevision));
        artifact.currentRevision = {
          id: crypto.randomUUID(),
          content: synthesized.content,
          claimOrigin: personalNotes.length > 0 || artifact.currentRevision.claimOrigin !== "modelGenerated"
            ? "mixed" : "modelGenerated",
          verificationLevel: "notIndependentlyChecked",
          verificationCurrency: "current",
          personalNoteContributions: personalNotes.map((note) => ({
            annotationId: note.annotationId,
            sourceAnchorId: note.sourceAnchorId,
            verbatim: note.content,
            interpretation: interpretations.get(note.annotationId) ?? null
          })),
          provenance: {
            action: "synthesized",
            createdAt: new Date().toISOString(),
            priorRevisionId: artifact.revisions.at(-1)!.id
          }
        };
        artifact.sourceAnchorIds = [...new Set([
          ...artifact.sourceAnchorIds,
          ...personalNotes.map((note) => note.sourceAnchorId)
        ])];
        break;
      }
      case "editLearningArtifact": {
        const session = this.requireArtifactEditingSession(action.sessionId);
        const artifact = requireLearningArtifact(session, action.artifactId);
        const content = requiredText(action.content, "Learning Artifact");
        if (content === artifact.currentRevision.content) break;
        artifact.revisions.push(structuredClone(artifact.currentRevision));
        artifact.currentRevision = {
          id: crypto.randomUUID(),
          content,
          claimOrigin: artifact.currentRevision.claimOrigin === "learner" ? "learner" : "mixed",
          verificationLevel: "notIndependentlyChecked",
          verificationCurrency: "current",
          personalNoteContributions: structuredClone(artifact.currentRevision.personalNoteContributions),
          provenance: {
            action: "edited",
            createdAt: new Date().toISOString(),
            priorRevisionId: artifact.revisions.at(-1)!.id
          }
        };
        break;
      }
      case "restoreLearningArtifactRevision": {
        const session = this.requireArtifactEditingSession(action.sessionId);
        const artifact = requireLearningArtifact(session, action.artifactId);
        const revisionIndex = artifact.revisions.findIndex((revision) => revision.id === action.revisionId);
        if (revisionIndex < 0) throw new Error("Choose an earlier Learning Artifact revision to restore.");
        const restored = artifact.revisions[revisionIndex];
        const previousCurrent = structuredClone(artifact.currentRevision);
        artifact.revisions.push(previousCurrent);
        artifact.currentRevision = {
          ...structuredClone(restored),
          id: crypto.randomUUID(),
          provenance: {
            action: "restored",
            createdAt: new Date().toISOString(),
            priorRevisionId: restored.id
          }
        };
        break;
      }
      case "addTrailItem": {
        const session = this.requireActiveSession();
        if (!isTrailItemKind(action.kind)) throw new Error("Choose a valid Trail Item type.");
        session.trailDraft.items.push({
          id: crypto.randomUUID(),
          kind: action.kind,
          content: requiredText(action.content, "Trail Item"),
          required: true,
          origin: "learner",
          links: activeTrailItemLinks(session),
          curationKey: null
        });
        break;
      }
      case "editTrailItem": {
        const session = this.requireActiveSession();
        Object.assign(requireTrailItem(session, action.trailItemId), {
          content: requiredText(action.content, "Trail Item"),
          origin: "learner" as const,
          curationKey: null
        });
        break;
      }
      case "removeTrailItem": {
        const session = this.requireActiveSession();
        const index = session.trailDraft.items.findIndex((item) => item.id === action.trailItemId);
        if (index < 0) throw new Error("Choose a Trail Item in the active Learning Session.");
        if (session.trailDraft.items[index].required) {
          throw new Error("Remove the Required Trail Item marker before deleting this item.");
        }
        session.trailDraft.items.splice(index, 1);
        break;
      }
      case "moveTrailItem": {
        const session = this.requireActiveSession();
        const index = session.trailDraft.items.findIndex((item) => item.id === action.trailItemId);
        if (index < 0) throw new Error("Choose a Trail Item in the active Learning Session.");
        const destination = action.direction === "up" ? index - 1 : action.direction === "down" ? index + 1 : -1;
        if (destination >= 0 && destination < session.trailDraft.items.length) {
          const [item] = session.trailDraft.items.splice(index, 1);
          session.trailDraft.items.splice(destination, 0, item);
        }
        break;
      }
      case "setTrailItemRequired": {
        const session = this.requireActiveSession();
        requireTrailItem(session, action.trailItemId).required = action.required;
        break;
      }
      case "beginSessionConsolidation": {
        const session = this.requireActiveSession();
        this.stopModelWorkForSessionLifecycle(session);
        session.consolidationDraft ??= suggestedSessionConsolidation(session);
        break;
      }
      case "reviseSessionConsolidation": {
        const session = this.requireActiveSession();
        if (!session.consolidationDraft) throw new Error("Begin Session Consolidation before revising its review.");
        const includedArtifactIds = [...new Set(action.includedArtifactIds)];
        if (includedArtifactIds.some((artifactId) => !session.learningArtifacts.some((artifact) => artifact.id === artifactId))) {
          throw new Error("Choose Learning Artifacts from the active Learning Session.");
        }
        session.consolidationDraft = {
          centralInsight: requiredText(action.centralInsight, "Central insight"),
          learningProgress: action.learningProgress.trim(),
          unresolvedQuestions: action.unresolvedQuestions.map((question) => question.trim()).filter(Boolean),
          nextStep: requiredText(action.nextStep, "Next step"),
          includedArtifactIds,
          targetDisposition: requireTargetDisposition(action.targetDisposition)
        };
        break;
      }
      case "consolidateSession": {
        const session = this.requireActiveSession();
        this.stopModelWorkForSessionLifecycle(session);
        const draft = session.consolidationDraft;
        if (!draft) throw new Error("Review the Session Consolidation before creating its outcome.");
        const targetDisposition = requireTargetDisposition(draft.targetDisposition);
        session.consolidatedOutcome = {
          id: crypto.randomUUID(),
          ...structuredClone(draft),
          targetDisposition,
          trailItems: structuredClone(session.trailDraft.items)
        };
        session.consolidationDraft = null;
        session.status = "consolidated";
        session.activityOrder = this.nextActivityOrder();
        this.state.activeSessionId = null;
        this.state.resumeSessionId = this.latestPausedSessionId(session.id);
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "dashboard";
        break;
      }
      case "continueSession": {
        const historical = this.requireSession(action.sessionId);
        if (historical.status !== "consolidated" || !historical.consolidatedOutcome) {
          throw new Error("Choose a consolidated Learning Session to continue.");
        }
        if (this.state.activeSessionId) {
          const active = this.requireSession(this.state.activeSessionId);
          if (this.modelWorks.has(active.id) && !await this.stopModelWork(active)) {
            throw new Error("Codex did not confirm interruption. The active Learning Session remains open.");
          }
          this.pauseActiveSession();
        }
        const session = createLearningSession({
          id: crypto.randomUUID(),
          workspaceId: historical.workspaceId,
          missionId: historical.missionId,
          mathematics: historical.mathematics,
          sourceIds: [...historical.sourceIds],
          learningGoal: historical.learningGoal,
          sessionTarget: historical.sessionTarget,
          status: "active",
          activityOrder: this.nextActivityOrder(),
          returnContext: {
            label: `Continuation of ${historical.learningGoal}`,
            nextAction: historical.consolidatedOutcome.nextStep
          },
          proposal: {
            scope: historical.sessionTarget,
            initialTeachingDirection: historical.consolidatedOutcome.nextStep,
            status: "accepted",
            confirmationReason: null
          },
          currentTeachingInput: { kind: "sessionIntake", text: historical.consolidatedOutcome.nextStep },
          accessPolicy: historical.accessPolicy,
          continuationOf: { sessionId: historical.id, outcomeId: historical.consolidatedOutcome.id }
        });
        this.state.sessions.push(session);
        this.state.activeSessionId = session.id;
        this.state.resumeSessionId = session.id;
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "workbench";
        refreshAskBarContext(this.state, session);
        break;
      }
      case "retrySessionModelStop": {
        const session = this.requireSession(action.sessionId);
        if (!session.modelStopConfirmation) throw new Error("This Learning Session has no unconfirmed model interruption.");
        this.requestModelStopConfirmation(session);
        break;
      }
      case "addSourceToSession": {
        const session = this.requireActiveSession();
        const source = this.state.sources.find((candidate) => candidate.id === action.sourceId);
        if (!source || source.workspaceId !== session.workspaceId || source.kind !== "linkedSource" || source.resourceType !== "file") {
          throw new Error("Choose a Linked Source file in the active Study Workspace.");
        }
        if (!session.sourceIds.includes(source.id)) session.sourceIds.push(source.id);
        refreshAskBarContext(this.state, session);
        break;
      }
      case "navigateToWorkspace": {
        const workspace = this.state.workspaces.find((candidate) => candidate.id === action.workspaceId);
        if (!workspace) throw new Error("Choose an existing Study Workspace.");
        if (this.state.activeSessionId) this.pauseActiveSessionAndMakeResumable();
        const currentMission = this.state.missions.find(
          (mission) => mission.id === this.state.navigation.missionId && mission.workspaceId === workspace.id
        );
        const firstMission = this.state.missions.find((mission) => mission.workspaceId === workspace.id);
        this.state.navigation = {
          workspaceId: workspace.id,
          missionId: currentMission?.id ?? firstMission?.id ?? null
        };
        this.state.screen = "dashboard";
        break;
      }
      case "navigateToMission": {
        this.requireMission(action.workspaceId, action.missionId);
        if (this.state.activeSessionId) this.pauseActiveSessionAndMakeResumable();
        this.state.navigation = { workspaceId: action.workspaceId, missionId: action.missionId };
        this.state.screen = "dashboard";
        break;
      }
      case "startQuickStudy": {
        const mathematics = action.mathematics.trim();
        if (!mathematics) throw new Error("Typed mathematics is required to start Quick Study.");
        this.pauseActiveSession();
        const location = this.resolveIntakeLocation(action.location);
        const managedAsset = this.createManagedTextAsset(location.workspaceId, mathematics);
        const session = createLearningSession({
          id: crypto.randomUUID(),
          workspaceId: location.workspaceId,
          missionId: location.missionId,
          mathematics,
          sourceIds: [managedAsset.id],
          learningGoal: `Understand ${mathematics}`,
          sessionTarget: "Work through the key mathematical idea",
          status: "active",
          activityOrder: this.nextActivityOrder(),
          returnContext: {
            label: "Your typed mathematics",
            nextAction: "Continue working through the key idea"
          },
          proposal: defaultAcceptedProposal(),
          accessPolicy: location.accessPolicy
        });
        refreshAskBarContext(this.state, session);
        this.state.sessions.push(session);
        this.state.activeSessionId = session.id;
        this.state.resumeSessionId = session.id;
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "workbench";
        break;
      }
      case "submitSessionIntake": {
        const mathematics = action.mathematics.trim();
        if (!mathematics) throw new Error("Typed mathematics is required to start Quick Study.");
        this.requireModelAccess();
        let proposal: SessionProposal;
        const pendingLog: Array<ModelRuntimeEvent & { sequence: number }> = [];
        const proposalAttemptId = `proposal:${crypto.randomUUID()}`;
        this.agentWorkLogs[proposalAttemptId] = pendingLog;
        const runtime = this.modelRuntime!;
        try {
          proposal = await runtime.proposeSession(mathematics, (event) => {
            pendingLog.push({ ...event, sequence: pendingLog.length + 1 });
          });
          const materialScope = proposal.materialScope ?? (proposal.argumentRoadmap ? "longOrMultiStage" : "focused");
          if (proposal.argumentRoadmap && materialScope !== "longOrMultiStage") {
            throw new Error("Codex returned an inconsistent Argument Roadmap. Retry to request a fresh proposal.");
          }
          if (proposal.argumentRoadmap) validateProposedArgumentRoadmap(proposal.argumentRoadmap, mathematics);
          else if (materialScope === "longOrMultiStage") {
            throw new Error("Long or multi-stage material requires an Argument Roadmap. Retry to request a fresh proposal.");
          }
          this.state.intakeError = null;
        } catch (error) {
          const message = usefulRuntimeError(error);
          pendingLog.push({
            type: "turnFailed",
            threadId: "unavailable",
            turnId: null,
            detail: error instanceof Error ? error.message : String(error),
            sequence: pendingLog.length + 1
          });
          this.state.intakeError = message;
          this.recordModelAccessLoss(error);
          break;
        }
        this.pauseActiveSession();
        const location = this.resolveIntakeLocation(action.location);
        const managedAsset = this.createManagedTextAsset(location.workspaceId, mathematics);
        if (proposal.argumentRoadmap) {
          const selectedSession = this.createArgumentRoadmapSessions(
            proposal.argumentRoadmap,
            proposal,
            mathematics,
            managedAsset,
            location
          );
          this.agentWorkLogs[selectedSession.id] = pendingLog;
          delete this.agentWorkLogs[proposalAttemptId];
          this.state.activeSessionId = selectedSession.id;
          this.state.resumeSessionId = selectedSession.id;
          this.state.navigation = { workspaceId: selectedSession.workspaceId, missionId: selectedSession.missionId };
          this.state.screen = "workbench";
          break;
        }
        const session = createLearningSession({
          id: crypto.randomUUID(),
          workspaceId: location.workspaceId,
          missionId: location.missionId,
          mathematics,
          sourceIds: [managedAsset.id],
          learningGoal: proposal.learningGoal,
          sessionTarget: proposal.scope,
          status: "active",
          activityOrder: this.nextActivityOrder(),
          returnContext: {
            label: "Your typed mathematics",
            nextAction: proposal.initialTeachingDirection
          },
          proposal: {
            scope: proposal.scope,
            initialTeachingDirection: proposal.initialTeachingDirection,
            status: proposal.requiresConfirmation ? "awaitingConfirmation" : "accepted",
            confirmationReason: proposal.confirmationReason
          },
          accessPolicy: location.accessPolicy
        });
        refreshAskBarContext(this.state, session);
        this.agentWorkLogs[session.id] = pendingLog;
        delete this.agentWorkLogs[proposalAttemptId];
        this.state.sessions.push(session);
        this.state.activeSessionId = session.id;
        this.state.resumeSessionId = session.id;
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "workbench";
        if (!proposal.requiresConfirmation) await this.beginTeaching(session);
        break;
      }
      case "reviseSessionProposal": {
        const session = this.requireActiveSession();
        this.reviseProposal(session, action);
        break;
      }
      case "applySessionProposalRevision": {
        const session = this.requireActiveSession();
        const changed = this.reviseProposal(session, action);
        if (changed && this.modelWorks.has(session.id) && !await this.stopModelWork(session)) break;
        if (changed) await this.beginTeaching(session);
        break;
      }
      case "confirmSessionProposal": {
        const session = this.requireActiveSession();
        if (session.proposal.status !== "awaitingConfirmation") {
          throw new Error("This Session Proposal does not need confirmation.");
        }
        await this.beginTeaching(session);
        break;
      }
      case "cancelModelWork": {
        const session = this.requireActiveSession();
        await this.stopModelWork(session);
        break;
      }
      case "cancelSessionModelWork": {
        await this.stopModelWork(this.requireSession(action.sessionId));
        break;
      }
      case "retryModelWork": {
        const session = this.requireActiveSession();
        this.requireModelAccess();
        if (!session.teachingCard.retryable) throw new Error("This Teaching Card is not ready to retry.");
        if (this.modelWorks.has(session.id)) throw new Error("Restart Codex before retrying this Teaching Card.");
        const input = session.currentTeachingInput;
        const submission = input.kind === "pendingQuestion"
          ? session.submittedPendingQuestions.find((candidate) => candidate.id === input.submissionId) ?? null
          : null;
        await this.beginTeaching(session, input.text, submission);
        break;
      }
      case "requestSpecialistReview": {
        const session = this.requireActiveSession();
        this.requireModelAccess();
        if (!specialistReviewTarget(session)) {
          throw new Error("Complete a Teaching Card before requesting a Specialist Agent review.");
        }
        if (this.modelWorks.has(session.id)) {
          throw new Error("Wait for the current model teaching to finish before requesting a Specialist Agent review.");
        }
        if (session.agentTasks.length > 0) {
          throw new Error("This Learning Session already has its bounded Specialist Agent review.");
        }
        const coordination = action.coordination ?? "single";
        if (!isAgentTaskCoordination(coordination)) {
          throw new Error("Choose single, dependent, or independent Specialist Agent coordination.");
        }
        const task = createSpecialistReviewTask(
          session,
          selectAgentBudget(session, coordination, this.state.runtimeCapabilities),
          coordination
        );
        session.agentTasks.push(task);
        session.activeAgentTaskId = task.id;
        this.beginSpecialistAgentTask(session, task);
        break;
      }
      case "retryAgentTask": {
        const session = this.requireActiveSession();
        const task = session.agentTasks.find((candidate) => candidate.id === action.taskId);
        if (!task) throw new Error("Choose an Agent Task in this Learning Session.");
        if (!task.integratedTeachingCard.retryable) throw new Error("This Agent Task is not ready to retry.");
        if (this.modelWorks.has(session.id)) throw new Error("Wait for the current model work before retrying this Agent Task.");
        session.activeAgentTaskId = task.id;
        this.beginSpecialistAgentTask(session, task);
        break;
      }
      case "setReasoningPreference": {
        const session = this.requireActiveSession();
        if (!isReasoningPreference(action.preference)) throw new Error("Choose Faster, Balanced, or Deeper reasoning.");
        session.reasoningPreference = action.preference;
        break;
      }
      case "setRuntimeOverride": {
        const session = this.requireActiveSession();
        const runtimeOverride = action.override;
        if (runtimeOverride === null) {
          session.runtimeOverride = null;
          break;
        }
        const model = this.state.runtimeCapabilities.models.find((candidate) => candidate.model === runtimeOverride.model);
        if (!model) throw new Error("Choose a model offered by the active Codex Runtime.");
        if (!model.supportedReasoningEfforts.includes(runtimeOverride.reasoningEffort)) {
          throw new Error(`${model.displayName} does not support ${runtimeOverride.reasoningEffort} reasoning.`);
        }
        session.runtimeOverride = structuredClone(runtimeOverride);
        break;
      }
      case "startChatGptLogin": {
        if (!this.modelRuntime) throw new Error("Codex is unavailable.");
        try {
          const login = await this.modelRuntime.startChatGptLogin();
          this.state.authentication = {
            status: "signingIn",
            method: "chatgpt",
            accountLabel: null,
            loginUrl: login.authUrl,
            error: null
          };
        } catch (error) {
          this.state.authentication = failedAuthentication("chatgpt", error);
        }
        break;
      }
      case "loginWithApiKey": {
        if (!this.modelRuntime) throw new Error("Codex is unavailable.");
        if (!action.apiKey.trim()) throw new Error("An OpenAI API key is required.");
        try {
          await this.modelRuntime.loginWithApiKey(action.apiKey);
          this.updateAuthentication(await this.modelRuntime.getAuthentication());
        } catch (error) {
          this.state.authentication = failedAuthentication("apiKey", error);
          this.applyModelAccessFailure(error);
        }
        break;
      }
      case "refreshAuthentication": {
        if (!this.modelRuntime) throw new Error("Codex is unavailable.");
        try {
          this.updateAuthentication(await this.modelRuntime.getAuthentication());
        } catch (error) {
          this.state.authentication = failedAuthentication(null, error);
          this.applyModelAccessFailure(error);
        }
        break;
      }
      case "savePendingQuestion": {
        if (this.state.modelAccess.status === "available") {
          throw new Error("Submit the Ask Bar question while model access is available.");
        }
        const session = this.requireActiveSession();
        session.pendingQuestion = {
          id: crypto.randomUUID(),
          text: requiredText(action.text, "Pending Question"),
          contextIds: [...session.askBarContext.includedIds]
        };
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        break;
      }
      case "editPendingQuestion": {
        const session = this.requireActiveSession();
        if (!session.pendingQuestion) throw new Error("There is no Pending Question to edit.");
        session.pendingQuestion.text = requiredText(action.text, "Pending Question");
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        break;
      }
      case "discardPendingQuestion": {
        const session = this.requireActiveSession();
        if (!session.pendingQuestion) throw new Error("There is no Pending Question to discard.");
        session.pendingQuestion = null;
        break;
      }
      case "submitPendingQuestion": {
        this.requireModelAccess();
        const session = this.requireActiveSession();
        if (!session.pendingQuestion) throw new Error("There is no Pending Question to submit.");
        const question = { ...session.pendingQuestion };
        await this.submitQuestionCard(session, question.text, question.contextIds);
        session.pendingQuestion = null;
        break;
      }
      case "setAskBarContextItem": {
        const session = this.requireActiveSession();
        refreshAskBarContext(this.state, session);
        if (!session.askBarContext.items.some((item) => item.id === action.contextId)) {
          throw new Error("Choose context available to this Learning Session.");
        }
        const included = new Set(session.askBarContext.includedIds);
        if (action.included) included.add(action.contextId);
        else included.delete(action.contextId);
        session.askBarContext.includedIds = session.askBarContext.items
          .map((item) => item.id)
          .filter((id) => included.has(id));
        session.askBarContext.customized = true;
        if (session.pendingQuestion) session.pendingQuestion.contextIds = [...session.askBarContext.includedIds];
        break;
      }
      case "submitQuestion": {
        const session = this.requireActiveSession();
        await this.submitQuestionCard(session, action.text);
        break;
      }
      case "startNewQuestion": {
        const session = this.requireActiveSession();
        if (this.modelWorks.has(session.id)) throw new Error("Wait for the current model teaching to finish before starting another question.");
        session.activeQuestionCardId = null;
        refreshAskBarContext(this.state, session, true);
        break;
      }
      case "retryQuestionCard": {
        const session = this.requireActiveSession();
        this.requireModelAccess();
        if (this.modelWorks.has(session.id)) throw new Error("Wait for the current model teaching to finish before retrying this Question Card.");
        const card = session.questionCards.find((candidate) => candidate.id === action.cardId);
        if (!card) throw new Error("Choose a Question Card in the active Learning Session.");
        if (!card.currentRevision.retryable) throw new Error("This Question Card is not ready to retry.");
        session.activeQuestionCardId = card.id;
        const previous = card.revisions.at(-1);
        await this.beginQuestionTeaching(session, card, previous ? {
          previousQuestion: previous.question,
          previousContent: previous.content
        } : undefined);
        break;
      }
      case "activateSourceAnchor": {
        const session = this.requireActiveSession();
        requireSourceAnchor(session, action.sourceAnchorId);
        session.activeSourceAnchorId = action.sourceAnchorId;
        refreshAskBarContext(this.state, session, true);
        break;
      }
      case "setFullAccessConfirmation": {
        this.state.accessConfirmationPreference.confirmFullAccess = action.enabled;
        break;
      }
      case "setPersonalNoteSynthesis": {
        this.state.personalNoteSynthesisPreference.includePersonalNotes = action.enabled;
        break;
      }
      case "selectSessionAccessPolicy": {
        const session = this.requireActiveSession();
        if (session.accessRequests.some((candidate) => candidate.status === "pending")) {
          throw new Error("Decide the current Access Request before changing the Session Access Policy.");
        }
        if (action.policy === session.accessPolicy) break;
        if (action.policy === "full" && this.state.accessConfirmationPreference.confirmFullAccess) {
          session.pendingFullAccessConfirmation = true;
          break;
        }
        await this.changeSessionAccessPolicy(session, action.policy);
        break;
      }
      case "decideFullAccessConfirmation": {
        const session = this.requireActiveSession();
        if (!session.pendingFullAccessConfirmation) throw new Error("There is no pending Full Access confirmation.");
        session.pendingFullAccessConfirmation = false;
        if (action.decision === "confirm") await this.changeSessionAccessPolicy(session, "full");
        break;
      }
      case "decideAccessRequest": {
        const session = this.requireActiveSession();
        const request = session.accessRequests.find((candidate) => candidate.id === action.requestId);
        if (!request || request.status !== "pending") throw new Error("Choose a pending Access Request in this Learning Session.");
        if (action.decision === "deny") {
          request.status = "denied";
          request.decidedPolicy = null;
          this.resolveAccessDecision(request.id, { status: "denied", policy: session.accessPolicy });
          break;
        }
        const decidedPolicy = action.decision === "approve" ? request.requestedPolicy : action.narrowedPolicy;
        if (!decidedPolicy) throw new Error("Choose the narrowed Session Access Policy.");
        if (action.decision === "narrow" && (accessPolicyRank(decidedPolicy) <= accessPolicyRank(session.accessPolicy)
          || accessPolicyRank(decidedPolicy) >= accessPolicyRank(request.requestedPolicy))) {
          throw new Error("A narrowed policy must be broader than the current policy and narrower than the request.");
        }
        await this.changeSessionAccessPolicy(session, decidedPolicy, true);
        request.status = action.decision === "approve" ? "approved" : "narrowed";
        request.decidedPolicy = decidedPolicy;
        this.resolveAccessDecision(request.id, { status: request.status, policy: decidedPolicy });
        break;
      }
      case "resumeSession": {
        const session = this.requireSession(action.sessionId);
        if (session.status === "consolidated") {
          throw new Error("A consolidated Learning Session is a stable historical record. Continue this work in a new session instead.");
        }
        this.pauseActiveSession();
        if (session.learningSlice) {
          const roadmap = this.state.argumentRoadmaps.find((candidate) => candidate.id === session.learningSlice?.roadmapId);
          if (!roadmap || !roadmap.stages.some((stage) => stage.id === session.learningSlice?.stageId)) {
            throw new Error("This Learning Slice is no longer linked to its Argument Roadmap.");
          }
          roadmap.selectedStageId = session.learningSlice.stageId;
        }
        session.status = "active";
        session.activityOrder = this.nextActivityOrder();
        this.state.activeSessionId = session.id;
        this.state.resumeSessionId = session.id;
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "workbench";
        refreshAskBarContext(this.state, session);
        break;
      }
      case "leaveSession": {
        const session = this.pauseActiveSessionAndMakeResumable();
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "dashboard";
        break;
      }
      case "editLearningGoal": {
        const session = this.requireActiveSession();
        session.learningGoal = action.value;
        refreshAskBarContext(this.state, session);
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        break;
      }
      case "editSessionTarget": {
        const session = this.requireActiveSession();
        const target = session.learningSlice ? requiredName(action.value, "Learning Slice boundary") : action.value;
        session.sessionTarget = target;
        if (session.learningSlice) {
          session.learningSlice.boundary = target;
          session.proposal.scope = session.learningSlice.boundary;
        }
        refreshAskBarContext(this.state, session);
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        break;
      }
      case "selectRoadmapStage": {
        const roadmap = this.state.argumentRoadmaps.find((candidate) => candidate.id === action.roadmapId);
        const stage = roadmap?.stages.find((candidate) => candidate.id === action.stageId);
        if (!roadmap || !stage) throw new Error("Choose a stage from this Argument Roadmap.");
        const current = this.requireActiveSession();
        if (current.learningSlice?.roadmapId !== roadmap.id) throw new Error("Choose a stage from the active Argument Roadmap.");
        if (this.modelWorks.has(current.id)) throw new Error("Stop current teaching before choosing another Learning Slice.");
        this.pauseActiveSession();
        const selected = this.requireSession(stage.sessionId);
        selected.status = "active";
        selected.proposal.status = "awaitingConfirmation";
        selected.proposal.confirmationReason = "Confirm this Learning Slice before detailed teaching begins.";
        selected.activityOrder = this.nextActivityOrder();
        roadmap.selectedStageId = stage.id;
        this.state.activeSessionId = selected.id;
        this.state.resumeSessionId = selected.id;
        this.state.navigation = { workspaceId: selected.workspaceId, missionId: selected.missionId };
        refreshAskBarContext(this.state, selected);
        break;
      }
      case "reviseLearningSlice": {
        const session = this.requireActiveSession();
        if (!session.learningSlice) throw new Error("This Learning Session does not have a Learning Slice.");
        if (session.proposal.status !== "awaitingConfirmation") {
          throw new Error("Edit the Learning Slice before detailed teaching begins.");
        }
        session.learningSlice.boundary = requiredName(action.boundary, "Learning Slice boundary");
        session.learningSlice.immediatePrerequisites = action.immediatePrerequisites
          .map((item) => requiredName(item, "Immediate prerequisite"));
        session.sessionTarget = session.learningSlice.boundary;
        session.proposal.scope = session.learningSlice.boundary;
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        refreshAskBarContext(this.state, session);
        break;
      }
      case "openConceptPeek": {
        const session = this.requireActiveSession();
        await this.openConceptPeek(session, action.sourceAnchorId, action.prerequisite);
        break;
      }
      case "closeConceptPeek": {
        const session = this.requireActiveSession();
        const peek = session.conceptPeeks.find((candidate) => candidate.id === action.conceptPeekId);
        if (!peek) throw new Error("Choose a Concept Peek in the active Learning Session.");
        peek.status = "closed";
        break;
      }
      case "proposePrerequisiteBranch": {
        const session = this.requireActiveSession();
        const anchor = requireSourceAnchor(session, action.sourceAnchorId);
        session.prerequisiteBranchProposals.push({
          id: crypto.randomUUID(),
          sourceAnchorId: anchor.id,
          prerequisite: requiredName(action.prerequisite, "Prerequisite Branch"),
          status: "pending",
          branchSessionId: null
        });
        session.activeSourceAnchorId = anchor.id;
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        break;
      }
      case "decidePrerequisiteBranch": {
        const origin = this.requireActiveSession();
        const proposal = origin.prerequisiteBranchProposals.find((candidate) => candidate.id === action.proposalId);
        if (!proposal || proposal.status !== "pending") {
          throw new Error("Choose a pending Prerequisite Branch proposal in this Learning Session.");
        }
        if (action.decision === "defer") {
          proposal.status = "deferred";
          break;
        }
        if (action.decision === "keepInline") {
          await this.openConceptPeek(origin, proposal.sourceAnchorId, proposal.prerequisite);
          proposal.status = "overridden";
          break;
        }
        if (this.modelWorks.has(origin.id)) throw new Error("Stop current teaching before opening a Prerequisite Branch.");
        const anchor = requireSourceAnchor(origin, proposal.sourceAnchorId);
        const branch = createLearningSession({
          id: crypto.randomUUID(),
          workspaceId: origin.workspaceId,
          missionId: origin.missionId,
          mathematics: origin.mathematics,
          sourceIds: [...origin.sourceIds],
          learningGoal: `Understand ${proposal.prerequisite}`,
          sessionTarget: proposal.prerequisite,
          status: "active",
          activityOrder: this.nextActivityOrder(),
          returnContext: {
            label: `Prerequisite Branch · ${proposal.prerequisite}`,
            nextAction: `Return to ${sourceAnchorLocation(anchor)} when ready`
          },
          proposal: {
            scope: proposal.prerequisite,
            initialTeachingDirection: `Build the prerequisite needed at ${sourceAnchorLocation(anchor)}`,
            status: "accepted",
            confirmationReason: null
          },
          currentTeachingInput: { kind: "sessionIntake", text: proposal.prerequisite },
          accessPolicy: origin.accessPolicy,
          prerequisiteBranch: {
            prerequisite: proposal.prerequisite,
            returnPoint: {
              originSessionId: origin.id,
              sourceId: anchor.sourceId,
              sourceAnchorId: anchor.id,
              activeTeachingCardId: origin.activeTeachingCardId,
              label: sourceAnchorLocation(anchor)
            }
          }
        });
        origin.status = "paused";
        proposal.status = "accepted";
        proposal.branchSessionId = branch.id;
        refreshAskBarContext(this.state, branch);
        this.state.sessions.push(branch);
        this.state.activeSessionId = branch.id;
        this.state.resumeSessionId = branch.id;
        this.state.navigation = { workspaceId: branch.workspaceId, missionId: branch.missionId };
        break;
      }
      case "returnToPrerequisiteOrigin": {
        const branch = this.requireActiveSession();
        if (!branch.prerequisiteBranch) throw new Error("This Learning Session is not a Prerequisite Branch.");
        const returnPoint = branch.prerequisiteBranch.returnPoint;
        const origin = this.requireSession(returnPoint.originSessionId);
        requireSourceAnchor(origin, returnPoint.sourceAnchorId);
        if (returnPoint.activeTeachingCardId
          && !origin.anchoredTeachingCards.some((card) => card.id === returnPoint.activeTeachingCardId)) {
          throw new Error("The Return Point teaching context is no longer available.");
        }
        branch.status = "paused";
        origin.status = "active";
        origin.activeSourceAnchorId = returnPoint.sourceAnchorId;
        origin.activeTeachingCardId = returnPoint.activeTeachingCardId;
        origin.activityOrder = this.nextActivityOrder();
        this.state.activeSessionId = origin.id;
        this.state.resumeSessionId = origin.id;
        this.state.navigation = { workspaceId: origin.workspaceId, missionId: origin.missionId };
        refreshAskBarContext(this.state, origin);
        break;
      }
      case "fileSession": {
        const session = this.requireSession(action.sessionId);
        this.requireNamedWorkspace(action.workspaceId);
        this.requireMission(action.workspaceId, action.missionId);
        if (session.workspaceId !== this.state.quickStudy.workspace.id) {
          throw new Error("Only Quick Study sessions can be filed.");
        }
        const originalWorkspace = this.requireWorkspace(session.workspaceId);
        const destinationWorkspace = this.requireWorkspace(action.workspaceId);
        const linkedSessions = this.linkedSessionsForFiling(session);
        const linkedSourceIds = new Set(linkedSessions.flatMap((linkedSession) => linkedSession.sourceIds));
        for (const sourceId of linkedSourceIds) {
          const source = this.state.sources.find((candidate) => candidate.id === sourceId);
          if (!source || source.workspaceId !== originalWorkspace.id) continue;
          source.workspaceId = destinationWorkspace.id;
          originalWorkspace.context.sourceIds = originalWorkspace.context.sourceIds.filter((id) => id !== sourceId);
          if (!destinationWorkspace.context.sourceIds.includes(sourceId)) destinationWorkspace.context.sourceIds.push(sourceId);
        }
        for (const linkedSession of linkedSessions) {
          linkedSession.workspaceId = action.workspaceId;
          linkedSession.missionId = action.missionId;
          refreshAskBarContext(this.state, linkedSession);
        }
        const roadmapIds = new Set(linkedSessions.flatMap((linkedSession) => linkedSession.learningSlice?.roadmapId ?? []));
        for (const roadmap of this.state.argumentRoadmaps) {
          if (roadmapIds.has(roadmap.id)) roadmap.missionId = action.missionId;
        }
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        this.state.navigation = { workspaceId: action.workspaceId, missionId: action.missionId };
        break;
      }
    }

    const state = this.getState();
    this.emitState(state);
    this.persistence = this.persistence.catch(() => undefined).then(() => this.persist(state));
    await this.persistence;
    return this.getState();
  }

  private async persist(state: LearningApplicationState): Promise<void> {
    const directory = dirname(this.statePath);
    const temporaryPath = `${this.statePath}.temporary`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify({ ...state, agentWorkLogs: this.agentWorkLogs }, null, 2), "utf8");
    await rename(temporaryPath, this.statePath);
  }

  private async loadSourceIndexCache(): Promise<void> {
    try {
      const stored = JSON.parse(await readFile(this.sourceIndexPath, "utf8")) as unknown;
      const documents = validatedSourceIndexDocuments(stored);
      this.sourceIndexDocuments = new Map(documents.map((document) => [document.sourceId, document]));
    } catch (error) {
      if (!isMissingFile(error)) {
        this.sourceIndexDocuments.clear();
        await this.persistSourceIndexCache().catch(() => undefined);
      }
    }
    const sourceIds = new Set(this.state.sources.map((source) => source.id));
    this.state.sourceIndexes = this.state.sourceIndexes.filter((summary) => sourceIds.has(summary.sourceId));
    for (const summary of this.state.sourceIndexes) {
      if (summary.status === "ready" && !this.sourceIndexDocuments.has(summary.sourceId)) {
        Object.assign(summary, { status: "cleared", extractionMethod: null, pageCount: 0, equationCount: 0, error: null });
      }
    }
    for (const sourceId of this.sourceIndexDocuments.keys()) {
      const source = this.state.sources.find((candidate) => candidate.id === sourceId);
      const document = this.sourceIndexDocuments.get(sourceId);
      if (!sourceIds.has(sourceId) || this.sourceIndexStatus(sourceId)?.status !== "ready"
        || source?.kind !== "linkedSource" || !document || !sameFingerprint(source.link.fingerprint, document.fingerprint)) {
        this.sourceIndexDocuments.delete(sourceId);
        const summary = this.sourceIndexStatus(sourceId);
        if (summary?.status === "ready") {
          Object.assign(summary, { status: "cleared", extractionMethod: null, pageCount: 0, equationCount: 0, error: null });
        }
      }
    }
  }

  private async persistSourceIndexCache(): Promise<void> {
    const directory = dirname(this.sourceIndexPath);
    const temporaryPath = `${this.sourceIndexPath}.temporary`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify([...this.sourceIndexDocuments.values()], null, 2), "utf8");
    await rename(temporaryPath, this.sourceIndexPath);
  }

  private sourceIndexStatus(sourceId: string): SourceIndexSummary | undefined {
    return this.state.sourceIndexes.find((summary) => summary.sourceId === sourceId);
  }

  private upsertSourceIndexSummary(summary: SourceIndexSummary): void {
    const index = this.state.sourceIndexes.findIndex((candidate) => candidate.sourceId === summary.sourceId);
    if (index === -1) this.state.sourceIndexes.push(summary);
    else this.state.sourceIndexes[index] = summary;
  }

  private removeSourceSearchResults(sourceId: string): void {
    for (const [resultId, result] of this.sourceSearchResults) {
      if (result.sourceId === sourceId) this.sourceSearchResults.delete(resultId);
    }
  }

  private async markSourceIndexUnavailable(sourceId: string, error: string): Promise<LearningApplicationState> {
    this.sourceIndexDocuments.delete(sourceId);
    this.removeSourceSearchResults(sourceId);
    this.upsertSourceIndexSummary({
      sourceId,
      status: "unavailable",
      extractionMethod: null,
      pageCount: 0,
      equationCount: 0,
      error
    });
    await this.persistSourceIndexCache();
    return this.publishAndPersist();
  }

  private serializeSourceIndexOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.sourceIndexWork.catch(() => undefined).then(operation);
    this.sourceIndexWork = result.then(() => undefined, () => undefined);
    return result;
  }

  private async beginTeaching(
    session: LearningSession,
    mathematics = session.mathematics,
    submission: SubmittedPendingQuestion | null = null
  ): Promise<void> {
    this.requireModelAccess();
    if (this.modelWorks.has(session.id)) throw new Error("Model teaching is already active for this Learning Session.");
    if (submission) {
      if (session.currentTeachingInput.kind === "sessionIntake" && session.teachingCard.status !== "idle") {
        session.teachingCardHistory.push(structuredClone(session.teachingCard));
      }
      if (!session.submittedPendingQuestions.some((candidate) => candidate.id === submission.id)) {
        session.submittedPendingQuestions.push(submission);
      }
      session.currentTeachingInput = { kind: "pendingQuestion", submissionId: submission.id, text: submission.text };
    } else {
      session.currentTeachingInput = { kind: "sessionIntake", text: mathematics };
    }
    await this.runModelTeaching(session, mathematics, undefined, {
      start: () => {
        session.proposal.status = "accepted";
        replaceTeachingCard(session, { status: "streaming", content: "", error: null, retryable: false });
      },
      isStreaming: () => session.teachingCard.status === "streaming",
      append: (delta) => { session.teachingCard.content += delta; },
      complete: () => {
        session.teachingCard.status = "completed";
        session.returnContext.nextAction = "Review the Teaching Card and continue from the point that needs work";
        upsertSuggestedTrailItem(
          session,
          "session-teaching",
          "reasoningStep",
          session.teachingCard.content,
          emptyTrailItemLinks()
        );
        upsertSuggestedTrailItem(
          session,
          "session-next-step",
          "nextStep",
          session.returnContext.nextAction,
          emptyTrailItemLinks()
        );
      },
      fail: (error) => replaceTeachingCard(session, {
        ...session.teachingCard,
        status: "failed",
        error: usefulRuntimeError(error),
        retryable: true
      }),
      stop: () => replaceTeachingCard(session, interruptedTeachingCard(session.teachingCard.content)),
      markUnconfirmed: () => {
        session.teachingCard.error = "Teaching is stopped locally, but Codex did not confirm interruption. Restart Codex before retrying.";
      },
      recordRuntimeSequence: () => undefined
    }, () => this.beginTeaching(session, mathematics, submission));
  }

  private async beginAnchoredTeaching(
    session: LearningSession,
    anchor: SourceAnchor,
    revision: TeachingCardRevision,
    previousContent: string | null = null,
    variantName: string | null = null
  ): Promise<void> {
    this.requireModelAccess();
    if (!sourceAnchorIsCurrent(this.state, anchor)) {
      throw new Error("Review this Unresolved Anchor before using it as current source context.");
    }
    if (this.modelWorks.has(session.id)) throw new Error("Model teaching is already active for this Learning Session.");
    const focus: NonNullable<TeachingRequest["focus"]> = {
      kind: "sourceAnchor",
      sourceAnchorId: anchor.id,
      sourceId: anchor.sourceId,
      selection: anchor.selection,
      instruction: revision.instruction,
      previousContent,
      variantName
    };
    await this.runModelTeaching(session, sourceAnchorMathematics(anchor), focus, {
      start: (sourceContext, nextLogSequence) => {
        revision.contextUsed = sourceContext.flatMap((context) => [
          ...(context.sourceId === anchor.sourceId ? [{
            sourceId: context.sourceId,
            sourceName: context.name,
            location: `Focused ${sourceAnchorLocation(anchor)}`
          }] : []),
          {
            sourceId: context.sourceId,
            sourceName: context.name,
            location: `Supplied bounded source excerpt at characters 0–${context.content.length}`
          }
        ]);
        revision.agentWorkLogReference = {
          sessionId: session.id,
          fromSequence: nextLogSequence,
          toSequence: nextLogSequence
        };
        Object.assign(revision, { status: "streaming", content: "", error: null, retryable: false });
      },
      isStreaming: () => revision.status === "streaming",
      append: (delta) => { revision.content += delta; },
      complete: () => {
        revision.status = "completed";
        const card = session.anchoredTeachingCards.find((candidate) => candidate.currentRevision.id === revision.id
          || candidate.variants.some((variant) => variant.revision.id === revision.id));
        if (card) {
          upsertSuggestedTrailItem(session, `source-anchor:${anchor.id}`, "concept", sourceAnchorMathematics(anchor), {
            sourceAnchorIds: [anchor.id],
            teachingCardIds: [card.id],
            learningArtifactIds: card.artifactId ? [card.artifactId] : [],
            understandingEvidenceIds: []
          });
          upsertSuggestedTrailItem(session, `teaching-card:${card.id}`, "reasoningStep", revision.content, {
            sourceAnchorIds: [anchor.id],
            teachingCardIds: [card.id],
            learningArtifactIds: card.artifactId ? [card.artifactId] : [],
            understandingEvidenceIds: []
          });
          const contextSummary = revision.contextUsed.map((context) => `${context.sourceName} · ${context.location}`).join("; ");
          if (contextSummary) {
            upsertSuggestedTrailItem(session, `teaching-card-evidence:${card.id}`, "evidence", `Context used: ${contextSummary}`, {
              sourceAnchorIds: [anchor.id],
              teachingCardIds: [card.id],
              learningArtifactIds: card.artifactId ? [card.artifactId] : [],
              understandingEvidenceIds: []
            });
          }
        }
      },
      fail: (error) => Object.assign(revision, { status: "failed", error: usefulRuntimeError(error), retryable: true }),
      stop: () => interruptCardRevision(revision),
      markUnconfirmed: () => {
        revision.error = "Teaching is stopped locally, but Codex did not confirm interruption. Restart Codex before retrying.";
      },
      recordRuntimeSequence: (sequence) => {
        if (revision.agentWorkLogReference) revision.agentWorkLogReference.toSequence = sequence;
      }
    }, () => this.beginAnchoredTeaching(session, anchor, revision, previousContent, variantName));
  }

  private async submitQuestionCard(session: LearningSession, text: string, savedContextIds?: string[]): Promise<void> {
    this.requireModelAccess();
    if (this.modelWorks.has(session.id)) throw new Error("Wait for the current model teaching to finish before asking a question.");
    refreshAskBarContext(this.state, session);
    const includedIds = new Set(savedContextIds?.length ? savedContextIds : session.askBarContext.includedIds);
    const context = session.askBarContext.items.filter((item) => includedIds.has(item.id));
    if (context.length === 0) throw new Error("Include at least one Ask Bar context item.");
    const question = requiredText(text, "Question Card question");
    let card = session.questionCards.find((candidate) => candidate.id === session.activeQuestionCardId) ?? null;
    let previous: { previousQuestion: string; previousContent: string } | undefined;
    if (card) {
      if (card.currentRevision.status === "streaming") throw new Error("Wait for the current Question Card revision to finish.");
      previous = { previousQuestion: card.question, previousContent: card.currentRevision.content };
      card.revisions.push(structuredClone(card.currentRevision));
      card.question = question;
      card.currentRevision = questionCardRevision(question, context);
    } else {
      card = {
        id: crypto.randomUUID(),
        question,
        currentRevision: questionCardRevision(question, context),
        revisions: []
      };
      session.questionCards.push(card);
      session.activeQuestionCardId = card.id;
    }
    await this.beginQuestionTeaching(session, card, previous);
  }

  private async beginQuestionTeaching(
    session: LearningSession,
    card: QuestionCard,
    previous?: { previousQuestion: string; previousContent: string }
  ): Promise<void> {
    const revision = card.currentRevision;
    const context = structuredClone(revision.selectedContext);
    await this.runModelTeaching(session, card.question, undefined, {
      start: (sourceContext, nextLogSequence) => {
        const suppliedContext = context.map((item) => {
          if (item.kind !== "source" || !item.sourceId) return item;
          const supplied = sourceContext.find((source) => source.sourceId === item.sourceId);
          return {
            ...item,
            location: supplied
              ? `Supplied bounded source excerpt at characters 0–${supplied.content.length}`
              : "Selected context; source content was unavailable and not supplied"
          };
        });
        revision.contextUsed = [
          ...suppliedContext,
          accessPolicyReceipt(session.accessPolicy),
          ...(previous ? questionRevisionReceipt(previous) : [])
        ];
        revision.agentWorkLogReference = {
          sessionId: session.id,
          fromSequence: nextLogSequence,
          toSequence: nextLogSequence
        };
        Object.assign(revision, { status: "streaming", content: "", error: null, retryable: false });
      },
      isStreaming: () => revision.status === "streaming",
      append: (delta) => { revision.content += delta; },
      complete: () => {
        revision.status = "completed";
        removeSuggestedTrailItem(session, `question-card:${card.id}`);
      },
      fail: (error) => {
        Object.assign(revision, { status: "failed", error: usefulRuntimeError(error), retryable: true });
        upsertUnresolvedQuestionTrailItem(session, card, context);
      },
      stop: () => {
        interruptCardRevision(revision);
        upsertUnresolvedQuestionTrailItem(session, card, context);
      },
      markUnconfirmed: () => {
        revision.error = "Teaching is stopped locally, but Codex did not confirm interruption. Restart Codex before retrying.";
      },
      recordRuntimeSequence: (sequence) => {
        if (revision.agentWorkLogReference) revision.agentWorkLogReference.toSequence = sequence;
      }
    }, () => this.beginQuestionTeaching(session, card, previous), context, previous);
  }

  private beginSpecialistAgentTask(session: LearningSession, task: AgentTask): void {
    this.requireModelAccess();
    const log = this.agentWorkLogs[session.id] ??= [];
    const controller = new AbortController();
    const runtime = this.modelRuntime!;
    task.status = "working";
    task.statusMessage = null;
    const retainedCheckpoint = task.integratedTeachingCard.content;
    if (task.agentWorkLogReference) {
      task.priorAgentWorkLogReferences.push(structuredClone(task.agentWorkLogReference));
    }
    Object.assign(task.integratedTeachingCard, {
      title: "Specialist review",
      status: "streaming",
      content: retainedCheckpoint,
      error: null,
      retryable: false
    });
    task.agentWorkLogReference = {
      sessionId: session.id,
      fromSequence: log.length + 1,
      toSequence: log.length + 1
    };
    const specialistResults: Array<SpecialistAgentResult | null> = task.specialistBriefs.map(() => null);
    const specialistPartials = task.specialistBriefs.map(() => "");
    const specialistStatuses = task.specialistBriefs.map(() => "working" as "working" | "waiting" | "complete");
    const coordinated = task.specialistBriefs.map((storedBrief, index) => ({
      id: `${task.id}:${index}`,
      dependsOnTaskIds: task.coordination === "dependent" && index > 0 ? [`${task.id}:${index - 1}`] : [],
      run: async () => {
        const brief = structuredClone(storedBrief);
        if (task.coordination === "dependent" && index > 0) {
          const prior = specialistResults[index - 1];
          if (!prior) throw new Error("Dependent Specialist Agent work is missing its prerequisite result.");
          brief.constraints.push(`Earlier Specialist Agent conclusion: ${prior.content}`);
        }
        const perAgentBudget: AgentBudget = {
          ...structuredClone(task.budget),
          agentCount: 1,
          concurrency: 1,
          maxTokens: Math.floor(task.budget.maxTokens / task.budget.agentCount),
          maxLatencyMs: task.coordination === "dependent"
            ? Math.floor(task.budget.maxLatencyMs / task.budget.agentCount)
            : task.budget.maxLatencyMs
        };
        specialistResults[index] = await runtime.runSpecialistAgent({
          sessionId: session.id,
          purpose: index === 0 ? task.purpose : "Stress-test the current Teaching Card for a counterexample or boundary case",
          brief,
          budget: perAgentBudget,
          signal: controller.signal,
          onStatus: (status, message) => {
            if (controller.signal.aborted) return;
            specialistStatuses[index] = status;
            task.status = specialistStatuses.every((candidate) => candidate === "waiting") ? "waiting" : "working";
            task.statusMessage = message;
            this.emitState();
            this.queuePersistence();
          },
          onPartialResult: (content) => {
            if (controller.signal.aborted || !content) return;
            specialistPartials[index] = content;
            const combined = specialistPartials.filter(Boolean).join("\n\n");
            task.integratedTeachingCard.content = retainedCheckpoint && !combined.startsWith(retainedCheckpoint)
              ? `${retainedCheckpoint}\n\nRetry checkpoint:\n${combined}`
              : combined;
            this.emitState();
            this.queuePersistence();
          },
          onRuntimeEvent: (event) => {
            if (controller.signal.aborted) return;
            log.push({ ...event, sequence: log.length + 1 });
            if (task.agentWorkLogReference) task.agentWorkLogReference.toSequence = log.length;
            this.queuePersistence();
          }
        });
        specialistStatuses[index] = "complete";
      }
    }));
    const promise = coordinateAgentTasks(coordinated, task.budget.concurrency).then(() => {
      if (controller.signal.aborted) return;
      const integrated = specialistResults.map(validatedSpecialistAgentResult);
      task.status = "complete";
      task.statusMessage = null;
      Object.assign(task.integratedTeachingCard, {
        title: integrated.length === 1 ? integrated[0].title : "Coordinated Specialist review",
        status: "completed",
        content: integrated.length === 1
          ? integrated[0].content
          : integrated.map((result) => `${result.title}\n${result.content}`).join("\n\n"),
        error: null,
        retryable: false
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const limitMessage = agentBudgetLimitMessage(error, Boolean(task.integratedTeachingCard.content.trim()));
      if (limitMessage) {
        task.status = "stopped";
        task.statusMessage = limitMessage;
        Object.assign(task.integratedTeachingCard, {
          status: "stopped", error: limitMessage, retryable: true
        });
        return;
      }
      task.status = "failed";
      task.statusMessage = usefulRuntimeError(error);
      Object.assign(task.integratedTeachingCard, {
        status: "failed",
        error: usefulRuntimeError(error),
        retryable: true
      });
      this.recordModelAccessLoss(error);
    }).finally(() => {
      if (this.modelWorks.get(session.id)?.promise === promise) this.modelWorks.delete(session.id);
      this.queuePersistence();
      this.emitState();
    });
    this.modelWorks.set(session.id, {
      controller,
      promise,
      stop: () => {
        task.status = "stopped";
        task.statusMessage = "Specialist work stopped. Retry when ready.";
        Object.assign(task.integratedTeachingCard, {
          status: "stopped", error: task.statusMessage, retryable: true
        });
      },
      markUnconfirmed: () => {
        task.statusMessage = "Specialist work is stopped locally, but Codex did not confirm interruption. Restart Codex before retrying.";
        task.integratedTeachingCard.error = task.statusMessage;
      },
      restart: async () => this.beginSpecialistAgentTask(session, task)
    });
  }

  private async runModelTeaching(
    session: LearningSession,
    mathematics: string,
    focus: TeachingRequest["focus"],
    target: ModelTeachingTarget,
    restart: () => Promise<void>,
    questionContext?: QuestionContextItem[],
    questionRevision?: TeachingRequest["questionRevision"]
  ): Promise<void> {
    const sourceContext = await this.buildTeachingSourceContext(session, undefined, questionContext);
    const log = this.agentWorkLogs[session.id] ??= [];
    target.start(sourceContext, log.length + 1);
    const controller = new AbortController();
    const runtime = this.modelRuntime!;
    const roadmap = session.learningSlice
      ? this.state.argumentRoadmaps.find((candidate) => candidate.id === session.learningSlice?.roadmapId) ?? null
      : null;
    const stage = roadmap?.stages.find((candidate) => candidate.id === session.learningSlice?.stageId) ?? null;
    const promise = runtime.streamTeaching({
      sessionId: session.id,
      runtimeSelection: selectTeachingRuntime(session, this.state.runtimeCapabilities),
      mathematics,
      learningGoal: session.learningGoal,
      scope: session.proposal.scope,
      initialTeachingDirection: session.proposal.initialTeachingDirection,
      ...(roadmap && stage && session.learningSlice ? {
        learningSlice: {
          roadmapTitle: roadmap.title,
          stageTitle: stage.title,
          boundary: session.learningSlice.boundary,
          immediatePrerequisites: session.learningSlice.immediatePrerequisites,
          remainingStageTitles: roadmap.stages.filter((candidate) => candidate.id !== stage.id).map((candidate) => candidate.title)
        }
      } : {}),
      accessScope: this.getSessionAccessScope(session.id),
      sourceContext,
      tutorFeedback: session.annotations
        .filter((annotation) => annotation.purpose === "tutorFeedback")
        .map((annotation) => ({
          annotationId: annotation.id,
          sourceAnchorId: annotation.sourceAnchorId,
          content: annotation.content
        })),
      ...(questionContext ? { questionContext } : {}),
      ...(questionRevision ? { questionRevision } : {}),
      ...(focus ? { focus } : {}),
      onAccessRequest: (request) => controller.signal.aborted
        ? Promise.resolve({ status: "denied", policy: session.accessPolicy })
        : this.handleRuntimeAccessRequest(session, request),
      signal: controller.signal,
      onDelta: (delta) => {
        if (controller.signal.aborted || !target.isStreaming()) return;
        target.append(delta);
        this.emitState();
        this.queuePersistence();
      },
      onRuntimeEvent: (event) => {
        if (controller.signal.aborted) return;
        log.push({ ...event, sequence: log.length + 1 });
        target.recordRuntimeSequence(log.length);
        this.queuePersistence();
      }
    }).then(() => {
      if (!controller.signal.aborted && target.isStreaming()) target.complete();
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      target.fail(error);
      this.recordModelAccessLoss(error);
    }).finally(() => {
      if (this.modelWorks.get(session.id)?.promise === promise) this.modelWorks.delete(session.id);
      this.queuePersistence();
      this.emitState();
    });
    this.modelWorks.set(session.id, {
      controller,
      promise,
      stop: target.stop,
      markUnconfirmed: target.markUnconfirmed,
      restart
    });
  }

  private async validatedSourceAnchorSelection(
    selection: SourceAnchorSelection,
    source: WorkspaceSource
  ): Promise<SourceAnchorSelection> {
    const validated = validatedSourceAnchorSelection(selection, source);
    if (source.kind === "managedAsset") return validated;
    if (!this.sourceAccess) throw new Error("Local source access is unavailable.");
    const view = await this.sourceAccess.read(source);
    if (!sameFingerprint(source.link.fingerprint, view.fingerprint)) {
      throw new Error("This source changed before the Source Anchor could be saved.");
    }
    if (selection.kind === "diagramRegion") return validated;
    if (view.mediaType !== "text/plain") {
      throw new Error("Text and equation anchors require an accessible text Source Layer.");
    }
    if (!matchesSourceTextLocation(view.content, selection)) {
      throw new Error("The selected source text no longer matches this Source Layer.");
    }
    return validated;
  }

  private async buildTeachingSourceContext(
    session: LearningSession,
    selectedSourceIds?: string[],
    questionContext?: QuestionContextItem[]
  ): Promise<TeachingSourceContext[]> {
    const contexts: TeachingSourceContext[] = [];
    let remainingCharacters = MAX_TEACHING_SOURCE_CONTEXT_CHARACTERS;
    const addContext = (context: TeachingSourceContext) => {
      if (remainingCharacters <= 0) return;
      const content = context.content.slice(0, remainingCharacters);
      contexts.push({ ...context, content });
      remainingCharacters -= content.length;
    };
    const authorizedSourceIds = new Set(this.getSessionAccessScope(session.id).sourceIds);
    const wholeSourceIds = new Set(questionContext?.filter((item) => item.kind === "source")
      .flatMap((item) => item.sourceId ? [item.sourceId] : []) ?? []);
    if (questionContext) {
      for (const item of questionContext) {
        if (item.kind !== "sourceAnchor" || !item.sourceId || !authorizedSourceIds.has(item.sourceId)
          || wholeSourceIds.has(item.sourceId)) continue;
        const anchor = session.sourceAnchors.find((candidate) => candidate.id === item.sourceAnchorId);
        if (!anchor || !sourceAnchorIsCurrent(this.state, anchor)) continue;
        const source = this.state.sources.find((candidate) => candidate.id === item.sourceId);
        if (!source) continue;
        addContext({
          sourceId: item.sourceId,
          name: source.name,
          mediaType: "text/plain",
          content: item.preview
        });
      }
    }
    const sourceIds = selectedSourceIds ?? (questionContext ? [...wholeSourceIds] : [...authorizedSourceIds]);
    for (const sourceId of sourceIds) {
      if (!authorizedSourceIds.has(sourceId)) continue;
      const source = this.state.sources.find((candidate) => candidate.id === sourceId);
      if (!source) continue;
      if (source.kind === "managedAsset") {
        addContext({ sourceId, name: source.name, mediaType: source.mediaType, content: managedAssetLearnerContent(source) });
        continue;
      }
      if (!this.sourceAccess) continue;
      try {
        const view = await this.sourceAccess.read(source);
        if (!sameFingerprint(source.link.fingerprint, view.fingerprint)) continue;
        addContext({ sourceId, name: source.name, mediaType: view.mediaType, content: view.content });
      } catch {
        // Unavailable Linked Sources remain associated but cannot enter model context.
      }
    }
    return contexts;
  }

  private async handleRuntimeAccessRequest(
    session: LearningSession,
    details: RuntimeAccessRequest
  ): Promise<RuntimeAccessDecision> {
    const request = this.addAccessRequest(session, details);
    const decision = new Promise<RuntimeAccessDecision>((resolve) => {
      this.accessDecisionWaiters.set(request.id, resolve);
    });
    await this.publishAndPersist();
    return decision;
  }

  private addAccessRequest(
    session: LearningSession,
    request: Pick<SessionAccessRequest, "requestedPolicy" | "reason" | "exactScope" | "intendedAction">
  ): SessionAccessRequest {
    if (accessPolicyRank(request.requestedPolicy) <= accessPolicyRank(session.accessPolicy)) {
      throw new Error("An Access Request must ask for broader authority than the current Session Access Policy.");
    }
    if (session.accessRequests.some((candidate) => candidate.status === "pending")) {
      throw new Error("Decide the current Access Request before requesting another elevation.");
    }
    const accessRequest: SessionAccessRequest = {
      id: crypto.randomUUID(),
      requestedPolicy: request.requestedPolicy,
      reason: requiredText(request.reason, "Access Request reason"),
      exactScope: requiredText(request.exactScope, "Access Request scope"),
      intendedAction: requiredText(request.intendedAction, "Access Request intended action"),
      status: "pending",
      decidedPolicy: null
    };
    session.accessRequests.push(accessRequest);
    return accessRequest;
  }

  private resolveAccessDecision(requestId: string, decision: RuntimeAccessDecision): void {
    this.accessDecisionWaiters.get(requestId)?.(decision);
    this.accessDecisionWaiters.delete(requestId);
  }

  private denyPendingAccessRequests(session: LearningSession): void {
    for (const request of session.accessRequests) {
      if (request.status !== "pending") continue;
      request.status = "denied";
      request.decidedPolicy = null;
      this.resolveAccessDecision(request.id, { status: "denied", policy: session.accessPolicy });
    }
  }

  private async changeSessionAccessPolicy(
    session: LearningSession,
    policy: SessionAccessPolicy,
    preservePendingAccessRequest = false
  ): Promise<void> {
    if (policy === session.accessPolicy) return;
    const work = this.modelWorks.get(session.id);
    const restartTeaching = Boolean(work);
    if (restartTeaching && !await this.stopModelWork(session, !preservePendingAccessRequest)) {
      throw new Error(`Codex did not confirm interruption. ${sessionAccessPolicyLabel(session.accessPolicy)} remains active.`);
    }
    session.accessPolicy = policy;
    refreshAskBarContext(this.state, session);
    if (work) await work.restart();
  }

  private async stopModelWork(session: LearningSession, denyPendingRequests = true): Promise<boolean> {
    const work = this.modelWorks.get(session.id);
    if (!this.modelRuntime || !work) throw new Error("There is no active model work to stop.");
    if (denyPendingRequests) this.denyPendingAccessRequests(session);
    work.stop();
    work.controller.abort();
    try {
      await this.modelRuntime.cancelTeaching(session.id);
      if (this.modelWorks.get(session.id) === work) this.modelWorks.delete(session.id);
      return true;
    } catch {
      work.markUnconfirmed();
      return false;
    }
  }

  private stopModelWorkForSessionLifecycle(session: LearningSession): void {
    const work = this.modelWorks.get(session.id);
    if (!this.modelRuntime || !work) return;
    this.denyPendingAccessRequests(session);
    work.stop();
    work.controller.abort();
    if (this.modelWorks.get(session.id) === work) this.modelWorks.delete(session.id);
    this.requestModelStopConfirmation(session);
  }

  private requestModelStopConfirmation(session: LearningSession): void {
    const attemptId = crypto.randomUUID();
    session.modelStopConfirmation = {
      attemptId,
      status: "pending",
      message: "Waiting for Codex to confirm interruption. Local model work is stopped."
    };
    if (!this.modelRuntime) {
      session.modelStopConfirmation = unconfirmedModelStop(attemptId);
      return;
    }
    void this.modelRuntime.cancelTeaching(session.id).then(() => {
      if (session.modelStopConfirmation?.attemptId === attemptId) session.modelStopConfirmation = null;
    }).catch(() => {
      if (session.modelStopConfirmation?.attemptId === attemptId) {
        session.modelStopConfirmation = unconfirmedModelStop(attemptId);
      }
    }).finally(() => {
      this.queuePersistence();
      this.emitState();
    });
  }

  private reviseProposal(
    session: LearningSession,
    revision: { learningGoal: string; scope: string; initialTeachingDirection: string }
  ): boolean {
    const learningGoal = requiredName(revision.learningGoal, "Learning Goal");
    const scope = requiredName(revision.scope, "Session scope");
    const initialTeachingDirection = requiredName(revision.initialTeachingDirection, "Teaching direction");
    const changed = learningGoal !== session.learningGoal
      || scope !== session.proposal.scope
      || initialTeachingDirection !== session.proposal.initialTeachingDirection;
    session.learningGoal = learningGoal;
    session.sessionTarget = scope;
    if (session.learningSlice) session.learningSlice.boundary = scope;
    session.proposal.scope = scope;
    session.proposal.initialTeachingDirection = initialTeachingDirection;
    session.returnContext.nextAction = initialTeachingDirection;
    refreshAskBarContext(this.state, session);
    session.activityOrder = this.nextActivityOrder();
    this.state.resumeSessionId = session.id;
    return changed;
  }

  private recordModelAccessLoss(error: unknown): void {
    if (!(error instanceof ModelAccessError)) return;
    const modelAccess: Extract<ModelAccessState, { status: "unavailable" }> = {
      status: "unavailable",
      cause: error.cause,
      message: error.message
    };
    this.state.modelAccess = modelAccess;
    if (modelAccess.cause === "runtime") this.state.runtimeAvailable = false;
    if (modelAccess.cause === "authentication" || modelAccess.cause === "runtime") {
      this.state.authentication = {
        status: "failed",
        method: this.state.authentication.method,
        accountLabel: null,
        loginUrl: null,
        error: error.message
      };
    }
  }

  private applyModelAccessFailure(error: unknown): void {
    const modelAccess = unavailableModelAccess(error);
    this.state.modelAccess = modelAccess;
    if (modelAccess.cause === "runtime") this.state.runtimeAvailable = false;
  }

  private updateAuthentication(authentication: AuthenticationState): void {
    this.state.authentication = authenticationView(authentication);
    this.state.modelAccess = authentication.status === "signedIn"
      ? { status: "available" }
      : { status: "unavailable", cause: "authentication", message: authenticationMessage(authentication) };
  }

  private requireModelAccess(): void {
    if (!this.modelRuntime || this.state.modelAccess.status === "unavailable") {
      throw new Error(this.state.modelAccess.status === "unavailable"
        ? this.state.modelAccess.message
        : "Connect a Model Runtime before starting model-backed teaching.");
    }
  }

  private emitState(state = this.getState()): void {
    for (const listener of this.stateListeners) listener(state);
  }

  private queuePersistence(): void {
    const state = this.getState();
    this.persistence = this.persistence.catch(() => undefined).then(() => this.persist(state));
  }

  private async publishAndPersist(): Promise<LearningApplicationState> {
    const state = this.getState();
    this.emitState(state);
    this.persistence = this.persistence.catch(() => undefined).then(() => this.persist(state));
    await this.persistence;
    return state;
  }

  private requireActiveSession(): LearningSession {
    if (!this.state.activeSessionId) throw new Error("Resume a Learning Session before editing it.");
    return this.requireSession(this.state.activeSessionId);
  }

  private createArgumentRoadmapSessions(
    proposed: ArgumentRoadmapProposal,
    proposal: SessionProposal,
    mathematics: string,
    source: ManagedAsset,
    location: StudyLocation & { accessPolicy: SessionAccessPolicy }
  ): LearningSession {
    validateProposedArgumentRoadmap(proposed, mathematics);
    const roadmapId = crypto.randomUUID();
    const stageIds = proposed.stages.map(() => crypto.randomUUID());
    const sessionIds = proposed.stages.map(() => crypto.randomUUID());
    const anchors = proposed.stages.map((stage) => {
      const excerpt = requiredName(stage.sourceExcerpt, "Argument Roadmap source excerpt");
      const startOffset = mathematics.indexOf(excerpt);
      if (startOffset < 0 || !stage.title.trim() || !stage.majorClaim.trim() || !stage.learningGoal.trim()
        || !stage.boundary.trim() || !Array.isArray(stage.dependsOn)
        || !Array.isArray(stage.immediatePrerequisites)) {
        throw new Error("Codex returned an invalid Argument Roadmap. Retry to request a fresh proposal.");
      }
      const endOffset = startOffset + excerpt.length;
      return {
        id: crypto.randomUUID(),
        sourceId: source.id,
        sourceRevisionId: null,
        selection: {
          kind: "text" as const,
          startOffset,
          endOffset,
          exactText: excerpt,
          prefix: mathematics.slice(Math.max(0, startOffset - 32), startOffset),
          suffix: mathematics.slice(endOffset, endOffset + 32)
        }
      };
    });
    const stages: ArgumentRoadmapStage[] = proposed.stages.map((stage, index) => {
      const dependencies = stage.dependsOn.map((dependency) => {
        if (!Number.isInteger(dependency) || dependency < 0 || dependency >= proposed.stages.length || dependency === index) {
          throw new Error("Codex returned an invalid Argument Roadmap. Retry to request a fresh proposal.");
        }
        return stageIds[dependency];
      });
      return {
        id: stageIds[index],
        title: requiredName(stage.title, "Argument Roadmap stage title"),
        majorClaim: requiredName(stage.majorClaim, "Argument Roadmap major claim"),
        dependsOnStageIds: dependencies,
        sourceAnchorId: anchors[index].id,
        sessionId: sessionIds[index]
      };
    });
    const roadmap: ArgumentRoadmap = {
      id: roadmapId,
      missionId: location.missionId,
      sourceId: source.id,
      title: requiredName(proposed.title, "Argument Roadmap title"),
      selectedStageId: stageIds[proposed.proposedStage],
      stages
    };
    const sessions = proposed.stages.map((stage, index): LearningSession => {
      const selected = index === proposed.proposedStage;
      const learningSlice: LearningSlice = {
        roadmapId,
        stageId: stageIds[index],
        boundary: requiredName(stage.boundary, "Learning Slice boundary"),
        immediatePrerequisites: stage.immediatePrerequisites.map((item) => requiredName(item, "Immediate prerequisite"))
      };
      return createLearningSession({
        id: sessionIds[index],
        workspaceId: location.workspaceId,
        missionId: location.missionId,
        mathematics,
        sourceIds: [source.id],
        learningGoal: requiredName(stage.learningGoal, "Learning Goal"),
        sessionTarget: learningSlice.boundary,
        status: selected ? "active" : "paused",
        activityOrder: selected ? this.nextActivityOrder() : 0,
        returnContext: {
          label: `${roadmap.title} · ${stage.title}`,
          nextAction: selected ? proposal.initialTeachingDirection : "Choose this roadmap stage as the next Learning Slice"
        },
        proposal: {
          scope: learningSlice.boundary,
          initialTeachingDirection: selected ? proposal.initialTeachingDirection : `Begin with ${stage.title}`,
          status: "awaitingConfirmation",
          confirmationReason: "Confirm this Learning Slice before detailed teaching begins."
        },
        accessPolicy: location.accessPolicy,
        sourceAnchors: [anchors[index]],
        activeSourceAnchorId: anchors[index].id,
        learningSlice
      });
    });
    for (const session of sessions) refreshAskBarContext(this.state, session);
    this.state.argumentRoadmaps.push(roadmap);
    this.state.sessions.push(...sessions);
    return sessions[proposed.proposedStage];
  }

  private requireSession(sessionId: string): LearningSession {
    const session = this.state.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error("Choose an existing Learning Session.");
    return session;
  }

  private requireNamedWorkspace(workspaceId: string): StudyWorkspace {
    const workspace = this.state.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace || workspace.kind !== "named") throw new Error("Choose a named Study Workspace.");
    return workspace;
  }

  private requireWorkspace(workspaceId: string): StudyWorkspace {
    const workspace = this.state.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) throw new Error("Choose an existing Study Workspace.");
    return workspace;
  }

  private requireSourcePlacement(
    workspace: StudyWorkspace,
    role: LinkedSource["role"],
    path: string
  ): void {
    const linkedSources = this.state.sources.filter(
      (candidate): candidate is LinkedSource => candidate.workspaceId === workspace.id && candidate.kind === "linkedSource"
    );
    if (role === "externalAttachment") {
      const primaryFolder = linkedSources.find((source) => source.role === "primaryFolder");
      if (primaryFolder && pathIsInside(path, primaryFolder.link.canonicalPath)) {
        throw new Error("This file is already covered by the Primary Folder.");
      }
      return;
    }
    if (linkedSources.some((source) => source.role === "externalAttachment" && pathIsInside(source.link.canonicalPath, path))) {
      throw new Error("An existing External Attachment is already inside this Primary Folder.");
    }
  }

  private recordSourceFingerprint(source: LinkedSource, fingerprint: SourceFingerprint): boolean {
    if (sameFingerprint(source.link.fingerprint, fingerprint)) return false;
    const fromRevisionId = source.link.currentRevisionId;
    source.link.fingerprint = structuredClone(fingerprint);
    source.link.currentRevisionId = crypto.randomUUID();
    this.state.sourceRevisions.push(sourceRevision(source));
    this.markSourceAnchorsUnresolved(source, fromRevisionId);
    this.removeSourceSearchResults(source.id);
    return true;
  }

  private markSourceAnchorsUnresolved(source: LinkedSource, fromRevisionId: string): void {
    this.visitStaleSourceAnchors(source, (session, anchor) => {
      const existing = this.state.reanchoringDecisions.find(
        (decision) => decision.sourceAnchorId === anchor.id
          && (decision.status === "unresolved" || decision.status === "leftUnresolved")
      );
      this.upsertReanchoringDecision(existing, {
        id: existing?.id ?? crypto.randomUUID(),
        sessionId: session.id,
        sourceId: source.id,
        sourceAnchorId: anchor.id,
        fromRevisionId: existing ? existing.fromRevisionId : anchor.sourceRevisionId ?? fromRevisionId,
        toRevisionId: source.link.currentRevisionId,
        oldSelection: structuredClone(existing?.oldSelection ?? anchor.selection),
        proposedSelection: null,
        status: "unresolved"
      });
      return true;
    });
  }

  private reanchorSourceAnchors(source: LinkedSource, extraction: SourceIndexExtraction): void {
    this.visitStaleSourceAnchors(source, (session, anchor) => {
      const existing = this.state.reanchoringDecisions.find(
        (decision) => decision.sourceAnchorId === anchor.id && (decision.status === "unresolved"
          || decision.status === "leftUnresolved"
          || decision.toRevisionId === source.link.currentRevisionId)
      );
      if (existing?.status === "leftUnresolved" && existing.toRevisionId === source.link.currentRevisionId) return false;
      const fromRevisionId = existing
        ? existing.fromRevisionId
        : anchor.sourceRevisionId ?? this.previousSourceRevisionId(source);
      const oldSelection = structuredClone(existing?.oldSelection ?? anchor.selection);
      const match = reanchoringMatch(anchor.selection, extraction);
      if (match.strong) {
        anchor.selection = match.selection!;
        anchor.sourceRevisionId = source.link.currentRevisionId;
      }
      this.upsertReanchoringDecision(existing, {
        id: existing?.id ?? crypto.randomUUID(),
        sessionId: session.id,
        sourceId: source.id,
        sourceAnchorId: anchor.id,
        fromRevisionId,
        toRevisionId: source.link.currentRevisionId,
        oldSelection,
        proposedSelection: match.selection,
        status: match.strong ? "automatic" : "unresolved"
      });
      return true;
    });
  }

  private visitStaleSourceAnchors(
    source: LinkedSource,
    visit: (session: LearningSession, anchor: SourceAnchor) => boolean
  ): void {
    for (const session of this.state.sessions) {
      let changed = false;
      for (const anchor of session.sourceAnchors) {
        if (anchor.sourceId !== source.id || anchor.sourceRevisionId === source.link.currentRevisionId) continue;
        if (visit(session, anchor)) changed = true;
      }
      if (changed) refreshAskBarContext(this.state, session, true);
    }
  }

  private upsertReanchoringDecision(
    existing: ReanchoringDecision | undefined,
    decision: ReanchoringDecision
  ): void {
    if (existing) Object.assign(existing, decision);
    else this.state.reanchoringDecisions.push(decision);
  }

  private previousSourceRevisionId(source: LinkedSource): string | null {
    const revisions = this.state.sourceRevisions.filter((revision) => revision.sourceId === source.id);
    return revisions.length > 1 ? revisions.at(-2)!.id : null;
  }

  private createManagedTextAsset(workspaceId: string, content: string): ManagedAsset {
    const workspace = this.requireWorkspace(workspaceId);
    const asset: ManagedAsset = {
      id: crypto.randomUUID(),
      kind: "managedAsset",
      workspaceId,
      name: "Typed mathematics",
      mediaType: "text/plain",
      content
    };
    this.state.sources.push(asset);
    workspace.context.sourceIds.push(asset.id);
    return asset;
  }

  private requireMission(workspaceId: string, missionId: string): StudyMission {
    const mission = this.state.missions.find(
      (candidate) => candidate.id === missionId && candidate.workspaceId === workspaceId
    );
    if (!mission) throw new Error("Choose a Study Mission in this Study Workspace.");
    return mission;
  }

  private resolveIntakeLocation(location?: StudyLocation): StudyLocation & { accessPolicy: SessionAccessPolicy } {
    if (!location) {
      return {
        workspaceId: this.state.quickStudy.workspace.id,
        missionId: this.state.quickStudy.mission.id,
        accessPolicy: "focused"
      };
    }
    const workspace = this.requireNamedWorkspace(location.workspaceId);
    const mission = this.requireMission(workspace.id, location.missionId);
    return { workspaceId: workspace.id, missionId: mission.id, accessPolicy: "workspace" };
  }

  private async openConceptPeek(session: LearningSession, sourceAnchorId: string, prerequisiteValue: string): Promise<void> {
    const anchor = requireSourceAnchor(session, sourceAnchorId);
    const prerequisite = requiredName(prerequisiteValue, "Concept Peek prerequisite");
    const existing = session.conceptPeeks.find(
      (peek) => peek.sourceAnchorId === anchor.id && peek.prerequisite === prerequisite
    );
    if (existing) {
      existing.status = "open";
    } else {
      this.requireModelAccess();
      if (this.modelWorks.has(session.id)) {
        throw new Error("Wait for the current model teaching to finish before opening a Concept Peek.");
      }
      const log = this.agentWorkLogs[session.id] ?? [];
      this.agentWorkLogs[session.id] = log;
      const controller = new AbortController();
      const runtime = this.modelRuntime!;
      session.pendingConceptPeek = { sourceAnchorId: anchor.id, prerequisite };
      this.emitState();
      this.queuePersistence();
      const promise = Promise.resolve().then(() => runtime.createConceptPeek({
        sessionId: session.id,
        prerequisite,
        mathematics: session.mathematics,
        learningGoal: session.learningGoal,
        sourceAnchorId: anchor.id,
        sourceId: anchor.sourceId,
        selection: anchor.selection,
        signal: controller.signal,
        onRuntimeEvent: (event) => {
          if (!controller.signal.aborted) log.push({ ...event, sequence: log.length + 1 });
        }
      }));
      this.modelWorks.set(session.id, {
        controller,
        promise,
        stop: () => undefined,
        markUnconfirmed: () => undefined,
        restart: () => this.openConceptPeek(session, anchor.id, prerequisite)
      });
      let generated: string;
      try {
        generated = await promise;
      } catch (error) {
        if (controller.signal.aborted) throw new Error("Concept Peek generation was stopped.");
        this.recordModelAccessLoss(error);
        throw error;
      } finally {
        if (this.modelWorks.get(session.id)?.promise === promise) this.modelWorks.delete(session.id);
        session.pendingConceptPeek = null;
        this.emitState();
        this.queuePersistence();
      }
      const content = requiredText(generated, "Concept Peek explanation");
      session.conceptPeeks.push({
        id: crypto.randomUUID(),
        sourceAnchorId: anchor.id,
        prerequisite,
        content,
        status: "open"
      });
    }
    session.activeSourceAnchorId = anchor.id;
    session.activityOrder = this.nextActivityOrder();
    this.state.resumeSessionId = session.id;
  }

  private linkedSessionsForFiling(start: LearningSession): LearningSession[] {
    const linkedIds = new Set([start.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const session of this.state.sessions) {
        const linkedByRoadmap = session.learningSlice && this.state.sessions.some((candidate) => linkedIds.has(candidate.id)
          && candidate.learningSlice?.roadmapId === session.learningSlice?.roadmapId);
        const linkedByOrigin = session.prerequisiteBranch
          && linkedIds.has(session.prerequisiteBranch.returnPoint.originSessionId);
        const linksKnownBranch = session.prerequisiteBranch
          && linkedIds.has(session.id) && !linkedIds.has(session.prerequisiteBranch.returnPoint.originSessionId);
        const hasKnownBranch = session.prerequisiteBranchProposals.some(
          (proposal) => proposal.branchSessionId !== null && linkedIds.has(proposal.branchSessionId)
        );
        if ((linkedByRoadmap || linkedByOrigin || linksKnownBranch || hasKnownBranch) && !linkedIds.has(session.id)) {
          linkedIds.add(session.id);
          changed = true;
        }
        if (linksKnownBranch) {
          linkedIds.add(session.prerequisiteBranch!.returnPoint.originSessionId);
          changed = true;
        }
      }
    }
    return this.state.sessions.filter((session) => linkedIds.has(session.id));
  }

  private pauseActiveSession(): void {
    if (!this.state.activeSessionId) return;
    this.requireSession(this.state.activeSessionId).status = "paused";
  }

  private pauseActiveSessionAndMakeResumable(): LearningSession {
    const session = this.requireActiveSession();
    session.status = "paused";
    session.activityOrder = this.nextActivityOrder();
    this.state.resumeSessionId = session.id;
    this.state.activeSessionId = null;
    return session;
  }

  private nextActivityOrder(): number {
    this.state.activityOrder += 1;
    return this.state.activityOrder;
  }

  private latestPausedSessionId(excludedSessionId: string): string | null {
    return this.state.sessions
      .filter((session) => session.id !== excludedSessionId && session.status === "paused")
      .sort((left, right) => right.activityOrder - left.activityOrder)[0]?.id ?? null;
  }

  private requireArtifactEditingSession(sessionId?: string): LearningSession {
    if (!sessionId) return this.requireActiveSession();
    const session = this.requireSession(sessionId);
    if (session.status !== "consolidated" && session.id !== this.state.activeSessionId) {
      throw new Error("Choose an active or consolidated Learning Session to revise its Learning Artifact.");
    }
    return session;
  }
}

function agentBudgetLimitMessage(error: unknown, preservedPartialOutput: boolean): string | null {
  const message = error instanceof Error ? error.message.toLocaleLowerCase() : "";
  const preservation = preservedPartialOutput
    ? " Useful partial output was preserved."
    : " No useful partial output was available to preserve.";
  if (message.includes("token budget")) {
    return `Agent Task stopped at its token limit.${preservation}`;
  }
  if (message.includes("timed out") || message.includes("latency")) {
    return `Agent Task stopped at its latency limit.${preservation}`;
  }
  return null;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function requiredName(value: string, subject: string): string {
  const name = value.trim();
  if (!name) throw new Error(`${subject} name is required.`);
  return name;
}

function requiredText(value: string, subject: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${subject} text is required.`);
  return text;
}

function requiredVerbatimText(value: string, subject: string): string {
  if (!value.trim()) throw new Error(`${subject} text is required.`);
  return value;
}

function validatedArtifactSynthesisResult(
  value: unknown,
  personalNoteIds: string[]
): ArtifactSynthesisResult {
  if (!isRecord(value) || typeof value.content !== "string" || !value.content.trim()
    || !Array.isArray(value.noteInterpretations)) {
    throw new Error("Codex returned an invalid Learning Artifact synthesis.");
  }
  const interpretations = value.noteInterpretations;
  if (!interpretations.every((item) => isRecord(item) && typeof item.annotationId === "string"
      && typeof item.interpretation === "string" && Boolean(item.interpretation.trim()))) {
    throw new Error("Codex returned an invalid Learning Artifact synthesis.");
  }
  const expected = new Set(personalNoteIds);
  const returned = new Set(interpretations.map((item) => item.annotationId as string));
  if (returned.size !== interpretations.length
    || [...returned].some((annotationId) => !expected.has(annotationId))) {
    throw new Error("Codex returned Note Interpretations that do not match the supplied Personal Notes.");
  }
  return {
    content: value.content,
    noteInterpretations: interpretations as ArtifactSynthesisResult["noteInterpretations"]
  };
}

function validatedSpecialistAgentResult(value: unknown): SpecialistAgentResult {
  if (!isRecord(value) || typeof value.title !== "string" || !value.title.trim()
    || typeof value.content !== "string" || !value.content.trim()) {
    throw new Error("Codex returned a malformed Specialist Agent result. Retry to request a fresh review.");
  }
  return { title: value.title, content: value.content };
}

function requireTargetDisposition(value: unknown): TargetDisposition {
  if (value !== "addressed" && value !== "deferred" && value !== "unresolved") {
    throw new Error("Choose Addressed, Deferred, or Unresolved for the Session Target.");
  }
  return value;
}

function accessPolicyRank(policy: SessionAccessPolicy): number {
  return { focused: 0, workspace: 1, full: 2 }[policy];
}

function usefulRuntimeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Codex could not complete this Teaching Card. Check authentication and try again.";
}

function agentWorkEvidenceSummary(event: ModelRuntimeEvent): string {
  if (event.workKind === "specialist") {
    return {
      threadStarted: "Specialist Agent task started.",
      turnStarted: "Specialist Agent turn started.",
      inputSubmitted: "Bounded Agent Brief submitted.",
      toolCalled: "Specialist Agent checkpoint retained.",
      outputDelta: "Specialist Agent output advanced.",
      turnCompleted: "Specialist Agent turn completed.",
      turnFailed: "Specialist Agent turn failed."
    }[event.type];
  }
  return {
    threadStarted: "Teaching runtime thread started.",
    turnStarted: "Teaching runtime turn started.",
    inputSubmitted: "Bounded teaching input submitted.",
    toolCalled: "Teaching runtime tool called.",
    outputDelta: "Learner-facing output advanced.",
    turnCompleted: "Teaching runtime turn completed.",
    turnFailed: "Teaching runtime turn failed."
  }[event.type];
}

function usefulSourceError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The source is missing or access is no longer available.";
}

function sameFingerprint(left: SourceFingerprint, right: SourceFingerprint): boolean {
  return left.size === right.size && left.modifiedAtMs === right.modifiedAtMs
    && left.contentHash === right.contentHash;
}

function pathIsInside(path: string, folderPath: string): boolean {
  const relation = relative(folderPath, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

function mostRecentPausedSessionId(sessions: LearningSession[]): string | null {
  return sessions.filter((session) => session.status === "paused").reduce<LearningSession | null>(
    (latest, session) => (!latest || session.activityOrder > latest.activityOrder ? session : latest),
    null
  )?.id ?? null;
}

function validateProposedArgumentRoadmap(proposed: ArgumentRoadmapProposal, mathematics: string): void {
  const invalid = !proposed.title.trim() || proposed.stages.length < 2 || proposed.stages.length > 12
    || !Number.isInteger(proposed.proposedStage)
    || proposed.proposedStage < 0 || proposed.proposedStage >= proposed.stages.length
    || proposed.stages.some((stage, index) => !stage.title.trim() || !stage.majorClaim.trim()
      || !stage.sourceExcerpt.trim() || mathematics.indexOf(stage.sourceExcerpt) < 0
      || mathematics.indexOf(stage.sourceExcerpt) !== mathematics.lastIndexOf(stage.sourceExcerpt)
      || !stage.learningGoal.trim() || !stage.boundary.trim()
      || !Array.isArray(stage.dependsOn) || stage.dependsOn.some((dependency) => !Number.isInteger(dependency)
        || dependency < 0 || dependency >= index)
      || !Array.isArray(stage.immediatePrerequisites)
      || stage.immediatePrerequisites.some((prerequisite) => !prerequisite.trim()));
  if (invalid) throw new Error("Codex returned an invalid Argument Roadmap. Retry to request a fresh proposal.");
}


function migratePersistedState(value: unknown): LearningApplicationState {
  if (!value || typeof value !== "object") throw new Error("Stored Learning Application state is invalid.");
  const stored = value as Record<string, unknown>;
  if (Array.isArray(stored.sessions)) {
    const current = value as LearningApplicationState;
    current.workspaces = current.workspaces.map((workspace) => ({
      ...workspace,
      context: {
        ...(workspace.context ?? emptyWorkspaceContext()),
        primaryFolderSourceId: workspace.context?.primaryFolderSourceId ?? null
      }
    }));
    current.sources = migrateWorkspaceSources(current.sources);
    current.sourceIndexes = migrateSourceIndexSummaries(stored.sourceIndexes);
    current.sourceRevisions = migrateSourceRevisions(stored.sourceRevisions, current.sources);
    current.reanchoringDecisions = migrateReanchoringDecisions(stored.reanchoringDecisions);
    current.authentication ??= signedOutAuthentication();
    current.intakeError ??= null;
    current.runtimeAvailable ??= false;
    current.runtimeCapabilities = { models: [] };
    current.modelAccess ??= {
      status: "unavailable",
      cause: "runtime",
      message: "Codex Runtime is unavailable. Restart Codex and try again."
    };
    current.accessConfirmationPreference = migrateAccessConfirmationPreference(stored.accessConfirmationPreference);
    current.personalNoteSynthesisPreference = migratePersonalNoteSynthesisPreference(stored.personalNoteSynthesisPreference);
    current.argumentRoadmaps = migrateArgumentRoadmaps(stored.argumentRoadmaps);
    current.sessions = current.sessions.map((session) => ({
      ...session,
      sourceIds: session.sourceIds ?? [],
      proposal: session.proposal ?? defaultAcceptedProposal(),
      teachingCard: session.teachingCard ?? emptyTeachingCard(),
      teachingCardHistory: session.teachingCardHistory ?? [],
      submittedPendingQuestions: session.submittedPendingQuestions ?? [],
      currentTeachingInput: session.currentTeachingInput ?? { kind: "sessionIntake", text: session.mathematics },
      pendingQuestion: migratePendingQuestion(session.pendingQuestion),
      askBarContext: migrateAskBarContext(session.askBarContext),
      questionCards: migrateQuestionCards(session.questionCards),
      activeQuestionCardId: typeof session.activeQuestionCardId === "string" ? session.activeQuestionCardId : null,
      accessPolicy: migrateSessionAccessPolicy(session.accessPolicy),
      accessRequests: migrateAccessRequests(session.accessRequests),
      pendingFullAccessConfirmation: false,
      sourceAnchors: migrateSourceAnchors(session.sourceAnchors, current.sources, current.sourceRevisions),
      sourceAnchorRequests: migrateSourceAnchorRequests(session.sourceAnchorRequests),
      annotations: migrateAnnotations(session.annotations),
      activeSourceAnchorId: typeof session.activeSourceAnchorId === "string" ? session.activeSourceAnchorId : null,
      anchoredTeachingCards: migrateAnchoredTeachingCards(session.anchoredTeachingCards),
      activeTeachingCardId: typeof session.activeTeachingCardId === "string" ? session.activeTeachingCardId : null,
      learningArtifacts: migrateLearningArtifacts(session.learningArtifacts, session.id),
      trailDraft: migrateTrailDraft(session.trailDraft),
      consolidationDraft: migrateSessionConsolidationDraft(session.consolidationDraft),
      consolidatedOutcome: migrateConsolidatedSessionOutcome(session.consolidatedOutcome),
      continuationOf: migrateContinuationLink(session.continuationOf),
      modelStopConfirmation: migrateModelStopConfirmation(session.modelStopConfirmation),
      learningSlice: migrateLearningSlice(session.learningSlice),
      conceptPeeks: migrateConceptPeeks(session.conceptPeeks),
      pendingConceptPeek: migratePendingConceptPeek(session.pendingConceptPeek),
      prerequisiteBranchProposals: migratePrerequisiteBranchProposals(session.prerequisiteBranchProposals),
      prerequisiteBranch: migratePrerequisiteBranch(session.prerequisiteBranch),
      agentTasks: migrateAgentTasks(session.agentTasks),
      activeAgentTaskId: typeof session.activeAgentTaskId === "string" ? session.activeAgentTaskId : null,
      reasoningPreference: migrateReasoningPreference(session.reasoningPreference),
      runtimeOverride: migrateRuntimeOverride(session.runtimeOverride)
    }));
    addLegacyUnresolvedReanchoringDecisions(current);
    attachManagedSourcesToLegacySessions(current);
    for (const session of current.sessions) {
      validateSessionSourceAnchorReferences(current, session);
      validateQuestionCardReferences(current, session);
      validateAgentTaskReferences(session);
      refreshAskBarContext(current, session);
    }
    validateReanchoringDecisionReferences(current);
    validateSessionLifecycleReferences(current);
    validateArgumentRoadmapReferences(current);
    validatePrerequisiteBranchReferences(current);
    return current;
  }

  if (!("session" in stored)) throw new Error("Stored Learning Application state uses an unsupported version.");
  const legacy = value as {
    session: Omit<LearningSession, "activityOrder"> | null;
  };
  const migrated = initialState();
  if (legacy.session) {
    const session: LearningSession = {
      ...legacy.session,
      sourceIds: [],
      status: "paused",
      activityOrder: 1,
      proposal: defaultAcceptedProposal(),
      teachingCard: emptyTeachingCard(),
      teachingCardHistory: [],
      submittedPendingQuestions: [],
      currentTeachingInput: { kind: "sessionIntake", text: legacy.session.mathematics },
      pendingQuestion: null,
      askBarContext: emptyAskBarContext(),
      questionCards: [],
      activeQuestionCardId: null,
      accessPolicy: "focused",
      accessRequests: [],
      pendingFullAccessConfirmation: false,
      sourceAnchors: [],
      sourceAnchorRequests: [],
      annotations: [],
      activeSourceAnchorId: null,
      anchoredTeachingCards: [],
      activeTeachingCardId: null,
      learningArtifacts: [],
      trailDraft: emptyTrailDraft(),
      ...emptySessionLifecycle(),
      learningSlice: null,
      conceptPeeks: [],
      pendingConceptPeek: null,
      prerequisiteBranchProposals: [],
      prerequisiteBranch: null,
      agentTasks: [],
      activeAgentTaskId: null,
      reasoningPreference: "balanced",
      runtimeOverride: null
    };
    migrated.sessions.push(session);
    attachManagedSourcesToLegacySessions(migrated);
    validateSessionSourceAnchorReferences(migrated, session);
    validatePrerequisiteBranchReferences(migrated);
    refreshAskBarContext(migrated, session);
    migrated.resumeSessionId = session.id;
    migrated.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
    migrated.activityOrder = 1;
  }
  return migrated;
}

function migrateAgentWorkLogs(value: unknown): Record<string, Array<ModelRuntimeEvent & { sequence: number }>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Array<ModelRuntimeEvent & { sequence: number }>>
    : {};
}

function migrateAgentTasks(value: unknown): AgentTask[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored Agent Tasks are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.purpose !== "string" || !candidate.purpose.trim()
      || !["working", "waiting", "failed", "stopped", "complete"].includes(String(candidate.status))
      || !(candidate.statusMessage === null || typeof candidate.statusMessage === "string")
      || !isRecord(candidate.identifiedNeed) || !isRecord(candidate.brief)
      || !isRecord(candidate.budget) || !isRecord(candidate.integratedTeachingCard)
      || !(candidate.priorAgentWorkLogReferences === undefined || Array.isArray(candidate.priorAgentWorkLogReferences))) {
      throw new Error("Stored Agent Tasks are invalid.");
    }
    const need = candidate.identifiedNeed;
    const brief = candidate.brief;
    const budget = candidate.budget;
    const coordination = candidate.coordination ?? "single";
    const specialistBriefs = candidate.specialistBriefs ?? [brief];
    const card = candidate.integratedTeachingCard;
    const reference = candidate.agentWorkLogReference;
    const priorReferences = candidate.priorAgentWorkLogReferences ?? [];
    if (need.kind !== "hiddenAssumptionReview" || need.requestedBy !== "learner"
      || typeof need.description !== "string" || !need.description.trim()
      || !["single", "dependent", "independent"].includes(String(coordination))
      || typeof brief.learningGoal !== "string" || !brief.learningGoal.trim()
      || !Array.isArray(brief.sourceAnchors) || !brief.sourceAnchors.every((anchor) => isRecord(anchor)
        && typeof anchor.sourceAnchorId === "string" && typeof anchor.sourceId === "string"
        && isSourceAnchorSelection(anchor.selection))
      || !isNonEmptyStringArray(brief.constraints) || !isStringArray(brief.learnerEvidence)
      || typeof brief.expectedOutput !== "string" || !brief.expectedOutput.trim()
      || !isNonEmptyStringArray(brief.verificationNeeds)
      || !Number.isInteger(budget.agentCount) || (budget.agentCount as number) < 1
      || !Number.isInteger(budget.concurrency) || (budget.concurrency as number) < 1
      || (budget.concurrency as number) > (budget.agentCount as number)
      || typeof budget.model !== "string" || !budget.model.trim()
      || !isReasoningEffort(budget.reasoningEffort) || !Array.isArray(budget.tools)
      || budget.tools.length !== 1 || budget.tools[0] !== "checkpointSpecialistResult"
      || !Number.isInteger(budget.maxTokens) || (budget.maxTokens as number) < 1
      || !Number.isInteger(budget.maxLatencyMs) || (budget.maxLatencyMs as number) < 1
      || !Array.isArray(specialistBriefs) || specialistBriefs.length !== budget.agentCount
      || !specialistBriefs.every(validStoredAgentBrief)
      || typeof card.title !== "string" || !card.title.trim()
      || !["idle", "streaming", "completed", "stopped", "failed"].includes(String(card.status))
      || typeof card.content !== "string" || !(card.error === null || typeof card.error === "string")
      || typeof card.retryable !== "boolean"
      || !(reference === null || (isRecord(reference) && typeof reference.sessionId === "string"
        && Number.isInteger(reference.fromSequence) && Number.isInteger(reference.toSequence)
        && (reference.fromSequence as number) >= 1 && (reference.toSequence as number) >= (reference.fromSequence as number)))
      || !(priorReferences as unknown[]).every(validAgentWorkLogReference)) {
      throw new Error("Stored Agent Tasks are invalid.");
    }
    return {
      ...candidate,
      coordination,
      specialistBriefs,
      priorAgentWorkLogReferences: priorReferences
    } as unknown as AgentTask;
  });
}

function validStoredAgentBrief(value: unknown): value is AgentBrief {
  return isRecord(value) && typeof value.learningGoal === "string" && Boolean(value.learningGoal.trim())
    && Array.isArray(value.sourceAnchors) && value.sourceAnchors.every((anchor) => isRecord(anchor)
      && typeof anchor.sourceAnchorId === "string" && typeof anchor.sourceId === "string"
      && isSourceAnchorSelection(anchor.selection))
    && isNonEmptyStringArray(value.constraints) && isStringArray(value.learnerEvidence)
    && typeof value.expectedOutput === "string" && Boolean(value.expectedOutput.trim())
    && isNonEmptyStringArray(value.verificationNeeds);
}

function validAgentWorkLogReference(value: unknown): value is NonNullable<TeachingCardRevision["agentWorkLogReference"]> {
  return isRecord(value) && typeof value.sessionId === "string"
    && Number.isInteger(value.fromSequence) && Number.isInteger(value.toSequence)
    && (value.fromSequence as number) >= 1 && (value.toSequence as number) >= (value.fromSequence as number);
}

function validateAgentTaskReferences(session: LearningSession): void {
  if (new Set(session.agentTasks.map((task) => task.id)).size !== session.agentTasks.length
    || (session.activeAgentTaskId !== null && !session.agentTasks.some((task) => task.id === session.activeAgentTaskId))) {
    throw new Error("Stored Agent Task references are invalid.");
  }
  for (const task of session.agentTasks) {
    if (task.agentWorkLogReference?.sessionId !== undefined && task.agentWorkLogReference.sessionId !== session.id) {
      throw new Error("Stored Agent Task references are invalid.");
    }
    if (task.priorAgentWorkLogReferences.some((reference) => reference.sessionId !== session.id)) {
      throw new Error("Stored Agent Task references are invalid.");
    }
    for (const briefAnchor of task.specialistBriefs.flatMap((brief) => brief.sourceAnchors)) {
      const anchor = session.sourceAnchors.find((candidate) => candidate.id === briefAnchor.sourceAnchorId);
      if (!anchor || anchor.sourceId !== briefAnchor.sourceId
        || JSON.stringify(anchor.selection) !== JSON.stringify(briefAnchor.selection)) {
        throw new Error("Stored Agent Task references are invalid.");
      }
    }
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return isStringArray(value) && value.length > 0 && value.every((item) => Boolean(item.trim()));
}

function migrateArgumentRoadmaps(value: unknown): ArgumentRoadmap[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored Argument Roadmaps are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.missionId !== "string"
      || typeof candidate.sourceId !== "string" || typeof candidate.title !== "string"
      || typeof candidate.selectedStageId !== "string" || !Array.isArray(candidate.stages)) {
      throw new Error("Stored Argument Roadmaps are invalid.");
    }
    const stages = candidate.stages.map((stage) => {
      if (!isRecord(stage) || typeof stage.id !== "string" || typeof stage.title !== "string"
        || typeof stage.majorClaim !== "string" || !Array.isArray(stage.dependsOnStageIds)
        || !stage.dependsOnStageIds.every((id) => typeof id === "string")
        || typeof stage.sourceAnchorId !== "string" || typeof stage.sessionId !== "string") {
        throw new Error("Stored Argument Roadmaps are invalid.");
      }
      return stage as unknown as ArgumentRoadmapStage;
    });
    return { ...candidate, stages } as unknown as ArgumentRoadmap;
  });
}

function migrateLearningSlice(value: unknown): LearningSlice | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.roadmapId !== "string" || typeof value.stageId !== "string"
    || typeof value.boundary !== "string" || !value.boundary.trim() || !Array.isArray(value.immediatePrerequisites)
    || !value.immediatePrerequisites.every((item) => typeof item === "string" && Boolean(item.trim()))) {
    throw new Error("Stored Learning Slice is invalid.");
  }
  return value as unknown as LearningSlice;
}

function migrateConceptPeeks(value: unknown): ConceptPeek[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((peek) => !isRecord(peek)
    || typeof peek.id !== "string" || typeof peek.sourceAnchorId !== "string"
    || typeof peek.prerequisite !== "string" || !peek.prerequisite.trim()
    || typeof peek.content !== "string" || !peek.content.trim()
    || !["open", "closed"].includes(String(peek.status)))) {
    throw new Error("Stored Concept Peeks are invalid.");
  }
  return value as ConceptPeek[];
}

function migratePendingConceptPeek(value: unknown): LearningSession["pendingConceptPeek"] {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.sourceAnchorId !== "string"
    || typeof value.prerequisite !== "string" || !value.prerequisite.trim()) {
    throw new Error("Stored pending Concept Peek is invalid.");
  }
  return value as unknown as LearningSession["pendingConceptPeek"];
}

function migratePrerequisiteBranchProposals(value: unknown): PrerequisiteBranchProposal[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((proposal) => !isRecord(proposal)
    || typeof proposal.id !== "string" || typeof proposal.sourceAnchorId !== "string"
    || typeof proposal.prerequisite !== "string" || !proposal.prerequisite.trim()
    || !["pending", "accepted", "deferred", "overridden"].includes(String(proposal.status))
    || !(proposal.branchSessionId === null || typeof proposal.branchSessionId === "string"))) {
    throw new Error("Stored Prerequisite Branch proposals are invalid.");
  }
  return value as PrerequisiteBranchProposal[];
}

function migratePrerequisiteBranch(value: unknown): PrerequisiteBranch | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.prerequisite !== "string" || !value.prerequisite.trim()
    || !isRecord(value.returnPoint) || typeof value.returnPoint.originSessionId !== "string"
    || typeof value.returnPoint.sourceId !== "string" || typeof value.returnPoint.sourceAnchorId !== "string"
    || !(value.returnPoint.activeTeachingCardId === null || typeof value.returnPoint.activeTeachingCardId === "string")
    || typeof value.returnPoint.label !== "string" || !value.returnPoint.label.trim()) {
    throw new Error("Stored Prerequisite Branch is invalid.");
  }
  return value as unknown as PrerequisiteBranch;
}

function validateArgumentRoadmapReferences(state: LearningApplicationState): void {
  const missionIds = new Set(state.missions.map((mission) => mission.id));
  const sourceIds = new Set(state.sources.map((source) => source.id));
  const sessions = new Map(state.sessions.map((session) => [session.id, session]));
  for (const roadmap of state.argumentRoadmaps) {
    const stageIds = new Set(roadmap.stages.map((stage) => stage.id));
    if (!missionIds.has(roadmap.missionId) || !sourceIds.has(roadmap.sourceId)
      || !stageIds.has(roadmap.selectedStageId) || stageIds.size !== roadmap.stages.length) {
      throw new Error("Stored Argument Roadmap references are invalid.");
    }
    for (const stage of roadmap.stages) {
      const session = sessions.get(stage.sessionId);
      if (!session || session.missionId !== roadmap.missionId
        || session.learningSlice?.roadmapId !== roadmap.id || session.learningSlice.stageId !== stage.id
        || !session.sourceAnchors.some((anchor) => anchor.id === stage.sourceAnchorId && anchor.sourceId === roadmap.sourceId)
        || stage.dependsOnStageIds.some((id) => !stageIds.has(id))) {
        throw new Error("Stored Argument Roadmap references are invalid.");
      }
    }
  }
  if (state.sessions.some((session) => session.learningSlice
    && !state.argumentRoadmaps.some((roadmap) => roadmap.id === session.learningSlice?.roadmapId))) {
    throw new Error("Stored Learning Slice references are invalid.");
  }
}

function validatePrerequisiteBranchReferences(state: LearningApplicationState): void {
  const sessions = new Map(state.sessions.map((session) => [session.id, session]));
  for (const session of state.sessions) {
    const anchorIds = new Set(session.sourceAnchors.map((anchor) => anchor.id));
    if (session.conceptPeeks.some((peek) => !anchorIds.has(peek.sourceAnchorId))
      || (session.pendingConceptPeek !== null && !anchorIds.has(session.pendingConceptPeek.sourceAnchorId))
      || session.prerequisiteBranchProposals.some((proposal) => !anchorIds.has(proposal.sourceAnchorId))) {
      throw new Error("Stored prerequisite navigation references are invalid.");
    }
    for (const proposal of session.prerequisiteBranchProposals) {
      if (proposal.status === "accepted") {
        const branch = proposal.branchSessionId ? sessions.get(proposal.branchSessionId) : null;
        if (!branch || branch.prerequisiteBranch?.returnPoint.originSessionId !== session.id) {
          throw new Error("Stored Prerequisite Branch relationship is invalid.");
        }
      } else if (proposal.branchSessionId !== null) {
        throw new Error("Stored Prerequisite Branch proposal is invalid.");
      }
    }
    if (!session.prerequisiteBranch) continue;
    const origin = sessions.get(session.prerequisiteBranch.returnPoint.originSessionId);
    const returnPoint = session.prerequisiteBranch.returnPoint;
    if (!origin || origin.workspaceId !== session.workspaceId || origin.missionId !== session.missionId
      || !origin.sourceIds.includes(returnPoint.sourceId)
      || !origin.sourceAnchors.some((anchor) => anchor.id === returnPoint.sourceAnchorId && anchor.sourceId === returnPoint.sourceId)
      || (returnPoint.activeTeachingCardId !== null
        && !origin.anchoredTeachingCards.some((card) => card.id === returnPoint.activeTeachingCardId))) {
      throw new Error("Stored Prerequisite Branch Return Point is invalid.");
    }
  }
}

function migrateAccessConfirmationPreference(value: unknown): LearningApplicationState["accessConfirmationPreference"] {
  if (value === undefined) return { confirmFullAccess: true };
  if (!isRecord(value) || typeof value.confirmFullAccess !== "boolean") {
    throw new Error("Stored Access Confirmation Preference is invalid.");
  }
  return { confirmFullAccess: value.confirmFullAccess };
}

function migratePersonalNoteSynthesisPreference(value: unknown): LearningApplicationState["personalNoteSynthesisPreference"] {
  if (value === undefined) return { includePersonalNotes: true };
  if (!isRecord(value) || typeof value.includePersonalNotes !== "boolean") {
    throw new Error("Stored Personal Note Synthesis Preference is invalid.");
  }
  return { includePersonalNotes: value.includePersonalNotes };
}

function migratePendingQuestion(value: unknown): PendingQuestion | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string" || !value.text.trim()) {
    throw new Error("Stored Pending Question is invalid.");
  }
  return {
    id: value.id,
    text: value.text,
    contextIds: Array.isArray(value.contextIds) && value.contextIds.every((id) => typeof id === "string")
      ? value.contextIds
      : []
  };
}

function migrateAskBarContext(value: unknown): AskBarContext {
  if (value === undefined) return emptyAskBarContext();
  if (!isRecord(value) || !Array.isArray(value.includedIds)
    || !value.includedIds.every((id) => typeof id === "string") || typeof value.customized !== "boolean") {
    throw new Error("Stored Ask Bar context is invalid.");
  }
  return { items: [], includedIds: value.includedIds, customized: value.customized };
}

function migrateQuestionCards(value: unknown): QuestionCard[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored Question Cards are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.question !== "string"
      || !candidate.question.trim() || !Array.isArray(candidate.revisions)) {
      throw new Error("Stored Question Cards are invalid.");
    }
    const question = candidate.question;
    return {
      id: candidate.id,
      question,
      currentRevision: migrateQuestionCardRevision(candidate.currentRevision, question),
      revisions: candidate.revisions.map((revision) => migrateQuestionCardRevision(revision, question))
    };
  });
}

function migrateQuestionCardRevision(value: unknown, fallbackQuestion: string): QuestionCardRevision {
  if (!isRecord(value) || typeof value.id !== "string"
    || !["idle", "streaming", "completed", "stopped", "failed"].includes(String(value.status))
    || typeof value.content !== "string" || !(value.error === null || typeof value.error === "string")
    || typeof value.retryable !== "boolean" || !Array.isArray(value.contextUsed)) {
    throw new Error("Stored Question Cards are invalid.");
  }
  const contextUsed = value.contextUsed.map((item) => {
    if (!isQuestionContextItem(item)) throw new Error("Stored Question Cards are invalid.");
    return item;
  });
  const selectedContext = (Array.isArray(value.selectedContext) ? value.selectedContext : value.contextUsed).map((item) => {
    if (!isQuestionContextItem(item)) throw new Error("Stored Question Cards are invalid.");
    return item;
  });
  const reference = value.agentWorkLogReference;
  if (!(reference === null || (isRecord(reference) && typeof reference.sessionId === "string"
    && Number.isInteger(reference.fromSequence) && Number.isInteger(reference.toSequence)))) {
    throw new Error("Stored Question Cards are invalid.");
  }
  const question = typeof value.question === "string" && value.question.trim() ? value.question : fallbackQuestion;
  return { ...value, question, selectedContext, contextUsed, agentWorkLogReference: reference } as QuestionCardRevision;
}

function isQuestionContextItem(value: unknown): value is QuestionContextItem {
  return isRecord(value) && typeof value.id === "string"
    && ["sourceAnchor", "learningGoal", "sessionContext", "source"].includes(String(value.kind))
    && typeof value.typeLabel === "string" && typeof value.identity === "string"
    && typeof value.location === "string" && typeof value.preview === "string"
    && (value.sourceId === null || typeof value.sourceId === "string")
    && (value.sourceAnchorId === null || typeof value.sourceAnchorId === "string");
}

function validateQuestionCardReferences(state: LearningApplicationState, session: LearningSession): void {
  const identifiersAreUnique = new Set(session.questionCards.map((card) => card.id)).size === session.questionCards.length;
  const activeIsValid = session.activeQuestionCardId === null
    || session.questionCards.some((card) => card.id === session.activeQuestionCardId);
  const existingSourceIds = new Set(state.sources.map((source) => source.id));
  const contextReferencesAreValid = session.questionCards.every((card) => [card.currentRevision, ...card.revisions]
    .every((revision) => [...revision.selectedContext, ...revision.contextUsed].every((item) => {
      if (item.sourceId !== null && !existingSourceIds.has(item.sourceId)) return false;
      if (item.sourceAnchorId === null) return true;
      return session.sourceAnchors.some((anchor) => anchor.id === item.sourceAnchorId && anchor.sourceId === item.sourceId);
    })));
  if (!identifiersAreUnique || !activeIsValid || !contextReferencesAreValid) {
    throw new Error("Stored Question Card references are invalid.");
  }
}

function migrateSessionAccessPolicy(value: unknown): SessionAccessPolicy {
  if (value === undefined) return "focused";
  if (value === "focused" || value === "workspace" || value === "full") return value;
  throw new Error("Stored Session Access Policy is invalid.");
}

function migrateAccessRequests(value: unknown): SessionAccessRequest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored Access Request is invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string"
      || (candidate.requestedPolicy !== "workspace" && candidate.requestedPolicy !== "full")
      || typeof candidate.reason !== "string" || !candidate.reason.trim()
      || typeof candidate.exactScope !== "string" || !candidate.exactScope.trim()
      || typeof candidate.intendedAction !== "string" || !candidate.intendedAction.trim()
      || !["pending", "approved", "denied", "narrowed"].includes(String(candidate.status))
      || !(candidate.decidedPolicy === null || ["focused", "workspace", "full"].includes(String(candidate.decidedPolicy)))) {
      throw new Error("Stored Access Request is invalid.");
    }
    const hasDecision = candidate.status === "approved" || candidate.status === "narrowed";
    if (hasDecision !== (candidate.decidedPolicy !== null)) throw new Error("Stored Access Request is invalid.");
    return candidate as unknown as SessionAccessRequest;
  });
}

function defaultAcceptedProposal(): LearningSession["proposal"] {
  return {
    scope: "Work through the key mathematical idea",
    initialTeachingDirection: "Continue working through the key idea",
    status: "accepted",
    confirmationReason: null
  };
}

function emptyTeachingCard(): LearningSession["teachingCard"] {
  return { status: "idle", content: "", error: null, retryable: false };
}

function teachingCardRevision(instruction: string): TeachingCardRevision {
  return {
    id: crypto.randomUUID(),
    instruction,
    status: "idle",
    content: "",
    error: null,
    retryable: false,
    contextUsed: [],
    agentWorkLogReference: null
  };
}

function questionCardRevision(question: string, contextUsed: QuestionContextItem[]): QuestionCardRevision {
  return {
    id: crypto.randomUUID(),
    question,
    selectedContext: structuredClone(contextUsed),
    status: "idle",
    content: "",
    error: null,
    retryable: false,
    contextUsed: structuredClone(contextUsed),
    agentWorkLogReference: null
  };
}

function emptyAskBarContext(): AskBarContext {
  return { items: [], includedIds: [], customized: false };
}

function refreshAskBarContext(state: LearningApplicationState, session: LearningSession, reset = false): void {
  const items: QuestionContextItem[] = [];
  const activeAnchor = session.sourceAnchors.find(
    (anchor) => anchor.id === session.activeSourceAnchorId && sourceAnchorIsCurrent(state, anchor)
  ) ?? null;
  if (activeAnchor) {
    items.push({
      id: `source-anchor:${activeAnchor.id}`,
      kind: "sourceAnchor",
      typeLabel: "Source Anchor",
      identity: activeAnchor.selection.kind === "diagramRegion" ? "Selected diagram region" : activeAnchor.selection.exactText,
      location: sourceAnchorLocation(activeAnchor),
      preview: sourceAnchorMathematics(activeAnchor),
      sourceId: activeAnchor.sourceId,
      sourceAnchorId: activeAnchor.id
    });
  }
  items.push({
    id: "learning-goal",
    kind: "learningGoal",
    typeLabel: "Goal",
    identity: session.learningGoal,
    location: "Visible Learning Goal",
    preview: session.learningGoal,
    sourceId: null,
    sourceAnchorId: null
  }, {
    id: "session-target",
    kind: "sessionContext",
    typeLabel: "Session context",
    identity: session.sessionTarget,
    location: "Visible Session Target",
    preview: session.sessionTarget,
    sourceId: null,
    sourceAnchorId: null
  });
  const continuation = continuationOutcomeContext(state, session);
  if (continuation) {
    const { historical, outcome } = continuation;
    items.push({
      id: "continuation-outcome",
      kind: "sessionContext",
      typeLabel: "Prior Consolidated Session Outcome",
      identity: historical.learningGoal,
      location: "Linked prior Learning Session",
      preview: [outcome.centralInsight, outcome.learningProgress, ...outcome.unresolvedQuestions, outcome.nextStep]
        .filter(Boolean).join("\n"),
      sourceId: null,
      sourceAnchorId: null
    });
    const returnPoint = historical.prerequisiteBranch?.returnPoint;
    if (returnPoint) {
      items.push({
        id: "continuation-return-point",
        kind: "sessionContext",
        typeLabel: "Return Point",
        identity: returnPoint.label,
        location: "Linked prior Learning Session",
        preview: returnPoint.label,
        sourceId: returnPoint.sourceId,
        sourceAnchorId: null
      });
    }
    for (const item of outcome.trailItems.filter((trailItem) => trailItem.kind === "evidence")) {
      items.push({
        id: `continuation-evidence:${item.id}`,
        kind: "sessionContext",
        typeLabel: "Trail Evidence",
        identity: item.content,
        location: "Prior Consolidated Session Outcome",
        preview: item.content,
        sourceId: null,
        sourceAnchorId: null
      });
    }
    for (const artifactId of outcome.includedArtifactIds) {
      const artifact = historical.learningArtifacts.find((candidate) => candidate.id === artifactId);
      if (!artifact) continue;
      items.push({
        id: `continuation-artifact:${artifact.id}`,
        kind: "sessionContext",
        typeLabel: "Learning Artifact",
        identity: artifact.title,
        location: "Prior Consolidated Session Outcome",
        preview: artifact.currentRevision.content,
        sourceId: null,
        sourceAnchorId: null
      });
    }
  }
  const workspace = state.workspaces.find((candidate) => candidate.id === session.workspaceId);
  const availableSourceIds = session.accessPolicy === "focused"
    ? session.sourceIds
    : session.accessPolicy === "workspace"
      ? [...session.sourceIds, ...(workspace?.context.sourceIds ?? [])]
      : state.sources.map((source) => source.id);
  for (const sourceId of new Set(availableSourceIds)) {
    const source = state.sources.find((candidate) => candidate.id === sourceId);
    if (!source) continue;
    items.push({
      id: `source:${source.id}`,
      kind: "source",
      typeLabel: "Source",
      identity: source.name,
      location: source.kind === "managedAsset"
        ? "Managed Asset in this Learning Session"
        : `${source.role === "primaryFolder" ? "Primary Folder" : "External Attachment"} in this Study Workspace`,
      preview: source.kind === "managedAsset" ? managedAssetLearnerContent(source).slice(0, 120) : source.name,
      sourceId: source.id,
      sourceAnchorId: null
    });
  }
  const availableIds = new Set(items.map((item) => item.id));
  const shouldUseDefaults = reset || !session.askBarContext.customized;
  const includedIds = shouldUseDefaults
    ? activeAnchor
      ? [`source-anchor:${activeAnchor.id}`, "learning-goal"]
      : continuation ? ["learning-goal", "continuation-outcome"] : ["learning-goal", "session-target"]
    : session.askBarContext.includedIds.filter((id) => availableIds.has(id));
  session.askBarContext = {
    items,
    includedIds,
    customized: shouldUseDefaults ? false : session.askBarContext.customized
  };
}

function sourceAnchorIsCurrent(state: LearningApplicationState, anchor: SourceAnchor): boolean {
  const source = state.sources.find((candidate) => candidate.id === anchor.sourceId);
  if (!source) return false;
  return source.kind !== "linkedSource" || anchor.sourceRevisionId === source.link.currentRevisionId;
}

function continuationOutcomeContext(state: LearningApplicationState, session: LearningSession): {
  historical: LearningSession;
  outcome: ConsolidatedSessionOutcome;
} | null {
  if (!session.continuationOf) return null;
  const historical = state.sessions.find((candidate) => candidate.id === session.continuationOf?.sessionId);
  const outcome = historical?.consolidatedOutcome;
  return historical && outcome?.id === session.continuationOf.outcomeId ? { historical, outcome } : null;
}

function selectedAskBarContext(session: LearningSession): QuestionContextItem[] {
  const included = new Set(session.askBarContext.includedIds);
  return session.askBarContext.items.filter((item) => included.has(item.id));
}

function accessPolicyReceipt(policy: SessionAccessPolicy): QuestionContextItem {
  const label = sessionAccessPolicyLabel(policy);
  return {
    id: `access-policy:${policy}`,
    kind: "sessionContext",
    typeLabel: "Session Access Policy",
    identity: label,
    location: "Operational boundary applied to this Question Card",
    preview: label,
    sourceId: null,
    sourceAnchorId: null
  };
}

function questionRevisionReceipt(previous: { previousQuestion: string; previousContent: string }): QuestionContextItem[] {
  return [{
    id: "previous-question",
    kind: "sessionContext",
    typeLabel: "Previous Question Card question",
    identity: previous.previousQuestion,
    location: "Earlier structured Question Card revision",
    preview: previous.previousQuestion,
    sourceId: null,
    sourceAnchorId: null
  }, {
    id: "previous-answer",
    kind: "sessionContext",
    typeLabel: "Previous Question Card answer",
    identity: "Earlier answer",
    location: "Earlier structured Question Card revision",
    preview: previous.previousContent,
    sourceId: null,
    sourceAnchorId: null
  }];
}

function sourceAnchorTeachingTitle(selection: SourceAnchorSelection, action: "Explain" | "Question about" | "Tutor Feedback for"): string {
  if (selection.kind === "diagramRegion") return `${action} selected diagram region`;
  const excerpt = selection.exactText.trim().replace(/\s+/g, " ");
  return `${action} ${excerpt.length > 60 ? `${excerpt.slice(0, 57)}…` : excerpt}`;
}

function sourceAnchorMathematics(anchor: SourceAnchor): string {
  if (anchor.selection.kind === "diagramRegion") {
    const { x, y, width, height } = anchor.selection.bounds;
    return `Selected diagram region at normalized bounds x=${x}, y=${y}, width=${width}, height=${height}.`;
  }
  return anchor.selection.exactText;
}

function sourceAnchorLocation(anchor: SourceAnchor): string {
  if (anchor.selection.kind === "diagramRegion") {
    const { x, y, width, height } = anchor.selection.bounds;
    return `Diagram region at ${Math.round(x * 100)}% left, ${Math.round(y * 100)}% top, ${Math.round(width * 100)}% wide, ${Math.round(height * 100)}% high`;
  }
  return `${anchor.selection.kind === "equation" ? "Equation" : "Text"} at characters ${anchor.selection.startOffset}–${anchor.selection.endOffset}`;
}

function emptyTrailDraft(): TrailDraft {
  return { items: [] };
}

type NewLearningSession = Pick<LearningSession,
  | "id" | "workspaceId" | "missionId" | "mathematics" | "sourceIds" | "learningGoal" | "sessionTarget"
  | "status" | "activityOrder" | "returnContext" | "proposal" | "accessPolicy"
> & Partial<Pick<LearningSession,
  | "currentTeachingInput" | "sourceAnchors" | "activeSourceAnchorId" | "learningSlice" | "prerequisiteBranch"
  | "continuationOf"
>>;

function createLearningSession(details: NewLearningSession): LearningSession {
  return {
    ...details,
    teachingCard: emptyTeachingCard(),
    teachingCardHistory: [],
    submittedPendingQuestions: [],
    currentTeachingInput: details.currentTeachingInput ?? { kind: "sessionIntake", text: details.mathematics },
    pendingQuestion: null,
    askBarContext: emptyAskBarContext(),
    questionCards: [],
    activeQuestionCardId: null,
    accessRequests: [],
    pendingFullAccessConfirmation: false,
    sourceAnchors: details.sourceAnchors ?? [],
    sourceAnchorRequests: [],
    annotations: [],
    activeSourceAnchorId: details.activeSourceAnchorId ?? null,
    anchoredTeachingCards: [],
    activeTeachingCardId: null,
    learningArtifacts: [],
    trailDraft: emptyTrailDraft(),
    ...emptySessionLifecycle(),
    continuationOf: details.continuationOf ?? null,
    learningSlice: details.learningSlice ?? null,
    conceptPeeks: [],
    pendingConceptPeek: null,
    prerequisiteBranchProposals: [],
    prerequisiteBranch: details.prerequisiteBranch ?? null,
    agentTasks: [],
    activeAgentTaskId: null,
    reasoningPreference: "balanced",
    runtimeOverride: null
  };
}

function createSpecialistReviewTask(
  session: LearningSession,
  budget: AgentBudget,
  coordination: AgentTaskCoordination
): AgentTask {
  const target = specialistReviewTarget(session);
  if (!target) throw new Error("Complete a Teaching Card before requesting a Specialist Agent review.");
  const brief: AgentBrief = {
    learningGoal: session.learningGoal,
    sourceAnchors: target.sourceAnchor ? [{
      sourceAnchorId: target.sourceAnchor.id,
      sourceId: target.sourceAnchor.sourceId,
      selection: structuredClone(target.sourceAnchor.selection)
    }] : [],
    constraints: [
      "Review only the current learner-facing Teaching Card.",
      "Do not inspect other Learning Session history or local files.",
      `Current Teaching Card: ${target.content}`
    ],
    learnerEvidence: session.trailDraft.items
      .filter((item) => item.origin === "learner" && item.kind === "evidence"
        && (target.sourceAnchor && item.links.sourceAnchorIds.includes(target.sourceAnchor.id)
          || target.teachingCardId && item.links.teachingCardIds.includes(target.teachingCardId)
          || !target.sourceAnchor && !target.teachingCardId && isSessionLevelTrailItem(item)))
      .map((item) => item.content),
    expectedOutput: "One concise correction or confirmation integrated as a Teaching Card.",
    verificationNeeds: [
      "Identify any hidden mathematical assumption and explain whether the argument depends on it."
    ]
  };
  const specialistBriefs = coordination === "single" ? [brief] : [brief, {
    ...structuredClone(brief),
    constraints: [...brief.constraints, coordination === "dependent"
      ? "Stress-test the earlier Specialist Agent conclusion supplied when this work becomes eligible."
      : "Independently search for a counterexample without relying on another Specialist Agent result."],
    expectedOutput: "One concise stress test integrated into the same learner-facing Teaching Card.",
    verificationNeeds: ["Search for a counterexample or boundary case that changes the conclusion."]
  }];
  return {
    id: crypto.randomUUID(),
    purpose: "Review the current Teaching Card for a hidden mathematical assumption",
    status: "working",
    statusMessage: null,
    identifiedNeed: {
      kind: "hiddenAssumptionReview",
      requestedBy: "learner",
      description: "The learner requested a focused check for a hidden mathematical assumption in the current Teaching Card."
    },
    brief,
    specialistBriefs,
    coordination,
    budget,
    integratedTeachingCard: {
      title: "Specialist review",
      status: "streaming",
      content: "",
      error: null,
      retryable: false
    },
    agentWorkLogReference: null,
    priorAgentWorkLogReferences: []
  };
}

function specialistReviewTarget(session: LearningSession): {
  content: string;
  sourceAnchor: SourceAnchor | null;
  teachingCardId: string | null;
} | null {
  const anchoredCard = session.anchoredTeachingCards.find((card) => card.id === session.activeTeachingCardId);
  if (anchoredCard?.currentRevision.status === "completed" && anchoredCard.currentRevision.content.trim()) {
    return {
      content: anchoredCard.currentRevision.content,
      sourceAnchor: session.sourceAnchors.find((anchor) => anchor.id === anchoredCard.sourceAnchorId) ?? null,
      teachingCardId: anchoredCard.id
    };
  }
  if (session.teachingCard.status !== "completed" || !session.teachingCard.content.trim()) return null;
  return { content: session.teachingCard.content, sourceAnchor: null, teachingCardId: null };
}

function isSessionLevelTrailItem(item: TrailItem): boolean {
  return item.links.sourceAnchorIds.length === 0 && item.links.teachingCardIds.length === 0
    && item.links.learningArtifactIds.length === 0 && item.links.understandingEvidenceIds.length === 0;
}

function emptySessionLifecycle(): Pick<LearningSession,
  "consolidationDraft" | "consolidatedOutcome" | "continuationOf" | "modelStopConfirmation"
> {
  return { consolidationDraft: null, consolidatedOutcome: null, continuationOf: null, modelStopConfirmation: null };
}

function suggestedSessionConsolidation(session: LearningSession): SessionConsolidationDraft {
  const items = session.trailDraft.items;
  const centralInsight = items.find((item) => item.kind === "concept" || item.kind === "reasoningStep")?.content
    ?? session.learningGoal;
  return {
    centralInsight,
    learningProgress: items.filter((item) => item.kind === "evidence").map((item) => item.content).join("\n"),
    unresolvedQuestions: items.filter((item) => item.kind === "unresolvedQuestion").map((item) => item.content),
    nextStep: items.find((item) => item.kind === "nextStep")?.content ?? session.returnContext.nextAction,
    includedArtifactIds: session.learningArtifacts.map((artifact) => artifact.id),
    targetDisposition: null
  };
}

function emptyTrailItemLinks(): TrailItemLinks {
  return {
    sourceAnchorIds: [],
    teachingCardIds: [],
    learningArtifactIds: [],
    understandingEvidenceIds: []
  };
}

function activeTrailItemLinks(session: LearningSession): TrailItemLinks {
  const teachingCard = session.anchoredTeachingCards.find((card) => card.id === session.activeTeachingCardId) ?? null;
  return {
    sourceAnchorIds: session.activeSourceAnchorId ? [session.activeSourceAnchorId] : [],
    teachingCardIds: teachingCard ? [teachingCard.id] : [],
    learningArtifactIds: teachingCard?.artifactId ? [teachingCard.artifactId] : [],
    understandingEvidenceIds: []
  };
}

function upsertSuggestedTrailItem(
  session: LearningSession,
  curationKey: string,
  kind: TrailItemKind,
  content: string,
  links: TrailItemLinks
): void {
  const normalizedContent = content.trim();
  if (!normalizedContent) return;
  const existing = session.trailDraft.items.find((item) => item.curationKey === curationKey);
  if (existing?.required) return;
  if (existing) {
    Object.assign(existing, { kind, content: normalizedContent, links });
    return;
  }
  session.trailDraft.items.push({
    id: crypto.randomUUID(),
    kind,
    content: normalizedContent,
    required: false,
    origin: "teachingAgent",
    links,
    curationKey
  });
}

function removeSuggestedTrailItem(session: LearningSession, curationKey: string): void {
  const index = session.trailDraft.items.findIndex((item) => item.curationKey === curationKey);
  if (index >= 0 && !session.trailDraft.items[index].required) session.trailDraft.items.splice(index, 1);
}

function upsertUnresolvedQuestionTrailItem(
  session: LearningSession,
  card: QuestionCard,
  context: QuestionContextItem[]
): void {
  upsertSuggestedTrailItem(session, `question-card:${card.id}`, "unresolvedQuestion", card.question, {
    sourceAnchorIds: context.flatMap((item) => item.sourceAnchorId ? [item.sourceAnchorId] : []),
    teachingCardIds: [],
    learningArtifactIds: [],
    understandingEvidenceIds: []
  });
}

function requireTrailItem(session: LearningSession, trailItemId: string): TrailItem {
  const item = session.trailDraft.items.find((candidate) => candidate.id === trailItemId);
  if (!item) throw new Error("Choose a Trail Item in the active Learning Session.");
  return item;
}

function requireAnchoredTeachingCard(session: LearningSession, cardId: string): AnchoredTeachingCard {
  const card = session.anchoredTeachingCards.find((candidate) => candidate.id === cardId);
  if (!card) throw new Error("Choose an anchored Teaching Card in the active Learning Session.");
  return card;
}

function requireSourceAnchor(session: LearningSession, sourceAnchorId: string): SourceAnchor {
  const anchor = session.sourceAnchors.find((candidate) => candidate.id === sourceAnchorId);
  if (!anchor) throw new Error("Choose a Source Anchor in the active Learning Session.");
  return anchor;
}

function requireLearningArtifact(session: LearningSession, artifactId: string): LearningArtifact {
  const artifact = session.learningArtifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact) throw new Error("Choose a Learning Artifact in the active Learning Session.");
  return artifact;
}

function interruptedTeachingCard(content: string): LearningSession["teachingCard"] {
  return {
    status: "stopped",
    content,
    error: "Teaching stopped. You can retry without losing this Learning Session.",
    retryable: true
  };
}

function interruptCardRevision(revision: TeachingCardState): void {
  if (revision.status !== "streaming") return;
  Object.assign(revision, interruptedTeachingCard(revision.content));
}

function replaceTeachingCard(session: LearningSession, teachingCard: TeachingCardState): void {
  session.teachingCard = teachingCard;
  if (session.currentTeachingInput.kind !== "pendingQuestion") return;
  const submissionId = session.currentTeachingInput.submissionId;
  const submission = session.submittedPendingQuestions.find(
    (candidate) => candidate.id === submissionId
  );
  if (submission) submission.teachingCard = teachingCard;
}

function emptyWorkspaceContext(): WorkspaceContext {
  return { sourceIds: [], learnerContextIds: [], primaryFolderSourceId: null };
}

function linkedSource(
  workspaceId: string,
  role: LinkedSource["role"],
  selection: SelectedLocalSource
): LinkedSource {
  const revisionId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    kind: "linkedSource",
    role,
    workspaceId,
    name: selection.name,
    resourceType: selection.resourceType,
    link: {
      lastKnownPath: selection.lastKnownPath,
      canonicalPath: selection.canonicalPath,
      accessGrant: selection.accessGrant,
      fingerprint: selection.fingerprint,
      accessStatus: "available",
      error: null,
      currentRevisionId: revisionId
    }
  };
}

function sourceRevision(source: LinkedSource): SourceRevision {
  return {
    id: source.link.currentRevisionId,
    sourceId: source.id,
    fingerprint: structuredClone(source.link.fingerprint),
    snapshotAssetId: null
  };
}

function migrateWorkspaceSources(value: unknown): WorkspaceSource[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored sources are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.workspaceId !== "string"
      || typeof candidate.name !== "string" || !candidate.name.trim()) {
      throw new Error("Stored source is invalid.");
    }
    if (candidate.kind === "managedAsset") {
      if (!validManagedAssetMediaType(candidate.mediaType) || typeof candidate.content !== "string"
        || !(candidate.sourceSnapshot === undefined || (isRecord(candidate.sourceSnapshot)
          && typeof candidate.sourceSnapshot.linkedSourceId === "string"
          && typeof candidate.sourceSnapshot.sourceRevisionId === "string"
          && candidate.sourceSnapshot.encoding === "base64"
          && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(candidate.content)))) {
        throw new Error("Stored Managed Asset is invalid.");
      }
      return candidate as unknown as ManagedAsset;
    }
    if (candidate.kind !== "linkedSource" || !["primaryFolder", "externalAttachment"].includes(String(candidate.role))
      || !["file", "folder"].includes(String(candidate.resourceType)) || !isRecord(candidate.link)
      || typeof candidate.link.lastKnownPath !== "string" || !isAbsolute(candidate.link.lastKnownPath)
      || !(candidate.link.canonicalPath === undefined
        || (typeof candidate.link.canonicalPath === "string" && isAbsolute(candidate.link.canonicalPath)))
      || !validAccessGrant(candidate.link.accessGrant) || !validFingerprint(candidate.link.fingerprint)
      || !["available", "unavailable"].includes(String(candidate.link.accessStatus))
      || !(candidate.link.error === null || typeof candidate.link.error === "string")) {
      throw new Error("Stored Linked Source is invalid.");
    }
    const source = candidate as unknown as LinkedSource;
    source.link.canonicalPath = typeof candidate.link.canonicalPath === "string"
      ? candidate.link.canonicalPath
      : candidate.link.lastKnownPath as string;
    source.link.currentRevisionId = typeof candidate.link.currentRevisionId === "string"
      ? candidate.link.currentRevisionId
      : crypto.randomUUID();
    return source;
  });
}

function migrateSourceRevisions(value: unknown, sources: WorkspaceSource[]): SourceRevision[] {
  const linkedSources = sources.filter((source): source is LinkedSource => source.kind === "linkedSource");
  if (value === undefined) return linkedSources.map(sourceRevision);
  if (!Array.isArray(value)) throw new Error("Stored Source Revisions are invalid.");
  const revisions = value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.sourceId !== "string"
      || !validFingerprint(candidate.fingerprint)
      || !(candidate.snapshotAssetId === null || typeof candidate.snapshotAssetId === "string")) {
      throw new Error("Stored Source Revision is invalid.");
    }
    return candidate as unknown as SourceRevision;
  });
  for (const source of linkedSources) {
    if (!revisions.some((revision) => revision.id === source.link.currentRevisionId && revision.sourceId === source.id)) {
      revisions.push(sourceRevision(source));
    }
  }
  return revisions;
}

function migrateSourceIndexSummaries(value: unknown): SourceIndexSummary[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored Source Index status is invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.sourceId !== "string"
      || !["ready", "cleared", "unavailable"].includes(String(candidate.status))
      || !(candidate.extractionMethod === null || ["embeddedText", "pdfText", "ocr"].includes(String(candidate.extractionMethod)))
      || !Number.isInteger(candidate.pageCount) || (candidate.pageCount as number) < 0
      || !Number.isInteger(candidate.equationCount) || (candidate.equationCount as number) < 0
      || !(candidate.error === null || typeof candidate.error === "string")) {
      throw new Error("Stored Source Index status is invalid.");
    }
    return candidate as unknown as SourceIndexSummary;
  });
}

function validatedSourceIndexDocuments(value: unknown): SourceIndexDocument[] {
  if (!Array.isArray(value)) throw new Error("Stored Source Index cache is invalid.");
  const documents = value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.sourceId !== "string" || typeof candidate.sourceName !== "string"
      || typeof candidate.workspaceId !== "string" || !validFingerprint(candidate.fingerprint)) {
      throw new Error("Stored Source Index cache is invalid.");
    }
    if (!["embeddedText", "pdfText", "ocr"].includes(String(candidate.extractionMethod))
      || !Array.isArray(candidate.pages) || candidate.pages.length === 0 || candidate.pages.length > 10_000) {
      throw new Error("Stored Source Index cache is invalid.");
    }
    const pages = validatedCachedSourceIndexPages(candidate.pages);
    return {
      sourceId: candidate.sourceId,
      sourceName: candidate.sourceName,
      workspaceId: candidate.workspaceId,
      fingerprint: candidate.fingerprint,
      extractionMethod: candidate.extractionMethod as SourceIndexExtraction["extractionMethod"],
      pages
    };
  });
  if (new Set(documents.map((document) => document.sourceId)).size !== documents.length) {
    throw new Error("Stored Source Index cache is invalid.");
  }
  return documents;
}

function validatedCachedSourceIndexPages(value: unknown[]): CachedSourceIndexPage[] {
  const pageNumbers = new Set<number>();
  return value.map((candidate) => {
    if (!isRecord(candidate) || !Number.isInteger(candidate.pageNumber) || (candidate.pageNumber as number) < 1
      || typeof candidate.width !== "number" || !Number.isFinite(candidate.width) || candidate.width <= 0
      || typeof candidate.height !== "number" || !Number.isFinite(candidate.height) || candidate.height <= 0
      || typeof candidate.thumbnailDataUrl !== "string"
      || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(candidate.thumbnailDataUrl)
      || candidate.thumbnailDataUrl.length > 750_000 || !Array.isArray(candidate.regions)) {
      throw new Error("Stored Source Index cache is invalid.");
    }
    const pageNumber = candidate.pageNumber as number;
    if (pageNumbers.has(pageNumber)) throw new Error("Stored Source Index cache is invalid.");
    pageNumbers.add(pageNumber);
    const regions = candidate.regions.map((region) => {
      if (!isRecord(region) || (region.kind !== "text" && region.kind !== "equation")
        || !validSourceIndexBounds(region.bounds) || !Array.isArray(region.termHashes)
        || region.termHashes.some((hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) {
        throw new Error("Stored Source Index cache is invalid.");
      }
      const hasStart = region.sourceStartOffset !== undefined;
      const hasEnd = region.sourceEndOffset !== undefined;
      if (hasStart !== hasEnd || (hasStart && (!Number.isInteger(region.sourceStartOffset)
        || !Number.isInteger(region.sourceEndOffset) || (region.sourceStartOffset as number) < 0
        || (region.sourceEndOffset as number) <= (region.sourceStartOffset as number)))) {
        throw new Error("Stored Source Index cache is invalid.");
      }
      return {
        kind: region.kind as SourceIndexRegion["kind"],
        bounds: region.bounds as unknown as SourceIndexBounds,
        termHashes: [...new Set(region.termHashes as string[])],
        ...(hasStart ? {
          sourceStartOffset: region.sourceStartOffset as number,
          sourceEndOffset: region.sourceEndOffset as number
        } : {})
      };
    });
    return {
      pageNumber,
      width: candidate.width as number,
      height: candidate.height as number,
      thumbnailDataUrl: candidate.thumbnailDataUrl as string,
      regions
    };
  });
}

function validatedSourceIndexExtraction(value: unknown): SourceIndexExtraction {
  if (!isRecord(value) || !["embeddedText", "pdfText", "ocr"].includes(String(value.extractionMethod))
    || !Array.isArray(value.pages) || value.pages.length === 0 || value.pages.length > 10_000) {
    throw new Error("Extracted Source Index content is invalid.");
  }
  const pageNumbers = new Set<number>();
  const pages = value.pages.map((candidate) => {
    if (!isRecord(candidate) || !Number.isInteger(candidate.pageNumber) || (candidate.pageNumber as number) < 1
      || typeof candidate.width !== "number" || !Number.isFinite(candidate.width) || candidate.width <= 0
      || typeof candidate.height !== "number" || !Number.isFinite(candidate.height) || candidate.height <= 0
      || typeof candidate.thumbnailDataUrl !== "string"
      || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(candidate.thumbnailDataUrl)
      || candidate.thumbnailDataUrl.length > 750_000 || !Array.isArray(candidate.regions)) {
      throw new Error("Extracted Source Index page is invalid.");
    }
    const pageNumber = candidate.pageNumber as number;
    if (pageNumbers.has(pageNumber)) throw new Error("Extracted Source Index page is invalid.");
    pageNumbers.add(pageNumber);
    const regions = candidate.regions.map((region) => validatedSourceIndexRegion(region));
    return {
      pageNumber,
      width: candidate.width as number,
      height: candidate.height as number,
      thumbnailDataUrl: candidate.thumbnailDataUrl as string,
      regions
    };
  });
  return {
    extractionMethod: value.extractionMethod as SourceIndexExtraction["extractionMethod"],
    pages
  };
}

function validatedSourceIndexExtractionResult(value: unknown): SourceIndexExtractionResult {
  const extraction = validatedSourceIndexExtraction(value);
  if (!isRecord(value) || !validFingerprint(value.fingerprint)
    || !(value.linkRefresh === undefined || validSourceLinkRefresh(value.linkRefresh))) {
    throw new Error("Extracted Source Index identity is invalid.");
  }
  return {
    ...extraction,
    fingerprint: value.fingerprint,
    ...(value.linkRefresh === undefined ? {} : { linkRefresh: value.linkRefresh })
  };
}

function validatedSourceIndexRegion(value: unknown): SourceIndexRegion {
  if (!isRecord(value) || (value.kind !== "text" && value.kind !== "equation")
    || typeof value.text !== "string" || !value.text.trim() || value.text.length > 60_000
    || !validSourceIndexBounds(value.bounds)) {
    throw new Error("Extracted Source Index region is invalid.");
  }
  const hasStart = value.sourceStartOffset !== undefined;
  const hasEnd = value.sourceEndOffset !== undefined;
  if (hasStart !== hasEnd || (hasStart && (!Number.isInteger(value.sourceStartOffset)
    || !Number.isInteger(value.sourceEndOffset) || (value.sourceStartOffset as number) < 0
    || (value.sourceEndOffset as number) <= (value.sourceStartOffset as number)))) {
    throw new Error("Extracted Source Index region is invalid.");
  }
  return {
    kind: value.kind,
    text: value.text,
    bounds: value.bounds as unknown as SourceIndexBounds,
    ...(hasStart ? {
      sourceStartOffset: value.sourceStartOffset as number,
      sourceEndOffset: value.sourceEndOffset as number
    } : {})
  };
}

function validSourceIndexBounds(value: unknown): value is SourceIndexBounds {
  if (!isRecord(value)) return false;
  const coordinates = [value.x, value.y, value.width, value.height];
  return coordinates.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    && (value.x as number) >= 0 && (value.y as number) >= 0
    && (value.width as number) > 0 && (value.height as number) > 0
    && (value.x as number) + (value.width as number) <= 1
    && (value.y as number) + (value.height as number) <= 1;
}

function searchTerms(query: string): string[] {
  return query.toLocaleLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
}

function sourceIndexTermHash(term: string): string {
  return createHash("sha256").update(term).digest("hex");
}

function searchPreview(text: string, terms: string[]): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) return normalized;
  const firstMatch = Math.max(0, ...terms.map((term) => normalized.toLocaleLowerCase().indexOf(term)));
  const start = Math.max(0, firstMatch - 60);
  const end = Math.min(normalized.length, start + 180);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

function sameIndexMatch(region: SourceIndexRegion, match: SourceSearchResult["match"]): boolean {
  return region.kind === match.kind && region.bounds.x === match.bounds.x && region.bounds.y === match.bounds.y
    && region.bounds.width === match.bounds.width && region.bounds.height === match.bounds.height
    && region.sourceStartOffset === match.sourceStartOffset && region.sourceEndOffset === match.sourceEndOffset;
}

function migrateSourceAnchors(
  value: unknown,
  sources: WorkspaceSource[],
  revisions: SourceRevision[]
): SourceAnchor[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored Source Anchors are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.sourceId !== "string"
    ) {
      throw new Error("Stored Source Anchor is invalid.");
    }
    return {
      id: candidate.id,
      sourceId: candidate.sourceId,
      sourceRevisionId: migratedSourceAnchorRevisionId(candidate, sources, revisions),
      selection: validatedSourceAnchorSelection(candidate.selection)
    };
  });
}

function migratedSourceAnchorRevisionId(
  candidate: Record<string, unknown>,
  sources: WorkspaceSource[],
  revisions: SourceRevision[]
): string | null {
  if (typeof candidate.sourceRevisionId === "string") return candidate.sourceRevisionId;
  const source = sources.find(
    (item): item is LinkedSource => item.id === candidate.sourceId && item.kind === "linkedSource"
  );
  if (!source) return null;
  return revisions.filter((revision) => revision.sourceId === source.id).length === 1
    ? source.link.currentRevisionId
    : null;
}

function addLegacyUnresolvedReanchoringDecisions(state: LearningApplicationState): void {
  for (const session of state.sessions) {
    for (const anchor of session.sourceAnchors) {
      if (anchor.sourceRevisionId !== null || state.reanchoringDecisions.some(
        (decision) => decision.sourceAnchorId === anchor.id
      )) continue;
      const source = state.sources.find(
        (candidate): candidate is LinkedSource => candidate.id === anchor.sourceId && candidate.kind === "linkedSource"
      );
      if (!source) continue;
      state.reanchoringDecisions.push({
        id: crypto.randomUUID(),
        sessionId: session.id,
        sourceId: source.id,
        sourceAnchorId: anchor.id,
        fromRevisionId: null,
        toRevisionId: source.link.currentRevisionId,
        oldSelection: structuredClone(anchor.selection),
        proposedSelection: null,
        status: "unresolved"
      });
    }
  }
}

function migrateReanchoringDecisions(value: unknown): ReanchoringDecision[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored Re-anchoring decisions are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.sessionId !== "string"
      || typeof candidate.sourceId !== "string" || typeof candidate.sourceAnchorId !== "string"
      || !(candidate.fromRevisionId === null || typeof candidate.fromRevisionId === "string")
      || typeof candidate.toRevisionId !== "string"
      || !["automatic", "learnerConfirmed", "unresolved", "leftUnresolved"].includes(String(candidate.status))) {
      throw new Error("Stored Re-anchoring decision is invalid.");
    }
    return {
      id: candidate.id,
      sessionId: candidate.sessionId,
      sourceId: candidate.sourceId,
      sourceAnchorId: candidate.sourceAnchorId,
      fromRevisionId: candidate.fromRevisionId,
      toRevisionId: candidate.toRevisionId,
      oldSelection: validatedSourceAnchorSelection(candidate.oldSelection),
      proposedSelection: candidate.proposedSelection === null
        ? null
        : validatedSourceAnchorSelection(candidate.proposedSelection),
      status: candidate.status as ReanchoringDecision["status"]
    };
  });
}

function migrateAnchoredTeachingCards(value: unknown): AnchoredTeachingCard[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored anchored Teaching Cards are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.sourceAnchorId !== "string"
      || typeof candidate.title !== "string" || !candidate.title.trim()
      || !validTeachingCardRevision(candidate.currentRevision)
      || !Array.isArray(candidate.revisions) || !candidate.revisions.every(validTeachingCardRevision)
      || !Array.isArray(candidate.variants) || !candidate.variants.every(validTeachingVariant)
      || !(candidate.artifactId === null || typeof candidate.artifactId === "string")) {
      throw new Error("Stored anchored Teaching Cards are invalid.");
    }
    return candidate as unknown as AnchoredTeachingCard;
  });
}

function migrateLearningArtifacts(value: unknown, sessionId: string): LearningArtifact[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored Learning Artifacts are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.title !== "string"
      || !Array.isArray(candidate.revisions)
      || candidate.pinned !== true
      || !Array.isArray(candidate.sourceAnchorIds)
      || !candidate.sourceAnchorIds.every((sourceAnchorId) => typeof sourceAnchorId === "string")) {
      throw new Error("Stored Learning Artifacts are invalid.");
    }
    const currentRevision = migrateLearningArtifactRevision(candidate.currentRevision, "promoted");
    const revisions = candidate.revisions.map((revision) => migrateLearningArtifactRevision(revision, "edited"));
    if (candidate.kind !== undefined && candidate.kind !== "learningArtifact" && candidate.kind !== "reformulatedProof") {
      throw new Error("Stored Learning Artifact kind is invalid.");
    }
    const kind = candidate.kind ?? "learningArtifact";
    if (candidate.originatingSessionId !== undefined && candidate.originatingSessionId !== sessionId) {
      throw new Error("Stored Learning Artifact origin is invalid.");
    }
    const originatingSessionId = sessionId;
    return { ...candidate, kind, originatingSessionId, currentRevision, revisions } as LearningArtifact;
  });
}

function migrateLearningArtifactRevision(
  value: unknown,
  fallbackAction: LearningArtifactRevision["provenance"]["action"]
): LearningArtifactRevision {
  if (!isRecord(value)) throw new Error("Stored Learning Artifact revision is invalid.");
  let provenance: LearningArtifactRevision["provenance"];
  if (value.provenance === undefined) {
    provenance = { action: fallbackAction, createdAt: null, priorRevisionId: null };
  } else if (validLearningArtifactRevisionProvenance(value.provenance)) {
    provenance = value.provenance;
  } else {
    throw new Error("Stored Learning Artifact revision is invalid.");
  }
  const migrated = {
    ...value,
    personalNoteContributions: migratePersonalNoteContributions(value.personalNoteContributions),
    provenance
  };
  if (!validLearningArtifactRevision(migrated)) throw new Error("Stored Learning Artifact revision is invalid.");
  return migrated as unknown as LearningArtifactRevision;
}

function migratePersonalNoteContributions(value: unknown): PersonalNoteContribution[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(validPersonalNoteContribution)) {
    throw new Error("Stored Personal Note contribution is invalid.");
  }
  return value as PersonalNoteContribution[];
}

function migrateTrailDraft(value: unknown): TrailDraft {
  if (value === undefined) return emptyTrailDraft();
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("Stored Trail Draft is invalid.");
  return {
    items: value.items.map((candidate) => {
      if (!isRecord(candidate) || typeof candidate.id !== "string" || !isTrailItemKind(candidate.kind)
        || typeof candidate.content !== "string" || !candidate.content.trim() || typeof candidate.required !== "boolean"
        || !["learner", "teachingAgent"].includes(String(candidate.origin))
        || !(candidate.curationKey === null || typeof candidate.curationKey === "string")
        || !validTrailItemLinks(candidate.links)) {
        throw new Error("Stored Trail Item is invalid.");
      }
      return candidate as unknown as TrailItem;
    })
  };
}

function migrateSessionConsolidationDraft(value: unknown): SessionConsolidationDraft | null {
  if (value === undefined || value === null) return null;
  if (!validSessionConsolidation(value, true)) throw new Error("Stored Session Consolidation review is invalid.");
  return value as unknown as SessionConsolidationDraft;
}

function migrateConsolidatedSessionOutcome(value: unknown): ConsolidatedSessionOutcome | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.id !== "string" || !validSessionConsolidation(value, false)
    || !Array.isArray(value.trailItems)) {
    throw new Error("Stored Consolidated Session Outcome is invalid.");
  }
  const trailItems = migrateTrailDraft({ items: value.trailItems }).items;
  return { ...(value as unknown as ConsolidatedSessionOutcome), trailItems };
}

function validSessionConsolidation(value: unknown, allowsMissingDisposition: boolean): boolean {
  if (!isRecord(value) || typeof value.centralInsight !== "string" || !value.centralInsight.trim()
    || typeof value.learningProgress !== "string" || typeof value.nextStep !== "string" || !value.nextStep.trim()
    || !Array.isArray(value.unresolvedQuestions)
    || value.unresolvedQuestions.some((question) => typeof question !== "string" || !question.trim())
    || !Array.isArray(value.includedArtifactIds)
    || value.includedArtifactIds.some((artifactId) => typeof artifactId !== "string")) return false;
  return (allowsMissingDisposition && value.targetDisposition === null)
    || value.targetDisposition === "addressed"
    || value.targetDisposition === "deferred"
    || value.targetDisposition === "unresolved";
}

function migrateContinuationLink(value: unknown): ContinuationLink | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.sessionId !== "string" || typeof value.outcomeId !== "string") {
    throw new Error("Stored Continuation Session link is invalid.");
  }
  return value as unknown as ContinuationLink;
}

function migrateModelStopConfirmation(value: unknown): ModelStopConfirmation | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.attemptId !== "string" || !value.attemptId
    || (value.status !== "pending" && value.status !== "unconfirmed")
    || typeof value.message !== "string" || !value.message.trim()) {
    throw new Error("Stored model interruption confirmation is invalid.");
  }
  return value.status === "pending" ? unconfirmedModelStop(value.attemptId) : value as unknown as ModelStopConfirmation;
}

function unconfirmedModelStop(attemptId: string): ModelStopConfirmation {
  return {
    attemptId,
    status: "unconfirmed",
    message: "Codex did not confirm interruption. Retry interruption or restart Codex before further model work."
  };
}

function validateSessionLifecycleReferences(state: LearningApplicationState): void {
  for (const session of state.sessions) {
    if (session.status !== "active" && session.status !== "paused" && session.status !== "consolidated") {
      throw new Error("Stored Learning Session status is invalid.");
    }
    if ((session.status === "consolidated") !== Boolean(session.consolidatedOutcome)) {
      throw new Error("Stored Consolidated Session Outcome does not match its Learning Session status.");
    }
    const outcome = session.consolidatedOutcome;
    if (outcome) {
      if (outcome.includedArtifactIds.some((artifactId) => !session.learningArtifacts.some((artifact) => artifact.id === artifactId))) {
        throw new Error("Stored Consolidated Session Outcome references an unknown Learning Artifact.");
      }
      const outcomeTrailItemIds = new Set(outcome.trailItems.map((item) => item.id));
      if (session.trailDraft.items.some((item) => item.required && !outcomeTrailItemIds.has(item.id))) {
        throw new Error("Stored Consolidated Session Outcome omits a Required Trail Item.");
      }
    }
    if (session.continuationOf) {
      const origin = state.sessions.find((candidate) => candidate.id === session.continuationOf?.sessionId);
      if (!origin?.consolidatedOutcome || origin.consolidatedOutcome.id !== session.continuationOf.outcomeId) {
        throw new Error("Stored Continuation Session link is invalid.");
      }
    }
  }
}

function validTrailItemLinks(value: unknown): value is TrailItemLinks {
  return isRecord(value) && [
    value.sourceAnchorIds,
    value.teachingCardIds,
    value.learningArtifactIds,
    value.understandingEvidenceIds
  ].every((identifiers) => Array.isArray(identifiers) && identifiers.every((identifier) => typeof identifier === "string"))
    && (value.understandingEvidenceIds as unknown[]).length === 0;
}

export function isTrailItemKind(value: unknown): value is TrailItemKind {
  return TRAIL_ITEM_KINDS.includes(value as TrailItemKind);
}

function validTeachingCardRevision(value: unknown): value is TeachingCardRevision {
  return isRecord(value) && typeof value.id === "string" && typeof value.instruction === "string"
    && ["idle", "streaming", "completed", "stopped", "failed"].includes(String(value.status))
    && typeof value.content === "string" && (value.error === null || typeof value.error === "string")
    && typeof value.retryable === "boolean" && Array.isArray(value.contextUsed)
    && value.contextUsed.every((context) => isRecord(context) && typeof context.sourceId === "string"
      && typeof context.sourceName === "string" && typeof context.location === "string")
    && (value.agentWorkLogReference === null || (isRecord(value.agentWorkLogReference)
      && typeof value.agentWorkLogReference.sessionId === "string"
      && Number.isInteger(value.agentWorkLogReference.fromSequence) && Number.isInteger(value.agentWorkLogReference.toSequence)));
}

function validLearningArtifactRevision(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.content === "string"
    && (value.claimOrigin === "modelGenerated" || value.claimOrigin === "learner" || value.claimOrigin === "mixed")
    && value.verificationLevel === "notIndependentlyChecked" && value.verificationCurrency === "current"
    && Array.isArray(value.personalNoteContributions) && value.personalNoteContributions.every(validPersonalNoteContribution)
    && validLearningArtifactRevisionProvenance(value.provenance);
}

function validPersonalNoteContribution(value: unknown): value is PersonalNoteContribution {
  return isRecord(value) && typeof value.annotationId === "string" && typeof value.sourceAnchorId === "string"
    && typeof value.verbatim === "string" && Boolean(value.verbatim.trim())
    && (value.interpretation === null || (typeof value.interpretation === "string" && Boolean(value.interpretation.trim())));
}

function validLearningArtifactRevisionProvenance(value: unknown): value is LearningArtifactRevision["provenance"] {
  return isRecord(value)
    && ["promoted", "edited", "restored", "synthesized"].includes(String(value.action))
    && (value.createdAt === null || (typeof value.createdAt === "string"
      && !Number.isNaN(Date.parse(value.createdAt)) && new Date(value.createdAt).toISOString() === value.createdAt))
    && (value.priorRevisionId === null || typeof value.priorRevisionId === "string");
}

function validTeachingVariant(value: unknown): value is TeachingVariant {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && Boolean(value.name.trim())
    && validTeachingCardRevision(value.revision);
}

function migrateSourceAnchorRequests(value: unknown): SourceAnchorRequest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored Source Anchor requests are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.sourceAnchorId !== "string"
      || !(isSourceAnchorPaletteAction(candidate.action) || candidate.action === "annotate")) {
      throw new Error("Stored Source Anchor request is invalid.");
    }
    return {
      id: candidate.id,
      sourceAnchorId: candidate.sourceAnchorId,
      action: candidate.action === "annotate" ? "addNote" : candidate.action
    };
  });
}

function migrateAnnotations(value: unknown): SourceAnnotation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored annotations are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.sourceAnchorId !== "string"
      || !isAnnotationPurpose(candidate.purpose) || typeof candidate.content !== "string" || !candidate.content.trim()) {
      throw new Error("Stored annotation is invalid.");
    }
    const purposeChanges = candidate.purposeChanges === undefined
      ? candidate.purposeChangedFrom === undefined || candidate.purposeChangedFrom === null
        ? []
        : isAnnotationPurpose(candidate.purposeChangedFrom) && candidate.purposeChangedFrom !== candidate.purpose
          ? [{ from: candidate.purposeChangedFrom, to: candidate.purpose }]
          : null
      : Array.isArray(candidate.purposeChanges) && candidate.purposeChanges.every((change) => isRecord(change)
        && isAnnotationPurpose(change.from) && isAnnotationPurpose(change.to) && change.from !== change.to)
        ? candidate.purposeChanges as Array<{ from: AnnotationPurpose; to: AnnotationPurpose }>
        : null;
    if (!purposeChanges || purposeChanges.some((change, index) => index > 0 && change.from !== purposeChanges[index - 1].to)
      || (purposeChanges.length > 0 && purposeChanges.at(-1)?.to !== candidate.purpose)) {
      throw new Error("Stored annotation is invalid.");
    }
    return {
      id: candidate.id,
      sourceAnchorId: candidate.sourceAnchorId,
      purpose: candidate.purpose,
      content: candidate.content,
      purposeChanges
    };
  });
}

function attachManagedSourcesToLegacySessions(state: LearningApplicationState): void {
  for (const session of state.sessions) {
    if (session.sourceIds.length > 0) continue;
    const source: ManagedAsset = {
      id: `migrated-source-${session.id}`,
      kind: "managedAsset",
      workspaceId: session.workspaceId,
      name: "Typed mathematics",
      mediaType: "text/plain",
      content: session.mathematics
    };
    state.sources.push(source);
    session.sourceIds.push(source.id);
    const workspace = state.workspaces.find((candidate) => candidate.id === session.workspaceId);
    if (workspace && !workspace.context.sourceIds.includes(source.id)) workspace.context.sourceIds.push(source.id);
  }
}

function validateSessionSourceAnchorReferences(state: LearningApplicationState, session: LearningSession): void {
  const anchorsById = new Map(session.sourceAnchors.map((anchor) => [anchor.id, anchor]));
  const cardsById = new Map(session.anchoredTeachingCards.map((card) => [card.id, card]));
  const artifactsById = new Map(session.learningArtifacts.map((artifact) => [artifact.id, artifact]));
  const sourceIds = new Set(session.sourceIds);
  const stateSources = new Map(state.sources.map((source) => [source.id, source]));
  const requestsAreValid = session.sourceAnchorRequests.every((request) => anchorsById.has(request.sourceAnchorId));
  const annotationsAreValid = session.annotations.every((annotation) => anchorsById.has(annotation.sourceAnchorId));
  const anchorsAreValid = session.sourceAnchors.every((anchor) => {
    const source = stateSources.get(anchor.sourceId);
    const revisionIsValid = source?.kind === "linkedSource"
      ? (typeof anchor.sourceRevisionId === "string" && state.sourceRevisions.some(
        (revision) => revision.id === anchor.sourceRevisionId && revision.sourceId === source.id
      )) || (anchor.sourceRevisionId === null && state.reanchoringDecisions.some(
        (decision) => decision.sourceAnchorId === anchor.id
          && (decision.status === "unresolved" || decision.status === "leftUnresolved")
      ))
      : anchor.sourceRevisionId === null;
    return sourceIds.has(anchor.sourceId) && source?.workspaceId === session.workspaceId && revisionIsValid;
  });
  const activeAnchorIsValid = session.activeSourceAnchorId === null || anchorsById.has(session.activeSourceAnchorId);
  const cardsAreValid = session.anchoredTeachingCards.every((card) => anchorsById.has(card.sourceAnchorId)
    && (card.artifactId === null || artifactsById.has(card.artifactId))
    && new Set(card.variants.map((variant) => variant.id)).size === card.variants.length
    && new Set([card.currentRevision.id, ...card.revisions.map((revision) => revision.id)]).size === card.revisions.length + 1);
  const artifactsAreValid = session.learningArtifacts.every((artifact) => artifact.sourceAnchorIds.length > 0
    && artifact.sourceAnchorIds.every((sourceAnchorId) => anchorsById.has(sourceAnchorId))
    && [artifact.currentRevision, ...artifact.revisions].every((revision) => revision.personalNoteContributions.every(
      (note) => anchorsById.has(note.sourceAnchorId)
        && session.annotations.some((annotation) => annotation.id === note.annotationId
          && annotation.sourceAnchorId === note.sourceAnchorId && annotation.content === note.verbatim)
    ))
    && new Set([artifact.currentRevision.id, ...artifact.revisions.map((revision) => revision.id)]).size === artifact.revisions.length + 1);
  const activeCardIsValid = session.activeTeachingCardId === null || cardsById.has(session.activeTeachingCardId);
  const trailItemIds = new Set(session.trailDraft.items.map((item) => item.id));
  const trailCurationKeys = session.trailDraft.items.flatMap((item) => item.curationKey ? [item.curationKey] : []);
  const trailItemsAreValid = trailItemIds.size === session.trailDraft.items.length
    && new Set(trailCurationKeys).size === trailCurationKeys.length
    && session.trailDraft.items.every((item) => item.links.sourceAnchorIds.every((id) => anchorsById.has(id))
      && item.links.teachingCardIds.every((id) => cardsById.has(id))
      && item.links.learningArtifactIds.every((id) => artifactsById.has(id)));
  const identifiersAreUnique = anchorsById.size === session.sourceAnchors.length
    && cardsById.size === session.anchoredTeachingCards.length
    && artifactsById.size === session.learningArtifacts.length
    && new Set(session.sourceAnchorRequests.map((request) => request.id)).size === session.sourceAnchorRequests.length
    && new Set(session.annotations.map((annotation) => annotation.id)).size === session.annotations.length;
  if (!requestsAreValid || !anchorsAreValid || !activeAnchorIsValid || !cardsAreValid || !artifactsAreValid || !trailItemsAreValid
    || !annotationsAreValid || !activeCardIsValid || !identifiersAreUnique) {
    throw new Error("Stored Source Anchor references are invalid.");
  }
}

function validateReanchoringDecisionReferences(state: LearningApplicationState): void {
  const valid = state.reanchoringDecisions.every((decision) => {
    const session = state.sessions.find((candidate) => candidate.id === decision.sessionId);
    const anchor = session?.sourceAnchors.find((candidate) => candidate.id === decision.sourceAnchorId);
    const source = state.sources.find((candidate) => candidate.id === decision.sourceId);
    const revisionsExist = (decision.fromRevisionId === null || state.sourceRevisions.some(
      (revision) => revision.id === decision.fromRevisionId && revision.sourceId === decision.sourceId
    )) && state.sourceRevisions.some(
      (revision) => revision.id === decision.toRevisionId && revision.sourceId === decision.sourceId
    );
    return Boolean(session && anchor && source?.kind === "linkedSource" && anchor.sourceId === source.id
      && revisionsExist && (!["unresolved", "leftUnresolved"].includes(decision.status)
        || anchor.sourceRevisionId === decision.fromRevisionId));
  });
  if (!valid || new Set(state.reanchoringDecisions.map((decision) => decision.id)).size !== state.reanchoringDecisions.length) {
    throw new Error("Stored Re-anchoring decision references are invalid.");
  }
}

function validatedSourceAnchorSelection(value: unknown, source?: WorkspaceSource): SourceAnchorSelection {
  if (!isRecord(value)) throw new Error("Choose a valid source region.");
  if (value.kind === "diagramRegion") {
    if (!isRecord(value.bounds)) throw new Error("Choose a bounded diagram region.");
    const bounds = value.bounds;
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(
      (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)
    ) || (bounds.x as number) < 0 || (bounds.y as number) < 0
      || (bounds.width as number) <= 0 || (bounds.height as number) <= 0
      || (bounds.x as number) + (bounds.width as number) > 1
      || (bounds.y as number) + (bounds.height as number) > 1) {
      throw new Error("Diagram-region bounds must be normalized within the Source Layer.");
    }
    return {
      kind: "diagramRegion",
      bounds: {
        x: bounds.x as number,
        y: bounds.y as number,
        width: bounds.width as number,
        height: bounds.height as number
      }
    };
  }
  if (value.kind !== "text" && value.kind !== "equation") throw new Error("Choose a valid source region.");
  const startOffset = value.startOffset;
  const endOffset = value.endOffset;
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)
    || (startOffset as number) < 0 || (endOffset as number) <= (startOffset as number)
    || typeof value.exactText !== "string" || value.exactText.length !== (endOffset as number) - (startOffset as number)
    || typeof value.prefix !== "string" || typeof value.suffix !== "string"
    || value.prefix.length > 32 || value.suffix.length > 32) {
    throw new Error("Text and equation anchors require a precise non-empty source range.");
  }
  const location: SourceTextLocation = {
    startOffset: startOffset as number,
    endOffset: endOffset as number,
    exactText: value.exactText,
    prefix: value.prefix,
    suffix: value.suffix
  };
  if (source?.kind === "managedAsset" && !matchesSourceTextLocation(managedAssetLearnerContent(source), location)) {
    throw new Error("The selected source text no longer matches this Source Layer.");
  }
  if (value.kind === "text") return { kind: "text", ...location };
  if (!Number.isInteger(value.equationIndex) || (value.equationIndex as number) < 0) {
    throw new Error("An equation anchor requires its equation location.");
  }
  return { kind: "equation", equationIndex: value.equationIndex as number, ...location };
}

function matchesSourceTextLocation(
  content: string,
  selection: SourceTextLocation
): boolean {
  return content.slice(selection.startOffset, selection.endOffset) === selection.exactText
    && content.slice(Math.max(0, selection.startOffset - selection.prefix.length), selection.startOffset) === selection.prefix
    && content.slice(selection.endOffset, selection.endOffset + selection.suffix.length) === selection.suffix;
}

function reanchoringMatch(
  selection: SourceAnchorSelection,
  extraction: SourceIndexExtraction
): { selection: SourceAnchorSelection | null; strong: boolean } {
  if (selection.kind === "diagramRegion") return { selection: null, strong: false };
  const candidates: Array<{ selection: SourceAnchorSelection; contextMatches: boolean }> = [];
  for (const page of extraction.pages) {
    for (const region of page.regions) {
      if (region.kind !== selection.kind && !(selection.kind === "text" && region.kind === "text")) continue;
      let localOffset = region.text.indexOf(selection.exactText);
      while (localOffset >= 0) {
        const regionStart = region.sourceStartOffset ?? 0;
        const startOffset = regionStart + localOffset;
        const endOffset = startOffset + selection.exactText.length;
        const prefix = region.text.slice(Math.max(0, localOffset - selection.prefix.length), localOffset);
        const suffix = region.text.slice(localOffset + selection.exactText.length,
          localOffset + selection.exactText.length + selection.suffix.length);
        candidates.push({
          selection: {
            ...selection,
            startOffset,
            endOffset,
            prefix,
            suffix
          },
          contextMatches: prefix === selection.prefix && suffix === selection.suffix
        });
        localOffset = region.text.indexOf(selection.exactText, localOffset + 1);
      }
    }
  }
  const strong = candidates.filter((candidate) => candidate.contextMatches);
  if (strong.length === 1 && candidates.length === 1) return { selection: strong[0].selection, strong: true };
  return { selection: candidates.length === 1 ? candidates[0].selection : null, strong: false };
}

export function isSourceAnchorPaletteAction(value: unknown): value is SourceAnchorPaletteAction {
  return value === "explain" || value === "question" || value === "addNote" || value === "tellTutor"
    || value === "addToLearningTrail";
}

function isAnnotationPurpose(value: unknown): value is AnnotationPurpose {
  return value === "personalNote" || value === "tutorFeedback";
}

export function isSourceAnchorSelection(value: unknown): value is SourceAnchorSelection {
  try {
    validatedSourceAnchorSelection(value);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validAccessGrant(value: unknown): value is LocalSourceAccessGrant {
  return value === null || (isRecord(value) && value.kind === "securityScopedBookmark"
    && typeof value.bookmarkData === "string" && Boolean(value.bookmarkData));
}

function validSourceLinkRefresh(
  value: unknown
): value is SourceLinkRefresh {
  return isRecord(value) && typeof value.lastKnownPath === "string" && isAbsolute(value.lastKnownPath)
    && typeof value.canonicalPath === "string" && isAbsolute(value.canonicalPath)
    && validAccessGrant(value.accessGrant);
}

function validManagedAssetMediaType(value: unknown): value is ManagedAsset["mediaType"] {
  return ["text/plain", "application/pdf", "image/png", "image/jpeg", "inode/directory",
    "application/octet-stream", "application/vnd.quick-study.folder-snapshot+json"].includes(String(value));
}

function managedAssetLearnerContent(asset: ManagedAsset): string {
  if (!asset.sourceSnapshot) return asset.content;
  if (asset.mediaType === "text/plain") return Buffer.from(asset.content, "base64").toString("utf8");
  return `[Explicit ${asset.mediaType} Source Snapshot: ${asset.name}]`;
}

function validFingerprint(value: unknown): value is SourceFingerprint {
  return isRecord(value) && typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0
    && typeof value.modifiedAtMs === "number" && Number.isFinite(value.modifiedAtMs) && value.modifiedAtMs >= 0
    && (value.contentHash === undefined
      || (typeof value.contentHash === "string" && /^[a-f0-9]{64}$/.test(value.contentHash)));
}

function initialState(): LearningApplicationState {
  return {
    screen: "dashboard",
    quickStudy: {
      workspace: { id: "quick-study-workspace", kind: "system", name: "Quick Study" },
      mission: {
        id: "quick-study-unfiled-mission",
        kind: "unfiled",
        workspaceId: "quick-study-workspace"
      }
    },
    workspaces: [{
      id: "quick-study-workspace",
      kind: "system",
      name: "Quick Study",
      context: emptyWorkspaceContext()
    }],
    missions: [
      {
        id: "quick-study-unfiled-mission",
        kind: "unfiled",
        workspaceId: "quick-study-workspace",
        name: "Unfiled"
      }
    ],
    argumentRoadmaps: [],
    sessions: [],
    sources: [],
    sourceIndexes: [],
    sourceRevisions: [],
    reanchoringDecisions: [],
    activeSessionId: null,
    resumeSessionId: null,
    navigation: {
      workspaceId: "quick-study-workspace",
      missionId: "quick-study-unfiled-mission"
    },
    activityOrder: 0,
    authentication: signedOutAuthentication(),
    intakeError: null,
    runtimeAvailable: false,
    runtimeCapabilities: { models: [] },
    modelAccess: {
      status: "unavailable",
      cause: "runtime",
      message: "Codex Runtime is unavailable. Restart Codex and try again."
    },
    accessConfirmationPreference: { confirmFullAccess: true },
    personalNoteSynthesisPreference: { includePersonalNotes: true }
  };
}

function isReasoningPreference(value: unknown): value is ReasoningPreference {
  return value === "faster" || value === "balanced" || value === "deeper";
}

function migrateReasoningPreference(value: unknown): ReasoningPreference {
  if (value === undefined) return "balanced";
  if (!isReasoningPreference(value)) throw new Error("Stored Reasoning Preference is invalid.");
  return value;
}

function migrateRuntimeOverride(value: unknown): RuntimeOverride | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.model !== "string" || !value.model.trim()
    || !isReasoningEffort(value.reasoningEffort)) {
    throw new Error("Stored Runtime Override is invalid.");
  }
  return { model: value.model, reasoningEffort: value.reasoningEffort };
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(String(value));
}

function validatedRuntimeCapabilities(value: unknown): ModelRuntimeCapabilities {
  if (!isRecord(value) || !Array.isArray(value.models) || !value.models.every((model) => isRecord(model)
    && typeof model.model === "string" && Boolean(model.model.trim())
    && typeof model.displayName === "string" && Boolean(model.displayName.trim())
    && typeof model.isDefault === "boolean"
    && Array.isArray(model.supportedReasoningEfforts)
    && model.supportedReasoningEfforts.length > 0
    && model.supportedReasoningEfforts.every(isReasoningEffort))) {
    throw new Error("Codex Runtime returned invalid model capabilities.");
  }
  return structuredClone(value) as unknown as ModelRuntimeCapabilities;
}

function selectAgentBudget(
  session: LearningSession,
  coordination: AgentTaskCoordination,
  capabilities: ModelRuntimeCapabilities
): AgentBudget {
  const runtimeSelection = selectTeachingRuntime(session, capabilities);
  const agentCount = coordination === "single" ? 1 : 2;
  return {
    agentCount,
    concurrency: coordination === "independent" ? agentCount : 1,
    model: runtimeSelection.model,
    reasoningEffort: runtimeSelection.reasoningEffort,
    tools: ["checkpointSpecialistResult"],
    maxTokens: BOUNDED_SPECIALIST_BUDGET_V1.maxTokens,
    maxLatencyMs: BOUNDED_SPECIALIST_BUDGET_V1.maxLatencyMs
  };
}

function clearUnsupportedRuntimeOverrides(
  sessions: LearningSession[],
  capabilities: ModelRuntimeCapabilities
): void {
  for (const session of sessions) {
    const override = session.runtimeOverride;
    if (!override) continue;
    const model = capabilities.models.find((candidate) => candidate.model === override.model);
    if (!model?.supportedReasoningEfforts.includes(override.reasoningEffort)) session.runtimeOverride = null;
  }
}

function selectTeachingRuntime(
  session: LearningSession,
  capabilities: ModelRuntimeCapabilities
): TeachingRequest["runtimeSelection"] {
  if (session.runtimeOverride) return structuredClone(session.runtimeOverride);
  const automaticEffort = ({ faster: "low", balanced: "medium", deeper: "high" } as const)[session.reasoningPreference];
  const defaultModel = capabilities.models.find((model) => model.isDefault);
  if (!defaultModel) throw new Error("Codex Runtime did not advertise one default model.");
  const safeEfforts: ReasoningEffort[] = [
    automaticEffort,
    ...(["medium", "low", "high", "minimal", "none", "xhigh"] as const).filter((effort) => effort !== automaticEffort)
  ];
  for (const effort of safeEfforts) {
    if (defaultModel.supportedReasoningEfforts.includes(effort)) {
      return { model: "runtimeDefault", reasoningEffort: effort };
    }
    const supportingModel = capabilities.models.find((model) => model.supportedReasoningEfforts.includes(effort));
    if (supportingModel) return { model: supportingModel.model, reasoningEffort: effort };
  }
  throw new Error("Codex Runtime advertises only maximum reasoning choices; choose an advanced Runtime Override explicitly.");
}

function unavailableModelAccess(error: unknown): Extract<ModelAccessState, { status: "unavailable" }> {
  const message = usefulRuntimeError(error);
  return {
    status: "unavailable",
    cause: error instanceof ModelAccessError ? error.cause : "runtime",
    message
  };
}

function authenticationMessage(authentication: Exclude<AuthenticationState, { status: "signedIn" }>): string {
  if (authentication.status === "failed") return authentication.error;
  if (authentication.status === "signingIn") return "Finish Codex authentication to restore model teaching.";
  return "Codex authentication is required for model teaching.";
}

function authenticationView(authentication: AuthenticationState): LearningApplicationState["authentication"] {
  switch (authentication.status) {
    case "signedOut":
      return signedOutAuthentication();
    case "signingIn":
      return {
        status: "signingIn",
        method: authentication.method,
        accountLabel: null,
        loginUrl: null,
        error: null
      };
    case "signedIn":
      return {
        status: "signedIn",
        method: authentication.method,
        accountLabel: authentication.accountLabel,
        loginUrl: null,
        error: null
      };
    case "failed":
      return {
        status: "failed",
        method: authentication.method,
        accountLabel: null,
        loginUrl: null,
        error: authentication.error
      };
  }
}

function signedOutAuthentication(): LearningApplicationState["authentication"] {
  return { status: "signedOut", method: null, accountLabel: null, loginUrl: null, error: null };
}

function failedAuthentication(
  method: "chatgpt" | "apiKey" | null,
  error: unknown
): LearningApplicationState["authentication"] {
  return {
    status: "failed",
    method,
    accountLabel: null,
    loginUrl: null,
    error: usefulRuntimeError(error)
  };
}
