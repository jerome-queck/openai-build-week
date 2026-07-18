import type {
  LearnerAction,
  AgentWorkLogEvidence,
  LearningApplicationState,
  LinkedSourceView,
  OpenedSourceSearchResult,
  SessionSearchResult,
  SourceSearchResult
} from "../../shared/learning-application";

declare global {
  interface Window {
    quickStudy: {
      getState(): Promise<LearningApplicationState>;
      submit(action: LearnerAction): Promise<LearningApplicationState>;
      getAgentWorkLogEvidence(sessionId: string, fromSequence: number, toSequence: number): Promise<AgentWorkLogEvidence[]>;
      searchSessions(query: string): Promise<SessionSearchResult[]>;
      linkPrimaryFolder(workspaceId: string): Promise<LearningApplicationState>;
      linkExternalAttachment(workspaceId: string): Promise<LearningApplicationState>;
      openLinkedSource(sourceId: string): Promise<LinkedSourceView>;
      indexSource(sourceId: string): Promise<LearningApplicationState>;
      clearSourceIndex(sourceId: string): Promise<LearningApplicationState>;
      rebuildSourceIndex(sourceId: string): Promise<LearningApplicationState>;
      searchSourceIndex(workspaceId: string, query: string): Promise<SourceSearchResult[]>;
      openSourceSearchResult(resultId: string): Promise<OpenedSourceSearchResult>;
      onStateChanged(listener: (state: LearningApplicationState) => void): () => void;
      openExternal(url: string): Promise<void>;
    };
  }
}

export {};
