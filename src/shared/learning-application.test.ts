import { mkdtemp, rm } from "node:fs/promises";
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
      session: {
        workspaceId: "quick-study-workspace",
        missionId: "quick-study-unfiled-mission",
        mathematics: "Prove that the square root of 2 is irrational.",
        learningGoal: "Understand the contradiction strategy",
        sessionTarget: "Explain why even squares have even roots",
        status: "active"
      }
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
      screen: "resume",
      session: {
        learningGoal: "Connect powers to antiderivatives",
        sessionTarget: "Derive the power rule example",
        status: "paused",
        returnContext: {
          label: "Your typed mathematics",
          nextAction: "Continue working through the key idea"
        }
      }
    });

    const resumed = await reloaded.submit({ type: "resumeSession" });
    expect(resumed).toMatchObject({ screen: "workbench", session: { status: "active" } });
  });
});
