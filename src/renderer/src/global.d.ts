import type {
  LearnerAction,
  AgentWorkLogEvidence,
  ArtifactExportResult,
  ArtifactShareResult,
  FormalVerificationRequest,
  LearningApplicationState,
  LinkedSourceView,
  OpenedSourceSearchResult,
  SessionSearchResult,
  SourceSearchResult
} from "../../shared/learning-application";

declare global {
  interface Window {
    clarifold: {
      getState(): Promise<LearningApplicationState>;
      submit(action: LearnerAction): Promise<LearningApplicationState>;
      getAgentWorkLogEvidence(sessionId: string, fromSequence: number, toSequence: number): Promise<AgentWorkLogEvidence[]>;
      searchSessions(query: string): Promise<SessionSearchResult[]>;
      linkPrimaryFolder(workspaceId: string): Promise<LearningApplicationState>;
      linkExternalAttachment(workspaceId: string): Promise<LearningApplicationState>;
      openLinkedSource(sourceId: string): Promise<LinkedSourceView>;
      locateLinkedSource(sourceId: string): Promise<LearningApplicationState>;
      preserveSourceSnapshot(sourceId: string): Promise<LearningApplicationState>;
      indexSource(sourceId: string): Promise<LearningApplicationState>;
      clearSourceIndex(sourceId: string): Promise<LearningApplicationState>;
      rebuildSourceIndex(sourceId: string): Promise<LearningApplicationState>;
      searchSourceIndex(workspaceId: string, query: string): Promise<SourceSearchResult[]>;
      openSourceSearchResult(resultId: string): Promise<OpenedSourceSearchResult>;
      exportLearningArtifact(sessionId: string, artifactId: string): Promise<ArtifactExportResult>;
      shareLearningArtifact(sessionId: string, artifactId: string): Promise<ArtifactShareResult>;
      verifyClaim(sessionId: string, request: FormalVerificationRequest): Promise<LearningApplicationState>;
      cancelClaimVerification(runId: string): Promise<void>;
      onStateChanged(listener: (state: LearningApplicationState) => void): () => void;
      openExternal(url: string): Promise<void>;
    };
  }
}

export {};
