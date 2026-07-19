// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningSession, QuestionContextItem } from "../../shared/learning-application";
import { AskBar } from "./AskBar";

describe("Ask Bar", () => {
  afterEach(cleanup);

  it("edits labelled Context Chips, exposes overflow, and keeps native keyboard focus order", async () => {
    const user = userEvent.setup();
    const onSetContext = vi.fn().mockResolvedValue(undefined);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const session = questionSession();

    render(<AskBar session={session} modelAvailable
      onSetContext={onSetContext} onSubmit={onSubmit}
      onSavePending={vi.fn()} onDiscardPending={vi.fn()} onStartNewQuestion={vi.fn()} onRetry={vi.fn()} />);

    expect(screen.getByText("Source Anchor · compact subset · Text at characters 6–20")).toBeTruthy();
    expect(screen.queryByText("Source · Lecture notes · p. 12")).toBeNull();
    const removeAnchor = screen.getByRole("button", {
      name: "Remove Source Anchor compact subset from question context"
    });
    removeAnchor.focus();
    await user.keyboard("{Enter}");
    expect(onSetContext).toHaveBeenCalledWith("source-anchor:anchor-1", false);
    await user.tab();
    expect(screen.getByRole("button", { name: "Remove Goal Understand compactness from question context" })).toBe(document.activeElement);
    await user.tab();
    expect(screen.getByRole("button", { name: "Remove Session context Locate the separation step from question context" })).toBe(document.activeElement);
    await user.tab();
    const overflow = screen.getByRole("button", { name: "Show 1 more context item" });
    expect(overflow).toBe(document.activeElement);
    await user.keyboard("{Enter}");
    expect(overflow.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Source · Lecture notes · p. 12")).toBeTruthy();

    const available = screen.getByRole("combobox", { name: "Available question context" });
    await user.tab();
    expect(available).toBe(document.activeElement);
    await user.selectOptions(available, "source:source-2");
    await user.tab();
    const addContext = screen.getByRole("button", { name: "Add selected context" });
    expect(addContext).toBe(document.activeElement);
    await user.keyboard("{Enter}");
    expect(onSetContext).toHaveBeenCalledWith("source:source-2", true);

    await user.tab();
    expect(screen.getByRole("textbox", { name: "Ask Bar question" })).toBe(document.activeElement);
    await user.type(screen.getByRole("textbox", { name: "Ask Bar question" }), "Where is Hausdorff used?");
    await user.tab();
    expect(screen.getByRole("button", { name: "Create Question Card" })).toBe(document.activeElement);
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Where is Hausdorff used?");
  });

  it("announces Ask Bar action failures", async () => {
    const user = userEvent.setup();
    render(<AskBar session={questionSession()} modelAvailable onSetContext={vi.fn()}
      onSubmit={vi.fn().mockRejectedValue(new Error("Question context is no longer available."))}
      onSavePending={vi.fn()} onDiscardPending={vi.fn()} onStartNewQuestion={vi.fn()} onRetry={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Ask Bar question" }), "Why?");
    await user.click(screen.getByRole("button", { name: "Create Question Card" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Question context is no longer available.");
  });

  it("announces Question Card retry failures", async () => {
    const user = userEvent.setup();
    const session = questionSession();
    const selectedContext = session.askBarContext.items.slice(0, 2);
    session.questionCards = [{
      id: "question-card-1",
      question: "Where is Hausdorff used?",
      currentRevision: {
        id: "question-revision-1", question: "Where is Hausdorff used?", status: "failed", content: "",
        error: "Codex became unavailable.", retryable: true, selectedContext, contextUsed: selectedContext,
        agentWorkLogReference: null
      },
      revisions: []
    }];
    session.activeQuestionCardId = "question-card-1";
    render(<AskBar session={session} modelAvailable onSetContext={vi.fn()} onSubmit={vi.fn()}
      onSavePending={vi.fn()} onDiscardPending={vi.fn()} onStartNewQuestion={vi.fn()}
      onRetry={vi.fn().mockRejectedValue(new Error("Retry is not available."))} />);

    await user.click(screen.getByRole("button", { name: "Retry Question Card" }));
    expect((await screen.findByText("Retry is not available.")).textContent).toContain("Retry is not available.");
  });

  it("presents one revisable Question Card with its complete Context Used Receipt", async () => {
    const user = userEvent.setup();
    const onStartNewQuestion = vi.fn().mockResolvedValue(undefined);
    const session = questionSession();
    session.questionCards = [{
      id: "question-card-1",
      question: "Where is Hausdorff used?",
      currentRevision: {
        id: "question-revision-2",
        question: "Where is Hausdorff used?",
        status: "completed",
        content: "Separate an outside point from every point of the compact set.",
        error: null,
        retryable: false,
        selectedContext: session.askBarContext.items.slice(0, 2),
        contextUsed: session.askBarContext.items.slice(0, 2),
        agentWorkLogReference: null
      },
      revisions: [{
        id: "question-revision-1",
        question: "Why is Hausdorff needed?",
        status: "completed",
        content: "Hausdorffness supplies disjoint neighbourhoods.",
        error: null,
        retryable: false,
        selectedContext: session.askBarContext.items.slice(0, 1),
        contextUsed: session.askBarContext.items.slice(0, 1),
        agentWorkLogReference: null
      }]
    }];
    session.activeQuestionCardId = "question-card-1";

    render(<AskBar session={session} modelAvailable onSetContext={vi.fn()} onSubmit={vi.fn()}
      onSavePending={vi.fn()} onDiscardPending={vi.fn()} onStartNewQuestion={onStartNewQuestion} onRetry={vi.fn()} />);

    const card = screen.getByRole("article", { name: "Question Card: Where is Hausdorff used?" });
    expect(card.textContent).toContain("Separate an outside point");
    await user.click(screen.getByText("Context Used Receipt · 2 items"));
    expect(card.textContent).toContain("Source Anchor · compact subset");
    expect(card.textContent).toContain("Goal · Understand compactness");
    await user.click(screen.getByText("Earlier Question Card revisions · 1"));
    expect(card.textContent).toContain("Why is Hausdorff needed?");
    expect(card.textContent).toContain("Hausdorffness supplies disjoint neighbourhoods.");
    await user.click(screen.getByRole("button", { name: "Ask a new question" }));
    expect(onStartNewQuestion).toHaveBeenCalledOnce();
  });
});

function questionSession(): LearningSession {
  const items: QuestionContextItem[] = [
    context("source-anchor:anchor-1", "sourceAnchor", "Source Anchor", "compact subset", "Text at characters 6–20", "source-1", "anchor-1"),
    context("learning-goal", "learningGoal", "Goal", "Understand compactness", "Visible Learning Goal"),
    context("session-target", "sessionContext", "Session context", "Locate the separation step", "Visible Session Target"),
    context("source:source-1", "source", "Source", "Lecture notes", "p. 12", "source-1"),
    context("source:source-2", "source", "Source", "Topology glossary", "Definition 4", "source-2")
  ];
  return {
    id: "session-1", workspaceId: "workspace-1", missionId: "mission-1", mathematics: "Every compact subset is closed.",
    sourceIds: ["source-1", "source-2"], learningGoal: "Understand compactness", sessionTarget: "Locate the separation step",
    status: "active", activityOrder: 1, returnContext: { label: "Source", nextAction: "Continue" },
    proposal: { scope: "Locate the separation step", initialTeachingDirection: "Use the source", status: "accepted", confirmationReason: null },
    teachingCard: { status: "completed", content: "Initial teaching", error: null, retryable: false },
    teachingCardHistory: [], submittedPendingQuestions: [], currentTeachingInput: { kind: "sessionIntake", text: "Every compact subset is closed." },
    pendingQuestion: null, askBarContext: { items, includedIds: items.slice(0, 4).map((item) => item.id), customized: true },
    questionCards: [], activeQuestionCardId: null, accessPolicy: "workspace", accessRequests: [], pendingFullAccessConfirmation: false,
    researchEgressPermission: { status: "notGranted" }, researchActions: [],
    corroborationPass: null,
    corroborationPassHistory: [],
    sourceAnchors: [], sourceAnchorRequests: [], annotations: [], activeSourceAnchorId: "anchor-1", anchoredTeachingCards: [], activeTeachingCardId: null,
    trailDraft: { items: [] },
    consolidationDraft: null, consolidatedOutcome: null, continuationOf: null, modelStopConfirmation: null,
    conceptPeeks: [], pendingConceptPeek: null, prerequisiteBranchProposals: [], prerequisiteBranch: null,
    agentTasks: [], activeAgentTaskId: null,
    reasoningPreference: "balanced", runtimeOverride: null,
    learningArtifacts: [], learningSlice: null
  };
}

function context(
  id: string,
  kind: QuestionContextItem["kind"],
  typeLabel: string,
  identity: string,
  location: string,
  sourceId: string | null = null,
  sourceAnchorId: string | null = null
): QuestionContextItem {
  return { id, kind, typeLabel, identity, location, preview: identity, sourceId, sourceAnchorId };
}
