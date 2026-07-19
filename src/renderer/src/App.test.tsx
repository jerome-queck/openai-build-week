// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTask, LearningApplicationState, LearningSession } from "../../shared/learning-application";
import { App } from "./App";

describe("anchored teaching workbench", () => {
  afterEach(cleanup);

  it("confirms Lean removal with capability and storage impact, then offers reinstall", async () => {
    const user = userEvent.setup();
    const installed = workbenchState();
    installed.screen = "dashboard";
    installed.activeSessionId = null;
    const absent = structuredClone(installed);
    absent.verifierEnvironment = {
      ...absent.verifierEnvironment,
      status: "absent",
      installedBytes: 0,
      lastRemovedLogicalBytes: 734_003_200
    };
    const api = quickStudyApi(installed);
    vi.mocked(api.submit).mockImplementation(async (action) =>
      action.type === "removeVerifierEnvironment" ? absent : installed
    );
    window.quickStudy = api;

    render(<App />);
    const settings = await screen.findByRole("region", { name: "Application settings" });
    await user.click(within(settings).getByRole("button", { name: "Remove Lean environment" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Remove the Bundled Lean Runtime?" });
    expect(confirmation.textContent).toContain("new formal verification capability");
    expect(confirmation.textContent).toContain("700 MB");
    expect(confirmation.textContent).toContain("Historical verification evidence and labels will be preserved");
    await user.click(within(confirmation).getByRole("button", { name: "Remove installed Lean copy" }));

    expect(await within(settings).findByText("Not installed")).toBeTruthy();
    expect(settings.textContent).toContain("reasoning review, source-grounded checking, and independent corroboration");
    await user.click(within(settings).getByRole("button", { name: "Reinstall supported Lean environment" }));
    expect(api.submit).toHaveBeenLastCalledWith({ type: "installVerifierEnvironment" });
  });

  it("lists retained Verifier Environments with explicit pin, rollback, and safe-cleanup controls", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.screen = "dashboard";
    state.activeSessionId = null;
    const prior = {
      ...state.verifierEnvironment.environment,
      id: "lean-4.28.0-mathlib-4.28.0-quick-study-v1",
      leanVersion: "4.28.0",
      mathlibVersion: "4.28.0"
    };
    state.verifierEnvironment.environments = [
      ...state.verifierEnvironment.environments,
      { environment: prior, installedBytes: 512_000_000, pinned: false, manifestReferences: 2 }
    ];
    const api = quickStudyApi(state);
    window.quickStudy = api;

    render(<App />);
    const registry = await screen.findByRole("region", { name: "Verifier Environment Registry" });
    expect(registry.textContent).toContain("2 retained Verifier Manifests");
    await user.click(within(registry).getByLabelText(`Keep ${prior.id} as a Pinned Verification Environment`));
    expect(api.submit).toHaveBeenLastCalledWith({
      type: "setVerifierEnvironmentPinned", environmentId: prior.id, pinned: true
    });
    await user.click(within(registry).getByRole("button", { name: `Use ${prior.id} as the active Verifier Environment` }));
    expect(api.submit).toHaveBeenLastCalledWith({ type: "activateVerifierEnvironment", environmentId: prior.id });
    await user.click(within(registry).getByRole("button", { name: "Clean up unreferenced environments" }));
    expect(api.submit).toHaveBeenLastCalledWith({ type: "cleanupVerifierEnvironment" });
  });

  it("offers a staged upgrade when the current supported environment is not installed", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.screen = "dashboard";
    state.activeSessionId = null;
    const prior = { ...state.verifierEnvironment.environment, id: "lean-4.28.0-mathlib-4.28.0-quick-study-v1" };
    state.verifierEnvironment.environment = prior;
    state.verifierEnvironment.activeEnvironmentId = prior.id;
    state.verifierEnvironment.environments = [{
      environment: prior, installedBytes: 512_000_000, pinned: true, manifestReferences: 1
    }];
    const api = quickStudyApi(state);
    window.quickStudy = api;

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Stage and activate the current supported Lean environment" }));
    expect(api.submit).toHaveBeenLastCalledWith({ type: "installVerifierEnvironment" });
  });

  it("shows independent research egress controls and inspectable research receipts", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.sourceExcerptEgressPreference.enabled = true;
    state.sessions[0].researchEgressPermission = { status: "granted" };
    state.sessions[0].researchActions = [{
      id: "research-1",
      accessPolicy: "focused",
      query: {
        text: "Heine-Borel theorem; compact subset",
        theoremNames: ["Heine-Borel theorem"], assumptions: [], keywords: ["compact subset"]
      },
      queryOrigin: "learnerAuthored",
      researchDepth: "lightweight",
      informedBySourceIds: [],
      destination: "https://duckduckgo.com/?q=Heine-Borel+theorem%3B+compact+subset",
      excerpts: [], status: "completed", error: null,
      result: {
        title: "Research opened in browser", summary: "Opened using only the Derived Research Query.",
        sources: [{ title: "Inspect external research destination", url: "https://duckduckgo.com/?q=Heine-Borel" }]
      }
    }];
    state.sessions[0].researchActions.push({
      ...state.sessions[0].researchActions[0],
      id: "research-2",
      query: {
        text: "Cauchy's theorem",
        theoremNames: ["Cauchy's theorem"], assumptions: [], keywords: []
      },
      destination: "https://duckduckgo.com/?q=Cauchy%27s+theorem",
      status: "denied",
      error: "Research Egress Permission was revoked. No access was elevated and no retry was attempted.",
      result: null
    });
    const api = quickStudyApi(state);
    window.quickStudy = api;

    render(<App />);
    const panel = await screen.findByRole("region", { name: "Privacy-minimized web research" });
    expect(panel.textContent).toContain("Independent from Codex model access");
    expect(panel.textContent).toContain("Heine-Borel theorem; compact subset");
    expect(panel.textContent).toContain("Cauchy's theorem");
    expect(panel.textContent).toContain("Research Egress Permission was revoked");
    expect(within(panel).getByText("Source Excerpt Egress: Granted")).toBeTruthy();
    expect(within(panel).getAllByText(/https:\/\/duckduckgo\.com\//)).toHaveLength(2);
    expect(within(panel).getByRole("article", {
      name: "External research receipt for Cauchy's theorem"
    })).toBeTruthy();
    await user.click(within(panel).getByRole("button", {
      name: "Inspect destination used for Heine-Borel theorem; compact subset"
    }));
    expect(api.openExternal).toHaveBeenCalledWith(
      "https://duckduckgo.com/?q=Heine-Borel+theorem%3B+compact+subset"
    );

    await user.type(within(panel).getByLabelText("Theorem names"), "Orbit-stabilizer theorem");
    await user.type(within(panel).getByLabelText("Assumptions"), "G acts on X");
    await user.type(within(panel).getByLabelText("Mathematical keywords"), "stabilizer cosets");
    await user.click(within(panel).getByRole("checkbox", { name: "Include the active Source Anchor excerpt" }));
    await user.click(within(panel).getByRole("button", { name: "Research the web" }));
    expect(api.submit).toHaveBeenCalledWith({
      type: "researchWeb",
      query: {
        theoremNames: ["Orbit-stabilizer theorem"],
        assumptions: ["G acts on X"],
        keywords: ["stabilizer cosets"]
      },
      sourceAnchorIds: ["anchor-1"]
    });
    await user.click(within(panel).getByRole("checkbox", { name: "Allow Source Excerpt Egress for this Learning Session" }));
    expect(api.submit).toHaveBeenCalledWith({ type: "setResearchEgressPermission", enabled: false });
  });

  it("shows weighted Corroboration evidence and preserves a visible Source Discrepancy", async () => {
    const state = workbenchState();
    const supporting = {
      sourceTitle: "Authoritative supporting reference", sourceUrl: "https://example.test/support",
      authority: "authoritative" as const, relevance: "direct" as const, relation: "supports" as const,
      assumptions: "matches" as const, conclusion: "matches" as const,
      proofApproaches: ["Finite-subcover argument"], detail: "The assumptions and conclusion match."
    };
    const conflicting = {
      sourceTitle: "Primary erratum", sourceUrl: "https://example.test/erratum",
      authority: "primary" as const, relevance: "direct" as const, relation: "erratum" as const,
      assumptions: "mismatch" as const, conclusion: "mismatch" as const,
      proofApproaches: [], detail: "The published erratum adds a missing hypothesis."
    };
    state.sessions[0].corroborationPass = {
      id: "pass-1", researchActionId: "research-1", status: "disputed",
      relevantResult: "Closed subset theorem",
      currentUse: { assumptions: ["compact subset"], conclusion: "Every compact subset is closed." },
      pedagogicalBaselinePresent: true,
      assumptionComparison: "mismatch", conclusionComparison: "mismatch", errataCheck: "found",
      independentSupport: "conflicting", proofApproachResearch: "notRequired",
      deeperResearch: { required: true, performed: true, reason: "Authoritative evidence is disputed or conflicting." },
      evidence: [supporting, conflicting],
      sourceDiscrepancies: [{
        id: "discrepancy-1", relevantResult: "Closed subset theorem",
        summary: "Authoritative evidence materially disagrees with the current use.",
        competingEvidence: [supporting, conflicting]
      }],
      message: "A Source Discrepancy preserves material disagreement. The affected claim is not presented as settled."
    };
    window.quickStudy = quickStudyApi(state);

    render(<App />);
    const pass = await screen.findByRole("region", { name: "Corroboration Pass" });
    expect(pass.textContent).toContain("Closed subset theorem");
    expect(within(pass).getByText("Assumptions")).toBeTruthy();
    expect(within(pass).getAllByText("mismatch")).toHaveLength(2);
    expect(within(pass).getByText("Known errata")).toBeTruthy();
    expect(within(pass).getByText("found")).toBeTruthy();
    expect(pass.textContent).toContain("Authoritative supporting reference");
    expect(pass.textContent).toContain("Authority authoritative · Relevance direct");
    const discrepancy = within(pass).getByRole("alert", { name: "Source Discrepancy" });
    expect(discrepancy.textContent).toContain("Primary erratum");
    expect(discrepancy.textContent).toContain("Authoritative supporting reference");
    expect(pass.textContent).toContain("not presented as settled");
  });

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
      locateLinkedSource: vi.fn(),
      preserveSourceSnapshot: vi.fn(),
      indexSource: vi.fn(),
      clearSourceIndex: vi.fn(),
      rebuildSourceIndex: vi.fn(),
      searchSourceIndex: vi.fn().mockResolvedValue([]),
      openSourceSearchResult: vi.fn(),
      exportLearningArtifact: vi.fn().mockResolvedValue({ status: "exported", path: "/tmp/artifact.md" }),
      shareLearningArtifact: vi.fn().mockResolvedValue({ status: "shared", path: "/tmp/artifact.md" }),
      verifyClaim: vi.fn().mockResolvedValue(state),
      cancelClaimVerification: vi.fn().mockResolvedValue(undefined),
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

  it("shows the exact formal statement before running bundled Lean for only the current claim", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    const artifact = state.sessions[0].learningArtifacts[0];
    artifact.currentRevision.claims[0].claimStatement = "For every natural number n, n + 0 = n.";
    window.quickStudy = quickStudyApi(state);

    render(<App />);

    const formalization = await screen.findByRole("region", { name: "Formalization for mathematical claim 1" });
    expect(formalization.textContent).toContain("theorem quickStudyNatAddZero (n : Nat) : n + 0 = n");
    expect(formalization.textContent).toContain("n : Nat");
    await user.click(within(formalization).getByRole("button", { name: "Check exact claim 1 with bundled Lean" }));
    expect(window.quickStudy.verifyClaim).toHaveBeenCalledWith(artifact.originatingSessionId, {
      runId: expect.any(String), target: "learningArtifact", targetId: artifact.id,
      claimId: artifact.currentRevision.claims[0].claimId
    });
  });

  it("keeps unsupported checks honest and lets the learner cancel an active Lean run", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    const artifact = state.sessions[0].learningArtifacts[0];
    artifact.currentRevision.claims[0].claimStatement = "Every continuous function is differentiable.";
    window.quickStudy = quickStudyApi(state);
    let finish!: (value: LearningApplicationState) => void;
    vi.mocked(window.quickStudy.verifyClaim).mockReturnValue(new Promise((resolve) => { finish = resolve; }));

    render(<App />);
    const formalization = await screen.findByRole("region", { name: "Formalization for mathematical claim 1" });
    expect(formalization.textContent).toContain("No supported formal translation exists");
    await user.click(within(formalization).getByRole("button", { name: "Check exact claim 1 with bundled Lean" }));
    const request = vi.mocked(window.quickStudy.verifyClaim).mock.calls[0][1];
    await user.click(within(formalization).getByRole("button", { name: "Cancel exact claim 1 Lean check" }));
    expect(window.quickStudy.cancelClaimVerification).toHaveBeenCalledWith(request.runId);
    finish(state);
  });

  it("opens anchored annotations from the Anchor Marker and keyboard-converts their purpose", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.sessions[0].annotations = [{
      id: "annotation-1",
      sourceAnchorId: "anchor-1",
      purpose: "personalNote",
      content: "Use my own cover notation.",
      purposeChanges: []
    }];
    const api = quickStudyApi(state);
    window.quickStudy = api;

    render(<App />);
    await user.click(await screen.findByRole("button", {
      name: "Open Anchor Marker for Text Source Anchor: compact subset (characters 6–20)"
    }));

    const inspector = screen.getByRole("complementary", {
      name: "Annotations for Text Source Anchor: compact subset"
    });
    expect(inspector.textContent).toContain("Use my own cover notation.");
    const convert = screen.getByRole("button", { name: "Convert Personal Note to Tutor Feedback" });
    convert.focus();
    await user.keyboard("{Enter}");
    expect(api.submit).toHaveBeenCalledWith({
      type: "convertAnnotation",
      annotationId: "annotation-1",
      purpose: "tutorFeedback"
    });
  });

  it("exports and shares a source-linked artifact with visible revision provenance by keyboard", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.sessions[0].learningArtifacts[0].kind = "reformulatedProof";
    Object.assign(state.sessions[0].learningArtifacts[0].currentRevision.claims[0], {
      verificationLevel: "notIndependentlyChecked",
      verificationCurrency: "changedSinceCheck",
      verificationEvidence: [{
        id: "evidence-1", method: "independentCorroboration", outcome: "disagrees",
        summary: "An independent route needs a missing Hausdorff assumption.", limitation: null,
        reference: { kind: "researchEvidence", researchActionId: "research-1" },
        currency: "changedSinceCheck", changedBecause: "A semantic edit changed the claim.",
        createdAt: "2026-07-19T00:00:00.000Z"
      }],
      verificationGaps: [{
        id: "gap-1", reason: "A Hausdorff assumption is unresolved.",
        affectedConclusion: "Every compact subset is closed.", evidenceId: "evidence-1"
      }],
      verificationEscalation: { recommended: true, reasons: ["Independent checking disagreed with the claim."] }
    });
    const api = quickStudyApi(state);
    window.quickStudy = api;

    render(<App />);
    const artifact = await screen.findByRole("article", { name: "Reformulated Proof Explain compact subset" });
    expect(artifact.textContent).toContain("Promoted");
    expect(artifact.textContent).toContain("19 Jul 2026");
    expect(artifact.textContent).toContain("1 retained Source Anchor");
    expect(artifact.textContent).toContain("Changed since check");
    expect(within(artifact).getByRole("alert", { name: "Verification Gap" }).textContent)
      .toContain("A Hausdorff assumption is unresolved.");
    expect(within(artifact).getByRole("status", { name: "Verification Escalation" }).textContent)
      .toContain("Independent checking disagreed with the claim.");

    const exportButton = screen.getByRole("button", { name: "Export Reformulated Proof Explain compact subset" });
    exportButton.focus();
    await user.keyboard("{Enter}");
    expect(api.exportLearningArtifact).toHaveBeenCalledWith("session-1", "artifact-1");
    expect((await screen.findByText("Artifact Export saved to /tmp/artifact.md")).textContent)
      .toBe("Artifact Export saved to /tmp/artifact.md");

    const shareButton = screen.getByRole("button", { name: "Share Reformulated Proof Explain compact subset" });
    shareButton.focus();
    await user.keyboard("{Enter}");
    expect(api.shareLearningArtifact).toHaveBeenCalledWith("session-1", "artifact-1");
    expect((await screen.findByText("Artifact Export handed to macOS sharing.")).textContent)
      .toBe("Artifact Export handed to macOS sharing.");
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

  it("announces and directly stops a background Specialist Agent task", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    const session = state.sessions[0];
    session.agentTasks = [{
      id: "agent-task-1", purpose: "Review one hidden assumption", status: "waiting",
      statusMessage: "Waiting for Codex.",
      resumeAvailable: false,
      identifiedNeed: {
        kind: "hiddenAssumptionReview", requestedBy: "learner", description: "Check the current Teaching Card."
      },
      brief: {
        learningGoal: session.learningGoal, sourceAnchors: [], constraints: ["Review one card."], learnerEvidence: [],
        expectedOutput: "One concise card.", verificationNeeds: ["Identify hidden assumptions."]
      },
      specialistBriefs: [{
        learningGoal: session.learningGoal, sourceAnchors: [], constraints: ["Review one card."], learnerEvidence: [],
        expectedOutput: "One concise card.", verificationNeeds: ["Identify hidden assumptions."]
      }],
      specialistProgress: [{ status: "working", checkpoint: "", result: null, usedTokens: 0, usedLatencyMs: 0 }],
      coordination: "single",
      budget: {
        agentCount: 1, concurrency: 1, model: "runtimeDefault", reasoningEffort: "medium",
        tools: ["checkpointSpecialistResult"], maxTokens: 512, maxLatencyMs: 120_000
      },
      integratedTeachingCard: {
        title: "Specialist review", status: "streaming", content: "", error: null, retryable: false
      },
      agentWorkLogReference: { sessionId: session.id, fromSequence: 3, toSequence: 4 },
      priorAgentWorkLogReferences: []
    }];
    session.activeAgentTaskId = "agent-task-1";
    state.screen = "dashboard";
    state.activeSessionId = null;
    window.quickStudy = quickStudyApi(state);

    render(<App />);

    const status = (await screen.findAllByText("Specialist Agent is waiting in the background"))[0].closest("[role='status']");
    expect(status).toBeTruthy();
    const stop = status!.querySelector("button")!;
    expect(stop.textContent).toBe("Stop Agent Task");
    await user.click(stop);
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "cancelSessionModelWork", sessionId: "session-1"
    });
  });

  it("offers keyboard-accessible explicit resumption for a checkpointed Agent Task", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    const session = state.sessions[0];
    session.status = "paused";
    session.agentTasks = [agentTaskFixture(session, {
      status: "stopped",
      statusMessage: "Agent Task checkpointed when the application closed. Resume when ready.",
      resumeAvailable: true,
      integratedTeachingCard: {
        title: "Specialist review",
        status: "stopped",
        content: "This step uses Hausdorff separation.",
        error: "Agent Task checkpointed when the application closed. Resume when ready.",
        retryable: false
      }
    })];
    session.activeAgentTaskId = session.agentTasks[0].id;
    state.screen = "dashboard";
    state.activeSessionId = null;
    state.resumeSessionId = session.id;
    state.runtimeAvailable = true;
    state.authentication = {
      status: "signedIn", method: "chatgpt", accountLabel: "Learner", loginUrl: null, error: null
    };
    state.modelAccess = { status: "available" };
    window.quickStudy = quickStudyApi(state);

    render(<App />);

    expect((await screen.findByRole("status", { name: "Checkpointed Agent Task" })).textContent).toContain(
      "Useful partial output is saved"
    );
    const history = screen.getByRole("region", { name: "Quick Study · Unfiled" });
    expect(history.textContent).toContain("Agent Task checkpoint ready");
    expect(within(history).getByRole("button", {
      name: "Resume checkpointed Agent Task for Understand compactness"
    })).toBeTruthy();
    const resume = screen.getByRole("button", { name: "Resume Agent Task" });
    resume.focus();
    await user.keyboard("{Enter}");
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "resumeAgentTask", taskId: "agent-task-1"
    });
  });

  it("lets the learner choose a Reasoning Preference and only advertised Runtime Overrides", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.runtimeCapabilities.models = [
      { model: "codex-fast", displayName: "Codex Fast", isDefault: true, supportedReasoningEfforts: ["low", "medium"] },
      { model: "codex-deep", displayName: "Codex Deep", isDefault: false, supportedReasoningEfforts: ["medium", "high", "max"] }
    ];
    window.quickStudy = quickStudyApi(state);
    render(<App />);

    await user.click(await screen.findByRole("radio", { name: "Deeper" }));
    expect(window.quickStudy.submit).toHaveBeenCalledWith({ type: "setReasoningPreference", preference: "deeper" });

    await user.click(screen.getByText("Advanced Runtime Override"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Runtime model" }), "codex-fast");
    const effort = screen.getByRole("combobox", { name: "Runtime reasoning" });
    expect([...effort.querySelectorAll("option")].map((option) => option.value)).toEqual(["low", "medium"]);
    await user.selectOptions(effort, "low");
    await user.click(screen.getByRole("button", { name: "Apply Runtime Override" }));
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "setRuntimeOverride", override: { model: "codex-fast", reasoningEffort: "low" }
    });
  });

  it("makes dependent and genuinely independent Specialist Agent coordination explicit", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.runtimeAvailable = true;
    state.modelAccess = { status: "available" };
    window.quickStudy = quickStudyApi(state);
    render(<App />);

    expect(await screen.findByText("Choose parallel work only for independent perspectives; use sequential review when the second brief needs the first result."))
      .toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sequential review then challenge" }));
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "requestSpecialistReview", coordination: "dependent"
    });
    await user.click(screen.getByRole("button", { name: "Two independent perspectives" }));
    expect(window.quickStudy.submit).toHaveBeenCalledWith({
      type: "requestSpecialistReview", coordination: "independent"
    });
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
      content: "A learner revision retained after consolidation.",
      claimEdits: [{ claimId: "claim-1", statement: "Use a finite subcover." }]
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

