import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LearningApplication,
  type LinkedSource,
  type LocalSourceAccess,
  type SelectedLocalSource,
  type SourceIndexExtraction,
  type SourceIndexExtractionResult,
  type SourceFingerprint
} from "./learning-application";
import { ModelAccessError, type ArtifactSynthesisRequest, type ModelAccessCause, type ModelRuntime, type RuntimeAccessRequest, type SessionProposal, type SpecialistAgentRequest, type SpecialistAgentResult, type TeachingRequest } from "./model-runtime";

describe("Learning Application", () => {
  const dataDirectories: string[] = [];
  const applications: LearningApplication[] = [];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.waitForModelWork()));
    await Promise.all(dataDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function launch() {
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(dataDirectory);
    applications.push(application);
    return {
      dataDirectory,
      application
    };
  }

  async function launchWithRuntime(runtime: ModelRuntime) {
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(dataDirectory, runtime);
    applications.push(application);
    return {
      dataDirectory,
      application
    };
  }

  async function launchWithSourceAccess(sourceAccess: LocalSourceAccess) {
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(dataDirectory, null, sourceAccess);
    applications.push(application);
    return { dataDirectory, application };
  }

  async function launchWithRuntimeAndSourceAccess(runtime: ModelRuntime, sourceAccess: LocalSourceAccess) {
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(dataDirectory, runtime, sourceAccess);
    applications.push(application);
    return { dataDirectory, application };
  }

  it("links one Primary Folder to a Study Workspace and restores the grant after relaunch", async () => {
    const { application, dataDirectory } = await launch();
    const created = await application.submit({ type: "createWorkspace", name: "Algebra" });
    const workspaceId = created.navigation.workspaceId;
    const selection: SelectedLocalSource = {
      name: "algebra-notes",
      resourceType: "folder",
      lastKnownPath: "/Users/learner/Documents/algebra-notes",
      canonicalPath: "/Users/learner/Documents/algebra-notes",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "opaque-bookmark" },
      fingerprint: { size: 96, modifiedAtMs: 1_726_000_000_000 }
    };

    const linked = await application.linkPrimaryFolder(workspaceId, selection);

    const primaryFolder = linked.sources.find((source) => source.id === linked.workspaces[1].context.primaryFolderSourceId);
    expect(primaryFolder).toMatchObject({
      kind: "linkedSource",
      role: "primaryFolder",
      workspaceId,
      name: "algebra-notes",
      link: {
        lastKnownPath: "/Users/learner/Documents/algebra-notes",
        accessGrant: { kind: "securityScopedBookmark", bookmarkData: "opaque-bookmark" },
        accessStatus: "available"
      }
    });
    expect(linked.workspaces[1].context.sourceIds).toEqual([primaryFolder?.id]);

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sources).toEqual(linked.sources);
    expect(relaunched.getState().workspaces[1].context.primaryFolderSourceId).toBe(primaryFolder?.id);
  });

  it("keeps disk-backed attachments linked while retaining fileless intake as a Managed Asset", async () => {
    const { application, dataDirectory } = await launch();
    const created = await application.submit({ type: "createWorkspace", name: "Analysis" });
    const workspaceId = created.navigation.workspaceId;

    const withAttachment = await application.linkExternalAttachment(workspaceId, {
      name: "lecture-3.pdf",
      resourceType: "file",
      lastKnownPath: "/Users/learner/Downloads/lecture-3.pdf",
      canonicalPath: "/Users/learner/Downloads/lecture-3.pdf",
      accessGrant: null,
      fingerprint: { size: 4_096, modifiedAtMs: 1_726_000_100_000 }
    });
    expect(withAttachment.sources).toContainEqual(expect.objectContaining({
      kind: "linkedSource",
      role: "externalAttachment",
      workspaceId,
      name: "lecture-3.pdf",
      link: expect.objectContaining({ lastKnownPath: "/Users/learner/Downloads/lecture-3.pdf" })
    }));

    const started = await application.submit({
      type: "startQuickStudy",
      mathematics: "Why is every compact subset of a Hausdorff space closed?"
    });
    const managedAsset = started.sources.find((source) => source.kind === "managedAsset");
    expect(managedAsset).toMatchObject({
      kind: "managedAsset",
      workspaceId: "quick-study-workspace",
      name: "Typed mathematics",
      mediaType: "text/plain",
      content: "Why is every compact subset of a Hausdorff space closed?"
    });
    expect(started.workspaces[0].context.sourceIds).toContain(managedAsset?.id);
  });

  it("persists precise text, equation, and normalized diagram Source Anchors across relaunch", async () => {
    const { application, dataDirectory } = await launch();
    const started = await application.submit({
      type: "startQuickStudy",
      mathematics: "Let $f(x)=x^2$. The diagram below shows its graph."
    });
    const session = started.sessions[0];
    const sourceId = session.sourceIds[0];

    await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text",
        startOffset: 4,
        endOffset: 14,
        exactText: "$f(x)=x^2$",
        prefix: "Let ",
        suffix: ". The diagram below"
      },
      paletteAction: "addNote"
    });
    await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "equation",
        equationIndex: 0,
        startOffset: 4,
        endOffset: 14,
        exactText: "$f(x)=x^2$",
        prefix: "Let ",
        suffix: ". The diagram below"
      },
      paletteAction: "question"
    });
    const anchored = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "diagramRegion",
        bounds: { x: 0.125, y: 0.25, width: 0.5, height: 0.375 }
      },
      paletteAction: "addToLearningTrail"
    });

    expect(anchored.sessions[0].sourceAnchors).toMatchObject([
      { sourceId, selection: { kind: "text", startOffset: 4, endOffset: 14 } },
      { sourceId, selection: { kind: "equation", equationIndex: 0, exactText: "$f(x)=x^2$" } },
      {
        sourceId,
        selection: { kind: "diagramRegion", bounds: { x: 0.125, y: 0.25, width: 0.5, height: 0.375 } }
      }
    ]);
    expect(anchored.sessions[0].sourceAnchorRequests.map((request) => request.action)).toEqual([
      "addNote", "question", "addToLearningTrail"
    ]);
    expect(anchored.sessions[0].activeSourceAnchorId).toBe(anchored.sessions[0].sourceAnchors[2].id);

    await application.submit({ type: "leaveSession" });
    const resumed = await application.submit({ type: "resumeSession", sessionId: session.id });
    expect(resumed.sessions[0].sourceAnchors).toEqual(anchored.sessions[0].sourceAnchors);

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].sourceAnchors).toEqual(anchored.sessions[0].sourceAnchors);
    expect(relaunched.getState().sessions[0].activeSourceAnchorId).toBe(anchored.sessions[0].activeSourceAnchorId);
  });

  it("keeps a verbatim Personal Note anchored and out of ordinary model context across reload", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain the selected claim",
      initialTeachingDirection: "Start from the definition",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
    const requestCount = runtime.teachingRequests.length;
    const sourceId = state.sessions[0].sourceIds[0];

    state = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset",
        prefix: "Every ", suffix: " of a Hausdorff space is closed."
      },
      paletteAction: "addNote"
    });
    const sourceAnchorId = state.sessions[0].activeSourceAnchorId!;
    state = await application.submit({
      type: "createAnnotation",
      sourceAnchorId,
      purpose: "personalNote",
      content: "  I keep forgetting where the finite subcover enters.\n"
    });

    expect(runtime.teachingRequests).toHaveLength(requestCount);
    expect(state.sessions[0].annotations).toEqual([
      expect.objectContaining({
        sourceAnchorId,
        purpose: "personalNote",
        content: "  I keep forgetting where the finite subcover enters.\n"
      })
    ]);

    const relaunched = await LearningApplication.launch(dataDirectory, runtime);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].annotations).toEqual(state.sessions[0].annotations);
    expect(JSON.stringify(runtime.teachingRequests)).not.toContain("I keep forgetting");
  });

  it("governs Personal Note artifact synthesis while preserving originals and interpretations across reload", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain the selected claim",
      initialTeachingDirection: "Start from the definition",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({
      type: "createSourceAnchor",
      sourceId: state.sessions[0].sourceIds[0],
      selection: {
        kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset",
        prefix: "Every ", suffix: " of a Hausdorff space is closed."
      },
      paletteAction: "explain"
    });
    runtime.emitTeaching("Use compactness to make the pointwise separation argument finite.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    const session = application.getState().sessions[0];
    const cardId = session.anchoredTeachingCards[0].id;
    const sourceAnchorId = session.anchoredTeachingCards[0].sourceAnchorId;
    state = await application.submit({
      type: "createAnnotation",
      sourceAnchorId,
      purpose: "personalNote",
      content: "  My picture is: compactness turns infinitely many local choices into finitely many.\n"
    });
    const originalAnnotation = structuredClone(state.sessions[0].annotations[0]);
    expect(state.personalNoteSynthesisPreference).toEqual({ includePersonalNotes: true });

    state = await application.submit({ type: "pinTeachingCardArtifact", cardId });
    const artifactId = state.sessions[0].learningArtifacts[0].id;
    state = await application.submit({ type: "synthesizeLearningArtifact", artifactId });

    expect(runtime.artifactSynthesisRequests[0].personalNotes).toEqual([{
      annotationId: originalAnnotation.id,
      sourceAnchorId,
      content: originalAnnotation.content
    }]);
    expect(runtime.teachingRequests.every((request) => request.tutorFeedback?.every(
      (feedback) => feedback.annotationId !== originalAnnotation.id
    ) ?? true)).toBe(true);
    expect(state.sessions[0].annotations[0]).toEqual(originalAnnotation);
    expect(state.sessions[0].learningArtifacts[0].currentRevision).toMatchObject({
      content: "Use compactness to make the pointwise separation argument finite. The learner connects this to a finite-choice picture.",
      claimOrigin: "mixed",
      provenance: { action: "synthesized" },
      personalNoteContributions: [{
        annotationId: originalAnnotation.id,
        sourceAnchorId,
        verbatim: originalAnnotation.content,
        interpretation: "The learner connects compactness with reducing local choices to finitely many."
      }]
    });
    const synthesizedCopy = application.createArtifactPortableCopy(state.sessions[0].id, artifactId);
    expect(synthesizedCopy.content).toContain(originalAnnotation.content);
    expect(synthesizedCopy.content).toContain(`Original annotation: ${originalAnnotation.id}`);
    expect(synthesizedCopy.content).toContain("### Note Interpretation");

    state = await application.submit({ type: "setPersonalNoteSynthesis", enabled: false });
    expect(state.personalNoteSynthesisPreference.includePersonalNotes).toBe(false);
    state = await application.submit({ type: "synthesizeLearningArtifact", artifactId });
    expect(runtime.artifactSynthesisRequests[1].personalNotes).toEqual([]);
    expect(state.sessions[0].learningArtifacts[0].currentRevision.personalNoteContributions).toEqual([]);
    expect(state.sessions[0].learningArtifacts[0].revisions.at(-1)?.personalNoteContributions).toEqual([{
      annotationId: originalAnnotation.id,
      sourceAnchorId,
      verbatim: originalAnnotation.content,
      interpretation: "The learner connects compactness with reducing local choices to finitely many."
    }]);
    expect(state.sessions[0].annotations[0]).toEqual(originalAnnotation);

    const relaunched = await LearningApplication.launch(dataDirectory, runtime);
    applications.push(relaunched);
    expect(relaunched.getState().personalNoteSynthesisPreference.includePersonalNotes).toBe(false);
    expect(relaunched.getState().sessions[0].annotations[0]).toEqual(originalAnnotation);
    expect(relaunched.getState().sessions[0].learningArtifacts[0]).toEqual(state.sessions[0].learningArtifacts[0]);
  });

  it("leaves the last valid artifact revision intact when synthesis fails", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain one step",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    const { artifactId, revision } = await createPinnedArtifact(application, runtime);
    runtime.artifactSynthesisError = new ModelAccessError("network", "Synthesis network unavailable.");

    await expect(application.submit({ type: "synthesizeLearningArtifact", artifactId }))
      .rejects.toThrow("Synthesis network unavailable");
    await application.waitForModelWork();
    expect(application.getState().sessions[0].learningArtifacts[0].currentRevision).toEqual(revision);
    expect(application.getState().sessions[0].learningArtifacts[0].revisions).toEqual([]);

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].learningArtifacts[0].currentRevision).toEqual(revision);
  });

  it("stops in-flight synthesis on shutdown without stranding or partially persisting a revision", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain one step",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    const { artifactId, revision } = await createPinnedArtifact(application, runtime);
    runtime.holdArtifactSynthesis = true;

    const synthesis = application.submit({ type: "synthesizeLearningArtifact", artifactId });
    const stopped = expect(synthesis).rejects.toThrow("Learning Artifact synthesis was stopped");
    await vi.waitFor(() => expect(runtime.artifactSynthesisRequests).toHaveLength(1));
    await application.shutdown();
    await stopped;
    await application.waitForModelWork();
    expect(application.getState().sessions[0].learningArtifacts[0].currentRevision).toEqual(revision);
    expect(application.getState().sessions[0].learningArtifacts[0].revisions).toEqual([]);

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].learningArtifacts[0].currentRevision).toEqual(revision);
  });

  it("uses Tutor Feedback to revise anchored teaching and honors later purpose conversions", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain the selected claim",
      initialTeachingDirection: "Start from the definition",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({
      type: "createSourceAnchor",
      sourceId: state.sessions[0].sourceIds[0],
      selection: {
        kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset",
        prefix: "Every ", suffix: " of a Hausdorff space is closed."
      },
      paletteAction: "explain"
    });
    runtime.emitTeaching("The first explanation is too compressed.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    const sourceAnchorId = state.sessions[0].activeSourceAnchorId!;
    const cardId = state.sessions[0].activeTeachingCardId!;

    const equivalentAnnotation = "Show the neighbourhood choice explicitly.";
    state = await application.submit({
      type: "createAnnotation", sourceAnchorId, purpose: "personalNote", content: equivalentAnnotation
    });
    const personalNoteId = state.sessions[0].annotations[0].id;
    state = await application.submit({
      type: "createAnnotation", sourceAnchorId, purpose: "tutorFeedback", content: equivalentAnnotation
    });
    const tutorFeedbackId = state.sessions[0].annotations[1].id;
    expect(runtime.teachingRequests.at(-1)?.focus).toMatchObject({
      sourceAnchorId,
      instruction: equivalentAnnotation
    });
    expect(runtime.teachingRequests.at(-1)?.tutorFeedback).toEqual([{
      annotationId: tutorFeedbackId,
      sourceAnchorId,
      content: equivalentAnnotation
    }]);
    runtime.emitTeaching("Choose one neighbourhood for every point outside the compact set.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    expect(application.getState().sessions[0].anchoredTeachingCards[0].currentRevision.content)
      .toContain("Choose one neighbourhood");

    state = await application.submit({ type: "convertAnnotation", annotationId: personalNoteId, purpose: "tutorFeedback" });
    expect(state.sessions[0].annotations[0]).toMatchObject({
      purpose: "tutorFeedback",
      purposeChanges: [{ from: "personalNote", to: "tutorFeedback" }]
    });
    await application.submit({ type: "reviseTeachingCard", cardId, instruction: "Give one more explicit revision." });
    expect(runtime.teachingRequests.at(-1)?.tutorFeedback?.map((feedback) => feedback.annotationId))
      .toEqual([personalNoteId, tutorFeedbackId]);
    runtime.completeTeaching();
    await application.waitForModelWork();

    state = await application.submit({ type: "convertAnnotation", annotationId: personalNoteId, purpose: "personalNote" });
    expect(state.sessions[0].annotations[0].purposeChanges).toEqual([
      { from: "personalNote", to: "tutorFeedback" },
      { from: "tutorFeedback", to: "personalNote" }
    ]);
    await application.submit({ type: "submitQuestion", text: "How does this affect the whole proof?" });
    expect(runtime.teachingRequests.at(-1)?.focus).toBeUndefined();
    expect(runtime.teachingRequests.at(-1)?.tutorFeedback?.map((feedback) => feedback.annotationId))
      .toEqual([tutorFeedbackId]);
    runtime.completeTeaching();
    await application.waitForModelWork();

    const relaunched = await LearningApplication.launch(dataDirectory, runtime);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].annotations).toEqual(state.sessions[0].annotations);
    expect(relaunched.getState().sources[0]).toMatchObject({
      kind: "managedAsset",
      content: "Every compact subset of a Hausdorff space is closed."
    });
  });

  it("lets the learner curate required Trail Items and restores the Trail Draft after resuming", async () => {
    const { application, dataDirectory } = await launch();
    let state = await application.submit({
      type: "startQuickStudy",
      mathematics: "Let $f(x)=x^2$. The derivative is $2x$."
    });
    const sessionId = state.sessions[0].id;
    const sourceId = state.sessions[0].sourceIds[0];

    state = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "equation",
        equationIndex: 0,
        startOffset: 4,
        endOffset: 14,
        exactText: "$f(x)=x^2$",
        prefix: "Let ",
        suffix: ". The derivative"
      },
      paletteAction: "addToLearningTrail"
    });
    const anchoredItem = state.sessions[0].trailDraft.items[0];
    expect(anchoredItem).toMatchObject({
      kind: "concept",
      content: "$f(x)=x^2$",
      required: true,
      origin: "learner",
      links: { sourceAnchorIds: [state.sessions[0].sourceAnchors[0].id] }
    });

    state = await application.submit({
      type: "addTrailItem",
      kind: "nextStep",
      content: "Differentiate the polynomial term by term."
    });
    const nextStep = state.sessions[0].trailDraft.items[1];
    expect(nextStep.required).toBe(true);
    state = await application.submit({
      type: "editTrailItem",
      trailItemId: nextStep.id,
      content: "Differentiate using the power rule."
    });
    state = await application.submit({ type: "moveTrailItem", trailItemId: nextStep.id, direction: "up" });
    expect(state.sessions[0].trailDraft.items.map((item) => item.content)).toEqual([
      "Differentiate using the power rule.",
      "$f(x)=x^2$"
    ]);

    await expect(application.submit({ type: "removeTrailItem", trailItemId: nextStep.id }))
      .rejects.toThrow("Remove the Required Trail Item marker before deleting this item");
    await application.submit({ type: "setTrailItemRequired", trailItemId: nextStep.id, required: false });
    state = await application.submit({ type: "removeTrailItem", trailItemId: nextStep.id });
    expect(state.sessions[0].trailDraft.items).toHaveLength(1);

    await application.submit({ type: "leaveSession" });
    const pausedRelaunch = await LearningApplication.launch(dataDirectory);
    applications.push(pausedRelaunch);
    expect(pausedRelaunch.getState().sessions[0].trailDraft.items).toEqual([anchoredItem]);
    state = await pausedRelaunch.submit({ type: "resumeSession", sessionId });
    expect(state.sessions[0].trailDraft.items).toEqual([anchoredItem]);

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].trailDraft.items).toEqual([anchoredItem]);
  });

  it("anchors exact Linked Source text only after the learner attaches it to the active session", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    const { application } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Topology" });
    const workspaceId = workspace.navigation.workspaceId;
    const mission = await application.submit({ type: "createMission", workspaceId, name: "Compactness" });
    const linked = await application.linkExternalAttachment(workspaceId, {
      name: "compactness.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/compactness.txt",
      canonicalPath: "/Users/learner/compactness.txt",
      accessGrant: null,
      fingerprint: sourceAccess.fingerprint
    });
    const sourceId = linked.sources.find((source) => source.kind === "linkedSource")!.id;
    await application.submit({
      type: "startQuickStudy",
      mathematics: "Study the supplied source.",
      location: { workspaceId, missionId: mission.navigation.missionId! }
    });
    const anchorAction = {
      type: "createSourceAnchor" as const,
      sourceId,
      selection: {
        kind: "text" as const,
        startOffset: 0,
        endOffset: 16,
        exactText: "Every open cover",
        prefix: "",
        suffix: " has a finite subcover."
      },
      paletteAction: "explain" as const
    };

    await expect(application.submit(anchorAction)).rejects.toThrow("source attached to the active Learning Session");
    await application.submit({ type: "addSourceToSession", sourceId });
    const anchored = await application.submit(anchorAction);

    expect(anchored.sessions[0].sourceAnchors[0]).toMatchObject({
      sourceId,
      selection: { kind: "text", exactText: "Every open cover" }
    });
    expect(sourceAccess.openedSourceIds).toEqual([sourceId]);
  });

  it("creates a durable Teaching Card for an anchored explanation request", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain the selected claim",
      initialTeachingDirection: "Start from the open-cover definition",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    const started = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();

    const sourceId = started.sessions[0].sourceIds[0];
    const anchored = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text",
        startOffset: 6,
        endOffset: 20,
        exactText: "compact subset",
        prefix: "Every ",
        suffix: " of a Hausdorff space is closed."
      },
      paletteAction: "explain"
    });

    const anchor = anchored.sessions[0].sourceAnchors[0];
    expect(anchored.sessions[0].anchoredTeachingCards).toMatchObject([{
      sourceAnchorId: anchor.id,
      title: "Explain compact subset",
      currentRevision: { status: "streaming", content: "" },
      revisions: []
    }]);
    expect(runtime.teachingRequests.at(-1)?.focus).toEqual({
      kind: "sourceAnchor",
      sourceAnchorId: anchor.id,
      sourceId,
      selection: anchor.selection,
      instruction: "Explain or unpack this source anchor.",
      previousContent: null,
      variantName: null
    });

    runtime.emitTeaching("Compactness supplies a finite subcover of the separating neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    expect(application.getState().sessions[0].anchoredTeachingCards[0].currentRevision).toMatchObject({
      status: "completed",
      content: "Compactness supplies a finite subcover of the separating neighbourhoods."
    });

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].anchoredTeachingCards[0].sourceAnchorId).toBe(anchor.id);
  });

  it("automatically curates linked suggestions without revising a Required Trail Item", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain the selected claim",
      initialTeachingDirection: "Start from the open-cover definition",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();

    state = await application.submit({
      type: "createSourceAnchor",
      sourceId: state.sessions[0].sourceIds[0],
      selection: {
        kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset",
        prefix: "Every ", suffix: " of a Hausdorff space is closed."
      },
      paletteAction: "explain"
    });
    const session = state.sessions[0];
    const cardId = session.anchoredTeachingCards[0].id;
    const anchorId = session.sourceAnchors[0].id;
    runtime.emitTeaching("Use compactness to obtain a finite subcover.");
    runtime.completeTeaching();
    await application.waitForModelWork();

    state = application.getState();
    let suggestion = state.sessions[0].trailDraft.items.find((item) => item.curationKey === `teaching-card:${cardId}`)!;
    expect(suggestion).toMatchObject({
      kind: "reasoningStep",
      content: "Use compactness to obtain a finite subcover.",
      required: false,
      origin: "teachingAgent",
      links: { sourceAnchorIds: [anchorId], teachingCardIds: [cardId] }
    });
    expect(state.sessions[0].trailDraft.items).toContainEqual(expect.objectContaining({
      kind: "evidence",
      content: expect.stringContaining("Context used:"),
      origin: "teachingAgent",
      links: expect.objectContaining({ sourceAnchorIds: [anchorId], teachingCardIds: [cardId] })
    }));

    await application.submit({ type: "reviseTeachingCard", cardId, instruction: "Make the separation step explicit." });
    runtime.emitTeaching("Choose one separating neighbourhood for each point, then take a finite subcover.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = application.getState();
    suggestion = state.sessions[0].trailDraft.items.find((item) => item.curationKey === `teaching-card:${cardId}`)!;
    expect(suggestion.content).toContain("separating neighbourhood");

    await application.submit({ type: "setTrailItemRequired", trailItemId: suggestion.id, required: true });
    await application.submit({ type: "reviseTeachingCard", cardId, instruction: "Try another wording." });
    runtime.emitTeaching("This later automatic wording must not replace the required item.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = application.getState();
    expect(state.sessions[0].trailDraft.items.find((item) => item.id === suggestion.id)?.content)
      .toContain("separating neighbourhood");

    state = await application.submit({ type: "pinTeachingCardArtifact", cardId });
    const artifact = state.sessions[0].learningArtifacts[0];
    expect(state.sessions[0].trailDraft.items).toContainEqual(expect.objectContaining({
      kind: "learningArtifact",
      content: artifact.title,
      links: expect.objectContaining({
        sourceAnchorIds: [anchorId],
        teachingCardIds: [cardId],
        learningArtifactIds: [artifact.id]
      })
    }));

    const concept = state.sessions[0].trailDraft.items.find((item) => item.curationKey === `source-anchor:${anchorId}`)!;
    state = await application.submit({
      type: "editTrailItem", trailItemId: concept.id, content: "Compactness supplies the finite choice."
    });
    expect(state.sessions[0].trailDraft.items.find((item) => item.id === concept.id)).toMatchObject({
      content: "Compactness supplies the finite choice.",
      origin: "learner",
      curationKey: null
    });
  });

  it("consolidates a durable outcome and continues in a fresh linked Learning Session", async () => {
    const { application, dataDirectory } = await launch();
    let state = await application.submit({
      type: "startQuickStudy",
      mathematics: "Show that every compact subset of a Hausdorff space is closed."
    });
    const sessionId = state.activeSessionId!;
    state = await application.submit({
      type: "addTrailItem",
      kind: "reasoningStep",
      content: "Separate each outside point and use compactness to choose finitely many neighbourhoods."
    });
    const requiredItem = state.sessions[0].trailDraft.items[0];

    state = await application.submit({ type: "beginSessionConsolidation" });
    expect(state.sessions[0].consolidationDraft).toMatchObject({
      targetDisposition: null,
      includedArtifactIds: []
    });
    state = await application.submit({
      type: "reviseSessionConsolidation",
      centralInsight: "Compactness turns pointwise separation into one neighbourhood separating the whole compact set.",
      learningProgress: "I can now explain where the finite subcover enters the proof.",
      unresolvedQuestions: ["How does the argument change without Hausdorff separation?"],
      nextStep: "Write the proof without looking at the source.",
      includedArtifactIds: [],
      targetDisposition: "addressed"
    });
    state = await application.submit({ type: "consolidateSession" });

    const consolidated = state.sessions.find((session) => session.id === sessionId)!;
    expect(consolidated.status).toBe("consolidated");
    expect(consolidated.consolidatedOutcome).toMatchObject({
      targetDisposition: "addressed",
      centralInsight: "Compactness turns pointwise separation into one neighbourhood separating the whole compact set.",
      learningProgress: "I can now explain where the finite subcover enters the proof.",
      unresolvedQuestions: ["How does the argument change without Hausdorff separation?"],
      nextStep: "Write the proof without looking at the source.",
      includedArtifactIds: []
    });
    expect(consolidated.consolidatedOutcome?.trailItems).toContainEqual(requiredItem);
    expect(state).toMatchObject({ screen: "dashboard", activeSessionId: null, resumeSessionId: null });
    await expect(application.submit({ type: "resumeSession", sessionId })).rejects.toThrow(
      "A consolidated Learning Session is a stable historical record"
    );

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    const historicalRecord = structuredClone(relaunched.getState().sessions[0]);
    expect(historicalRecord.status).toBe("consolidated");

    state = await relaunched.submit({ type: "continueSession", sessionId });
    const continuation = state.sessions.find((session) => session.id === state.activeSessionId)!;
    expect(continuation).toMatchObject({
      workspaceId: historicalRecord.workspaceId,
      missionId: historicalRecord.missionId,
      learningGoal: historicalRecord.learningGoal,
      sessionTarget: historicalRecord.sessionTarget,
      status: "active",
      continuationOf: {
        sessionId,
        outcomeId: historicalRecord.consolidatedOutcome?.id
      },
      teachingCardHistory: [],
      submittedPendingQuestions: [],
      anchoredTeachingCards: [],
      questionCards: [],
      learningArtifacts: [],
      trailDraft: { items: [] }
    });
    expect(continuation.askBarContext.items).toContainEqual(expect.objectContaining({
      id: "continuation-outcome",
      typeLabel: "Prior Consolidated Session Outcome",
      preview: expect.stringContaining("Compactness turns pointwise separation")
    }));
    expect(state.sessions.find((session) => session.id === sessionId)).toEqual(historicalRecord);
  });

  it("lets the learner begin Session Consolidation while teaching is in flight", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain the finite-subcover step",
      initialTeachingDirection: "Start from pointwise separation",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const started = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Show that every compact subset of a Hausdorff space is closed."
    });
    const sessionId = started.activeSessionId!;

    const state = await application.submit({ type: "beginSessionConsolidation" });

    expect(runtime.canceledSessionIds).toEqual([sessionId]);
    expect(state.sessions[0].teachingCard.status).toBe("stopped");
    expect(state.sessions[0].consolidationDraft).not.toBeNull();

    await application.submit({
      type: "reviseSessionConsolidation",
      centralInsight: "Compactness makes the separation finite.",
      learningProgress: "I can locate the finite-subcover step.",
      unresolvedQuestions: [],
      nextStep: "Reconstruct the proof.",
      includedArtifactIds: [],
      targetDisposition: "addressed"
    });
    const consolidated = await application.submit({ type: "consolidateSession" });
    const historicalSessionId = consolidated.sessions[0].id;
    const continued = await application.submit({ type: "continueSession", sessionId: historicalSessionId });
    const firstContinuationId = continued.activeSessionId!;
    await application.submit({ type: "submitQuestion", text: "Can I prove it another way?" });

    const continuedAgain = await application.submit({ type: "continueSession", sessionId: historicalSessionId });
    runtime.completeTeaching(firstContinuationId);
    await application.waitForModelWork();

    expect(runtime.canceledSessionIds).toEqual([sessionId, firstContinuationId]);
    expect(continuedAgain.sessions.find((session) => session.id === firstContinuationId)?.status).toBe("paused");
  });

  it("does not let failed runtime cancellation block learner-controlled Session Consolidation", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain the finite-subcover step",
      initialTeachingDirection: "Start from pointwise separation",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    runtime.cancelError = new Error("Runtime cancellation transport failed.");
    const { application } = await launchWithRuntime(runtime);
    const started = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Show that every compact subset of a Hausdorff space is closed."
    });
    const sessionId = started.activeSessionId!;
    try {
      const state = await application.submit({ type: "beginSessionConsolidation" });
      expect(state.sessions[0]).toMatchObject({
        teachingCard: { status: "stopped" },
        consolidationDraft: expect.objectContaining({ targetDisposition: null })
      });
      await Promise.resolve();
      expect(application.getState().sessions[0].modelStopConfirmation).toMatchObject({
        status: "unconfirmed",
        message: expect.stringContaining("Retry interruption")
      });
      runtime.cancelError = null;
      await application.submit({ type: "retrySessionModelStop", sessionId });
      await Promise.resolve();
      expect(application.getState().sessions[0].modelStopConfirmation).toBeNull();
      expect(runtime.canceledSessionIds).toEqual([sessionId, sessionId]);
    } finally {
      runtime.cancelError = null;
      runtime.completeTeaching(sessionId);
      await application.waitForModelWork();
    }
  });

  it("keeps consolidated artifacts revisable and prepares non-mutating export and share copies", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain the compactness step",
      initialTeachingDirection: "Use finite subcovers",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({
      type: "createSourceAnchor",
      sourceId: state.sessions[0].sourceIds[0],
      selection: {
        kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset",
        prefix: "Every ", suffix: " of a Hausdorff space is closed."
      },
      paletteAction: "explain"
    });
    runtime.emitTeaching("Use compactness to select finitely many separating neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    const cardId = application.getState().sessions[0].anchoredTeachingCards[0].id;
    state = await application.submit({ type: "pinTeachingCardArtifact", cardId, artifactKind: "reformulatedProof" });
    const sessionId = state.sessions[0].id;
    const artifactId = state.sessions[0].learningArtifacts[0].id;
    expect(state.sessions[0].learningArtifacts[0]).toMatchObject({
      kind: "reformulatedProof",
      originatingSessionId: sessionId,
      currentRevision: {
        provenance: { action: "promoted", priorRevisionId: null }
      }
    });
    await application.submit({ type: "beginSessionConsolidation" });
    await application.submit({
      type: "reviseSessionConsolidation",
      centralInsight: "Compactness turns the pointwise construction into a finite one.",
      learningProgress: "I can identify the finite subcover.",
      unresolvedQuestions: [],
      nextStep: "Rewrite the proof.",
      includedArtifactIds: [artifactId],
      targetDisposition: "addressed"
    });
    await application.submit({ type: "consolidateSession" });

    state = await application.submit({
      type: "editLearningArtifact",
      sessionId,
      artifactId,
      content: "Learner revision after consolidation."
    });
    expect(state.sessions[0].learningArtifacts[0]).toMatchObject({
      currentRevision: { content: "Learner revision after consolidation.", claimOrigin: "mixed" },
      revisions: [expect.objectContaining({ content: "Use compactness to select finitely many separating neighbourhoods." })]
    });

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    const previousRevisionId = relaunched.getState().sessions[0].learningArtifacts[0].revisions[0].id;
    state = await relaunched.submit({
      type: "restoreLearningArtifactRevision", sessionId, artifactId, revisionId: previousRevisionId
    });
    expect(state.sessions[0].learningArtifacts[0]).toMatchObject({
      currentRevision: {
        content: "Use compactness to select finitely many separating neighbourhoods.",
        provenance: { action: "restored", priorRevisionId: previousRevisionId }
      },
      revisions: [
        expect.objectContaining({ id: previousRevisionId }),
        expect.objectContaining({ content: "Learner revision after consolidation." })
      ]
    });

    const beforePortableCopy = relaunched.getState();
    const portableCopy = relaunched.createArtifactPortableCopy(sessionId, artifactId);
    expect(portableCopy).toMatchObject({
      artifactId,
      originatingSessionId: sessionId,
      suggestedFilename: expect.stringMatching(/\.md$/),
      mediaType: "text/markdown",
      content: expect.stringContaining("# Reformulated Proof")
    });
    expect(portableCopy.content).toContain("Use compactness to select finitely many separating neighbourhoods.");
    expect(portableCopy.content).toContain("compact subset");
    expect(Object.keys(portableCopy)).not.toContain("workspaceId");

    const exportPath = join(dataDirectory, "portable-proof.md");
    await relaunched.exportLearningArtifact(sessionId, artifactId, exportPath);
    expect(await readFile(exportPath, "utf8")).toBe(portableCopy.content);
    expect(relaunched.getState()).toEqual(beforePortableCopy);

    const sharedCopies: unknown[] = [];
    const sharingApplication = await LearningApplication.launch(dataDirectory, null, null, {
      share: async (copy) => {
        sharedCopies.push(copy);
        return { status: "shared", path: "/tmp/shared-portable-proof.md" };
      }
    });
    applications.push(sharingApplication);
    expect(await sharingApplication.shareLearningArtifact(sessionId, artifactId)).toEqual({
      status: "shared", path: "/tmp/shared-portable-proof.md"
    });
    expect(sharedCopies).toEqual([portableCopy]);
    expect(Object.keys(sharedCopies[0] as object)).not.toContain("workspaceId");
    expect(sharingApplication.getState()).toEqual(beforePortableCopy);
  });

  it("migrates Learning Artifacts saved before kind, origin, and revision provenance were recorded", async () => {
    const { application, dataDirectory } = await launch();
    const started = await application.submit({ type: "startQuickStudy", mathematics: "Every compact set is closed." });
    const sourceId = started.sessions[0].sourceIds[0];
    const anchored = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text", startOffset: 6, endOffset: 13, exactText: "compact", prefix: "Every ", suffix: " set is closed."
      },
      paletteAction: "addNote"
    });
    const statePath = join(dataDirectory, "learning-application.json");
    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    persisted.sessions[0].learningArtifacts = [{
      id: "legacy-artifact",
      title: "Compactness proof",
      currentRevision: {
        id: "legacy-revision",
        content: "Use a finite subcover.",
        claimOrigin: "modelGenerated",
        verificationLevel: "notIndependentlyChecked",
        verificationCurrency: "current"
      },
      revisions: [],
      sourceAnchorIds: [anchored.sessions[0].sourceAnchors[0].id],
      pinned: true
    }];
    await writeFile(statePath, JSON.stringify(persisted), "utf8");

    const migrated = await LearningApplication.launch(dataDirectory);
    applications.push(migrated);
    expect(migrated.getState().personalNoteSynthesisPreference).toEqual({ includePersonalNotes: true });
    expect(migrated.getState().sessions[0].learningArtifacts[0]).toMatchObject({
      kind: "learningArtifact",
      originatingSessionId: anchored.sessions[0].id,
      currentRevision: {
        id: "legacy-revision",
        personalNoteContributions: [],
        provenance: { action: "promoted", createdAt: null, priorRevisionId: null }
      }
    });

    persisted.sessions[0].learningArtifacts[0].kind = "sourceLayer";
    await writeFile(statePath, JSON.stringify(persisted), "utf8");
    await expect(LearningApplication.launch(dataDirectory)).rejects.toThrow("Stored Learning Artifact kind is invalid");

    persisted.sessions[0].learningArtifacts[0].kind = "learningArtifact";
    persisted.sessions[0].learningArtifacts[0].currentRevision.provenance = {
      action: "edited", createdAt: "not-a-date", priorRevisionId: null
    };
    await writeFile(statePath, JSON.stringify(persisted), "utf8");
    await expect(LearningApplication.launch(dataDirectory)).rejects.toThrow("Stored Learning Artifact revision is invalid");
  });

  it("opens an anchored question in the Contextual Inspector path without dispatching until the learner words it", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Ask about one phrase",
      initialTeachingDirection: "Use the selected source",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const started = await application.submit({ type: "submitSessionIntake", mathematics: "Every compact set is closed." });
    runtime.completeTeaching();
    await application.waitForModelWork();
    const requestCount = runtime.teachingRequests.length;
    const questioned = await application.submit({
      type: "createSourceAnchor",
      sourceId: started.sessions[0].sourceIds[0],
      selection: {
        kind: "text", startOffset: 6, endOffset: 13, exactText: "compact", prefix: "Every ", suffix: " set is closed."
      },
      paletteAction: "question"
    });
    const card = questioned.sessions[0].anchoredTeachingCards[0];
    expect(card).toMatchObject({
      title: "Question about compact",
      currentRevision: { status: "idle", instruction: "Ask a question about this source anchor." }
    });
    expect(runtime.teachingRequests).toHaveLength(requestCount);

    await application.submit({
      type: "reviseTeachingCard",
      cardId: card.id,
      instruction: "Where is the Hausdorff assumption used?"
    });
    expect(runtime.teachingRequests.at(-1)?.focus).toMatchObject({
      sourceAnchorId: questioned.sessions[0].sourceAnchors[0].id,
      instruction: "Where is the Hausdorff assumption used?",
      previousContent: null
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
  });

  it("creates and revises one Question Card from editable Ask Bar context", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Locate the separation step",
      initialTeachingDirection: "Use the selected source",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();

    const sourceId = state.sessions[0].sourceIds[0];
    state = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text",
        startOffset: 6,
        endOffset: 20,
        exactText: "compact subset",
        prefix: "Every ",
        suffix: " of a Hausdorff space is closed."
      },
      paletteAction: "addNote"
    });

    const session = state.sessions[0];
    expect(session.askBarContext.items.map(({ kind }) => kind)).toEqual([
      "sourceAnchor",
      "learningGoal",
      "sessionContext",
      "source"
    ]);
    expect(session.askBarContext.includedIds).toEqual([
      `source-anchor:${session.sourceAnchors[0].id}`,
      "learning-goal"
    ]);

    state = await application.submit({
      type: "setAskBarContextItem",
      contextId: "learning-goal",
      included: false
    });
    state = await application.submit({
      type: "setAskBarContextItem",
      contextId: `source:${sourceId}`,
      included: true
    });
    state = await application.submit({
      type: "submitQuestion",
      text: "Where is Hausdorff used?"
    });

    const questionCard = state.sessions[0].questionCards[0];
    expect(questionCard).toMatchObject({
      question: "Where is Hausdorff used?",
      currentRevision: {
        status: "streaming",
        contextUsed: [
          expect.objectContaining({ kind: "sourceAnchor", identity: "compact subset" }),
          expect.objectContaining({
            kind: "source",
            identity: "Typed mathematics",
            location: "Supplied bounded source excerpt at characters 0–52"
          }),
          expect.objectContaining({ typeLabel: "Session Access Policy", identity: "Focused Access" })
        ]
      },
      revisions: []
    });
    expect(runtime.teachingRequests.at(-1)).toMatchObject({
      mathematics: "Where is Hausdorff used?",
      questionContext: [
        expect.objectContaining({ kind: "sourceAnchor", identity: "compact subset" }),
        expect.objectContaining({ kind: "source", identity: "Typed mathematics" })
      ]
    });
    expect(runtime.teachingRequests.at(-1)?.sourceContext.map(({ sourceId: id }) => id)).toEqual([sourceId]);

    runtime.emitTeaching("Hausdorffness separates the outside point from each point of the compact set.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({
      type: "submitQuestion",
      text: "Make the neighbourhood choice explicit."
    });

    expect(state.sessions[0].questionCards).toHaveLength(1);
    expect(state.sessions[0].questionCards[0]).toMatchObject({
      question: "Make the neighbourhood choice explicit.",
      currentRevision: { status: "streaming" },
      revisions: [{
        question: "Where is Hausdorff used?",
        status: "completed",
        content: "Hausdorffness separates the outside point from each point of the compact set."
      }]
    });
    expect(runtime.teachingRequests.at(-1)?.questionRevision).toEqual({
      previousQuestion: "Where is Hausdorff used?",
      previousContent: "Hausdorffness separates the outside point from each point of the compact set."
    });
    runtime.failTeaching(new ModelAccessError("network", "Network connection is unavailable."));
    await application.waitForModelWork();
    state = await application.submit({ type: "refreshAuthentication" });
    await application.submit({ type: "retryQuestionCard", cardId: state.sessions[0].questionCards[0].id });
    expect(runtime.teachingRequests.at(-1)?.questionRevision).toEqual({
      previousQuestion: "Where is Hausdorff used?",
      previousContent: "Hausdorffness separates the outside point from each point of the compact set."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
    expect(application.getState().sessions[0].trailDraft.items.some(
      (item) => item.curationKey === `question-card:${questionCard.id}`
    )).toBe(false);
    expect(application.getState().sessions[0].questionCards[0].currentRevision.contextUsed).toEqual(expect.arrayContaining([
      expect.objectContaining({ typeLabel: "Previous Question Card question", identity: "Where is Hausdorff used?" }),
      expect.objectContaining({ typeLabel: "Previous Question Card answer", preview: "Hausdorffness separates the outside point from each point of the compact set." }),
      expect.objectContaining({ typeLabel: "Session Access Policy", identity: "Focused Access" })
    ]));

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].questionCards[0].revisions).toHaveLength(1);
  });

  it("supplies only selected Ask Bar excerpts within the active Session Access Policy", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Locate the separation step",
      initialTeachingDirection: "Use the selected phrase",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({
      type: "createSourceAnchor",
      sourceId: state.sessions[0].sourceIds[0],
      selection: {
        kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset",
        prefix: "Every ", suffix: " of a Hausdorff space is closed."
      },
      paletteAction: "addNote"
    });

    await expect(application.submit({
      type: "setAskBarContextItem",
      contextId: "source:outside-active-policy",
      included: true
    })).rejects.toThrow("context available to this Learning Session");
    await application.submit({ type: "submitQuestion", text: "Why is compactness enough?" });

    expect(runtime.teachingRequests.at(-1)?.sourceContext).toEqual([{
      sourceId: state.sessions[0].sourceIds[0],
      name: "Typed mathematics",
      mediaType: "text/plain",
      content: "compact subset"
    }]);
    expect(runtime.teachingRequests.at(-1)?.questionContext).toEqual([
      expect.objectContaining({ kind: "sourceAnchor", preview: "compact subset" }),
      expect.objectContaining({ kind: "learningGoal", identity: "Understand compactness" })
    ]);
    runtime.completeTeaching();
    await application.waitForModelWork();
  });

  it("makes an activated Anchor Marker the Ask Bar's primary context", async () => {
    const { application } = await launch();
    let state = await application.submit({
      type: "startQuickStudy",
      mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    const sourceId = state.sessions[0].sourceIds[0];
    for (const selection of [
      { startOffset: 6, endOffset: 20, exactText: "compact subset", prefix: "Every ", suffix: " of a Hausdorff space is closed." },
      { startOffset: 26, endOffset: 41, exactText: "Hausdorff space", prefix: "Every compact subset of a ", suffix: " is closed." }
    ]) {
      state = await application.submit({
        type: "createSourceAnchor",
        sourceId,
        selection: { kind: "text", ...selection },
        paletteAction: "addNote"
      });
    }
    const [firstAnchor, secondAnchor] = state.sessions[0].sourceAnchors;
    expect(state.sessions[0].askBarContext.includedIds[0]).toBe(`source-anchor:${secondAnchor.id}`);

    state = await application.submit({ type: "activateSourceAnchor", sourceAnchorId: firstAnchor.id });

    expect(state.sessions[0].activeSourceAnchorId).toBe(firstAnchor.id);
    expect(state.sessions[0].askBarContext.includedIds[0]).toBe(`source-anchor:${firstAnchor.id}`);
  });

  it("preserves historical Question Card receipts when access is later restricted", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Use the notes", initialTeachingDirection: "Read the theorem",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.contentBySourceName.set("topology.txt", "Every compact subset of a Hausdorff space is closed.");
    const { application, dataDirectory } = await launchWithRuntimeAndSourceAccess(runtime, sourceAccess);
    let state = await application.submit({ type: "createWorkspace", name: "Topology" });
    const workspaceId = state.navigation.workspaceId;
    state = await application.submit({ type: "createMission", workspaceId, name: "Compactness" });
    const missionId = state.navigation.missionId!;
    state = await application.linkExternalAttachment(workspaceId, {
      name: "topology.txt", resourceType: "file", lastKnownPath: "/Users/learner/topology.txt",
      canonicalPath: "/Users/learner/topology.txt", accessGrant: null, fingerprint: { size: 52, modifiedAtMs: 1234 }
    });
    const workspaceSourceId = state.workspaces.find((workspace) => workspace.id === workspaceId)!.context.sourceIds[0];
    state = await application.submit({
      type: "submitSessionIntake", mathematics: "Where is Hausdorff used?", location: { workspaceId, missionId }
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "setAskBarContextItem", contextId: `source:${workspaceSourceId}`, included: true });
    await application.submit({ type: "submitQuestion", text: "Use the linked theorem statement." });
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({ type: "selectSessionAccessPolicy", policy: "focused" });
    expect(state.sessions[0].questionCards[0].currentRevision.contextUsed).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: workspaceSourceId })
    ]));
    await application.submit({ type: "leaveSession" });

    const relaunched = await LearningApplication.launch(dataDirectory, null, sourceAccess);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].questionCards[0].currentRevision.contextUsed).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: workspaceSourceId })
    ]));
  });

  it("revises one anchored Teaching Card coherently and restores an earlier revision", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain the selected claim",
      initialTeachingDirection: "Start from the definition",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const started = await application.submit({ type: "submitSessionIntake", mathematics: "Every compact set is closed." });
    runtime.completeTeaching();
    await application.waitForModelWork();
    const sourceId = started.sessions[0].sourceIds[0];
    const withCard = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text", startOffset: 6, endOffset: 13, exactText: "compact", prefix: "Every ", suffix: " set is closed."
      },
      paletteAction: "explain"
    });
    runtime.emitTeaching("Compactness gives a finite subcover.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    const original = application.getState().sessions[0].anchoredTeachingCards[0].currentRevision;
    const cardId = withCard.sessions[0].anchoredTeachingCards[0].id;

    const revising = await application.submit({
      type: "reviseTeachingCard",
      cardId,
      instruction: "Make the separation argument explicit."
    });
    expect(revising.sessions[0].anchoredTeachingCards[0]).toMatchObject({
      revisions: [{ id: original.id, content: "Compactness gives a finite subcover." }],
      currentRevision: { instruction: "Make the separation argument explicit.", status: "streaming", content: "" }
    });
    expect(runtime.teachingRequests.at(-1)?.focus).toMatchObject({
      instruction: "Make the separation argument explicit.",
      previousContent: "Compactness gives a finite subcover."
    });

    runtime.emitTeaching("Separate each outside point, then use a finite subcover of the compact set.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    const revised = application.getState().sessions[0].anchoredTeachingCards[0].currentRevision;

    const restored = await application.submit({
      type: "restoreTeachingCardRevision",
      cardId,
      revisionId: original.id
    });
    expect(restored.sessions[0].anchoredTeachingCards[0]).toMatchObject({
      currentRevision: { id: original.id, content: "Compactness gives a finite subcover." },
      revisions: [{ id: revised.id, content: "Separate each outside point, then use a finite subcover of the compact set." }]
    });
  });

  it("retains a named Teaching Variant and pins substantial anchored output as a Learning Artifact", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Compare proof routes",
      initialTeachingDirection: "Begin with open covers",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const started = await application.submit({ type: "submitSessionIntake", mathematics: "Every compact set is closed." });
    runtime.completeTeaching();
    await application.waitForModelWork();
    const sourceId = started.sessions[0].sourceIds[0];
    const withCard = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text", startOffset: 6, endOffset: 13, exactText: "compact", prefix: "Every ", suffix: " set is closed."
      },
      paletteAction: "explain"
    });
    runtime.emitTeaching("Use a finite subcover to prove the complement is open.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    const cardId = withCard.sessions[0].anchoredTeachingCards[0].id;
    const anchorId = withCard.sessions[0].sourceAnchors[0].id;

    const variant = await application.submit({
      type: "createTeachingVariant",
      cardId,
      name: "Closed-map route",
      instruction: "Give a genuinely different proof via projection from a compact product."
    });
    expect(variant.sessions[0].anchoredTeachingCards[0].variants).toMatchObject([{
      name: "Closed-map route",
      revision: { status: "streaming", content: "" }
    }]);
    expect(runtime.teachingRequests.at(-1)?.focus).toMatchObject({
      variantName: "Closed-map route",
      previousContent: "Use a finite subcover to prove the complement is open."
    });
    runtime.emitTeaching("Project the compact closed subset and use that the projection is closed.");
    runtime.completeTeaching();
    await application.waitForModelWork();

    const pinned = await application.submit({ type: "pinTeachingCardArtifact", cardId });
    expect(pinned.sessions[0].anchoredTeachingCards[0]).toMatchObject({ artifactId: pinned.sessions[0].learningArtifacts[0].id });
    expect(pinned.sessions[0].learningArtifacts).toMatchObject([{
      title: "Explain compact",
      currentRevision: {
        content: "Use a finite subcover to prove the complement is open.",
        claimOrigin: "modelGenerated",
        verificationLevel: "notIndependentlyChecked",
        verificationCurrency: "current"
      },
      revisions: [],
      sourceAnchorIds: [anchorId],
      pinned: true
    }]);
    expect(pinned.sessions[0].anchoredTeachingCards[0].variants[0].revision.content).toBe(
      "Project the compact closed subset and use that the projection is closed."
    );

    const originalArtifactRevisionId = pinned.sessions[0].learningArtifacts[0].currentRevision.id;
    const edited = await application.submit({
      type: "editLearningArtifact",
      artifactId: pinned.sessions[0].learningArtifacts[0].id,
      content: "Learner-edited finite-subcover proof."
    });
    expect(edited.sessions[0].learningArtifacts[0]).toMatchObject({
      currentRevision: { content: "Learner-edited finite-subcover proof.", claimOrigin: "mixed" },
      revisions: [{ id: originalArtifactRevisionId, content: "Use a finite subcover to prove the complement is open." }]
    });
    const restoredArtifact = await application.submit({
      type: "restoreLearningArtifactRevision",
      artifactId: pinned.sessions[0].learningArtifacts[0].id,
      revisionId: originalArtifactRevisionId
    });
    expect(restoredArtifact.sessions[0].learningArtifacts[0]).toMatchObject({
      currentRevision: {
        content: "Use a finite subcover to prove the complement is open.",
        provenance: { action: "restored", priorRevisionId: originalArtifactRevisionId }
      },
      revisions: [
        { id: originalArtifactRevisionId, content: "Use a finite subcover to prove the complement is open." },
        expect.objectContaining({ content: "Learner-edited finite-subcover proof." })
      ]
    });
  });

  it("checkpoints and stops the exact anchored Teaching Card revision on quit and relaunch", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain one anchor",
      initialTeachingDirection: "Start locally",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    const started = await application.submit({ type: "submitSessionIntake", mathematics: "Every compact set is closed." });
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({
      type: "createSourceAnchor",
      sourceId: started.sessions[0].sourceIds[0],
      selection: {
        kind: "text", startOffset: 6, endOffset: 13, exactText: "compact", prefix: "Every ", suffix: " set is closed."
      },
      paletteAction: "explain"
    });
    runtime.emitTeaching("Useful partial anchored explanation");

    await application.shutdown();
    expect(application.getState().sessions[0].anchoredTeachingCards[0].currentRevision).toMatchObject({
      status: "stopped",
      content: "Useful partial anchored explanation",
      retryable: true
    });
    expect(application.getState().sessions[0].teachingCard.status).toBe("completed");

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].anchoredTeachingCards[0].currentRevision).toMatchObject({
      status: "stopped",
      content: "Useful partial anchored explanation"
    });
  });

  it("retries the same failed anchored Teaching Card with its receipt and work-log link intact", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain one anchor",
      initialTeachingDirection: "Start locally",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const started = await application.submit({ type: "submitSessionIntake", mathematics: "Every compact set is closed." });
    runtime.completeTeaching();
    await application.waitForModelWork();
    const withCard = await application.submit({
      type: "createSourceAnchor",
      sourceId: started.sessions[0].sourceIds[0],
      selection: {
        kind: "text", startOffset: 6, endOffset: 13, exactText: "compact", prefix: "Every ", suffix: " set is closed."
      },
      paletteAction: "explain"
    });
    runtime.failTeaching(new Error("Anchored teaching timed out."));
    await application.waitForModelWork();
    const failed = application.getState().sessions[0].anchoredTeachingCards[0];
    expect(failed.currentRevision).toMatchObject({
      status: "failed",
      retryable: true,
      contextUsed: [
        { sourceName: "Typed mathematics", location: "Focused Text at characters 6–13" },
        { sourceName: "Typed mathematics", location: "Supplied bounded source excerpt at characters 0–28" }
      ],
      agentWorkLogReference: { sessionId: started.sessions[0].id }
    });
    const reference = failed.currentRevision.agentWorkLogReference!;
    expect(application.getAgentWorkLogEvidence(reference.sessionId, reference.fromSequence, reference.toSequence).map(
      (event) => event.type
    )).toEqual(["threadStarted", "turnStarted"]);

    const retrying = await application.submit({ type: "retryAnchoredTeachingCard", cardId: withCard.sessions[0].anchoredTeachingCards[0].id });
    expect(retrying.sessions[0].anchoredTeachingCards[0].currentRevision).toMatchObject({
      id: failed.currentRevision.id,
      status: "streaming",
      content: ""
    });
    expect(runtime.teachingRequests.at(-1)?.focus).toMatchObject({
      sourceAnchorId: withCard.sessions[0].sourceAnchors[0].id,
      instruction: "Explain or unpack this source anchor."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
  });

  it("allows Quick Study to own one Primary Folder and rejects attachments selected inside it", async () => {
    const { application } = await launch();
    const linked = await application.linkPrimaryFolder("quick-study-workspace", {
      name: "quick-notes",
      resourceType: "folder",
      lastKnownPath: "/Users/learner/quick-notes",
      canonicalPath: "/Users/learner/quick-notes",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "folder-bookmark" },
      fingerprint: { size: 64, modifiedAtMs: 1234 }
    });
    expect(linked.workspaces[0].context.primaryFolderSourceId).not.toBeNull();

    await expect(application.linkExternalAttachment("quick-study-workspace", {
      name: "inside.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/quick-notes/inside.txt",
      canonicalPath: "/Users/learner/quick-notes/inside.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "file-bookmark" },
      fingerprint: { size: 12, modifiedAtMs: 1235 }
    })).rejects.toThrow("already covered by the Primary Folder");
    await expect(application.linkExternalAttachment("quick-study-workspace", {
      name: "..notes.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/quick-notes/..notes.txt",
      canonicalPath: "/Users/learner/quick-notes/..notes.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "dot-file-bookmark" },
      fingerprint: { size: 13, modifiedAtMs: 1236 }
    })).rejects.toThrow("already covered by the Primary Folder");
    await expect(application.linkExternalAttachment("quick-study-workspace", {
      name: "notes-alias.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/Desktop/notes-alias.txt",
      canonicalPath: "/Users/learner/quick-notes/notes.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "alias-bookmark" },
      fingerprint: { size: 14, modifiedAtMs: 1237 }
    })).rejects.toThrow("already covered by the Primary Folder");

    const { application: reverseOrder } = await launch();
    await reverseOrder.linkExternalAttachment("quick-study-workspace", {
      name: "inside.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/quick-notes/inside.txt",
      canonicalPath: "/Users/learner/quick-notes/inside.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "file-bookmark" },
      fingerprint: { size: 12, modifiedAtMs: 1235 }
    });
    await expect(reverseOrder.linkPrimaryFolder("quick-study-workspace", {
      name: "quick-notes",
      resourceType: "folder",
      lastKnownPath: "/Users/learner/quick-notes",
      canonicalPath: "/Users/learner/quick-notes",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "folder-bookmark" },
      fingerprint: { size: 64, modifiedAtMs: 1234 }
    })).rejects.toThrow("External Attachment is already inside this Primary Folder");
  });

  it("reopens a Linked Source read-only and preserves its association when access fails", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    const { application } = await launchWithSourceAccess(sourceAccess);
    const created = await application.submit({ type: "createWorkspace", name: "Topology" });
    const workspaceId = created.navigation.workspaceId;
    const linked = await application.linkExternalAttachment(workspaceId, {
      name: "compactness.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/compactness.txt",
      canonicalPath: "/Users/learner/compactness.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "opaque-bookmark" },
      fingerprint: { size: 64, modifiedAtMs: 1234 }
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;

    const opened = await application.openLinkedSource(source.id);
    expect(opened).toMatchObject({
      status: "available",
      sourceId: source.id,
      content: "Every open cover has a finite subcover."
    });
    expect(sourceAccess.openedSourceIds).toEqual([source.id]);

    sourceAccess.fingerprint = { size: 65, modifiedAtMs: 4321 };
    const changed = await application.openLinkedSource(source.id);
    expect(changed).toMatchObject({ status: "available", sourceId: source.id });
    expect(application.getState().sources.find((candidate) => candidate.id === source.id)).toMatchObject({
      link: { fingerprint: { size: 65, modifiedAtMs: 4321 } }
    });
    expect(application.getState().sourceRevisions).toEqual([
      expect.objectContaining({ sourceId: source.id, fingerprint: { size: 64, modifiedAtMs: 1234 }, snapshotAssetId: null }),
      expect.objectContaining({ sourceId: source.id, fingerprint: { size: 65, modifiedAtMs: 4321 }, snapshotAssetId: null })
    ]);

    sourceAccess.error = new Error("The source is missing or access is no longer available.");
    const unavailable = await application.openLinkedSource(source.id);
    expect(unavailable).toEqual({
      status: "unavailable",
      sourceId: source.id,
      error: "The source is missing or access is no longer available."
    });
    expect(application.getState().sources.find((candidate) => candidate.id === source.id)).toMatchObject({
      id: source.id,
      link: { accessStatus: "unavailable", error: "The source is missing or access is no longer available." }
    });
    const withoutAutomaticSnapshot = await application.preserveSourceSnapshot(source.id);
    expect(withoutAutomaticSnapshot.sources.filter((candidate) => candidate.kind === "managedAsset")).toEqual([]);

  });

  it("persists a refreshed Linked Source bookmark without learner reselection", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    const { application, dataDirectory } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Topology" });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "compactness.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/old/compactness.txt",
      canonicalPath: "/Users/learner/old/compactness.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "stale-bookmark" },
      fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    sourceAccess.linkRefresh = {
      lastKnownPath: "/Users/learner/moved/compactness.txt",
      canonicalPath: "/Users/learner/moved/compactness.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "fresh-bookmark" }
    };

    await expect(application.openLinkedSource(source.id)).resolves.toMatchObject({ status: "available" });
    const relaunched = await LearningApplication.launch(dataDirectory, null, sourceAccess);
    applications.push(relaunched);
    expect(relaunched.getState().sources.find((candidate) => candidate.id === source.id)).toMatchObject({
      id: source.id,
      link: {
        lastKnownPath: "/Users/learner/moved/compactness.txt",
        canonicalPath: "/Users/learner/moved/compactness.txt",
        accessGrant: { kind: "securityScopedBookmark", bookmarkData: "fresh-bookmark" }
      }
    });
  });

  it("locates a missing Linked Source again without replacing its identity or Learning Session associations", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    const { application, dataDirectory } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Topology" });
    const mission = await application.submit({
      type: "createMission",
      workspaceId: workspace.navigation.workspaceId,
      name: "Compactness"
    });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "compactness.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/missing/compactness.txt",
      canonicalPath: "/Users/learner/missing/compactness.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "failed-bookmark" },
      fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    await application.submit({
      type: "startQuickStudy",
      mathematics: "Study compactness.",
      location: { workspaceId: workspace.navigation.workspaceId, missionId: mission.navigation.missionId! }
    });
    await application.submit({ type: "addSourceToSession", sourceId: source.id });
    sourceAccess.error = new Error("The source is missing or access is no longer available.");
    await application.openLinkedSource(source.id);
    sourceAccess.error = null;

    const recovered = await application.relocateLinkedSource(source.id, {
      name: "compactness-restored.txt",
      resourceType: "file",
      lastKnownPath: "/Volumes/Archive/compactness-restored.txt",
      canonicalPath: "/Volumes/Archive/compactness-restored.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "replacement-bookmark" },
      fingerprint: sourceAccess.fingerprint
    });

    expect(recovered.sources.find((candidate) => candidate.id === source.id)).toMatchObject({
      id: source.id,
      name: "compactness-restored.txt",
      link: {
        accessStatus: "available",
        lastKnownPath: "/Volumes/Archive/compactness-restored.txt",
        accessGrant: { kind: "securityScopedBookmark", bookmarkData: "replacement-bookmark" }
      }
    });
    expect(recovered.sessions[0].sourceIds).toContain(source.id);
    const relaunched = await LearningApplication.launch(dataDirectory, null, sourceAccess);
    applications.push(relaunched);
    await expect(relaunched.openLinkedSource(source.id)).resolves.toMatchObject({ status: "available", sourceId: source.id });
    expect(relaunched.getState().sessions[0].sourceIds).toContain(source.id);
  });

  it("creates a visible Source Revision, rebuilds its Source Index, and never snapshots a change automatically", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.indexBySourceName.set("lemma.txt", textExtraction("Old lemma statement."));
    const { application } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Algebra" });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "lemma.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/lemma.txt",
      canonicalPath: "/Users/learner/lemma.txt",
      accessGrant: null,
      fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    await application.indexSource(source.id);
    sourceAccess.fingerprint = { size: 72, modifiedAtMs: 5678 };
    sourceAccess.contentBySourceName.set("lemma.txt", "New lemma statement.");
    sourceAccess.indexBySourceName.set("lemma.txt", textExtraction("New lemma statement."));

    await expect(application.openLinkedSource(source.id)).resolves.toMatchObject({ status: "available" });

    const state = application.getState();
    expect(state.sourceRevisions.filter((revision) => revision.sourceId === source.id)).toEqual([
      expect.objectContaining({ fingerprint: { size: 64, modifiedAtMs: 1234 }, snapshotAssetId: null }),
      expect.objectContaining({ fingerprint: { size: 72, modifiedAtMs: 5678 }, snapshotAssetId: null })
    ]);
    expect(state.sourceIndexes).toContainEqual(expect.objectContaining({ sourceId: source.id, status: "ready" }));
    await expect(application.searchSourceIndex(workspace.navigation.workspaceId, "New lemma")).resolves.toHaveLength(1);
    expect(state.sources.filter((candidate) => candidate.kind === "managedAsset")).toEqual([]);
  });

  it("automatically re-anchors a uniquely context-matching text location onto a changed Source Revision", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    const original = "Every compact subset of a Hausdorff space is closed.";
    sourceAccess.contentBySourceName.set("proof.txt", original);
    sourceAccess.indexBySourceName.set("proof.txt", textExtraction(original));
    const { application } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Topology" });
    const mission = await application.submit({
      type: "createMission", workspaceId: workspace.navigation.workspaceId, name: "Separation axioms"
    });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "proof.txt", resourceType: "file", lastKnownPath: "/Users/learner/proof.txt",
      canonicalPath: "/Users/learner/proof.txt", accessGrant: null, fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    await application.submit({
      type: "startQuickStudy", mathematics: "Study the compactness argument.",
      location: { workspaceId: workspace.navigation.workspaceId, missionId: mission.navigation.missionId! }
    });
    await application.submit({ type: "addSourceToSession", sourceId: source.id });
    const anchored = await application.submit({
      type: "createSourceAnchor", sourceId: source.id,
      selection: {
        kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset",
        prefix: "Every ", suffix: " of a Hausdorff space is closed."
      },
      paletteAction: "addNote"
    });
    const oldRevisionId = source.link.currentRevisionId;
    const anchorId = anchored.sessions[0].sourceAnchors[0].id;
    const revised = "Recall: Every compact subset of a Hausdorff space is closed.";
    sourceAccess.fingerprint = { size: 72, modifiedAtMs: 5678 };
    sourceAccess.contentBySourceName.set("proof.txt", revised);
    sourceAccess.indexBySourceName.set("proof.txt", textExtraction(revised));

    await application.openLinkedSource(source.id);

    const state = application.getState();
    const currentRevisionId = state.sources.find(
      (candidate): candidate is LinkedSource => candidate.id === source.id && candidate.kind === "linkedSource"
    )!.link.currentRevisionId;
    expect(state.sessions[0].sourceAnchors).toContainEqual(expect.objectContaining({
      id: anchorId,
      sourceRevisionId: currentRevisionId,
      selection: expect.objectContaining({ startOffset: 14, endOffset: 28, exactText: "compact subset" })
    }));
    expect(state.reanchoringDecisions).toContainEqual(expect.objectContaining({
      sourceAnchorId: anchorId,
      fromRevisionId: oldRevisionId,
      toRevisionId: currentRevisionId,
      status: "automatic"
    }));
  });

  it("keeps uncertain and missing matches unresolved until the learner confirms a replacement, across relaunch", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    const original = "Alpha theorem. Beta lemma. Gamma claim.";
    sourceAccess.contentBySourceName.set("notes.txt", original);
    sourceAccess.indexBySourceName.set("notes.txt", textExtraction(original));
    const { application, dataDirectory } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Algebra" });
    const mission = await application.submit({
      type: "createMission", workspaceId: workspace.navigation.workspaceId, name: "Core lemmas"
    });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "notes.txt", resourceType: "file", lastKnownPath: "/Users/learner/notes.txt",
      canonicalPath: "/Users/learner/notes.txt", accessGrant: null, fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    await application.submit({
      type: "startQuickStudy", mathematics: "Review the lemmas.",
      location: { workspaceId: workspace.navigation.workspaceId, missionId: mission.navigation.missionId! }
    });
    await application.submit({ type: "addSourceToSession", sourceId: source.id });
    let state = await application.submit({
      type: "createSourceAnchor", sourceId: source.id,
      selection: {
        kind: "text", startOffset: 15, endOffset: 25, exactText: "Beta lemma",
        prefix: "Alpha theorem. ", suffix: ". Gamma claim."
      },
      paletteAction: "question"
    });
    const uncertainAnchorId = state.sessions[0].activeSourceAnchorId!;
    state = await application.submit({
      type: "createAnnotation", sourceAnchorId: uncertainAnchorId, purpose: "personalNote", content: "Check this step."
    });
    state = await application.submit({
      type: "createSourceAnchor", sourceId: source.id,
      selection: {
        kind: "text", startOffset: 27, endOffset: 38, exactText: "Gamma claim",
        prefix: "Beta lemma. ", suffix: "."
      },
      paletteAction: "addToLearningTrail"
    });
    const missingAnchorId = state.sessions[0].activeSourceAnchorId!;
    const revised = "Alpha theorem changed. Beta lemma. Delta claim.";
    sourceAccess.fingerprint = { size: 80, modifiedAtMs: 6789 };
    sourceAccess.contentBySourceName.set("notes.txt", revised);
    sourceAccess.indexBySourceName.set("notes.txt", textExtraction(revised));

    await application.openLinkedSource(source.id);

    state = application.getState();
    const uncertain = state.reanchoringDecisions.find((decision) => decision.sourceAnchorId === uncertainAnchorId)!;
    const missing = state.reanchoringDecisions.find((decision) => decision.sourceAnchorId === missingAnchorId)!;
    expect(uncertain).toMatchObject({ status: "unresolved", proposedSelection: { exactText: "Beta lemma" } });
    expect(missing).toMatchObject({ status: "unresolved", proposedSelection: null });
    expect(state.sessions[0].sourceAnchors.find((anchor) => anchor.id === uncertainAnchorId)).toMatchObject({
      sourceRevisionId: uncertain.fromRevisionId,
      selection: { startOffset: 15, endOffset: 25 }
    });
    state = await application.submit({ type: "activateSourceAnchor", sourceAnchorId: uncertainAnchorId });
    expect(state.sessions[0].askBarContext.items.some((item) => item.sourceAnchorId === uncertainAnchorId)).toBe(false);
    state = await application.submit({
      type: "resolveReanchoring", decisionId: missing.id, resolution: "leaveUnresolved"
    });
    expect(state.reanchoringDecisions.find((decision) => decision.id === missing.id)?.status).toBe("leftUnresolved");
    const unresolvedRelaunch = await LearningApplication.launch(dataDirectory, null, sourceAccess);
    applications.push(unresolvedRelaunch);
    expect(unresolvedRelaunch.getState().reanchoringDecisions.find(
      (decision) => decision.id === missing.id
    )?.status).toBe("leftUnresolved");

    state = await application.submit({
      type: "resolveReanchoring", decisionId: uncertain.id, resolution: "acceptProposal"
    });
    state = await application.submit({
      type: "resolveReanchoring", decisionId: missing.id, resolution: "selectReplacement",
      selection: {
        kind: "text", startOffset: 35, endOffset: 46, exactText: "Delta claim",
        prefix: "Beta lemma. ", suffix: "."
      }
    });
    expect(state.reanchoringDecisions.filter((decision) => [uncertain.id, missing.id].includes(decision.id)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: uncertain.id, status: "learnerConfirmed" }),
        expect.objectContaining({ id: missing.id, status: "learnerConfirmed" })
      ]));
    expect(state.sessions[0].annotations).toContainEqual(expect.objectContaining({ sourceAnchorId: uncertainAnchorId }));
    expect(state.sessions[0].trailDraft.items).toContainEqual(expect.objectContaining({
      links: expect.objectContaining({ sourceAnchorIds: [missingAnchorId] })
    }));
    state = await application.submit({ type: "activateSourceAnchor", sourceAnchorId: uncertainAnchorId });
    expect(state.sessions[0].askBarContext.items).toContainEqual(expect.objectContaining({
      kind: "sourceAnchor", sourceAnchorId: uncertainAnchorId, preview: "Beta lemma"
    }));

    const relaunched = await LearningApplication.launch(dataDirectory, null, sourceAccess);
    applications.push(relaunched);
    expect(relaunched.getState().reanchoringDecisions.filter(
      (decision) => [uncertain.id, missing.id].includes(decision.id)
    ).every((decision) => decision.status === "learnerConfirmed")).toBe(true);
  });

  it("migrates a legacy anchor with ambiguous Source Revision provenance into unresolved review", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    const original = "Every compact subset is closed.";
    sourceAccess.contentBySourceName.set("legacy.txt", original);
    sourceAccess.indexBySourceName.set("legacy.txt", textExtraction(original));
    const { application, dataDirectory } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Topology" });
    const mission = await application.submit({
      type: "createMission", workspaceId: workspace.navigation.workspaceId, name: "Legacy notes"
    });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "legacy.txt", resourceType: "file", lastKnownPath: "/Users/learner/legacy.txt",
      canonicalPath: "/Users/learner/legacy.txt", accessGrant: null, fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    await application.submit({
      type: "startQuickStudy", mathematics: "Review legacy notes.",
      location: { workspaceId: workspace.navigation.workspaceId, missionId: mission.navigation.missionId! }
    });
    await application.submit({ type: "addSourceToSession", sourceId: source.id });
    await application.submit({
      type: "createSourceAnchor", sourceId: source.id,
      selection: {
        kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset",
        prefix: "Every ", suffix: " is closed."
      },
      paletteAction: "addNote"
    });
    sourceAccess.fingerprint = { size: 72, modifiedAtMs: 5678 };
    sourceAccess.contentBySourceName.set("legacy.txt", "Recall: Every compact subset is closed.");
    sourceAccess.indexBySourceName.set("legacy.txt", textExtraction("Recall: Every compact subset is closed."));
    await application.openLinkedSource(source.id);
    await application.waitForModelWork();
    const statePath = join(dataDirectory, "learning-application.json");
    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    delete persisted.sessions[0].sourceAnchors[0].sourceRevisionId;
    delete persisted.reanchoringDecisions;
    await writeFile(statePath, JSON.stringify(persisted), "utf8");

    const migrated = await LearningApplication.launch(dataDirectory, null, sourceAccess);
    applications.push(migrated);
    expect(migrated.getState().sessions[0].sourceAnchors[0].sourceRevisionId).toBeNull();
    expect(migrated.getState().reanchoringDecisions).toContainEqual(expect.objectContaining({
      sourceAnchorId: migrated.getState().sessions[0].sourceAnchors[0].id,
      fromRevisionId: null,
      toRevisionId: migrated.getState().sources.find(
        (candidate): candidate is LinkedSource => candidate.id === source.id && candidate.kind === "linkedSource"
      )!.link.currentRevisionId,
      status: "unresolved"
    }));
  });

  it("serializes automatic and learner-requested Source Index rebuilds", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.indexBySourceName.set("lemma.txt", textExtraction("Revised lemma."));
    const { application } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Algebra" });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "lemma.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/lemma.txt",
      canonicalPath: "/Users/learner/lemma.txt",
      accessGrant: null,
      fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    sourceAccess.fingerprint = { size: 72, modifiedAtMs: 5678 };
    let releaseExtraction!: () => void;
    sourceAccess.indexGate = new Promise((resolve) => { releaseExtraction = resolve; });

    const automatic = application.openLinkedSource(source.id);
    await vi.waitFor(() => expect(sourceAccess.activeIndexExtractions).toBe(1));
    const requested = application.rebuildSourceIndex(source.id);
    await Promise.resolve();

    expect(sourceAccess.activeIndexExtractions).toBe(1);
    expect(sourceAccess.maxConcurrentIndexExtractions).toBe(1);
    releaseExtraction();
    await Promise.all([automatic, requested]);
    expect(sourceAccess.maxConcurrentIndexExtractions).toBe(1);
  });

  it("preserves only the current Source Revision as an explicit Source Snapshot", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.snapshotContent = "Exact learner-requested revision.";
    const { application, dataDirectory } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Analysis" });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "proof.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/proof.txt",
      canonicalPath: "/Users/learner/proof.txt",
      accessGrant: null,
      fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    const revisionId = source.link.currentRevisionId;
    sourceAccess.snapshotLinkRefresh = {
      lastKnownPath: "/Users/learner/moved/proof.txt",
      canonicalPath: "/Users/learner/moved/proof.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "snapshot-bookmark" }
    };

    const snapshotted = await application.preserveSourceSnapshot(source.id);

    const revision = snapshotted.sourceRevisions.find((candidate) => candidate.id === revisionId)!;
    const snapshot = snapshotted.sources.find((candidate) => candidate.id === revision.snapshotAssetId)!;
    expect(snapshot).toMatchObject({
      kind: "managedAsset",
      name: "proof.txt — Source Snapshot",
      mediaType: "text/plain",
      content: Buffer.from("Exact learner-requested revision.").toString("base64"),
      sourceSnapshot: { linkedSourceId: source.id, sourceRevisionId: revisionId, encoding: "base64" }
    });
    expect(sourceAccess.snapshotSourceIds).toEqual([source.id]);
    const relaunched = await LearningApplication.launch(dataDirectory, null, sourceAccess);
    applications.push(relaunched);
    expect(relaunched.getState().sourceRevisions.find((candidate) => candidate.id === revisionId)?.snapshotAssetId)
      .toBe(snapshot.id);
    expect(relaunched.getState().sources.find((candidate) => candidate.id === source.id)).toMatchObject({
      link: {
        lastKnownPath: "/Users/learner/moved/proof.txt",
        accessGrant: { kind: "securityScopedBookmark", bookmarkData: "snapshot-bookmark" }
      }
    });
  });

  it("ties a rebuilt Source Index to the stable fingerprint returned by extraction", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.indexBySourceName.set("lemma.txt", textExtraction("Revised lemma."));
    sourceAccess.indexFingerprint = { size: 80, modifiedAtMs: 6789 };
    const { application } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Algebra" });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "lemma.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/lemma.txt",
      canonicalPath: "/Users/learner/lemma.txt",
      accessGrant: null,
      fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;

    const indexed = await application.indexSource(source.id);

    expect(indexed.sources.find((candidate) => candidate.id === source.id)).toMatchObject({
      link: { fingerprint: { size: 80, modifiedAtMs: 6789 } }
    });
    expect(indexed.sourceRevisions.filter((revision) => revision.sourceId === source.id)).toHaveLength(2);
    expect(indexed.sourceIndexes).toContainEqual(expect.objectContaining({ sourceId: source.id, status: "ready" }));
  });

  it("returns a Source Layer bound to the final Source Revision after rebuilding", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.indexBySourceName.set("lemma.txt", textExtraction("Final lemma."));
    const { application } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Algebra" });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "lemma.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/lemma.txt",
      canonicalPath: "/Users/learner/lemma.txt",
      accessGrant: null,
      fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    sourceAccess.fingerprint = { size: 72, modifiedAtMs: 5678 };
    sourceAccess.indexFingerprint = { size: 80, modifiedAtMs: 6789 };

    const opened = await application.openLinkedSource(source.id);

    expect(opened).toMatchObject({ status: "available", fingerprint: { size: 80, modifiedAtMs: 6789 } });
    expect(application.getState().sources.find((candidate) => candidate.id === source.id)).toMatchObject({
      link: { fingerprint: { size: 80, modifiedAtMs: 6789 } }
    });
  });

  it("serializes concurrent requests to preserve one Source Revision", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    const { application } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Analysis" });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "proof.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/proof.txt",
      canonicalPath: "/Users/learner/proof.txt",
      accessGrant: null,
      fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    let releaseSnapshot!: () => void;
    sourceAccess.snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });

    const first = application.preserveSourceSnapshot(source.id);
    await vi.waitFor(() => expect(sourceAccess.activeSnapshots).toBe(1));
    const second = application.preserveSourceSnapshot(source.id);
    await Promise.resolve();
    expect(sourceAccess.activeSnapshots).toBe(1);
    releaseSnapshot();
    const [, state] = await Promise.all([first, second]);

    expect(sourceAccess.snapshotSourceIds).toEqual([source.id]);
    expect(state.sources.filter((candidate) => candidate.kind === "managedAsset")).toHaveLength(1);
  });

  it("indexes, searches, clears, and rebuilds source content without disturbing anchors or canonical records", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.contentBySourceName.set(
      "compactness.txt",
      "Every open cover has a finite subcover. Therefore $K$ is compact."
    );
    sourceAccess.indexBySourceName.set("compactness.txt", {
      extractionMethod: "embeddedText",
      pages: [{
        pageNumber: 1,
        width: 1000,
        height: 1400,
        thumbnailDataUrl: "data:image/png;base64,c21hbGwtdGh1bWJuYWls",
        regions: [
          {
            kind: "text",
            text: "Every open cover has a finite subcover.",
            bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.05 },
            sourceStartOffset: 0,
            sourceEndOffset: 40
          },
          {
            kind: "equation",
            text: "$K$",
            bounds: { x: 0.52, y: 0.16, width: 0.05, height: 0.04 },
            sourceStartOffset: 51,
            sourceEndOffset: 54
          }
        ]
      }]
    });
    const { application, dataDirectory } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Topology" });
    const workspaceId = workspace.navigation.workspaceId;
    const mission = await application.submit({ type: "createMission", workspaceId, name: "Compactness" });
    const linked = await application.linkExternalAttachment(workspaceId, {
      name: "compactness.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/compactness.txt",
      canonicalPath: "/Users/learner/compactness.txt",
      accessGrant: null,
      fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    const started = await application.submit({
      type: "startQuickStudy",
      mathematics: "Study compactness.",
      location: { workspaceId, missionId: mission.navigation.missionId! }
    });
    await application.submit({ type: "addSourceToSession", sourceId: source.id });
    await application.submit({
      type: "createSourceAnchor",
      sourceId: source.id,
      selection: {
        kind: "text",
        startOffset: 0,
        endOffset: 16,
        exactText: "Every open cover",
        prefix: "",
        suffix: " has a finite subcover."
      },
      paletteAction: "explain"
    });
    const anchored = application.getState().sessions[0].sourceAnchors;

    const indexed = await application.indexSource(source.id);
    expect(indexed.sourceIndexes).toContainEqual(expect.objectContaining({
      sourceId: source.id,
      status: "ready",
      extractionMethod: "embeddedText",
      pageCount: 1,
      equationCount: 1
    }));
    const persistedIndex = await readFile(join(dataDirectory, "source-index.json"), "utf8");
    expect(persistedIndex).not.toContain("Every open cover");
    expect(persistedIndex).not.toContain("finite subcover");
    const [result] = await application.searchSourceIndex(workspaceId, "finite subcover");
    expect(result).toMatchObject({
      sourceId: source.id,
      sourceName: "compactness.txt",
      workspaceName: "Topology",
      locationLabel: "Page 1",
      preview: "Every open cover has a finite subcover.",
      match: { pageNumber: 1, sourceStartOffset: 0, sourceEndOffset: 40 }
    });
    const opened = await application.openSourceSearchResult(result.id);
    expect(opened).toMatchObject({
      status: "available",
      sourceId: source.id,
      content: "Every open cover has a finite subcover. Therefore $K$ is compact.",
      highlight: {
        pageNumber: 1,
        exactText: "Every open cover has a finite subcover.",
        bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.05 }
      }
    });

    const cleared = await application.clearSourceIndex(source.id);
    expect(cleared.sourceIndexes).toContainEqual(expect.objectContaining({ sourceId: source.id, status: "cleared" }));
    await expect(application.searchSourceIndex(workspaceId, "finite subcover")).resolves.toEqual([]);
    expect(cleared.sources).toEqual(indexed.sources);
    expect(cleared.sessions[0].sourceAnchors).toEqual(anchored);

    const relaunched = await LearningApplication.launch(dataDirectory, null, sourceAccess);
    applications.push(relaunched);
    expect(relaunched.getState().sourceIndexes).toContainEqual(expect.objectContaining({ sourceId: source.id, status: "cleared" }));
    const rebuilt = await relaunched.rebuildSourceIndex(source.id);
    expect(rebuilt.sourceIndexes).toContainEqual(expect.objectContaining({ sourceId: source.id, status: "ready" }));
    await expect(relaunched.searchSourceIndex(workspaceId, "finite subcover")).resolves.toHaveLength(1);
    expect(relaunched.getState().sessions[0].sourceAnchors).toEqual(anchored);
    expect(sourceAccess.indexedSourceIds.filter((id) => id === source.id).length).toBeGreaterThanOrEqual(4);
    expect(started.sessions[0].sourceAnchors).toEqual([]);
  });

  it("records OCR-backed index metadata while refusing to rebuild from an unavailable original", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.contentBySourceName.set("handwritten-proof.png", "data:image/png;base64,cHJvb2Y=");
    sourceAccess.mediaTypeBySourceName.set("handwritten-proof.png", "image/png");
    sourceAccess.indexBySourceName.set("handwritten-proof.png", {
      extractionMethod: "ocr",
      pages: [{
        pageNumber: 1,
        width: 800,
        height: 600,
        thumbnailDataUrl: "data:image/png;base64,c21hbGw=",
        regions: [{
          kind: "text",
          text: "Assume the sequence is Cauchy",
          bounds: { x: 0.08, y: 0.12, width: 0.7, height: 0.08 }
        }]
      }]
    });
    const { application } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Analysis" });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "handwritten-proof.png",
      resourceType: "file",
      lastKnownPath: "/Users/learner/handwritten-proof.png",
      canonicalPath: "/Users/learner/handwritten-proof.png",
      accessGrant: null,
      fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;

    const indexed = await application.indexSource(source.id);
    expect(indexed.sourceIndexes).toContainEqual(expect.objectContaining({
      sourceId: source.id,
      status: "ready",
      extractionMethod: "ocr"
    }));
    const [ocrResult] = await application.searchSourceIndex(workspace.navigation.workspaceId, "sequence Cauchy");
    expect(ocrResult).toBeDefined();
    await expect(application.openSourceSearchResult(ocrResult.id)).resolves.toMatchObject({
      status: "available",
      highlight: {
        pageNumber: 1,
        exactText: "Assume the sequence is Cauchy",
        thumbnailDataUrl: "data:image/png;base64,c21hbGw=",
        bounds: { x: 0.08, y: 0.12, width: 0.7, height: 0.08 }
      }
    });

    await application.clearSourceIndex(source.id);
    sourceAccess.error = new Error("The source is missing or access is no longer available.");
    const unavailable = await application.rebuildSourceIndex(source.id);
    expect(unavailable.sourceIndexes).toContainEqual(expect.objectContaining({
      sourceId: source.id,
      status: "unavailable",
      error: "The source is missing or access is no longer available."
    }));
    await expect(application.searchSourceIndex(workspace.navigation.workspaceId, "sequence Cauchy")).resolves.toEqual([]);
    await expect(application.openSourceSearchResult("missing-result")).rejects.toThrow("Search this Source Index again");
  });

  it("restores a ready Source Index and discards a corrupt derived cache without blocking launch", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.contentBySourceName.set("lemma.txt", "Every finite subgroup is compact.");
    sourceAccess.indexBySourceName.set("lemma.txt", {
      extractionMethod: "embeddedText",
      pages: [{
        pageNumber: 1,
        width: 1000,
        height: 1400,
        thumbnailDataUrl: "data:image/png;base64,c21hbGw=",
        regions: [{
          kind: "text",
          text: "Every finite subgroup is compact.",
          bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.05 },
          sourceStartOffset: 0,
          sourceEndOffset: 33
        }]
      }]
    });
    const { application, dataDirectory } = await launchWithSourceAccess(sourceAccess);
    const workspace = await application.submit({ type: "createWorkspace", name: "Topology" });
    const linked = await application.linkExternalAttachment(workspace.navigation.workspaceId, {
      name: "lemma.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/lemma.txt",
      canonicalPath: "/Users/learner/lemma.txt",
      accessGrant: null,
      fingerprint: sourceAccess.fingerprint
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;
    await application.indexSource(source.id);

    const readyRelaunch = await LearningApplication.launch(dataDirectory, null, sourceAccess);
    applications.push(readyRelaunch);
    expect(readyRelaunch.getState().sourceIndexes).toContainEqual(expect.objectContaining({ sourceId: source.id, status: "ready" }));
    await expect(readyRelaunch.searchSourceIndex(workspace.navigation.workspaceId, "finite subgroup")).resolves.toHaveLength(1);

    await writeFile(join(dataDirectory, "source-index.json"), "{corrupt", "utf8");
    const recovered = await LearningApplication.launch(dataDirectory, null, sourceAccess);
    applications.push(recovered);
    expect(recovered.getState().sourceIndexes).toContainEqual(expect.objectContaining({ sourceId: source.id, status: "cleared" }));
    await expect(recovered.searchSourceIndex(workspace.navigation.workspaceId, "finite subgroup")).resolves.toEqual([]);
    expect(JSON.parse(await readFile(join(dataDirectory, "source-index.json"), "utf8"))).toEqual([]);
  });

  it("records a new Source Revision when a legacy Primary Folder descendant fingerprint is established", async () => {
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.fingerprint = {
      size: 64,
      modifiedAtMs: 1234,
      contentHash: "a".repeat(64)
    };
    const { application } = await launchWithSourceAccess(sourceAccess);
    const created = await application.submit({ type: "createWorkspace", name: "Legacy Algebra" });
    const linked = await application.linkPrimaryFolder(created.navigation.workspaceId, {
      name: "legacy-algebra",
      resourceType: "folder",
      lastKnownPath: "/Users/learner/legacy-algebra",
      canonicalPath: "/Users/learner/legacy-algebra",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "legacy-bookmark" },
      fingerprint: { size: 64, modifiedAtMs: 1234 }
    });
    const source = linked.sources.find((candidate): candidate is LinkedSource => candidate.kind === "linkedSource")!;

    await expect(application.openLinkedSource(source.id)).resolves.toMatchObject({ status: "available", sourceId: source.id });
    expect(application.getState().sourceRevisions.filter((revision) => revision.sourceId === source.id)).toHaveLength(2);
  });

  it("proposes an editable Learning Session and pauses materially ambiguous input for confirmation", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand which convergence claim to prove",
      scope: "Clarify whether the sequence is pointwise or uniformly convergent",
      initialTeachingDirection: "Compare the two definitions before choosing a proof",
      requiresConfirmation: true,
      confirmationReason: "The intended convergence notion changes the proof materially."
    });
    const { application } = await launchWithRuntime(runtime);

    const state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Show that this sequence converges."
    });

    expect(state.sessions[0]).toMatchObject({
      mathematics: "Show that this sequence converges.",
      learningGoal: "Understand which convergence claim to prove",
      proposal: {
        scope: "Clarify whether the sequence is pointwise or uniformly convergent",
        initialTeachingDirection: "Compare the two definitions before choosing a proof",
        status: "awaitingConfirmation",
        confirmationReason: "The intended convergence notion changes the proof materially."
      },
      teachingCard: { status: "idle", content: "" }
    });
    expect(runtime.teachingRequests).toEqual([]);

    const revised = await application.submit({
      type: "reviseSessionProposal",
      learningGoal: "Prove uniform convergence",
      scope: "Use the supremum norm on the stated domain",
      initialTeachingDirection: "Start from the epsilon definition"
    });
    expect(revised.sessions[0]).toMatchObject({
      learningGoal: "Prove uniform convergence",
      proposal: {
        scope: "Use the supremum norm on the stated domain",
        initialTeachingDirection: "Start from the epsilon definition"
      }
    });
  });

  it("turns long material into a source-anchored Argument Roadmap and one proposed Learning Slice", async () => {
    const mathematics = [
      "Stage one proves that every compact subset of a Hausdorff space is closed.",
      "Stage two derives uniqueness of limits from the closed diagonal.",
      "Stage three applies uniqueness to continuous extensions."
    ].join("\n");
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand why compact subsets are closed",
      scope: "Prove the compact-subset claim without expanding the later applications",
      initialTeachingDirection: "Start with pointwise separation and compactness",
      requiresConfirmation: false,
      confirmationReason: null,
      argumentRoadmap: {
        title: "Compactness through uniqueness and extension",
        stages: [
          {
            title: "Compact subsets are closed",
            majorClaim: "Every compact subset of a Hausdorff space is closed.",
            dependsOn: [],
            sourceExcerpt: "Stage one proves that every compact subset of a Hausdorff space is closed.",
            learningGoal: "Understand why compact subsets are closed",
            boundary: "Prove the compact-subset claim",
            immediatePrerequisites: ["Hausdorff separation", "finite subcovers"]
          },
          {
            title: "Limits are unique",
            majorClaim: "Limits in a Hausdorff space are unique.",
            dependsOn: [0],
            sourceExcerpt: "Stage two derives uniqueness of limits from the closed diagonal.",
            learningGoal: "Derive uniqueness of limits",
            boundary: "Relate convergence to the closed diagonal",
            immediatePrerequisites: ["closed diagonal characterization"]
          },
          {
            title: "Extensions are unique",
            majorClaim: "Continuous extensions from a dense subspace are unique.",
            dependsOn: [1],
            sourceExcerpt: "Stage three applies uniqueness to continuous extensions.",
            learningGoal: "Apply uniqueness to continuous extensions",
            boundary: "Prove uniqueness of a continuous extension",
            immediatePrerequisites: ["density"]
          }
        ],
        proposedStage: 0
      }
    });
    const { application } = await launchWithRuntime(runtime);

    const state = await application.submit({ type: "submitSessionIntake", mathematics });

    expect(state.argumentRoadmaps).toEqual([
      expect.objectContaining({
        title: "Compactness through uniqueness and extension",
        selectedStageId: expect.any(String),
        stages: [
          expect.objectContaining({ title: "Compact subsets are closed", dependsOnStageIds: [], sourceAnchorId: expect.any(String) }),
          expect.objectContaining({ title: "Limits are unique", dependsOnStageIds: [expect.any(String)], sourceAnchorId: expect.any(String) }),
          expect.objectContaining({ title: "Extensions are unique", dependsOnStageIds: [expect.any(String)], sourceAnchorId: expect.any(String) })
        ]
      })
    ]);
    expect(state.sessions).toHaveLength(3);
    expect(state.sessions.map((session) => session.learningGoal)).toEqual([
      "Understand why compact subsets are closed",
      "Derive uniqueness of limits",
      "Apply uniqueness to continuous extensions"
    ]);
    expect(state.sessions[0]).toMatchObject({
      status: "active",
      proposal: { status: "awaitingConfirmation" },
      learningSlice: {
        boundary: "Prove the compact-subset claim",
        immediatePrerequisites: ["Hausdorff separation", "finite subcovers"]
      }
    });
    expect(state.sessions.slice(1).every((session) => session.status === "paused")).toBe(true);
    expect(new Set(state.sessions.map((session) => session.missionId))).toEqual(new Set([state.sessions[0].missionId]));
    expect(runtime.teachingRequests).toEqual([]);
  });

  it("edits or changes the proposed Learning Slice, persists future links, and teaches only the confirmed slice", async () => {
    const mathematics = "First establish the local lemma.\nThen prove the main theorem.\nFinally derive the corollary.";
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Establish the local lemma",
      scope: "Prove only the local lemma",
      initialTeachingDirection: "Inspect the local hypothesis",
      requiresConfirmation: false,
      confirmationReason: null,
      argumentRoadmap: {
        title: "Lemma to theorem to corollary",
        stages: [
          {
            title: "Local lemma", majorClaim: "The local lemma holds.", dependsOn: [],
            sourceExcerpt: "First establish the local lemma.", learningGoal: "Establish the local lemma",
            boundary: "Prove only the local lemma", immediatePrerequisites: ["the local hypothesis"]
          },
          {
            title: "Main theorem", majorClaim: "The main theorem follows.", dependsOn: [0],
            sourceExcerpt: "Then prove the main theorem.", learningGoal: "Prove the main theorem",
            boundary: "Prove the theorem from the lemma", immediatePrerequisites: ["the local lemma"]
          },
          {
            title: "Corollary", majorClaim: "The corollary follows.", dependsOn: [1],
            sourceExcerpt: "Finally derive the corollary.", learningGoal: "Derive the corollary",
            boundary: "Derive only the corollary", immediatePrerequisites: ["the main theorem"]
          }
        ],
        proposedStage: 0
      }
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({ type: "submitSessionIntake", mathematics });
    const roadmap = state.argumentRoadmaps[0];

    state = await application.submit({
      type: "reviseLearningSlice",
      boundary: "Prove the local lemma through its two essential cases",
      immediatePrerequisites: ["the local hypothesis", "the case split"]
    });
    expect(state.sessions.find((session) => session.id === state.activeSessionId)?.learningSlice).toMatchObject({
      boundary: "Prove the local lemma through its two essential cases",
      immediatePrerequisites: ["the local hypothesis", "the case split"]
    });

    state = await application.submit({
      type: "selectRoadmapStage",
      roadmapId: roadmap.id,
      stageId: roadmap.stages[1].id
    });
    const selected = state.sessions.find((session) => session.id === state.activeSessionId)!;
    expect(selected).toMatchObject({
      id: roadmap.stages[1].sessionId,
      learningGoal: "Prove the main theorem",
      proposal: { status: "awaitingConfirmation" }
    });
    expect(state.sessions.find((session) => session.id === roadmap.stages[0].sessionId)?.status).toBe("paused");

    await application.submit({ type: "confirmSessionProposal" });
    expect(runtime.teachingRequests).toHaveLength(1);
    expect(runtime.teachingRequests[0]).toMatchObject({
      sessionId: selected.id,
      scope: "Prove the theorem from the lemma",
      learningSlice: {
        roadmapTitle: "Lemma to theorem to corollary",
        stageTitle: "Main theorem",
        boundary: "Prove the theorem from the lemma",
        immediatePrerequisites: ["the local lemma"],
        remainingStageTitles: ["Local lemma", "Corollary"]
      }
    });
    expect(state.sessions.every((session) => session.teachingCard.content === "")).toBe(true);

    runtime.emitTeaching("Focus only on the main theorem and its local lemma.");
    const duringTeaching = application.getState();
    expect(duringTeaching.sessions.find((session) => session.id === selected.id)?.teachingCard.content)
      .toBe("Focus only on the main theorem and its local lemma.");
    expect(duringTeaching.sessions.filter((session) => session.id !== selected.id)
      .every((session) => session.teachingCard.status === "idle" && session.learningArtifacts.length === 0)).toBe(true);

    runtime.completeTeaching(selected.id);
    await application.waitForModelWork();
    const reloaded = await LearningApplication.launch(dataDirectory);
    applications.push(reloaded);
    expect(reloaded.getState().argumentRoadmaps[0].selectedStageId).toBe(roadmap.stages[1].id);
    expect(reloaded.getState().sessions.map((session) => session.learningSlice?.roadmapId)).toEqual([
      roadmap.id, roadmap.id, roadmap.id
    ]);
  });

  it("opens and closes an anchored Concept Peek without creating or lengthening a Learning Session", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Unused", scope: "Unused", initialTeachingDirection: "Unused",
      requiresConfirmation: false, confirmationReason: null
    });
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "startQuickStudy",
      mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    const origin = state.sessions[0];
    const sourceId = origin.sourceIds[0];
    state = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text",
        startOffset: 26,
        endOffset: 41,
        exactText: "Hausdorff space",
        prefix: "compact subset of a ",
        suffix: " is closed."
      },
      paletteAction: "addNote"
    });
    const sourceAnchorId = state.sessions[0].activeSourceAnchorId!;

    state = await application.submit({
      type: "openConceptPeek",
      sourceAnchorId,
      prerequisite: "Hausdorff separation"
    });

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].mathematics).toBe(origin.mathematics);
    expect(state.sessions[0].conceptPeeks).toEqual([
      expect.objectContaining({
        sourceAnchorId,
        prerequisite: "Hausdorff separation",
        status: "open"
      })
    ]);
    expect(state.sessions[0].conceptPeeks[0].content).toContain("disjoint open neighbourhoods");
    expect(runtime.conceptPeekRequests[0]).toMatchObject({
      prerequisite: "Hausdorff separation",
      sourceAnchorId,
      sourceId
    });

    state = await application.submit({
      type: "closeConceptPeek",
      conceptPeekId: state.sessions[0].conceptPeeks[0].id
    });
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].conceptPeeks[0].status).toBe("closed");

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].conceptPeeks[0]).toMatchObject({
      sourceAnchorId,
      prerequisite: "Hausdorff separation",
      status: "closed"
    });
  });

  it("tracks and cancels Concept Peek generation without retaining partial learner-facing content", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Unused", scope: "Unused", initialTeachingDirection: "Unused",
      requiresConfirmation: false, confirmationReason: null
    });
    runtime.holdConceptPeek = true;
    const { application } = await launchWithRuntime(runtime);
    let state = await application.submit({ type: "startQuickStudy", mathematics: "Every compact subset is closed." });
    const sessionId = state.activeSessionId!;
    const sourceId = state.sessions[0].sourceIds[0];
    state = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset", prefix: "Every ", suffix: " is closed."
      },
      paletteAction: "addNote"
    });
    const sourceAnchorId = state.sessions[0].activeSourceAnchorId!;
    const observed: Array<{ sourceAnchorId: string; prerequisite: string } | null> = [];
    application.subscribe((next) => observed.push(next.sessions[0].pendingConceptPeek));

    const opening = application.submit({ type: "openConceptPeek", sourceAnchorId, prerequisite: "open covers" });
    expect(observed.at(-1)).toEqual({ sourceAnchorId, prerequisite: "open covers" });
    const stopped = expect(opening).rejects.toThrow("Concept Peek generation was stopped");
    await application.submit({ type: "cancelSessionModelWork", sessionId });

    await stopped;
    expect(runtime.canceledSessionIds).toContain(sessionId);
    expect(application.getState().sessions[0].conceptPeeks).toEqual([]);
    expect(application.getState().sessions[0].pendingConceptPeek).toBeNull();
  });

  it("requires a learner decision before branching and returns to the exact durable Return Point", async () => {
    const { application, dataDirectory } = await launch();
    let state = await application.submit({
      type: "startQuickStudy",
      mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    const originSessionId = state.activeSessionId!;
    const sourceId = state.sessions[0].sourceIds[0];
    state = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text",
        startOffset: 6,
        endOffset: 20,
        exactText: "compact subset",
        prefix: "Every ",
        suffix: " of a Hausdorff space"
      },
      paletteAction: "addNote"
    });
    const sourceAnchorId = state.sessions[0].activeSourceAnchorId!;

    state = await application.submit({
      type: "proposePrerequisiteBranch",
      sourceAnchorId,
      prerequisite: "finite subcover arguments"
    });
    const deferredProposalId = state.sessions[0].prerequisiteBranchProposals[0].id;
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].prerequisiteBranchProposals[0].status).toBe("pending");

    state = await application.submit({
      type: "decidePrerequisiteBranch",
      proposalId: deferredProposalId,
      decision: "defer"
    });
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].prerequisiteBranchProposals[0].status).toBe("deferred");

    state = await application.submit({
      type: "proposePrerequisiteBranch",
      sourceAnchorId,
      prerequisite: "finite subcover arguments"
    });
    const acceptedProposalId = state.sessions[0].prerequisiteBranchProposals.at(-1)!.id;
    state = await application.submit({
      type: "decidePrerequisiteBranch",
      proposalId: acceptedProposalId,
      decision: "accept"
    });

    const branchSessionId = state.activeSessionId!;
    const branch = state.sessions.find((session) => session.id === branchSessionId)!;
    expect(branchSessionId).not.toBe(originSessionId);
    expect(branch).toMatchObject({
      learningGoal: "Understand finite subcover arguments",
      status: "active",
      prerequisiteBranch: {
        prerequisite: "finite subcover arguments",
        returnPoint: {
          originSessionId,
          sourceId,
          sourceAnchorId,
          activeTeachingCardId: null
        }
      }
    });
    expect(state.sessions.find((session) => session.id === originSessionId)?.status).toBe("paused");
    expect(state.sessions.find((session) => session.id === originSessionId)?.prerequisiteBranchProposals.at(-1)).toMatchObject({
      status: "accepted",
      branchSessionId
    });

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions.find((session) => session.id === branchSessionId)?.prerequisiteBranch?.returnPoint)
      .toMatchObject({ originSessionId, sourceAnchorId });
    await relaunched.submit({ type: "resumeSession", sessionId: branchSessionId });
    state = await relaunched.submit({ type: "returnToPrerequisiteOrigin" });
    expect(state.activeSessionId).toBe(originSessionId);
    expect(state.sessions.find((session) => session.id === originSessionId)).toMatchObject({
      status: "active",
      activeSourceAnchorId: sourceAnchorId,
      activeTeachingCardId: null
    });

    state = await relaunched.submit({ type: "createWorkspace", name: "Topology" });
    const workspaceId = state.navigation.workspaceId;
    state = await relaunched.submit({ type: "createMission", workspaceId, name: "Separation arguments" });
    const missionId = state.navigation.missionId!;
    state = await relaunched.submit({ type: "fileSession", sessionId: originSessionId, workspaceId, missionId });
    expect(state.sessions.filter((session) => [originSessionId, branchSessionId].includes(session.id))
      .map((session) => ({ workspaceId: session.workspaceId, missionId: session.missionId })))
      .toEqual([{ workspaceId, missionId }, { workspaceId, missionId }]);

    const filedRelaunch = await LearningApplication.launch(dataDirectory);
    applications.push(filedRelaunch);
    expect(filedRelaunch.getState().sessions.find((session) => session.id === branchSessionId)?.prerequisiteBranch?.returnPoint)
      .toMatchObject({ originSessionId, sourceAnchorId });
  });

  it("lets the learner override a branch recommendation by keeping the prerequisite inline", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Unused", scope: "Unused", initialTeachingDirection: "Unused",
      requiresConfirmation: false, confirmationReason: null
    });
    const { application } = await launchWithRuntime(runtime);
    let state = await application.submit({ type: "startQuickStudy", mathematics: "Use the closed diagonal criterion." });
    const sourceId = state.sessions[0].sourceIds[0];
    state = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text", startOffset: 8, endOffset: 23, exactText: "closed diagonal", prefix: "Use the ", suffix: " criterion."
      },
      paletteAction: "addNote"
    });
    const sourceAnchorId = state.sessions[0].activeSourceAnchorId!;
    state = await application.submit({
      type: "proposePrerequisiteBranch", sourceAnchorId, prerequisite: "product topology"
    });
    state = await application.submit({
      type: "decidePrerequisiteBranch",
      proposalId: state.sessions[0].prerequisiteBranchProposals[0].id,
      decision: "keepInline"
    });

    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].prerequisiteBranchProposals[0]).toMatchObject({
      status: "overridden",
      branchSessionId: null
    });
    expect(state.sessions[0].conceptPeeks[0]).toMatchObject({
      sourceAnchorId,
      prerequisite: "product topology",
      status: "open"
    });
  });

  it("starts a clear proposal immediately and streams one Teaching Card to completion", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand why the harmonic series diverges",
      scope: "Use the grouping argument",
      initialTeachingDirection: "Group terms into powers-of-two blocks",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);

    const started = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Why does the harmonic series diverge?"
    });
    expect(started.sessions[0].proposal.status).toBe("accepted");
    expect(started.sessions[0].teachingCard).toMatchObject({ status: "streaming", content: "" });
    expect(runtime.teachingRequests).toHaveLength(1);

    runtime.emitTeaching("Group the terms as 1 + 1/2 + (1/3 + 1/4)");
    expect(application.getState().sessions[0].teachingCard).toMatchObject({
      status: "streaming",
      content: "Group the terms as 1 + 1/2 + (1/3 + 1/4)"
    });

    runtime.completeTeaching();
    await application.waitForModelWork();
    expect(application.getState().sessions[0].teachingCard).toMatchObject({
      status: "completed",
      content: "Group the terms as 1 + 1/2 + (1/3 + 1/4)",
      error: null
    });
  });

  it("returns the latest Teaching Card when model work completes before submission persistence", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the definition",
      scope: "Apply the definition once",
      initialTeachingDirection: "Start from the definition",
      requiresConfirmation: false,
      confirmationReason: null
    });
    runtime.teachingDeltaOnStart = "Use the definition before simplifying.";
    const { application } = await launchWithRuntime(runtime);

    const returned = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Explain compactness."
    });

    expect(returned.sessions[0].teachingCard).toMatchObject({
      status: "completed",
      content: "Use the definition before simplifying."
    });
  });

  it("restarts active teaching when an immediately accepted proposal is revised", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the original goal",
      scope: "Original scope",
      initialTeachingDirection: "Original direction",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const started = await application.submit({ type: "submitSessionIntake", mathematics: "Explain this theorem." });
    const sessionId = started.activeSessionId!;

    const revised = await application.submit({
      type: "applySessionProposalRevision",
      learningGoal: "Understand the revised goal",
      scope: "Revised scope",
      initialTeachingDirection: "Revised direction"
    });
    expect(runtime.canceledSessionIds).toContain(sessionId);
    expect(runtime.teachingRequests).toHaveLength(2);
    expect(runtime.teachingRequests[1]).toMatchObject({
      sessionId,
      learningGoal: "Understand the revised goal",
      scope: "Revised scope",
      initialTeachingDirection: "Revised direction"
    });
    expect(revised.sessions[0]).toMatchObject({
      learningGoal: "Understand the revised goal",
      teachingCard: { status: "streaming", content: "" }
    });
    runtime.completeTeaching(sessionId);
    await application.waitForModelWork();
  });

  it("starts confirmed work and cancellation retains the Learning Session in a clear stopped state", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Choose the intended convergence claim",
      scope: "Confirm uniform convergence",
      initialTeachingDirection: "Test the supremum error",
      requiresConfirmation: true,
      confirmationReason: "The domain is large enough to make the choice costly."
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Show f_n converges." });

    const confirmed = await application.submit({ type: "confirmSessionProposal" });
    expect(confirmed.sessions[0].teachingCard.status).toBe("streaming");
    runtime.emitTeaching("Begin by estimating the supremum");

    const stopped = await application.submit({ type: "cancelModelWork" });
    await application.waitForModelWork();
    expect(runtime.canceledSessionIds).toEqual([stopped.sessions[0].id]);
    expect(stopped.sessions[0]).toMatchObject({
      status: "active",
      teachingCard: {
        status: "stopped",
        content: "Begin by estimating the supremum",
        error: "Teaching stopped. You can retry without losing this Learning Session.",
        retryable: true
      }
    });
  });

  it("persists a stopped state even when Codex cannot confirm interruption", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand cancellation",
      scope: "Stop one teaching turn",
      initialTeachingDirection: "Begin teaching",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    runtime.cancelError = new Error("interrupt request timed out");
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Explain this slowly." });

    const stopped = await application.submit({ type: "cancelModelWork" });
    expect(stopped.sessions[0].teachingCard).toMatchObject({
      status: "stopped",
      retryable: true,
      error: "Teaching is stopped locally, but Codex did not confirm interruption. Restart Codex before retrying."
    });
    runtime.completeTeaching(stopped.sessions[0].id);
    await application.waitForModelWork();
  });

  it("surfaces honest runtime failures and retries the same Teaching Card", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the quotient rule",
      scope: "Derive the rule from the product rule",
      initialTeachingDirection: "Rewrite the quotient as a product",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Derive the quotient rule." });

    runtime.failTeaching(new ModelAccessError("authentication", "Codex authentication expired. Sign in and retry."));
    await application.waitForModelWork();
    expect(application.getState().sessions[0].teachingCard).toMatchObject({
      status: "failed",
      error: "Codex authentication expired. Sign in and retry.",
      retryable: true
    });

    runtime.authentication = { status: "signedIn", method: "chatgpt", accountLabel: "learner@example.com" };
    await application.submit({ type: "refreshAuthentication" });
    const retried = await application.submit({ type: "retryModelWork" });
    expect(runtime.teachingRequests).toHaveLength(2);
    expect(retried.sessions[0].teachingCard).toMatchObject({
      status: "streaming",
      content: "",
      error: null,
      retryable: false
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
  });

  it("revokes the connected state when the running Codex transport is lost", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the claim",
      scope: "One inference",
      initialTeachingDirection: "Start from the definition",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Explain this claim." });

    runtime.failTeaching(new ModelAccessError("runtime", "Codex runtime became unavailable. Restart Codex and retry."));
    await application.waitForModelWork();

    expect(application.getState()).toMatchObject({
      runtimeAvailable: false,
      authentication: {
        status: "failed",
        error: "Codex runtime became unavailable. Restart Codex and retry."
      }
    });
  });

  it("persists execution events internally without adding them to learner-facing session state", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the claim",
      scope: "One inference",
      initialTeachingDirection: "Start from the definition",
      requiresConfirmation: false,
      confirmationReason: null
    });
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    const state = await application.submit({ type: "submitSessionIntake", mathematics: "Explain this claim." });
    await application.waitForModelWork();

    expect(state.sessions[0]).not.toHaveProperty("agentWorkLog");
    const persisted = JSON.parse(await readFile(join(dataDirectory, "learning-application.json"), "utf8")) as {
      agentWorkLogs: Record<string, unknown[]>;
    };
    expect(persisted.agentWorkLogs[state.sessions[0].id]).not.toHaveLength(0);
  });

  it("dispatches one bounded Specialist Agent only for a completed learner-relevant Teaching Card", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand why compact subsets are closed",
      scope: "Find the hidden separation assumption",
      initialTeachingDirection: "Inspect the complement argument",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Prove compact subsets are closed." });

    await expect(application.submit({ type: "requestSpecialistReview" })).rejects.toThrow(
      "Complete a Teaching Card before requesting a Specialist Agent review."
    );
    expect(runtime.specialistRequests).toEqual([]);

    runtime.emitTeaching("For each exterior point, choose disjoint neighbourhoods from every point of the compact set.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({
      type: "addTrailItem", kind: "evidence", content: "The learner noticed that the neighbourhoods must be disjoint."
    });
    const working = await application.submit({ type: "requestSpecialistReview" });

    expect(runtime.specialistRequests).toHaveLength(1);
    expect(runtime.specialistRequests[0].brief).toEqual({
      learningGoal: "Understand why compact subsets are closed",
      sourceAnchors: [],
      constraints: [
        "Review only the current learner-facing Teaching Card.",
        "Do not inspect other Learning Session history or local files.",
        "Current Teaching Card: For each exterior point, choose disjoint neighbourhoods from every point of the compact set."
      ],
      learnerEvidence: ["The learner noticed that the neighbourhoods must be disjoint."],
      expectedOutput: "One concise correction or confirmation integrated as a Teaching Card.",
      verificationNeeds: ["Identify any hidden mathematical assumption and explain whether the argument depends on it."]
    });
    expect(runtime.specialistRequests[0]).not.toHaveProperty("mathematics");
    expect(working.sessions[0].agentTasks).toEqual([
      expect.objectContaining({
        purpose: "Review the current Teaching Card for a hidden mathematical assumption",
        status: "working",
        identifiedNeed: expect.objectContaining({ kind: "hiddenAssumptionReview", requestedBy: "learner" }),
        budget: {
          agentCount: 1, concurrency: 1, model: "runtimeDefault", reasoningEffort: "medium",
          tools: ["checkpointSpecialistResult"], maxOutputTokens: 512, maxLatencyMs: 120_000
        },
        integratedTeachingCard: expect.objectContaining({ status: "streaming", content: "" })
      })
    ]);

    runtime.completeSpecialist({
      title: "Specialist review · separation assumption",
      content: "The argument requires the Hausdorff property so the chosen neighbourhoods can be disjoint."
    });
    await application.waitForModelWork();
    const complete = application.getState().sessions[0].agentTasks[0];
    expect(complete).toMatchObject({
      status: "complete",
      integratedTeachingCard: {
        status: "completed",
        title: "Specialist review · separation assumption",
        content: "The argument requires the Hausdorff property so the chosen neighbourhoods can be disjoint."
      },
      agentWorkLogReference: { sessionId: expect.any(String), fromSequence: expect.any(Number), toSequence: expect.any(Number) }
    });

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].agentTasks[0]).toEqual(complete);
  });

  it("includes the relevant Source Anchor when the learner requests review of an anchored Teaching Card", async () => {
    const mathematics = "Every compact subset of a Hausdorff space is closed.";
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the closed-subset proof", scope: "Inspect the separation step",
      initialTeachingDirection: "Start from an exterior point", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    let state = await application.submit({ type: "submitSessionIntake", mathematics });
    runtime.emitTeaching("Begin with an exterior point.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "addTrailItem", kind: "evidence", content: "Unrelated evidence from the main card." });
    state = await application.submit({
      type: "createSourceAnchor",
      sourceId: state.sessions[0].sourceIds[0],
      selection: {
        kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset",
        prefix: "Every ", suffix: " of a Hausdorff space is closed."
      },
      paletteAction: "explain"
    });
    runtime.emitTeaching("Use Hausdorff separation to choose disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "addTrailItem", kind: "evidence", content: "This anchored step uses disjoint neighbourhoods." });
    await application.submit({ type: "requestSpecialistReview" });

    const anchor = state.sessions[0].sourceAnchors[0];
    expect(runtime.specialistRequests.at(-1)?.brief.sourceAnchors).toEqual([{
      sourceAnchorId: anchor.id,
      sourceId: anchor.sourceId,
      selection: anchor.selection
    }]);
    expect(runtime.specialistRequests.at(-1)?.brief.learnerEvidence).toEqual([
      "This anchored step uses disjoint neighbourhoods."
    ]);
    expect(runtime.specialistRequests.at(-1)?.brief.constraints).toContain(
      "Current Teaching Card: Use Hausdorff separation to choose disjoint neighbourhoods."
    );
    runtime.completeSpecialist({ title: "Specialist review", content: "Hausdorff separation is the required assumption." });
    await application.waitForModelWork();
  });

  it("keeps useful partial Specialist Agent output when later work waits and fails", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check a compactness argument",
      scope: "Inspect one assumption",
      initialTeachingDirection: "Read the current explanation",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this compactness proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "requestSpecialistReview" });

    runtime.waitSpecialist("Waiting for the bounded review result.");
    expect(application.getState().sessions[0].agentTasks[0]).toMatchObject({
      status: "waiting",
      statusMessage: "Waiting for the bounded review result."
    });
    runtime.emitSpecialistPartial("The disjoint-neighbourhood step uses Hausdorff separation.");
    runtime.failSpecialist(new Error("The specialist could not finish the final review."));
    await application.waitForModelWork();

    const failed = application.getState().sessions[0].agentTasks[0];
    expect(failed).toMatchObject({
      status: "failed",
      integratedTeachingCard: {
        status: "failed",
        content: "The disjoint-neighbourhood step uses Hausdorff separation.",
        error: "The specialist could not finish the final review.",
        retryable: true
      }
    });
  });

  it("preserves a failed Specialist checkpoint and its attempt provenance while retrying", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check a compactness argument", scope: "Inspect one assumption",
      initialTeachingDirection: "Read the current explanation", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this compactness proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "requestSpecialistReview" });
    runtime.emitSpecialistPartial("The first attempt found a separation assumption.");
    runtime.failSpecialist(new Error("The first attempt stopped early."));
    await application.waitForModelWork();
    const firstReference = structuredClone(application.getState().sessions[0].agentTasks[0].agentWorkLogReference);

    const retrying = await application.submit({
      type: "retryAgentTask", taskId: application.getState().sessions[0].agentTasks[0].id
    });
    expect(retrying.sessions[0].agentTasks[0]).toMatchObject({
      status: "working",
      integratedTeachingCard: { status: "streaming", content: "The first attempt found a separation assumption." },
      priorAgentWorkLogReferences: [firstReference]
    });

    runtime.emitSpecialistPartial("The retry confirmed the assumption is Hausdorff separation.");
    runtime.failSpecialist(new Error("The retry also stopped early."));
    await application.waitForModelWork();
    const retried = application.getState().sessions[0].agentTasks[0];
    expect(retried.integratedTeachingCard.content).toBe(
      "The first attempt found a separation assumption.\n\nRetry checkpoint:\n"
      + "The retry confirmed the assumption is Hausdorff separation."
    );
    expect(retried.priorAgentWorkLogReferences).toEqual([firstReference]);
    expect(retried.agentWorkLogReference).not.toEqual(firstReference);
  });

  it("rejects malformed Specialist Agent output and exposes only sanitized audit evidence", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check a proof step",
      scope: "Inspect one assumption",
      initialTeachingDirection: "Read the current explanation",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this proof." });
    runtime.emitTeaching("Assume the chosen neighbourhoods are disjoint.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    let state = await application.submit({ type: "requestSpecialistReview" });
    runtime.completeSpecialist({ title: "", content: "raw malformed output" });
    await application.waitForModelWork();

    state = application.getState();
    const task = state.sessions[0].agentTasks[0];
    expect(task).toMatchObject({
      status: "failed",
      integratedTeachingCard: {
        status: "failed",
        error: "Codex returned a malformed Specialist Agent result. Retry to request a fresh review.",
        retryable: true
      }
    });
    const reference = task.agentWorkLogReference!;
    const evidence = application.getAgentWorkLogEvidence(reference.sessionId, reference.fromSequence, reference.toSequence);
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "turnStarted", summary: "Specialist Agent turn started." }),
      expect.objectContaining({ type: "turnCompleted", summary: "Specialist Agent turn completed." })
    ]));
    expect(JSON.stringify(evidence)).not.toContain("raw malformed output");
    expect(state.sessions[0]).not.toHaveProperty("agentWorkLog");
  });

  it("stops one visible Agent Task without discarding its partial integrated result", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check one proof step", scope: "Inspect one assumption",
      initialTeachingDirection: "Read the current explanation", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "requestSpecialistReview" });
    runtime.emitSpecialistPartial("This step uses separation.");

    const stopped = await application.submit({ type: "cancelModelWork" });
    await application.waitForModelWork();

    expect(runtime.canceledSessionIds).toContain(stopped.sessions[0].id);
    expect(stopped.sessions[0].agentTasks[0]).toMatchObject({
      status: "stopped",
      statusMessage: "Specialist work stopped. Retry when ready.",
      integratedTeachingCard: {
        status: "stopped",
        content: "This step uses separation.",
        retryable: true
      }
    });
  });

  it("supports ChatGPT and API-key authentication without retaining credentials in application state", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Unused",
      scope: "Unused",
      initialTeachingDirection: "Unused",
      requiresConfirmation: false,
      confirmationReason: null
    });
    runtime.authentication = { status: "signedOut" };
    const { application } = await launchWithRuntime(runtime);

    const chatGpt = await application.submit({ type: "startChatGptLogin" });
    expect(chatGpt.authentication).toEqual({
      status: "signingIn",
      method: "chatgpt",
      accountLabel: null,
      loginUrl: "https://auth.example.test",
      error: null
    });
    expect(runtime.chatGptLoginStarts).toBe(1);

    runtime.authentication = {
      status: "signedIn",
      method: "chatgpt",
      accountLabel: "learner@example.com"
    };
    const signedIn = await application.submit({ type: "refreshAuthentication" });
    expect(signedIn.authentication).toMatchObject({ status: "signedIn", method: "chatgpt" });

    runtime.authentication = { status: "signedIn", method: "apiKey", accountLabel: null };
    const apiKey = "sk-test-never-persist";
    const keySignedIn = await application.submit({ type: "loginWithApiKey", apiKey });
    expect(runtime.receivedApiKeys).toEqual([apiKey]);
    expect(keySignedIn.authentication).toEqual({
      status: "signedIn",
      method: "apiKey",
      accountLabel: null,
      loginUrl: null,
      error: null
    });
    expect(JSON.stringify(keySignedIn)).not.toContain(apiKey);
  });

  it("keeps malformed proposal failures retryable without fabricating a Learning Session", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the chain rule",
      scope: "Derive the composition derivative",
      initialTeachingDirection: "Track a small input change through both functions",
      requiresConfirmation: false,
      confirmationReason: null
    });
    runtime.proposalError = new Error("Codex returned a malformed Session Proposal. Retry to request a fresh proposal.");
    const { application, dataDirectory } = await launchWithRuntime(runtime);

    const failed = await application.submit({ type: "submitSessionIntake", mathematics: "Explain the chain rule." });
    expect(failed.sessions).toHaveLength(0);
    expect(failed.intakeError).toBe("Codex returned a malformed Session Proposal. Retry to request a fresh proposal.");
    const failedPersistence = await readFile(join(dataDirectory, "learning-application.json"), "utf8");
    expect(failedPersistence).toContain("Codex returned a malformed Session Proposal");

    runtime.proposalError = null;
    const retried = await application.submit({ type: "submitSessionIntake", mathematics: "Explain the chain rule." });
    expect(retried.intakeError).toBeNull();
    expect(retried.sessions[0].learningGoal).toBe("Understand the chain rule");
  });

  it("rejects an unanchored Argument Roadmap without leaving partial durable state", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand a long proof",
      scope: "Start with the first stage",
      initialTeachingDirection: "Read the first claim",
      requiresConfirmation: false,
      confirmationReason: null,
      argumentRoadmap: {
        title: "Invalid roadmap",
        stages: [
          {
            title: "Missing excerpt", majorClaim: "A missing claim.", dependsOn: [],
            sourceExcerpt: "This text is not in the intake.", learningGoal: "Study the missing claim",
            boundary: "Study one claim", immediatePrerequisites: []
          },
          {
            title: "Later stage", majorClaim: "A later claim.", dependsOn: [0],
            sourceExcerpt: "The actual intake.", learningGoal: "Study the later claim",
            boundary: "Study the later claim", immediatePrerequisites: []
          }
        ],
        proposedStage: 0
      }
    });
    const { application } = await launchWithRuntime(runtime);

    const state = await application.submit({ type: "submitSessionIntake", mathematics: "The actual intake." });

    expect(state.intakeError).toBe("Codex returned an invalid Argument Roadmap. Retry to request a fresh proposal.");
    expect(state.sessions).toEqual([]);
    expect(state.sources).toEqual([]);
    expect(state.argumentRoadmaps).toEqual([]);
  });

  it("rejects ambiguous repeated Source Anchor excerpts instead of choosing the first occurrence", async () => {
    const mathematics = "Apply the lemma here.\nApply the lemma here.\nConclude the theorem.";
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Apply the lemma",
      scope: "Use the first application",
      initialTeachingDirection: "Inspect the application",
      requiresConfirmation: false,
      confirmationReason: null,
      argumentRoadmap: {
        title: "Two applications and a conclusion",
        stages: [
          {
            title: "First application", majorClaim: "The lemma applies.", dependsOn: [],
            sourceExcerpt: "Apply the lemma here.", learningGoal: "Understand the first application",
            boundary: "Study the first application", immediatePrerequisites: []
          },
          {
            title: "Conclusion", majorClaim: "The theorem follows.", dependsOn: [0],
            sourceExcerpt: "Conclude the theorem.", learningGoal: "Conclude the theorem",
            boundary: "Study the conclusion", immediatePrerequisites: ["the lemma"]
          }
        ],
        proposedStage: 0
      }
    });
    const { application } = await launchWithRuntime(runtime);

    const state = await application.submit({ type: "submitSessionIntake", mathematics });

    expect(state.intakeError).toContain("invalid Argument Roadmap");
    expect(state.sessions).toEqual([]);
    expect(state.sources).toEqual([]);
  });

  it("requires a roadmap when clearly multi-stage material is returned as one flat proposal", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Explain all three stages",
      scope: "Cover the whole proof",
      initialTeachingDirection: "Start explaining",
      requiresConfirmation: false,
      confirmationReason: null,
      materialScope: "longOrMultiStage",
      argumentRoadmap: null
    });
    const { application } = await launchWithRuntime(runtime);

    const state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "First prove the lemma.\nThen derive the theorem."
    });

    expect(state.intakeError).toBe("Long or multi-stage material requires an Argument Roadmap. Retry to request a fresh proposal.");
    expect(state.sessions).toEqual([]);
    expect(runtime.teachingRequests).toEqual([]);
  });

  it("launches into an honest authentication failure instead of hanging when Codex is unavailable", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Unused",
      scope: "Unused",
      initialTeachingDirection: "Unused",
      requiresConfirmation: false,
      confirmationReason: null
    });
    runtime.authenticationError = new Error("Codex app-server stopped with code 1.");

    const { application } = await launchWithRuntime(runtime);
    expect(application.getState().authentication).toEqual({
      status: "failed",
      method: null,
      accountLabel: null,
      loginUrl: null,
      error: "Codex app-server stopped with code 1."
    });
  });

  it.each([
    ["network", "Network connection is unavailable."],
    ["authentication", "Codex authentication expired. Sign in and retry."],
    ["subscriptionCapacity", "ChatGPT subscription capacity is unavailable."],
    ["quota", "OpenAI API quota is exhausted."],
    ["runtime", "Codex runtime became unavailable. Restart Codex and retry."]
  ] as const)("enters Local Working Mode when %s access is lost", async (cause, message) => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Unused",
      scope: "Unused",
      initialTeachingDirection: "Unused",
      requiresConfirmation: false,
      confirmationReason: null
    });
    runtime.proposalError = new ModelAccessError(cause as ModelAccessCause, message);
    const { application } = await launchWithRuntime(runtime);

    const state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Explain this claim."
    });

    expect(state.modelAccess).toEqual({ status: "unavailable", cause, message });
    expect(state.sessions).toHaveLength(0);
  });

  it("keeps local study and Pending Questions usable until recovery and explicit submission", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Unused",
      scope: "Unused",
      initialTeachingDirection: "Unused",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    runtime.authenticationError = new ModelAccessError("network", "Network connection is unavailable.");
    const { application } = await launchWithRuntime(runtime);

    let state = await application.submit({
      type: "startQuickStudy",
      mathematics: "Show that every convergent sequence is bounded."
    });
    await application.submit({ type: "editLearningGoal", value: "Understand how convergence bounds the tail" });
    await application.submit({ type: "editSessionTarget", value: "Combine the finite prefix with a tail bound" });
    state = await application.submit({
      type: "savePendingQuestion",
      text: "Why can the finite prefix be bounded by one maximum?"
    });

    expect(state.sessions[0].pendingQuestion).toMatchObject({
      text: "Why can the finite prefix be bounded by one maximum?"
    });
    state = await application.submit({ type: "discardPendingQuestion" });
    expect(state.sessions[0].pendingQuestion).toBeNull();
    state = await application.submit({
      type: "savePendingQuestion",
      text: "Why can the finite prefix be bounded by one maximum?"
    });
    expect(application.searchSessions("finite prefix")).toEqual([
      expect.objectContaining({
        sessionId: state.sessions[0].id,
        learningGoal: "Understand how convergence bounds the tail",
        sessionTarget: "Combine the finite prefix with a tail bound"
      })
    ]);

    runtime.authenticationError = null;
    runtime.authentication = { status: "signedIn", method: "chatgpt", accountLabel: "learner@example.com" };
    state = await application.submit({ type: "refreshAuthentication" });

    expect(state.modelAccess).toEqual({ status: "available" });
    expect(state.sessions[0].pendingQuestion).toMatchObject({
      text: "Why can the finite prefix be bounded by one maximum?"
    });
    expect(runtime.teachingRequests).toHaveLength(0);

    await application.submit({
      type: "editPendingQuestion",
      text: "Why does a finite prefix have a maximum absolute value?"
    });
    state = await application.submit({ type: "submitPendingQuestion" });

    expect(state.sessions[0].pendingQuestion).toBeNull();
    expect(runtime.teachingRequests).toHaveLength(1);
    expect(runtime.teachingRequests[0].mathematics).toBe("Why does a finite prefix have a maximum absolute value?");
    runtime.completeTeaching();
    await application.waitForModelWork();
  });

  it("reloads a Pending Question as local session work", async () => {
    const { application, dataDirectory } = await launch();
    let state = await application.submit({ type: "startQuickStudy", mathematics: "Explain compactness." });
    const sessionId = state.activeSessionId!;
    await application.submit({ type: "savePendingQuestion", text: "Where is finiteness used?" });
    await application.submit({ type: "leaveSession" });

    const reloaded = await LearningApplication.launch(dataDirectory);
    applications.push(reloaded);
    state = await reloaded.submit({ type: "resumeSession", sessionId });

    expect(state.sessions[0].pendingQuestion).toMatchObject({ text: "Where is finiteness used?" });
  });

  it("restores a replaced Codex Runtime without submitting a Pending Question", async () => {
    const { application } = await launch();
    let state = await application.submit({ type: "startQuickStudy", mathematics: "Explain compactness." });
    await application.submit({ type: "savePendingQuestion", text: "Where is finiteness used?" });
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Unused",
      scope: "Unused",
      initialTeachingDirection: "Unused",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);

    state = await application.restoreModelRuntime(runtime);

    expect(state).toMatchObject({ runtimeAvailable: true, modelAccess: { status: "available" } });
    expect(state.sessions[0].pendingQuestion).toMatchObject({ text: "Where is finiteness used?" });
    expect(runtime.teachingRequests).toHaveLength(0);
  });

  it("turns a submitted Pending Question into a retryable Question Card without replacing earlier teaching", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Use an open cover",
      initialTeachingDirection: "Start with the definition",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Explain compactness." });

    runtime.emitTeaching("First explanation");
    runtime.completeTeaching();
    await application.waitForModelWork();

    runtime.proposalError = new ModelAccessError("network", "Network connection is unavailable.");
    await application.submit({ type: "submitSessionIntake", mathematics: "Start another session." });
    await application.submit({ type: "savePendingQuestion", text: "Why finite?" });
    runtime.proposalError = null;
    await application.submit({ type: "refreshAuthentication" });
    let state = await application.submit({ type: "submitPendingQuestion" });

    expect(state.sessions[0].questionCards).toEqual([
      expect.objectContaining({
        question: "Why finite?",
        currentRevision: expect.objectContaining({ status: "streaming" })
      })
    ]);
    expect(state.sessions[0].teachingCard).toMatchObject({ status: "completed", content: "First explanation" });
    runtime.failTeaching(new ModelAccessError("network", "Network connection is unavailable."));
    await application.waitForModelWork();

    state = application.getState();
    expect(state.sessions[0].questionCards[0]).toMatchObject({
      question: "Why finite?",
      currentRevision: { status: "failed" }
    });

    await application.submit({ type: "refreshAuthentication" });
    await application.submit({ type: "retryQuestionCard", cardId: state.sessions[0].questionCards[0].id });
    expect(runtime.teachingRequests.at(-1)?.mathematics).toBe("Why finite?");
    runtime.completeTeaching();
    await application.waitForModelWork();
  });

  it("tracks every teaching job and persists stopped retryable cards across shutdown and relaunch", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the proof",
      scope: "Follow the main inference",
      initialTeachingDirection: "Start from the definition",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);

    let state = await application.submit({ type: "submitSessionIntake", mathematics: "Explain proof one." });
    const firstSessionId = state.activeSessionId!;
    await application.submit({ type: "leaveSession" });
    state = await application.submit({ type: "submitSessionIntake", mathematics: "Explain proof two." });
    const secondSessionId = state.activeSessionId!;

    await application.shutdown();
    expect(runtime.canceledSessionIds).toEqual(expect.arrayContaining([firstSessionId, secondSessionId]));
    expect(application.getState().sessions.map((session) => session.teachingCard.status)).toEqual(["stopped", "stopped"]);

    const reloaded = await LearningApplication.launch(dataDirectory);
    expect(reloaded.getState()).toMatchObject({
      runtimeAvailable: false,
      authentication: { status: "failed", error: "Codex Runtime is unavailable. Restart Codex and try again." }
    });
    expect(reloaded.getState().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstSessionId, teachingCard: expect.objectContaining({ status: "stopped", retryable: true }) }),
      expect.objectContaining({ id: secondSessionId, teachingCard: expect.objectContaining({ status: "stopped", retryable: true }) })
    ]));
  });

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

  it("defaults access by intake location and bounds Focused and Workspace source context", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the orbit-stabilizer theorem",
      scope: "Relate an orbit to a stabilizer index",
      initialTeachingDirection: "Start from the group action map",
      requiresConfirmation: false,
      confirmationReason: null
    });
    const { application } = await launchWithRuntime(runtime);

    const quickStudy = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Why is an orbit in bijection with the stabilizer cosets?"
    });
    const focusedSession = quickStudy.sessions[0];
    expect(focusedSession.accessPolicy).toBe("focused");
    expect(application.getSessionAccessScope(focusedSession.id)).toEqual({
      policy: "focused",
      sourceIds: focusedSession.sourceIds,
      allowsBroadLocalRead: false,
      allowsSourceModification: false
    });

    let state = await application.submit({ type: "createWorkspace", name: "Abstract Algebra" });
    const algebraWorkspaceId = state.navigation.workspaceId;
    state = await application.submit({ type: "createMission", workspaceId: algebraWorkspaceId, name: "Group actions" });
    const algebraMissionId = state.navigation.missionId!;
    const algebraSources = await application.linkExternalAttachment(algebraWorkspaceId, {
      name: "group-actions.pdf",
      resourceType: "file",
      lastKnownPath: "/Users/learner/algebra/group-actions.pdf",
      canonicalPath: "/Users/learner/algebra/group-actions.pdf",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "algebra-bookmark" },
      fingerprint: { size: 64, modifiedAtMs: 1234 }
    });
    const algebraSourceId = algebraSources.workspaces.find((workspace) => workspace.id === algebraWorkspaceId)!.context.sourceIds[0];

    state = await application.submit({ type: "createWorkspace", name: "Topology" });
    const topologyWorkspaceId = state.navigation.workspaceId;
    const topologySources = await application.linkExternalAttachment(topologyWorkspaceId, {
      name: "compactness.pdf",
      resourceType: "file",
      lastKnownPath: "/Users/learner/topology/compactness.pdf",
      canonicalPath: "/Users/learner/topology/compactness.pdf",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "topology-bookmark" },
      fingerprint: { size: 48, modifiedAtMs: 5678 }
    });
    const topologySourceId = topologySources.workspaces.find((workspace) => workspace.id === topologyWorkspaceId)!.context.sourceIds[0];

    const workspaceStart = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Explain orbit-stabilizer using the linked notes.",
      location: { workspaceId: algebraWorkspaceId, missionId: algebraMissionId }
    });
    const workspaceSession = workspaceStart.sessions.find((session) => session.id === workspaceStart.activeSessionId)!;
    expect(workspaceSession.accessPolicy).toBe("workspace");
    expect(application.getSessionAccessScope(workspaceSession.id)).toEqual({
      policy: "workspace",
      sourceIds: expect.arrayContaining([...workspaceSession.sourceIds, algebraSourceId]),
      allowsBroadLocalRead: false,
      allowsSourceModification: false
    });
    expect(application.getSessionAccessScope(workspaceSession.id).sourceIds).not.toContain(topologySourceId);
    expect(runtime.teachingRequests.at(-1)?.accessScope).toEqual(application.getSessionAccessScope(workspaceSession.id));
  });

  it("supplies only authorized source content to the Model Runtime", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the theorem",
      scope: "Use the supplied sources",
      initialTeachingDirection: "Compare the statements",
      requiresConfirmation: false,
      confirmationReason: null
    });
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.contentBySourceName.set("group-actions.txt", "Orbit-stabilizer source content.");
    sourceAccess.contentBySourceName.set("compactness.txt", "Unrelated topology source content.");
    const { application } = await launchWithRuntimeAndSourceAccess(runtime, sourceAccess);

    let state = await application.submit({ type: "createWorkspace", name: "Abstract Algebra" });
    const algebraWorkspaceId = state.navigation.workspaceId;
    state = await application.submit({ type: "createMission", workspaceId: algebraWorkspaceId, name: "Group actions" });
    const algebraMissionId = state.navigation.missionId!;
    await application.linkExternalAttachment(algebraWorkspaceId, {
      name: "group-actions.txt", resourceType: "file",
      lastKnownPath: "/Users/learner/algebra/group-actions.txt", canonicalPath: "/Users/learner/algebra/group-actions.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "algebra-bookmark" },
      fingerprint: { size: 64, modifiedAtMs: 1234 }
    });
    state = await application.submit({ type: "createWorkspace", name: "Topology" });
    const topologyWorkspaceId = state.navigation.workspaceId;
    await application.linkExternalAttachment(topologyWorkspaceId, {
      name: "compactness.txt", resourceType: "file",
      lastKnownPath: "/Users/learner/topology/compactness.txt", canonicalPath: "/Users/learner/topology/compactness.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "topology-bookmark" },
      fingerprint: { size: 64, modifiedAtMs: 1234 }
    });

    await application.submit({
      type: "submitSessionIntake",
      mathematics: "Explain orbit-stabilizer.",
      location: { workspaceId: algebraWorkspaceId, missionId: algebraMissionId }
    });
    expect(runtime.teachingRequests.at(-1)?.sourceContext).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "group-actions.txt", content: "Orbit-stabilizer source content." }),
      expect.objectContaining({ name: "Typed mathematics", content: "Explain orbit-stabilizer." })
    ]));
    expect(runtime.teachingRequests.at(-1)?.sourceContext.map((source) => source.name)).not.toContain("compactness.txt");
  });

  it("requires explicit learner decisions for Access Requests and never inherits Full Access", async () => {
    const { application, dataDirectory } = await launch();
    let state = await application.submit({ type: "startQuickStudy", mathematics: "Prove Fermat's little theorem." });
    const firstSessionId = state.activeSessionId!;

    state = await application.requestSessionAccess(firstSessionId, {
      requestedPolicy: "full",
      reason: "The proof cites a local lemma that is not attached.",
      exactScope: "/Users/learner/number-theory/lemmas.pdf",
      intendedAction: "Read the lemma statement without modifying the source."
    });
    expect(state.sessions[0]).toMatchObject({
      accessPolicy: "focused",
      accessRequests: [{
        requestedPolicy: "full",
        reason: "The proof cites a local lemma that is not attached.",
        exactScope: "/Users/learner/number-theory/lemmas.pdf",
        intendedAction: "Read the lemma statement without modifying the source.",
        status: "pending"
      }]
    });

    state = await application.submit({ type: "decideAccessRequest", requestId: state.sessions[0].accessRequests[0].id, decision: "deny" });
    expect(state.sessions[0]).toMatchObject({
      accessPolicy: "focused",
      accessRequests: [{ status: "denied", decidedPolicy: null }]
    });

    state = await application.requestSessionAccess(firstSessionId, {
      requestedPolicy: "full",
      reason: "A second supporting source is outside this Study Workspace.",
      exactScope: "/Users/learner/shared/reference.pdf",
      intendedAction: "Read one referenced theorem without modifying the source."
    });
    const approvedRequest = state.sessions[0].accessRequests.at(-1)!;
    state = await application.submit({ type: "decideAccessRequest", requestId: approvedRequest.id, decision: "approve" });
    expect(state.sessions[0].accessPolicy).toBe("full");
    expect(state.sessions[0].accessRequests.at(-1)).toMatchObject({ status: "approved", decidedPolicy: "full" });

    await application.submit({ type: "leaveSession" });
    const reloaded = await LearningApplication.launch(dataDirectory);
    applications.push(reloaded);
    expect(reloaded.getState().sessions.find((session) => session.id === firstSessionId)?.accessPolicy).toBe("full");
    const second = await reloaded.submit({ type: "startQuickStudy", mathematics: "Compute 2 to the tenth modulo 11." });
    expect(second.sessions.find((session) => session.id === second.activeSessionId)?.accessPolicy).toBe("focused");
  });

  it("uses the Full Access preference only for the extra confirmation step", async () => {
    const { application, dataDirectory } = await launch();
    let state = await application.submit({ type: "startQuickStudy", mathematics: "Study a local proof." });
    expect(state.accessConfirmationPreference.confirmFullAccess).toBe(true);

    state = await application.submit({ type: "selectSessionAccessPolicy", policy: "full" });
    expect(state.sessions[0].accessPolicy).toBe("focused");
    expect(state.sessions[0].pendingFullAccessConfirmation).toBe(true);
    expect(state.sessions[0].accessRequests).toEqual([]);
    state = await application.submit({ type: "decideFullAccessConfirmation", decision: "cancel" });
    expect(state.sessions[0].pendingFullAccessConfirmation).toBe(false);

    state = await application.submit({ type: "setFullAccessConfirmation", enabled: false });
    state = await application.submit({ type: "selectSessionAccessPolicy", policy: "full" });
    expect(state.accessConfirmationPreference.confirmFullAccess).toBe(false);
    expect(state.sessions[0].accessPolicy).toBe("full");

    state = await application.submit({ type: "selectSessionAccessPolicy", policy: "focused" });
    expect(state.sessions[0].accessPolicy).toBe("focused");
    expect(state.accessConfirmationPreference.confirmFullAccess).toBe(false);

    const reloaded = await LearningApplication.launch(dataDirectory);
    applications.push(reloaded);
    expect(reloaded.getState().accessConfirmationPreference.confirmFullAccess).toBe(false);
  });

  it("handles a runtime Access Request and rebinds active teaching after approval", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the proof",
      scope: "Use the attached statement",
      initialTeachingDirection: "Inspect the hypotheses",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    runtime.completeTeachingOnCancel = false;
    const { application } = await launchWithRuntime(runtime);
    let state = await application.submit({ type: "submitSessionIntake", mathematics: "Explain this theorem." });

    const deniedDecision = runtime.requestAccess({
      requestedPolicy: "full",
      reason: "The theorem cites an unattached reference.",
      exactScope: "/Users/learner/reference.pdf",
      intendedAction: "Read the cited theorem statement."
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    state = application.getState();
    const deniedRequest = state.sessions[0].accessRequests.at(-1)!;
    expect(deniedRequest).toMatchObject({ status: "pending", reason: "The theorem cites an unattached reference." });
    await application.submit({ type: "decideAccessRequest", requestId: deniedRequest.id, decision: "deny" });
    await expect(deniedDecision).resolves.toEqual({ status: "denied", policy: "focused" });
    expect(runtime.teachingRequests).toHaveLength(1);

    const approvedDecision = runtime.requestAccess({
      requestedPolicy: "full",
      reason: "The proof depends on a second local reference.",
      exactScope: "/Users/learner/second-reference.pdf",
      intendedAction: "Read the supporting lemma."
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const approvedRequest = application.getState().sessions[0].accessRequests.at(-1)!;
    state = await application.submit({ type: "decideAccessRequest", requestId: approvedRequest.id, decision: "approve" });
    await expect(approvedDecision).resolves.toEqual({ status: "approved", policy: "full" });
    expect(state.sessions[0].accessPolicy).toBe("full");
    expect(runtime.teachingRequests).toHaveLength(2);
    expect(runtime.teachingRequests.at(-1)?.accessScope.policy).toBe("full");
    runtime.teachingRequests[0].onDelta("stale interrupted output");
    expect(application.getState().sessions[0].teachingCard.content).not.toContain("stale interrupted output");
    runtime.completeTeachingRequest(runtime.teachingRequests[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(application.getState().sessions[0].teachingCard.status).toBe("streaming");
    await expect(runtime.teachingRequests[0].onAccessRequest({
      requestedPolicy: "full",
      reason: "A late stale request.",
      exactScope: "/Users/learner/stale.pdf",
      intendedAction: "Read stale work."
    })).resolves.toEqual({ status: "denied", policy: "full" });
    expect(application.getState().sessions[0].accessRequests.filter((request) => request.status === "pending")).toEqual([]);
    runtime.emitTeaching("Current Full Access teaching");
    expect(application.getState().sessions[0].teachingCard.content).toContain("Current Full Access teaching");

    runtime.completeTeaching(state.sessions[0].id);
  });

  it("keeps the current policy when Codex cannot confirm interruption", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the proof",
      scope: "Use the current source",
      initialTeachingDirection: "Inspect the hypotheses",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    let state = await application.submit({ type: "submitSessionIntake", mathematics: "Explain this theorem." });
    state = await application.submit({ type: "setFullAccessConfirmation", enabled: false });
    runtime.cancelError = new Error("interrupt request timed out");

    await expect(application.submit({ type: "selectSessionAccessPolicy", policy: "full" })).rejects.toThrow(
      "Codex did not confirm interruption. Focused Access remains active."
    );
    expect(application.getState().sessions[0].accessPolicy).toBe("focused");
    expect(runtime.teachingRequests).toHaveLength(1);

    runtime.cancelError = null;
    runtime.completeTeaching(state.sessions[0].id);
    await application.waitForModelWork();
  });

  it("keeps an Access Request pending when policy rebinding cannot be confirmed", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the proof",
      scope: "Use the current source",
      initialTeachingDirection: "Inspect the hypotheses",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const state = await application.submit({ type: "submitSessionIntake", mathematics: "Explain this theorem." });
    const decision = runtime.requestAccess({
      requestedPolicy: "full",
      reason: "The proof depends on a local reference.",
      exactScope: "/Users/learner/reference.pdf",
      intendedAction: "Read the supporting lemma."
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = application.getState().sessions[0].accessRequests.at(-1)!;
    runtime.cancelError = new Error("interrupt request timed out");

    await expect(application.submit({
      type: "decideAccessRequest", requestId: request.id, decision: "approve"
    })).rejects.toThrow("Focused Access remains active");
    expect(application.getState().sessions[0]).toMatchObject({
      accessPolicy: "focused",
      accessRequests: [{ status: "pending", decidedPolicy: null }]
    });
    await expect(Promise.race([decision, Promise.resolve("still-pending")])).resolves.toBe("still-pending");

    runtime.cancelError = null;
    const approved = await application.submit({
      type: "decideAccessRequest", requestId: request.id, decision: "approve"
    });
    await expect(decision).resolves.toEqual({ status: "approved", policy: "full" });
    expect(approved.sessions[0]).toMatchObject({
      accessPolicy: "full",
      accessRequests: [{ status: "approved", decidedPolicy: "full" }]
    });
    runtime.completeTeaching(state.sessions[0].id);
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
    const migratedSession = migrated.getState().sessions[0];
    expect(migratedSession.sourceIds).toHaveLength(1);
    expect(migrated.getState().sources).toContainEqual(expect.objectContaining({
      id: migratedSession.sourceIds[0],
      kind: "managedAsset",
      content: "Prove that the square root of 3 is irrational."
    }));
  });

  it("rejects an invalid persisted source before its path can reach local source access", async () => {
    const { application, dataDirectory } = await launch();
    const created = await application.submit({ type: "createWorkspace", name: "Analysis" });
    await application.linkExternalAttachment(created.navigation.workspaceId, {
      name: "notes.txt",
      resourceType: "file",
      lastKnownPath: "/Users/learner/notes.txt",
      canonicalPath: "/Users/learner/notes.txt",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "opaque-bookmark" },
      fingerprint: { size: 12, modifiedAtMs: 1234 }
    });
    const statePath = join(dataDirectory, "learning-application.json");
    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    persisted.sources[0].link.lastKnownPath = "../../etc/passwd";
    await writeFile(statePath, JSON.stringify(persisted), "utf8");

    await expect(LearningApplication.launch(dataDirectory)).rejects.toThrow("Stored Linked Source is invalid");
  });

  it("rejects persisted Source Anchor references that contradict session ownership", async () => {
    const { application, dataDirectory } = await launch();
    const started = await application.submit({ type: "startQuickStudy", mathematics: "Use $a=b$." });
    const sourceId = started.sessions[0].sourceIds[0];
    await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "equation",
        equationIndex: 0,
        startOffset: 4,
        endOffset: 9,
        exactText: "$a=b$",
        prefix: "Use ",
        suffix: "."
      },
      paletteAction: "explain"
    });
    const statePath = join(dataDirectory, "learning-application.json");
    const valid = JSON.parse(await readFile(statePath, "utf8"));

    const invalidActiveAnchor = structuredClone(valid);
    invalidActiveAnchor.sessions[0].activeSourceAnchorId = "missing-anchor";
    await writeFile(statePath, JSON.stringify(invalidActiveAnchor), "utf8");
    await expect(LearningApplication.launch(dataDirectory)).rejects.toThrow("Stored Source Anchor references are invalid");

    const invalidRequest = structuredClone(valid);
    invalidRequest.sessions[0].sourceAnchorRequests[0].sourceAnchorId = "missing-anchor";
    await writeFile(statePath, JSON.stringify(invalidRequest), "utf8");
    await expect(LearningApplication.launch(dataDirectory)).rejects.toThrow("Stored Source Anchor references are invalid");

    const detachedSource = structuredClone(valid);
    detachedSource.sessions[0].sourceAnchors[0].sourceId = "other-source";
    await writeFile(statePath, JSON.stringify(detachedSource), "utf8");
    await expect(LearningApplication.launch(dataDirectory)).rejects.toThrow("Stored Source Anchor references are invalid");
  });

  it("rejects malformed persisted Session Access Policy state", async () => {
    const { application, dataDirectory } = await launch();
    const started = await application.submit({ type: "startQuickStudy", mathematics: "Check a proof." });
    await application.requestSessionAccess(started.activeSessionId!, {
      requestedPolicy: "full",
      reason: "A reference is missing.",
      exactScope: "/Users/learner/reference.pdf",
      intendedAction: "Read the reference."
    });
    const statePath = join(dataDirectory, "learning-application.json");
    const valid = JSON.parse(await readFile(statePath, "utf8"));

    await writeFile(statePath, JSON.stringify({ ...valid, accessConfirmationPreference: { confirmFullAccess: "no" } }), "utf8");
    await expect(LearningApplication.launch(dataDirectory)).rejects.toThrow("Stored Access Confirmation Preference is invalid");

    const invalidPolicy = structuredClone(valid);
    invalidPolicy.sessions[0].accessPolicy = "device";
    await writeFile(statePath, JSON.stringify(invalidPolicy), "utf8");
    await expect(LearningApplication.launch(dataDirectory)).rejects.toThrow("Stored Session Access Policy is invalid");

    const invalidRequest = structuredClone(valid);
    invalidRequest.sessions[0].accessRequests[0].status = "silentlyApproved";
    await writeFile(statePath, JSON.stringify(invalidRequest), "utf8");
    await expect(LearningApplication.launch(dataDirectory)).rejects.toThrow("Stored Access Request is invalid");
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

async function createPinnedArtifact(application: LearningApplication, runtime: DeterministicModelRuntime) {
  let state = await application.submit({
    type: "submitSessionIntake",
    mathematics: "Every compact subset of a Hausdorff space is closed."
  });
  runtime.completeTeaching();
  await application.waitForModelWork();
  state = await application.submit({
    type: "createSourceAnchor",
    sourceId: state.sessions[0].sourceIds[0],
    selection: {
      kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset",
      prefix: "Every ", suffix: " of a Hausdorff space is closed."
    },
    paletteAction: "explain"
  });
  runtime.emitTeaching("Use compactness to make the pointwise separation argument finite.");
  runtime.completeTeaching();
  await application.waitForModelWork();
  state = await application.submit({
    type: "pinTeachingCardArtifact",
    cardId: application.getState().sessions[0].anchoredTeachingCards[0].id
  });
  const artifact = state.sessions[0].learningArtifacts[0];
  return { artifactId: artifact.id, revision: structuredClone(artifact.currentRevision) };
}

class DeterministicSourceAccess implements LocalSourceAccess {
  readonly openedSourceIds: string[] = [];
  readonly indexedSourceIds: string[] = [];
  readonly snapshotSourceIds: string[] = [];
  readonly contentBySourceName = new Map<string, string>();
  readonly mediaTypeBySourceName = new Map<string, "text/plain" | "image/png">();
  readonly indexBySourceName = new Map<string, SourceIndexExtraction>();
  error: Error | null = null;
  fingerprint: SourceFingerprint = { size: 64, modifiedAtMs: 1234 };
  linkRefresh: Awaited<ReturnType<LocalSourceAccess["read"]>>["linkRefresh"];
  snapshotLinkRefresh: Awaited<ReturnType<LocalSourceAccess["read"]>>["linkRefresh"];
  indexFingerprint: SourceFingerprint | null = null;
  indexGate: Promise<void> | null = null;
  activeIndexExtractions = 0;
  maxConcurrentIndexExtractions = 0;
  snapshotGate: Promise<void> | null = null;
  activeSnapshots = 0;
  snapshotContent = "Every open cover has a finite subcover.";

  async read(source: LinkedSource) {
    this.openedSourceIds.push(source.id);
    if (this.error) throw this.error;
    return {
      sourceId: source.id,
      resourceType: source.resourceType,
      content: this.contentBySourceName.get(source.name) ?? "Every open cover has a finite subcover.",
      fingerprint: this.fingerprint,
      mediaType: this.mediaTypeBySourceName.get(source.name) ?? "text/plain",
      ...(this.linkRefresh ? { linkRefresh: this.linkRefresh } : {})
    };
  }

  async extractForIndex(source: LinkedSource): Promise<SourceIndexExtractionResult> {
    this.indexedSourceIds.push(source.id);
    if (this.error) throw this.error;
    this.activeIndexExtractions += 1;
    this.maxConcurrentIndexExtractions = Math.max(this.maxConcurrentIndexExtractions, this.activeIndexExtractions);
    try {
      if (this.indexGate) await this.indexGate;
      const extraction = this.indexBySourceName.get(source.name);
      if (!extraction) throw new Error("This source does not have indexable content.");
      const extractionFingerprint = this.indexFingerprint ?? this.fingerprint;
      if (this.indexFingerprint) this.fingerprint = this.indexFingerprint;
      return { ...structuredClone(extraction), fingerprint: extractionFingerprint };
    } finally {
      this.activeIndexExtractions -= 1;
    }
  }

  async snapshot(source: LinkedSource) {
    this.snapshotSourceIds.push(source.id);
    if (this.error) throw this.error;
    this.activeSnapshots += 1;
    try {
      if (this.snapshotGate) await this.snapshotGate;
      return {
        mediaType: "text/plain" as const,
        contentBase64: Buffer.from(this.snapshotContent).toString("base64"),
        fingerprint: this.fingerprint,
        ...(this.snapshotLinkRefresh ? { linkRefresh: this.snapshotLinkRefresh } : {})
      };
    } finally {
      this.activeSnapshots -= 1;
    }
  }
}

function textExtraction(text: string): SourceIndexExtraction {
  return {
    extractionMethod: "embeddedText",
    pages: [{
      pageNumber: 1,
      width: 1000,
      height: 1400,
      thumbnailDataUrl: "data:image/png;base64,c21hbGw=",
      regions: [{
        kind: "text",
        text,
        bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.05 },
        sourceStartOffset: 0,
        sourceEndOffset: text.length
      }]
    }]
  };
}

class DeterministicModelRuntime implements ModelRuntime {
  readonly teachingRequests: TeachingRequest[] = [];
  readonly specialistRequests: SpecialistAgentRequest[] = [];
  readonly artifactSynthesisRequests: ArtifactSynthesisRequest[] = [];
  readonly conceptPeekRequests: Parameters<ModelRuntime["createConceptPeek"]>[0][] = [];
  readonly canceledSessionIds: string[] = [];
  private readonly teachingCompletions = new Map<TeachingRequest, () => void>();
  private readonly teachingFailures = new Map<TeachingRequest, (error: Error) => void>();
  private specialistCompletion: ((result: SpecialistAgentResult) => void) | null = null;
  private specialistFailure: ((error: Error) => void) | null = null;
  authentication: Awaited<ReturnType<ModelRuntime["getAuthentication"]>> = {
    status: "signedIn",
    method: "chatgpt",
    accountLabel: "learner@example.com"
  };
  chatGptLoginStarts = 0;
  readonly receivedApiKeys: string[] = [];
  proposalError: Error | null = null;
  authenticationError: Error | null = null;
  cancelError: Error | null = null;
  artifactSynthesisError: Error | null = null;
  completeTeachingOnCancel = true;
  teachingDeltaOnStart: string | null = null;
  holdConceptPeek = false;
  holdArtifactSynthesis = false;

  constructor(private readonly proposal: SessionProposal, private readonly holdTeaching = false) {}

  async getAuthentication() {
    if (this.authenticationError) throw this.authenticationError;
    return this.authentication;
  }

  async startChatGptLogin() {
    this.chatGptLoginStarts += 1;
    return { loginId: "login-1", authUrl: "https://auth.example.test" };
  }

  async loginWithApiKey(apiKey: string) {
    this.receivedApiKeys.push(apiKey);
  }

  async proposeSession(mathematics: string, onRuntimeEvent?: TeachingRequest["onRuntimeEvent"]): Promise<SessionProposal> {
    if (this.proposalError) throw this.proposalError;
    onRuntimeEvent?.({ type: "threadStarted", threadId: "proposal-thread", turnId: null, detail: "Thread started." });
    onRuntimeEvent?.({ type: "inputSubmitted", threadId: "proposal-thread", turnId: "proposal-turn", detail: mathematics });
    onRuntimeEvent?.({ type: "turnCompleted", threadId: "proposal-thread", turnId: "proposal-turn", detail: JSON.stringify(this.proposal) });
    return this.proposal;
  }

  async createConceptPeek(request: Parameters<ModelRuntime["createConceptPeek"]>[0]): Promise<string> {
    this.conceptPeekRequests.push(request);
    request.onRuntimeEvent?.({ type: "threadStarted", threadId: "peek-thread", turnId: null, detail: "Thread started." });
    if (this.holdConceptPeek) {
      if (request.signal.aborted) throw new Error("Concept Peek aborted.");
      await new Promise<void>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("Concept Peek aborted.")), { once: true });
      });
    }
    request.onRuntimeEvent?.({ type: "turnCompleted", threadId: "peek-thread", turnId: "peek-turn", detail: "Completed." });
    if (request.prerequisite === "Hausdorff separation") {
      return "A Hausdorff space lets any two distinct points be enclosed in disjoint open neighbourhoods. At this Source Anchor, that separation is what turns compactness into the closed-set conclusion.";
    }
    if (request.prerequisite === "product topology") {
      return "The product topology is generated by products of open sets, with only finitely many factors restricted in a basic neighbourhood. This makes the diagonal criterion a statement about separating distinct coordinate pairs.";
    }
    return `Use the defining property of ${request.prerequisite} at this Source Anchor before continuing the argument.`;
  }

  async streamTeaching(request: TeachingRequest): Promise<void> {
    this.teachingRequests.push(request);
    request.onRuntimeEvent?.({ type: "threadStarted", threadId: `thread-${request.sessionId}`, turnId: null, detail: "Thread started." });
    request.onRuntimeEvent?.({ type: "turnStarted", threadId: `thread-${request.sessionId}`, turnId: `turn-${request.sessionId}`, detail: "Turn started." });
    if (this.teachingDeltaOnStart !== null) request.onDelta(this.teachingDeltaOnStart);
    if (this.holdTeaching) {
      await new Promise<void>((resolve, reject) => {
        this.teachingCompletions.set(request, resolve);
        this.teachingFailures.set(request, reject);
      });
    }
  }

  async runSpecialistAgent(request: SpecialistAgentRequest): Promise<SpecialistAgentResult> {
    this.specialistRequests.push(request);
    request.onStatus("working", null);
    request.onRuntimeEvent?.({ type: "threadStarted", workKind: "specialist", threadId: "specialist-thread", turnId: null, detail: "Specialist thread started." });
    request.onRuntimeEvent?.({ type: "turnStarted", workKind: "specialist", threadId: "specialist-thread", turnId: "specialist-turn", detail: "Specialist turn started." });
    request.onRuntimeEvent?.({ type: "inputSubmitted", workKind: "specialist", threadId: "specialist-thread", turnId: "specialist-turn", detail: JSON.stringify(request.brief) });
    return new Promise<SpecialistAgentResult>((resolve, reject) => {
      this.specialistCompletion = resolve;
      this.specialistFailure = reject;
    });
  }

  async synthesizeArtifact(request: ArtifactSynthesisRequest) {
    this.artifactSynthesisRequests.push(request);
    if (this.artifactSynthesisError) throw this.artifactSynthesisError;
    if (this.holdArtifactSynthesis) {
      if (request.signal.aborted) throw new Error("Learning Artifact synthesis aborted.");
      await new Promise<void>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(new Error("Learning Artifact synthesis aborted.")), { once: true });
      });
    }
    return {
      content: request.personalNotes.length > 0
        ? `${request.artifactContent} The learner connects this to a finite-choice picture.`
        : `${request.artifactContent} No Personal Notes were supplied.`,
      noteInterpretations: request.personalNotes.map((note) => ({
        annotationId: note.annotationId,
        interpretation: "The learner connects compactness with reducing local choices to finitely many."
      }))
    };
  }

  emitTeaching(delta: string) {
    const request = this.teachingRequests.at(-1);
    request?.onDelta(delta);
    request?.onRuntimeEvent?.({
      type: "outputDelta",
      threadId: `thread-${request.sessionId}`,
      turnId: `turn-${request.sessionId}`,
      detail: `Received ${delta.length} characters.`
    });
  }

  requestAccess(details: RuntimeAccessRequest) {
    const request = this.teachingRequests.at(-1);
    if (!request) throw new Error("Start teaching before requesting access.");
    return request.onAccessRequest(details);
  }

  completeTeaching(sessionId = this.teachingRequests.at(-1)?.sessionId) {
    const request = [...this.teachingRequests].reverse().find((candidate) => candidate.sessionId === sessionId);
    if (request) this.completeTeachingRequest(request);
  }

  completeTeachingRequest(request: TeachingRequest) {
    request.onRuntimeEvent?.({
      type: "turnCompleted",
      threadId: `thread-${request.sessionId}`,
      turnId: `turn-${request.sessionId}`,
      detail: "Turn completed."
    });
    this.teachingCompletions.get(request)?.();
  }

  failTeaching(error: Error, sessionId = this.teachingRequests.at(-1)?.sessionId) {
    const request = [...this.teachingRequests].reverse().find((candidate) => candidate.sessionId === sessionId);
    if (request) this.teachingFailures.get(request)?.(error);
  }

  completeSpecialist(result: SpecialistAgentResult) {
    this.specialistRequests.at(-1)?.onRuntimeEvent?.({
      type: "turnCompleted", workKind: "specialist", threadId: "specialist-thread", turnId: "specialist-turn", detail: "Specialist turn completed."
    });
    this.specialistCompletion?.(result);
  }

  waitSpecialist(message: string) {
    this.specialistRequests.at(-1)?.onStatus("waiting", message);
  }

  emitSpecialistPartial(content: string) {
    const request = this.specialistRequests.at(-1);
    request?.onPartialResult(content);
    request?.onRuntimeEvent?.({ type: "toolCalled", workKind: "specialist", threadId: "specialist-thread", turnId: "specialist-turn", detail: content });
  }

  failSpecialist(error: Error) {
    this.specialistRequests.at(-1)?.onRuntimeEvent?.({
      type: "turnFailed", workKind: "specialist", threadId: "specialist-thread", turnId: "specialist-turn", detail: error.message
    });
    this.specialistFailure?.(error);
  }

  async cancelTeaching(sessionId: string) {
    this.canceledSessionIds.push(sessionId);
    if (this.cancelError) throw this.cancelError;
    if (this.completeTeachingOnCancel) this.completeTeaching(sessionId);
    this.specialistCompletion?.({ title: "Stopped", content: "Stopped" });
  }

  async shutdown() {}
}
