import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  ModelAccessError,
  type AuthenticationState,
  type ModelAccessCause,
  type ModelRuntime,
  type ModelRuntimeEvent,
  type SessionProposal
} from "./model-runtime";

export type SessionStatus = "active" | "paused";

export type ModelAccessState =
  | { status: "available" }
  | { status: "unavailable"; cause: ModelAccessCause; message: string };

export interface PendingQuestion {
  id: string;
  text: string;
}

export interface SubmittedPendingQuestion {
  id: string;
  text: string;
  teachingCard: TeachingCardState;
}

export interface TeachingCardState {
  status: "idle" | "streaming" | "completed" | "stopped" | "failed";
  content: string;
  error: string | null;
  retryable: boolean;
}

export interface SessionSearchResult {
  sessionId: string;
  learningGoal: string;
  sessionTarget: string;
  workspaceName: string;
  missionName: string;
}

export interface QuickStudyHome {
  workspace: {
    id: "quick-study-workspace";
    kind: "system";
    name: "Quick Study";
  };
  mission: {
    id: "quick-study-unfiled-mission";
    kind: "unfiled";
    workspaceId: "quick-study-workspace";
  };
}

export interface StudyWorkspace {
  id: string;
  kind: "system" | "named";
  name: string;
  context: WorkspaceContext;
}

export interface WorkspaceContext {
  sourceIds: string[];
  learnerContextIds: string[];
  primaryFolderSourceId: string | null;
}

export interface SourceFingerprint {
  size: number;
  modifiedAtMs: number;
}

export type LocalSourceAccessGrant = { kind: "securityScopedBookmark"; bookmarkData: string } | null;

export interface SelectedLocalSource {
  name: string;
  resourceType: "file" | "folder";
  lastKnownPath: string;
  canonicalPath: string;
  accessGrant: LocalSourceAccessGrant;
  fingerprint: SourceFingerprint;
}

export interface LinkedSource {
  id: string;
  kind: "linkedSource";
  role: "primaryFolder" | "externalAttachment";
  workspaceId: string;
  name: string;
  resourceType: "file" | "folder";
  link: {
    lastKnownPath: string;
    canonicalPath: string;
    accessGrant: LocalSourceAccessGrant;
    fingerprint: SourceFingerprint;
    accessStatus: "available" | "unavailable";
    error: string | null;
  };
}

export interface ManagedAsset {
  id: string;
  kind: "managedAsset";
  workspaceId: string;
  name: string;
  mediaType: "text/plain";
  content: string;
}

export type WorkspaceSource = LinkedSource | ManagedAsset;

export interface AvailableLinkedSourceView {
  sourceId: string;
  resourceType: "file" | "folder";
  content: string;
  mediaType: "text/plain" | "application/pdf" | "image/png" | "image/jpeg" | "inode/directory" | "application/octet-stream";
  fingerprint: SourceFingerprint;
}

export interface LocalSourceAccess {
  read(source: LinkedSource): Promise<AvailableLinkedSourceView>;
}

export type LinkedSourceView =
  | ({ status: "available" } & AvailableLinkedSourceView)
  | { status: "unavailable"; sourceId: string; error: string };

export interface StudyMission {
  id: string;
  kind: "unfiled" | "named";
  workspaceId: string;
  name: string;
}

export interface StudyLocation {
  workspaceId: string;
  missionId: string;
}

export interface LearningSession {
  id: string;
  workspaceId: string;
  missionId: string;
  mathematics: string;
  sourceIds: string[];
  learningGoal: string;
  sessionTarget: string;
  status: SessionStatus;
  activityOrder: number;
  returnContext: {
    label: string;
    nextAction: string;
  };
  proposal: {
    scope: string;
    initialTeachingDirection: string;
    status: "accepted" | "awaitingConfirmation";
    confirmationReason: string | null;
  };
  teachingCard: TeachingCardState;
  teachingCardHistory: TeachingCardState[];
  submittedPendingQuestions: SubmittedPendingQuestion[];
  currentTeachingInput: { kind: "sessionIntake"; text: string } | { kind: "pendingQuestion"; submissionId: string; text: string };
  pendingQuestion: PendingQuestion | null;
  accessPolicy: "focused";
}

export interface LearningApplicationState {
  screen: "dashboard" | "workbench";
  quickStudy: QuickStudyHome;
  workspaces: StudyWorkspace[];
  missions: StudyMission[];
  sessions: LearningSession[];
  sources: WorkspaceSource[];
  activeSessionId: string | null;
  resumeSessionId: string | null;
  navigation: {
    workspaceId: string;
    missionId: string | null;
  };
  activityOrder: number;
  authentication: {
    status: "signedOut" | "signingIn" | "signedIn" | "failed";
    method: "chatgpt" | "apiKey" | null;
    accountLabel: string | null;
    loginUrl: string | null;
    error: string | null;
  };
  intakeError: string | null;
  runtimeAvailable: boolean;
  modelAccess: ModelAccessState;
}

