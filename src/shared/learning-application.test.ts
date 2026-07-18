import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LearningApplication } from "./learning-application";

describe("Learning Application", () => {
  const dataDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(dataDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function launch() {
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    return {
      dataDirectory,
      application: await LearningApplication.launch(dataDirectory)
    };
  }

  it("starts Quick Study from typed mathematics with an editable goal and target", async () => {
    const { application } = await launch();

    await application.submit({
      type: "startQuickStudy",
      mathematics: "Prove that the square root of 2 is irrational."
    });
    await application.submit({ type: "editLearningGoal", value: "Understand the contradiction strategy" });
    const state = await application.submit({ type: "editSessionTarget", value: "Explain why even squares have even roots" });

    expect(state).toMatchObject({
      screen: "workbench",
      quickStudy: {
        workspace: { id: "quick-study-workspace", kind: "system", name: "Quick Study" },
        mission: {
          id: "quick-study-unfiled-mission",
          kind: "unfiled",
          workspaceId: "quick-study-workspace"
        }
      },
      sessions: [{
          workspaceId: "quick-study-workspace",
          missionId: "quick-study-unfiled-mission",
          mathematics: "Prove that the square root of 2 is irrational.",
          learningGoal: "Understand the contradiction strategy",
          sessionTarget: "Explain why even squares have even roots",
          status: "active"
      }]
    });
  });

  it("reloads paused Quick Study work with its return context intact", async () => {
    const { application, dataDirectory } = await launch();

    await application.submit({ type: "startQuickStudy", mathematics: "Evaluate the integral of x squared." });
    await application.submit({ type: "editLearningGoal", value: "Connect powers to antiderivatives" });
    await application.submit({ type: "editSessionTarget", value: "Derive the power rule example" });
    await application.submit({ type: "leaveSession" });

    const reloaded = await LearningApplication.launch(dataDirectory);
    expect(reloaded.getState()).toMatchObject({
      screen: "dashboard",
      sessions: [{
        learningGoal: "Connect powers to antiderivatives",
        sessionTarget: "Derive the power rule example",
        status: "paused",
        returnContext: {
          label: "Your typed mathematics",
          nextAction: "Continue working through the key idea"
        }
      }]
    });

    const sessionId = reloaded.getState().sessions[0].id;
    const resumed = await reloaded.submit({ type: "resumeSession", sessionId });
    expect(resumed).toMatchObject({ screen: "workbench", activeSessionId: sessionId });
    expect(resumed.sessions[0].status).toBe("active");
  });

  it("creates, renames, navigates, and reloads a Study Workspace with multiple Study Missions", async () => {
    const { application, dataDirectory } = await launch();

    const created = await application.submit({ type: "createWorkspace", name: "Abstract Algebra" });
    const workspace = created.workspaces.find((candidate) => candidate.name === "Abstract Algebra");
    expect(workspace).toBeDefined();

    await application.submit({
      type: "renameWorkspace",
      workspaceId: workspace!.id,
      name: "Algebra II"
    });
    const firstMissionState = await application.submit({
      type: "createMission",
      workspaceId: workspace!.id,
      name: "Understand group actions"
    });
    const secondMissionState = await application.submit({
      type: "createMission",
      workspaceId: workspace!.id,
      name: "Study the Sylow proofs"
    });
    const firstMission = firstMissionState.missions.find((mission) => mission.name === "Understand group actions");
    const secondMission = secondMissionState.missions.find((mission) => mission.name === "Study the Sylow proofs");

    const navigated = await application.submit({
      type: "navigateToMission",
      workspaceId: workspace!.id,
      missionId: firstMission!.id
    });
    expect(navigated.navigation).toEqual({ workspaceId: workspace!.id, missionId: firstMission!.id });
    expect(navigated.missions.filter((mission) => mission.workspaceId === workspace!.id)).toHaveLength(2);
    expect(secondMission).toMatchObject({ workspaceId: workspace!.id });

    const reloaded = await LearningApplication.launch(dataDirectory);
    expect(reloaded.getState()).toMatchObject({
      screen: "dashboard",
      navigation: { workspaceId: workspace!.id, missionId: firstMission!.id },
      workspaces: [{ id: "quick-study-workspace", name: "Quick Study" }, { id: workspace!.id, name: "Algebra II" }]
    });
    expect(reloaded.getState().missions.filter((mission) => mission.workspaceId === workspace!.id)).toHaveLength(2);
    expect(reloaded.getState().workspaces.find((candidate) => candidate.id === workspace!.id)).toMatchObject({
      context: { sourceIds: [], learnerContextIds: [] }
    });
    expect(firstMission).not.toHaveProperty("context");
    expect(secondMission).not.toHaveProperty("context");
  });

  it("files Quick Study work intact and orders the Resume Card by the most recently touched session", async () => {
    const { application, dataDirectory } = await launch();

    let state = await application.submit({ type: "startQuickStudy", mathematics: "Classify groups of order 15." });
    const filedSessionId = state.activeSessionId!;
    await application.submit({ type: "editLearningGoal", value: "Use the Sylow theorems" });
    await application.submit({ type: "editSessionTarget", value: "Control the Sylow subgroups" });
    await application.submit({ type: "leaveSession" });

    state = await application.submit({ type: "startQuickStudy", mathematics: "Compute the units modulo 8." });
    const latestSessionId = state.activeSessionId!;
    await application.submit({ type: "leaveSession" });

    state = await application.submit({ type: "createWorkspace", name: "Abstract Algebra" });
    const workspaceId = state.navigation.workspaceId;
    state = await application.submit({ type: "createMission", workspaceId, name: "Finite group structure" });
    const missionId = state.navigation.missionId!;
    const filed = await application.submit({ type: "fileSession", sessionId: filedSessionId, workspaceId, missionId });
    const movedSession = filed.sessions.find((session) => session.id === filedSessionId);

    expect(movedSession).toMatchObject({
      id: filedSessionId,
      workspaceId,
      missionId,
      mathematics: "Classify groups of order 15.",
      learningGoal: "Use the Sylow theorems",
      sessionTarget: "Control the Sylow subgroups",
      status: "paused",
      returnContext: {
        label: "Your typed mathematics",
        nextAction: "Continue working through the key idea"
      }
    });
    expect(filed.resumeSessionId).toBe(filedSessionId);
    expect(latestSessionId).not.toBe(filedSessionId);

    const reloaded = await LearningApplication.launch(dataDirectory);
    expect(reloaded.getState()).toMatchObject({
      screen: "dashboard",
      resumeSessionId: filedSessionId,
      navigation: { workspaceId, missionId }
    });
    expect(reloaded.getState().sessions).toHaveLength(2);
  });

  it("migrates the durable Quick Study session created by the previous application version", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    await writeFile(join(dataDirectory, "learning-application.json"), JSON.stringify({
      screen: "resume",
      quickStudy: {
        workspace: { id: "quick-study-workspace", kind: "system", name: "Quick Study" },
        mission: {
          id: "quick-study-unfiled-mission",
          kind: "unfiled",
          workspaceId: "quick-study-workspace"
        }
      },
      session: {
        id: "legacy-session",
        workspaceId: "quick-study-workspace",
        missionId: "quick-study-unfiled-mission",
        mathematics: "Prove that the square root of 3 is irrational.",
        learningGoal: "Understand the contradiction",
        sessionTarget: "Track divisibility by three",
        status: "paused",
        returnContext: {
          label: "Your typed mathematics",
          nextAction: "Continue working through the key idea"
        }
      }
    }, null, 2), "utf8");

    const migrated = await LearningApplication.launch(dataDirectory);
    expect(migrated.getState()).toMatchObject({
      screen: "dashboard",
      activeSessionId: null,
      resumeSessionId: "legacy-session",
      sessions: [{
        id: "legacy-session",
        mathematics: "Prove that the square root of 3 is irrational.",
        learningGoal: "Understand the contradiction",
        sessionTarget: "Track divisibility by three",
        status: "paused"
      }]
    });
  });

  it("pauses an active Learning Session when hierarchy navigation returns to the dashboard", async () => {
    const { application } = await launch();
    const started = await application.submit({ type: "startQuickStudy", mathematics: "Find the derivative of sine." });
    const sessionId = started.activeSessionId!;

    const navigated = await application.submit({
      type: "navigateToWorkspace",
      workspaceId: "quick-study-workspace"
    });

    expect(navigated).toMatchObject({
      screen: "dashboard",
      activeSessionId: null,
      resumeSessionId: sessionId,
      sessions: [{ id: sessionId, status: "paused" }]
    });
  });
});
