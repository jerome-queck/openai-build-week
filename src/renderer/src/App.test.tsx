// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningApplicationState } from "../../shared/learning-application";
import { App } from "./App";

describe("anchored teaching workbench", () => {
  afterEach(cleanup);

  it("restores a closed Contextual Inspector only through its Anchor Marker and returns focus on close", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    window.quickStudy = {
      getState: vi.fn().mockResolvedValue(state),
      submit: vi.fn().mockResolvedValue(state),
      getAgentWorkLogEvidence: vi.fn().mockResolvedValue([{
        sequence: 1,
        type: "turnStarted",
        summary: "Teaching runtime turn started."
      }]),
      searchSessions: vi.fn().mockResolvedValue([]),
      linkPrimaryFolder: vi.fn(),
      linkExternalAttachment: vi.fn(),
      openLinkedSource: vi.fn(),
      indexSource: vi.fn(),
      clearSourceIndex: vi.fn(),
      rebuildSourceIndex: vi.fn(),
      searchSourceIndex: vi.fn().mockResolvedValue([]),
      openSourceSearchResult: vi.fn(),
      onStateChanged: vi.fn().mockReturnValue(() => undefined),
      openExternal: vi.fn()
    };

    render(<App />);
    const marker = await screen.findByRole("button", {
      name: "Open Anchor Marker for Text Source Anchor: compact subset (characters 6–20)"
    });
    expect(screen.getByRole("article", { name: "Pinned Learning Artifact Explain compact subset" }).textContent).toContain(
      "Pinned on the main canvas"
    );
    await user.click(screen.getByRole("button", { name: "Inspect Agent Work Log events 1–2" }));
    expect(screen.getByRole("list", { name: "Agent Work Log evidence" }).textContent).toContain("Teaching runtime turn started.");
    expect(screen.queryByRole("complementary", { name: "Contextual Inspector for Explain compact subset" })).toBeNull();

    await user.click(marker);
    expect(window.quickStudy.submit).toHaveBeenCalledWith({ type: "activateSourceAnchor", sourceAnchorId: "anchor-1" });
    expect(screen.getByRole("complementary", { name: "Contextual Inspector for Explain compact subset" })).toBeTruthy();
    const close = screen.getByRole("button", { name: "Close Contextual Inspector" });
    expect(close).toBe(document.activeElement);
    await user.click(close);

    expect(screen.queryByRole("complementary", { name: "Contextual Inspector for Explain compact subset" })).toBeNull();
    expect(marker).toBe(document.activeElement);

    vi.mocked(window.quickStudy.submit).mockRejectedValueOnce(new Error("The Source Anchor is stale."));
    await user.click(marker);
    expect((await screen.findByRole("alert")).textContent).toContain("The Source Anchor is stale.");
  });

  it("shows the compact Argument Roadmap and lets the learner edit or choose a Learning Slice before teaching", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.modelAccess = { status: "available" };
    state.runtimeAvailable = true;
    state.sessions[0].proposal.status = "awaitingConfirmation";
    state.sessions[0].learningSlice = {
      roadmapId: "roadmap-1", stageId: "stage-1", boundary: "Prove only the compactness claim",
      immediatePrerequisites: ["Hausdorff separation"]
    };
    state.argumentRoadmaps = [{
      id: "roadmap-1", missionId: state.sessions[0].missionId, sourceId: "source-1",
      title: "Compactness to uniqueness", selectedStageId: "stage-1",
      stages: [
        {
          id: "stage-1", title: "Compact subsets are closed", majorClaim: "Every compact subset is closed.",
          dependsOnStageIds: [], sourceAnchorId: "anchor-1", sessionId: "session-1"
        },
        {
          id: "stage-2", title: "Limits are unique", majorClaim: "Limits are unique in Hausdorff spaces.",
          dependsOnStageIds: ["stage-1"], sourceAnchorId: "anchor-2", sessionId: "session-2"
        }
      ]
    }];
    window.quickStudy = quickStudyApi(state);

    render(<App />);

    const roadmap = await screen.findByRole("region", { name: "Argument Roadmap" });
    expect(roadmap.textContent).toContain("Compactness to uniqueness");
    expect(roadmap.textContent).toContain("Every compact subset is closed.");
    expect(roadmap.textContent).toContain("Depends on Compact subsets are closed");
    expect(roadmap.textContent).toContain("Source Anchor “compact subset” · characters 6–20");
    await user.click(screen.getByRole("button", { name: "Show Source Anchor for Compact subsets are closed" }));
    expect(window.quickStudy.submit).toHaveBeenCalledWith({ type: "activateSourceAnchor", sourceAnchorId: "anchor-1" });
    await user.clear(screen.getByLabelText("Learning Slice boundary"));
    await user.type(screen.getByLabelText("Learning Slice boundary"), "Prove the claim using finite subcovers");
    await user.clear(screen.getByLabelText("Immediate prerequisites"));
    await user.type(screen.getByLabelText("Immediate prerequisites"), "Hausdorff separation\nFinite subcovers");
    await user.click(screen.getByRole("button", { name: "Save Learning Slice" }));
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "reviseLearningSlice",
      boundary: "Prove the claim using finite subcovers",
      immediatePrerequisites: ["Hausdorff separation", "Finite subcovers"]
    });

    await user.click(screen.getByRole("button", { name: "Choose Learning Slice Limits are unique" }));
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "selectRoadmapStage", roadmapId: "roadmap-1", stageId: "stage-2"
    });

    vi.mocked(window.quickStudy.submit).mockRejectedValueOnce(new Error("The roadmap Source Anchor is stale."));
    await user.click(screen.getByRole("button", { name: "Show Source Anchor for Compact subsets are closed" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The roadmap Source Anchor is stale.");
  });
});