describe("Linked Source recovery", () => {
  afterEach(cleanup);

  it("offers Retry and Locate again while explaining unsnapshotted history and explicit snapshots", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.screen = "dashboard";
    state.activeSessionId = null;
    state.sources = [{
      id: "linked-source-1",
      kind: "linkedSource",
      role: "externalAttachment",
      workspaceId: "quick-study-workspace",
      name: "proof.txt",
      resourceType: "file",
      link: {
        lastKnownPath: "/Users/learner/missing/proof.txt",
        canonicalPath: "/Users/learner/missing/proof.txt",
        accessGrant: { kind: "securityScopedBookmark", bookmarkData: "failed-bookmark" },
        fingerprint: { size: 72, modifiedAtMs: 5678 },
        accessStatus: "unavailable",
        error: "The source is missing or access is no longer available.",
        currentRevisionId: "source-revision-2"
      }
    }];
    state.workspaces[0].context.sourceIds = ["linked-source-1"];
    state.sourceRevisions = [
      {
        id: "source-revision-1",
        sourceId: "linked-source-1",
        fingerprint: { size: 64, modifiedAtMs: 1234 },
        snapshotAssetId: null
      },
      {
        id: "source-revision-2",
        sourceId: "linked-source-1",
        fingerprint: { size: 72, modifiedAtMs: 5678 },
        snapshotAssetId: null
      }
    ];
    window.quickStudy = quickStudyApi(state);
    vi.mocked(window.quickStudy.locateLinkedSource).mockResolvedValue(state);
    vi.mocked(window.quickStudy.preserveSourceSnapshot).mockResolvedValue(state);

    render(<App />);

    expect(await screen.findByRole("button", { name: "Retry Linked Source proof.txt" })).toBeTruthy();
    expect(screen.getByText(/Historical content unavailable/).textContent).toContain("Source Index and Source Fingerprint are not backups");
    await user.click(screen.getByRole("button", { name: "Locate Linked Source proof.txt again" }));
    expect(window.quickStudy.locateLinkedSource).toHaveBeenCalledWith("linked-source-1");
    expect(screen.queryByRole("button", { name: "Preserve current Source Revision for proof.txt" })).toBeNull();
  });

  it("does not paint an Unresolved Anchor over the current Linked Source layer", async () => {
    const user = userEvent.setup();
    const state = workbenchState();
    state.sources.push({
      id: "linked-source-1", kind: "linkedSource", role: "externalAttachment",
      workspaceId: "quick-study-workspace", name: "notes.txt", resourceType: "file",
      link: {
        lastKnownPath: "/Users/learner/notes.txt", canonicalPath: "/Users/learner/notes.txt", accessGrant: null,
        fingerprint: { size: 80, modifiedAtMs: 6789 }, accessStatus: "available", error: null,
        currentRevisionId: "source-revision-2"
      }
    });
    state.workspaces[0].context.sourceIds.push("linked-source-1");
    state.sessions[0].sourceIds.push("linked-source-1");
    state.sessions[0].sourceAnchors.push({
      id: "stale-anchor", sourceId: "linked-source-1", sourceRevisionId: "source-revision-1",
      selection: {
        kind: "text", startOffset: 15, endOffset: 25, exactText: "Beta lemma",
        prefix: "Alpha theorem. ", suffix: ". Gamma claim."
      }
    }, {
      id: "current-anchor", sourceId: "linked-source-1", sourceRevisionId: "source-revision-2",
      selection: {
        kind: "text", startOffset: 35, endOffset: 46, exactText: "Delta claim",
        prefix: "Beta lemma. ", suffix: "."
      }
    });
    state.sourceRevisions = [
      { id: "source-revision-1", sourceId: "linked-source-1", fingerprint: { size: 64, modifiedAtMs: 1234 }, snapshotAssetId: null },
      { id: "source-revision-2", sourceId: "linked-source-1", fingerprint: { size: 80, modifiedAtMs: 6789 }, snapshotAssetId: null }
    ];
    state.reanchoringDecisions = [{
      id: "review-1", sessionId: "session-1", sourceId: "linked-source-1", sourceAnchorId: "stale-anchor",
      fromRevisionId: "source-revision-1", toRevisionId: "source-revision-2", status: "unresolved",
      oldSelection: state.sessions[0].sourceAnchors.at(-2)!.selection, proposedSelection: null
    }];
    window.quickStudy = quickStudyApi(state);
    vi.mocked(window.quickStudy.openLinkedSource).mockResolvedValue({
      status: "available", sourceId: "linked-source-1", resourceType: "file", mediaType: "text/plain",
      content: "Alpha theorem changed. Beta lemma. Delta claim.", fingerprint: { size: 80, modifiedAtMs: 6789 }
    });

    render(<App />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Workbench Source Layer" }), "linked-source-1");

    expect(await screen.findByRole("button", { name: /Open Anchor Marker for Text Source Anchor: Delta claim/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open Anchor Marker for Text Source Anchor: Beta lemma/ })).toBeNull();
  });
});

