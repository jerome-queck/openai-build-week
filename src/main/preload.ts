import { contextBridge, ipcRenderer } from "electron";
import type { LearnerAction, LearningApplicationState } from "../shared/learning-application";

contextBridge.exposeInMainWorld("quickStudy", {
  getState: (): Promise<LearningApplicationState> => ipcRenderer.invoke("learning:getState"),
  submit: (action: LearnerAction): Promise<LearningApplicationState> => ipcRenderer.invoke("learning:submit", action),
  onStateChanged: (listener: (state: LearningApplicationState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: LearningApplicationState) => listener(state);
    ipcRenderer.on("learning:stateChanged", handler);
    return () => ipcRenderer.removeListener("learning:stateChanged", handler);
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("authentication:openExternal", url)
});
