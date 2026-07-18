import type { LearnerAction, LearningApplicationState } from "../../shared/learning-application";

declare global {
  interface Window {
    quickStudy: {
      getState(): Promise<LearningApplicationState>;
      submit(action: LearnerAction): Promise<LearningApplicationState>;
      onStateChanged(listener: (state: LearningApplicationState) => void): () => void;
      openExternal(url: string): Promise<void>;
    };
  }
}

export {};