export type LearnerAction =
  | { type: "startQuickStudy"; mathematics: string }
  | { type: "submitSessionIntake"; mathematics: string }
  | { type: "confirmSessionProposal" }
  | { type: "cancelModelWork" }
  | { type: "cancelSessionModelWork"; sessionId: string }
  | { type: "retryModelWork" }
  | { type: "startChatGptLogin" }
  | { type: "loginWithApiKey"; apiKey: string }
  | { type: "refreshAuthentication" }
  | { type: "savePendingQuestion"; text: string }
  | { type: "editPendingQuestion"; text: string }
  | { type: "discardPendingQuestion" }
  | { type: "submitPendingQuestion" }
  | {
      type: "reviseSessionProposal";
      learningGoal: string;
      scope: string;
      initialTeachingDirection: string;
    }
  | {
      type: "applySessionProposalRevision";
      learningGoal: string;
      scope: string;
      initialTeachingDirection: string;
    }
  | { type: "editLearningGoal"; value: string }
  | { type: "editSessionTarget"; value: string }
  | { type: "leaveSession" }
  | { type: "resumeSession"; sessionId: string }
  | { type: "createWorkspace"; name: string }
  | { type: "renameWorkspace"; workspaceId: string; name: string }
  | { type: "createMission"; workspaceId: string; name: string }
  | { type: "navigateToWorkspace"; workspaceId: string }
  | ({ type: "navigateToMission" } & StudyLocation)
  | ({ type: "fileSession"; sessionId: string } & StudyLocation);

export class LearningApplication {
  private state: LearningApplicationState = initialState();
  private readonly statePath: string;
  private modelRuntime: ModelRuntime | null;
  private persistence = Promise.resolve();
  private readonly modelWorks = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly stateListeners = new Set<(state: LearningApplicationState) => void>();
  private agentWorkLogs: Record<string, Array<ModelRuntimeEvent & { sequence: number }>> = {};

  private constructor(
    dataDirectory: string,
    modelRuntime: ModelRuntime | null,
    private readonly sourceAccess: LocalSourceAccess | null
  ) {
    this.statePath = join(dataDirectory, "learning-application.json");
    this.modelRuntime = modelRuntime;
  }

