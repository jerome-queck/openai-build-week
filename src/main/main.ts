import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  isSourceAnchorPaletteAction,
  isSourceAnchorSelection,
  LearningApplication,
  type LearnerAction
} from "../shared/learning-application";
import { CodexAppServerRuntime } from "./codex-app-server";
import type { ModelRuntime } from "../shared/model-runtime";
import { MacOsSourceAccess } from "./source-access";

let learningApplication: LearningApplication;
let modelRuntime: ModelRuntime | null = null;
const execFileAsync = promisify(execFile);
const sourceAccess = new MacOsSourceAccess({
  showOpenDialog: (options) => dialog.showOpenDialog(options),
  stat,
  realpath,
  readFile,
  readdir,
  startAccessingSecurityScopedResource: (bookmarkData) => {
    const stopAccess = app.startAccessingSecurityScopedResource(bookmarkData);
    return () => stopAccess();
  },
  extractDocument: async (path) => {
    const helperPath = join(__dirname, "../helpers/source-index-extractor").replace("app.asar", "app.asar.unpacked");
    const { stdout } = await execFileAsync(helperPath, [path], {
      timeout: 45_000,
      maxBuffer: 25 * 1024 * 1024,
      encoding: "utf8"
    });
    return JSON.parse(stdout);
  }
});

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
    case "discardPendingQuestion":
    case "submitPendingQuestion":
      return true;
    case "resumeSession":
    case "cancelSessionModelWork":
      return "sessionId" in action && typeof action.sessionId === "string";
    case "addSourceToSession":
      return "sourceId" in action && typeof action.sourceId === "string";
    case "startQuickStudy":
    case "submitSessionIntake":
      return "mathematics" in action && typeof action.mathematics === "string"
        && (!("location" in action) || action.location === undefined || isStudyLocation(action.location));
    case "savePendingQuestion":
    case "editPendingQuestion":
      return "text" in action && typeof action.text === "string";
    case "createSourceAnchor":
      return "sourceId" in action && typeof action.sourceId === "string"
        && "selection" in action && isSourceAnchorSelection(action.selection)
        && "paletteAction" in action && isSourceAnchorPaletteAction(action.paletteAction);
    case "reviseTeachingCard":
      return "cardId" in action && typeof action.cardId === "string"
        && "instruction" in action && typeof action.instruction === "string";
    case "restoreTeachingCardRevision":
      return "cardId" in action && typeof action.cardId === "string"
        && "revisionId" in action && typeof action.revisionId === "string";
    case "createTeachingVariant":
      return "cardId" in action && typeof action.cardId === "string"
        && "name" in action && typeof action.name === "string"
        && "instruction" in action && typeof action.instruction === "string";
    case "retryAnchoredTeachingCard":
      return "cardId" in action && typeof action.cardId === "string"
        && (!("variantId" in action) || action.variantId === undefined || typeof action.variantId === "string");
    case "pinTeachingCardArtifact":
      return "cardId" in action && typeof action.cardId === "string";
    case "editLearningArtifact":
      return "artifactId" in action && typeof action.artifactId === "string"
        && "content" in action && typeof action.content === "string";
    case "restoreLearningArtifactRevision":
      return "artifactId" in action && typeof action.artifactId === "string"
        && "revisionId" in action && typeof action.revisionId === "string";
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
    case "selectSessionAccessPolicy":
      return "policy" in action && ["focused", "workspace", "full"].includes(String(action.policy));
    case "setFullAccessConfirmation":
      return "enabled" in action && typeof action.enabled === "boolean";
    case "decideFullAccessConfirmation":
      return "decision" in action && ["confirm", "cancel"].includes(String(action.decision));
    case "decideAccessRequest":
      return "requestId" in action && typeof action.requestId === "string"
        && "decision" in action && ["approve", "deny", "narrow"].includes(String(action.decision))
        && (!("narrowedPolicy" in action) || action.narrowedPolicy === undefined
          || ["focused", "workspace", "full"].includes(String(action.narrowedPolicy)));
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