function quickStudyApi(state: LearningApplicationState): typeof window.quickStudy {
  return {
    getState: vi.fn().mockResolvedValue(state), submit: vi.fn().mockResolvedValue(state),
    getAgentWorkLogEvidence: vi.fn().mockResolvedValue([]), searchSessions: vi.fn().mockResolvedValue([]),
    linkPrimaryFolder: vi.fn(), linkExternalAttachment: vi.fn(), openLinkedSource: vi.fn(),
    locateLinkedSource: vi.fn(), preserveSourceSnapshot: vi.fn(),
    indexSource: vi.fn(), clearSourceIndex: vi.fn(), rebuildSourceIndex: vi.fn(),
    searchSourceIndex: vi.fn().mockResolvedValue([]), openSourceSearchResult: vi.fn(),
    exportLearningArtifact: vi.fn().mockResolvedValue({ status: "exported", path: "/tmp/artifact.md" }),
    shareLearningArtifact: vi.fn().mockResolvedValue({ status: "shared", path: "/tmp/artifact.md" }),
    verifyClaim: vi.fn().mockResolvedValue(state),
    cancelClaimVerification: vi.fn().mockResolvedValue(undefined),
    onStateChanged: vi.fn().mockReturnValue(() => undefined), openExternal: vi.fn()
  };
}

