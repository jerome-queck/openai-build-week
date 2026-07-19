import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  ModelAccessError,
  isCompleteEvidenceTransferContext,
  isEvidenceTransferContext,
  type ArtifactSynthesisResult,
  type AgentBrief,
  type AgentBudget,
  type AuthenticationState,
  type DelayedTransferAssessment,
  type DelayedTransferTask,
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
import {
  buildDerivedResearchQuery,
  validatedCorroborationResearchResult,
  validatedExternalResearchResult,
  type DerivedResearchQuery,
  type DerivedResearchQueryInput,
  type ExternalResearch,
  type ExternalResearchResult,
  type CorroborationResearchEvidence,
  type ResearchExcerpt
} from "./external-research";
import {
  BUNDLED_LEAN_ENVIRONMENT,
  formalizationForClaim,
  type VerificationEnvironment,
  type VerifierCommandOutcome,
  type VerifierEnvironmentManager,
  type VerifierRuntime
} from "./verifier-runtime";
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

export interface ResearchAction {
  id: string;
  accessPolicy: SessionAccessPolicy;
  query: DerivedResearchQuery;
  queryOrigin: "learnerAuthored" | "automaticCorroboration";
  researchDepth: "lightweight" | "deep";
  informedBySourceIds: string[];
  destination: string;
  excerpts: ResearchExcerpt[];
  status: "running" | "completed" | "denied" | "timedOut" | "failed" | "stopped";
  result: ExternalResearchResult | null;
  error: string | null;
}

export interface SourceDiscrepancy {
  id: string;
  relevantResult: string;
  summary: string;
  competingEvidence: CorroborationResearchEvidence[];
}

export interface CorroborationPass {
  id: string;
  researchActionId: string | null;
  status: "running" | "completed" | "incomplete" | "disputed";
  relevantResult: string;
  currentUse: { assumptions: string[]; conclusion: string };
  pedagogicalBaselinePresent: boolean;
  assumptionComparison: "matches" | "mismatch" | "unchecked";
  conclusionComparison: "matches" | "mismatch" | "unchecked";
  errataCheck: "noneFound" | "found" | "unchecked";
  independentSupport: "sufficient" | "weakOnly" | "conflicting" | "missing";
  proofApproachResearch: "notRequired" | "established" | "incomplete";
  deeperResearch: { required: boolean; performed: boolean; reason: string | null };
  evidence: CorroborationResearchEvidence[];
  sourceDiscrepancies: SourceDiscrepancy[];
  message: string;
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
  pageNumbers?: number[];
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

export const UNDERSTANDING_CHECK_KINDS = ["explain", "apply", "compare", "diagnose", "continueReasoning"] as const;
export type UnderstandingCheckKind = typeof UNDERSTANDING_CHECK_KINDS[number];
export const TEACHING_ROUTES = ["visual", "symbolic", "exampleFirst", "proofStructural"] as const;
export type TeachingRoute = typeof TEACHING_ROUTES[number];
export type UnderstandingInterpretation = "specificGap" | "secureUnderstanding" | "excessivePace";
export type TeachingMoveKind = "explain" | "demonstrate" | "apply" | "compare" | "slowDown" | "visualize";

interface TeachingContext {
  concept: string;
  task: string;
}

const UNDERSTANDING_INTERPRETATION_POLICIES: Record<UnderstandingInterpretation, {
  kind: TeachingMoveKind;
  summary: string;
  signal: string;
  direction: string;
}> = {
  specificGap: {
    kind: "demonstrate", summary: "specific gap", signal: "a specific gap", direction: "demonstrate the missing reasoning step"
  },
  secureUnderstanding: {
    kind: "apply", summary: "secure understanding", signal: "secure understanding", direction: "move to an application or comparison"
  },
  excessivePace: {
    kind: "slowDown", summary: "excessive pace", signal: "excessive pace", direction: "slow down and make the route explicit"
  }
};

export interface TeachingMove {
  id: string;
  kind: TeachingMoveKind;
  route: TeachingRoute;
  reason: string;
  evidenceIds: string[];
  experimentId: string | null;
}

export interface UnderstandingCheck {
  id: string;
  kind: UnderstandingCheckKind;
  prompt: string;
  concept: string;
  representation: TeachingRoute;
  sourceContext: { sourceAnchorId: string | null; sourceIds: string[] };
  evidenceTransferContext?: EvidenceTransferContext | null;
  teachingMoveId: string;
  status: "offered" | "answered" | "skipped";
}

export interface UnderstandingEvidence {
  id: string;
  checkId: string;
  response: string;
  concept: string;
  task: string;
  representation: TeachingRoute;
  sourceContext: UnderstandingCheck["sourceContext"];
  evidenceTransferContext?: EvidenceTransferContext | null;
  elicitingTeachingMoveId: string;
  interpretation: UnderstandingInterpretation;
  learnerCorrection: string | null;
}

export type LearnerModelConfidence = "low" | "medium" | "high";

export interface EvidenceTransferContext {
  concepts: string[];
  mathematicalStructures: string[];
  prerequisiteRelationships: Array<{
    prerequisiteConcept: string;
    supportsConcept: string;
    relationship: "requiredFor";
  }>;
  taskDemands: string[];
}

export interface LearnerModelLedgerEntry {
  id: string;
  kind: "understandingEvidence" | "interactionPreference";
  inference: string;
  sourceEvidence: {
    sessionId: string;
    sourceRecordId: string;
    evidenceIds: string[];
    summary: string;
  };
  mathematicalContext: EvidenceTransferContext;
  scope: {
    workspaceId: string;
    missionId: string;
    sessionId: string;
    sessionTarget: string;
  };
  confidence: LearnerModelConfidence;
  status: "active" | "corrected" | "excluded";
  correction: string | null;
  governanceHistory: Array<{
    id: string;
    action: "corrected" | "excluded";
    note: string | null;
    at: string;
  }>;
  createdAt: string;
  lastUpdatedAt: string;
}

export interface LearnerModel {
  entries: LearnerModelLedgerEntry[];
  adaptiveReuseEnabled: boolean;
  lastResetAt: string | null;
}

interface LearnerModelReuseRecord {
  id: string;
  learnerModelEntryId: string;
  sourceSessionId: string;
  sourceRecordId: string;
  inference: string;
  confidence: LearnerModelConfidence;
  sourceContext: EvidenceTransferContext;
  targetContext: EvidenceTransferContext;
  provenance: {
    workspaceId: string;
    missionId: string;
    sessionTarget: string;
    summary: string;
    lastUpdatedAt: string;
  };
}

export interface EvidenceTransfer extends LearnerModelReuseRecord {
  origin: "transferred";
}

export interface PriorUnderstandingEvidence extends LearnerModelReuseRecord {
  origin: "priorSession";
}

export interface InteractionPreferenceReuse extends LearnerModelReuseRecord {
  origin: "interactionPreference";
}

export interface TeachingExperiment {
  id: string;
  route: TeachingRoute;
  reason: string;
  context: TeachingContext;
  evidenceIds: string[];
  status: "active" | "completed";
  outcome: "helpful" | "notHelpful" | "inconclusive" | null;
}

export interface InteractionPreference {
  id: string;
  route: TeachingRoute;
  context: TeachingContext;
  status: "supported" | "notSupported" | "uncertain";
  evidenceIds: string[];
  experimentId: string;
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
  claims?: ClaimVerificationState[];
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
  claims: ClaimVerificationState[];
  personalNoteContributions: PersonalNoteContribution[];
  provenance: {
    action: "promoted" | "edited" | "restored" | "synthesized";
    createdAt: string | null;
    priorRevisionId: string | null;
  };
}

export interface AcceptedFormalVerification {
  target: "teachingCard" | "learningArtifact";
  targetId: string;
  claimId: string;
  exactStatement: string;
  checker: string;
  verificationEnvironment: string;
}

export interface FormalVerificationRequest {
  runId: string;
  target: AcceptedFormalVerification["target"];
  targetId: string;
  claimId: string;
}

export interface VerifierManifest {
  id: string;
  sessionId: string;
  target: FormalVerificationRequest["target"];
  targetId: string;
  claimId: string;
  claimRevisionId: string;
  exactClaim: string;
  formalStatement: string | null;
  assumptions: string[];
  proofSource: string | null;
  environment: Readonly<VerificationEnvironment>;
  command: string;
  commandOutcome: VerifierCommandOutcome;
  formalStatementVerificationLevel: "formallyVerified" | "incomplete";
  diagnostics: string;
  evidenceLocation: string | null;
  createdAt: string;
}

export interface FormalVerificationAuthority {
  resolveAcceptedReceipt(receiptId: string): Promise<AcceptedFormalVerification | null>;
}

export type ClaimOrigin = "learner" | "suppliedSource" | "modelGenerated" | "mixed";
export type VerificationLevel = "notIndependentlyChecked" | "reasoningReviewed" | "sourceGrounded"
  | "independentlyCorroborated" | "formallyVerified";
export type VerificationCurrency = "current" | "changedSinceCheck";
export type ClaimCheckMethod = "reasoningReview" | "sourceGrounded" | "independentCorroboration" | "formalVerification";
export type ClaimCheckOutcome = "supports" | "disagrees" | "unresolved";
export type ClaimEvidenceReference =
  | { kind: "sourceAnchor"; sourceAnchorId: string }
  | { kind: "researchEvidence"; researchActionId: string }
  | { kind: "agentWork"; sessionId: string; fromSequence: number; toSequence: number }
  | { kind: "learnerRevision"; revisionId: string; subject: "teachingCard" | "learningArtifact" }
  | { kind: "formalChecker"; checker: string; verificationEnvironment: string };

export interface ClaimVerificationEvidence {
  id: string;
  method: ClaimCheckMethod;
  outcome: ClaimCheckOutcome;
  summary: string;
  limitation: string | null;
  reference: ClaimEvidenceReference;
  currency: VerificationCurrency;
  changedBecause: string | null;
  createdAt: string;
}

export interface VerificationGap {
  id: string;
  reason: string;
  affectedConclusion: string;
  evidenceId: string;
}

export type VerificationRiskFactor = "nonTrivial" | "weakSupport" | "disputed" | "longDependencyChain"
  | "substantialDeparture" | "checkerFailure";

export interface VerificationEscalation {
  recommended: boolean;
  reasons: string[];
}

export interface ClaimVerificationState {
  claimId: string;
  claimStatement: string;
  claimOrigin: ClaimOrigin;
  claimOriginReferences: ClaimEvidenceReference[];
  verificationLevel: VerificationLevel;
  verificationCurrency: VerificationCurrency;
  verificationEvidence: ClaimVerificationEvidence[];
  verificationGaps: VerificationGap[];
  verificationEscalation: VerificationEscalation;
}

export interface ClaimCheckRecord {
  target: "teachingCard" | "learningArtifact";
  targetId: string;
  claimId: string;
  method: Exclude<ClaimCheckMethod, "formalVerification">;
  outcome: ClaimCheckOutcome;
  summary: string;
  evidence: ClaimEvidenceReference;
}

export interface VerificationEscalationAssessment {
  target: "teachingCard" | "learningArtifact";
  targetId: string;
  claimId: string;
  riskFactors: VerificationRiskFactor[];
  modelConfidence?: number;
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

export interface DelayedTransferOffer {
  status: "pending" | "declined" | "dismissed" | "scheduled" | "cancelled";
  offeredAt: string;
  proposedDueAt: string;
}

export interface DelayedTransferCheck {
  id: string;
  relatedSessionId: string;
  relatedLearningSessionGoal: string;
  originatingSessionTarget: string;
  originatingConcepts: string[];
  intendedTransferGoal: string;
  scheduledAt: string;
  updatedAt: string;
  dueAt: string;
  status: "scheduled" | "preparing" | "stopping" | "inProgress" | "completed" | "skipped" | "dismissed" | "cancelled";
  relevantSourceAnchorId: string | null;
  relevantTrailItemId: string | null;
  task: DelayedTransferTask | null;
  taskError: string | null;
  draft: DelayedTransferDraft;
  evidence: DelayedTransferEvidence | null;
  result: DelayedCheckResult | null;
}

export interface DelayedTransferDraft {
  work: string;
  reasoning: string;
  confidence: LearnerModelConfidence | null;
  clarifications: Array<{ question: string; response: string; requestedAt: string }>;
}

export interface DelayedTransferEvidence {
  id: string;
  checkId: string;
  originatingSessionId: string;
  dueAt: string;
  completedAt: string;
  scheduledDelayMs: number;
  completionDelayMs: number;
  task: DelayedTransferTask;
  mathematicalContext: EvidenceTransferContext;
  work: string;
  reasoning: string;
  confidence: LearnerModelConfidence | null;
  assistanceUsed: boolean;
  result: DelayedTransferAssessment["result"];
  reasoningQuality: DelayedTransferAssessment["reasoningQuality"];
  confidenceCalibration: DelayedTransferAssessment["confidenceCalibration"];
  misconceptionOrStrength: string;
  recommendedNextAction: string;
}

export interface DelayedCheckResult {
  evidenceId: string;
  refresherOffer: null | {
    status: "pending" | "accepted" | "declined";
    goal: string;
    refresherSessionId: string | null;
  };
}

export interface ContinuationLink {
  sessionId: string;
  outcomeId: string;
}

export interface RefresherLink {
  checkId: string;
  evidenceId: string;
  originatingSessionId: string;
  sourceAnchorId: string | null;
  trailItemId: string | null;
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

export interface AgentTaskSpecialistProgress {
  status: "pending" | "working" | "waiting" | "complete" | "retained";
  checkpoint: string;
  result: SpecialistAgentResult | null;
  usedTokens: number;
  usedLatencyMs: number;
}

export function isAgentTaskCoordination(value: unknown): value is AgentTaskCoordination {
  return AGENT_TASK_COORDINATIONS.includes(value as AgentTaskCoordination);
}

export interface AgentTask {
  id: string;
  purpose: string;
  status: AgentTaskStatus;
  statusMessage: string | null;
  resumeAvailable: boolean;
  identifiedNeed: {
    kind: "hiddenAssumptionReview";
    requestedBy: "learner";
    description: string;
  };
  brief: AgentBrief;
  specialistBriefs: AgentBrief[];
  specialistProgress: AgentTaskSpecialistProgress[];
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
  teachingMoves: TeachingMove[];
  currentTeachingMove: TeachingMove;
  understandingChecks: UnderstandingCheck[];
  understandingEvidence: UnderstandingEvidence[];
  teachingExperiments: TeachingExperiment[];
  interactionPreferences: InteractionPreference[];
  evidenceTransferContext: EvidenceTransferContext | null;
  evidenceTransfers: EvidenceTransfer[];
  priorUnderstandingEvidence: PriorUnderstandingEvidence[];
  interactionPreferenceReuses: InteractionPreferenceReuse[];
  ignoreLearnerModel: boolean;
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
  researchEgressPermission: { status: "notGranted" | "granted" | "revoked" };
  researchActions: ResearchAction[];
  corroborationPass: CorroborationPass | null;
  corroborationPassHistory: CorroborationPass[];
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
  delayedTransferOffer: DelayedTransferOffer | null;
  continuationOf: ContinuationLink | null;
  refresherOf: RefresherLink | null;
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
  verifierEnvironmentPinId: string | null;
}

export interface LearningApplicationState {
  screen: "dashboard" | "workbench" | "followUps" | "delayedTransfer";
  quickStudy: QuickStudyHome;
  workspaces: StudyWorkspace[];
  missions: StudyMission[];
  argumentRoadmaps: ArgumentRoadmap[];
  sessions: LearningSession[];
  sources: WorkspaceSource[];
  sourceIndexes: SourceIndexSummary[];
  sourceRevisions: SourceRevision[];
  reanchoringDecisions: ReanchoringDecision[];
  verifierManifests: VerifierManifest[];
  verifierEnvironment: VerifierEnvironmentState;
  delayedTransferChecks: DelayedTransferCheck[];
  activeDelayedTransferCheckId: string | null;
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
  sourceExcerptEgressPreference: {
    enabled: boolean;
  };
  learnerModel: LearnerModel;
}

export interface VerifierEnvironmentState {
  status: "installed" | "absent" | "installing" | "removing" | "installFailed" | "removeFailed" | "cleanupRequired";
  environment: Readonly<VerificationEnvironment>;
  defaultEnvironment: Readonly<VerificationEnvironment>;
  activeEnvironmentId: string | null;
  environments: RegisteredVerifierEnvironment[];
  installedBytes: number;
  lastRemovedLogicalBytes: number;
  error: string | null;
}

export interface RegisteredVerifierEnvironment {
  environment: Readonly<VerificationEnvironment>;
  installedBytes: number;
  pinned: boolean;
  manifestReferences: number;
}

export type LearnerAction =
  | { type: "startQuickStudy"; mathematics: string; location?: StudyLocation; ignoreLearnerModel?: boolean }
  | { type: "submitSessionIntake"; mathematics: string; location?: StudyLocation; ignoreLearnerModel?: boolean }
  | { type: "confirmSessionProposal" }
  | { type: "cancelModelWork" }
  | { type: "cancelSessionModelWork"; sessionId: string }
  | { type: "retryModelWork" }
  | { type: "requestSpecialistReview"; coordination?: AgentTaskCoordination }
  | { type: "retryAgentTask"; taskId: string }
  | { type: "resumeAgentTask"; taskId: string }
  | { type: "setReasoningPreference"; preference: ReasoningPreference }
  | { type: "setRuntimeOverride"; override: RuntimeOverride | null }
  | {
      type: "offerUnderstandingCheck";
      kind: UnderstandingCheckKind;
      prompt: string;
      concept: string;
      representation: TeachingRoute;
      sourceAnchorId?: string;
      evidenceTransferContext?: EvidenceTransferContext;
    }
  | { type: "skipUnderstandingCheck"; checkId: string }
  | {
      type: "recordUnderstandingEvidence";
      checkId: string;
      response: string;
      interpretation: UnderstandingInterpretation;
      confidence?: LearnerModelConfidence;
    }
  | { type: "startTeachingExperiment"; route: TeachingRoute; reason: string }
  | {
      type: "completeTeachingExperiment";
      experimentId: string;
      outcome: Exclude<TeachingExperiment["outcome"], null>;
    }
  | {
      type: "correctUnderstandingEvidence";
      evidenceId: string;
      interpretation: UnderstandingInterpretation;
      correction: string;
    }
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
  | {
      type: "editTeachingCardClaims";
      cardId: string;
      claimEdits: Array<{ claimId: string | null; statement: string }>;
    }
  | { type: "restoreTeachingCardRevision"; cardId: string; revisionId: string }
  | { type: "createTeachingVariant"; cardId: string; name: string; instruction: string }
  | { type: "retryAnchoredTeachingCard"; cardId: string; variantId?: string }
  | { type: "pinTeachingCardArtifact"; cardId: string; artifactKind?: LearningArtifact["kind"] }
  | { type: "synthesizeLearningArtifact"; sessionId?: string; artifactId: string }
  | {
      type: "editLearningArtifact";
      sessionId?: string;
      artifactId: string;
      content: string;
      mathematicalChange?: "semantic" | "formattingOnly";
      claimEdits?: Array<{ claimId: string | null; statement: string }>;
    }
  | { type: "restoreLearningArtifactRevision"; sessionId?: string; artifactId: string; revisionId: string }
  | { type: "addTrailItem"; kind: TrailItemKind; content: string }
  | { type: "editTrailItem"; trailItemId: string; content: string }
  | { type: "removeTrailItem"; trailItemId: string }
  | { type: "moveTrailItem"; trailItemId: string; direction: "up" | "down" }
  | { type: "setTrailItemRequired"; trailItemId: string; required: boolean }
  | { type: "beginSessionConsolidation" }
  | ({ type: "reviseSessionConsolidation" } & SessionConsolidationDraft)
  | { type: "consolidateSession" }
  | { type: "declineDelayedTransfer"; sessionId: string }
  | { type: "dismissDelayedTransfer"; sessionId: string }
  | { type: "scheduleDelayedTransfer"; sessionId: string; intendedTransferGoal: string; dueAt: string }
  | { type: "rescheduleDelayedTransfer"; checkId: string; dueAt: string }
  | { type: "cancelDelayedTransfer"; checkId: string }
  | { type: "startDelayedTransferCheck"; checkId: string }
  | {
      type: "saveDelayedTransferDraft";
      checkId: string;
      work: string;
      reasoning: string;
      confidence: LearnerModelConfidence | null;
    }
  | { type: "requestDelayedTransferClarification"; checkId: string; question: string }
  | { type: "completeDelayedTransferCheck"; checkId: string }
  | { type: "skipDelayedTransferCheck"; checkId: string }
  | { type: "dismissDueDelayedTransferCheck"; checkId: string }
  | { type: "acceptDelayedTransferRefresher"; checkId: string }
  | { type: "declineDelayedTransferRefresher"; checkId: string }
  | { type: "openDelayedTransferCheck"; checkId: string }
  | { type: "closeDelayedTransferCheck" }
  | { type: "cancelDelayedTransferPreparation"; checkId: string }
  | { type: "openFollowUpQueue" }
  | { type: "closeFollowUpQueue" }
  | { type: "continueSession"; sessionId: string }
  | { type: "retrySessionModelStop"; sessionId: string }
  | { type: "selectSessionAccessPolicy"; policy: SessionAccessPolicy }
  | { type: "setFullAccessConfirmation"; enabled: boolean }
  | { type: "setPersonalNoteSynthesis"; enabled: boolean }
  | { type: "setSourceExcerptEgressPreference"; enabled: boolean }
  | { type: "correctLearnerModelInference"; entryId: string; correction: string }
  | { type: "excludeLearnerModelInference"; entryId: string }
  | { type: "deleteLearnerModelInference"; entryId: string }
  | { type: "resetLearnerModel" }
  | { type: "setAdaptiveReusePreference"; enabled: boolean }
  | { type: "setSessionLearnerModelIgnored"; ignored: boolean }
  | { type: "removeVerifierEnvironment" }
  | { type: "installVerifierEnvironment" }
  | { type: "activateVerifierEnvironment"; environmentId: string }
  | { type: "setVerifierEnvironmentPinned"; environmentId: string; pinned: boolean }
  | { type: "setSessionVerifierEnvironmentPin"; sessionId: string; environmentId: string | null }
  | { type: "cleanupVerifierEnvironment" }
  | { type: "setResearchEgressPermission"; enabled: boolean }
  | { type: "researchWeb"; query: DerivedResearchQueryInput; sourceAnchorIds: string[] }
  | { type: "cancelExternalResearch"; researchActionId: string }
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
  private readonly verifierEvidenceDirectory: string;
  private modelRuntime: ModelRuntime | null;
  private persistence = Promise.resolve();
  private sourceIndexWork = Promise.resolve();
  private sourceSnapshotWork = Promise.resolve();
  private verifierEnvironmentWork = Promise.resolve();
  private readonly modelWorks = new Map<string, {
    controller: AbortController;
    promise: Promise<unknown>;
    stop(): void;
    checkpointForShutdown?(): void;
    markUnconfirmed(): void;
    restart(): Promise<void>;
  }>();
  private readonly accessDecisionWaiters = new Map<string, (decision: RuntimeAccessDecision) => void>();
  private readonly researchWorks = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly stateListeners = new Set<(state: LearningApplicationState) => void>();
  private agentWorkLogs: Record<string, Array<ModelRuntimeEvent & { sequence: number }>> = {};
  private sourceIndexDocuments = new Map<string, SourceIndexDocument>();
  private sourceSearchResults = new Map<string, SourceSearchResult>();

  private constructor(
    dataDirectory: string,
    modelRuntime: ModelRuntime | null,
    private readonly sourceAccess: LocalSourceAccess | null,
    private readonly artifactSharing: ArtifactSharing | null,
    private readonly externalResearch: ExternalResearch | null,
    private readonly formalVerificationAuthority: FormalVerificationAuthority | null,
    private readonly verifierRuntime: VerifierRuntime | null,
    private readonly verifierEnvironmentManager: VerifierEnvironmentManager | null
  ) {
    this.statePath = join(dataDirectory, "learning-application.json");
    this.sourceIndexPath = join(dataDirectory, "source-index.json");
    this.verifierEvidenceDirectory = join(dataDirectory, "verifier-evidence");
    this.modelRuntime = modelRuntime;
  }

