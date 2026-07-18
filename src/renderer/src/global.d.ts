import type {
  LearnerAction,
  LearningApplicationState,
  LinkedSourceView,
  SessionSearchResult
} from "../../shared/learning-application";

declare global {
  interface Window {
    quickStudy: {
      getState(): Promise<LearningApplicationState>;
      submit(action: LearnerAction): Promise<LearningApplicationState>;
      searchSessions(query: string): Promise<SessionSearchResult[]>;
      linkPrimaryFolder(workspaceId: string): Promise<LearningApplicationState>;
      linkExternalAttachment(workspaceId: string): Promise<LearningApplicationState>;
      openLinkedSource(sourceId: string): Promise<LinkedSourceView>;
      onStateChanged(listener: (state: LearningApplicationState) => void): () => void;
      openExternal(url: string): Promise<void>;
    };
  }
}

export {};
