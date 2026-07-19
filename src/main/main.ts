import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  isSourceAnchorPaletteAction,
  isSourceAnchorSelection,
  isAgentTaskCoordination,
  isTrailItemKind,
  LearningApplication,
  type LearnerAction
} from "../shared/learning-application";
import { CodexAppServerRuntime } from "./codex-app-server";
import type { ModelRuntime } from "../shared/model-runtime";
import { MacOsSourceAccess } from "./source-access";
import { MacOsArtifactSharing } from "./artifact-sharing";
import { BrowserExternalResearch } from "./browser-external-research";
import { LeanVerifierRuntime } from "./lean-verifier";
import { LeanEnvironmentManager } from "./lean-environment-manager";

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
  resolveSecurityScopedBookmark: async (bookmarkData) => {
    const helperPath = join(__dirname, "../helpers/source-bookmark-helper").replace("app.asar", "app.asar.unpacked");
    const { stdout } = await execFileAsync(helperPath, [bookmarkData], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8"
    });
    const result = JSON.parse(stdout) as unknown;
    if (!result || typeof result !== "object") throw new Error("The bookmark resolver returned an invalid response.");
    const resolved = result as Record<string, unknown>;
    if (typeof resolved.path !== "string" || typeof resolved.stale !== "boolean"
      || (resolved.refreshedBookmarkData !== undefined && typeof resolved.refreshedBookmarkData !== "string")) {
      throw new Error("The bookmark resolver returned an invalid response.");
    }
    return {
      path: resolved.path,
      stale: resolved.stale,
      ...(typeof resolved.refreshedBookmarkData === "string"
        ? { refreshedBookmarkData: resolved.refreshedBookmarkData }
        : {})
    };
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

