import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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

export interface LearningSession {
  id: string;
  workspaceId: QuickStudyHome["workspace"]["id"];
  missionId: QuickStudyHome["mission"]["id"];
  mathematics: string;
  learningGoal: string;
  sessionTarget: string;
  status: SessionStatus;
  returnContext: {
    label: string;
    nextAction: string;
  };
}

export interface LearningApplicationState {
  screen: "intake" | "workbench" | "resume";
  quickStudy: QuickStudyHome;
  session: LearningSession | null;
}

export type LearnerAction =
  | { type: "startQuickStudy"; mathematics: string }
  | { type: "editLearningGoal"; value: string }
  | { type: "editSessionTarget"; value: string }
  | { type: "leaveSession" }
  | { type: "resumeSession" };

export class LearningApplication {
  private state: LearningApplicationState = initialState();
  private readonly statePath: string;
  private persistence = Promise.resolve();

  private constructor(dataDirectory: string) {
    this.statePath = join(dataDirectory, "learning-application.json");
  }

  static async launch(dataDirectory: string): Promise<LearningApplication> {
    const application = new LearningApplication(dataDirectory);
    try {
      const persisted = JSON.parse(await readFile(application.statePath, "utf8")) as LearningApplicationState;
      if (persisted.session) {
        persisted.session.status = "paused";
        persisted.screen = "resume";
      }
      application.state = persisted;
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
    return application;
  }

  getState(): LearningApplicationState {
    return structuredClone(this.state);
  }

  async submit(action: LearnerAction): Promise<LearningApplicationState> {
    if (action.type === "startQuickStudy") {
      const mathematics = action.mathematics.trim();
      if (!mathematics) {
        throw new Error("Typed mathematics is required to start Quick Study.");
      }
      this.state = {
        screen: "workbench",
        quickStudy: this.state.quickStudy,
        session: {
          id: crypto.randomUUID(),
          workspaceId: this.state.quickStudy.workspace.id,
          missionId: this.state.quickStudy.mission.id,
          mathematics,
          learningGoal: `Understand ${mathematics}`,
          sessionTarget: "Work through the key mathematical idea",
          status: "active",
          returnContext: {
            label: "Your typed mathematics",
            nextAction: "Continue working through the key idea"
          }
        }
      };
    } else if (action.type === "resumeSession") {
      const session = this.requireSession();
      session.status = "active";
      this.state.screen = "workbench";
    } else if (action.type === "leaveSession") {
      const session = this.requireSession();
      session.status = "paused";
      this.state.screen = "resume";
    } else {
      const session = this.requireSession();
      if (action.type === "editLearningGoal") {
        session.learningGoal = action.value;
      } else {
        session.sessionTarget = action.value;
      }
    }

    const state = this.getState();
    this.persistence = this.persistence
      .catch(() => undefined)
      .then(() => this.persist(state));
    await this.persistence;
    return state;
  }

  private async persist(state: LearningApplicationState): Promise<void> {
    const directory = dirname(this.statePath);
    const temporaryPath = `${this.statePath}.temporary`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    await rename(temporaryPath, this.statePath);
  }

  private requireSession(): LearningSession {
    if (!this.state.session) {
      throw new Error("Start a Quick Study session before editing it.");
    }
    return this.state.session;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function initialState(): LearningApplicationState {
  return {
    screen: "intake",
    quickStudy: {
      workspace: { id: "quick-study-workspace", kind: "system", name: "Quick Study" },
      mission: {
        id: "quick-study-unfiled-mission",
        kind: "unfiled",
        workspaceId: "quick-study-workspace"
      }
    },
    session: null
  };
}