  static async launch(
    dataDirectory: string,
    modelRuntime: ModelRuntime | null = null,
    sourceAccess: LocalSourceAccess | null = null,
    artifactSharing: ArtifactSharing | null = null,
    externalResearch: ExternalResearch | null = null,
    formalVerificationAuthority: FormalVerificationAuthority | null = null,
    verifierRuntime: VerifierRuntime | null = null,
    verifierEnvironmentManager: VerifierEnvironmentManager | null = null
  ): Promise<LearningApplication> {
    const application = new LearningApplication(
      dataDirectory, modelRuntime, sourceAccess, artifactSharing, externalResearch, formalVerificationAuthority,
      verifierRuntime, verifierEnvironmentManager
    );
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
        for (const research of session.researchActions) {
          if (research.status === "running") {
            research.status = "failed";
            research.error = "External research stopped when the application closed. Review and start it again explicitly.";
          }
        }
        if (session.corroborationPass?.status === "running") {
          const research = session.researchActions.find(
            (candidate) => candidate.id === session.corroborationPass?.researchActionId
          );
          if (research) completeCorroborationPass(session.corroborationPass, research);
          else completeUnavailableCorroboration(session.corroborationPass);
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
          checkpointAgentTaskForRelaunch(activeAgentTask);
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
    await application.synchronizeVerifierEnvironment();
    return application;
  }

  getState(): LearningApplicationState {
    return structuredClone(this.state);
  }

  private async synchronizeVerifierEnvironment(): Promise<void> {
    if (!this.verifierEnvironmentManager) {
      this.state.verifierEnvironment = {
        ...this.state.verifierEnvironment,
        status: this.verifierRuntime ? "installed" : "absent",
        error: null
      };
      return;
    }
    const priorStatus = this.state.verifierEnvironment.status;
    try {
      const inspection = await this.verifierEnvironmentManager.inspect();
      const interrupted = priorStatus === "installing" || priorStatus === "removing";
      this.applyVerifierEnvironmentInspection(inspection);
      this.state.verifierEnvironment = {
        ...this.state.verifierEnvironment,
        status: interrupted || inspection.cleanupRequired ? "cleanupRequired"
          : priorStatus === "installFailed" || priorStatus === "removeFailed" ? priorStatus
            : inspection.installed ? "installed" : "absent",
        installedBytes: inspection.installedBytes,
        error: interrupted
          ? "The previous Lean environment operation was interrupted. Clean up its staging files before retrying."
          : inspection.cleanupRequired
            ? "Lean environment staging files require cleanup before formal verification can resume."
            : priorStatus === "installFailed" || priorStatus === "removeFailed"
              ? this.state.verifierEnvironment.error
              : null
      };
    } catch (error) {
      this.state.verifierEnvironment = {
        ...this.state.verifierEnvironment,
        status: "cleanupRequired",
        error: usefulVerifierEnvironmentError(error)
      };
    }
  }

  private serializeVerifierEnvironment<T>(work: () => Promise<T>): Promise<T> {
    const result = this.verifierEnvironmentWork.then(work, work);
    this.verifierEnvironmentWork = result.then(() => undefined, () => undefined);
    return result;
  }

  private applyVerifierEnvironmentInspection(inspection: Awaited<ReturnType<VerifierEnvironmentManager["inspect"]>>): void {
    const previous = new Map(this.state.verifierEnvironment.environments.map((entry) => [entry.environment.id, entry]));
    const installations = inspection.environments ?? (inspection.installed ? [{
      environment: this.state.verifierEnvironment.environment,
      installedBytes: inspection.installedBytes
    }] : []);
    const references = new Map<string, number>();
    for (const manifest of this.state.verifierManifests) {
      references.set(manifest.environment.id, (references.get(manifest.environment.id) ?? 0) + 1);
    }
    const environments = installations.map(({ environment, installedBytes }) => ({
      environment,
      installedBytes,
      pinned: previous.get(environment.id)?.pinned ?? false,
      manifestReferences: references.get(environment.id) ?? 0
    }));
    const activeEnvironmentId = inspection.activeEnvironmentId === undefined
      ? (inspection.installed ? this.state.verifierEnvironment.activeEnvironmentId ?? this.state.verifierEnvironment.environment.id : null)
      : inspection.activeEnvironmentId;
    const active = environments.find((entry) => entry.environment.id === activeEnvironmentId) ?? null;
    this.state.verifierEnvironment = {
      ...this.state.verifierEnvironment,
      activeEnvironmentId: active?.environment.id ?? null,
      environment: active?.environment ?? this.state.verifierEnvironment.defaultEnvironment,
      environments,
      installedBytes: active?.installedBytes ?? 0
    };
  }

  private refreshVerifierManifestReferences(): void {
    for (const environment of this.state.verifierEnvironment.environments) {
      environment.manifestReferences = this.state.verifierManifests
        .filter((manifest) => manifest.environment.id === environment.environment.id).length;
    }
  }

  private unreferencedVerifierEnvironmentIds(): string[] {
    const sessionPins = new Set(this.state.sessions.map((session) => session.verifierEnvironmentPinId).filter(Boolean));
    return this.state.verifierEnvironment.environments
      .filter((entry) => entry.environment.id !== this.state.verifierEnvironment.activeEnvironmentId
        && entry.environment.id !== this.state.verifierEnvironment.defaultEnvironment.id
        && !entry.pinned && entry.manifestReferences === 0 && !sessionPins.has(entry.environment.id))
      .map((entry) => entry.environment.id);
  }

  private async removeVerifierEnvironment(): Promise<void> {
    if (!this.verifierEnvironmentManager) {
      this.state.verifierEnvironment.status = "removeFailed";
      this.state.verifierEnvironment.error = "The Bundled Lean Runtime cannot be managed in this application build.";
      return;
    }
    if (this.state.verifierEnvironment.status !== "installed" && this.state.verifierEnvironment.status !== "removeFailed") {
      throw new Error("The Bundled Lean Runtime is not ready to remove.");
    }
    this.state.verifierEnvironment.status = "removing";
    this.state.verifierEnvironment.error = null;
    await this.publishAndPersist();
    try {
      const result = await this.verifierEnvironmentManager.remove(this.state.verifierEnvironment.activeEnvironmentId ?? undefined);
      this.applyVerifierEnvironmentInspection(await this.verifierEnvironmentManager.inspect());
      this.state.verifierEnvironment = {
        ...this.state.verifierEnvironment,
        status: "absent",
        installedBytes: 0,
        lastRemovedLogicalBytes: result.removedLogicalBytes,
        error: null
      };
    } catch (error) {
      this.state.verifierEnvironment.status = "removeFailed";
      this.state.verifierEnvironment.error = usefulVerifierEnvironmentError(error);
    }
  }

  private async installVerifierEnvironment(): Promise<void> {
    if (!this.verifierEnvironmentManager) {
      this.state.verifierEnvironment.status = "installFailed";
      this.state.verifierEnvironment.error = "The Bundled Lean Runtime cannot be managed in this application build.";
      return;
    }
    const currentDefaultInstalled = this.state.verifierEnvironment.environments
      .some((entry) => entry.environment.id === this.state.verifierEnvironment.defaultEnvironment.id);
    if (this.state.verifierEnvironment.status !== "absent" && this.state.verifierEnvironment.status !== "installFailed"
      && !(this.state.verifierEnvironment.status === "installed" && !currentDefaultInstalled)) {
      throw new Error("Clean up the Bundled Lean Runtime before installing it.");
    }
    this.state.verifierEnvironment.status = "installing";
    this.state.verifierEnvironment.error = null;
    await this.publishAndPersist();
    const priorActive = this.state.verifierEnvironment.activeEnvironmentId;
    try {
      const result = await this.verifierEnvironmentManager.install();
      if (result.environment && this.verifierEnvironmentManager.activate) {
        await this.verifierEnvironmentManager.activate(result.environment.id);
      }
      this.applyVerifierEnvironmentInspection(await this.verifierEnvironmentManager.inspect());
      const superseded = this.unreferencedVerifierEnvironmentIds();
      if (superseded.length > 0) {
        await this.verifierEnvironmentManager.cleanup(superseded);
        this.applyVerifierEnvironmentInspection(await this.verifierEnvironmentManager.inspect());
      }
      this.state.verifierEnvironment = {
        ...this.state.verifierEnvironment,
        status: "installed",
        installedBytes: result.installedBytes,
        error: null
      };
    } catch (error) {
      this.state.verifierEnvironment.status = priorActive ? "installed" : "installFailed";
      this.state.verifierEnvironment.error = usefulVerifierEnvironmentError(error);
    }
  }

  private async activateVerifierEnvironment(environmentId: string): Promise<void> {
    if (!this.verifierEnvironmentManager?.activate) {
      throw new Error("This application build cannot switch Verifier Environments.");
    }
    const candidate = this.state.verifierEnvironment.environments.find((entry) => entry.environment.id === environmentId);
    if (!candidate) throw new Error("The selected Verifier Environment is not installed.");
    const priorActive = this.state.verifierEnvironment.activeEnvironmentId;
    try {
      await this.verifierEnvironmentManager.activate(environmentId);
      this.applyVerifierEnvironmentInspection(await this.verifierEnvironmentManager.inspect());
      this.state.verifierEnvironment.status = "installed";
      this.state.verifierEnvironment.error = null;
    } catch (error) {
      this.state.verifierEnvironment.activeEnvironmentId = priorActive;
      this.state.verifierEnvironment.status = priorActive ? "installed" : "installFailed";
      this.state.verifierEnvironment.error = usefulVerifierEnvironmentError(error);
    }
  }

  private setVerifierEnvironmentPinned(environmentId: string, pinned: boolean): void {
    const environment = this.state.verifierEnvironment.environments.find((entry) => entry.environment.id === environmentId);
    if (!environment) throw new Error("The selected Verifier Environment is not installed.");
    environment.pinned = pinned;
  }

  private async cleanupVerifierEnvironment(): Promise<void> {
    if (!this.verifierEnvironmentManager) {
      this.state.verifierEnvironment.status = "cleanupRequired";
      this.state.verifierEnvironment.error = "The Bundled Lean Runtime cannot be managed in this application build.";
      return;
    }
    try {
      const removable = this.unreferencedVerifierEnvironmentIds();
      const result = await this.verifierEnvironmentManager.cleanup(removable);
      this.applyVerifierEnvironmentInspection(await this.verifierEnvironmentManager.inspect());
      this.state.verifierEnvironment = {
        ...this.state.verifierEnvironment,
        status: result.installed ? "installed" : "absent",
        installedBytes: result.installedBytes,
        error: null
      };
    } catch (error) {
      this.state.verifierEnvironment.status = "cleanupRequired";
      this.state.verifierEnvironment.error = usefulVerifierEnvironmentError(error);
    }
  }

  async recordClaimCheck(sessionId: string, record: ClaimCheckRecord): Promise<LearningApplicationState> {
    const session = this.requireSession(sessionId);
    const revision = claimCheckRevision(session, record.target, record.targetId);
    const claim = requireClaimVerification(revision, record.claimId);
    const method = requiredClaimCheckMethod(record.method);
    if (method === "formalVerification") {
      throw new Error("Only the Verifier Runtime may record an accepted formal statement.");
    }
    const outcome = requiredClaimCheckOutcome(record.outcome);
    const summary = requiredText(record.summary, "Claim check summary");
    const reference = validatedClaimEvidenceReference(record.evidence);
    validateClaimCheckEvidence(method, reference);
    const sourceGroundedOutcome = method === "sourceGrounded"
      ? sourceGroundedCheckOutcome(session, claim, reference) : null;
    if (sourceGroundedOutcome !== null && outcome !== sourceGroundedOutcome) {
      throw new Error(`The stored Corroboration Pass requires a ${sourceGroundedOutcome} Source-grounded outcome.`);
    }
    if ((method === "reasoningReview" || method === "independentCorroboration")
      && [...claim.claimOriginReferences, ...claim.verificationEvidence.map((item) => item.reference)]
        .some((existing) => sameClaimEvidenceReference(existing, reference))) {
      throw new Error("Independent checking must link to evidence separate from the work that produced or already checked this claim.");
    }
    if (reference.kind === "sourceAnchor") requireSourceAnchor(session, reference.sourceAnchorId);
    if (reference.kind === "researchEvidence"
      && !session.researchActions.some((research) => research.id === reference.researchActionId && research.result !== null)) {
      throw new Error("Link the claim check to completed research evidence in this Learning Session.");
    }
    if (reference.kind === "agentWork") {
      if (reference.sessionId !== session.id
        || this.getAgentWorkLogEvidence(reference.sessionId, reference.fromSequence, reference.toSequence).length === 0) {
        throw new Error("Link the claim check to recorded Agent Work in this Learning Session.");
      }
    }
    const evidence: ClaimVerificationEvidence = {
      id: crypto.randomUUID(),
      method,
      outcome,
      summary,
      limitation: method === "sourceGrounded"
        ? "Consistent with the cited source; this does not prove that the claim or source is correct."
        : null,
      reference,
      currency: "current",
      changedBecause: null,
      createdAt: new Date().toISOString()
    };
    const verificationEvidence = [...claim.verificationEvidence, evidence];
    const verificationGaps = [...claim.verificationGaps];
    if (outcome !== "supports") {
      verificationGaps.push({
        id: crypto.randomUUID(),
        reason: summary,
        affectedConclusion: claim.claimStatement,
        evidenceId: evidence.id
      });
    }
    Object.assign(claim, {
      verificationEvidence,
      verificationGaps,
      verificationCurrency: "current" as const,
      verificationLevel: currentVerificationLevel(verificationEvidence),
      verificationEscalation: escalationForEvidence(verificationEvidence, verificationGaps)
    });
    return this.publishAndPersist();
  }

  /** Adapter boundary for accepted results returned by the Verifier Runtime; this is intentionally absent from renderer IPC. */
  async recordFormalVerification(
    sessionId: string,
    receiptId: string
  ): Promise<LearningApplicationState> {
    if (!this.formalVerificationAuthority) {
      throw new Error("The Verifier Runtime is unavailable; no formal status was recorded.");
    }
    const receipt = await this.formalVerificationAuthority.resolveAcceptedReceipt(
      requiredText(receiptId, "Verifier receipt")
    );
    if (!receipt) throw new Error("The Verifier Runtime did not return an accepted receipt.");
    const revision = claimCheckRevision(this.requireSession(sessionId), receipt.target, receipt.targetId);
    const claim = requireClaimVerification(revision, receipt.claimId);
    if (requiredText(receipt.exactStatement, "Exact formal statement") !== claim.claimStatement) {
      throw new Error("The accepted formal statement must exactly match the current claim.");
    }
    const checker = requiredText(receipt.checker, "Formal checker");
    const verificationEnvironment = requiredText(receipt.verificationEnvironment, "Verification environment");
    const evidence: ClaimVerificationEvidence = {
      id: crypto.randomUUID(),
      method: "formalVerification",
      outcome: "supports",
      summary: `${checker} accepted the exact current statement.`,
      limitation: "Formal verification covers only the exact accepted statement in the recorded environment.",
      reference: { kind: "formalChecker", checker, verificationEnvironment },
      currency: "current",
      changedBecause: null,
      createdAt: new Date().toISOString()
    };
    const verificationEvidence = [...claim.verificationEvidence, evidence];
    Object.assign(claim, {
      verificationEvidence,
      verificationCurrency: "current" as const,
      verificationLevel: currentVerificationLevel(verificationEvidence),
      verificationEscalation: escalationForEvidence(verificationEvidence, claim.verificationGaps)
    });
    return this.publishAndPersist();
  }

  async runFormalVerification(
    sessionId: string,
    request: FormalVerificationRequest,
    signal?: AbortSignal
  ): Promise<LearningApplicationState> {
    const session = this.requireSession(sessionId);
    const revision = claimCheckRevision(session, request.target, request.targetId);
    const claim = requireClaimVerification(revision, request.claimId);
    const runId = requireVerifierRunId(request.runId);
    if (this.state.verifierManifests.some((manifest) => manifest.id === runId)) {
      throw new Error("Verifier run identifier has already been used.");
    }
    const formalization = formalizationForClaim(claim.claimStatement);
    const result = !formalization
      ? {
          outcome: "unsupported" as const,
          diagnostics: "This exact claim does not yet have a supported formal translation.",
          evidenceLocation: "",
          command: "",
          environment: BUNDLED_LEAN_ENVIRONMENT
        }
      : this.verifierRuntime && this.state.verifierEnvironment.status === "installed"
        ? await this.verifierRuntime.run({
            runId,
            evidenceDirectory: this.verifierEvidenceDirectory,
            ...formalization,
            environmentId: session.verifierEnvironmentPinId ?? this.state.verifierEnvironment.activeEnvironmentId ?? undefined
          }, signal)
        : {
            outcome: "unavailable" as const,
            diagnostics: this.state.verifierEnvironment.status === "absent"
              ? "The Bundled Lean Runtime was removed. Reinstall it to run formal verification; the formalization remains saved."
              : "The Bundled Lean Runtime is unavailable while its environment needs recovery; the formalization remains saved.",
            evidenceLocation: "",
            command: "",
            environment: BUNDLED_LEAN_ENVIRONMENT
          };
    const manifest: VerifierManifest = {
      id: runId,
      sessionId,
      target: request.target,
      targetId: request.targetId,
      claimId: request.claimId,
      claimRevisionId: revision.id,
      exactClaim: claim.claimStatement,
      formalStatement: formalization?.formalStatement ?? null,
      assumptions: formalization?.assumptions ?? [],
      proofSource: formalization?.proofSource ?? null,
      environment: result.environment,
      command: result.command,
      commandOutcome: result.outcome,
      formalStatementVerificationLevel: result.outcome === "accepted" && formalization ? "formallyVerified" : "incomplete",
      diagnostics: result.diagnostics,
      evidenceLocation: result.evidenceLocation || null,
      createdAt: new Date().toISOString()
    };
    this.state.verifierManifests.push(manifest);
    this.refreshVerifierManifestReferences();
    if (result.outcome === "versionMismatch") {
      this.state.verifierEnvironment.status = "cleanupRequired";
      this.state.verifierEnvironment.error = result.diagnostics;
    }
    if (result.outcome === "accepted" && formalization) {
      const priorManifestIds = new Set(this.state.verifierManifests
        .filter((candidate) => candidate.id !== manifest.id && candidate.claimRevisionId === revision.id
          && candidate.claimId === claim.claimId && candidate.formalStatement === formalization.formalStatement)
        .map((candidate) => candidate.id));
      claim.verificationGaps = claim.verificationGaps.filter((gap) => !gap.evidenceId || !priorManifestIds.has(gap.evidenceId));
      claim.verificationEscalation = escalationForEvidence(claim.verificationEvidence, claim.verificationGaps);
    } else {
      claim.verificationGaps.push({
        id: crypto.randomUUID(),
        reason: verifierOutcomeMessage(result.outcome, result.diagnostics),
        affectedConclusion: claim.claimStatement,
        evidenceId: manifest.id
      });
      claim.verificationEscalation = escalationForEvidence(claim.verificationEvidence, claim.verificationGaps);
    }
    return this.publishAndPersist();
  }

  async assessVerificationEscalation(
    sessionId: string,
    assessment: VerificationEscalationAssessment
  ): Promise<LearningApplicationState> {
    const revision = claimCheckRevision(this.requireSession(sessionId), assessment.target, assessment.targetId);
    const claim = requireClaimVerification(revision, assessment.claimId);
    if (!Array.isArray(assessment.riskFactors) || !assessment.riskFactors.every(isVerificationRiskFactor)) {
      throw new Error("Choose valid observable Verification Escalation risks.");
    }
    if (assessment.modelConfidence !== undefined
      && (typeof assessment.modelConfidence !== "number" || assessment.modelConfidence < 0 || assessment.modelConfidence > 1)) {
      throw new Error("Model confidence must be between zero and one when recorded.");
    }
    const reasons = [...new Set(assessment.riskFactors.map(verificationRiskReason))];
    const evidenceEscalation = escalationForEvidence(
      claim.verificationEvidence, claim.verificationGaps
    );
    Object.assign(claim, {
      verificationEscalation: {
        recommended: evidenceEscalation.recommended || reasons.length > 0,
        reasons: [...new Set([...evidenceEscalation.reasons, ...reasons])]
      }
    });
    return this.publishAndPersist();
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
    const verifierManifests = this.state.verifierManifests.filter((manifest) => manifest.target === "learningArtifact"
      && manifest.targetId === artifact.id);
    return {
      artifactId: artifact.id,
      originatingSessionId: artifact.originatingSessionId,
      suggestedFilename: `${filenameStem}.md`,
      mediaType: "text/markdown",
      content: [
        `# ${kindLabel}: ${artifact.title}`,
        "",
        `- Originating Learning Session: ${artifact.originatingSessionId}`,
        `- Revision action: ${artifact.currentRevision.provenance.action}`,
        `- Revision created: ${artifact.currentRevision.provenance.createdAt ?? "Unavailable for migrated revision"}`,
        "",
        "## Claims",
        "",
        ...artifact.currentRevision.claims.flatMap((claim, index) => [
          `### Claim ${index + 1}`,
          `- Exact Claim: ${claim.claimStatement}`,
          `- Claim Origin: ${claimOriginLabel(claim.claimOrigin)}`,
          `- Origin Evidence: ${claim.claimOriginReferences.map(claimEvidenceReferenceLabel).join("; ") || "No external origin reference"}`,
          `- Verification Level: ${verificationLevelLabel(claim.verificationLevel)}`,
          `- Verification Currency: ${verificationCurrencyLabel(claim.verificationCurrency)}`,
          ""
        ]),
        "",
        "## Source Anchors",
        "",
        ...anchors,
        "",
        "## Content",
        "",
        artifact.currentRevision.content,
        ...(artifact.currentRevision.claims.every((claim) => claim.verificationEvidence.length === 0) ? [] : [
          "",
          "## Verification Evidence",
          "",
          ...artifact.currentRevision.claims.flatMap((claim) => claim.verificationEvidence.flatMap((evidence) => [
            `### ${claimCheckMethodLabel(evidence.method)} · ${claimCheckOutcomeLabel(evidence.outcome)}`,
            `- Exact Claim: ${claim.claimStatement}`,
            `- Currency: ${verificationCurrencyLabel(evidence.currency)}`,
            `- Evidence link: ${claimEvidenceReferenceLabel(evidence.reference)}`,
            ...(evidence.changedBecause ? [`- Changed because: ${evidence.changedBecause}`] : []),
            ...(evidence.limitation ? [`- Limitation: ${evidence.limitation}`] : []),
            "",
            evidence.summary,
            ""
          ]))
        ]),
        ...(verifierManifests.length === 0 ? [] : [
          "",
          "## Verifier Manifests",
          "",
          ...verifierManifests.flatMap((manifest) => [
            `### Verifier Manifest ${manifest.id}`,
            `- Claim revision: ${manifest.claimRevisionId}`,
            `- Exact claim: ${manifest.exactClaim}`,
            `- Exact formal statement: ${manifest.formalStatement ?? "Unsupported translation"}`,
            `- Exact statement status: ${manifest.formalStatementVerificationLevel === "formallyVerified" ? "Formally verified" : "Incomplete"}`,
            `- Assumptions: ${manifest.assumptions.join("; ") || "None recorded"}`,
            `- Command outcome: ${manifest.commandOutcome}`,
            `- Verification Environment: ${manifest.environment.id} · Lean ${manifest.environment.leanVersion} · mathlib ${manifest.environment.mathlibVersion} · ${manifest.environment.architecture}`,
            `- Evidence location: ${manifest.evidenceLocation ?? "No proof file was produced"}`,
            "",
            manifest.diagnostics,
            ""
          ])
        ]),
        ...(artifact.currentRevision.claims.every((claim) => claim.verificationGaps.length === 0) ? [] : [
          "## Verification Gaps",
          "",
          ...artifact.currentRevision.claims.flatMap((claim) => claim.verificationGaps.flatMap((gap) => [
            `### Verification Gap ${gap.id}`,
            `- Exact Claim: ${claim.claimStatement}`,
            `- Reason: ${gap.reason}`,
            `- Affected conclusion: ${gap.affectedConclusion}`,
            ""
          ]))
        ]),
        ...(artifact.currentRevision.claims.some((claim) => claim.verificationEscalation.recommended) ? [
          "## Verification Escalation recommended",
          "",
          ...artifact.currentRevision.claims.flatMap((claim) => claim.verificationEscalation.recommended
            ? claim.verificationEscalation.reasons.map((reason) => `- ${claim.claimStatement}: ${reason}`) : []),
          ""
        ] : []),
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
    do {
      await Promise.all([...this.modelWorks.values()].map((work) => work.promise));
      await Promise.all([...this.researchWorks.values()].map((work) => work.promise));
      await this.persistence;
    } while (this.modelWorks.size > 0 || this.researchWorks.size > 0);
  }

  async shutdown(): Promise<void> {
    for (const session of this.state.sessions) {
      for (const request of session.accessRequests) {
        if (request.status !== "pending") continue;
        request.status = "denied";
        this.resolveAccessDecision(request.id, { status: "denied", policy: session.accessPolicy });
      }
    }
    for (const [researchActionId, work] of this.researchWorks) {
      work.controller.abort();
      const research = this.state.sessions.flatMap((session) => session.researchActions)
        .find((candidate) => candidate.id === researchActionId);
      if (research?.status === "running") {
        research.status = "stopped";
        research.error = "External research stopped when the application closed. Start it again explicitly after relaunch.";
      }
    }
    const activeWorks = [...this.modelWorks.entries()];
    for (const [, work] of activeWorks) {
      (work.checkpointForShutdown ?? work.stop)();
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
      case "offerUnderstandingCheck": {
        const session = this.requireActiveSession();
        if (!canOfferUnderstandingCheck(session)) {
          throw new Error("Complete a substantive Teaching Card before offering an Understanding Check.");
        }
        if (!isUnderstandingCheckKind(action.kind)) throw new Error("Choose a reasoning-focused Understanding Check.");
        const representation = requireTeachingRoute(action.representation);
        const sourceAnchorId = action.sourceAnchorId ?? session.activeSourceAnchorId;
        if (sourceAnchorId) requireSourceAnchor(session, sourceAnchorId);
        if (session.understandingChecks.some((check) => check.status === "offered")) {
          throw new Error("Respond to or skip the current Understanding Check before offering another.");
        }
        const sourceIds = sourceAnchorId
          ? [requireSourceAnchor(session, sourceAnchorId).sourceId]
          : [...session.sourceIds];
        session.understandingChecks.push({
          id: crypto.randomUUID(),
          kind: action.kind,
          prompt: requiredText(action.prompt, "Understanding Check prompt"),
          concept: requiredName(action.concept, "Understanding Check concept"),
          representation,
          sourceContext: { sourceAnchorId: sourceAnchorId ?? null, sourceIds },
          evidenceTransferContext: action.evidenceTransferContext
            ? validatedEvidenceTransferContext(action.evidenceTransferContext) : null,
          teachingMoveId: session.currentTeachingMove.id,
          status: "offered"
        });
        break;
      }
      case "skipUnderstandingCheck": {
        const session = this.requireActiveSession();
        const check = requireUnderstandingCheck(session, action.checkId);
        if (check.status !== "offered") throw new Error("This Understanding Check was already completed or skipped.");
        check.status = "skipped";
        break;
      }
      case "recordUnderstandingEvidence": {
        const session = this.requireActiveSession();
        const check = requireUnderstandingCheck(session, action.checkId);
        if (check.status !== "offered") throw new Error("This Understanding Check was already completed or skipped.");
        const interpretation = requireUnderstandingInterpretation(action.interpretation);
        const evidence: UnderstandingEvidence = {
          id: crypto.randomUUID(),
          checkId: check.id,
          response: requiredText(action.response, "Understanding Check response"),
          concept: check.concept,
          task: session.sessionTarget,
          representation: check.representation,
          sourceContext: structuredClone(check.sourceContext),
          evidenceTransferContext: check.evidenceTransferContext
            ? structuredClone(check.evidenceTransferContext) : null,
          elicitingTeachingMoveId: check.teachingMoveId,
          interpretation,
          learnerCorrection: null
        };
        check.status = "answered";
        session.understandingEvidence.push(evidence);
        this.state.learnerModel.entries.push(understandingEvidenceLedgerEntry(
          session,
          evidence,
          requireLearnerModelConfidence(action.confidence ?? "medium")
        ));
        setAdaptiveTeachingMove(session, evidence, "Understanding Evidence indicates");
        upsertUnderstandingEvidenceTrailItem(session, evidence);
        break;
      }
      case "startTeachingExperiment": {
        const session = this.requireActiveSession();
        if (session.teachingExperiments.some((experiment) => experiment.status === "active")) {
          throw new Error("Complete the active Teaching Experiment before starting another route.");
        }
        const route = requireTeachingRoute(action.route);
        const latestEvidence = session.understandingEvidence.at(-1) ?? null;
        const experiment: TeachingExperiment = {
          id: crypto.randomUUID(),
          route,
          reason: requiredText(action.reason, "Teaching Experiment reason"),
          context: {
            concept: latestEvidence?.concept ?? session.learningGoal,
            task: latestEvidence?.task ?? session.sessionTarget
          },
          evidenceIds: latestEvidence ? [latestEvidence.id] : [],
          status: "active",
          outcome: null
        };
        session.teachingExperiments.push(experiment);
        appendTeachingMove(session, {
          kind: teachingMoveKindForRoute(route),
          route,
          reason: `Teaching Experiment: ${experiment.reason}`,
          evidenceIds: experiment.evidenceIds,
          experimentId: experiment.id
        });
        break;
      }
      case "completeTeachingExperiment": {
        const session = this.requireActiveSession();
        const experiment = session.teachingExperiments.find((candidate) => candidate.id === action.experimentId);
        if (!experiment || experiment.status !== "active") throw new Error("Choose an active Teaching Experiment.");
        if (!isTeachingExperimentOutcome(action.outcome)) throw new Error("Choose the Teaching Experiment outcome.");
        experiment.status = "completed";
        experiment.outcome = action.outcome;
        const preference: InteractionPreference = {
          id: crypto.randomUUID(),
          route: experiment.route,
          context: structuredClone(experiment.context),
          status: interactionPreferenceStatus(action.outcome),
          evidenceIds: [...experiment.evidenceIds],
          experimentId: experiment.id
        };
        session.interactionPreferences.push(preference);
        this.state.learnerModel.entries.push(interactionPreferenceLedgerEntry(session, preference, action.outcome));
        appendTeachingMove(session, {
          kind: teachingMoveKindForRoute(experiment.route),
          route: experiment.route,
          reason: `The ${experiment.route} Teaching Experiment was ${teachingExperimentOutcomeLabel(action.outcome)} for this context.`,
          evidenceIds: experiment.evidenceIds,
          experimentId: experiment.id
        });
        break;
      }
      case "correctUnderstandingEvidence": {
        const session = this.requireActiveSession();
        const evidence = session.understandingEvidence.find((candidate) => candidate.id === action.evidenceId);
        if (!evidence) throw new Error("Choose Understanding Evidence from the active Learning Session.");
        evidence.interpretation = requireUnderstandingInterpretation(action.interpretation);
        evidence.learnerCorrection = requiredText(action.correction, "Understanding Evidence correction");
        for (const entry of this.state.learnerModel.entries.filter(
          (candidate) => candidate.sourceEvidence.evidenceIds.includes(evidence.id)
        )) {
          const timestamp = new Date().toISOString();
          entry.status = "corrected";
          entry.correction = evidence.learnerCorrection;
          entry.lastUpdatedAt = timestamp;
          entry.governanceHistory.push({
            id: crypto.randomUUID(), action: "corrected", note: evidence.learnerCorrection, at: timestamp
          });
        }
        setAdaptiveTeachingMove(session, evidence, "The learner corrected this Understanding Evidence; it now indicates");
        upsertUnderstandingEvidenceTrailItem(session, evidence);
        break;
      }
      case "correctLearnerModelInference": {
        const entry = requireLearnerModelEntry(this.state.learnerModel, action.entryId);
        const timestamp = new Date().toISOString();
        entry.status = "corrected";
        entry.correction = requiredText(action.correction, "Learner Model correction");
        entry.lastUpdatedAt = timestamp;
        entry.governanceHistory.push({ id: crypto.randomUUID(), action: "corrected", note: entry.correction, at: timestamp });
        break;
      }
      case "excludeLearnerModelInference": {
        const entry = requireLearnerModelEntry(this.state.learnerModel, action.entryId);
        const timestamp = new Date().toISOString();
        entry.status = "excluded";
        entry.lastUpdatedAt = timestamp;
        entry.governanceHistory.push({ id: crypto.randomUUID(), action: "excluded", note: null, at: timestamp });
        break;
      }
      case "deleteLearnerModelInference": {
        requireLearnerModelEntry(this.state.learnerModel, action.entryId);
        this.state.learnerModel.entries = this.state.learnerModel.entries
          .filter((entry) => entry.id !== action.entryId);
        break;
      }
      case "resetLearnerModel": {
        this.state.learnerModel.entries = [];
        this.state.learnerModel.lastResetAt = new Date().toISOString();
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
      case "editTeachingCardClaims": {
        const session = this.requireActiveSession();
        const card = requireAnchoredTeachingCard(session, action.cardId);
        if (card.currentRevision.status === "streaming") {
          throw new Error("Wait for the current Teaching Card revision to finish.");
        }
        const previous = structuredClone(card.currentRevision);
        const revisionId = crypto.randomUUID();
        card.revisions.push(previous);
        card.currentRevision = {
          ...previous,
          id: revisionId,
          claims: curatedClaimEdits(previous.claims ?? [], action.claimEdits, revisionId, "Teaching Card")
        };
        session.activeTeachingCardId = card.id;
        session.activeSourceAnchorId = card.sourceAnchorId;
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
          const revisionId = crypto.randomUUID();
          const artifact: LearningArtifact = {
            id: crypto.randomUUID(),
            title: card.title,
            kind: action.artifactKind ?? "learningArtifact",
            originatingSessionId: session.id,
            currentRevision: {
              id: revisionId,
              content: card.currentRevision.content,
              claims: card.currentRevision.claims?.length
                ? structuredClone(card.currentRevision.claims)
                : [claimVerificationFrom(card.currentRevision, revisionId, card.currentRevision.content)],
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
        const synthesisFromSequence = log.length + 1;
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
        const synthesisOriginReferences: ClaimEvidenceReference[] = [
          ...artifact.currentRevision.claims.flatMap((claim) => claim.claimOriginReferences),
          ...(log.length >= synthesisFromSequence ? [{
            kind: "agentWork" as const,
            sessionId: session.id,
            fromSequence: synthesisFromSequence,
            toSequence: log.length
          }] : [])
        ];
        const interpretations = new Map(synthesized.noteInterpretations.map((item) => [item.annotationId, item.interpretation]));
        artifact.revisions.push(structuredClone(artifact.currentRevision));
        const synthesizedRevisionId = crypto.randomUUID();
        artifact.currentRevision = {
          id: synthesizedRevisionId,
          content: synthesized.content,
          claims: [{
            claimId: synthesizedRevisionId,
            claimStatement: synthesized.content,
            claimOrigin: personalNotes.length > 0 || artifact.currentRevision.claims.some(
              (claim) => claim.claimOrigin !== "modelGenerated"
            ) ? "mixed" : "modelGenerated",
            claimOriginReferences: structuredClone(synthesisOriginReferences),
            ...staleVerificationState(
              combinedClaimVerification(artifact.currentRevision.claims),
              "Artifact synthesis changed the mathematical claim."
            )
          }],
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
        const claimEditsChanged = action.claimEdits !== undefined && (
          action.claimEdits.length !== artifact.currentRevision.claims.length
          || action.claimEdits.some((edit, index) => edit.claimId !== artifact.currentRevision.claims[index]?.claimId
            || edit.statement.trim() !== artifact.currentRevision.claims[index]?.claimStatement)
        );
        if (content === artifact.currentRevision.content && !claimEditsChanged) break;
        artifact.revisions.push(structuredClone(artifact.currentRevision));
        const editedRevisionId = crypto.randomUUID();
        artifact.currentRevision = {
          id: editedRevisionId,
          content,
          claims: editedArtifactClaims(
            artifact.currentRevision.claims, content, action, editedRevisionId,
            content !== artifact.currentRevision.content
          ),
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
        const transferConcepts = delayedTransferConcepts(session);
        const delayedTransferContextKey = `delayed-transfer-context:${session.id}`;
        if (targetDisposition === "addressed" && transferConcepts.length > 0
          && !session.trailDraft.items.some((item) => item.curationKey === delayedTransferContextKey)) {
          session.trailDraft.items.push({
            id: crypto.randomUUID(),
            kind: "reasoningStep",
            content: [
              draft.centralInsight,
              `Transfer concepts: ${transferConcepts.join(", ")}.`,
              `Intended next step: ${draft.nextStep}`
            ].join(" "),
            required: false,
            origin: "teachingAgent",
            links: { sourceAnchorIds: [], teachingCardIds: [], learningArtifactIds: [], understandingEvidenceIds: [] },
            curationKey: delayedTransferContextKey
          });
        }
        session.consolidatedOutcome = {
          id: crypto.randomUUID(),
          ...structuredClone(draft),
          targetDisposition,
          trailItems: structuredClone(session.trailDraft.items)
        };
        if (targetDisposition === "addressed" && session.delayedTransferOffer === null
          && transferConcepts.length > 0) {
          const offeredAt = new Date().toISOString();
          session.delayedTransferOffer = {
            status: "pending",
            offeredAt,
            proposedDueAt: new Date(Date.parse(offeredAt) + 7 * 24 * 60 * 60 * 1_000).toISOString()
          };
        }
        session.consolidationDraft = null;
        session.status = "consolidated";
        session.activityOrder = this.nextActivityOrder();
        this.state.activeSessionId = null;
        this.state.resumeSessionId = this.latestPausedSessionId(session.id);
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "dashboard";
        break;
      }
      case "declineDelayedTransfer":
      case "dismissDelayedTransfer": {
        const session = this.requirePendingDelayedTransferOffer(action.sessionId);
        session.delayedTransferOffer!.status = action.type === "declineDelayedTransfer" ? "declined" : "dismissed";
        break;
      }
      case "scheduleDelayedTransfer": {
        const session = this.requireSession(action.sessionId);
        if (this.state.delayedTransferChecks.some((check) =>
          check.relatedSessionId === session.id && check.status === "scheduled")) {
          throw new Error("This addressed Session Target already has a Delayed Transfer Check.");
        }
        this.requirePendingDelayedTransferOffer(action.sessionId);
        const timestamp = new Date().toISOString();
        const dueAt = requiredFutureIsoDate(action.dueAt, "Delayed Transfer due time", timestamp);
        this.state.delayedTransferChecks.push({
          id: crypto.randomUUID(),
          relatedSessionId: session.id,
          relatedLearningSessionGoal: session.learningGoal,
          originatingSessionTarget: session.sessionTarget,
          originatingConcepts: delayedTransferConcepts(session),
          intendedTransferGoal: requiredText(action.intendedTransferGoal, "Intended transfer goal"),
          scheduledAt: timestamp,
          updatedAt: timestamp,
          dueAt,
          status: "scheduled",
          relevantSourceAnchorId: null,
          relevantTrailItemId: session.consolidatedOutcome?.trailItems.find((item) =>
            item.curationKey === `delayed-transfer-context:${session.id}`)?.id ?? null,
          task: null,
          taskError: null,
          draft: emptyDelayedTransferDraft(),
          evidence: null,
          result: null
        });
        session.delayedTransferOffer!.status = "scheduled";
        break;
      }
      case "rescheduleDelayedTransfer": {
        const check = this.requireScheduledDelayedTransferCheck(action.checkId);
        const timestamp = new Date().toISOString();
        check.dueAt = requiredFutureIsoDate(action.dueAt, "Delayed Transfer due time", timestamp);
        check.updatedAt = timestamp;
        break;
      }
      case "cancelDelayedTransfer": {
        const check = this.requireScheduledDelayedTransferCheck(action.checkId);
        check.status = "cancelled";
        check.updatedAt = new Date().toISOString();
        const session = this.requireSession(check.relatedSessionId);
        if (session.delayedTransferOffer?.status === "scheduled") {
          session.delayedTransferOffer.status = "cancelled";
        }
        if (!this.state.delayedTransferChecks.some((candidate) => candidate.status === "scheduled")) {
          this.state.screen = "dashboard";
        }
        break;
      }
      case "startDelayedTransferCheck": {
        const check = this.requireScheduledDelayedTransferCheck(action.checkId);
        const timestamp = new Date().toISOString();
        if (Date.parse(check.dueAt) > Date.parse(timestamp)) {
          throw new Error("This Delayed Transfer Check is not due yet.");
        }
        this.requireModelAccess();
        const origin = this.requireSession(check.relatedSessionId);
        check.status = "preparing";
        check.taskError = null;
        check.updatedAt = timestamp;
        await this.publishAndPersist();
        if (check.status !== "preparing") break;
        try {
          const task = await this.runDelayedTransferModelWork(check.id, (signal, onRuntimeEvent) =>
            this.modelRuntime!.createDelayedTransferTask({
              checkId: check.id,
              originatingSessionId: origin.id,
              originatingLearningGoal: origin.learningGoal,
              originatingSessionTarget: origin.sessionTarget,
              originatingConcepts: [...check.originatingConcepts],
              intendedTransferGoal: check.intendedTransferGoal,
              originatingMathematics: origin.mathematics,
              signal,
              onRuntimeEvent
            }));
          if ((check.status as DelayedTransferCheck["status"]) === "stopping") {
            check.status = "scheduled";
            check.taskError = null;
            check.updatedAt = new Date().toISOString();
            break;
          }
          if (check.status !== "preparing") break;
          check.task = validatedDelayedTransferTask(
            task,
            origin.mathematics,
            origin.evidenceTransferContext,
            check.originatingConcepts
          );
          check.taskError = null;
          check.status = "inProgress";
          check.updatedAt = timestamp;
          this.state.activeDelayedTransferCheckId = check.id;
          this.state.screen = "delayedTransfer";
        } catch (error) {
          if ((check.status as DelayedTransferCheck["status"]) === "stopping") {
            check.status = "scheduled";
            check.taskError = null;
            check.updatedAt = new Date().toISOString();
          } else if (check.status === "preparing") {
            check.status = "scheduled";
            check.taskError = usefulRuntimeError(error);
            this.recordModelAccessLoss(error);
          }
        }
        break;
      }
      case "cancelDelayedTransferPreparation": {
        const check = this.state.delayedTransferChecks.find((candidate) => candidate.id === action.checkId);
        if (!check || (check.status !== "preparing" && check.status !== "stopping")) {
          throw new Error("Choose a Delayed Transfer task that is being prepared.");
        }
        check.status = "stopping";
        check.taskError = null;
        check.updatedAt = new Date().toISOString();
        await this.publishAndPersist();
        const work = this.modelWorks.get(check.id);
        work?.controller.abort();
        if (work) {
          try {
            await this.modelRuntime?.cancelTeaching(check.id);
          } catch (error) {
            if (this.modelWorks.has(check.id)) {
              check.taskError = `Quick Study could not confirm that task preparation stopped. Retry the stop action. ${usefulRuntimeError(error)}`;
              check.updatedAt = new Date().toISOString();
              this.recordModelAccessLoss(error);
              await this.publishAndPersist();
              throw new Error(check.taskError);
            }
          }
        }
        if (check.status === "stopping") {
          check.status = "scheduled";
          check.taskError = null;
          check.updatedAt = new Date().toISOString();
        }
        break;
      }
      case "saveDelayedTransferDraft": {
        const check = this.requireInProgressDelayedTransferCheck(action.checkId);
        check.draft = {
          ...check.draft,
          work: action.work.trim(),
          reasoning: action.reasoning.trim(),
          confidence: requiredDelayedTransferConfidence(action.confidence)
        };
        check.updatedAt = new Date().toISOString();
        break;
      }
      case "requestDelayedTransferClarification": {
        const check = this.requireInProgressDelayedTransferCheck(action.checkId);
        this.requireModelAccess();
        const question = requiredText(action.question, "Delayed Transfer clarification question");
        try {
          const response = requiredText(await this.runDelayedTransferModelWork(check.id, (signal, onRuntimeEvent) =>
            this.modelRuntime!.clarifyDelayedTransferTask({
              checkId: check.id,
              task: check.task!,
              question,
              signal,
              onRuntimeEvent
            })), "Delayed Transfer clarification");
          check.draft.clarifications.push({ question, response, requestedAt: new Date().toISOString() });
          check.updatedAt = new Date().toISOString();
        } catch (error) {
          this.recordModelAccessLoss(error);
          throw error;
        }
        break;
      }
      case "completeDelayedTransferCheck": {
        const check = this.requireInProgressDelayedTransferCheck(action.checkId);
        if (!check.draft.work && !check.draft.reasoning) {
          throw new Error("Add work or explain your reasoning before completing this Delayed Transfer Check.");
        }
        this.requireModelAccess();
        let assessment: DelayedTransferAssessment;
        try {
          assessment = validatedDelayedTransferAssessment(await this.runDelayedTransferModelWork(
            check.id,
            (signal, onRuntimeEvent) => this.modelRuntime!.assessDelayedTransferWork({
              checkId: check.id,
              task: check.task!,
              work: check.draft.work,
              reasoning: check.draft.reasoning,
              confidence: check.draft.confidence,
              clarifications: check.draft.clarifications.map(({ question, response }) => ({ question, response })),
              signal,
              onRuntimeEvent
            })
          ));
        } catch (error) {
          this.recordModelAccessLoss(error);
          throw error;
        }
        const completedAt = new Date().toISOString();
        const evidence: DelayedTransferEvidence = {
          id: crypto.randomUUID(),
          checkId: check.id,
          originatingSessionId: check.relatedSessionId,
          dueAt: check.dueAt,
          completedAt,
          scheduledDelayMs: Date.parse(check.dueAt) - Date.parse(check.scheduledAt),
          completionDelayMs: Math.max(0, Date.parse(completedAt) - Date.parse(check.dueAt)),
          task: structuredClone(check.task!),
          mathematicalContext: structuredClone(check.task!.mathematicalContext),
          work: check.draft.work,
          reasoning: check.draft.reasoning,
          confidence: check.draft.confidence,
          assistanceUsed: check.draft.clarifications.length > 0,
          result: assessment.result,
          reasoningQuality: assessment.reasoningQuality,
          confidenceCalibration: assessment.confidenceCalibration,
          misconceptionOrStrength: assessment.misconceptionOrStrength,
          recommendedNextAction: assessment.recommendedNextAction
        };
        check.evidence = evidence;
        check.result = {
          evidenceId: evidence.id,
          refresherOffer: assessment.refresherGoal ? {
            status: "pending",
            goal: assessment.refresherGoal,
            refresherSessionId: null
          } : null
        };
        check.status = "completed";
        check.updatedAt = completedAt;
        const origin = this.requireSession(check.relatedSessionId);
        this.state.learnerModel.entries.push(delayedTransferLedgerEntry(origin, check, evidence));
        break;
      }
      case "skipDelayedTransferCheck":
      case "dismissDueDelayedTransferCheck": {
        const check = this.requireDueDelayedTransferCheck(action.checkId);
        check.status = action.type === "skipDelayedTransferCheck" ? "skipped" : "dismissed";
        check.updatedAt = new Date().toISOString();
        if (this.state.activeDelayedTransferCheckId === check.id) {
          this.state.activeDelayedTransferCheckId = null;
        }
        this.state.screen = "dashboard";
        break;
      }
      case "acceptDelayedTransferRefresher": {
        const check = this.requirePendingRefresherOffer(action.checkId);
        const origin = this.requireSession(check.relatedSessionId);
        if (this.state.activeSessionId) {
          const active = this.requireSession(this.state.activeSessionId);
          if (this.modelWorks.has(active.id) && !await this.stopModelWork(active)) {
            throw new Error("Codex did not confirm interruption. The active Learning Session remains open.");
          }
          this.pauseActiveSession();
        }
        const offer = check.result!.refresherOffer!;
        const relevantSourceAnchor = check.relevantSourceAnchorId
          ? origin.sourceAnchors.find((anchor) => anchor.id === check.relevantSourceAnchorId) ?? null
          : null;
        const refresher = createLearningSession({
          id: crypto.randomUUID(),
          workspaceId: origin.workspaceId,
          missionId: origin.missionId,
          mathematics: origin.mathematics,
          sourceIds: [...origin.sourceIds],
          learningGoal: offer.goal,
          sessionTarget: offer.goal,
          status: "active",
          activityOrder: this.nextActivityOrder(),
          returnContext: {
            label: `Refresher for ${origin.sessionTarget}`,
            nextAction: check.evidence!.recommendedNextAction
          },
          proposal: {
            scope: offer.goal,
            initialTeachingDirection: check.evidence!.recommendedNextAction,
            status: "accepted",
            confirmationReason: null
          },
          currentTeachingInput: { kind: "sessionIntake", text: check.evidence!.recommendedNextAction },
          accessPolicy: origin.accessPolicy,
          sourceAnchors: relevantSourceAnchor ? [structuredClone(relevantSourceAnchor)] : [],
          activeSourceAnchorId: relevantSourceAnchor?.id ?? null,
          refresherOf: {
            checkId: check.id,
            evidenceId: check.evidence!.id,
            originatingSessionId: origin.id,
            sourceAnchorId: check.relevantSourceAnchorId,
            trailItemId: check.relevantTrailItemId
          }
        });
        this.state.sessions.push(refresher);
        offer.status = "accepted";
        offer.refresherSessionId = refresher.id;
        this.state.activeDelayedTransferCheckId = null;
        this.state.activeSessionId = refresher.id;
        this.state.resumeSessionId = refresher.id;
        this.state.navigation = { workspaceId: refresher.workspaceId, missionId: refresher.missionId };
        this.state.screen = "workbench";
        refreshAskBarContext(this.state, refresher);
        break;
      }
      case "declineDelayedTransferRefresher": {
        const check = this.requirePendingRefresherOffer(action.checkId);
        check.result!.refresherOffer!.status = "declined";
        check.updatedAt = new Date().toISOString();
        this.state.activeDelayedTransferCheckId = null;
        this.state.screen = "dashboard";
        break;
      }
      case "openDelayedTransferCheck": {
        const check = this.state.delayedTransferChecks.find((candidate) => candidate.id === action.checkId);
        if (!check || (check.status !== "inProgress" && check.status !== "completed")) {
          throw new Error("Choose an active or completed Delayed Transfer Check.");
        }
        this.state.activeDelayedTransferCheckId = check.id;
        this.state.screen = "delayedTransfer";
        break;
      }
      case "closeDelayedTransferCheck": {
        this.state.activeDelayedTransferCheckId = null;
        this.state.screen = "dashboard";
        break;
      }
      case "openFollowUpQueue": {
        if (!this.state.delayedTransferChecks.some((check) =>
          !["cancelled", "skipped", "dismissed"].includes(check.status))) {
          throw new Error("Schedule a Delayed Transfer Check before opening the Follow-up Queue.");
        }
        this.state.screen = "followUps";
        break;
      }
      case "closeFollowUpQueue": {
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
        session.ignoreLearnerModel = action.ignoreLearnerModel ?? false;
        refreshAskBarContext(this.state, session);
        this.state.sessions.push(session);
        this.state.activeSessionId = session.id;
        this.state.resumeSessionId = session.id;
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "workbench";
        await this.beginAutomaticCorroboration(session);
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
          this.attachQualifiedLearnerModelGuidance(selectedSession, proposal.evidenceTransferContext ?? null);
          this.agentWorkLogs[selectedSession.id] = pendingLog;
          delete this.agentWorkLogs[proposalAttemptId];
          this.state.activeSessionId = selectedSession.id;
          this.state.resumeSessionId = selectedSession.id;
          this.state.navigation = { workspaceId: selectedSession.workspaceId, missionId: selectedSession.missionId };
          this.state.screen = "workbench";
          await this.beginAutomaticCorroboration(selectedSession);
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
        session.ignoreLearnerModel = action.ignoreLearnerModel ?? false;
        this.attachQualifiedLearnerModelGuidance(session, proposal.evidenceTransferContext ?? null);
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
      case "resumeAgentTask": {
        const session = this.state.sessions.find((candidate) => candidate.agentTasks.some(
          (task) => task.id === action.taskId
        ));
        const task = session?.agentTasks.find((candidate) => candidate.id === action.taskId);
        if (!session || !task) throw new Error("Choose a checkpointed Agent Task.");
        if (!task.resumeAvailable) throw new Error("This Agent Task has no checkpoint ready to resume.");
        if (session.status === "consolidated") throw new Error("A consolidated Learning Session cannot resume model work.");
        if (this.modelWorks.has(session.id)) throw new Error("Wait for the current model work before resuming this Agent Task.");
        this.requireModelAccess();
        this.pauseActiveSession();
        session.status = "active";
        session.activityOrder = this.nextActivityOrder();
        session.activeAgentTaskId = task.id;
        this.state.activeSessionId = session.id;
        this.state.resumeSessionId = session.id;
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "workbench";
        refreshAskBarContext(this.state, session);
        this.beginSpecialistAgentTask(session, task, true);
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
      case "setSourceExcerptEgressPreference": {
        this.state.sourceExcerptEgressPreference.enabled = action.enabled;
        break;
      }
      case "setAdaptiveReusePreference": {
        this.state.learnerModel.adaptiveReuseEnabled = action.enabled;
        break;
      }
      case "setSessionLearnerModelIgnored": {
        this.requireActiveSession().ignoreLearnerModel = action.ignored;
        break;
      }
      case "removeVerifierEnvironment": {
        await this.serializeVerifierEnvironment(() => this.removeVerifierEnvironment());
        break;
      }
      case "installVerifierEnvironment": {
        await this.serializeVerifierEnvironment(() => this.installVerifierEnvironment());
        break;
      }
      case "activateVerifierEnvironment": {
        await this.serializeVerifierEnvironment(() => this.activateVerifierEnvironment(action.environmentId));
        break;
      }
      case "setVerifierEnvironmentPinned": {
        await this.serializeVerifierEnvironment(async () => {
          this.setVerifierEnvironmentPinned(action.environmentId, action.pinned);
        });
        break;
      }
      case "setSessionVerifierEnvironmentPin": {
        await this.serializeVerifierEnvironment(async () => {
          const session = this.requireSession(action.sessionId);
          if (action.environmentId !== null && !this.state.verifierEnvironment.environments
            .some((entry) => entry.environment.id === action.environmentId)) {
            throw new Error("The selected Verifier Environment is not installed.");
          }
          session.verifierEnvironmentPinId = action.environmentId;
        });
        break;
      }
      case "cleanupVerifierEnvironment": {
        await this.serializeVerifierEnvironment(() => this.cleanupVerifierEnvironment());
        break;
      }
      case "setResearchEgressPermission": {
        const session = this.requireActiveSession();
        session.researchEgressPermission = { status: action.enabled ? "granted" : "revoked" };
        if (!action.enabled) this.stopSessionExcerptResearch(
          session,
          "Research Egress Permission for Source Excerpts was revoked. No retry was attempted."
        );
        break;
      }
      case "cancelExternalResearch": {
        const session = this.requireActiveSession();
        const research = session.researchActions.find((candidate) => candidate.id === action.researchActionId);
        if (!research || research.status !== "running") throw new Error("Choose active external research to stop.");
        this.stopResearch(research, "External research was stopped by the learner. No retry was attempted.");
        break;
      }
      case "researchWeb": {
        const session = this.requireActiveSession();
        const query = buildDerivedResearchQuery(action.query);
        const destination = researchDestination(query);
        const researchAction: ResearchAction = {
          id: crypto.randomUUID(),
          accessPolicy: session.accessPolicy,
          query,
          queryOrigin: "learnerAuthored",
          researchDepth: "lightweight",
          informedBySourceIds: [],
          destination,
          excerpts: [],
          status: "running",
          result: null,
          error: null
        };
        session.researchActions.push(researchAction);
        const sourceAnchorIds = [...new Set(action.sourceAnchorIds)];
        if (sourceAnchorIds.length > 0) {
          if (!this.state.sourceExcerptEgressPreference.enabled
            || session.researchEgressPermission.status !== "granted") {
            researchAction.status = "denied";
            researchAction.error = "Source Excerpt Egress was denied. The Derived Research Query was not sent.";
            break;
          }
          const authorizedSourceIds = new Set(this.getSessionAccessScope(session.id).sourceIds);
          try {
            researchAction.excerpts = sourceAnchorIds.map((sourceAnchorId) => {
              const anchor = requireSourceAnchor(session, sourceAnchorId);
              if (!authorizedSourceIds.has(anchor.sourceId)) {
                throw new Error("The active Session Access Policy does not allow this source to inform external research.");
              }
              if (anchor.selection.kind === "diagramRegion") {
                throw new Error("Choose an inspectable text or equation excerpt for external research.");
              }
              if (!anchor.selection.prefix && !anchor.selection.suffix) {
                throw new Error("Whole-file transmission requires a separate explicit confirmation and is not available from Source Excerpt Egress.");
              }
              if (anchor.selection.exactText.length > 2_000) {
                throw new Error("Choose a Source Excerpt of at most 2,000 characters for external research.");
              }
              return {
                sourceId: anchor.sourceId,
                kind: anchor.selection.pageNumbers
                  ? "selectedPages" as const
                  : anchor.selection.kind === "equation" ? "equation" as const : "excerpt" as const,
                content: anchor.selection.exactText,
                location: anchor.selection.pageNumbers
                  ? `Selected pages ${anchor.selection.pageNumbers.join(", ")}: characters ${anchor.selection.startOffset}–${anchor.selection.endOffset}`
                  : `${anchor.selection.kind === "equation" ? `Equation ${anchor.selection.equationIndex + 1}` : "Text"}: characters ${anchor.selection.startOffset}–${anchor.selection.endOffset}`,
                relevance: "learnerSelectedForQuery" as const
              };
            });
          } catch (error) {
            researchAction.status = "denied";
            researchAction.error = error instanceof Error ? error.message : "Source Excerpt Egress was denied.";
            break;
          }
          researchAction.destination = researchDestination(query, researchAction.excerpts);
        }
        if (!this.externalResearch) {
          researchAction.status = "failed";
          researchAction.error = "External research is unavailable. Local work and model access remain unchanged.";
          break;
        }
        void this.beginExternalResearch(researchAction);
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
        bindTeachingClaim(revision, anchor);
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

  private beginSpecialistAgentTask(session: LearningSession, task: AgentTask, resumeFromCheckpoint = false): void {
    this.requireModelAccess();
    const log = this.agentWorkLogs[session.id] ??= [];
    const controller = new AbortController();
    const runtime = this.modelRuntime!;
    task.status = "working";
    task.statusMessage = null;
    task.resumeAvailable = false;
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
    const activeUsageAccounts = new Set<() => void>();
    const coordinated = task.specialistBriefs.map((storedBrief, index) => ({
      id: `${task.id}:${index}`,
      dependsOnTaskIds: task.coordination === "dependent" && index > 0 ? [`${task.id}:${index - 1}`] : [],
      run: async () => {
        const progress = task.specialistProgress[index];
        if (progress.status === "complete" || progress.status === "retained") return;
        const retainedSpecialistCheckpoint = progress.checkpoint;
        const brief = structuredClone(storedBrief);
        if (retainedSpecialistCheckpoint) {
          brief.constraints.push(
            `Continue from this retained checkpoint without repeating it: ${retainedSpecialistCheckpoint}`
          );
        }
        if (task.coordination === "dependent" && index > 0) {
          const prior = task.specialistProgress[index - 1].result;
          if (!prior) throw new Error("Dependent Specialist Agent work is missing its prerequisite result.");
          brief.constraints.push(`Earlier Specialist Agent conclusion: ${prior.content}`);
        }
        const totalTokenBudget = specialistTokenBudget(task);
        const totalLatencyBudget = specialistLatencyBudget(task);
        const remainingTokens = totalTokenBudget - progress.usedTokens;
        const remainingLatencyMs = totalLatencyBudget - progress.usedLatencyMs;
        if (remainingTokens < 1) throw new Error("Specialist Agent reached its token budget before resumption.");
        if (remainingLatencyMs < 1) throw new Error("Specialist Agent reached its latency budget before resumption.");
        const perAgentBudget: AgentBudget = {
          ...structuredClone(task.budget),
          agentCount: 1,
          concurrency: 1,
          maxTokens: remainingTokens,
          maxLatencyMs: remainingLatencyMs
        };
        progress.status = "working";
        const tokenUsageAtStart = progress.usedTokens;
        let lastAccountedAt = Date.now();
        const accountLatency = () => {
          const now = Date.now();
          progress.usedLatencyMs += Math.max(0, now - lastAccountedAt);
          lastAccountedAt = now;
        };
        activeUsageAccounts.add(accountLatency);
        let result: SpecialistAgentResult;
        try {
          result = await runtime.runSpecialistAgent({
            sessionId: session.id,
            purpose: index === 0 ? task.purpose : "Stress-test the current Teaching Card for a counterexample or boundary case",
            brief,
            budget: perAgentBudget,
            signal: controller.signal,
            onStatus: (status, message) => {
              if (controller.signal.aborted) return;
              accountLatency();
              progress.status = status;
              const unfinished = task.specialistProgress.filter((candidate) =>
                candidate.status !== "complete" && candidate.status !== "retained");
              task.status = unfinished.length > 0 && unfinished.every((candidate) => candidate.status === "waiting")
                ? "waiting"
                : "working";
              task.statusMessage = message;
              this.emitState();
              this.queuePersistence();
            },
            onPartialResult: (content) => {
              if (controller.signal.aborted || !content) return;
              accountLatency();
              progress.checkpoint = mergeSpecialistCheckpoint(
                retainedSpecialistCheckpoint,
                content,
                resumeFromCheckpoint ? "Resumed checkpoint" : "Retry checkpoint"
              );
              task.integratedTeachingCard.content = combinedSpecialistCheckpoints(task.specialistProgress);
              this.emitState();
              this.queuePersistence();
            },
            onTokenUsage: (totalTokens) => {
              if (controller.signal.aborted || !Number.isInteger(totalTokens) || totalTokens < 0) return;
              accountLatency();
              progress.usedTokens = Math.max(progress.usedTokens, tokenUsageAtStart + totalTokens);
              this.queuePersistence();
            },
            onRuntimeEvent: (event) => {
              if (controller.signal.aborted) return;
              accountLatency();
              log.push({ ...event, sequence: log.length + 1 });
              if (task.agentWorkLogReference) task.agentWorkLogReference.toSequence = log.length;
              this.queuePersistence();
            }
          });
        } finally {
          accountLatency();
          activeUsageAccounts.delete(accountLatency);
        }
        if (controller.signal.aborted) return;
        const validated = validatedSpecialistAgentResult(result);
        const completedContent = mergeSpecialistCheckpoint(
          retainedSpecialistCheckpoint,
          validated.content,
          resumeFromCheckpoint ? "Resumed checkpoint" : "Retry checkpoint"
        );
        progress.status = "complete";
        progress.checkpoint = completedContent;
        progress.result = { ...validated, content: completedContent };
        task.integratedTeachingCard.content = combinedSpecialistCheckpoints(task.specialistProgress);
        this.emitState();
        this.queuePersistence();
      }
    }));
    const promise = coordinateAgentTasks(coordinated, task.budget.concurrency).then(() => {
      if (controller.signal.aborted) return;
      const integrated = task.specialistProgress.map((progress) => validatedSpecialistAgentResult(progress.result));
      const integratedContent = integrated.length === 1
        ? integrated[0].content
        : integrated.map((result) => `${result.title}\n${result.content}`).join("\n\n");
      task.status = "complete";
      task.statusMessage = null;
      Object.assign(task.integratedTeachingCard, {
        title: integrated.length === 1 ? integrated[0].title : "Coordinated Specialist review",
        status: "completed",
        content: integratedContent,
        error: null,
        retryable: false
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const limitMessage = agentBudgetLimitMessage(error, Boolean(task.integratedTeachingCard.content.trim()));
      if (limitMessage) {
        const retryable = agentTaskHasRemainingBudget(task);
        task.status = "stopped";
        task.statusMessage = retryable
          ? limitMessage
          : `${limitMessage} No Agent Budget remains; start a new Learning Session to approve fresh model work.`;
        Object.assign(task.integratedTeachingCard, {
          status: "stopped", error: task.statusMessage, retryable
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
        for (const accountUsage of activeUsageAccounts) accountUsage();
        task.resumeAvailable = false;
        task.status = "stopped";
        task.statusMessage = "Specialist work stopped. Retry when ready.";
        Object.assign(task.integratedTeachingCard, {
          status: "stopped", error: task.statusMessage, retryable: true
        });
      },
      checkpointForShutdown: () => {
        for (const accountUsage of activeUsageAccounts) accountUsage();
        checkpointAgentTaskForRelaunch(task);
      },
      markUnconfirmed: () => {
        task.statusMessage = "Specialist work is stopped locally, but Codex did not confirm interruption. Restart Codex before retrying.";
        task.integratedTeachingCard.error = task.statusMessage;
      },
      restart: async () => this.beginSpecialistAgentTask(session, task)
    });
  }

  private attachQualifiedLearnerModelGuidance(
    session: LearningSession,
    targetContext: EvidenceTransferContext | null
  ): void {
    const validated = targetContext ? validatedEvidenceTransferContext(targetContext) : null;
    session.evidenceTransferContext = validated;
    session.evidenceTransfers = validated ? eligibleEvidenceTransfers(this.state.learnerModel, session, validated) : [];
    session.priorUnderstandingEvidence = validated
      ? eligiblePriorUnderstandingEvidence(this.state.learnerModel, session, validated) : [];
    session.interactionPreferenceReuses = validated
      ? eligibleInteractionPreferenceReuses(this.state.learnerModel, session, validated) : [];
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
    const corroborationMathematics = focus
      ? [session.learningGoal, session.sessionTarget, focus.instruction, mathematics].join("\n")
      : mathematics;
    const corroborationPass = await this.beginAutomaticCorroboration(
      session,
      corroborationMathematics,
      focus ? [focus.sourceId] : []
    );
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
      ...adaptiveTeachingGuidance(this.state.learnerModel, session),
      ...learnerModelGuidance(this.state.learnerModel, session),
      corroboration: teachingCorroborationContext(corroborationPass),
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
    if (selection.kind !== "diagramRegion" && selection.pageNumbers) {
      if (source.kind !== "linkedSource" || !this.sourceAccess) {
        throw new Error("Selected pages require an indexed Linked Source available under the active policy.");
      }
      const extraction = validatedSourceIndexExtractionResult(await this.sourceAccess.extractForIndex(source));
      if (!sameFingerprint(source.link.fingerprint, extraction.fingerprint)) {
        throw new Error("This source changed before the selected pages could be saved.");
      }
      const selectedPages = selection.pageNumbers.map((pageNumber) =>
        extraction.pages.find((page) => page.pageNumber === pageNumber));
      if (selectedPages.some((page) => !page)
        || !selectedPages.some((page) => page!.regions.some((region) => region.text.includes(selection.exactText)))) {
        throw new Error("Choose selected pages and text available in the current Source Index.");
      }
      return validated;
    }
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

  private async beginAutomaticCorroboration(
    session: LearningSession,
    mathematics = session.mathematics,
    informedSourceIds: string[] = []
  ): Promise<CorroborationPass | null> {
    const query = automaticCorroborationQuery(mathematics);
    if (!query) return null;
    const existing = [session.corroborationPass, ...session.corroborationPassHistory]
      .find((pass) => pass?.currentUse.conclusion === mathematics) ?? null;
    if (existing) {
      if (session.corroborationPass?.id !== existing.id) {
        if (session.corroborationPass) session.corroborationPassHistory.push(structuredClone(session.corroborationPass));
        session.corroborationPassHistory = session.corroborationPassHistory.filter((pass) => pass.id !== existing.id);
        session.corroborationPass = structuredClone(existing);
      }
      if (existing.status === "running" && existing.researchActionId) {
        await this.researchWorks.get(existing.researchActionId)?.promise;
      }
      return session.corroborationPass;
    }
    if (session.corroborationPass) session.corroborationPassHistory.push(structuredClone(session.corroborationPass));
    const baselinePresent = informedSourceIds.length > 0 || suppliedPedagogicalBaselinePresent(mathematics);
    const pass: CorroborationPass = {
      id: crypto.randomUUID(),
      researchActionId: null,
      status: "running",
      relevantResult: query.theoremNames[0] ?? (query.keywords[0] === "mathematical proof" ? "Current proof claim" : query.text),
      currentUse: { assumptions: [...query.assumptions], conclusion: mathematics },
      pedagogicalBaselinePresent: baselinePresent,
      assumptionComparison: "unchecked",
      conclusionComparison: "unchecked",
      errataCheck: "unchecked",
      independentSupport: "missing",
      proofApproachResearch: baselinePresent ? "notRequired" : "incomplete",
      deeperResearch: { required: false, performed: false, reason: null },
      evidence: [],
      sourceDiscrepancies: [],
      message: "Corroboration is checking the result, its assumptions and conclusion, known errata, and independent support."
    };
    session.corroborationPass = pass;
    if (!this.externalResearch) {
      completeUnavailableCorroboration(pass);
      return pass;
    }
    const authorizedSourceIds = new Set(this.getSessionAccessScope(session.id).sourceIds);
    const intakeSource = this.state.sources.find((source) => source.kind === "managedAsset"
      && session.sourceIds.includes(source.id) && managedAssetLearnerContent(source) === mathematics);
    const informedBySourceIds = [...new Set([
      ...(intakeSource ? [intakeSource.id] : []),
      ...informedSourceIds
    ])].filter((sourceId) => authorizedSourceIds.has(sourceId));
    const research: ResearchAction = {
      id: crypto.randomUUID(),
      accessPolicy: session.accessPolicy,
      query,
      queryOrigin: "automaticCorroboration",
      researchDepth: "lightweight",
      informedBySourceIds,
      destination: researchDestination(query),
      excerpts: [],
      status: "running",
      result: null,
      error: null
    };
    pass.researchActionId = research.id;
    session.researchActions.push(research);
    const lightweightWork = this.beginExternalResearch(research);
    await this.publishAndPersist();
    await lightweightWork;
    if (pass.deeperResearch.required) {
      const deepQuery = deeperCorroborationQuery(query, pass);
      const deeperResearch: ResearchAction = {
        id: crypto.randomUUID(),
        accessPolicy: session.accessPolicy,
        query: deepQuery,
        queryOrigin: "automaticCorroboration",
        researchDepth: "deep",
        informedBySourceIds,
        destination: researchDestination(deepQuery),
        excerpts: [],
        status: "running",
        result: null,
        error: null
      };
      pass.researchActionId = deeperResearch.id;
      pass.status = "running";
      pass.deeperResearch.performed = true;
      pass.message = "Deeper corroboration is investigating missing, weak, disputed, or conflicting evidence before teaching proceeds.";
      session.researchActions.push(deeperResearch);
      const deepWork = this.beginExternalResearch(deeperResearch);
      await this.publishAndPersist();
      await deepWork;
    }
    return pass;
  }

  private beginExternalResearch(research: ResearchAction): Promise<void> {
    const controller = new AbortController();
    const promise = Promise.resolve().then(async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          this.externalResearch!.research({
            query: research.query,
            queryOrigin: research.queryOrigin,
            researchDepth: research.researchDepth,
            informedBySourceIds: [...research.informedBySourceIds],
            destination: research.destination,
            excerpts: structuredClone(research.excerpts),
            signal: controller.signal
          }),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new DOMException("External research timed out.", "TimeoutError"));
            }, 15_000);
          })
        ]);
        if (research.status !== "running") return;
        research.result = validatedExternalResearchResult(result);
        research.status = "completed";
      } catch (error) {
        if (research.status !== "running") return;
        const timedOut = error instanceof DOMException && error.name === "TimeoutError";
        research.status = timedOut ? "timedOut" : "failed";
        research.error = timedOut
          ? "External research timed out. No access was elevated and no retry was attempted."
          : usefulResearchError(error);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        const session = this.state.sessions.find((candidate) => candidate.corroborationPass?.researchActionId === research.id);
        if (session?.corroborationPass) completeCorroborationPass(session.corroborationPass, research);
        this.researchWorks.delete(research.id);
        await this.publishAndPersist();
      }
    });
    this.researchWorks.set(research.id, { controller, promise });
    return promise;
  }

  private stopSessionExcerptResearch(session: LearningSession, message: string): void {
    for (const research of session.researchActions) {
      if (research.status === "running" && research.excerpts.length > 0) this.stopResearch(research, message);
    }
  }

  private stopResearch(research: ResearchAction, message: string): void {
    this.researchWorks.get(research.id)?.controller.abort();
    research.status = "stopped";
    research.error = message;
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

  private requirePendingDelayedTransferOffer(sessionId: string): LearningSession {
    const session = this.requireSession(sessionId);
    if (session.status !== "consolidated" || session.consolidatedOutcome?.targetDisposition !== "addressed") {
      throw new Error("Delayed Transfer is available only for an Addressed Session Target.");
    }
    if (session.delayedTransferOffer?.status !== "pending") {
      throw new Error("This Delayed Transfer choice has already been decided.");
    }
    return session;
  }

  private requireScheduledDelayedTransferCheck(checkId: string): DelayedTransferCheck {
    const check = this.state.delayedTransferChecks.find((candidate) => candidate.id === checkId);
    if (!check || check.status !== "scheduled") throw new Error("Choose a scheduled Delayed Transfer Check.");
    return check;
  }

  private requireInProgressDelayedTransferCheck(checkId: string): DelayedTransferCheck {
    const check = this.state.delayedTransferChecks.find((candidate) => candidate.id === checkId);
    if (!check || check.status !== "inProgress" || !check.task) {
      throw new Error("Launch a due Delayed Transfer Check before working on it.");
    }
    return check;
  }

  private requireDueDelayedTransferCheck(checkId: string): DelayedTransferCheck {
    const check = this.state.delayedTransferChecks.find((candidate) => candidate.id === checkId);
    if (!check || (check.status !== "scheduled" && check.status !== "inProgress")) {
      throw new Error("Choose an active Delayed Transfer Check.");
    }
    if (Date.parse(check.dueAt) > Date.now()) throw new Error("This Delayed Transfer Check is not due yet.");
    return check;
  }

  private requirePendingRefresherOffer(checkId: string): DelayedTransferCheck {
    const check = this.state.delayedTransferChecks.find((candidate) => candidate.id === checkId);
    if (check?.status !== "completed" || !check.evidence
      || check.result?.refresherOffer?.status !== "pending") {
      throw new Error("Choose a completed Delayed Check Result with an optional refresher.");
    }
    return check;
  }

  private async runDelayedTransferModelWork<Result>(
    checkId: string,
    run: (signal: AbortSignal, onRuntimeEvent: (event: ModelRuntimeEvent) => void) => Promise<Result>
  ): Promise<Result> {
    if (this.modelWorks.has(checkId)) throw new Error("This Delayed Transfer Check already has model work underway.");
    const controller = new AbortController();
    const log = this.agentWorkLogs[checkId] ?? [];
    this.agentWorkLogs[checkId] = log;
    const onRuntimeEvent = (event: ModelRuntimeEvent) => {
      if (!controller.signal.aborted) log.push({ ...event, sequence: log.length + 1 });
    };
    const promise = Promise.resolve().then(() => run(controller.signal, onRuntimeEvent));
    this.modelWorks.set(checkId, {
      controller,
      promise,
      stop: () => undefined,
      markUnconfirmed: () => undefined,
      restart: async () => undefined
    });
    try {
      return await promise;
    } finally {
      if (this.modelWorks.get(checkId)?.promise === promise) this.modelWorks.delete(checkId);
    }
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
      staleSourceClaimEvidence(session, anchor, `Source ${source.name} changed to a new Source Revision.`);
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

function staleSourceClaimEvidence(session: LearningSession, anchor: SourceAnchor, changedBecause: string): void {
  const revisions: Array<TeachingCardRevision | LearningArtifactRevision> = [
    ...session.anchoredTeachingCards.flatMap((card) => [
      card.currentRevision,
      ...card.variants.map((variant) => variant.revision)
    ]),
    ...session.learningArtifacts.map((artifact) => artifact.currentRevision)
  ];
  for (const revision of revisions) {
    for (const claim of revision.claims ?? []) {
      const originDependsOnAnchor = claim.claimOriginReferences.some(
        (reference) => reference.kind === "sourceAnchor" && reference.sourceAnchorId === anchor.id
      );
      let changed = false;
      const evidence = claim.verificationEvidence.map((item) => {
        const dependsOnAnchor = item.reference.kind === "sourceAnchor" && item.reference.sourceAnchorId === anchor.id;
        if (!dependsOnAnchor && !(originDependsOnAnchor && item.method === "sourceGrounded")) return item;
        changed = true;
        return { ...item, currency: "changedSinceCheck" as const, changedBecause };
      });
      if (!changed) continue;
      Object.assign(claim, {
        verificationEvidence: evidence,
        verificationCurrency: "changedSinceCheck" as const,
        verificationLevel: currentVerificationLevel(evidence)
      });
    }
  }
}

function mergeSpecialistCheckpoint(retained: string, current: string, label: string): string {
  if (!retained || current.includes(retained)) return current;
  return `${retained}\n\n${label}:\n${current}`;
}

function combinedSpecialistCheckpoints(progress: AgentTaskSpecialistProgress[]): string {
  return progress.map((specialist) => specialist.checkpoint).filter(Boolean).join("\n\n");
}

function checkpointAgentTaskForRelaunch(task: AgentTask): void {
  task.status = "stopped";
  task.statusMessage = "Agent Task checkpointed when the application closed. Resume when ready.";
  task.resumeAvailable = true;
  Object.assign(task.integratedTeachingCard, {
    status: "stopped", error: task.statusMessage, retryable: false
  });
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

function specialistTokenBudget(task: AgentTask): number {
  return Math.floor(task.budget.maxTokens / task.budget.agentCount);
}

function specialistLatencyBudget(task: AgentTask): number {
  return task.coordination === "dependent"
    ? Math.floor(task.budget.maxLatencyMs / task.budget.agentCount)
    : task.budget.maxLatencyMs;
}

function agentTaskHasRemainingBudget(task: AgentTask): boolean {
  const unfinished = task.specialistProgress.filter((progress) =>
    progress.status !== "complete" && progress.status !== "retained");
  return unfinished.length > 0 && unfinished.every((progress) =>
    progress.usedTokens < specialistTokenBudget(task)
    && progress.usedLatencyMs < specialistLatencyBudget(task));
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

function delayedTransferConcepts(session: LearningSession): string[] {
  return isCompleteEvidenceTransferContext(session.evidenceTransferContext)
    ? [...new Set(session.evidenceTransferContext.concepts.map((concept) => concept.trim()))]
    : [];
}

function requiredFutureIsoDate(value: string, subject: string, relativeTo: string): string {
  if (!validIsoTimestamp(value) || Date.parse(value) <= Date.parse(relativeTo)) {
    throw new Error(`${subject} must be a future date and time.`);
  }
  return value;
}

function emptyVerificationState(): Pick<ClaimVerificationState,
  "verificationLevel" | "verificationCurrency" | "verificationEvidence" | "verificationGaps" | "verificationEscalation"> {
  return {
    verificationLevel: "notIndependentlyChecked",
    verificationCurrency: "current",
    verificationEvidence: [],
    verificationGaps: [],
    verificationEscalation: { recommended: false, reasons: [] }
  };
}

function verificationStateFrom(revision: Partial<Pick<ClaimVerificationState,
  "verificationLevel" | "verificationCurrency" | "verificationEvidence" | "verificationGaps" | "verificationEscalation">>) {
  return {
    verificationLevel: revision.verificationLevel ?? "notIndependentlyChecked",
    verificationCurrency: revision.verificationCurrency ?? "current",
    verificationEvidence: structuredClone(revision.verificationEvidence ?? []),
    verificationGaps: structuredClone(revision.verificationGaps ?? []),
    verificationEscalation: structuredClone(revision.verificationEscalation ?? { recommended: false, reasons: [] })
  } satisfies ReturnType<typeof emptyVerificationState>;
}

function bindTeachingClaim(revision: TeachingCardRevision, anchor: SourceAnchor): void {
  if (!revision.content.trim()) {
    revision.claims = [];
    return;
  }
  revision.claims = [{
    claimId: revision.id,
    claimStatement: revision.content,
    claimOrigin: "modelGenerated",
    claimOriginReferences: [
      { kind: "sourceAnchor", sourceAnchorId: anchor.id },
      ...(revision.agentWorkLogReference ? [{
        kind: "agentWork" as const,
        sessionId: revision.agentWorkLogReference.sessionId,
        fromSequence: revision.agentWorkLogReference.fromSequence,
        toSequence: revision.agentWorkLogReference.toSequence
      }] : [])
    ],
    ...emptyVerificationState()
  }];
}

function claimVerificationFrom(
  revision: TeachingCardRevision,
  fallbackClaimId: string,
  fallbackStatement: string
): ClaimVerificationState {
  const claim = revision.claims?.[0];
  return {
    claimId: claim?.claimId ?? fallbackClaimId,
    claimStatement: claim?.claimStatement.trim() ? claim.claimStatement : fallbackStatement,
    claimOrigin: claim?.claimOrigin ?? "modelGenerated",
    claimOriginReferences: structuredClone(claim?.claimOriginReferences ?? []),
    ...verificationStateFrom(claim ?? {})
  };
}

function combinedClaimVerification(claims: ClaimVerificationState[]): ClaimVerificationState {
  const first = claims[0];
  return {
    claimId: first?.claimId ?? crypto.randomUUID(),
    claimStatement: claims.map((claim) => claim.claimStatement).join("\n\n"),
    claimOrigin: claims.some((claim) => claim.claimOrigin !== first?.claimOrigin) ? "mixed" : first?.claimOrigin ?? "mixed",
    claimOriginReferences: claims.flatMap((claim) => claim.claimOriginReferences),
    verificationLevel: "notIndependentlyChecked",
    verificationCurrency: claims.some((claim) => claim.verificationCurrency === "changedSinceCheck") ? "changedSinceCheck" : "current",
    verificationEvidence: claims.flatMap((claim) => claim.verificationEvidence),
    verificationGaps: claims.flatMap((claim) => claim.verificationGaps),
    verificationEscalation: {
      recommended: claims.some((claim) => claim.verificationEscalation.recommended),
      reasons: [...new Set(claims.flatMap((claim) => claim.verificationEscalation.reasons))]
    }
  };
}

function editedArtifactClaims(
  claims: ClaimVerificationState[],
  content: string,
  action: Extract<LearnerAction, { type: "editLearningArtifact" }>,
  revisionId: string,
  contentChanged: boolean
): ClaimVerificationState[] {
  if (action.mathematicalChange === "formattingOnly") return structuredClone(claims);
  if (action.claimEdits) {
    if (action.claimEdits.length === 0) throw new Error("Keep at least one exact mathematical claim.");
    const existing = new Map(claims.map((claim) => [claim.claimId, claim]));
    const usedIds = action.claimEdits.flatMap((edit) => edit.claimId ? [edit.claimId] : []);
    if (new Set(usedIds).size !== usedIds.length || usedIds.some((claimId) => !existing.has(claimId))) {
      throw new Error("Choose each exact claim from the current Artifact at most once.");
    }
    const hasExplicitClaimChange = action.claimEdits.length !== claims.length
      || action.claimEdits.some((edit) => edit.claimId === null
        || edit.statement.trim() !== existing.get(edit.claimId)?.claimStatement);
    if (contentChanged && !hasExplicitClaimChange) {
      return claims.map((claim) => ({
        ...claim,
        ...staleVerificationState(claim, "The Artifact content changed without an exact claim-change classification.")
      }));
    }
    return curatedClaimEdits(claims, action.claimEdits, revisionId, "Artifact");
  }
  const combined = combinedClaimVerification(claims);
  return [{
    ...combined,
    claimId: revisionId,
    claimStatement: content,
    claimOrigin: combined.claimOrigin === "learner" ? "learner" : "mixed",
    ...staleVerificationState(combined, "A semantic Artifact edit changed the mathematical claim.")
  }];
}

function curatedClaimEdits(
  claims: ClaimVerificationState[],
  edits: Array<{ claimId: string | null; statement: string }>,
  revisionId: string,
  subject: "Teaching Card" | "Artifact"
): ClaimVerificationState[] {
  if (edits.length === 0) throw new Error("Keep at least one exact mathematical claim.");
  const existing = new Map(claims.map((claim) => [claim.claimId, claim]));
  const usedIds = edits.flatMap((edit) => edit.claimId ? [edit.claimId] : []);
  if (new Set(usedIds).size !== usedIds.length || usedIds.some((claimId) => !existing.has(claimId))) {
    throw new Error(`Choose each exact claim from the current ${subject} at most once.`);
  }
  return edits.map((edit) => {
    const statement = requiredText(edit.statement, "Exact claim");
    if (edit.claimId === null) return {
      claimId: crypto.randomUUID(),
      claimStatement: statement,
      claimOrigin: "learner" as const,
      claimOriginReferences: [{
        kind: "learnerRevision" as const,
        revisionId,
        subject: subject === "Teaching Card" ? "teachingCard" as const : "learningArtifact" as const
      }],
      ...emptyVerificationState()
    };
    const previous = existing.get(edit.claimId)!;
    if (statement === previous.claimStatement) return structuredClone(previous);
    return {
      ...previous,
      claimId: crypto.randomUUID(),
      claimStatement: statement,
      claimOrigin: previous.claimOrigin === "learner" ? "learner" as const : "mixed" as const,
      claimOriginReferences: [...previous.claimOriginReferences, {
        kind: "learnerRevision" as const,
        revisionId,
        subject: subject === "Teaching Card" ? "teachingCard" as const : "learningArtifact" as const
      }],
      ...staleVerificationState(previous, `A learner changed this exact ${subject} claim.`)
    };
  });
}

function staleVerificationState(
  revision: Pick<ClaimVerificationState,
    "verificationLevel" | "verificationCurrency" | "verificationEvidence" | "verificationGaps" | "verificationEscalation">,
  changedBecause: string
) {
  const previous = verificationStateFrom(revision);
  return {
    verificationLevel: "notIndependentlyChecked" as const,
    verificationCurrency: previous.verificationEvidence.length > 0 ? "changedSinceCheck" as const : "current" as const,
    verificationEvidence: previous.verificationEvidence.map((evidence) => ({
      ...evidence,
      currency: "changedSinceCheck" as const,
      changedBecause
    })),
    verificationGaps: previous.verificationGaps,
    verificationEscalation: previous.verificationEscalation
  };
}

function claimCheckRevision(
  session: LearningSession,
  target: "teachingCard" | "learningArtifact",
  targetId: string
): TeachingCardRevision | LearningArtifactRevision {
  if (target === "teachingCard") return requireAnchoredTeachingCard(session, targetId).currentRevision;
  if (target === "learningArtifact") return requireLearningArtifact(session, targetId).currentRevision;
  throw new Error("Choose a Teaching Card or Learning Artifact claim.");
}

function requireClaimVerification(
  revision: TeachingCardRevision | LearningArtifactRevision,
  claimId: string
): ClaimVerificationState {
  const claim = revision.claims?.find((candidate) => candidate.claimId === claimId);
  if (!claim) throw new Error("Choose an exact mathematical claim in the current revision.");
  return claim;
}

function sourceGroundedCheckOutcome(
  session: LearningSession,
  claim: ClaimVerificationState,
  reference: ClaimEvidenceReference
): ClaimCheckOutcome {
  const pass = session.corroborationPass;
  if (!pass || pass.status === "running") throw new Error("Complete the Corroboration Pass before recording a Source-grounded check.");
  if (pass.currentUse.conclusion !== claim.claimStatement) {
    throw new Error("The Corroboration Pass must check the exact current claim before it can be Source-grounded.");
  }
  if (reference.kind !== "researchEvidence" || reference.researchActionId !== pass.researchActionId) {
    throw new Error("Source-grounded evidence must cite the research action that produced this Corroboration Pass.");
  }
  if (pass.status === "disputed" || pass.sourceDiscrepancies.length > 0) return "disagrees";
  if (pass.status === "completed" && pass.assumptionComparison === "matches"
    && pass.conclusionComparison === "matches" && pass.independentSupport === "sufficient") return "supports";
  return "unresolved";
}

function requiredClaimCheckMethod(value: unknown): ClaimCheckMethod {
  if (!["reasoningReview", "sourceGrounded", "independentCorroboration", "formalVerification"].includes(String(value))) {
    throw new Error("Choose a valid claim-checking method.");
  }
  return value as ClaimCheckMethod;
}

function requiredClaimCheckOutcome(value: unknown): ClaimCheckOutcome {
  if (!["supports", "disagrees", "unresolved"].includes(String(value))) {
    throw new Error("Choose support, disagreement, or an unresolved claim-check outcome.");
  }
  return value as ClaimCheckOutcome;
}

function validatedClaimEvidenceReference(value: unknown): ClaimEvidenceReference {
  if (!validClaimEvidenceReference(value)) throw new Error("Link claim evidence to its exact source, research, agent work, or formal checker.");
  return structuredClone(value);
}

function validClaimEvidenceReference(value: unknown): value is ClaimEvidenceReference {
  if (!isRecord(value)) return false;
  if (value.kind === "sourceAnchor") return typeof value.sourceAnchorId === "string" && Boolean(value.sourceAnchorId);
  if (value.kind === "researchEvidence") return typeof value.researchActionId === "string" && Boolean(value.researchActionId);
  if (value.kind === "agentWork") return typeof value.sessionId === "string" && Boolean(value.sessionId)
    && Number.isInteger(value.fromSequence) && Number.isInteger(value.toSequence)
    && (value.fromSequence as number) >= 1 && (value.toSequence as number) >= (value.fromSequence as number);
  if (value.kind === "learnerRevision") return typeof value.revisionId === "string" && Boolean(value.revisionId)
    && (value.subject === "teachingCard" || value.subject === "learningArtifact");
  return value.kind === "formalChecker" && typeof value.checker === "string" && Boolean(value.checker.trim())
    && typeof value.verificationEnvironment === "string" && Boolean(value.verificationEnvironment.trim());
}

function validateClaimCheckEvidence(method: ClaimCheckMethod, reference: ClaimEvidenceReference): void {
  if (method === "reasoningReview" && reference.kind !== "agentWork") {
    throw new Error("A reasoning review must link to the separate Agent Work that performed it.");
  }
  if (method === "sourceGrounded" && reference.kind !== "researchEvidence") {
    throw new Error("A Source-grounded check must link to the Corroboration Pass research evidence.");
  }
  if (method === "independentCorroboration" && reference.kind !== "agentWork" && reference.kind !== "researchEvidence") {
    throw new Error("Independent corroboration must link to a separate reasoning attempt or independent evidence.");
  }
  if (method === "formalVerification" && reference.kind !== "formalChecker") {
    throw new Error("Formal verification must identify the checker and exact Verification Environment.");
  }
}

function sameClaimEvidenceReference(left: ClaimEvidenceReference, right: ClaimEvidenceReference): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "sourceAnchor" && right.kind === "sourceAnchor") return left.sourceAnchorId === right.sourceAnchorId;
  if (left.kind === "researchEvidence" && right.kind === "researchEvidence") return left.researchActionId === right.researchActionId;
  if (left.kind === "agentWork" && right.kind === "agentWork") {
    return left.sessionId === right.sessionId
      && left.fromSequence <= right.toSequence && right.fromSequence <= left.toSequence;
  }
  if (left.kind === "learnerRevision" && right.kind === "learnerRevision") {
    return left.revisionId === right.revisionId && left.subject === right.subject;
  }
  return left.kind === "formalChecker" && right.kind === "formalChecker"
    && left.checker === right.checker && left.verificationEnvironment === right.verificationEnvironment;
}

function currentVerificationLevel(evidence: ClaimVerificationEvidence[]): VerificationLevel {
  const current = evidence.filter((item) => item.currency === "current");
  if (current.some((item) => item.outcome !== "supports")) return "notIndependentlyChecked";
  const supported = new Set(current.filter((item) => item.outcome === "supports").map((item) => item.method));
  if (supported.has("formalVerification")) return "formallyVerified";
  if (supported.has("independentCorroboration")) return "independentlyCorroborated";
  if (supported.has("sourceGrounded")) return "sourceGrounded";
  if (supported.has("reasoningReview")) return "reasoningReviewed";
  return "notIndependentlyChecked";
}

function escalationForEvidence(evidence: ClaimVerificationEvidence[], gaps: VerificationGap[]): VerificationEscalation {
  const currentProblem = evidence.find((item) => item.currency === "current" && item.outcome !== "supports");
  if (!currentProblem && gaps.length === 0) return { recommended: false, reasons: [] };
  const reason = currentProblem?.outcome === "disagrees"
    ? "Independent checking disagreed with the claim."
    : "A claim check remains unresolved.";
  return { recommended: true, reasons: [reason] };
}

function isVerificationRiskFactor(value: unknown): value is VerificationRiskFactor {
  return ["nonTrivial", "weakSupport", "disputed", "longDependencyChain", "substantialDeparture", "checkerFailure"]
    .includes(String(value));
}

function verificationRiskReason(value: VerificationRiskFactor): string {
  return {
    nonTrivial: "The claim is mathematically non-trivial.",
    weakSupport: "The available support is weak or sparse.",
    disputed: "Available evidence disputes the claim.",
    longDependencyChain: "The claim depends on a long reasoning chain.",
    substantialDeparture: "The argument substantially departs from an established route.",
    checkerFailure: "A checker failed or could not complete the check."
  }[value];
}

function verifierOutcomeMessage(outcome: VerifierCommandOutcome, diagnostics: string): string {
  const labels: Record<Exclude<VerifierCommandOutcome, "accepted">, string> = {
    rejected: "Lean rejected the formal source with a type error; this does not establish mathematical disproof.",
    timedOut: "The formal check timed out before Lean returned a result.",
    cancelled: "The formal check was cancelled before Lean returned a result.",
    unsupported: "This exact claim does not yet have a supported formal translation.",
    unavailable: "The Bundled Lean Runtime was unavailable.",
    crashed: "The Lean process stopped unexpectedly before returning a result.",
    malformedOutput: "Lean returned malformed output that could not be trusted.",
    versionMismatch: "The available Lean version did not match the recorded Verification Environment."
  };
  return outcome === "accepted" ? "Lean accepted the exact formal statement." : `${labels[outcome]} ${diagnostics}`.trim();
}

export function claimOriginLabel(value: ClaimOrigin): string {
  return {
    learner: "Learner",
    suppliedSource: "Supplied source",
    modelGenerated: "Model-generated",
    mixed: "Mixed origins"
  }[value];
}

export function verificationLevelLabel(value: VerificationLevel): string {
  return {
    notIndependentlyChecked: "Not independently checked",
    reasoningReviewed: "Reasoning-reviewed",
    sourceGrounded: "Source-grounded",
    independentlyCorroborated: "Independently corroborated",
    formallyVerified: "Formally verified"
  }[value];
}

export function verificationCurrencyLabel(value: VerificationCurrency): string {
  return value === "current" ? "Current" : "Changed since check";
}

export function claimCheckMethodLabel(value: ClaimCheckMethod): string {
  return {
    reasoningReview: "Reasoning review",
    sourceGrounded: "Source-grounded check",
    independentCorroboration: "Independent corroboration",
    formalVerification: "Formal verification"
  }[value];
}

export function claimCheckOutcomeLabel(value: ClaimCheckOutcome): string {
  return { supports: "Supports", disagrees: "Disagrees", unresolved: "Unresolved" }[value];
}

export function claimEvidenceReferenceLabel(value: ClaimEvidenceReference): string {
  if (value.kind === "sourceAnchor") return `Source Anchor ${value.sourceAnchorId}`;
  if (value.kind === "researchEvidence") return `Research evidence ${value.researchActionId}`;
  if (value.kind === "agentWork") return `Agent Work ${value.sessionId} events ${value.fromSequence}–${value.toSequence}`;
  if (value.kind === "learnerRevision") {
    return `Learner ${value.subject === "teachingCard" ? "Teaching Card" : "Artifact"} Revision ${value.revisionId}`;
  }
  return `${value.checker} · Verification Environment ${value.verificationEnvironment}`;
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

function usefulResearchError(error: unknown): string {
  const detail = error instanceof Error && error.message.trim()
    ? error.message
    : "The external research service failed.";
  return `${detail} No access was elevated and no retry was attempted.`;
}

function automaticCorroborationQuery(mathematics: string): DerivedResearchQuery | null {
  const namedTheorem = mathematics.match(
    /(?:prove|disprove|show|verify|study|understand|explain|establish|demonstrate|justify|derive|give\s+(?:me\s+)?a\s+proof\s+of|proof\s+of)\s+(?:the\s+)?([a-z][a-z'’\-]*(?:\s+[a-z][a-z'’\-]*){0,4}\s+theorems?)\b/i
  )?.[1];
  const substantive = namedTheorem !== undefined
    || /\b(prove|disprove|establish|demonstrate|justify|derive|deduce)\b|\bproof\s+(?:that|of)\b|\b(?:give|find|write|construct|present|supply|outline|explain)\s+(?:me\s+)?(?:an?\s+)?(?:proof|argument|counterexample)\b|\b(?:show|verify|check|confirm)\s+(?:me\s+)?(?:that|whether)\b|\bwhy\s+(?:is|are|does)\b(?![^.!?]*\b(?:called|named|mean|definition)\b)|\bhow\s+(?:can|do|does|would)\b[^.!?]*\b(?:show|prove|establish|derive)\b/i.test(mathematics);
  if (!substantive) return null;
  const assumptions = Array.from(mathematics.matchAll(
    /\b(?:finite|abelian)\s+(?:group|ring|field)\b|\b(?:compact|hausdorff)\s+(?:space|subset)\b|\bcontinuous\s+(?:function|map)\b/gi
  )).map(([assumption]) => assumption.toLocaleLowerCase())
    .filter((assumption, index, all) => all.indexOf(assumption) === index)
    .slice(0, 3);
  const theoremName = namedTheorem?.replace(/\s+/g, " ");
  if (theoremName) {
    return buildDerivedResearchQuery({ theoremNames: [theoremName], assumptions, keywords: [] });
  }
  const allowedKeywords = new Set([
    "abelian", "algebra", "compact", "compactness", "continuous", "convergence", "derivative", "field", "finite",
    "graph", "group", "hausdorff", "homomorphism", "integral", "isomorphism", "matrix", "measure", "probability",
    "ring", "sequence", "series", "subgroup", "topology", "vector"
  ]);
  const assumptionTerms = new Set(assumptions.flatMap((assumption) => assumption.match(/[a-z][a-z'’\-]*/g) ?? []));
  const keywords = (mathematics.match(/[a-z][a-z'’\-]{2,}/gi) ?? [])
    .map((term) => term.toLocaleLowerCase())
    .filter((term, index, terms) => allowedKeywords.has(term) && !assumptionTerms.has(term) && terms.indexOf(term) === index)
    .slice(0, 5);
  return buildDerivedResearchQuery({
    theoremNames: [],
    assumptions,
    keywords: assumptions.length === 0 && keywords.length === 0 ? ["mathematical proof"] : keywords
  });
}

function deeperCorroborationQuery(query: DerivedResearchQuery, pass: CorroborationPass): DerivedResearchQuery {
  const escalationTerms = [
    "published errata",
    "authoritative proof approach",
    ...(pass.independentSupport === "conflicting" ? ["counterexample"] : [])
  ];
  return buildDerivedResearchQuery({
    theoremNames: query.theoremNames,
    assumptions: query.assumptions,
    keywords: [...query.keywords, ...escalationTerms].slice(0, 8)
  });
}

function suppliedPedagogicalBaselinePresent(mathematics: string): boolean {
  return /\b(?:proof|argument|solution)\s*:|\b(?:the proof|this proof|this argument|the source|the notes?)\b/i.test(mathematics)
    && !/^\s*(?:give\s+(?:me\s+)?a\s+proof|prove|show\s+that)\b/i.test(mathematics);
}

function completeUnavailableCorroboration(pass: CorroborationPass): void {
  if (pass.sourceDiscrepancies.length > 0) {
    pass.status = "disputed";
    pass.independentSupport = "conflicting";
    pass.deeperResearch = {
      required: true,
      performed: pass.deeperResearch.performed,
      reason: "Authoritative evidence remains disputed or conflicting; further external research was unavailable."
    };
    pass.message = "A Source Discrepancy preserves material disagreement. The affected claim is not presented as settled.";
    return;
  }
  pass.status = "incomplete";
  pass.deeperResearch = {
    required: true,
    performed: pass.deeperResearch.performed,
    reason: "Independent evidence is missing because external research is unavailable."
  };
  pass.message = "Corroboration is incomplete: independent evidence and errata could not be checked. The affected claim is not presented as settled.";
}

function completeCorroborationPass(pass: CorroborationPass, research: ResearchAction): void {
  if (research.status !== "completed" || !research.result?.corroboration) {
    completeUnavailableCorroboration(pass);
    if (research.error) pass.message = `Corroboration is incomplete: ${research.error} The affected claim is not presented as settled.`;
    return;
  }
  const corroboration = research.result.corroboration;
  pass.relevantResult = corroboration.relevantResult;
  pass.evidence = [...pass.evidence, ...structuredClone(corroboration.evidence)].filter((item, index, evidence) =>
    evidence.findIndex((candidate) => candidate.sourceUrl === item.sourceUrl
      && candidate.sourceTitle === item.sourceTitle
      && candidate.relation === item.relation
      && candidate.detail === item.detail) === index
  );
  const strong = pass.evidence.filter((item) =>
    (item.authority === "primary" || item.authority === "authoritative") && item.relevance === "direct"
  );
  const assumptionMismatch = strong.some((item) => item.assumptions === "mismatch");
  const conclusionMismatch = strong.some((item) => item.conclusion === "mismatch");
  const matchingSupport = strong.some((item) => item.relation === "supports"
    && item.assumptions === "matches" && item.conclusion === "matches");
  const errata = strong.filter((item) => item.relation === "erratum");
  const conflicts = strong.filter((item) => item.relation === "conflicts"
    || item.assumptions === "mismatch" || item.conclusion === "mismatch" || item.relation === "erratum");
  const anySupport = pass.evidence.some((item) => item.relation === "supports");
  pass.assumptionComparison = assumptionMismatch ? "mismatch" : matchingSupport ? "matches" : "unchecked";
  pass.conclusionComparison = conclusionMismatch ? "mismatch" : matchingSupport ? "matches" : "unchecked";
  pass.errataCheck = pass.errataCheck === "found" || corroboration.errataCheck === "found"
    ? "found"
    : pass.errataCheck === "noneFound" || corroboration.errataCheck === "noneFound" ? "noneFound" : "unchecked";
  pass.independentSupport = conflicts.length > 0 ? "conflicting" : matchingSupport ? "sufficient" : anySupport ? "weakOnly" : "missing";
  const materialConflict = conflicts.length > 0 || pass.errataCheck === "found";
  if (materialConflict) pass.independentSupport = "conflicting";
  const establishedApproaches = strong.flatMap((item) => item.proofApproaches);
  pass.proofApproachResearch = pass.pedagogicalBaselinePresent
    ? "notRequired"
    : establishedApproaches.length > 0 ? "established" : "incomplete";
  if (materialConflict) {
    const discrepancy = pass.sourceDiscrepancies[0] ?? {
      id: crypto.randomUUID(),
      relevantResult: pass.relevantResult,
      summary: conflicts.length > 0
        ? "Authoritative evidence materially disagrees with the current use or reports a correction."
        : "External research reports known errata without attaching corresponding correction evidence.",
      competingEvidence: []
    };
    discrepancy.competingEvidence = structuredClone(pass.evidence);
    pass.sourceDiscrepancies = [discrepancy];
  }
  const deeperReasons = [
    ...(!matchingSupport && conflicts.length === 0 ? [anySupport
      ? "Available agreement comes only from weak, related, derivative, or unknown-authority evidence."
      : "Independent evidence is missing."] : []),
    ...(materialConflict ? ["Authoritative evidence is disputed or conflicting."] : []),
    ...(!pass.pedagogicalBaselinePresent && establishedApproaches.length === 0
      ? ["No Pedagogical Baseline or established proof approach is available."] : []),
    ...(corroboration.proposedApproachDeparture ? ["The proposed teaching route substantially departs from established approaches."] : [])
  ];
  pass.deeperResearch = {
    required: deeperReasons.length > 0,
    performed: pass.deeperResearch.performed,
    reason: deeperReasons.join(" ") || null
  };
  pass.status = materialConflict
    ? "disputed"
    : matchingSupport && pass.errataCheck !== "unchecked"
      && pass.proofApproachResearch !== "incomplete" ? "completed" : "incomplete";
  pass.message = pass.status === "completed"
    ? "Corroboration found direct authoritative support for the current assumptions and conclusion."
    : pass.status === "disputed"
      ? "A Source Discrepancy preserves material disagreement. The affected claim is not presented as settled."
      : "Corroboration is incomplete. The affected claim is not presented as settled.";
}

function teachingCorroborationContext(pass: CorroborationPass | null): TeachingRequest["corroboration"] {
  if (!pass || pass.status === "running") return null;
  return {
    status: pass.status,
    relevantResult: pass.relevantResult,
    assumptionComparison: pass.assumptionComparison,
    conclusionComparison: pass.conclusionComparison,
    errataCheck: pass.errataCheck,
    independentSupport: pass.independentSupport,
    message: pass.message
  };
}

function researchDestination(query: DerivedResearchQuery, excerpts: ResearchExcerpt[] = []): string {
  const destination = new URL("https://duckduckgo.com/");
  destination.searchParams.set("q", [query.text, ...excerpts.map((excerpt) => `"${excerpt.content}"`)].join("; "));
  return destination.href;
}

function researchDestinationIsAllowed(value: string): boolean {
  try {
    const destination = new URL(value);
    return destination.protocol === "https:" && destination.hostname === "duckduckgo.com";
  } catch {
    return false;
  }
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

function usefulVerifierEnvironmentError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The Bundled Lean Runtime operation failed. Review the environment state and retry.";
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
    const needsLegacyLearnerModel = stored.learnerModel === undefined;
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
    current.verifierManifests = migrateVerifierManifests(stored.verifierManifests);
    current.verifierEnvironment = migrateVerifierEnvironmentState(stored.verifierEnvironment, current.verifierManifests);
    current.delayedTransferChecks = migrateDelayedTransferChecks(stored.delayedTransferChecks);
    current.activeDelayedTransferCheckId = typeof stored.activeDelayedTransferCheckId === "string"
      ? stored.activeDelayedTransferCheckId : null;
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
    current.sourceExcerptEgressPreference = migrateSourceExcerptEgressPreference(stored.sourceExcerptEgressPreference);
    current.learnerModel = migrateLearnerModel(stored.learnerModel);
    current.argumentRoadmaps = migrateArgumentRoadmaps(stored.argumentRoadmaps);
    current.sessions = current.sessions.map((session) => ({
      ...session,
      sourceIds: session.sourceIds ?? [],
      proposal: session.proposal ?? defaultAcceptedProposal(),
      teachingMoves: migrateTeachingMoves(session.teachingMoves, session.id, session.proposal ?? defaultAcceptedProposal()),
      currentTeachingMove: migrateCurrentTeachingMove(session.currentTeachingMove, session.teachingMoves, session.id, session.proposal ?? defaultAcceptedProposal()),
      understandingChecks: migrateUnderstandingChecks(session.understandingChecks),
      understandingEvidence: migrateUnderstandingEvidence(session.understandingEvidence),
      teachingExperiments: migrateTeachingExperiments(session.teachingExperiments),
      interactionPreferences: migrateInteractionPreferences(session.interactionPreferences),
      evidenceTransferContext: session.evidenceTransferContext === undefined || session.evidenceTransferContext === null
        ? null : validatedStoredEvidenceTransferContext(session.evidenceTransferContext),
      evidenceTransfers: migrateEvidenceTransfers(session.evidenceTransfers),
      priorUnderstandingEvidence: migratePriorUnderstandingEvidence(session.priorUnderstandingEvidence),
      interactionPreferenceReuses: migrateInteractionPreferenceReuses(session.interactionPreferenceReuses),
      ignoreLearnerModel: typeof session.ignoreLearnerModel === "boolean" ? session.ignoreLearnerModel : false,
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
      researchEgressPermission: migrateResearchEgressPermission(session.researchEgressPermission),
      researchActions: migrateResearchActions(session.researchActions),
      corroborationPass: migrateCorroborationPass(session.corroborationPass),
      corroborationPassHistory: migrateCorroborationPassHistory(session.corroborationPassHistory),
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
      delayedTransferOffer: migrateDelayedTransferOffer(session.delayedTransferOffer),
      continuationOf: migrateContinuationLink(session.continuationOf),
      refresherOf: migrateRefresherLink(session.refresherOf),
      modelStopConfirmation: migrateModelStopConfirmation(session.modelStopConfirmation),
      learningSlice: migrateLearningSlice(session.learningSlice),
      conceptPeeks: migrateConceptPeeks(session.conceptPeeks),
      pendingConceptPeek: migratePendingConceptPeek(session.pendingConceptPeek),
      prerequisiteBranchProposals: migratePrerequisiteBranchProposals(session.prerequisiteBranchProposals),
      prerequisiteBranch: migratePrerequisiteBranch(session.prerequisiteBranch),
      agentTasks: migrateAgentTasks(session.agentTasks),
      activeAgentTaskId: typeof session.activeAgentTaskId === "string" ? session.activeAgentTaskId : null,
      reasoningPreference: migrateReasoningPreference(session.reasoningPreference),
      runtimeOverride: migrateRuntimeOverride(session.runtimeOverride),
      verifierEnvironmentPinId: typeof session.verifierEnvironmentPinId === "string" ? session.verifierEnvironmentPinId : null
    }));
    ensureDelayedTransferContextLinks(current);
    recoverInterruptedDelayedTransferPreparations(current);
    if (needsLegacyLearnerModel) current.learnerModel = migrateLegacyLearnerModel(current.sessions);
    addLegacyUnresolvedReanchoringDecisions(current);
    attachManagedSourcesToLegacySessions(current);
    for (const session of current.sessions) {
      validateSessionSourceAnchorReferences(current, session);
      validateAdaptiveTeachingReferences(session);
      validateLearnerModelReuseReferences(current, session);
      validateQuestionCardReferences(current, session);
      validateAgentTaskReferences(session);
      refreshAskBarContext(current, session);
    }
    validateReanchoringDecisionReferences(current);
    validateSessionLifecycleReferences(current);
    validateDelayedTransferReferences(current);
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
      teachingMoves: [],
      currentTeachingMove: initialTeachingMove(defaultAcceptedProposal().initialTeachingDirection),
      understandingChecks: [],
      understandingEvidence: [],
      teachingExperiments: [],
      interactionPreferences: [],
      evidenceTransferContext: null,
      evidenceTransfers: [],
      priorUnderstandingEvidence: [],
      interactionPreferenceReuses: [],
      ignoreLearnerModel: false,
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
      researchEgressPermission: { status: "notGranted" },
      researchActions: [],
      corroborationPass: null,
      corroborationPassHistory: [],
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
      runtimeOverride: null,
      verifierEnvironmentPinId: null
    };
    migrated.sessions.push(session);
    session.teachingMoves = [session.currentTeachingMove];
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

function migrateVerifierManifests(value: unknown): VerifierManifest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(validVerifierManifest)) {
    throw new Error("Stored Verifier Manifests are invalid.");
  }
  return structuredClone(value);
}

function validVerifierManifest(value: unknown): value is VerifierManifest {
  if (!isRecord(value) || !isRecord(value.environment)) return false;
  return [value.id, value.sessionId, value.targetId, value.claimId, value.claimRevisionId, value.exactClaim,
    value.command, value.diagnostics, value.createdAt].every((item) => typeof item === "string")
    && (value.target === "teachingCard" || value.target === "learningArtifact")
    && (value.formalStatement === null || typeof value.formalStatement === "string")
    && Array.isArray(value.assumptions) && value.assumptions.every((item) => typeof item === "string")
    && (value.proofSource === null || typeof value.proofSource === "string")
    && (value.evidenceLocation === null || typeof value.evidenceLocation === "string")
    && (value.formalStatementVerificationLevel === "formallyVerified" || value.formalStatementVerificationLevel === "incomplete")
    && ["accepted", "rejected", "timedOut", "cancelled", "unsupported", "unavailable", "crashed",
      "malformedOutput", "versionMismatch"].includes(String(value.commandOutcome))
    && typeof value.environment.id === "string" && Boolean(value.environment.id.trim())
    && typeof value.environment.checker === "string" && Boolean(value.environment.checker.trim())
    && typeof value.environment.leanVersion === "string" && Boolean(value.environment.leanVersion.trim())
    && typeof value.environment.mathlibVersion === "string" && Boolean(value.environment.mathlibVersion.trim())
    && typeof value.environment.mathlibCommit === "string" && Boolean(value.environment.mathlibCommit.trim())
    && typeof value.environment.platform === "string" && Boolean(value.environment.platform.trim())
    && typeof value.environment.architecture === "string" && Boolean(value.environment.architecture.trim())
    && typeof value.environment.sourceArchive === "string" && Boolean(value.environment.sourceArchive.trim())
    && typeof value.environment.sourceSha256 === "string" && Boolean(value.environment.sourceSha256.trim())
    && typeof value.environment.supportProfile === "string" && Boolean(value.environment.supportProfile.trim())
    && Array.isArray(value.environment.mathlibModules)
    && value.environment.mathlibModules.every((module) => typeof module === "string" && Boolean(module.trim()))
    && typeof value.environment.runtimeFormat === "number";
}

function requireVerifierRunId(value: string): string {
  const runId = value.trim();
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(runId)) throw new Error("Verifier run identifier is invalid.");
  return runId;
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
      || !(candidate.resumeAvailable === undefined || typeof candidate.resumeAvailable === "boolean")
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
    const specialistProgress = candidate.specialistProgress ?? (Array.isArray(specialistBriefs) ? specialistBriefs : []).map(() => ({
      status: candidate.status === "complete" ? "retained" : "pending",
      checkpoint: "", result: null, usedTokens: 0, usedLatencyMs: 0
    }));
    if (candidate.specialistProgress === undefined && Array.isArray(specialistProgress)
      && specialistProgress.length > 0 && isRecord(card) && typeof card.content === "string") {
      specialistProgress[0].checkpoint = card.content;
    }
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
      || !Array.isArray(specialistProgress) || specialistProgress.length !== specialistBriefs.length
      || !specialistProgress.every(validStoredSpecialistProgress)
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
    const unsafeLegacyCoordination = candidate.specialistProgress === undefined
      && specialistBriefs.length > 1 && candidate.status !== "complete";
    const legacyStatusMessage = "This coordinated Agent Task predates resumable specialist checkpoints. Its partial output is retained, but resuming could duplicate model work. Start a new Learning Session for a fresh Agent Task.";
    return {
      ...candidate,
      status: unsafeLegacyCoordination ? "stopped" : candidate.status,
      statusMessage: unsafeLegacyCoordination ? legacyStatusMessage : candidate.statusMessage,
      resumeAvailable: unsafeLegacyCoordination ? false : candidate.resumeAvailable ?? false,
      coordination,
      specialistBriefs,
      specialistProgress,
      integratedTeachingCard: unsafeLegacyCoordination ? {
        ...card,
        status: "stopped",
        error: legacyStatusMessage,
        retryable: false
      } : card,
      priorAgentWorkLogReferences: priorReferences
    } as unknown as AgentTask;
  });
}

function validStoredSpecialistProgress(value: unknown): value is AgentTaskSpecialistProgress {
  if (!isRecord(value) || !["pending", "working", "waiting", "complete", "retained"].includes(String(value.status))
    || typeof value.checkpoint !== "string"
    || !Number.isInteger(value.usedTokens) || (value.usedTokens as number) < 0
    || !Number.isInteger(value.usedLatencyMs) || (value.usedLatencyMs as number) < 0) return false;
  if (value.result === null) return value.status !== "complete";
  return value.status === "complete" && isRecord(value.result)
    && typeof value.result.title === "string" && Boolean(value.result.title.trim())
    && typeof value.result.content === "string" && Boolean(value.result.content.trim())
    && value.checkpoint === value.result.content;
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
    if (task.resumeAvailable && (task.status !== "stopped"
      || task.integratedTeachingCard.status !== "stopped"
      || task.integratedTeachingCard.retryable)) {
      throw new Error("Stored Agent Task references are invalid.");
    }
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

function migrateSourceExcerptEgressPreference(value: unknown): LearningApplicationState["sourceExcerptEgressPreference"] {
  if (value === undefined) return { enabled: false };
  if (!isRecord(value) || typeof value.enabled !== "boolean") {
    throw new Error("Stored Source Excerpt Egress Preference is invalid.");
  }
  return { enabled: value.enabled };
}

function migrateResearchEgressPermission(value: unknown): LearningSession["researchEgressPermission"] {
  if (value === undefined) return { status: "notGranted" };
  if (!isRecord(value) || !["notGranted", "granted", "revoked"].includes(String(value.status))) {
    throw new Error("Stored Research Egress Permission is invalid.");
  }
  return { status: value.status as LearningSession["researchEgressPermission"]["status"] };
}

function migrateResearchActions(value: unknown): ResearchAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored external research actions are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string"
      || !["focused", "workspace", "full"].includes(String(candidate.accessPolicy))
      || typeof candidate.destination !== "string" || !researchDestinationIsAllowed(candidate.destination)
      || !["learnerAuthored", "automaticCorroboration"].includes(String(candidate.queryOrigin))
      || !(candidate.researchDepth === undefined || ["lightweight", "deep"].includes(String(candidate.researchDepth)))
      || !Array.isArray(candidate.informedBySourceIds)
      || !candidate.informedBySourceIds.every((sourceId) => typeof sourceId === "string")
      || !["running", "completed", "denied", "timedOut", "failed", "stopped"].includes(String(candidate.status))
      || !(candidate.error === null || typeof candidate.error === "string")
      || !Array.isArray(candidate.excerpts) || !isRecord(candidate.query)) {
      throw new Error("Stored external research actions are invalid.");
    }
    const query = buildDerivedResearchQuery({
      theoremNames: candidate.query.theoremNames as string[],
      assumptions: candidate.query.assumptions as string[],
      keywords: candidate.query.keywords as string[]
    });
    const excerpts = candidate.excerpts.map((excerpt) => {
      if (!isRecord(excerpt) || typeof excerpt.sourceId !== "string"
        || !["excerpt", "equation", "selectedPages"].includes(String(excerpt.kind))
        || typeof excerpt.content !== "string" || !excerpt.content.trim()
        || typeof excerpt.location !== "string" || !excerpt.location.trim()
        || excerpt.relevance !== "learnerSelectedForQuery") {
        throw new Error("Stored external research actions are invalid.");
      }
      return excerpt as unknown as ResearchExcerpt;
    });
    const result = candidate.result === null ? null : validatedExternalResearchResult(candidate.result);
    const status = candidate.status as ResearchAction["status"];
    if (candidate.destination !== researchDestination(query, excerpts)
      || (status === "completed") !== (result !== null)
      || (["denied", "timedOut", "failed", "stopped"].includes(status) && typeof candidate.error !== "string")) {
      throw new Error("Stored external research actions are invalid.");
    }
    return {
      id: candidate.id,
      accessPolicy: candidate.accessPolicy as SessionAccessPolicy,
      query,
      queryOrigin: candidate.queryOrigin as ResearchAction["queryOrigin"],
      researchDepth: candidate.researchDepth === "deep" ? "deep" : "lightweight",
      informedBySourceIds: candidate.informedBySourceIds as string[],
      destination: candidate.destination,
      excerpts,
      status,
      result,
      error: candidate.error as string | null
    };
  });
}

function migrateCorroborationPass(value: unknown): CorroborationPass | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.id !== "string"
    || !(value.researchActionId === null || typeof value.researchActionId === "string")
    || !["running", "completed", "incomplete", "disputed"].includes(String(value.status))
    || typeof value.relevantResult !== "string" || !value.relevantResult.trim()
    || !isRecord(value.currentUse) || !Array.isArray(value.currentUse.assumptions)
    || !value.currentUse.assumptions.every((assumption) => typeof assumption === "string")
    || typeof value.currentUse.conclusion !== "string"
    || typeof value.pedagogicalBaselinePresent !== "boolean"
    || !["matches", "mismatch", "unchecked"].includes(String(value.assumptionComparison))
    || !["matches", "mismatch", "unchecked"].includes(String(value.conclusionComparison))
    || !["noneFound", "found", "unchecked"].includes(String(value.errataCheck))
    || !["sufficient", "weakOnly", "conflicting", "missing"].includes(String(value.independentSupport))
    || !["notRequired", "established", "incomplete"].includes(String(value.proofApproachResearch))
    || !isRecord(value.deeperResearch) || typeof value.deeperResearch.required !== "boolean"
    || !(value.deeperResearch.performed === undefined || typeof value.deeperResearch.performed === "boolean")
    || !(value.deeperResearch.reason === null || typeof value.deeperResearch.reason === "string")
    || !Array.isArray(value.evidence) || !Array.isArray(value.sourceDiscrepancies)
    || typeof value.message !== "string" || !value.message.trim()) {
    throw new Error("Stored Corroboration Pass is invalid.");
  }
  const evidence = validatedCorroborationResearchResult({
    relevantResult: value.relevantResult,
    errataCheck: "noneFound",
    proposedApproachDeparture: false,
    evidence: value.evidence
  }).evidence;
  const sourceDiscrepancies = value.sourceDiscrepancies.map((discrepancy) => {
    if (!isRecord(discrepancy) || typeof discrepancy.id !== "string"
      || typeof discrepancy.relevantResult !== "string" || !discrepancy.relevantResult.trim()
      || typeof discrepancy.summary !== "string" || !discrepancy.summary.trim()
      || !Array.isArray(discrepancy.competingEvidence)) {
      throw new Error("Stored Source Discrepancy is invalid.");
    }
    return {
      id: discrepancy.id,
      relevantResult: discrepancy.relevantResult,
      summary: discrepancy.summary,
      competingEvidence: validatedCorroborationResearchResult({
        relevantResult: discrepancy.relevantResult,
        errataCheck: "noneFound",
        proposedApproachDeparture: false,
        evidence: discrepancy.competingEvidence
      }).evidence
    };
  });
  return {
    id: value.id,
    researchActionId: value.researchActionId as string | null,
    status: value.status as CorroborationPass["status"],
    relevantResult: value.relevantResult,
    currentUse: {
      assumptions: value.currentUse.assumptions as string[],
      conclusion: value.currentUse.conclusion
    },
    pedagogicalBaselinePresent: value.pedagogicalBaselinePresent,
    assumptionComparison: value.assumptionComparison as CorroborationPass["assumptionComparison"],
    conclusionComparison: value.conclusionComparison as CorroborationPass["conclusionComparison"],
    errataCheck: value.errataCheck as CorroborationPass["errataCheck"],
    independentSupport: value.independentSupport as CorroborationPass["independentSupport"],
    proofApproachResearch: value.proofApproachResearch as CorroborationPass["proofApproachResearch"],
    deeperResearch: {
      required: value.deeperResearch.required,
      performed: value.deeperResearch.performed === true,
      reason: value.deeperResearch.reason as string | null
    },
    evidence,
    sourceDiscrepancies,
    message: value.message
  };
}

function migrateCorroborationPassHistory(value: unknown): CorroborationPass[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored Corroboration Pass history is invalid.");
  return value.map((pass) => {
    const migrated = migrateCorroborationPass(pass);
    if (!migrated) throw new Error("Stored Corroboration Pass history is invalid.");
    return migrated;
  });
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
  const id = crypto.randomUUID();
  return {
    id,
    instruction,
    status: "idle",
    content: "",
    error: null,
    retryable: false,
    contextUsed: [],
    agentWorkLogReference: null,
    claims: []
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
  if (session.refresherOf?.trailItemId) {
    const origin = state.sessions.find((candidate) => candidate.id === session.refresherOf?.originatingSessionId);
    const trailItem = origin?.consolidatedOutcome?.trailItems.find((item) => item.id === session.refresherOf?.trailItemId);
    if (trailItem) {
      items.push({
        id: `refresher-trail-item:${trailItem.id}`,
        kind: "sessionContext",
        typeLabel: "Linked Learning Trail point",
        identity: trailItem.content,
        location: "Originating Delayed Check Learning Session",
        preview: trailItem.content,
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
  if (anchor.selection.pageNumbers) {
    return `Selected pages ${anchor.selection.pageNumbers.join(", ")} at characters ${anchor.selection.startOffset}–${anchor.selection.endOffset}`;
  }
  return `${anchor.selection.kind === "equation" ? "Equation" : "Text"} at characters ${anchor.selection.startOffset}–${anchor.selection.endOffset}`;
}

function emptyTrailDraft(): TrailDraft {
  return { items: [] };
}

function emptyDelayedTransferDraft(): DelayedTransferDraft {
  return { work: "", reasoning: "", confidence: null, clarifications: [] };
}

type NewLearningSession = Pick<LearningSession,
  | "id" | "workspaceId" | "missionId" | "mathematics" | "sourceIds" | "learningGoal" | "sessionTarget"
  | "status" | "activityOrder" | "returnContext" | "proposal" | "accessPolicy"
> & Partial<Pick<LearningSession,
  | "currentTeachingInput" | "sourceAnchors" | "activeSourceAnchorId" | "learningSlice" | "prerequisiteBranch"
  | "continuationOf" | "refresherOf"
>>;

function createLearningSession(details: NewLearningSession): LearningSession {
  const initialMove = initialTeachingMove(details.proposal.initialTeachingDirection);
  return {
    ...details,
    teachingMoves: [initialMove],
    currentTeachingMove: initialMove,
    understandingChecks: [],
    understandingEvidence: [],
    teachingExperiments: [],
    interactionPreferences: [],
    evidenceTransferContext: null,
    evidenceTransfers: [],
    priorUnderstandingEvidence: [],
    interactionPreferenceReuses: [],
    ignoreLearnerModel: false,
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
    researchEgressPermission: { status: "notGranted" },
    researchActions: [],
    corroborationPass: null,
    corroborationPassHistory: [],
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
    refresherOf: details.refresherOf ?? null,
    learningSlice: details.learningSlice ?? null,
    conceptPeeks: [],
    pendingConceptPeek: null,
    prerequisiteBranchProposals: [],
    prerequisiteBranch: details.prerequisiteBranch ?? null,
    agentTasks: [],
    activeAgentTaskId: null,
    reasoningPreference: "balanced",
    runtimeOverride: null,
    verifierEnvironmentPinId: null
  };
}

function initialTeachingMove(direction: string): TeachingMove {
  return {
    id: crypto.randomUUID(),
    kind: "explain",
    route: "proofStructural",
    reason: `Begin with the current teaching direction: ${direction}`,
    evidenceIds: [],
    experimentId: null
  };
}

function appendTeachingMove(session: LearningSession, move: Omit<TeachingMove, "id">): void {
  const next = { id: crypto.randomUUID(), ...move };
  session.teachingMoves.push(next);
  session.currentTeachingMove = next;
}

function setAdaptiveTeachingMove(
  session: LearningSession,
  evidence: UnderstandingEvidence,
  prefix: string
): void {
  const policy = UNDERSTANDING_INTERPRETATION_POLICIES[evidence.interpretation];
  appendTeachingMove(session, {
    kind: policy.kind,
    route: evidence.representation,
    reason: `${prefix} ${policy.signal} in ${evidence.concept}; ${policy.direction}.`,
    evidenceIds: [evidence.id],
    experimentId: null
  });
}

function understandingEvidenceLedgerEntry(
  session: LearningSession,
  evidence: UnderstandingEvidence,
  confidence: LearnerModelConfidence
): LearnerModelLedgerEntry {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: "understandingEvidence",
    inference: UNDERSTANDING_INTERPRETATION_POLICIES[evidence.interpretation].summary,
    sourceEvidence: {
      sessionId: session.id, sourceRecordId: evidence.id, evidenceIds: [evidence.id], summary: evidence.response
    },
    mathematicalContext: evidence.evidenceTransferContext
      ? structuredClone(evidence.evidenceTransferContext)
      : { concepts: [evidence.concept], mathematicalStructures: [], prerequisiteRelationships: [], taskDemands: [] },
    scope: {
      workspaceId: session.workspaceId,
      missionId: session.missionId,
      sessionId: session.id,
      sessionTarget: session.sessionTarget
    },
    confidence,
    status: "active",
    correction: null,
    governanceHistory: [],
    createdAt: timestamp,
    lastUpdatedAt: timestamp
  };
}

function delayedTransferLedgerEntry(
  session: LearningSession,
  check: DelayedTransferCheck,
  evidence: DelayedTransferEvidence
): LearnerModelLedgerEntry {
  return {
    id: crypto.randomUUID(),
    kind: "understandingEvidence",
    inference: `delayed transfer shows ${evidence.reasoningQuality} reasoning`,
    sourceEvidence: {
      sessionId: session.id,
      sourceRecordId: evidence.id,
      evidenceIds: [evidence.id],
      summary: evidence.misconceptionOrStrength
    },
    mathematicalContext: structuredClone(evidence.mathematicalContext),
    scope: {
      workspaceId: session.workspaceId,
      missionId: session.missionId,
      sessionId: session.id,
      sessionTarget: session.sessionTarget
    },
    confidence: evidence.result === "demonstrated" && !evidence.assistanceUsed ? "high" : "medium",
    status: "active",
    correction: null,
    governanceHistory: [],
    createdAt: evidence.completedAt,
    lastUpdatedAt: evidence.completedAt
  };
}

function interactionPreferenceLedgerEntry(
  session: LearningSession,
  preference: InteractionPreference,
  outcome: Exclude<TeachingExperiment["outcome"], null>
): LearnerModelLedgerEntry {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind: "interactionPreference",
    inference: `${preference.route} route ${preference.status}`,
    sourceEvidence: {
      sessionId: session.id,
      sourceRecordId: preference.id,
      evidenceIds: [...preference.evidenceIds],
      summary: `The ${preference.route} Teaching Experiment was ${teachingExperimentOutcomeLabel(outcome)} for this context.`
    },
    mathematicalContext: structuredClone(session.understandingEvidence.find(
      (evidence) => preference.evidenceIds.includes(evidence.id) && evidence.evidenceTransferContext
    )?.evidenceTransferContext ?? {
      concepts: [preference.context.concept], mathematicalStructures: [],
      prerequisiteRelationships: [], taskDemands: [preference.context.task]
    }),
    scope: {
      workspaceId: session.workspaceId,
      missionId: session.missionId,
      sessionId: session.id,
      sessionTarget: session.sessionTarget
    },
    confidence: "medium",
    status: "active",
    correction: null,
    governanceHistory: [],
    createdAt: timestamp,
    lastUpdatedAt: timestamp
  };
}

function eligibleEvidenceTransfers(
  model: LearnerModel,
  targetSession: LearningSession,
  targetContext: EvidenceTransferContext
): EvidenceTransfer[] {
  return model.entries.filter((entry) => entry.kind === "understandingEvidence"
    && learnerModelEntryMayGuide(model, entry)
    && (entry.scope.workspaceId !== targetSession.workspaceId || entry.scope.missionId !== targetSession.missionId)
    && isCompleteEvidenceTransferContext(entry.mathematicalContext)
    && evidenceTransferContextsMatch(entry.mathematicalContext, targetContext))
    .map((entry) => ({ ...learnerModelReuseRecord(entry, targetContext), origin: "transferred" }));
}

function eligiblePriorUnderstandingEvidence(
  model: LearnerModel,
  targetSession: LearningSession,
  targetContext: EvidenceTransferContext
): PriorUnderstandingEvidence[] {
  return model.entries.filter((entry) => entry.kind === "understandingEvidence"
    && learnerModelEntryMayGuide(model, entry)
    && entry.scope.sessionId !== targetSession.id
    && entry.scope.workspaceId === targetSession.workspaceId
    && entry.scope.missionId === targetSession.missionId
    && isCompleteEvidenceTransferContext(entry.mathematicalContext)
    && evidenceTransferContextsMatch(entry.mathematicalContext, targetContext))
    .map((entry) => ({ ...learnerModelReuseRecord(entry, targetContext), origin: "priorSession" }));
}

function eligibleInteractionPreferenceReuses(
  model: LearnerModel,
  targetSession: LearningSession,
  targetContext: EvidenceTransferContext
): InteractionPreferenceReuse[] {
  return model.entries.filter((entry) => entry.kind === "interactionPreference"
    && learnerModelEntryMayGuide(model, entry)
    && entry.scope.sessionId !== targetSession.id
    && isCompleteEvidenceTransferContext(entry.mathematicalContext)
    && evidenceTransferContextsMatch(entry.mathematicalContext, targetContext))
    .map((entry) => ({ ...learnerModelReuseRecord(entry, targetContext), origin: "interactionPreference" }));
}

function learnerModelReuseRecord(
  entry: LearnerModelLedgerEntry,
  targetContext: EvidenceTransferContext
): LearnerModelReuseRecord {
  return {
    id: crypto.randomUUID(),
    learnerModelEntryId: entry.id,
    sourceSessionId: entry.sourceEvidence.sessionId,
    sourceRecordId: entry.sourceEvidence.sourceRecordId,
    inference: entry.inference,
    confidence: entry.confidence,
    sourceContext: structuredClone(entry.mathematicalContext),
    targetContext: structuredClone(targetContext),
    provenance: {
      workspaceId: entry.scope.workspaceId,
      missionId: entry.scope.missionId,
      sessionTarget: entry.scope.sessionTarget,
      summary: entry.sourceEvidence.summary,
      lastUpdatedAt: entry.lastUpdatedAt
    }
  };
}

function evidenceTransferContextsMatch(source: EvidenceTransferContext, target: EvidenceTransferContext): boolean {
  const scalarFields: Array<"concepts" | "mathematicalStructures" | "taskDemands"> = [
    "concepts", "mathematicalStructures", "taskDemands"
  ];
  const scalarMatch = scalarFields.every((field) => {
    const sourceTerms = new Set(source[field].map(normalizeTransferTerm));
    return target[field].some((term) => sourceTerms.has(normalizeTransferTerm(term)));
  });
  const sourceRelationships = new Set(source.prerequisiteRelationships.map(normalizePrerequisiteRelationship));
  return scalarMatch && target.prerequisiteRelationships.some(
    (relationship) => sourceRelationships.has(normalizePrerequisiteRelationship(relationship))
  );
}

function normalizePrerequisiteRelationship(
  relationship: EvidenceTransferContext["prerequisiteRelationships"][number]
): string {
  return [relationship.prerequisiteConcept, relationship.relationship, relationship.supportsConcept]
    .map(normalizeTransferTerm).join("::");
}

function normalizeTransferTerm(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function learnerModelGuidance(
  model: LearnerModel,
  session: LearningSession
): { learnerModelGuidance: {
  evidenceTransfers: EvidenceTransfer[];
  priorUnderstandingEvidence: PriorUnderstandingEvidence[];
  interactionPreferences: InteractionPreferenceReuse[];
} } | Record<string, never> {
  if (!model.adaptiveReuseEnabled || session.ignoreLearnerModel) return {};
  const activeEntryIds = new Set(model.entries.filter((entry) => learnerModelEntryMayGuide(model, entry))
    .map((entry) => entry.id));
  const evidenceTransfers = session.evidenceTransfers.filter((transfer) => activeEntryIds.has(transfer.learnerModelEntryId));
  const priorUnderstandingEvidence = session.priorUnderstandingEvidence
    .filter((evidence) => activeEntryIds.has(evidence.learnerModelEntryId));
  const interactionPreferences = session.interactionPreferenceReuses
    .filter((preference) => activeEntryIds.has(preference.learnerModelEntryId));
  return evidenceTransfers.length + priorUnderstandingEvidence.length + interactionPreferences.length > 0
    ? { learnerModelGuidance: structuredClone({ evidenceTransfers, priorUnderstandingEvidence, interactionPreferences }) }
    : {};
}

function learnerModelEntryMayGuide(model: LearnerModel, entry: LearnerModelLedgerEntry): boolean {
  if (entry.status !== "active") return false;
  if (entry.kind === "understandingEvidence") return true;
  return entry.sourceEvidence.evidenceIds.every((evidenceId) => model.entries.some(
    (candidate) => candidate.kind === "understandingEvidence" && candidate.status === "active"
      && candidate.sourceEvidence.evidenceIds.includes(evidenceId)
  ));
}

function adaptiveTeachingGuidance(
  model: LearnerModel,
  session: LearningSession
): { adaptiveTeaching: Pick<TeachingMove, "kind" | "route" | "reason"> } | Record<string, never> {
  const move = session.currentTeachingMove;
  if (move.evidenceIds.length > 0) {
    const activeEvidenceIds = new Set(model.entries.filter(
      (entry) => entry.kind === "understandingEvidence" && entry.status === "active"
    )
      .flatMap((entry) => entry.sourceEvidence.evidenceIds));
    if (move.evidenceIds.some((evidenceId) => !activeEvidenceIds.has(evidenceId))) return {};
  }
  if (move.experimentId) {
    const experiment = session.teachingExperiments.find((candidate) => candidate.id === move.experimentId);
    if (!experiment) return {};
    if (experiment.status === "completed") {
      const preference = session.interactionPreferences.find(
        (candidate) => candidate.experimentId === experiment.id
      );
      const preferenceActive = preference && model.entries.some((entry) => entry.kind === "interactionPreference"
        && entry.status === "active" && entry.sourceEvidence.sourceRecordId === preference.id);
      if (!preferenceActive) return {};
    }
  }
  return { adaptiveTeaching: { kind: move.kind, route: move.route, reason: move.reason } };
}

function requireLearnerModelEntry(model: LearnerModel, entryId: string): LearnerModelLedgerEntry {
  const entry = model.entries.find((candidate) => candidate.id === entryId);
  if (!entry) throw new Error("Choose an inference in the Learner Model Ledger.");
  return entry;
}

function requireLearnerModelConfidence(value: unknown): LearnerModelConfidence {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("Choose low, medium, or high Learner Model confidence.");
}

function validatedEvidenceTransferContext(value: unknown): EvidenceTransferContext {
  if (!isCompleteEvidenceTransferContext(value)) throw new Error("Evidence Transfer context is invalid.");
  return {
    concepts: requiredContextTerms(value.concepts, "concept"),
    mathematicalStructures: requiredContextTerms(value.mathematicalStructures, "mathematical structure"),
    prerequisiteRelationships: value.prerequisiteRelationships.map((relationship) => ({
      prerequisiteConcept: relationship.prerequisiteConcept.trim(),
      supportsConcept: relationship.supportsConcept.trim(),
      relationship: "requiredFor"
    })),
    taskDemands: requiredContextTerms(value.taskDemands, "task demand")
  };
}

function requiredContextTerms(value: unknown, subject: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Provide at least one ${subject} for Evidence Transfer.`);
  }
  return [...new Set(value.map((item) => (item as string).trim()))];
}

function understandingEvidenceSummary(evidence: UnderstandingEvidence): string {
  return `Understanding Evidence for ${evidence.concept}: ${UNDERSTANDING_INTERPRETATION_POLICIES[evidence.interpretation].summary}.`;
}

export function canOfferUnderstandingCheck(session: LearningSession): boolean {
  return (session.teachingCard.status === "completed" && Boolean(session.teachingCard.content.trim()))
    || session.anchoredTeachingCards.some((card) => card.currentRevision.status === "completed"
      && Boolean(card.currentRevision.content.trim()))
    || session.questionCards.some((card) => card.currentRevision.status === "completed"
      && Boolean(card.currentRevision.content.trim()));
}

function upsertUnderstandingEvidenceTrailItem(session: LearningSession, evidence: UnderstandingEvidence): void {
  upsertSuggestedTrailItem(session, `understanding-evidence:${evidence.id}`, "evidence", understandingEvidenceSummary(evidence), {
    ...emptyTrailItemLinks(),
    sourceAnchorIds: evidence.sourceContext.sourceAnchorId ? [evidence.sourceContext.sourceAnchorId] : [],
    understandingEvidenceIds: [evidence.id]
  });
}

function isUnderstandingCheckKind(value: unknown): value is UnderstandingCheckKind {
  return UNDERSTANDING_CHECK_KINDS.includes(value as UnderstandingCheckKind);
}

function requireUnderstandingInterpretation(value: unknown): UnderstandingInterpretation {
  if (value === "specificGap" || value === "secureUnderstanding" || value === "excessivePace") return value;
  throw new Error("Choose a contextual Understanding Evidence interpretation.");
}

function requireTeachingRoute(value: unknown): TeachingRoute {
  if (TEACHING_ROUTES.includes(value as TeachingRoute)) return value as TeachingRoute;
  throw new Error("Choose a contextual teaching route.");
}

function teachingMoveKindForRoute(route: TeachingRoute): TeachingMoveKind {
  if (route === "visual") return "visualize";
  if (route === "symbolic") return "compare";
  if (route === "exampleFirst") return "demonstrate";
  return "explain";
}

function isTeachingExperimentOutcome(value: unknown): value is Exclude<TeachingExperiment["outcome"], null> {
  return value === "helpful" || value === "notHelpful" || value === "inconclusive";
}

function interactionPreferenceStatus(outcome: Exclude<TeachingExperiment["outcome"], null>): InteractionPreference["status"] {
  return outcome === "helpful" ? "supported" : outcome === "notHelpful" ? "notSupported" : "uncertain";
}

function teachingExperimentOutcomeLabel(outcome: Exclude<TeachingExperiment["outcome"], null>): string {
  return outcome === "helpful" ? "helpful" : outcome === "notHelpful" ? "not helpful" : "inconclusive";
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
    specialistProgress: specialistBriefs.map(() => ({
      status: "pending", checkpoint: "", result: null, usedTokens: 0, usedLatencyMs: 0
    })),
    coordination,
    budget,
    integratedTeachingCard: {
      title: "Specialist review",
      status: "streaming",
      content: "",
      error: null,
      retryable: false
    },
    resumeAvailable: false,
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
  "consolidationDraft" | "consolidatedOutcome" | "delayedTransferOffer" | "continuationOf" | "refresherOf" | "modelStopConfirmation"
> {
  return {
    consolidationDraft: null,
    consolidatedOutcome: null,
    delayedTransferOffer: null,
    continuationOf: null,
    refresherOf: null,
    modelStopConfirmation: null
  };
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

function requireUnderstandingCheck(session: LearningSession, checkId: string): UnderstandingCheck {
  const check = session.understandingChecks.find((candidate) => candidate.id === checkId);
  if (!check) throw new Error("Choose an Understanding Check in the active Learning Session.");
  return check;
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
    return {
      ...candidate,
      currentRevision: migrateTeachingCardVerification(candidate.currentRevision),
      revisions: candidate.revisions.map(migrateTeachingCardVerification),
      variants: candidate.variants.map((variant) => ({
        ...(variant as TeachingVariant),
        revision: migrateTeachingCardVerification((variant as TeachingVariant).revision)
      }))
    } as unknown as AnchoredTeachingCard;
  });
}

function migrateTeachingCardVerification(value: unknown): TeachingCardRevision {
  if (!validTeachingCardRevision(value)) throw new Error("Stored anchored Teaching Cards are invalid.");
  const revision = value as TeachingCardRevision;
  return {
    ...revision,
    claims: migrateClaims(revision as unknown as Record<string, unknown>, revision.id, revision.content,
      revision.agentWorkLogReference ? [{
        kind: "agentWork",
        sessionId: revision.agentWorkLogReference.sessionId,
        fromSequence: revision.agentWorkLogReference.fromSequence,
        toSequence: revision.agentWorkLogReference.toSequence
      }] : [])
  };
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
    claims: migrateClaims(value, String(value.id), String(value.content), []),
    personalNoteContributions: migratePersonalNoteContributions(value.personalNoteContributions),
    provenance
  };
  if (!validLearningArtifactRevision(migrated)) throw new Error("Stored Learning Artifact revision is invalid.");
  return migrated as unknown as LearningArtifactRevision;
}

function migrateClaims(
  value: Record<string, unknown>, fallbackId: string, fallbackStatement: string, fallbackReferences: ClaimEvidenceReference[]
): ClaimVerificationState[] {
  if (Array.isArray(value.claims)) {
    if (!value.claims.every(validClaimVerificationState)) throw new Error("Stored claim verification evidence is invalid.");
    return structuredClone(value.claims);
  }
  return [{
    claimId: typeof value.claimId === "string" ? value.claimId : fallbackId,
    claimStatement: typeof value.claimStatement === "string" && value.claimStatement.trim()
      ? value.claimStatement : fallbackStatement,
    claimOrigin: isClaimOrigin(value.claimOrigin) ? value.claimOrigin : "modelGenerated",
    claimOriginReferences: Array.isArray(value.claimOriginReferences)
      && value.claimOriginReferences.every(validClaimEvidenceReference)
      ? structuredClone(value.claimOriginReferences) : structuredClone(fallbackReferences),
    ...migrateVerificationState(value)
  }];
}

function migrateVerificationState(value: Record<string, unknown>): ReturnType<typeof emptyVerificationState> {
  const hasAny = ["verificationEvidence", "verificationGaps", "verificationEscalation"].some((field) => field in value);
  if (!hasAny && (value.verificationLevel === undefined || value.verificationLevel === "notIndependentlyChecked")
    && (value.verificationCurrency === undefined || value.verificationCurrency === "current")) {
    return emptyVerificationState();
  }
  if (!isVerificationLevel(value.verificationLevel) || !isVerificationCurrency(value.verificationCurrency)
    || !Array.isArray(value.verificationEvidence) || !value.verificationEvidence.every(validClaimVerificationEvidence)
    || !Array.isArray(value.verificationGaps) || !value.verificationGaps.every(validVerificationGap)
    || !validVerificationEscalation(value.verificationEscalation)) {
    throw new Error("Stored claim verification evidence is invalid.");
  }
  return {
    verificationLevel: value.verificationLevel,
    verificationCurrency: value.verificationCurrency,
    verificationEvidence: structuredClone(value.verificationEvidence),
    verificationGaps: structuredClone(value.verificationGaps),
    verificationEscalation: structuredClone(value.verificationEscalation)
  };
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

function migrateDelayedTransferOffer(value: unknown): DelayedTransferOffer | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)
    || !["pending", "declined", "dismissed", "scheduled", "cancelled"].includes(String(value.status))
    || !validIsoTimestamp(value.offeredAt) || !validIsoTimestamp(value.proposedDueAt)
    || Date.parse(value.proposedDueAt as string) <= Date.parse(value.offeredAt as string)) {
    throw new Error("Stored Delayed Transfer offer is invalid.");
  }
  return structuredClone(value) as unknown as DelayedTransferOffer;
}

function migrateDelayedTransferChecks(value: unknown): DelayedTransferCheck[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(validDelayedTransferCheck)
    || new Set(value.map((check) => (check as DelayedTransferCheck).id)).size !== value.length) {
    throw new Error("Stored Delayed Transfer Checks are invalid.");
  }
  return (structuredClone(value) as Array<Partial<DelayedTransferCheck> & Omit<DelayedTransferCheck,
    "task" | "taskError" | "draft" | "evidence" | "result">>).map((check) => ({
    ...check,
    relevantSourceAnchorId: check.relevantSourceAnchorId ?? null,
    relevantTrailItemId: check.relevantTrailItemId ?? null,
    task: check.task ?? null,
    taskError: check.taskError ?? null,
    draft: check.draft ?? emptyDelayedTransferDraft(),
    evidence: check.evidence ?? null,
    result: check.result ?? null
  }));
}

function validDelayedTransferCheck(value: unknown): value is DelayedTransferCheck {
  return isRecord(value)
    && [value.id, value.relatedSessionId, value.relatedLearningSessionGoal,
      value.originatingSessionTarget, value.intendedTransferGoal]
      .every((item) => typeof item === "string" && Boolean(item.trim()))
    && Array.isArray(value.originatingConcepts)
    && value.originatingConcepts.length > 0
    && value.originatingConcepts.every((concept) => typeof concept === "string" && Boolean(concept.trim()))
    && new Set(value.originatingConcepts).size === value.originatingConcepts.length
    && [value.scheduledAt, value.updatedAt, value.dueAt].every(validIsoTimestamp)
    && Date.parse(value.dueAt as string) > Date.parse(value.scheduledAt as string)
    && ["scheduled", "preparing", "stopping", "inProgress", "completed", "skipped", "dismissed", "cancelled"].includes(String(value.status))
    && (value.relevantSourceAnchorId === undefined || value.relevantSourceAnchorId === null
      || typeof value.relevantSourceAnchorId === "string")
    && (value.relevantTrailItemId === undefined || value.relevantTrailItemId === null
      || typeof value.relevantTrailItemId === "string")
    && (value.task === undefined || value.task === null || validDelayedTransferTask(value.task))
    && (value.taskError === undefined || value.taskError === null || typeof value.taskError === "string")
    && (value.draft === undefined || validDelayedTransferDraft(value.draft))
    && (value.evidence === undefined || value.evidence === null || validDelayedTransferEvidence(value.evidence))
    && (value.result === undefined || value.result === null || validDelayedCheckResult(value.result))
    && (value.status !== "inProgress" || validDelayedTransferTask(value.task))
    && (value.status !== "completed" || (validDelayedTransferEvidence(value.evidence) && validDelayedCheckResult(value.result)));
}

function validDelayedTransferDraft(value: unknown): value is DelayedTransferDraft {
  return isRecord(value) && typeof value.work === "string" && typeof value.reasoning === "string"
    && (value.confidence === null || ["low", "medium", "high"].includes(String(value.confidence)))
    && Array.isArray(value.clarifications) && value.clarifications.every((entry) => isRecord(entry)
      && typeof entry.question === "string" && Boolean(entry.question.trim())
      && typeof entry.response === "string" && Boolean(entry.response.trim())
      && validIsoTimestamp(entry.requestedAt));
}

function validDelayedTransferEvidence(value: unknown): value is DelayedTransferEvidence {
  return isRecord(value) && [value.id, value.checkId, value.originatingSessionId, value.misconceptionOrStrength,
    value.recommendedNextAction].every((field) => typeof field === "string" && Boolean(field.trim()))
    && validIsoTimestamp(value.dueAt) && validIsoTimestamp(value.completedAt)
    && typeof value.scheduledDelayMs === "number" && value.scheduledDelayMs > 0
    && typeof value.completionDelayMs === "number" && value.completionDelayMs >= 0
    && validDelayedTransferTask(value.task)
    && isCompleteEvidenceTransferContext(value.mathematicalContext)
    && typeof value.work === "string" && typeof value.reasoning === "string"
    && (value.confidence === null || ["low", "medium", "high"].includes(String(value.confidence)))
    && typeof value.assistanceUsed === "boolean"
    && ["demonstrated", "partial", "difficulty"].includes(String(value.result))
    && ["strong", "developing", "unclear"].includes(String(value.reasoningQuality))
    && ["aligned", "overconfident", "underconfident", "notExpressed"].includes(String(value.confidenceCalibration));
}

function validDelayedCheckResult(value: unknown): value is DelayedCheckResult {
  return isRecord(value) && typeof value.evidenceId === "string" && Boolean(value.evidenceId)
    && (value.refresherOffer === null || (isRecord(value.refresherOffer)
      && ["pending", "accepted", "declined"].includes(String(value.refresherOffer.status))
      && typeof value.refresherOffer.goal === "string" && Boolean(value.refresherOffer.goal.trim())
      && (value.refresherOffer.refresherSessionId === null || typeof value.refresherOffer.refresherSessionId === "string")));
}

function validDelayedTransferTask(value: unknown): value is DelayedTransferTask {
  return isRecord(value) && [value.prompt, value.concept, value.taskDemand, value.structuralComparison]
    .every((field) => typeof field === "string" && Boolean(field.trim()))
    && isCompleteEvidenceTransferContext(value.mathematicalContext)
    && value.mathematicalContext.concepts.includes(value.concept as string)
    && value.mathematicalContext.taskDemands.includes(value.taskDemand as string);
}

function validatedDelayedTransferTask(
  value: unknown,
  originatingMathematics: string,
  originatingContext: EvidenceTransferContext | null,
  originatingConcepts: string[]
): DelayedTransferTask {
  const sharesUnderlyingConcept = validDelayedTransferTask(value)
    && value.mathematicalContext.concepts.some((concept) => originatingConcepts.some((originatingConcept) =>
      normalizedSemanticText(concept) === normalizedSemanticText(originatingConcept)));
  const novelConditions = validDelayedTransferTask(value) && originatingContext
    ? [
        ...materiallyNovelDescriptions(
          value.mathematicalContext.mathematicalStructures,
          originatingContext.mathematicalStructures
        ),
        ...materiallyNovelDescriptions(value.mathematicalContext.taskDemands, originatingContext.taskDemands)
      ]
    : validDelayedTransferTask(value) ? [value.structuralComparison] : [];
  const changesGroundedConditions = validDelayedTransferTask(value)
    && novelConditions.some((description) => descriptionGroundedInPrompt(description, value.prompt));
  const repeatsOriginalWording = validDelayedTransferTask(value)
    && (normalizedSemanticText(value.prompt) === normalizedSemanticText(originatingMathematics)
      || normalizedSemanticText(value.prompt).includes(normalizedSemanticText(originatingMathematics))
      || value.prompt.toLocaleLowerCase().includes(originatingMathematics.trim().toLocaleLowerCase())
      || semanticTokenSimilarity(value.prompt, originatingMathematics) >= 0.8
      || semanticTokenContainment(value.prompt, originatingMathematics) >= 0.75);
  if (!validDelayedTransferTask(value)
    || !sharesUnderlyingConcept
    || !changesGroundedConditions
    || repeatsOriginalWording) {
    throw new Error("Codex returned an invalid Delayed Transfer task. Retry to request a fresh task.");
  }
  return structuredClone(value);
}

function materiallyNovelDescriptions(candidate: string[], originating: string[]): string[] {
  const normalizedOriginating = new Set(originating.map(normalizedSemanticText));
  return candidate.filter((description) => !normalizedOriginating.has(normalizedSemanticText(description)));
}

function normalizedSemanticText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const DELAYED_TRANSFER_GENERIC_WORDS = new Set([
  "apply", "argument", "derive", "fresh", "global", "mathematical", "method", "problem", "proof", "strategy",
  "structure", "task", "transfer", "using"
]);

function semanticTokens(value: string): Set<string> {
  return new Set(normalizedSemanticText(value).split(" ")
    .filter((token) => token.length >= 4 && !DELAYED_TRANSFER_GENERIC_WORDS.has(token))
    .map((token) => token === "finitely" ? "finite" : token.slice(0, 5)));
}

function descriptionGroundedInPrompt(description: string, prompt: string): boolean {
  const descriptionTokens = semanticTokens(description);
  if (descriptionTokens.size === 0) return false;
  const promptTokens = semanticTokens(prompt);
  const matches = [...descriptionTokens].filter((token) => promptTokens.has(token)).length;
  return matches >= Math.min(2, descriptionTokens.size);
}

function semanticTokenSimilarity(left: string, right: string): number {
  const leftTokens = semanticTokens(left);
  const rightTokens = semanticTokens(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) return normalizedSemanticText(left) === normalizedSemanticText(right) ? 1 : 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / union.size;
}

function semanticTokenContainment(candidate: string, originating: string): number {
  const candidateTokens = semanticTokens(candidate);
  const originatingTokens = semanticTokens(originating);
  if (originatingTokens.size === 0) {
    return normalizedSemanticText(candidate).includes(normalizedSemanticText(originating)) ? 1 : 0;
  }
  return [...originatingTokens].filter((token) => candidateTokens.has(token)).length / originatingTokens.size;
}

function requiredDelayedTransferConfidence(
  value: LearnerModelConfidence | null
): LearnerModelConfidence | null {
  if (value === null || value === "low" || value === "medium" || value === "high") return value;
  throw new Error("Choose low, medium, or high confidence, or leave confidence unexpressed.");
}

function validatedDelayedTransferAssessment(value: unknown): DelayedTransferAssessment {
  if (!isRecord(value)
    || !["demonstrated", "partial", "difficulty"].includes(String(value.result))
    || !["strong", "developing", "unclear"].includes(String(value.reasoningQuality))
    || !["aligned", "overconfident", "underconfident", "notExpressed"].includes(String(value.confidenceCalibration))
    || typeof value.misconceptionOrStrength !== "string" || !value.misconceptionOrStrength.trim()
    || typeof value.recommendedNextAction !== "string" || !value.recommendedNextAction.trim()
    || !(value.refresherGoal === null || (typeof value.refresherGoal === "string" && Boolean(value.refresherGoal.trim())))) {
    throw new Error("Codex returned an invalid Delayed Check Result. Retry the assessment.");
  }
  return structuredClone(value) as unknown as DelayedTransferAssessment;
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

function migrateRefresherLink(value: unknown): RefresherLink | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || [value.checkId, value.evidenceId, value.originatingSessionId]
    .some((field) => typeof field !== "string" || !field)
    || !(value.sourceAnchorId === null || typeof value.sourceAnchorId === "string")
    || !(value.trailItemId === null || typeof value.trailItemId === "string")
    || (value.sourceAnchorId === null && value.trailItemId === null)) {
    throw new Error("Stored Refresher Session link is invalid.");
  }
  return value as unknown as RefresherLink;
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
    if (session.refresherOf) {
      const check = state.delayedTransferChecks.find((candidate) => candidate.id === session.refresherOf?.checkId);
      if (!check?.evidence || check.evidence.id !== session.refresherOf.evidenceId
        || check.relatedSessionId !== session.refresherOf.originatingSessionId
        || check.relevantSourceAnchorId !== session.refresherOf.sourceAnchorId
        || check.relevantTrailItemId !== session.refresherOf.trailItemId
        || check.result?.refresherOffer?.status !== "accepted"
        || check.result.refresherOffer.refresherSessionId !== session.id
        || (session.refresherOf.sourceAnchorId !== null
          && !session.sourceAnchors.some((anchor) => anchor.id === session.refresherOf?.sourceAnchorId))) {
        throw new Error("Stored Refresher Session link is invalid.");
      }
    }
  }
}

function validateDelayedTransferReferences(state: LearningApplicationState): void {
  const scheduledSessionIds = new Set<string>();
  for (const check of state.delayedTransferChecks) {
    const session = state.sessions.find((candidate) => candidate.id === check.relatedSessionId);
    if (!session || session.status !== "consolidated"
      || session.consolidatedOutcome?.targetDisposition !== "addressed") {
      throw new Error("Stored Delayed Transfer Check references an ineligible Learning Session.");
    }
    const originatingConcepts = delayedTransferConcepts(session);
    if (check.relatedLearningSessionGoal !== session.learningGoal
      || check.originatingSessionTarget !== session.sessionTarget
      || check.originatingConcepts.length !== originatingConcepts.length
      || check.originatingConcepts.some((concept, index) => concept !== originatingConcepts[index])) {
      throw new Error("Stored Delayed Transfer Check origin does not match its Learning Session.");
    }
    if ((check.relevantSourceAnchorId === null && check.relevantTrailItemId === null)
      || (check.relevantSourceAnchorId !== null
        && !session.sourceAnchors.some((anchor) => anchor.id === check.relevantSourceAnchorId))
      || (check.relevantTrailItemId !== null
        && !session.consolidatedOutcome.trailItems.some((item) => item.id === check.relevantTrailItemId))) {
      throw new Error("Stored Delayed Transfer Check context link is invalid.");
    }
    if (check.status === "completed" && check.evidence && check.result
      && (check.evidence.checkId !== check.id
        || check.evidence.originatingSessionId !== check.relatedSessionId
        || check.evidence.dueAt !== check.dueAt
        || check.result.evidenceId !== check.evidence.id
        || JSON.stringify(check.evidence.task) !== JSON.stringify(check.task)
        || JSON.stringify(check.evidence.mathematicalContext) !== JSON.stringify(check.task?.mathematicalContext))) {
      throw new Error("Stored Delayed Transfer Evidence does not match its check.");
    }
    if (check.status === "scheduled" || check.status === "preparing" || check.status === "stopping" || check.status === "inProgress") {
      if (scheduledSessionIds.has(session.id)) {
        throw new Error("Stored Delayed Transfer Checks contain a duplicate addressed Session Target.");
      }
      scheduledSessionIds.add(session.id);
      if (session.delayedTransferOffer?.status !== "scheduled") {
        throw new Error("Stored Delayed Transfer Check does not match its offer state.");
      }
    }
    if (check.status === "cancelled" && session.delayedTransferOffer?.status !== "cancelled") {
      throw new Error("Stored cancelled Delayed Transfer Check does not match its offer state.");
    }
  }
  for (const session of state.sessions) {
    if (session.delayedTransferOffer && (session.status !== "consolidated"
      || session.consolidatedOutcome?.targetDisposition !== "addressed")) {
      throw new Error("Stored Delayed Transfer offer references an ineligible Learning Session.");
    }
    const matchingChecks = state.delayedTransferChecks.filter((check) => check.relatedSessionId === session.id);
    const offerStatus = session.delayedTransferOffer?.status;
    const checkMatchesOffer = offerStatus === "scheduled"
      ? matchingChecks.length === 1 && ["scheduled", "preparing", "stopping", "inProgress", "completed", "skipped", "dismissed"]
        .includes(matchingChecks[0].status)
      : offerStatus === "cancelled"
        ? matchingChecks.length === 1 && matchingChecks[0].status === "cancelled"
        : true;
    if (!checkMatchesOffer) {
      throw new Error("Stored Delayed Transfer offer does not match its check state.");
    }
  }
  if (state.activeDelayedTransferCheckId !== null) {
    const active = state.delayedTransferChecks.find((check) => check.id === state.activeDelayedTransferCheckId);
    if (!active || (active.status !== "inProgress" && active.status !== "completed")) {
      throw new Error("Stored active Delayed Transfer Check is invalid.");
    }
  }
}

function ensureDelayedTransferContextLinks(state: LearningApplicationState): void {
  for (const check of state.delayedTransferChecks) {
    const session = state.sessions.find((candidate) => candidate.id === check.relatedSessionId);
    if (!session?.consolidatedOutcome) continue;
    const contextKey = `delayed-transfer-context:${session.id}`;
    let item = session.consolidatedOutcome.trailItems.find((candidate) => candidate.curationKey === contextKey);
    if (!item) {
      item = {
        id: `delayed-transfer-context-${check.id}`,
        kind: "reasoningStep",
        content: [
          session.consolidatedOutcome.centralInsight,
          `Transfer concepts: ${check.originatingConcepts.join(", ")}.`,
          `Intended next step: ${session.consolidatedOutcome.nextStep}`
        ].join(" "),
        required: false,
        origin: "teachingAgent",
        links: { sourceAnchorIds: [], teachingCardIds: [], learningArtifactIds: [], understandingEvidenceIds: [] },
        curationKey: contextKey
      };
      session.trailDraft.items.push(structuredClone(item));
      session.consolidatedOutcome.trailItems.push(item);
    }
    check.relevantSourceAnchorId ??= null;
    check.relevantTrailItemId = item.id;
  }
}

function recoverInterruptedDelayedTransferPreparations(state: LearningApplicationState): void {
  for (const check of state.delayedTransferChecks) {
    if (check.status !== "preparing" && check.status !== "stopping") continue;
    check.status = "scheduled";
    check.task = null;
    check.taskError = "Task preparation stopped when Quick Study closed. Start the check again when you are ready.";
    check.updatedAt = new Date().toISOString();
    if (state.activeDelayedTransferCheckId === check.id) state.activeDelayedTransferCheckId = null;
  }
}

function validTrailItemLinks(value: unknown): value is TrailItemLinks {
  return isRecord(value) && [
    value.sourceAnchorIds,
    value.teachingCardIds,
    value.learningArtifactIds,
    value.understandingEvidenceIds
  ].every((identifiers) => Array.isArray(identifiers) && identifiers.every((identifier) => typeof identifier === "string"));
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
      && Number.isInteger(value.agentWorkLogReference.fromSequence) && Number.isInteger(value.agentWorkLogReference.toSequence)))
    && (value.claims === undefined || (Array.isArray(value.claims) && value.claims.every(validClaimVerificationState)));
}

function validLearningArtifactRevision(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.content === "string"
    && Array.isArray(value.claims) && value.claims.length > 0 && value.claims.every(validClaimVerificationState)
    && Array.isArray(value.personalNoteContributions) && value.personalNoteContributions.every(validPersonalNoteContribution)
    && validLearningArtifactRevisionProvenance(value.provenance);
}

function validClaimVerificationState(value: unknown): value is ClaimVerificationState {
  return isRecord(value) && typeof value.claimId === "string" && Boolean(value.claimId)
    && typeof value.claimStatement === "string" && Boolean(value.claimStatement.trim())
    && isClaimOrigin(value.claimOrigin) && Array.isArray(value.claimOriginReferences)
    && value.claimOriginReferences.every(validClaimEvidenceReference) && isVerificationLevel(value.verificationLevel)
    && isVerificationCurrency(value.verificationCurrency)
    && Array.isArray(value.verificationEvidence) && value.verificationEvidence.every(validClaimVerificationEvidence)
    && Array.isArray(value.verificationGaps) && value.verificationGaps.every(validVerificationGap)
    && validVerificationEscalation(value.verificationEscalation);
}

function isClaimOrigin(value: unknown): value is ClaimOrigin {
  return ["learner", "suppliedSource", "modelGenerated", "mixed"].includes(String(value));
}

function isVerificationLevel(value: unknown): value is VerificationLevel {
  return ["notIndependentlyChecked", "reasoningReviewed", "sourceGrounded", "independentlyCorroborated", "formallyVerified"]
    .includes(String(value));
}

function isVerificationCurrency(value: unknown): value is VerificationCurrency {
  return value === "current" || value === "changedSinceCheck";
}

function validClaimVerificationEvidence(value: unknown): value is ClaimVerificationEvidence {
  return isRecord(value) && typeof value.id === "string" && Boolean(value.id)
    && ["reasoningReview", "sourceGrounded", "independentCorroboration", "formalVerification"].includes(String(value.method))
    && ["supports", "disagrees", "unresolved"].includes(String(value.outcome))
    && typeof value.summary === "string" && Boolean(value.summary.trim())
    && (value.limitation === null || (typeof value.limitation === "string" && Boolean(value.limitation.trim())))
    && validClaimEvidenceReference(value.reference) && isVerificationCurrency(value.currency)
    && (value.changedBecause === null || (typeof value.changedBecause === "string" && Boolean(value.changedBecause.trim())))
    && typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt))
    && new Date(value.createdAt).toISOString() === value.createdAt;
}

function validVerificationGap(value: unknown): value is VerificationGap {
  return isRecord(value) && typeof value.id === "string" && Boolean(value.id)
    && typeof value.reason === "string" && Boolean(value.reason.trim())
    && typeof value.affectedConclusion === "string" && Boolean(value.affectedConclusion.trim())
    && typeof value.evidenceId === "string" && Boolean(value.evidenceId);
}

function validVerificationEscalation(value: unknown): value is VerificationEscalation {
  return isRecord(value) && typeof value.recommended === "boolean" && Array.isArray(value.reasons)
    && value.reasons.every((reason) => typeof reason === "string" && Boolean(reason.trim()))
    && (value.recommended || value.reasons.length === 0);
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
    suffix: value.suffix,
    ...(value.pageNumbers === undefined ? {} : { pageNumbers: validatedPageNumbers(value.pageNumbers) })
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

function validatedPageNumbers(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12
    || !value.every((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0)
    || new Set(value).size !== value.length
    || value.some((pageNumber, index) => index > 0 && pageNumber <= value[index - 1])) {
    throw new Error("Selected pages require 1–12 unique ascending page numbers.");
  }
  return value as number[];
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
            suffix,
            ...(selection.pageNumbers ? { pageNumbers: [page.pageNumber] } : {})
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
    verifierManifests: [],
    verifierEnvironment: defaultVerifierEnvironmentState(),
    delayedTransferChecks: [],
    activeDelayedTransferCheckId: null,
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
    personalNoteSynthesisPreference: { includePersonalNotes: true },
    sourceExcerptEgressPreference: { enabled: false },
    learnerModel: { entries: [], adaptiveReuseEnabled: true, lastResetAt: null }
  };
}

function defaultVerifierEnvironmentState(): VerifierEnvironmentState {
  return {
    status: "absent",
    environment: BUNDLED_LEAN_ENVIRONMENT,
    defaultEnvironment: BUNDLED_LEAN_ENVIRONMENT,
    activeEnvironmentId: null,
    environments: [],
    installedBytes: 0,
    lastRemovedLogicalBytes: 0,
    error: null
  };
}

function migrateVerifierEnvironmentState(value: unknown, manifests: VerifierManifest[] = []): VerifierEnvironmentState {
  if (!isRecord(value)) return defaultVerifierEnvironmentState();
  const status = ["installed", "absent", "installing", "removing", "installFailed", "removeFailed", "cleanupRequired"]
    .includes(String(value.status)) ? value.status as VerifierEnvironmentState["status"] : "cleanupRequired";
  const storedEnvironments = Array.isArray(value.environments)
    ? value.environments.filter(validRegisteredVerifierEnvironment) : [];
  const legacyInstalledBytes = typeof value.installedBytes === "number" && value.installedBytes >= 0 ? value.installedBytes : 0;
  const environments = storedEnvironments.length > 0 ? storedEnvironments.map((entry) => ({
    ...entry,
    manifestReferences: manifests.filter((manifest) => manifest.environment.id === entry.environment.id).length
  })) : status === "installed" ? [{
    environment: BUNDLED_LEAN_ENVIRONMENT,
    installedBytes: legacyInstalledBytes,
    pinned: false,
    manifestReferences: manifests.filter((manifest) => manifest.environment.id === BUNDLED_LEAN_ENVIRONMENT.id).length
  }] : [];
  const storedActive = typeof value.activeEnvironmentId === "string" ? value.activeEnvironmentId : null;
  const active = environments.find((entry) => entry.environment.id === storedActive)
    ?? (status === "installed" ? environments[0] ?? null : null);
  return {
    status,
    environment: active?.environment ?? BUNDLED_LEAN_ENVIRONMENT,
    defaultEnvironment: BUNDLED_LEAN_ENVIRONMENT,
    activeEnvironmentId: active?.environment.id ?? null,
    environments,
    installedBytes: active?.installedBytes ?? legacyInstalledBytes,
    lastRemovedLogicalBytes: typeof value.lastRemovedLogicalBytes === "number" && value.lastRemovedLogicalBytes >= 0
      ? value.lastRemovedLogicalBytes
      : typeof value.lastReclaimedBytes === "number" && value.lastReclaimedBytes >= 0 ? value.lastReclaimedBytes : 0,
    error: typeof value.error === "string" ? value.error : null
  };
}

function validRegisteredVerifierEnvironment(value: unknown): value is RegisteredVerifierEnvironment {
  if (!isRecord(value) || !isRecord(value.environment)) return false;
  const environment = value.environment;
  return [environment.id, environment.checker, environment.leanVersion, environment.mathlibVersion, environment.mathlibCommit,
    environment.platform, environment.architecture, environment.sourceArchive, environment.sourceSha256, environment.supportProfile]
    .every((item) => typeof item === "string" && Boolean(item.trim()))
    && Array.isArray(environment.mathlibModules) && environment.mathlibModules.every((item) => typeof item === "string")
    && typeof environment.runtimeFormat === "number" && Number.isFinite(environment.runtimeFormat)
    && typeof value.installedBytes === "number" && value.installedBytes >= 0
    && typeof value.pinned === "boolean";
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

function legacyInitialTeachingMove(sessionId: string, proposal: LearningSession["proposal"]): TeachingMove {
  return {
    id: `legacy-teaching-move-${sessionId}`,
    kind: "explain",
    route: "proofStructural",
    reason: `Begin with the current teaching direction: ${proposal.initialTeachingDirection}`,
    evidenceIds: [],
    experimentId: null
  };
}

function migrateTeachingMoves(value: unknown, sessionId: string, proposal: LearningSession["proposal"]): TeachingMove[] {
  if (value === undefined) return [legacyInitialTeachingMove(sessionId, proposal)];
  if (!Array.isArray(value) || value.length === 0 || !value.every(validTeachingMove)) {
    throw new Error("Stored Teaching Moves are invalid.");
  }
  return structuredClone(value);
}

function migrateCurrentTeachingMove(
  value: unknown,
  moves: unknown,
  sessionId: string,
  proposal: LearningSession["proposal"]
): TeachingMove {
  if (value === undefined) {
    return Array.isArray(moves) && moves.length > 0 ? structuredClone(moves.at(-1) as TeachingMove)
      : legacyInitialTeachingMove(sessionId, proposal);
  }
  if (!validTeachingMove(value)) throw new Error("Stored current Teaching Move is invalid.");
  return structuredClone(value);
}

function validTeachingMove(value: unknown): value is TeachingMove {
  return isRecord(value) && typeof value.id === "string" && Boolean(value.id)
    && ["explain", "demonstrate", "apply", "compare", "slowDown", "visualize"].includes(String(value.kind))
    && TEACHING_ROUTES.includes(value.route as TeachingRoute)
    && typeof value.reason === "string" && Boolean(value.reason.trim())
    && Array.isArray(value.evidenceIds) && value.evidenceIds.every((id) => typeof id === "string")
    && (value.experimentId === null || typeof value.experimentId === "string");
}

function migrateUnderstandingChecks(value: unknown): UnderstandingCheck[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((check) => isRecord(check)
    && typeof check.id === "string" && isUnderstandingCheckKind(check.kind)
    && typeof check.prompt === "string" && Boolean(check.prompt.trim())
    && typeof check.concept === "string" && Boolean(check.concept.trim())
    && TEACHING_ROUTES.includes(check.representation as TeachingRoute)
    && isRecord(check.sourceContext)
    && (check.sourceContext.sourceAnchorId === null || typeof check.sourceContext.sourceAnchorId === "string")
    && Array.isArray(check.sourceContext.sourceIds) && check.sourceContext.sourceIds.every((id) => typeof id === "string")
    && (check.evidenceTransferContext === undefined || check.evidenceTransferContext === null
      || isEvidenceTransferContext(check.evidenceTransferContext))
    && typeof check.teachingMoveId === "string"
    && ["offered", "answered", "skipped"].includes(String(check.status)))) {
    throw new Error("Stored Understanding Checks are invalid.");
  }
  return value.map((check) => ({
    ...structuredClone(check),
    evidenceTransferContext: check.evidenceTransferContext
      ? structuredClone(check.evidenceTransferContext) : null
  })) as UnderstandingCheck[];
}

function migrateUnderstandingEvidence(value: unknown): UnderstandingEvidence[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((evidence) => isRecord(evidence)
    && typeof evidence.id === "string" && typeof evidence.checkId === "string"
    && typeof evidence.response === "string" && Boolean(evidence.response.trim())
    && typeof evidence.concept === "string" && Boolean(evidence.concept.trim())
    && typeof evidence.task === "string" && Boolean(evidence.task.trim())
    && TEACHING_ROUTES.includes(evidence.representation as TeachingRoute)
    && isRecord(evidence.sourceContext)
    && (evidence.sourceContext.sourceAnchorId === null || typeof evidence.sourceContext.sourceAnchorId === "string")
    && Array.isArray(evidence.sourceContext.sourceIds) && evidence.sourceContext.sourceIds.every((id) => typeof id === "string")
    && (evidence.evidenceTransferContext === undefined || evidence.evidenceTransferContext === null
      || isEvidenceTransferContext(evidence.evidenceTransferContext))
    && typeof evidence.elicitingTeachingMoveId === "string"
    && ["specificGap", "secureUnderstanding", "excessivePace"].includes(String(evidence.interpretation))
    && (evidence.learnerCorrection === null || typeof evidence.learnerCorrection === "string"))) {
    throw new Error("Stored Understanding Evidence is invalid.");
  }
  return value.map((evidence) => ({
    ...structuredClone(evidence),
    evidenceTransferContext: evidence.evidenceTransferContext
      ? structuredClone(evidence.evidenceTransferContext) : null
  })) as UnderstandingEvidence[];
}

function migrateLearnerModel(value: unknown): LearnerModel {
  if (value === undefined) return { entries: [], adaptiveReuseEnabled: true, lastResetAt: null };
  if (!isRecord(value) || typeof value.adaptiveReuseEnabled !== "boolean"
    || !(value.lastResetAt === null || validIsoTimestamp(value.lastResetAt))
    || !Array.isArray(value.entries) || !value.entries.every(validLearnerModelLedgerEntry)
    || new Set(value.entries.map((entry) => (entry as LearnerModelLedgerEntry).id)).size !== value.entries.length) {
    throw new Error("Stored Learner Model Ledger is invalid.");
  }
  return structuredClone(value) as unknown as LearnerModel;
}

function migrateLegacyLearnerModel(sessions: LearningSession[]): LearnerModel {
  const timestamp = new Date(0).toISOString();
  const entries: LearnerModelLedgerEntry[] = [];
  for (const session of sessions) {
    for (const evidence of session.understandingEvidence) {
      entries.push({
        id: `legacy-understanding-evidence-${evidence.id}`,
        kind: "understandingEvidence",
        inference: UNDERSTANDING_INTERPRETATION_POLICIES[evidence.interpretation].summary,
        sourceEvidence: {
          sessionId: session.id, sourceRecordId: evidence.id, evidenceIds: [evidence.id], summary: evidence.response
        },
        mathematicalContext: evidence.evidenceTransferContext
          ? structuredClone(evidence.evidenceTransferContext)
          : { concepts: [evidence.concept], mathematicalStructures: [], prerequisiteRelationships: [], taskDemands: [] },
        scope: {
          workspaceId: session.workspaceId, missionId: session.missionId,
          sessionId: session.id, sessionTarget: session.sessionTarget
        },
        confidence: "low",
        status: evidence.learnerCorrection ? "corrected" : "active",
        correction: evidence.learnerCorrection,
        governanceHistory: evidence.learnerCorrection ? [{
          id: `legacy-governance-${evidence.id}`, action: "corrected", note: evidence.learnerCorrection, at: timestamp
        }] : [],
        createdAt: timestamp,
        lastUpdatedAt: timestamp
      });
    }
    for (const preference of session.interactionPreferences) {
      entries.push({
        id: `legacy-interaction-preference-${preference.id}`,
        kind: "interactionPreference",
        inference: `${preference.route} route ${preference.status}`,
        sourceEvidence: {
          sessionId: session.id,
          sourceRecordId: preference.id,
          evidenceIds: [...preference.evidenceIds],
          summary: `Interaction Preference retained from Teaching Experiment ${preference.experimentId}.`
        },
        mathematicalContext: {
          concepts: [preference.context.concept], mathematicalStructures: [], prerequisiteRelationships: [],
          taskDemands: [preference.context.task]
        },
        scope: {
          workspaceId: session.workspaceId, missionId: session.missionId,
          sessionId: session.id, sessionTarget: session.sessionTarget
        },
        confidence: "low",
        status: "active",
        correction: null,
        governanceHistory: [],
        createdAt: timestamp,
        lastUpdatedAt: timestamp
      });
    }
  }
  return { entries, adaptiveReuseEnabled: true, lastResetAt: null };
}

function migrateEvidenceTransfers(value: unknown): EvidenceTransfer[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(validEvidenceTransfer)
    || new Set(value.map((transfer) => (transfer as EvidenceTransfer).id)).size !== value.length) {
    throw new Error("Stored Evidence Transfers are invalid.");
  }
  return structuredClone(value);
}

function validEvidenceTransfer(value: unknown): value is EvidenceTransfer {
  return validLearnerModelReuseRecord(value, "transferred");
}

function migratePriorUnderstandingEvidence(value: unknown): PriorUnderstandingEvidence[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => validLearnerModelReuseRecord(entry, "priorSession"))
    || new Set(value.map((entry) => (entry as PriorUnderstandingEvidence).id)).size !== value.length) {
    throw new Error("Stored prior-session Understanding Evidence is invalid.");
  }
  return structuredClone(value);
}

function migrateInteractionPreferenceReuses(value: unknown): InteractionPreferenceReuse[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => validLearnerModelReuseRecord(entry, "interactionPreference"))
    || new Set(value.map((entry) => (entry as InteractionPreferenceReuse).id)).size !== value.length) {
    throw new Error("Stored reused Interaction Preferences are invalid.");
  }
  return structuredClone(value);
}

function validLearnerModelReuseRecord<Origin extends EvidenceTransfer["origin"]
  | PriorUnderstandingEvidence["origin"] | InteractionPreferenceReuse["origin"]>(
  value: unknown,
  origin: Origin
): value is LearnerModelReuseRecord & { origin: Origin } {
  return isRecord(value) && typeof value.id === "string" && value.origin === origin
    && typeof value.learnerModelEntryId === "string" && typeof value.sourceSessionId === "string"
    && typeof value.sourceRecordId === "string" && typeof value.inference === "string"
    && ["low", "medium", "high"].includes(String(value.confidence))
    && isCompleteEvidenceTransferContext(value.sourceContext) && isCompleteEvidenceTransferContext(value.targetContext)
    && isRecord(value.provenance) && typeof value.provenance.workspaceId === "string"
    && typeof value.provenance.missionId === "string" && typeof value.provenance.sessionTarget === "string"
    && typeof value.provenance.summary === "string" && validIsoTimestamp(value.provenance.lastUpdatedAt);
}

function validatedStoredEvidenceTransferContext(value: unknown): EvidenceTransferContext {
  if (!isCompleteEvidenceTransferContext(value)) throw new Error("Stored Evidence Transfer context is invalid.");
  return structuredClone(value);
}

function validLearnerModelLedgerEntry(value: unknown): value is LearnerModelLedgerEntry {
  return isRecord(value) && typeof value.id === "string" && Boolean(value.id)
    && (value.kind === "understandingEvidence" || value.kind === "interactionPreference")
    && typeof value.inference === "string" && Boolean(value.inference.trim())
    && isRecord(value.sourceEvidence) && typeof value.sourceEvidence.sessionId === "string"
    && typeof value.sourceEvidence.sourceRecordId === "string" && Boolean(value.sourceEvidence.sourceRecordId)
    && Array.isArray(value.sourceEvidence.evidenceIds)
    && value.sourceEvidence.evidenceIds.every((id) => typeof id === "string")
    && (value.kind !== "understandingEvidence" || value.sourceEvidence.evidenceIds.length === 1)
    && typeof value.sourceEvidence.summary === "string" && Boolean(value.sourceEvidence.summary.trim())
    && isEvidenceTransferContext(value.mathematicalContext)
    && value.mathematicalContext.concepts.length > 0
    && isRecord(value.scope) && typeof value.scope.workspaceId === "string"
    && typeof value.scope.missionId === "string" && typeof value.scope.sessionId === "string"
    && typeof value.scope.sessionTarget === "string"
    && ["low", "medium", "high"].includes(String(value.confidence))
    && ["active", "corrected", "excluded"].includes(String(value.status))
    && (value.correction === null || typeof value.correction === "string")
    && Array.isArray(value.governanceHistory) && value.governanceHistory.every(validLearnerModelGovernanceEvent)
    && validIsoTimestamp(value.createdAt) && validIsoTimestamp(value.lastUpdatedAt);
}

function validLearnerModelGovernanceEvent(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && Boolean(value.id)
    && (value.action === "corrected" || value.action === "excluded")
    && (value.note === null || typeof value.note === "string") && validIsoTimestamp(value.at);
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function migrateTeachingExperiments(value: unknown): TeachingExperiment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((experiment) => isRecord(experiment)
    && typeof experiment.id === "string" && TEACHING_ROUTES.includes(experiment.route as TeachingRoute)
    && typeof experiment.reason === "string" && Boolean(experiment.reason.trim())
    && validTeachingContext(experiment.context)
    && Array.isArray(experiment.evidenceIds) && experiment.evidenceIds.every((id) => typeof id === "string")
    && ["active", "completed"].includes(String(experiment.status))
    && (experiment.outcome === null || isTeachingExperimentOutcome(experiment.outcome)))) {
    throw new Error("Stored Teaching Experiments are invalid.");
  }
  return structuredClone(value) as TeachingExperiment[];
}

function migrateInteractionPreferences(value: unknown): InteractionPreference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((preference) => isRecord(preference)
    && typeof preference.id === "string" && TEACHING_ROUTES.includes(preference.route as TeachingRoute)
    && validTeachingContext(preference.context)
    && ["supported", "notSupported", "uncertain"].includes(String(preference.status))
    && Array.isArray(preference.evidenceIds) && preference.evidenceIds.every((id) => typeof id === "string")
    && typeof preference.experimentId === "string")) {
    throw new Error("Stored Interaction Preferences are invalid.");
  }
  return structuredClone(value) as InteractionPreference[];
}

function validTeachingContext(value: unknown): value is TeachingContext {
  return isRecord(value) && typeof value.concept === "string" && Boolean(value.concept.trim())
    && typeof value.task === "string" && Boolean(value.task.trim());
}

function validateAdaptiveTeachingReferences(session: LearningSession): void {
  const moves = new Map(session.teachingMoves.map((move) => [move.id, move]));
  const checks = new Map(session.understandingChecks.map((check) => [check.id, check]));
  const evidence = new Map(session.understandingEvidence.map((item) => [item.id, item]));
  const experiments = new Map(session.teachingExperiments.map((experiment) => [experiment.id, experiment]));
  const anchors = new Set(session.sourceAnchors.map((anchor) => anchor.id));
  const sourceIds = new Set(session.sourceIds);
  if (moves.size !== session.teachingMoves.length || !moves.has(session.currentTeachingMove.id)
    || JSON.stringify(moves.get(session.currentTeachingMove.id)) !== JSON.stringify(session.currentTeachingMove)
    || checks.size !== session.understandingChecks.length || evidence.size !== session.understandingEvidence.length
    || experiments.size !== session.teachingExperiments.length
    || session.teachingExperiments.filter((experiment) => experiment.status === "active").length > 1) {
    throw new Error("Stored adaptive teaching references are invalid.");
  }
  for (const check of session.understandingChecks) {
    if (!moves.has(check.teachingMoveId) || (check.sourceContext.sourceAnchorId !== null && !anchors.has(check.sourceContext.sourceAnchorId))
      || check.sourceContext.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new Error("Stored Understanding Check references are invalid.");
    }
  }
  for (const item of session.understandingEvidence) {
    const check = checks.get(item.checkId);
    if (!check || check.status !== "answered" || !moves.has(item.elicitingTeachingMoveId)
      || (item.sourceContext.sourceAnchorId !== null && !anchors.has(item.sourceContext.sourceAnchorId))
      || item.sourceContext.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new Error("Stored Understanding Evidence references are invalid.");
    }
  }
  for (const move of session.teachingMoves) {
    if (move.evidenceIds.some((id) => !evidence.has(id)) || (move.experimentId !== null && !experiments.has(move.experimentId))) {
      throw new Error("Stored Teaching Move references are invalid.");
    }
  }
  for (const experiment of session.teachingExperiments) {
    if (experiment.evidenceIds.some((id) => !evidence.has(id))
      || (experiment.status === "active") !== (experiment.outcome === null)) {
      throw new Error("Stored Teaching Experiment references are invalid.");
    }
  }
  for (const preference of session.interactionPreferences) {
    if (!experiments.has(preference.experimentId) || preference.evidenceIds.some((id) => !evidence.has(id))) {
      throw new Error("Stored Interaction Preference references are invalid.");
    }
  }
  if (session.trailDraft.items.some((item) => item.links.understandingEvidenceIds.some((id) => !evidence.has(id)))) {
    throw new Error("Stored Trail Item Understanding Evidence references are invalid.");
  }
}

function validateLearnerModelReuseReferences(state: LearningApplicationState, session: LearningSession): void {
  const entries = new Map(state.learnerModel.entries.map((entry) => [entry.id, entry]));
  const recordMatchesEntry = (record: LearnerModelReuseRecord, entry: LearnerModelLedgerEntry) => {
    return record.sourceSessionId === entry.sourceEvidence.sessionId
      && record.sourceRecordId === entry.sourceEvidence.sourceRecordId;
  };
  const transfersAreValid = session.evidenceTransfers.every((record) => {
    const entry = entries.get(record.learnerModelEntryId);
    if (!entry) return true;
    return entry.kind === "understandingEvidence" && recordMatchesEntry(record, entry)
      && (entry.scope.workspaceId !== session.workspaceId || entry.scope.missionId !== session.missionId);
  });
  const priorEvidenceIsValid = session.priorUnderstandingEvidence.every((record) => {
    const entry = entries.get(record.learnerModelEntryId);
    if (!entry) return true;
    return entry.kind === "understandingEvidence" && recordMatchesEntry(record, entry)
      && entry.scope.sessionId !== session.id && entry.scope.workspaceId === session.workspaceId
      && entry.scope.missionId === session.missionId;
  });
  const preferencesAreValid = session.interactionPreferenceReuses.every((record) => {
    const entry = entries.get(record.learnerModelEntryId);
    if (!entry) return true;
    return entry.kind === "interactionPreference" && recordMatchesEntry(record, entry)
      && entry.scope.sessionId !== session.id;
  });
  if (!transfersAreValid || !priorEvidenceIsValid || !preferencesAreValid) {
    throw new Error("Stored Learner Model reuse references are invalid.");
  }
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
