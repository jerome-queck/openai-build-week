// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnchoredTeachingCard, LearningArtifact } from "../../shared/learning-application";
import { ContextualInspector } from "./ContextualInspector";

describe("Contextual Inspector", () => {
  afterEach(cleanup);

  it("keeps one anchored route primary while exposing history, a named variant, and artifact promotion", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onRevise = vi.fn().mockResolvedValue(undefined);
    const onRestore = vi.fn().mockResolvedValue(undefined);
    const onPin = vi.fn().mockResolvedValue(undefined);
    const card: AnchoredTeachingCard = {
      id: "card-1",
      sourceAnchorId: "anchor-1",
      title: "Explain compact subset",
      currentRevision: {
        id: "revision-2",
        instruction: "Make the separation argument explicit.",
        status: "completed",
        content: "Separate an outside point, then take a finite subcover.",
        error: null,
        retryable: false,
        contextUsed: [{ sourceId: "source-1", sourceName: "Typed mathematics", location: "Text at characters 6–20" }],
        agentWorkLogReference: { sessionId: "session-1", fromSequence: 1, toSequence: 4 }
      },
      revisions: [{
        id: "revision-1",
        instruction: "Explain or unpack this source anchor.",
        status: "completed",
        content: "Compactness gives a finite subcover.",
        error: null,
        retryable: false,
        contextUsed: [],
        agentWorkLogReference: null
      }],
      variants: [{
        id: "variant-1",
        name: "Closed-map route",
        revision: {
          id: "variant-revision-1",
          instruction: "Use projection.",
          status: "completed",
          content: "Projection gives a genuinely different route.",
          error: null,
          retryable: false,
          contextUsed: [],
          agentWorkLogReference: null
        }
      }],
      artifactId: null
    };

    render(<ContextualInspector
      card={card}
      artifact={null}
      onClose={onClose}
      onRevise={onRevise}
      onRestore={onRestore}
      onCreateVariant={vi.fn()}
      onRetry={vi.fn()}
      onPin={onPin}
    />);

    expect(screen.getByRole("complementary", { name: "Contextual Inspector for Explain compact subset" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close Contextual Inspector" })).toBe(document.activeElement);
    expect(screen.getByText("Separate an outside point, then take a finite subcover.")).toBeTruthy();
    expect(screen.getByText("Typed mathematics").parentElement?.textContent).toContain("Text at characters 6–20");
    expect(screen.getByRole("region", { name: "Teaching Variant Closed-map route" }).textContent).toContain(
      "Projection gives a genuinely different route."
    );

    await user.click(screen.getByRole("button", { name: "Show Teaching Card revision history" }));
    await user.click(screen.getByRole("button", { name: "Restore Teaching Card revision 1" }));
    expect(onRestore).toHaveBeenCalledWith("revision-1");

    await user.type(screen.getByRole("textbox", { name: "Teaching Card follow-up" }), "Add the missing neighbourhood choice.");
    await user.click(screen.getByRole("button", { name: "Revise current Teaching Card" }));
    expect(onRevise).toHaveBeenCalledWith("Add the missing neighbourhood choice.");

    await user.click(screen.getByRole("button", { name: "Pin as Learning Artifact" }));
    expect(onPin).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Close Contextual Inspector" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows the pinned artifact relationship without offering duplicate promotion", () => {
    const artifact: LearningArtifact = {
      id: "artifact-1",
      title: "Explain compact subset",
      currentRevision: {
        id: "artifact-revision-1",
        content: "A substantial explanation.",
        claimOrigin: "modelGenerated",
        verificationLevel: "notIndependentlyChecked",
        verificationCurrency: "current"
      },
      revisions: [],
      sourceAnchorIds: ["anchor-1"],
      pinned: true
    };
    const card = {
      id: "card-1",
      sourceAnchorId: "anchor-1",
      title: artifact.title,
      currentRevision: {
        id: "revision-1", instruction: "Explain", status: "completed", content: artifact.currentRevision.content,
        error: null, retryable: false, contextUsed: [], agentWorkLogReference: null
      },
      revisions: [],
      variants: [],
      artifactId: artifact.id
    } satisfies AnchoredTeachingCard;
    render(<ContextualInspector card={card} artifact={artifact} onClose={() => undefined}
      onRevise={async () => undefined} onRestore={async () => undefined}
      onCreateVariant={async () => undefined} onRetry={async () => undefined} onPin={async () => undefined} />);
    expect(screen.getByRole("status").textContent).toContain("Pinned Learning Artifact retains this Source Anchor");
    expect(screen.queryByRole("button", { name: "Pin as Learning Artifact" })).toBeNull();
  });

  it("makes an anchored runtime failure actionable", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const card = {
      id: "card-1",
      sourceAnchorId: "anchor-1",
      title: "Explain compact subset",
      currentRevision: {
        id: "revision-1", instruction: "Explain", status: "failed", content: "Useful partial work",
        error: "Anchored teaching timed out.", retryable: true, contextUsed: [], agentWorkLogReference: null
      },
      revisions: [], variants: [], artifactId: null
    } satisfies AnchoredTeachingCard;
    render(<ContextualInspector card={card} artifact={null} onClose={() => undefined}
      onRevise={async () => undefined} onRestore={async () => undefined}
      onCreateVariant={async () => undefined} onRetry={onRetry} onPin={async () => undefined} />);
    expect(screen.getByRole("alert").textContent).toContain("Anchored teaching timed out.");
    await user.click(screen.getByRole("button", { name: "Retry anchored Teaching Card" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("collects the learner's anchored question before dispatch", async () => {
    const user = userEvent.setup();
    const onRevise = vi.fn().mockResolvedValue(undefined);
    const card = {
      id: "card-1", sourceAnchorId: "anchor-1", title: "Question about compact subset",
      currentRevision: {
        id: "revision-1", instruction: "Ask a question about this source anchor.", status: "idle", content: "",
        error: null, retryable: false, contextUsed: [], agentWorkLogReference: null
      },
      revisions: [], variants: [], artifactId: null
    } satisfies AnchoredTeachingCard;
    render(<ContextualInspector card={card} artifact={null} onClose={() => undefined} onRevise={onRevise}
      onRestore={async () => undefined} onCreateVariant={async () => undefined}
      onRetry={async () => undefined} onPin={async () => undefined} />);
    await user.type(screen.getByRole("textbox", { name: "Question about this Source Anchor" }), "Where is Hausdorff used?");
    await user.click(screen.getByRole("button", { name: "Ask about this Source Anchor" }));
    expect(onRevise).toHaveBeenCalledWith("Where is Hausdorff used?");
  });
});
