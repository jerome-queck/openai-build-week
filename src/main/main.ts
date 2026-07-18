import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LearningApplication, type LearnerAction } from "../shared/learning-application";

let learningApplication: LearningApplication;

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
    case "resumeSession":
      return true;
    case "startQuickStudy":
      return "mathematics" in action && typeof action.mathematics === "string";
    case "editLearningGoal":
    case "editSessionTarget":
      return "value" in action && typeof action.value === "string";
    default:
      return false;
  }
}

function registerLearningApplicationHandlers(): void {
  ipcMain.handle("learning:getState", (event) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    return learningApplication.getState();
  });
  ipcMain.handle("learning:submit", (event, action: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (!isLearnerAction(action)) throw new Error("Invalid learner action.");
    return learningApplication.submit(action);
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
  learningApplication = await LearningApplication.launch(dataDirectory);
  registerLearningApplicationHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
