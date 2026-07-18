import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuthenticationState, ModelRuntime, ModelRuntimeEvent, SessionProposal } from "./model-runtime";

export type SessionStatus = "active" | "paused";

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
}

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
  teachingCard: {
    status: "idle" | "streaming" | "completed" | "stopped" | "failed";
    content: string;
    error: string | null;
    retryable: boolean;
  };
  accessPolicy: "focused";
}

export interface LearningApplicationState {
  screen: "dashboard" | "workbench";
  quickStudy: QuickStudyHome;
  workspaces: StudyWorkspace[];
  missions: StudyMission[];
  sessions: LearningSession[];
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
  private readonly modelRuntime: ModelRuntime | null;
  private persistence = Promise.resolve();
  private readonly modelWorks = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private readonly stateListeners = new Set<(state: LearningApplicationState) => void>();
  private agentWorkLogs: Record<string, Array<ModelRuntimeEvent & { sequence: number }>> = {};

  private constructor(dataDirectory: string, modelRuntime: ModelRuntime | null) {
    this.statePath = join(dataDirectory, "learning-application.json");
    this.modelRuntime = modelRuntime;
  }

  static async launch(dataDirectory: string, modelRuntime: ModelRuntime | null = null): Promise<LearningApplication> {
    const application = new LearningApplication(dataDirectory, modelRuntime);
    try {
      const stored = JSON.parse(await readFile(application.statePath, "utf8")) as Record<string, unknown>;
      const { agentWorkLogs, ...storedState } = stored;
      const persisted = migratePersistedState(storedState);
      application.agentWorkLogs = migrateAgentWorkLogs(agentWorkLogs);
      for (const session of persisted.sessions) {
        if (session.status === "active") session.status = "paused";
        if (session.teachingCard.status === "streaming") {
          session.teachingCard = interruptedTeachingCard(session.teachingCard.content);
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
        application.state.authentication = authenticationView(await modelRuntime.getAuthentication());
      } catch (error) {
        application.state.authentication = failedAuthentication(null, error);
      }
    } else {
      application.state.runtimeAvailable = false;
      application.state.authentication = failedAuthentication(null, new Error("Codex Runtime is unavailable. Restart Codex and try again."));
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

  async waitForModelWork(): Promise<void> {
    await Promise.all([...this.modelWorks.values()].map((work) => work.promise));
    await this.persistence;
  }

  async shutdown(): Promise<void> {
    const activeWorks = [...this.modelWorks.entries()];
    for (const [sessionId, work] of activeWorks) {
      const session = this.requireSession(sessionId);
      session.teachingCard = interruptedTeachingCard(session.teachingCard.content);
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
        const session: LearningSession = {
          id: crypto.randomUUID(),
          workspaceId: this.state.quickStudy.workspace.id,
          missionId: this.state.quickStudy.mission.id,
          mathematics,
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
        if (!this.modelRuntime) throw new Error("Connect a Model Runtime before starting model-backed teaching.");
        let proposal: SessionProposal;
        const pendingLog: Array<ModelRuntimeEvent & { sequence: number }> = [];
        const proposalAttemptId = `proposal:${crypto.randomUUID()}`;
        this.agentWorkLogs[proposalAttemptId] = pendingLog;
        try {
          proposal = await this.modelRuntime.proposeSession(mathematics, (event) => {
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
          this.recordAuthenticationLoss(message);
          break;
        }
        this.pauseActiveSession();
        const session: LearningSession = {
          id: crypto.randomUUID(),
          workspaceId: this.state.quickStudy.workspace.id,
          missionId: this.state.quickStudy.mission.id,
          mathematics,
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
        if (!session.teachingCard.retryable) throw new Error("This Teaching Card is not ready to retry.");
        if (this.modelWorks.has(session.id)) throw new Error("Restart Codex before retrying this Teaching Card.");
        this.beginTeaching(session);
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
          this.state.authentication = authenticationView(await this.modelRuntime.getAuthentication());
        } catch (error) {
          this.state.authentication = failedAuthentication("apiKey", error);
        }
        break;
      }
      case "refreshAuthentication": {
        if (!this.modelRuntime) throw new Error("Codex is unavailable.");
        try {
          this.state.authentication = authenticationView(await this.modelRuntime.getAuthentication());
        } catch (error) {
          this.state.authentication = failedAuthentication(null, error);
        }
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
    return state;
  }

  private async persist(state: LearningApplicationState): Promise<void> {
    const directory = dirname(this.statePath);
    const temporaryPath = `${this.statePath}.temporary`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify({ ...state, agentWorkLogs: this.agentWorkLogs }, null, 2), "utf8");
    await rename(temporaryPath, this.statePath);
  }

  private beginTeaching(session: LearningSession): void {
    if (!this.modelRuntime) throw new Error("Connect a Model Runtime before starting model-backed teaching.");
    const controller = new AbortController();
    session.proposal.status = "accepted";
    session.teachingCard = { status: "streaming", content: "", error: null, retryable: false };
    const runtime = this.modelRuntime;
    const promise = runtime.streamTeaching({
      sessionId: session.id,
      mathematics: session.mathematics,
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
      session.teachingCard = {
        ...session.teachingCard,
        status: "failed",
        error: message,
        retryable: true
      };
      this.recordAuthenticationLoss(message);
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
    session.teachingCard = interruptedTeachingCard(session.teachingCard.content);
    work.controller.abort();
    try {
      await this.modelRuntime.cancelTeaching(session.id);
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

  private recordAuthenticationLoss(message: string): void {
    const runtimeLost = /runtime became unavailable|runtime is unavailable/i.test(message);
    if (runtimeLost) {
      this.state.runtimeAvailable = false;
    }
    if (!runtimeLost && !/authentication|sign in|credential/i.test(message)) return;
    this.state.authentication = {
      status: "failed",
      method: this.state.authentication.method,
      accountLabel: null,
      loginUrl: null,
      error: message
    };
  }

  private emitState(state = this.getState()): void {
    for (const listener of this.stateListeners) listener(state);
  }

  private queuePersistence(): void {
    const state = this.getState();
    this.persistence = this.persistence.catch(() => undefined).then(() => this.persist(state));
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

function usefulRuntimeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Codex could not complete this Teaching Card. Check authentication and try again.";
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
      context: workspace.context ?? emptyWorkspaceContext()
    }));
    current.authentication ??= signedOutAuthentication();
    current.intakeError ??= null;
    current.runtimeAvailable ??= false;
    current.sessions = current.sessions.map((session) => ({
      ...session,
      proposal: session.proposal ?? defaultAcceptedProposal(),
      teachingCard: session.teachingCard ?? emptyTeachingCard(),
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
      status: "paused",
      activityOrder: 1,
      proposal: defaultAcceptedProposal(),
      teachingCard: emptyTeachingCard(),
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

function emptyWorkspaceContext(): WorkspaceContext {
  return { sourceIds: [], learnerContextIds: [] };
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
    activeSessionId: null,
    resumeSessionId: null,
    navigation: {
      workspaceId: "quick-study-workspace",
      missionId: "quick-study-unfiled-mission"
    },
    activityOrder: 0,
    authentication: signedOutAuthentication(),
    intakeError: null,
    runtimeAvailable: false
  };
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
