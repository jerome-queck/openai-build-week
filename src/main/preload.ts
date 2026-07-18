import { contextBridge, ipcRenderer } from "electron";
import type {
  LearnerAction,
  LearningApplicationState,
  LinkedSourceView,
  SessionSearchResult
} from "../shared/learning-application";

contextBridge.exposeInMainWorld("quickStudy", {
  getState: (): Promise<LearningApplicationState> => ipcRenderer.invoke("learning:getState"),
  submit: (action: LearnerAction): Promise<LearningApplicationState> => ipcRenderer.invoke("learning:submit", action),
  searchSessions: (query: string): Promise<SessionSearchResult[]> => ipcRenderer.invoke("learning:searchSessions", query),
  linkPrimaryFolder: (workspaceId: string): Promise<LearningApplicationState> =>
    ipcRenderer.invoke("source:linkPrimaryFolder", workspaceId),
  linkExternalAttachment: (workspaceId: string): Promise<LearningApplicationState> =>
    ipcRenderer.invoke("source:linkExternalAttachment", workspaceId),
  openLinkedSource: (sourceId: string): Promise<LinkedSourceView> => ipcRenderer.invoke("source:open", sourceId),
  onStateChanged: (listener: (state: LearningApplicationState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: LearningApplicationState) => listener(state);
    ipcRenderer.on("learning:stateChanged", handler);
    return () => ipcRenderer.removeListener("learning:stateChanged", handler);
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("authentication:openExternal", url)
});