function quickStudyApi(state: LearningApplicationState): typeof window.quickStudy {
  return {
    getState: vi.fn().mockResolvedValue(state), submit: vi.fn().mockResolvedValue(state),
    getAgentWorkLogEvidence: vi.fn().mockResolvedValue([]), searchSessions: vi.fn().mockResolvedValue([]),
    linkPrimaryFolder: vi.fn(), linkExternalAttachment: vi.fn(), openLinkedSource: vi.fn(),
    indexSource: vi.fn(), clearSourceIndex: vi.fn(), rebuildSourceIndex: vi.fn(),
    searchSourceIndex: vi.fn().mockResolvedValue([]), openSourceSearchResult: vi.fn(),
    onStateChanged: vi.fn().mockReturnValue(() => undefined), openExternal: vi.fn()
  };
}

function workbenchState(): LearningApplicationState {
  const anchor = {
    id: "anchor-1",
    sourceId: "source-1",
    selection: {
      kind: "text" as const,
      startOffset: 6,
      endOffset: 20,
      exactText: "compact subset",
      prefix: "Every ",
      suffix: " is closed."
    }
  };
  return {
    screen: "workbench",
    quickStudy: {
      workspace: { id: "quick-study-workspace", kind: "system", name: "Quick Study" },
      mission: { id: "quick-study-unfiled-mission", kind: "unfiled", workspaceId: "quick-study-workspace" }
    },
    workspaces: [{
      id: "quick-study-workspace", kind: "system", name: "Quick Study",
      context: { sourceIds: ["source-1"], learnerContextIds: [], primaryFolderSourceId: null }
    }],
    missions: [{ id: "quick-study-unfiled-mission", kind: "unfiled", workspaceId: "quick-study-workspace", name: "Unfiled" }],
    argumentRoadmaps: [],
    sessions: [{
      id: "session-1",
      workspaceId: "quick-study-workspace",
      missionId: "quick-study-unfiled-mission",
      mathematics: "Every compact subset is closed.",
      sourceIds: ["source-1"],
      learningGoal: "Understand compactness",
      sessionTarget: "Explain the selected claim",
      status: "active",
      activityOrder: 1,
      returnContext: { label: "Your typed mathematics", nextAction: "Review the anchored explanation" },
      proposal: { scope: "One claim", initialTeachingDirection: "Start from definitions", status: "accepted", confirmationReason: null },
      teachingCard: { status: "completed", content: "Session overview", error: null, retryable: false },
      teachingCardHistory: [],
      submittedPendingQuestions: [],
      currentTeachingInput: { kind: "sessionIntake", text: "Every compact subset is closed." },
      pendingQuestion: null,
      askBarContext: {
        items: [],
        includedIds: [],
        customized: false
      },
      questionCards: [],
      activeQuestionCardId: null,
      accessPolicy: "focused",
      accessRequests: [],
      pendingFullAccessConfirmation: false,
      sourceAnchors: [anchor],
      sourceAnchorRequests: [{ id: "request-1", sourceAnchorId: "anchor-1", action: "explain" }],
      activeSourceAnchorId: "anchor-1",
      anchoredTeachingCards: [{
        id: "card-1",
        sourceAnchorId: "anchor-1",
        title: "Explain compact subset",
        currentRevision: {
          id: "revision-1", instruction: "Explain", status: "completed", content: "Use a finite subcover.",
          error: null, retryable: false, contextUsed: [],
          agentWorkLogReference: { sessionId: "session-1", fromSequence: 1, toSequence: 2 }
        },
        revisions: [], variants: [], artifactId: "artifact-1"
      }],
      activeTeachingCardId: "card-1",
      learningArtifacts: [{
        id: "artifact-1",
        title: "Explain compact subset",
        currentRevision: {
          id: "artifact-revision-1",
          content: "Use a finite subcover.",
          claimOrigin: "modelGenerated",
          verificationLevel: "notIndependentlyChecked",
          verificationCurrency: "current"
        },
        revisions: [],
        sourceAnchorIds: ["anchor-1"],
        pinned: true
      }],
      learningSlice: null
    }],
    sources: [{
      id: "source-1", kind: "managedAsset", workspaceId: "quick-study-workspace", name: "Typed mathematics",
      mediaType: "text/plain", content: "Every compact subset is closed."
    }],
    sourceIndexes: [],
    activeSessionId: "session-1",
    resumeSessionId: "session-1",
    navigation: { workspaceId: "quick-study-workspace", missionId: "quick-study-unfiled-mission" },
    activityOrder: 1,
    authentication: { status: "failed", method: null, accountLabel: null, loginUrl: null, error: "Unavailable" },
    intakeError: null,
    runtimeAvailable: false,
    modelAccess: { status: "unavailable", cause: "runtime", message: "Unavailable" },
    accessConfirmationPreference: { confirmFullAccess: true }
  };
}