function agentTaskFixture(session: LearningSession, overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "agent-task-1",
    purpose: "Review one hidden assumption",
    status: "waiting",
    statusMessage: "Waiting for Codex.",
    resumeAvailable: false,
    identifiedNeed: {
      kind: "hiddenAssumptionReview", requestedBy: "learner", description: "Check the current Teaching Card."
    },
    brief: {
      learningGoal: session.learningGoal, sourceAnchors: [], constraints: ["Review one card."], learnerEvidence: [],
      expectedOutput: "One concise card.", verificationNeeds: ["Identify hidden assumptions."]
    },
    specialistBriefs: [{
      learningGoal: session.learningGoal, sourceAnchors: [], constraints: ["Review one card."], learnerEvidence: [],
      expectedOutput: "One concise card.", verificationNeeds: ["Identify hidden assumptions."]
    }],
    specialistProgress: [{ status: "working", checkpoint: "", result: null, usedTokens: 0, usedLatencyMs: 0 }],
    coordination: "single",
    budget: {
      agentCount: 1, concurrency: 1, model: "runtimeDefault", reasoningEffort: "medium",
      tools: ["checkpointSpecialistResult"], maxTokens: 512, maxLatencyMs: 120_000
    },
    integratedTeachingCard: {
      title: "Specialist review", status: "streaming", content: "", error: null, retryable: false
    },
    agentWorkLogReference: { sessionId: session.id, fromSequence: 3, toSequence: 4 },
    priorAgentWorkLogReferences: [],
    ...overrides
  };
}