function isClaimEdits(value: unknown): value is Array<{ claimId: string | null; statement: string }> {
  return Array.isArray(value) && value.every((edit) => Boolean(edit) && typeof edit === "object"
    && "claimId" in edit && (edit.claimId === null || typeof edit.claimId === "string")
    && "statement" in edit && typeof edit.statement === "string");
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
    case "returnToPrerequisiteOrigin":
    case "removeVerifierEnvironment":
    case "installVerifierEnvironment":
    case "cleanupVerifierEnvironment":
    case "beginSessionConsolidation":
    case "consolidateSession":
    case "openFollowUpQueue":
    case "closeFollowUpQueue":
    case "closeDelayedTransferCheck":
      return true;
    case "requestSpecialistReview":
      return !("coordination" in action) || action.coordination === undefined
        || isAgentTaskCoordination(action.coordination);
    case "retryAgentTask":
    case "resumeAgentTask":
      return "taskId" in action && typeof action.taskId === "string";
    case "cancelExternalResearch":
      return "researchActionId" in action && typeof action.researchActionId === "string";
    case "resumeSession":
    case "cancelSessionModelWork":
    case "continueSession":
    case "retrySessionModelStop":
    case "declineDelayedTransfer":
    case "dismissDelayedTransfer":
      return "sessionId" in action && typeof action.sessionId === "string";
    case "scheduleDelayedTransfer":
      return "sessionId" in action && typeof action.sessionId === "string"
        && "intendedTransferGoal" in action && typeof action.intendedTransferGoal === "string"
        && "dueAt" in action && typeof action.dueAt === "string";
    case "rescheduleDelayedTransfer":
      return "checkId" in action && typeof action.checkId === "string"
        && "dueAt" in action && typeof action.dueAt === "string";
    case "cancelDelayedTransfer":
    case "startDelayedTransferCheck":
    case "completeDelayedTransferCheck":
    case "skipDelayedTransferCheck":
    case "dismissDueDelayedTransferCheck":
    case "acceptDelayedTransferRefresher":
    case "declineDelayedTransferRefresher":
    case "openDelayedTransferCheck":
    case "cancelDelayedTransferPreparation":
      return "checkId" in action && typeof action.checkId === "string";
    case "saveDelayedTransferDraft":
      return "checkId" in action && typeof action.checkId === "string"
        && "work" in action && typeof action.work === "string"
        && "reasoning" in action && typeof action.reasoning === "string"
        && "confidence" in action && (action.confidence === null
          || ["low", "medium", "high"].includes(String(action.confidence)));
    case "requestDelayedTransferClarification":
      return "checkId" in action && typeof action.checkId === "string"
        && "question" in action && typeof action.question === "string";
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
    case "createAnnotation":
      return "sourceAnchorId" in action && typeof action.sourceAnchorId === "string"
        && "purpose" in action && ["personalNote", "tutorFeedback"].includes(String(action.purpose))
        && "content" in action && typeof action.content === "string";
    case "convertAnnotation":
      return "annotationId" in action && typeof action.annotationId === "string"
        && "purpose" in action && ["personalNote", "tutorFeedback"].includes(String(action.purpose));
    case "reviseTeachingCard":
      return "cardId" in action && typeof action.cardId === "string"
        && "instruction" in action && typeof action.instruction === "string";
    case "editTeachingCardClaims":
      return "cardId" in action && typeof action.cardId === "string"
        && "claimEdits" in action && isClaimEdits(action.claimEdits);
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
      return "cardId" in action && typeof action.cardId === "string"
        && (!("artifactKind" in action) || action.artifactKind === undefined
          || action.artifactKind === "learningArtifact" || action.artifactKind === "reformulatedProof");
    case "synthesizeLearningArtifact":
      return "artifactId" in action && typeof action.artifactId === "string"
        && (!("sessionId" in action) || action.sessionId === undefined || typeof action.sessionId === "string");
    case "editLearningArtifact":
      return "artifactId" in action && typeof action.artifactId === "string"
        && "content" in action && typeof action.content === "string"
        && (!("claimEdits" in action) || action.claimEdits === undefined || isClaimEdits(action.claimEdits));
    case "restoreLearningArtifactRevision":
      return "artifactId" in action && typeof action.artifactId === "string"
        && "revisionId" in action && typeof action.revisionId === "string";
    case "addTrailItem":
      return "kind" in action && isTrailItemKind(action.kind)
        && "content" in action && typeof action.content === "string";
    case "editTrailItem":
      return "trailItemId" in action && typeof action.trailItemId === "string"
        && "content" in action && typeof action.content === "string";
    case "removeTrailItem":
      return "trailItemId" in action && typeof action.trailItemId === "string";
    case "moveTrailItem":
      return "trailItemId" in action && typeof action.trailItemId === "string"
        && "direction" in action && ["up", "down"].includes(String(action.direction));
    case "setTrailItemRequired":
      return "trailItemId" in action && typeof action.trailItemId === "string"
        && "required" in action && typeof action.required === "boolean";
    case "reviseSessionConsolidation":
      return "centralInsight" in action && typeof action.centralInsight === "string"
        && "learningProgress" in action && typeof action.learningProgress === "string"
        && "unresolvedQuestions" in action && Array.isArray(action.unresolvedQuestions)
        && action.unresolvedQuestions.every((question) => typeof question === "string")
        && "nextStep" in action && typeof action.nextStep === "string"
        && "includedArtifactIds" in action && Array.isArray(action.includedArtifactIds)
        && action.includedArtifactIds.every((artifactId) => typeof artifactId === "string")
        && "targetDisposition" in action
        && ["addressed", "deferred", "unresolved"].includes(String(action.targetDisposition));
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
    case "openConceptPeek":
    case "proposePrerequisiteBranch":
      return "sourceAnchorId" in action && typeof action.sourceAnchorId === "string"
        && "prerequisite" in action && typeof action.prerequisite === "string";
    case "closeConceptPeek":
      return "conceptPeekId" in action && typeof action.conceptPeekId === "string";
    case "decidePrerequisiteBranch":
      return "proposalId" in action && typeof action.proposalId === "string"
        && "decision" in action && ["accept", "defer", "keepInline"].includes(String(action.decision));
    case "selectSessionAccessPolicy":
      return "policy" in action && ["focused", "workspace", "full"].includes(String(action.policy));
    case "setFullAccessConfirmation":
    case "setPersonalNoteSynthesis":
    case "setSourceExcerptEgressPreference":
    case "setResearchEgressPermission":
      return "enabled" in action && typeof action.enabled === "boolean";
    case "activateVerifierEnvironment":
      return "environmentId" in action && typeof action.environmentId === "string";
    case "setVerifierEnvironmentPinned":
      return "environmentId" in action && typeof action.environmentId === "string"
        && "pinned" in action && typeof action.pinned === "boolean";
    case "setSessionVerifierEnvironmentPin":
      return "sessionId" in action && typeof action.sessionId === "string"
        && "environmentId" in action && (action.environmentId === null || typeof action.environmentId === "string");
    case "researchWeb":
      return "query" in action && isDerivedResearchQueryInput(action.query)
        && "sourceAnchorIds" in action && Array.isArray(action.sourceAnchorIds)
        && action.sourceAnchorIds.every((id) => typeof id === "string");
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

function isDerivedResearchQueryInput(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const query = value as Record<string, unknown>;
  return [query.theoremNames, query.assumptions, query.keywords]
    .every((terms) => Array.isArray(terms) && terms.every((term) => typeof term === "string"));
}

function registerLearningApplicationHandlers(): void {
  const verifierRuns = new Map<string, AbortController>();
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
    if (action.type === "removeVerifierEnvironment" && verifierRuns.size > 0) {
      throw new Error("Cancel the active Lean check before removing the Bundled Lean Runtime.");
    }
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
  ipcMain.handle("artifact:export", async (event, sessionId: unknown, artifactId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof sessionId !== "string" || typeof artifactId !== "string") {
      throw new Error("Invalid Learning Artifact export request.");
    }
    const portableCopy = learningApplication.createArtifactPortableCopy(sessionId, artifactId);
    const fixturePath = process.env.QUICK_STUDY_TEST_ARTIFACT_EXPORT_PATH;
    let destinationPath = fixturePath;
    if (!destinationPath) {
      const owner = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: "Export Learning Artifact",
        defaultPath: portableCopy.suggestedFilename,
        filters: [{ name: "Markdown", extensions: ["md"] }]
      };
      const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { status: "canceled" } as const;
      destinationPath = result.filePath;
    }
    await learningApplication.exportLearningArtifact(sessionId, artifactId, destinationPath);
    return { status: "exported", path: destinationPath } as const;
  });
  ipcMain.handle("artifact:share", async (event, sessionId: unknown, artifactId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof sessionId !== "string" || typeof artifactId !== "string") {
      throw new Error("Invalid Learning Artifact share request.");
    }
    return learningApplication.shareLearningArtifact(sessionId, artifactId);
  });
  ipcMain.handle("verifier:run", async (event, sessionId: unknown, request: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof sessionId !== "string" || !isFormalVerificationRequest(request)) {
      throw new Error("Invalid formal verification request.");
    }
    if (verifierRuns.has(request.runId)) throw new Error("A formal verification run with this identifier is already active.");
    const controller = new AbortController();
    verifierRuns.set(request.runId, controller);
    try {
      return await learningApplication.runFormalVerification(sessionId, request, controller.signal);
    } finally {
      verifierRuns.delete(request.runId);
    }
  });
  ipcMain.handle("verifier:cancel", async (event, runId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof runId !== "string") throw new Error("Invalid formal verification run identifier.");
    verifierRuns.get(runId)?.abort();
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
  ipcMain.handle("source:locate", async (event, sourceId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof sourceId !== "string") throw new Error("Invalid Linked Source.");
    const source = learningApplication.getState().sources.find((candidate) => candidate.id === sourceId);
    if (!source || source.kind !== "linkedSource") throw new Error("Invalid Linked Source.");
    const fixturePath = process.env.QUICK_STUDY_TEST_RELOCATED_SOURCE;
    const selection = fixturePath
      ? await sourceAccess.selectDirectPath(fixturePath, source.resourceType)
      : await sourceAccess.select(source.resourceType);
    return selection ? learningApplication.relocateLinkedSource(sourceId, selection) : learningApplication.getState();
  });
  ipcMain.handle("source:snapshot", async (event, sourceId: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url)) throw new Error("Untrusted renderer.");
    if (typeof sourceId !== "string") throw new Error("Invalid Linked Source.");
    return learningApplication.preserveSourceSnapshot(sourceId);
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