  static async launch(
    dataDirectory: string,
    modelRuntime: ModelRuntime | null = null,
    sourceAccess: LocalSourceAccess | null = null
  ): Promise<LearningApplication> {
    const application = new LearningApplication(dataDirectory, modelRuntime, sourceAccess);
    try {
      const stored = JSON.parse(await readFile(application.statePath, "utf8")) as Record<string, unknown>;
      const { agentWorkLogs, ...storedState } = stored;
      const persisted = migratePersistedState(storedState);
      application.agentWorkLogs = migrateAgentWorkLogs(agentWorkLogs);
      for (const session of persisted.sessions) {
        if (session.status === "active") session.status = "paused";
        if (session.teachingCard.status === "streaming") {
          replaceTeachingCard(session, interruptedTeachingCard(session.teachingCard.content));
        }
      }
      persisted.activeSessionId = null;
      persisted.resumeSessionId = mostRecentSessionId(persisted.sessions);
      persisted.screen = "dashboard";
      application.state = persisted;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    if (modelRuntime) {
      application.state.runtimeAvailable = true;
      try {
        application.updateAuthentication(await modelRuntime.getAuthentication());
      } catch (error) {
        application.state.authentication = failedAuthentication(null, error);
        application.applyModelAccessFailure(error);
      }
    } else {
      application.state.runtimeAvailable = false;
      const error = new Error("Codex Runtime is unavailable. Restart Codex and try again.");
      application.state.authentication = failedAuthentication(null, error);
      application.state.modelAccess = unavailableModelAccess(error);
    }
    return application;
  }

  getState(): LearningApplicationState {
    return structuredClone(this.state);
  }

  subscribe(listener: (state: LearningApplicationState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  searchSessions(query: string): SessionSearchResult[] {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return this.state.sessions.flatMap((session) => {
      const workspace = this.state.workspaces.find((candidate) => candidate.id === session.workspaceId);
      const mission = this.state.missions.find((candidate) => candidate.id === session.missionId);
      if (!workspace || !mission) return [];
      const searchable = [session.learningGoal, session.sessionTarget, workspace.name, mission.name]
        .join(" ")
        .toLocaleLowerCase();
      if (!terms.every((term) => searchable.includes(term))) return [];
      return [{
        sessionId: session.id,
        learningGoal: session.learningGoal,
        sessionTarget: session.sessionTarget,
        workspaceName: workspace.name,
        missionName: mission.name
      }];
    });
  }

  async restoreModelRuntime(modelRuntime: ModelRuntime): Promise<LearningApplicationState> {
    if (this.modelRuntime && this.modelRuntime !== modelRuntime) {
      await this.modelRuntime.shutdown().catch(() => undefined);
    }
    this.modelRuntime = modelRuntime;
    this.state.runtimeAvailable = true;
    try {
      this.updateAuthentication(await modelRuntime.getAuthentication());
    } catch (error) {
      this.state.authentication = failedAuthentication(null, error);
      this.applyModelAccessFailure(error);
    }
    return this.publishAndPersist();
  }

  async reportModelRuntimeFailure(error: unknown): Promise<LearningApplicationState> {
    this.state.runtimeAvailable = false;
    this.state.modelAccess = unavailableModelAccess(
      error instanceof ModelAccessError ? error : new ModelAccessError("runtime", usefulRuntimeError(error))
    );
    return this.publishAndPersist();
  }

  async linkPrimaryFolder(
    workspaceId: string,
    selection: SelectedLocalSource
  ): Promise<LearningApplicationState> {
    const workspace = this.requireWorkspace(workspaceId);
    if (selection.resourceType !== "folder") throw new Error("Choose a folder for the Primary Folder.");
    if (workspace.context.primaryFolderSourceId) throw new Error("This Study Workspace already has a Primary Folder.");
    this.requireSourcePlacement(workspace, "primaryFolder", selection.canonicalPath);
    const source = linkedSource(workspaceId, "primaryFolder", selection);
    this.state.sources.push(source);
    workspace.context.primaryFolderSourceId = source.id;
    workspace.context.sourceIds.push(source.id);
    return this.publishAndPersist();
  }

  async linkExternalAttachment(
    workspaceId: string,
    selection: SelectedLocalSource
  ): Promise<LearningApplicationState> {
    const workspace = this.requireWorkspace(workspaceId);
    if (selection.resourceType !== "file") throw new Error("Choose a file for an External Attachment.");
    this.requireSourcePlacement(workspace, "externalAttachment", selection.canonicalPath);
    const source = linkedSource(workspaceId, "externalAttachment", selection);
    this.state.sources.push(source);
    workspace.context.sourceIds.push(source.id);
    return this.publishAndPersist();
  }

  async openLinkedSource(sourceId: string): Promise<LinkedSourceView> {
    const source = this.state.sources.find(
      (candidate): candidate is LinkedSource => candidate.id === sourceId && candidate.kind === "linkedSource"
    );
    if (!source) throw new Error("Choose an existing Linked Source.");
    if (!this.sourceAccess) throw new Error("Local source access is unavailable.");
    try {
      const view = await this.sourceAccess.read(source);
      if (!sameFingerprint(source.link.fingerprint, view.fingerprint)) {
        const message = "This source has changed since it was linked. Its original association is retained, but changed-source recovery is not available yet.";
        source.link.accessStatus = "unavailable";
        source.link.error = message;
        await this.publishAndPersist();
        return { status: "unavailable", sourceId, error: message };
      }
      source.link.accessStatus = "available";
      source.link.error = null;
      await this.publishAndPersist();
      return { status: "available", ...view };
    } catch (error) {
      const message = usefulSourceError(error);
      source.link.accessStatus = "unavailable";
      source.link.error = message;
      await this.publishAndPersist();
      return { status: "unavailable", sourceId, error: message };
    }
  }

  async waitForModelWork(): Promise<void> {
    await Promise.all([...this.modelWorks.values()].map((work) => work.promise));
    await this.persistence;
  }

  async shutdown(): Promise<void> {
    const activeWorks = [...this.modelWorks.entries()];
    for (const [sessionId, work] of activeWorks) {
      const session = this.requireSession(sessionId);
      replaceTeachingCard(session, interruptedTeachingCard(session.teachingCard.content));
      work.controller.abort();
    }
    if (activeWorks.length > 0) {
      this.emitState();
      this.queuePersistence();
    }
    await Promise.all(activeWorks.map(([sessionId]) => this.modelRuntime?.cancelTeaching(sessionId).catch(() => undefined)));
    await this.waitForModelWork();
    await this.modelRuntime?.shutdown();
  }

  async submit(action: LearnerAction): Promise<LearningApplicationState> {
    switch (action.type) {
      case "createWorkspace": {
        const workspace: StudyWorkspace = {
          id: crypto.randomUUID(),
          kind: "named",
          name: requiredName(action.name, "Study Workspace"),
          context: emptyWorkspaceContext()
        };
        this.state.workspaces.push(workspace);
        this.state.navigation = { workspaceId: workspace.id, missionId: null };
        this.state.screen = "dashboard";
        break;
      }
      case "renameWorkspace": {
        const workspace = this.state.workspaces.find((candidate) => candidate.id === action.workspaceId);
        if (!workspace || workspace.kind !== "named") throw new Error("Choose a named Study Workspace to rename.");
        workspace.name = requiredName(action.name, "Study Workspace");
        break;
      }
      case "createMission": {
        this.requireNamedWorkspace(action.workspaceId);
        const mission: StudyMission = {
          id: crypto.randomUUID(),
          kind: "named",
          workspaceId: action.workspaceId,
          name: requiredName(action.name, "Study Mission")
        };
        this.state.missions.push(mission);
        this.state.navigation = { workspaceId: action.workspaceId, missionId: mission.id };
        break;
      }
      case "navigateToWorkspace": {
        const workspace = this.state.workspaces.find((candidate) => candidate.id === action.workspaceId);
        if (!workspace) throw new Error("Choose an existing Study Workspace.");
        if (this.state.activeSessionId) this.pauseActiveSessionAndMakeResumable();
        const currentMission = this.state.missions.find(
          (mission) => mission.id === this.state.navigation.missionId && mission.workspaceId === workspace.id
        );
        const firstMission = this.state.missions.find((mission) => mission.workspaceId === workspace.id);
        this.state.navigation = {
          workspaceId: workspace.id,
          missionId: currentMission?.id ?? firstMission?.id ?? null
        };
        this.state.screen = "dashboard";
        break;
      }
      case "navigateToMission": {
        this.requireMission(action.workspaceId, action.missionId);
        if (this.state.activeSessionId) this.pauseActiveSessionAndMakeResumable();
        this.state.navigation = { workspaceId: action.workspaceId, missionId: action.missionId };
        this.state.screen = "dashboard";
        break;
      }
      case "startQuickStudy": {
        const mathematics = action.mathematics.trim();
        if (!mathematics) throw new Error("Typed mathematics is required to start Quick Study.");
        this.pauseActiveSession();
        const managedAsset = this.createManagedTextAsset(this.state.quickStudy.workspace.id, mathematics);
        const session: LearningSession = {
          id: crypto.randomUUID(),
          workspaceId: this.state.quickStudy.workspace.id,
          missionId: this.state.quickStudy.mission.id,
          mathematics,
          sourceIds: [managedAsset.id],
          learningGoal: `Understand ${mathematics}`,
          sessionTarget: "Work through the key mathematical idea",
          status: "active",
          activityOrder: this.nextActivityOrder(),
          returnContext: {
            label: "Your typed mathematics",
            nextAction: "Continue working through the key idea"
          },
          proposal: defaultAcceptedProposal(),
          teachingCard: emptyTeachingCard(),
          teachingCardHistory: [],
          submittedPendingQuestions: [],
          currentTeachingInput: { kind: "sessionIntake", text: mathematics },
          pendingQuestion: null,
          accessPolicy: "focused"
        };
        this.state.sessions.push(session);
        this.state.activeSessionId = session.id;
        this.state.resumeSessionId = session.id;
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "workbench";
        break;
      }
      case "submitSessionIntake": {
        const mathematics = action.mathematics.trim();
        if (!mathematics) throw new Error("Typed mathematics is required to start Quick Study.");
        this.requireModelAccess();
        let proposal: SessionProposal;
        const pendingLog: Array<ModelRuntimeEvent & { sequence: number }> = [];
        const proposalAttemptId = `proposal:${crypto.randomUUID()}`;
        this.agentWorkLogs[proposalAttemptId] = pendingLog;
        const runtime = this.modelRuntime!;
        try {
          proposal = await runtime.proposeSession(mathematics, (event) => {
            pendingLog.push({ ...event, sequence: pendingLog.length + 1 });
          });
          this.state.intakeError = null;
        } catch (error) {
          const message = usefulRuntimeError(error);
          pendingLog.push({
            type: "turnFailed",
            threadId: "unavailable",
            turnId: null,
            detail: error instanceof Error ? error.message : String(error),
            sequence: pendingLog.length + 1
          });
          this.state.intakeError = message;
          this.recordModelAccessLoss(error);
          break;
        }
        this.pauseActiveSession();
        const managedAsset = this.createManagedTextAsset(this.state.quickStudy.workspace.id, mathematics);
        const session: LearningSession = {
          id: crypto.randomUUID(),
          workspaceId: this.state.quickStudy.workspace.id,
          missionId: this.state.quickStudy.mission.id,
          mathematics,
          sourceIds: [managedAsset.id],
          learningGoal: proposal.learningGoal,
          sessionTarget: proposal.scope,
          status: "active",
          activityOrder: this.nextActivityOrder(),
          returnContext: {
            label: "Your typed mathematics",
            nextAction: proposal.initialTeachingDirection
          },
          proposal: {
            scope: proposal.scope,
            initialTeachingDirection: proposal.initialTeachingDirection,
            status: proposal.requiresConfirmation ? "awaitingConfirmation" : "accepted",
            confirmationReason: proposal.confirmationReason
          },
          teachingCard: emptyTeachingCard(),
          teachingCardHistory: [],
          submittedPendingQuestions: [],
          currentTeachingInput: { kind: "sessionIntake", text: mathematics },
          pendingQuestion: null,
          accessPolicy: "focused"
        };
        this.agentWorkLogs[session.id] = pendingLog;
        delete this.agentWorkLogs[proposalAttemptId];
        this.state.sessions.push(session);
        this.state.activeSessionId = session.id;
        this.state.resumeSessionId = session.id;
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "workbench";
        if (!proposal.requiresConfirmation) this.beginTeaching(session);
        break;
      }
      case "reviseSessionProposal": {
        const session = this.requireActiveSession();
        this.reviseProposal(session, action);
        break;
      }
      case "applySessionProposalRevision": {
        const session = this.requireActiveSession();
        const changed = this.reviseProposal(session, action);
        if (changed && this.modelWorks.has(session.id) && !await this.stopModelWork(session)) break;
        if (changed) this.beginTeaching(session);
        break;
      }
      case "confirmSessionProposal": {
        const session = this.requireActiveSession();
        if (session.proposal.status !== "awaitingConfirmation") {
          throw new Error("This Session Proposal does not need confirmation.");
        }
        this.beginTeaching(session);
        break;
      }
      case "cancelModelWork": {
        const session = this.requireActiveSession();
        await this.stopModelWork(session);
        break;
      }
      case "cancelSessionModelWork": {
        await this.stopModelWork(this.requireSession(action.sessionId));
        break;
      }
      case "retryModelWork": {
        const session = this.requireActiveSession();
        this.requireModelAccess();
        if (!session.teachingCard.retryable) throw new Error("This Teaching Card is not ready to retry.");
        if (this.modelWorks.has(session.id)) throw new Error("Restart Codex before retrying this Teaching Card.");
        const input = session.currentTeachingInput;
        const submission = input.kind === "pendingQuestion"
          ? session.submittedPendingQuestions.find((candidate) => candidate.id === input.submissionId) ?? null
          : null;
        this.beginTeaching(session, input.text, submission);
        break;
      }
      case "startChatGptLogin": {
        if (!this.modelRuntime) throw new Error("Codex is unavailable.");
        try {
          const login = await this.modelRuntime.startChatGptLogin();
          this.state.authentication = {
            status: "signingIn",
            method: "chatgpt",
            accountLabel: null,
            loginUrl: login.authUrl,
            error: null
          };
        } catch (error) {
          this.state.authentication = failedAuthentication("chatgpt", error);
        }
        break;
      }
      case "loginWithApiKey": {
        if (!this.modelRuntime) throw new Error("Codex is unavailable.");
        if (!action.apiKey.trim()) throw new Error("An OpenAI API key is required.");
        try {
          await this.modelRuntime.loginWithApiKey(action.apiKey);
          this.updateAuthentication(await this.modelRuntime.getAuthentication());
        } catch (error) {
          this.state.authentication = failedAuthentication("apiKey", error);
          this.applyModelAccessFailure(error);
        }
        break;
      }
      case "refreshAuthentication": {
        if (!this.modelRuntime) throw new Error("Codex is unavailable.");
        try {
          this.updateAuthentication(await this.modelRuntime.getAuthentication());
        } catch (error) {
          this.state.authentication = failedAuthentication(null, error);
          this.applyModelAccessFailure(error);
        }
        break;
      }
      case "savePendingQuestion": {
        if (this.state.modelAccess.status === "available") {
          throw new Error("Submit the Ask Bar question while model access is available.");
        }
        const session = this.requireActiveSession();
        session.pendingQuestion = { id: crypto.randomUUID(), text: requiredText(action.text, "Pending Question") };
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        break;
      }
      case "editPendingQuestion": {
        const session = this.requireActiveSession();
        if (!session.pendingQuestion) throw new Error("There is no Pending Question to edit.");
        session.pendingQuestion.text = requiredText(action.text, "Pending Question");
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        break;
      }
      case "discardPendingQuestion": {
        const session = this.requireActiveSession();
        if (!session.pendingQuestion) throw new Error("There is no Pending Question to discard.");
        session.pendingQuestion = null;
        break;
      }
      case "submitPendingQuestion": {
        this.requireModelAccess();
        const session = this.requireActiveSession();
        if (!session.pendingQuestion) throw new Error("There is no Pending Question to submit.");
        const question = { ...session.pendingQuestion };
        const submission: SubmittedPendingQuestion = {
          ...question,
          teachingCard: emptyTeachingCard()
        };
        this.beginTeaching(session, question.text, submission);
        session.pendingQuestion = null;
        break;
      }
      case "resumeSession": {
        const session = this.requireSession(action.sessionId);
        this.pauseActiveSession();
        session.status = "active";
        session.activityOrder = this.nextActivityOrder();
        this.state.activeSessionId = session.id;
        this.state.resumeSessionId = session.id;
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "workbench";
        break;
      }
      case "leaveSession": {
        const session = this.pauseActiveSessionAndMakeResumable();
        this.state.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
        this.state.screen = "dashboard";
        break;
      }
      case "editLearningGoal": {
        const session = this.requireActiveSession();
        session.learningGoal = action.value;
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        break;
      }
      case "editSessionTarget": {
        const session = this.requireActiveSession();
        session.sessionTarget = action.value;
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        break;
      }
      case "fileSession": {
        const session = this.requireSession(action.sessionId);
        this.requireNamedWorkspace(action.workspaceId);
        this.requireMission(action.workspaceId, action.missionId);
        if (session.workspaceId !== this.state.quickStudy.workspace.id) {
          throw new Error("Only Quick Study sessions can be filed.");
        }
        const originalWorkspace = this.requireWorkspace(session.workspaceId);
        const destinationWorkspace = this.requireWorkspace(action.workspaceId);
        for (const sourceId of session.sourceIds) {
          const source = this.state.sources.find((candidate) => candidate.id === sourceId);
          if (!source || source.workspaceId !== originalWorkspace.id) continue;
          source.workspaceId = destinationWorkspace.id;
          originalWorkspace.context.sourceIds = originalWorkspace.context.sourceIds.filter((id) => id !== sourceId);
          if (!destinationWorkspace.context.sourceIds.includes(sourceId)) destinationWorkspace.context.sourceIds.push(sourceId);
        }
        session.workspaceId = action.workspaceId;
        session.missionId = action.missionId;
        session.activityOrder = this.nextActivityOrder();
        this.state.resumeSessionId = session.id;
        this.state.navigation = { workspaceId: action.workspaceId, missionId: action.missionId };
        break;
      }
    }

    const state = this.getState();
    this.emitState(state);
    this.persistence = this.persistence.catch(() => undefined).then(() => this.persist(state));
    await this.persistence;
    return this.getState();
  }

  private async persist(state: LearningApplicationState): Promise<void> {
    const directory = dirname(this.statePath);
    const temporaryPath = `${this.statePath}.temporary`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify({ ...state, agentWorkLogs: this.agentWorkLogs }, null, 2), "utf8");
    await rename(temporaryPath, this.statePath);
  }

  private beginTeaching(
    session: LearningSession,
    mathematics = session.mathematics,
    submission: SubmittedPendingQuestion | null = null
  ): void {
    this.requireModelAccess();
    if (this.modelWorks.has(session.id)) throw new Error("Model teaching is already active for this Learning Session.");
    if (submission) {
      if (session.currentTeachingInput.kind === "sessionIntake" && session.teachingCard.status !== "idle") {
        session.teachingCardHistory.push(structuredClone(session.teachingCard));
      }
      if (!session.submittedPendingQuestions.some((candidate) => candidate.id === submission.id)) {
        session.submittedPendingQuestions.push(submission);
      }
      session.currentTeachingInput = { kind: "pendingQuestion", submissionId: submission.id, text: submission.text };
    } else {
      session.currentTeachingInput = { kind: "sessionIntake", text: mathematics };
    }
    const controller = new AbortController();
    session.proposal.status = "accepted";
    replaceTeachingCard(session, { status: "streaming", content: "", error: null, retryable: false });
    const runtime = this.modelRuntime!;
    const promise = runtime.streamTeaching({
      sessionId: session.id,
      mathematics,
      learningGoal: session.learningGoal,
      scope: session.proposal.scope,
      initialTeachingDirection: session.proposal.initialTeachingDirection,
      signal: controller.signal,
      onDelta: (delta) => {
        if (session.teachingCard.status !== "streaming") return;
        session.teachingCard.content += delta;
        this.emitState();
        this.queuePersistence();
      },
      onRuntimeEvent: (event) => {
        const log = this.agentWorkLogs[session.id] ??= [];
        log.push({ ...event, sequence: log.length + 1 });
        this.queuePersistence();
      }
    }).then(() => {
      if (session.teachingCard.status === "streaming") {
        session.teachingCard.status = "completed";
        session.returnContext.nextAction = "Review the Teaching Card and continue from the point that needs work";
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const message = usefulRuntimeError(error);
      replaceTeachingCard(session, {
        ...session.teachingCard,
        status: "failed",
        error: message,
        retryable: true
      });
      this.recordModelAccessLoss(error);
    }).finally(() => {
      if (this.modelWorks.get(session.id)?.promise === promise) this.modelWorks.delete(session.id);
      this.queuePersistence();
      this.emitState();
    });
    this.modelWorks.set(session.id, { controller, promise });
  }

  private async stopModelWork(session: LearningSession): Promise<boolean> {
    const work = this.modelWorks.get(session.id);
    if (!this.modelRuntime || !work) throw new Error("There is no active model work to stop.");
    replaceTeachingCard(session, interruptedTeachingCard(session.teachingCard.content));
    work.controller.abort();
    try {
      await this.modelRuntime.cancelTeaching(session.id);
      if (this.modelWorks.get(session.id) === work) this.modelWorks.delete(session.id);
      return true;
    } catch {
      session.teachingCard.error = "Teaching is stopped locally, but Codex did not confirm interruption. Restart Codex before retrying.";
      return false;
    }
  }

  private reviseProposal(
    session: LearningSession,
    revision: { learningGoal: string; scope: string; initialTeachingDirection: string }
  ): boolean {
    const learningGoal = requiredName(revision.learningGoal, "Learning Goal");
    const scope = requiredName(revision.scope, "Session scope");
    const initialTeachingDirection = requiredName(revision.initialTeachingDirection, "Teaching direction");
    const changed = learningGoal !== session.learningGoal
      || scope !== session.proposal.scope
      || initialTeachingDirection !== session.proposal.initialTeachingDirection;
    session.learningGoal = learningGoal;
    session.sessionTarget = scope;
    session.proposal.scope = scope;
    session.proposal.initialTeachingDirection = initialTeachingDirection;
    session.returnContext.nextAction = initialTeachingDirection;
    session.activityOrder = this.nextActivityOrder();
    this.state.resumeSessionId = session.id;
    return changed;
  }

  private recordModelAccessLoss(error: unknown): void {
    if (!(error instanceof ModelAccessError)) return;
    const modelAccess: Extract<ModelAccessState, { status: "unavailable" }> = {
      status: "unavailable",
      cause: error.cause,
      message: error.message
    };
    this.state.modelAccess = modelAccess;
    if (modelAccess.cause === "runtime") this.state.runtimeAvailable = false;
    if (modelAccess.cause === "authentication" || modelAccess.cause === "runtime") {
      this.state.authentication = {
        status: "failed",
        method: this.state.authentication.method,
        accountLabel: null,
        loginUrl: null,
        error: error.message
      };
    }
  }

  private applyModelAccessFailure(error: unknown): void {
    const modelAccess = unavailableModelAccess(error);
    this.state.modelAccess = modelAccess;
    if (modelAccess.cause === "runtime") this.state.runtimeAvailable = false;
  }

  private updateAuthentication(authentication: AuthenticationState): void {
    this.state.authentication = authenticationView(authentication);
    this.state.modelAccess = authentication.status === "signedIn"
      ? { status: "available" }
      : { status: "unavailable", cause: "authentication", message: authenticationMessage(authentication) };
  }

  private requireModelAccess(): void {
    if (!this.modelRuntime || this.state.modelAccess.status === "unavailable") {
      throw new Error(this.state.modelAccess.status === "unavailable"
        ? this.state.modelAccess.message
        : "Connect a Model Runtime before starting model-backed teaching.");
    }
  }

  private emitState(state = this.getState()): void {
    for (const listener of this.stateListeners) listener(state);
  }

  private queuePersistence(): void {
    const state = this.getState();
    this.persistence = this.persistence.catch(() => undefined).then(() => this.persist(state));
  }

  private async publishAndPersist(): Promise<LearningApplicationState> {
    const state = this.getState();
    this.emitState(state);
    this.persistence = this.persistence.catch(() => undefined).then(() => this.persist(state));
    await this.persistence;
    return state;
  }

  private requireActiveSession(): LearningSession {
    if (!this.state.activeSessionId) throw new Error("Resume a Learning Session before editing it.");
    return this.requireSession(this.state.activeSessionId);
  }

  private requireSession(sessionId: string): LearningSession {
    const session = this.state.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error("Choose an existing Learning Session.");
    return session;
  }

  private requireNamedWorkspace(workspaceId: string): StudyWorkspace {
    const workspace = this.state.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace || workspace.kind !== "named") throw new Error("Choose a named Study Workspace.");
    return workspace;
  }

  private requireWorkspace(workspaceId: string): StudyWorkspace {
    const workspace = this.state.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) throw new Error("Choose an existing Study Workspace.");
    return workspace;
  }

  private requireSourcePlacement(
    workspace: StudyWorkspace,
    role: LinkedSource["role"],
    path: string
  ): void {
    const linkedSources = this.state.sources.filter(
      (candidate): candidate is LinkedSource => candidate.workspaceId === workspace.id && candidate.kind === "linkedSource"
    );
    if (role === "externalAttachment") {
      const primaryFolder = linkedSources.find((source) => source.role === "primaryFolder");
      if (primaryFolder && pathIsInside(path, primaryFolder.link.canonicalPath)) {
        throw new Error("This file is already covered by the Primary Folder.");
      }
      return;
    }
    if (linkedSources.some((source) => source.role === "externalAttachment" && pathIsInside(source.link.canonicalPath, path))) {
      throw new Error("An existing External Attachment is already inside this Primary Folder.");
    }
  }

  private createManagedTextAsset(workspaceId: string, content: string): ManagedAsset {
    const workspace = this.requireWorkspace(workspaceId);
    const asset: ManagedAsset = {
      id: crypto.randomUUID(),
      kind: "managedAsset",
      workspaceId,
      name: "Typed mathematics",
      mediaType: "text/plain",
      content
    };
    this.state.sources.push(asset);
    workspace.context.sourceIds.push(asset.id);
    return asset;
  }

  private requireMission(workspaceId: string, missionId: string): StudyMission {
    const mission = this.state.missions.find(
      (candidate) => candidate.id === missionId && candidate.workspaceId === workspaceId
    );
    if (!mission) throw new Error("Choose a Study Mission in this Study Workspace.");
    return mission;
  }

  private pauseActiveSession(): void {
    if (!this.state.activeSessionId) return;
    this.requireSession(this.state.activeSessionId).status = "paused";
  }

  private pauseActiveSessionAndMakeResumable(): LearningSession {
    const session = this.requireActiveSession();
    session.status = "paused";
    session.activityOrder = this.nextActivityOrder();
    this.state.resumeSessionId = session.id;
    this.state.activeSessionId = null;
    return session;
  }

  private nextActivityOrder(): number {
    this.state.activityOrder += 1;
    return this.state.activityOrder;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function requiredName(value: string, subject: string): string {
  const name = value.trim();
  if (!name) throw new Error(`${subject} name is required.`);
  return name;
}

function requiredText(value: string, subject: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${subject} text is required.`);
  return text;
}

function usefulRuntimeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Codex could not complete this Teaching Card. Check authentication and try again.";
}

function usefulSourceError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The source is missing or access is no longer available.";
}

function sameFingerprint(left: SourceFingerprint, right: SourceFingerprint): boolean {
  return left.size === right.size && left.modifiedAtMs === right.modifiedAtMs;
}

function pathIsInside(path: string, folderPath: string): boolean {
  const relation = relative(folderPath, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

function mostRecentSessionId(sessions: LearningSession[]): string | null {
  return sessions.reduce<LearningSession | null>(
    (latest, session) => (!latest || session.activityOrder > latest.activityOrder ? session : latest),
    null
  )?.id ?? null;
}

function migratePersistedState(value: unknown): LearningApplicationState {
  if (!value || typeof value !== "object") throw new Error("Stored Learning Application state is invalid.");
  const stored = value as Record<string, unknown>;
  if (Array.isArray(stored.sessions)) {
    const current = value as LearningApplicationState;
    current.workspaces = current.workspaces.map((workspace) => ({
      ...workspace,
      context: {
        ...(workspace.context ?? emptyWorkspaceContext()),
        primaryFolderSourceId: workspace.context?.primaryFolderSourceId ?? null
      }
    }));
    current.sources = migrateWorkspaceSources(current.sources);
    current.authentication ??= signedOutAuthentication();
    current.intakeError ??= null;
    current.runtimeAvailable ??= false;
    current.modelAccess ??= {
      status: "unavailable",
      cause: "runtime",
      message: "Codex Runtime is unavailable. Restart Codex and try again."
    };
    current.sessions = current.sessions.map((session) => ({
      ...session,
      sourceIds: session.sourceIds ?? [],
      proposal: session.proposal ?? defaultAcceptedProposal(),
      teachingCard: session.teachingCard ?? emptyTeachingCard(),
      teachingCardHistory: session.teachingCardHistory ?? [],
      submittedPendingQuestions: session.submittedPendingQuestions ?? [],
      currentTeachingInput: session.currentTeachingInput ?? { kind: "sessionIntake", text: session.mathematics },
      pendingQuestion: session.pendingQuestion ?? null,
      accessPolicy: session.accessPolicy ?? "focused"
    }));
    return current;
  }

  if (!("session" in stored)) throw new Error("Stored Learning Application state uses an unsupported version.");
  const legacy = value as {
    session: Omit<LearningSession, "activityOrder"> | null;
  };
  const migrated = initialState();
  if (legacy.session) {
    const session: LearningSession = {
      ...legacy.session,
      sourceIds: [],
      status: "paused",
      activityOrder: 1,
      proposal: defaultAcceptedProposal(),
      teachingCard: emptyTeachingCard(),
      teachingCardHistory: [],
      submittedPendingQuestions: [],
      currentTeachingInput: { kind: "sessionIntake", text: legacy.session.mathematics },
      pendingQuestion: null,
      accessPolicy: "focused"
    };
    migrated.sessions.push(session);
    migrated.resumeSessionId = session.id;
    migrated.navigation = { workspaceId: session.workspaceId, missionId: session.missionId };
    migrated.activityOrder = 1;
  }
  return migrated;
}

function migrateAgentWorkLogs(value: unknown): Record<string, Array<ModelRuntimeEvent & { sequence: number }>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Array<ModelRuntimeEvent & { sequence: number }>>
    : {};
}

function defaultAcceptedProposal(): LearningSession["proposal"] {
  return {
    scope: "Work through the key mathematical idea",
    initialTeachingDirection: "Continue working through the key idea",
    status: "accepted",
    confirmationReason: null
  };
}

function emptyTeachingCard(): LearningSession["teachingCard"] {
  return { status: "idle", content: "", error: null, retryable: false };
}

function interruptedTeachingCard(content: string): LearningSession["teachingCard"] {
  return {
    status: "stopped",
    content,
    error: "Teaching stopped. You can retry without losing this Learning Session.",
    retryable: true
  };
}

function replaceTeachingCard(session: LearningSession, teachingCard: TeachingCardState): void {
  session.teachingCard = teachingCard;
  if (session.currentTeachingInput.kind !== "pendingQuestion") return;
  const submissionId = session.currentTeachingInput.submissionId;
  const submission = session.submittedPendingQuestions.find(
    (candidate) => candidate.id === submissionId
  );
  if (submission) submission.teachingCard = teachingCard;
}

function emptyWorkspaceContext(): WorkspaceContext {
  return { sourceIds: [], learnerContextIds: [], primaryFolderSourceId: null };
}

function linkedSource(
  workspaceId: string,
  role: LinkedSource["role"],
  selection: SelectedLocalSource
): LinkedSource {
  return {
    id: crypto.randomUUID(),
    kind: "linkedSource",
    role,
    workspaceId,
    name: selection.name,
    resourceType: selection.resourceType,
    link: {
      lastKnownPath: selection.lastKnownPath,
      canonicalPath: selection.canonicalPath,
      accessGrant: selection.accessGrant,
      fingerprint: selection.fingerprint,
      accessStatus: "available",
      error: null
    }
  };
}

function migrateWorkspaceSources(value: unknown): WorkspaceSource[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Stored sources are invalid.");
  return value.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.workspaceId !== "string"
      || typeof candidate.name !== "string" || !candidate.name.trim()) {
      throw new Error("Stored source is invalid.");
    }
    if (candidate.kind === "managedAsset") {
      if (candidate.mediaType !== "text/plain" || typeof candidate.content !== "string") {
        throw new Error("Stored Managed Asset is invalid.");
      }
      return candidate as unknown as ManagedAsset;
    }
    if (candidate.kind !== "linkedSource" || !["primaryFolder", "externalAttachment"].includes(String(candidate.role))
      || !["file", "folder"].includes(String(candidate.resourceType)) || !isRecord(candidate.link)
      || typeof candidate.link.lastKnownPath !== "string" || !isAbsolute(candidate.link.lastKnownPath)
      || !(candidate.link.canonicalPath === undefined
        || (typeof candidate.link.canonicalPath === "string" && isAbsolute(candidate.link.canonicalPath)))
      || !validAccessGrant(candidate.link.accessGrant) || !validFingerprint(candidate.link.fingerprint)
      || !["available", "unavailable"].includes(String(candidate.link.accessStatus))
      || !(candidate.link.error === null || typeof candidate.link.error === "string")) {
      throw new Error("Stored Linked Source is invalid.");
    }
    const source = candidate as unknown as LinkedSource;
    source.link.canonicalPath = typeof candidate.link.canonicalPath === "string"
      ? candidate.link.canonicalPath
      : candidate.link.lastKnownPath as string;
    return source;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validAccessGrant(value: unknown): value is LocalSourceAccessGrant {
  return value === null || (isRecord(value) && value.kind === "securityScopedBookmark"
    && typeof value.bookmarkData === "string" && Boolean(value.bookmarkData));
}

function validFingerprint(value: unknown): value is SourceFingerprint {
  return isRecord(value) && typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0
    && typeof value.modifiedAtMs === "number" && Number.isFinite(value.modifiedAtMs) && value.modifiedAtMs >= 0;
}

function initialState(): LearningApplicationState {
  return {
    screen: "dashboard",
    quickStudy: {
      workspace: { id: "quick-study-workspace", kind: "system", name: "Quick Study" },
      mission: {
        id: "quick-study-unfiled-mission",
        kind: "unfiled",
        workspaceId: "quick-study-workspace"
      }
    },
    workspaces: [{
      id: "quick-study-workspace",
      kind: "system",
      name: "Quick Study",
      context: emptyWorkspaceContext()
    }],
    missions: [
      {
        id: "quick-study-unfiled-mission",
        kind: "unfiled",
        workspaceId: "quick-study-workspace",
        name: "Unfiled"
      }
    ],
    sessions: [],
    sources: [],
    activeSessionId: null,
    resumeSessionId: null,
    navigation: {
      workspaceId: "quick-study-workspace",
      missionId: "quick-study-unfiled-mission"
    },
    activityOrder: 0,
    authentication: signedOutAuthentication(),
    intakeError: null,
    runtimeAvailable: false,
    modelAccess: {
      status: "unavailable",
      cause: "runtime",
      message: "Codex Runtime is unavailable. Restart Codex and try again."
    }
  };
}

function unavailableModelAccess(error: unknown): Extract<ModelAccessState, { status: "unavailable" }> {
  const message = usefulRuntimeError(error);
  return {
    status: "unavailable",
    cause: error instanceof ModelAccessError ? error.cause : "runtime",
    message
  };
}

function authenticationMessage(authentication: Exclude<AuthenticationState, { status: "signedIn" }>): string {
  if (authentication.status === "failed") return authentication.error;
  if (authentication.status === "signingIn") return "Finish Codex authentication to restore model teaching.";
  return "Codex authentication is required for model teaching.";
}

function authenticationView(authentication: AuthenticationState): LearningApplicationState["authentication"] {
  switch (authentication.status) {
    case "signedOut":
      return signedOutAuthentication();
    case "signingIn":
      return {
        status: "signingIn",
        method: authentication.method,
        accountLabel: null,
        loginUrl: null,
        error: null
      };
    case "signedIn":
      return {
        status: "signedIn",
        method: authentication.method,
        accountLabel: authentication.accountLabel,
        loginUrl: null,
        error: null
      };
    case "failed":
      return {
        status: "failed",
        method: authentication.method,
        accountLabel: null,
        loginUrl: null,
        error: authentication.error
      };
  }
}

function signedOutAuthentication(): LearningApplicationState["authentication"] {
  return { status: "signedOut", method: null, accountLabel: null, loginUrl: null, error: null };
}

function failedAuthentication(
  method: "chatgpt" | "apiKey" | null,
  error: unknown
): LearningApplicationState["authentication"] {
  return {
    status: "failed",
    method,
    accountLabel: null,
    loginUrl: null,
    error: usefulRuntimeError(error)
  };
}