function isStudyLocation(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const location = value as Record<string, unknown>;
  return typeof location.workspaceId === "string" && typeof location.missionId === "string";
}

function registerLearningApplicationHandlers(): void {
  learningApplication.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("learning:stateChanged", state);
  });
  ipcMain.handle("learning:getState", (event) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    return learningApplication.getState();
  });
  ipcMain.handle("learning:getAgentWorkLogEvidence", (event, sessionId: unknown, fromSequence: unknown, toSequence: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof sessionId !== "string" || typeof fromSequence !== "number" || typeof toSequence !== "number") {
      throw new Error("Invalid Agent Work Log evidence request.");
    }
    return learningApplication.getAgentWorkLogEvidence(sessionId, fromSequence, toSequence);
  });
  ipcMain.handle("learning:submit", async (event, action: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (!isLearnerAction(action)) throw new Error("Invalid learner action.");
    if (action.type === "refreshAuthentication" && !learningApplication.getState().runtimeAvailable) {
      try {
        const dataDirectory = process.env.QUICK_STUDY_DATA_DIR ?? app.getPath("userData");
        modelRuntime = await CodexAppServerRuntime.launch(dataDirectory);
        return learningApplication.restoreModelRuntime(modelRuntime);
      } catch (error) {
        return learningApplication.reportModelRuntimeFailure(error);
      }
    }
    return learningApplication.submit(action);
  });
  ipcMain.handle("learning:searchSessions", (event, query: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof query !== "string") throw new Error("Invalid search query.");
    return learningApplication.searchSessions(query);
  });
  ipcMain.handle("source:linkPrimaryFolder", async (event, workspaceId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof workspaceId !== "string") throw new Error("Invalid Study Workspace.");
    const fixturePath = process.env.QUICK_STUDY_TEST_PRIMARY_FOLDER;
    const selection = fixturePath
      ? await sourceAccess.selectDirectPath(fixturePath, "folder")
      : await sourceAccess.select("folder");
    return selection ? learningApplication.linkPrimaryFolder(workspaceId, selection) : learningApplication.getState();
  });
  ipcMain.handle("source:linkExternalAttachment", async (event, workspaceId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof workspaceId !== "string") throw new Error("Invalid Study Workspace.");
    const fixturePath = process.env.QUICK_STUDY_TEST_EXTERNAL_ATTACHMENT;
    const selection = fixturePath
      ? await sourceAccess.selectDirectPath(fixturePath, "file")
      : await sourceAccess.select("file");
    return selection ? learningApplication.linkExternalAttachment(workspaceId, selection) : learningApplication.getState();
  });
  ipcMain.handle("source:open", async (event, sourceId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof sourceId !== "string") throw new Error("Invalid Linked Source.");
    return learningApplication.openLinkedSource(sourceId);
  });
  ipcMain.handle("source:index", async (event, sourceId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof sourceId !== "string") throw new Error("Invalid Linked Source.");
    return learningApplication.indexSource(sourceId);
  });
  ipcMain.handle("source:indexClear", async (event, sourceId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof sourceId !== "string") throw new Error("Invalid Linked Source.");
    return learningApplication.clearSourceIndex(sourceId);
  });
  ipcMain.handle("source:indexRebuild", async (event, sourceId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof sourceId !== "string") throw new Error("Invalid Linked Source.");
    return learningApplication.rebuildSourceIndex(sourceId);
  });
  ipcMain.handle("source:indexSearch", async (event, workspaceId: unknown, query: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof workspaceId !== "string" || typeof query !== "string") throw new Error("Invalid Source Index search.");
    return learningApplication.searchSourceIndex(workspaceId, query);
  });
  ipcMain.handle("source:indexOpenResult", async (event, resultId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof resultId !== "string") throw new Error("Invalid Source Index result.");
    return learningApplication.openSourceSearchResult(resultId);
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
  learningApplication = await LearningApplication.launch(dataDirectory, modelRuntime, sourceAccess);
  registerLearningApplicationHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void learningApplication.shutdown().finally(() => app.quit());
});