function isFormalVerificationRequest(value: unknown): value is import("../shared/learning-application").FormalVerificationRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (request.target === "teachingCard" || request.target === "learningArtifact")
    && typeof request.runId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(request.runId)
    && typeof request.targetId === "string" && typeof request.claimId === "string";
}

void app.whenReady().then(async () => {
  const dataDirectory = process.env.QUICK_STUDY_DATA_DIR ?? app.getPath("userData");
  const seedRegistry = app.isPackaged ? join(process.resourcesPath, "verifiers") : join(process.cwd(), "dist", "verifiers");
  let failRemovalOnce = process.env.QUICK_STUDY_TEST_VERIFIER_REMOVAL_FAILURE === "once";
  const verifierEnvironmentManager = new LeanEnvironmentManager(
    join(dataDirectory, "verifiers"),
    seedRegistry,
    undefined,
    async () => {
      if (!failRemovalOnce) return;
      failRemovalOnce = false;
      throw new Error("Synthetic removal interruption before deactivation.");
    }
  );
  const installDefaultVerifier = await verifierEnvironmentManager.defaultInstallationNeeded().catch((error) => {
    console.error("The default Lean environment could not be inspected:", error);
    return false;
  });
  try {
    modelRuntime = await CodexAppServerRuntime.launch(dataDirectory);
  } catch (error) {
    console.error("Codex app-server is unavailable:", error);
  }
  learningApplication = await LearningApplication.launch(
    dataDirectory,
    modelRuntime,
    sourceAccess,
    new MacOsArtifactSharing(app.getPath("temp")),
    new BrowserExternalResearch(process.env.QUICK_STUDY_TEST_EXTERNAL_RESEARCH === "stub"
      ? async () => undefined
      : (url) => shell.openExternal(url)),
    null,
    new LeanVerifierRuntime(
      process.env.QUICK_STUDY_LEAN_PATH ?? ((environmentId) => verifierEnvironmentManager.executablePath(environmentId)),
      undefined,
      undefined,
      undefined,
      (signal, environmentId) => verifierEnvironmentManager.assertInstalledIntegrity(signal, environmentId)
    ),
    verifierEnvironmentManager
  );
  if (installDefaultVerifier) {
    void learningApplication.submit({ type: "installVerifierEnvironment" }).catch((error) => {
      console.error("The default Lean environment could not be installed:", error);
    });
  }
  verifierEnvironmentManager.primeSeedIntegrity();
  registerLearningApplicationHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void learningApplication.shutdown().finally(() => app.quit());
});
