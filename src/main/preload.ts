import { contextBridge, ipcRenderer } from "electron";
import type { LearnerAction, LearningApplicationState } from "../shared/learning-application";

contextBridge.exposeInMainWorld("quickStudy", {
  getState: (): Promise<LearningApplicationState> => ipcRenderer.invoke("learning:getState"),
  submit: (action: LearnerAction): Promise<LearningApplicationState> => ipcRenderer.invoke("learning:submit", action)
});
