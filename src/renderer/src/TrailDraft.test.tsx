// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningSession } from "../../shared/learning-application";
import { TrailDraft } from "./TrailDraft";

describe("Trail Draft", () => {
  afterEach(cleanup);
  it("supports keyboard editing, requiring, reordering, and removal with visible linked context", async () => {
    const user = userEvent.setup();
    const session = trailSession();
    const onAction = vi.fn().mockResolvedValue(undefined);
    const onActivateSourceAnchor = vi.fn().mockResolvedValue(undefined);
    const onOpenTeachingCard = vi.fn().mockResolvedValue(undefined);

    render(<TrailDraft session={session} onAction={onAction}
      onActivateSourceAnchor={onActivateSourceAnchor} onOpenTeachingCard={onOpenTeachingCard} />);

    const trail = screen.getByRole("region", { name: "Trail Draft" });
    expect(trail.textContent).toContain("Source Anchor · compact subset");
    expect(trail.textContent).toContain("Teaching Card · Explain compact subset");
    expect(trail.textContent).toContain("Learning Artifact · Compactness walkthrough");
    await user.click(screen.getByRole("button", { name: "Open Source Anchor compact subset" }));
    expect(onActivateSourceAnchor).toHaveBeenCalledWith("anchor-1");
    await user.click(screen.getByRole("button", { name: "Open Teaching Card Explain compact subset" }));
    expect(onOpenTeachingCard).toHaveBeenCalledWith("card-1");
    expect(screen.getByRole("link", { name: "Open Learning Artifact Compactness walkthrough" }).getAttribute("href"))
      .toBe("#learning-artifact-artifact-1");
    expect((screen.getByRole("button", { name: "Remove Trail Item compact subset" }) as HTMLButtonElement).disabled).toBe(true);
    expect(trail.textContent).toContain("Required Trail Items cannot be removed");

    const firstContent = screen.getByRole("textbox", { name: "Trail Item 1 content" });
    await user.clear(firstContent);
    await user.type(firstContent, "finite-subcover step");
    const save = screen.getByRole("button", { name: "Save Trail Item 1" });
    save.focus();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledWith({
      type: "editTrailItem", trailItemId: "trail-1", content: "finite-subcover step"
    });

    const required = screen.getByRole("checkbox", { name: "Required Trail Item 2" });
    required.focus();
    await user.keyboard(" ");
    expect(onAction).toHaveBeenCalledWith({ type: "setTrailItemRequired", trailItemId: "trail-2", required: true });

    const moveUp = screen.getByRole("button", { name: "Move Trail Item 2 up" });
    moveUp.focus();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledWith({ type: "moveTrailItem", trailItemId: "trail-2", direction: "up" });

    const remove = screen.getByRole("button", { name: "Remove Trail Item next step" });
    remove.focus();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledWith({ type: "removeTrailItem", trailItemId: "trail-2" });

    await user.selectOptions(screen.getByRole("combobox", { name: "New Trail Item type" }), "evidence");
    await user.type(screen.getByRole("textbox", { name: "New Trail Item content" }), "I reconstructed the separation step.");
    const add = screen.getByRole("button", { name: "Add Trail Item" });
    add.focus();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledWith({
      type: "addTrailItem", kind: "evidence", content: "I reconstructed the separation step."
    });
  });

  it("keeps a new Trail Item draft when persistence fails", async () => {
    const user = userEvent.setup();
    const session = trailSession();
    session.trailDraft.items = [];
    const onAction = vi.fn().mockRejectedValue(new Error("Local storage is unavailable."));
    render(<TrailDraft session={session} onAction={onAction}
      onActivateSourceAnchor={vi.fn()} onOpenTeachingCard={vi.fn()} />);

    const content = screen.getByRole("textbox", { name: "New Trail Item content" }) as HTMLTextAreaElement;
    await user.type(content, "Preserve this learner draft.");
    await user.click(screen.getByRole("button", { name: "Add Trail Item" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Local storage is unavailable");
    expect(content.value).toBe("Preserve this learner draft.");
  });
});

function trailSession(): LearningSession {
  return {
    id: "session-1", workspaceId: "workspace-1", missionId: "mission-1", mathematics: "Every compact subset is closed.",
    sourceIds: ["source-1"], learningGoal: "Understand compactness", sessionTarget: "Explain the selected claim",
    status: "active", activityOrder: 1, returnContext: { label: "Source", nextAction: "Review the proof" },
    proposal: { scope: "One claim", initialTeachingDirection: "Use open covers", status: "accepted", confirmationReason: null },
    teachingMoves: [{ id: "move-1", kind: "explain", route: "proofStructural", reason: "Use open covers", evidenceIds: [], experimentId: null }],
    currentTeachingMove: { id: "move-1", kind: "explain", route: "proofStructural", reason: "Use open covers", evidenceIds: [], experimentId: null },
    understandingChecks: [], understandingEvidence: [], teachingExperiments: [], interactionPreferences: [],
    teachingCard: { status: "completed", content: "Overview", error: null, retryable: false }, teachingCardHistory: [],
    submittedPendingQuestions: [], currentTeachingInput: { kind: "sessionIntake", text: "Every compact subset is closed." },
    pendingQuestion: null, askBarContext: { items: [], includedIds: [], customized: false }, questionCards: [], activeQuestionCardId: null,
    accessPolicy: "focused", accessRequests: [], pendingFullAccessConfirmation: false,
    researchEgressPermission: { status: "notGranted" }, researchActions: [],
    corroborationPass: null,
    corroborationPassHistory: [],
    sourceAnchors: [{
      id: "anchor-1", sourceId: "source-1",
      sourceRevisionId: null,
      selection: { kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset", prefix: "Every ", suffix: " is closed." }
    }],
    sourceAnchorRequests: [], annotations: [], activeSourceAnchorId: "anchor-1",
    anchoredTeachingCards: [{
      id: "card-1", sourceAnchorId: "anchor-1", title: "Explain compact subset",
      currentRevision: { id: "revision-1", instruction: "Explain", status: "completed", content: "Use a finite subcover.", error: null,
        retryable: false, contextUsed: [], agentWorkLogReference: null },
      revisions: [], variants: [], artifactId: "artifact-1"
    }],
    activeTeachingCardId: "card-1",
    agentTasks: [], activeAgentTaskId: null,
    reasoningPreference: "balanced", runtimeOverride: null, verifierEnvironmentPinId: null,
    learningArtifacts: [{
      id: "artifact-1", title: "Compactness walkthrough",
      kind: "learningArtifact", originatingSessionId: "session-1",
      currentRevision: { id: "artifact-revision-1", content: "Use a finite subcover.", claims: [{
        claimOrigin: "modelGenerated", claimId: "claim-1", claimStatement: "Use a finite subcover.",
        claimOriginReferences: [{ kind: "sourceAnchor", sourceAnchorId: "anchor-1" }],
        verificationLevel: "notIndependentlyChecked", verificationCurrency: "current",
        verificationEvidence: [], verificationGaps: [],
        verificationEscalation: { recommended: false, reasons: [] }
      }],
        personalNoteContributions: [],
        provenance: { action: "promoted", createdAt: "2026-07-19T00:00:00.000Z", priorRevisionId: null } },
      revisions: [], sourceAnchorIds: ["anchor-1"], pinned: true
    }],
    trailDraft: { items: [{
      id: "trail-1", kind: "concept", content: "compact subset", required: true, origin: "learner", curationKey: null,
      links: { sourceAnchorIds: ["anchor-1"], teachingCardIds: ["card-1"], learningArtifactIds: ["artifact-1"], understandingEvidenceIds: [] }
    }, {
      id: "trail-2", kind: "nextStep", content: "next step", required: false, origin: "teachingAgent", curationKey: "session-next-step",
      links: { sourceAnchorIds: [], teachingCardIds: [], learningArtifactIds: [], understandingEvidenceIds: [] }
    }] },
    consolidationDraft: null, consolidatedOutcome: null, continuationOf: null, modelStopConfirmation: null,
    learningSlice: null, conceptPeeks: [], pendingConceptPeek: null, prerequisiteBranchProposals: [], prerequisiteBranch: null
  };
}
