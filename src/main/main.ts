import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LearningApplication, type LearnerAction } from "../shared/learning-application";
import { CodexAppServerRuntime } from "./codex-app-server";
import type { ModelRuntime } from "../shared/model-runtime";

let learningApplication: LearningApplication;
let modelRuntime: ModelRuntime | null = null;

function isTrustedSender(frameUrl: string | undefined): boolean {
  if (!frameUrl) return false;
  const developmentUrl = process.env.QUICK_STUDY_DEV_URL;
  if (developmentUrl) {
    return new URL(frameUrl).origin === new URL(developmentUrl).origin;
  }
  return frameUrl === pathToFileURL(join(__dirname, "../renderer/index.html")).href;
}

function isLearnerAction(value: unknown): value is LearnerAction {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const action = value as Partial<LearnerAction>;
  switch (action.type) {
    case "leaveSession":
    case "confirmSessionProposal":
    case "cancelModelWork":
    case "retryModelWork":
    case "startChatGptLogin":
    case "refreshAuthentication":
      return true;
    case "resumeSession":
    case "cancelSessionModelWork":
      return "sessionId" in action && typeof action.sessionId === "string";
    case "startQuickStudy":
    case "submitSessionIntake":
      return "mathematics" in action && typeof action.mathematics === "string";
    case "loginWithApiKey":
      return "apiKey" in action && typeof action.apiKey === "string";
    case "reviseSessionProposal":
    case "applySessionProposalRevision":
      return "learningGoal" in action && typeof action.learningGoal === "string"
        && "scope" in action && typeof action.scope === "string"
        && "initialTeachingDirection" in action && typeof action.initialTeachingDirection === "string";
    case "editLearningGoal":
    case "editSessionTarget":
      return "value" in action && typeof action.value === "string";
    case "createWorkspace":
      return "name" in action && typeof action.name === "string";
    case "renameWorkspace":
      return "workspaceId" in action && typeof action.workspaceId === "string" && "name" in action && typeof action.name === "string";
    case "createMission":
      return "workspaceId" in action && typeof action.workspaceId === "string" && "name" in action && typeof action.name === "string";
    case "navigateToWorkspace":
      return "workspaceId" in action && typeof action.workspaceId === "string";
    case "navigateToMission":
      return "workspaceId" in action && typeof action.workspaceId === "string" && "missionId" in action && typeof action.missionId === "string";
    case "fileSession":
      return "sessionId" in action && typeof action.sessionId === "string"
        && "workspaceId" in action && typeof action.workspaceId === "string"
        && "missionId" in action && typeof action.missionId === "string";
    default:
      return false;
  }
}

function registerLearningApplicationHandlers(): void {
  learningApplication.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("learning:stateChanged", state);
  });
  ipcMain.handle("learning:getState", (event) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    return learningApplication.getState();
  });
  ipcMain.handle("learning:submit", (event, action: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (!isLearnerAction(action)) throw new Error("Invalid learner action.");
    return learningApplication.submit(action);
  });
  ipcMain.handle("authentication:openExternal", async (event, url: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof url !== "string" || new URL(url).protocol !== "https:") throw new Error("Invalid authentication URL.");
    await shell.openExternal(url);
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 620,
    title: "Quick Study",
    backgroundColor: "#f4efe5",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== window.webContents.getURL()) event.preventDefault();
  });

  if (process.env.QUICK_STUDY_DEV_URL) {
    void window.loadURL(process.env.QUICK_STUDY_DEV_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(async () => {
  const dataDirectory = process.env.QUICK_STUDY_DATA_DIR ?? app.getPath("userData");
  try {
    modelRuntime = await CodexAppServerRuntime.launch(dataDirectory);
  } catch (error) {
    console.error("Codex app-server is unavailable:", error);
  }
  learningApplication = await LearningApplication.launch(dataDirectory, modelRuntime);
  registerLearningApplicationHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void learningApplication.shutdown().finally(() => app.quit());
});