function workbenchState(): LearningApplicationState {
  const anchor = {
    id: "anchor-1",
    sourceId: "source-1",
    sourceRevisionId: null,
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
      teachingMoves: [{ id: "move-1", kind: "explain", route: "proofStructural", reason: "Start from definitions", evidenceIds: [], experimentId: null }],
      currentTeachingMove: { id: "move-1", kind: "explain", route: "proofStructural", reason: "Start from definitions", evidenceIds: [], experimentId: null },
      understandingChecks: [], understandingEvidence: [], teachingExperiments: [], interactionPreferences: [],
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
      researchEgressPermission: { status: "notGranted" },
      researchActions: [],
      corroborationPass: null,
      corroborationPassHistory: [],
      sourceAnchors: [anchor],
      sourceAnchorRequests: [{ id: "request-1", sourceAnchorId: "anchor-1", action: "explain" }],
      annotations: [],
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
      agentTasks: [],
      activeAgentTaskId: null,
      reasoningPreference: "balanced",
      runtimeOverride: null,
      verifierEnvironmentPinId: null,
      learningArtifacts: [{
        id: "artifact-1",
        title: "Explain compact subset",
        kind: "learningArtifact",
        originatingSessionId: "session-1",
        currentRevision: {
          id: "artifact-revision-1",
          content: "Use a finite subcover.",
          claims: [{
            claimId: "claim-1", claimStatement: "Use a finite subcover.",
            claimOrigin: "modelGenerated",
            claimOriginReferences: [
              { kind: "sourceAnchor", sourceAnchorId: "anchor-1" },
              { kind: "agentWork", sessionId: "session-1", fromSequence: 1, toSequence: 2 }
            ],
            verificationLevel: "notIndependentlyChecked",
            verificationCurrency: "current",
            verificationEvidence: [], verificationGaps: [],
            verificationEscalation: { recommended: false, reasons: [] }
          }],
          personalNoteContributions: [],
          provenance: { action: "promoted", createdAt: "2026-07-19T00:00:00.000Z", priorRevisionId: null }
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
    sourceRevisions: [],
  reanchoringDecisions: [],
  verifierManifests: [],
    verifierEnvironment: {
      status: "installed",
      environment: {
        id: "lean-4.29.1-mathlib-4.29.1-quick-study-v1", checker: "Lean", leanVersion: "4.29.1",
        mathlibVersion: "4.29.1", mathlibCommit: "5e932f97dd25535344f80f9dd8da3aab83df0fe6",
        platform: "darwin", architecture: "arm64", sourceArchive: "lean.zip", sourceSha256: "fixture",
        supportProfile: "Quick Study undergraduate foundations v1", mathlibModules: [], runtimeFormat: 8
      },
      defaultEnvironment: {
        id: "lean-4.29.1-mathlib-4.29.1-quick-study-v1", checker: "Lean", leanVersion: "4.29.1",
        mathlibVersion: "4.29.1", mathlibCommit: "5e932f97dd25535344f80f9dd8da3aab83df0fe6",
        platform: "darwin", architecture: "arm64", sourceArchive: "lean.zip", sourceSha256: "fixture",
        supportProfile: "Quick Study undergraduate foundations v1", mathlibModules: [], runtimeFormat: 8
      },
      activeEnvironmentId: "lean-4.29.1-mathlib-4.29.1-quick-study-v1",
      environments: [{
        environment: {
          id: "lean-4.29.1-mathlib-4.29.1-quick-study-v1", checker: "Lean", leanVersion: "4.29.1",
          mathlibVersion: "4.29.1", mathlibCommit: "5e932f97dd25535344f80f9dd8da3aab83df0fe6",
          platform: "darwin", architecture: "arm64", sourceArchive: "lean.zip", sourceSha256: "fixture",
          supportProfile: "Quick Study undergraduate foundations v1", mathlibModules: [], runtimeFormat: 8
        },
        installedBytes: 734_003_200, pinned: false, manifestReferences: 0
      }],
      installedBytes: 734_003_200, lastRemovedLogicalBytes: 0, error: null
    },
    activeSessionId: "session-1",
    resumeSessionId: "session-1",
    navigation: { workspaceId: "quick-study-workspace", missionId: "quick-study-unfiled-mission" },
    activityOrder: 1,
    authentication: { status: "failed", method: null, accountLabel: null, loginUrl: null, error: "Unavailable" },
    intakeError: null,
    runtimeAvailable: false,
    runtimeCapabilities: { models: [] },
    modelAccess: { status: "unavailable", cause: "runtime", message: "Unavailable" },
    accessConfirmationPreference: { confirmFullAccess: true },
    personalNoteSynthesisPreference: { includePersonalNotes: true },
    sourceExcerptEgressPreference: { enabled: false }
  };
}
