import { contextBridge, ipcRenderer } from "electron";
import type {
  LearnerAction,
  AgentWorkLogEvidence,
  LearningApplicationState,
  LinkedSourceView,
  OpenedSourceSearchResult,
  SessionSearchResult,
  SourceSearchResult
} from "../shared/learning-application";

contextBridge.exposeInMainWorld("quickStudy", {
  getState: (): Promise<LearningApplicationState> => ipcRenderer.invoke("learning:getState"),
  submit: (action: LearnerAction): Promise<LearningApplicationState> => ipcRenderer.invoke("learning:submit", action),
  getAgentWorkLogEvidence: (sessionId: string, fromSequence: number, toSequence: number): Promise<AgentWorkLogEvidence[]> =>
    ipcRenderer.invoke("learning:getAgentWorkLogEvidence", sessionId, fromSequence, toSequence),
  searchSessions: (query: string): Promise<SessionSearchResult[]> => ipcRenderer.invoke("learning:searchSessions", query),
  linkPrimaryFolder: (workspaceId: string): Promise<LearningApplicationState> =>
    ipcRenderer.invoke("source:linkPrimaryFolder", workspaceId),
  linkExternalAttachment: (workspaceId: string): Promise<LearningApplicationState> =>
    ipcRenderer.invoke("source:linkExternalAttachment", workspaceId),
  openLinkedSource: (sourceId: string): Promise<LinkedSourceView> => ipcRenderer.invoke("source:open", sourceId),
  indexSource: (sourceId: string): Promise<LearningApplicationState> => ipcRenderer.invoke("source:index", sourceId),
  clearSourceIndex: (sourceId: string): Promise<LearningApplicationState> => ipcRenderer.invoke("source:indexClear", sourceId),
  rebuildSourceIndex: (sourceId: string): Promise<LearningApplicationState> => ipcRenderer.invoke("source:indexRebuild", sourceId),
  searchSourceIndex: (workspaceId: string, query: string): Promise<SourceSearchResult[]> =>
    ipcRenderer.invoke("source:indexSearch", workspaceId, query),
  openSourceSearchResult: (resultId: string): Promise<OpenedSourceSearchResult> =>
    ipcRenderer.invoke("source:indexOpenResult", resultId),
  onStateChanged: (listener: (state: LearningApplicationState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: LearningApplicationState) => listener(state);
    ipcRenderer.on("learning:stateChanged", handler);
    return () => ipcRenderer.removeListener("learning:stateChanged", handler);
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("authentication:openExternal", url)
});
