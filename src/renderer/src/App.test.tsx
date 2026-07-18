// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

  it("announces and stops in-flight Concept Peek generation", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.sessions[0].pendingConceptPeek = {
      sourceAnchorId: "anchor-1",
      prerequisite: "Hausdorff separation"
    };
    window.quickStudy = quickStudyApi(state);
    vi.mocked(window.quickStudy.submit).mockRejectedValueOnce(new Error("Codex did not confirm interruption."));

    render(<App />);

    const pendingStatus = (await screen.findByText("Creating Concept Peek: Hausdorff separation")).closest("[role='status']");
    expect(pendingStatus).toBeTruthy();
    const stop = screen.getByRole("button", { name: "Stop Concept Peek generation Hausdorff separation" });
    stop.focus();
    await user.keyboard("{Enter}");
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "cancelSessionModelWork",
      sessionId: "session-1"
    });
    expect((await screen.findByRole("alert")).textContent).toContain("did not confirm interruption");
  });

  it("keeps prerequisite decisions accessible and restores focus from a Branch Trail Return Point", async () => {
    const user = userEvent.setup();
    const originState = workbenchState();
    const origin = originState.sessions[0];
    origin.sourceIds = ["source-2", "source-1"];
    originState.sources.unshift({
      id: "source-2", kind: "managedAsset", workspaceId: "quick-study-workspace", name: "Supporting notes",
      mediaType: "text/plain", content: "Supporting notes that are not the Concept Peek anchor source."
    });
    origin.learningSlice = {
      roadmapId: "roadmap-1", stageId: "stage-1", boundary: "Prove compact subsets are closed",
      immediatePrerequisites: ["Hausdorff separation"]
    };
    originState.argumentRoadmaps = [{
      id: "roadmap-1", missionId: origin.missionId, sourceId: "source-1",
      title: "Compactness route", selectedStageId: "stage-1",
      stages: [{
        id: "stage-1", title: "Compact subsets are closed", majorClaim: "Every compact subset is closed.",
        dependsOnStageIds: [], sourceAnchorId: "anchor-1", sessionId: origin.id
      }]
    }];
    origin.conceptPeeks = [{
      id: "peek-1", sourceAnchorId: "anchor-1", prerequisite: "Hausdorff separation",
      content: "A Hausdorff space separates distinct points with disjoint open neighbourhoods.", status: "open"
    }];
    origin.prerequisiteBranchProposals = [{
      id: "proposal-1", sourceAnchorId: "anchor-1", prerequisite: "finite subcover arguments",
      status: "pending", branchSessionId: null
    }];
    window.quickStudy = quickStudyApi(originState);

    render(<App />);

    expect((await screen.findByRole("article", { name: "Concept Peek Hausdorff separation" })).textContent)
      .toContain("separates distinct points");
    expect(screen.getByRole("article", { name: "Concept Peek Hausdorff separation" }).textContent)
      .toContain("Anchored at “compact subset” (characters 6–20)");
    await user.click(screen.getByRole("button", { name: "Show Source Anchor for Concept Peek Hausdorff separation" }));
    expect(window.quickStudy.submit).toHaveBeenCalledWith({ type: "activateSourceAnchor", sourceAnchorId: "anchor-1" });
    expect((screen.getByRole("combobox", { name: "Workbench Source Layer" }) as HTMLSelectElement).value).toBe("source-1");
    const peekAnchorMarker = screen.getByRole("button", {
      name: "Open Anchor Marker for Text Source Anchor: compact subset (characters 6–20)"
    });
    await waitFor(() => expect(peekAnchorMarker).toBe(document.activeElement));
    const openPeek = screen.getByRole("button", { name: "Open Concept Peek Hausdorff separation" });
    openPeek.focus();
    await user.keyboard("{Enter}");
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "openConceptPeek", sourceAnchorId: "anchor-1", prerequisite: "Hausdorff separation"
    });
    vi.mocked(window.quickStudy.submit).mockRejectedValueOnce(new Error("The prerequisite proposal could not be saved."));
    await user.click(screen.getByRole("button", { name: "Propose Prerequisite Branch Hausdorff separation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("could not be saved");
    await user.click(screen.getByRole("button", { name: "Propose Prerequisite Branch Hausdorff separation" }));
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "proposePrerequisiteBranch", sourceAnchorId: "anchor-1", prerequisite: "Hausdorff separation"
    });
    vi.mocked(window.quickStudy.submit).mockRejectedValueOnce(new Error("The Concept Peek could not be closed."));
    await user.click(screen.getByRole("button", { name: "Close Concept Peek Hausdorff separation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("could not be closed");
    await user.click(screen.getByRole("button", { name: "Close Concept Peek Hausdorff separation" }));
    expect(window.quickStudy.submit).toHaveBeenCalledWith({ type: "closeConceptPeek", conceptPeekId: "peek-1" });
    await user.click(screen.getByRole("button", { name: "Accept Prerequisite Branch finite subcover arguments" }));
    await user.click(screen.getByRole("button", { name: "Keep finite subcover arguments inline as a Concept Peek" }));
    await user.click(screen.getByRole("button", { name: "Defer Prerequisite Branch finite subcover arguments" }));
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "decidePrerequisiteBranch", proposalId: "proposal-1", decision: "accept"
    });
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "decidePrerequisiteBranch", proposalId: "proposal-1", decision: "keepInline"
    });
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "decidePrerequisiteBranch", proposalId: "proposal-1", decision: "defer"
    });

    cleanup();
    origin.conceptPeeks = [];
    origin.prerequisiteBranchProposals = [{
      id: "proposal-1", sourceAnchorId: "anchor-1", prerequisite: "finite subcover arguments",
      status: "accepted", branchSessionId: "branch-1"
    }];
    origin.status = "paused";
    const branch = structuredClone(origin);
    branch.id = "branch-1";
    branch.learningGoal = "Understand finite subcover arguments";
    branch.sessionTarget = "finite subcover arguments";
    branch.status = "active";
    branch.sourceAnchors = [];
    branch.sourceAnchorRequests = [];
    branch.activeSourceAnchorId = null;
    branch.anchoredTeachingCards = [];
    branch.activeTeachingCardId = null;
    branch.learningArtifacts = [];
    branch.learningSlice = null;
    branch.prerequisiteBranchProposals = [];
    branch.prerequisiteBranch = {
      prerequisite: "finite subcover arguments",
      returnPoint: {
        originSessionId: origin.id,
        sourceId: "source-1",
        sourceAnchorId: "anchor-1",
        activeTeachingCardId: "card-1",
        label: "Text Source Anchor: compact subset (characters 6–20)"
      }
    };
    const branchState = structuredClone(originState);
    branchState.sessions = [structuredClone(origin), branch];
    branchState.activeSessionId = branch.id;
    branchState.resumeSessionId = branch.id;
    const returnedState = structuredClone(originState);
    returnedState.sessions[0].status = "active";
    returnedState.activeSessionId = origin.id;
    const api = quickStudyApi(branchState);
    vi.mocked(api.submit).mockImplementation(async (action) => action.type === "returnToPrerequisiteOrigin" ? returnedState : branchState);
    window.quickStudy = api;

    render(<App />);
    const trail = await screen.findByRole("navigation", { name: "Branch Trail" });
    expect(trail.textContent).toContain("Understand compactness");
    expect(trail.textContent).toContain("finite subcover arguments");
    expect(screen.getByRole("button", {
      name: "Resume Prerequisite Branch finite subcover arguments, linked from Understand compactness"
    })).toBeTruthy();
    const returnButton = screen.getByRole("button", { name: "Return to Text Source Anchor: compact subset (characters 6–20)" });
    returnButton.focus();
    await user.keyboard("{Enter}");
    expect(window.quickStudy.submit).toHaveBeenCalledWith({ type: "returnToPrerequisiteOrigin" });
    const marker = await screen.findByRole("button", {
      name: "Open Anchor Marker for Text Source Anchor: compact subset (characters 6–20)"
    });
    expect(marker).toBe(document.activeElement);
    expect((screen.getByRole("combobox", { name: "Workbench Source Layer" }) as HTMLSelectElement).value).toBe("source-1");
    expect(screen.getByRole("complementary", { name: "Contextual Inspector for Explain compact subset" })).toBeTruthy();
  });

  it("opens keyboard-accessible Session Consolidation controls and requires an explicit Target Disposition", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.sessions[0].trailDraft.items = [{
      id: "trail-1", kind: "reasoningStep", content: "Use compactness to choose finitely many neighbourhoods.",
      required: true, origin: "learner", curationKey: null,
      links: { sourceAnchorIds: [], teachingCardIds: [], learningArtifactIds: [], understandingEvidenceIds: [] }
    }];
    const consolidationState = structuredClone(state);
    consolidationState.sessions[0].consolidationDraft = {
      centralInsight: "Use compactness to make the separation finite.",
      learningProgress: "",
      unresolvedQuestions: [],
      nextStep: "Reconstruct the proof.",
      includedArtifactIds: ["artifact-1"],
      targetDisposition: null
    };
    consolidationState.sessions[0].modelStopConfirmation = {
      attemptId: "stop-attempt-1",
      status: "unconfirmed",
      message: "Codex did not confirm interruption. Retry before leaving this work unattended."
    };
    const api = quickStudyApi(state);
    vi.mocked(api.submit).mockImplementation(async (action) =>
      action.type === "beginSessionConsolidation" ? consolidationState : consolidationState
    );
    window.quickStudy = api;

    render(<App />);
    const begin = await screen.findByRole("button", { name: "Finish & consolidate" });
    begin.focus();
    await user.keyboard("{Enter}");
    expect(api.submit).toHaveBeenCalledWith({ type: "beginSessionConsolidation" });

    const review = await screen.findByRole("region", { name: "Session Consolidation" });
    expect(review.textContent).toContain("Required Trail Item");
    expect(screen.getByRole("alert").textContent).toContain("Codex did not confirm interruption");
    await user.click(screen.getByRole("button", { name: "Retry Codex interruption for Understand compactness" }));
    expect(api.submit).toHaveBeenCalledWith({ type: "retrySessionModelStop", sessionId: "session-1" });
    expect(screen.getByRole("button", { name: "Create Consolidated Session Outcome" }).hasAttribute("disabled")).toBe(true);
    await user.type(screen.getByLabelText("Learning Progress"), "I can locate the finite-subcover step.");
    await user.type(screen.getByLabelText("Unresolved questions"), "Can regularity replace Hausdorffness?");
    await user.click(screen.getByRole("radio", { name: "Addressed" }));
    await user.click(screen.getByRole("button", { name: "Create Consolidated Session Outcome" }));

    expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({
      type: "reviseSessionConsolidation",
      targetDisposition: "addressed",
      includedArtifactIds: ["artifact-1"],
      unresolvedQuestions: ["Can regularity replace Hausdorffness?"]
    }));
    expect(api.submit).toHaveBeenCalledWith({ type: "consolidateSession" });
  });

  it("shows a compact Consolidated Session Outcome with expandable required detail and continuation", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    const session = state.sessions[0];
    session.status = "consolidated";
    session.trailDraft.items = [{
      id: "trail-1", kind: "reasoningStep", content: "Use the finite subcover.", required: true,
      origin: "learner", curationKey: null,
      links: { sourceAnchorIds: [], teachingCardIds: [], learningArtifactIds: [], understandingEvidenceIds: [] }
    }];
    session.consolidatedOutcome = {
      id: "outcome-1", targetDisposition: "unresolved", centralInsight: "Compactness makes the separation finite.",
      learningProgress: "I can identify the compactness step.", unresolvedQuestions: ["Why is Hausdorffness necessary?"],
      nextStep: "Compare with a non-Hausdorff example.", includedArtifactIds: ["artifact-1"],
      trailItems: structuredClone(session.trailDraft.items)
    };
    state.screen = "dashboard";
    state.activeSessionId = null;
    state.resumeSessionId = null;
    const api = quickStudyApi(state);
    window.quickStudy = api;

    render(<App />);
    const outcome = await screen.findByRole("article", { name: "Consolidated Session Outcome Understand compactness" });
    expect(outcome.textContent).toContain("Compactness makes the separation finite.");
    expect(outcome.textContent).toContain("unresolved · not a mastery claim");
    await user.click(screen.getByText("Expand complete outcome details"));
    expect(outcome.textContent).toContain("Use the finite subcover. · Required Trail Item");
    expect(outcome.textContent).toContain("Explain compact subset");
    const artifactContent = screen.getByLabelText("Learning Artifact content for Explain compact subset");
    await user.clear(artifactContent);
    await user.type(artifactContent, "A learner revision retained after consolidation.");
    await user.click(screen.getByRole("button", { name: "Save Learning Artifact revision for Explain compact subset" }));
    expect(api.submit).toHaveBeenCalledWith({
      type: "editLearningArtifact",
      sessionId: "session-1",
      artifactId: "artifact-1",
      content: "A learner revision retained after consolidation."
    });
    vi.mocked(api.submit).mockRejectedValueOnce(new Error("Codex did not confirm interruption."));
    await user.click(screen.getByRole("button", { name: "Continue this work from Understand compactness" }));
    expect(api.submit).toHaveBeenCalledWith({ type: "continueSession", sessionId: "session-1" });
    expect(await screen.findByText("Codex did not confirm interruption.")).toBeTruthy();
  });

  it("shows the prior outcome as linked context without copying its Session Record into a Continuation Session", async () => {
    const state = workbenchState();
    const continuation = state.sessions[0];
    const historical = structuredClone(continuation);
    historical.id = "historical-session";
    historical.status = "consolidated";
    historical.teachingCardHistory = [{ status: "completed", content: "Historical teaching only.", error: null, retryable: false }];
    historical.consolidatedOutcome = {
      id: "outcome-1", targetDisposition: "deferred", centralInsight: "Compactness makes pointwise choices finite.",
      learningProgress: "I can locate the compactness step.", unresolvedQuestions: ["Which separation axiom is minimal?"],
      nextStep: "Compare separation axioms.", includedArtifactIds: [], trailItems: []
    };
    continuation.id = "continuation-session";
    continuation.continuationOf = { sessionId: historical.id, outcomeId: historical.consolidatedOutcome.id };
    continuation.teachingCardHistory = [];
    continuation.consolidatedOutcome = null;
    state.sessions = [historical, continuation];
    state.activeSessionId = continuation.id;
    state.resumeSessionId = continuation.id;
    window.quickStudy = quickStudyApi(state);

    render(<App />);
    const context = await screen.findByRole("region", { name: "Continuation context" });
    expect(context.textContent).toContain("Compactness makes pointwise choices finite.");
    expect(context.textContent).toContain("Which separation axiom is minimal?");
    expect(screen.queryByText("Historical teaching only.")).toBeNull();
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
      conceptPeeks: [],
      pendingConceptPeek: null,
      prerequisiteBranchProposals: [],
      prerequisiteBranch: null,
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
      trailDraft: { items: [] },
      consolidationDraft: null,
      consolidatedOutcome: null,
      continuationOf: null,
      modelStopConfirmation: null,
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
