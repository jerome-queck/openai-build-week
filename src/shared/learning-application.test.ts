import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LearningApplication,
  type AcceptedFormalVerification,
  type ClaimCheckRecord,
  type FormalVerificationAuthority,
  type LinkedSource,
  type LocalSourceAccess,
  type SelectedLocalSource,
  type SourceIndexExtraction,
  type SourceIndexExtractionResult,
  type SourceFingerprint
} from "./learning-application";
import { ModelAccessError, type ArtifactRegenerationRequest, type ArtifactSynthesisRequest, type ModelAccessCause, type ModelRuntime, type RuntimeAccessRequest, type SessionProposal, type SpecialistAgentRequest, type SpecialistAgentResult, type TeachingRequest } from "./model-runtime";
import type { CorroborationResearchEvidence, ExternalResearch, ExternalResearchRequest, ExternalResearchResult } from "./external-research";
import {
  BUNDLED_LEAN_ENVIRONMENT,
  type VerifierEnvironmentManager,
  type VerifierRuntime
} from "./verifier-runtime";

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

  it("governs a durable Learner Model inference without rewriting its source Session Record", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain the finite-subcover step",
      initialTeachingDirection: "Start from Hausdorff separation", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Show that a compact subset of a Hausdorff space is closed."
    });
    runtime.emitTeaching("Use Hausdorff separation and compactness.");
    runtime.completeTeaching();
    await application.waitForModelWork();

    state = await application.submit({
      type: "offerUnderstandingCheck",
      kind: "apply",
      prompt: "Explain how compactness produces one neighbourhood of the outside point.",
      concept: "finite subcover",
      representation: "proofStructural",
      evidenceTransferContext: {
        concepts: ["finite subcover"],
        mathematicalStructures: ["compact Hausdorff subspace"],
        prerequisiteRelationships: [{
          prerequisiteConcept: "Hausdorff separation", supportsConcept: "finite subcover", relationship: "requiredFor"
        }],
        taskDemands: ["apply a finite-subcover argument"]
      }
    });
    const checkId = state.sessions[0].understandingChecks[0].id;
    state = await application.submit({
      type: "recordUnderstandingEvidence",
      checkId,
      response: "Choose one neighbourhood for each point, then use a finite subcover.",
      interpretation: "secureUnderstanding",
      confidence: "high"
    });

    expect(state.learnerModel.adaptiveReuseEnabled).toBe(true);
    expect(state.learnerModel.entries).toHaveLength(1);
    const entry = state.learnerModel.entries[0];
    expect(entry).toMatchObject({
      kind: "understandingEvidence",
      inference: "secure understanding",
      confidence: "high",
      status: "active",
      sourceEvidence: {
        sessionId: state.sessions[0].id,
        evidenceIds: [state.sessions[0].understandingEvidence[0].id],
        summary: "Choose one neighbourhood for each point, then use a finite subcover."
      },
      mathematicalContext: {
        concepts: ["finite subcover"],
        mathematicalStructures: ["compact Hausdorff subspace"],
        prerequisiteRelationships: [{
          prerequisiteConcept: "Hausdorff separation", supportsConcept: "finite subcover", relationship: "requiredFor"
        }],
        taskDemands: ["apply a finite-subcover argument"]
      },
      scope: {
        workspaceId: state.sessions[0].workspaceId,
        missionId: state.sessions[0].missionId,
        sessionId: state.sessions[0].id,
        sessionTarget: "Explain the finite-subcover step"
      },
      correction: null,
      createdAt: expect.any(String),
      lastUpdatedAt: expect.any(String)
    });
    const historicalEvidence = structuredClone(state.sessions[0].understandingEvidence);

    state = await application.submit({
      type: "correctLearnerModelInference",
      entryId: entry.id,
      correction: "This response repeated the method but did not justify the shared outside neighbourhood."
    });
    expect(state.learnerModel.entries[0]).toMatchObject({
      status: "corrected",
      correction: "This response repeated the method but did not justify the shared outside neighbourhood.",
      governanceHistory: [{
        action: "corrected",
        note: "This response repeated the method but did not justify the shared outside neighbourhood."
      }]
    });
    expect(state.sessions[0].understandingEvidence).toEqual(historicalEvidence);
    await application.submit({ type: "submitQuestion", text: "What should I do next?" });
    expect(runtime.teachingRequests.at(-1)?.adaptiveTeaching).toBeUndefined();
    runtime.completeTeaching();
    await application.waitForModelWork();

    state = await application.submit({
      type: "offerUnderstandingCheck", kind: "diagnose", prompt: "Locate the remaining gap.",
      concept: "finite subcover", representation: "proofStructural"
    });
    state = await application.submit({
      type: "recordUnderstandingEvidence",
      checkId: state.sessions[0].understandingChecks.at(-1)!.id,
      response: "The finite intersection must still be a neighbourhood of the outside point.",
      interpretation: "specificGap"
    });
    const completeHistoricalEvidence = structuredClone(state.sessions[0].understandingEvidence);
    state = await application.submit({ type: "excludeLearnerModelInference", entryId: entry.id });
    expect(state.learnerModel.entries[0]).toMatchObject({
      status: "excluded",
      correction: "This response repeated the method but did not justify the shared outside neighbourhood.",
      governanceHistory: [{ action: "corrected" }, { action: "excluded" }]
    });
    state = await application.submit({ type: "deleteLearnerModelInference", entryId: entry.id });
    expect(state.learnerModel.entries).toHaveLength(1);
    expect(state.sessions[0].understandingEvidence).toEqual(completeHistoricalEvidence);

    state = await application.submit({ type: "setAdaptiveReusePreference", enabled: false });
    state = await application.submit({ type: "resetLearnerModel" });
    expect(state.learnerModel).toMatchObject({
      entries: [],
      adaptiveReuseEnabled: false,
      lastResetAt: expect.any(String)
    });
    expect(state.sessions[0].understandingEvidence).toEqual(completeHistoricalEvidence);

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().learnerModel.entries).toEqual(state.learnerModel.entries);
    expect(relaunched.getState().sessions[0].understandingEvidence).toEqual(completeHistoricalEvidence);
  });

  it("transfers only fully matched evidence and honors per-session ignore and ledger exclusion", async () => {
    const matchingContext = {
      concepts: ["finite subcover"],
      mathematicalStructures: ["compact Hausdorff subspace"],
      prerequisiteRelationships: [{
        prerequisiteConcept: "Hausdorff separation", supportsConcept: "finite subcover", relationship: "requiredFor" as const
      }],
      taskDemands: ["apply a finite-subcover argument"]
    };
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Apply compactness", scope: "Build a finite-subcover argument",
      initialTeachingDirection: "Relate local separation to a finite choice", requiresConfirmation: false,
      confirmationReason: null, evidenceTransferContext: matchingContext
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Show that a compact subset of a Hausdorff space is closed."
    });
    runtime.emitTeaching("Use separation and compactness.");
    runtime.completeTeaching();
    await application.waitForModelWork();

    const recordEvidence = async (context: typeof matchingContext, response: string) => {
      state = await application.submit({
        type: "offerUnderstandingCheck", kind: "apply", prompt: "Explain the finite step.",
        concept: "finite subcover", representation: "proofStructural", evidenceTransferContext: context
      });
      state = await application.submit({
        type: "recordUnderstandingEvidence",
        checkId: state.sessions[0].understandingChecks.at(-1)!.id,
        response,
        interpretation: "secureUnderstanding",
        confidence: "high"
      });
    };
    await recordEvidence(matchingContext, "Compactness reduces the neighbourhood family to finitely many choices.");
    state = await application.submit({
      type: "startTeachingExperiment", route: "visual", reason: "Test a finite-neighbourhood diagram."
    });
    state = await application.submit({
      type: "completeTeachingExperiment", experimentId: state.sessions[0].teachingExperiments[0].id, outcome: "helpful"
    });
    const transferredPreferenceEntryId = state.learnerModel.entries.at(-1)!.id;
    await recordEvidence({
      concepts: ["finite subcover"],
      mathematicalStructures: ["normed vector space"],
      prerequisiteRelationships: [{
        prerequisiteConcept: "open balls", supportsConcept: "finite subcover", relationship: "requiredFor"
      }],
      taskDemands: ["recall a definition"]
    }, "A finite subcover has finitely many members.");
    await recordEvidence({
      concepts: ["finite subcover"],
      mathematicalStructures: ["compact Hausdorff subspace"],
      prerequisiteRelationships: [{
        prerequisiteConcept: "Hausdorff separation", supportsConcept: "open-cover definition", relationship: "requiredFor"
      }],
      taskDemands: ["apply a finite-subcover argument"]
    }, "The same prerequisite name appears here, but it supports a different mathematical step.");

    state = await application.submit({
      type: "submitSessionIntake", mathematics: "Use the same theorem in another question.", ignoreLearnerModel: true
    });
    const sameMissionSession = state.sessions.find((session) => session.id === state.activeSessionId)!;
    expect(sameMissionSession.evidenceTransfers).toEqual([]);
    expect(sameMissionSession.priorUnderstandingEvidence).toHaveLength(1);
    expect(sameMissionSession.interactionPreferenceReuses).toHaveLength(1);
    expect(runtime.teachingRequests.at(-1)?.learnerModelGuidance).toBeUndefined();
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({ type: "setSessionLearnerModelIgnored", ignored: false });
    await application.submit({ type: "submitQuestion", text: "Use qualified evidence from this mission." });
    expect(runtime.teachingRequests.at(-1)?.learnerModelGuidance).toEqual({
      evidenceTransfers: [],
      priorUnderstandingEvidence: [expect.objectContaining({
        learnerModelEntryId: state.learnerModel.entries[0].id,
        origin: "priorSession"
      })],
      interactionPreferences: [expect.objectContaining({
        learnerModelEntryId: transferredPreferenceEntryId,
        origin: "interactionPreference"
      })]
    });
    runtime.completeTeaching();
    await application.waitForModelWork();

    state = await application.submit({ type: "createWorkspace", name: "General topology" });
    const targetWorkspaceId = state.navigation.workspaceId;
    state = await application.submit({ type: "createMission", workspaceId: targetWorkspaceId, name: "Tube lemma" });
    const targetMissionId = state.navigation.missionId!;

    state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Prove the tube lemma using compactness in the second factor.",
      ignoreLearnerModel: true,
      location: { workspaceId: targetWorkspaceId, missionId: targetMissionId }
    });
    const target = state.sessions.find((session) => session.id === state.activeSessionId)!;
    expect(target.evidenceTransfers).toHaveLength(1);
    expect(target.priorUnderstandingEvidence).toEqual([]);
    expect(target.interactionPreferenceReuses).toHaveLength(1);
    expect(target.evidenceTransfers[0]).toMatchObject({
      origin: "transferred",
      learnerModelEntryId: state.learnerModel.entries[0].id,
      sourceSessionId: state.sessions[0].id,
      sourceRecordId: state.sessions[0].understandingEvidence[0].id,
      inference: "secure understanding",
      confidence: "high",
      sourceContext: matchingContext,
      targetContext: matchingContext
    });
    expect(target.ignoreLearnerModel).toBe(true);
    expect(runtime.teachingRequests.at(-1)?.learnerModelGuidance).toBeUndefined();

    runtime.emitTeaching("Initial teaching omitted the Learner Model.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({ type: "setSessionLearnerModelIgnored", ignored: false });
    await application.submit({ type: "submitQuestion", text: "Now use qualified prior evidence." });
    expect(runtime.teachingRequests.at(-1)?.learnerModelGuidance).toEqual({
      evidenceTransfers: [expect.objectContaining({
        learnerModelEntryId: state.learnerModel.entries[0].id,
        origin: "transferred"
      })],
      priorUnderstandingEvidence: [],
      interactionPreferences: [expect.objectContaining({
        learnerModelEntryId: transferredPreferenceEntryId,
        origin: "interactionPreference"
      })]
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({ type: "setSessionLearnerModelIgnored", ignored: true });
    expect(state.learnerModel.adaptiveReuseEnabled).toBe(true);
    expect(state.sessions.find((session) => session.id === state.activeSessionId)?.ignoreLearnerModel).toBe(true);
    await application.submit({ type: "submitQuestion", text: "Why does the finite choice work here?" });
    expect(runtime.teachingRequests.at(-1)?.learnerModelGuidance).toBeUndefined();
    runtime.completeTeaching();
    await application.waitForModelWork();

    await application.submit({ type: "setSessionLearnerModelIgnored", ignored: false });
    state = await application.submit({ type: "setAdaptiveReusePreference", enabled: false });
    expect(state.learnerModel.adaptiveReuseEnabled).toBe(false);
    await application.submit({ type: "submitQuestion", text: "Explain without cross-session evidence." });
    expect(runtime.teachingRequests.at(-1)?.learnerModelGuidance).toBeUndefined();
    runtime.completeTeaching();
    await application.waitForModelWork();

    await application.submit({ type: "setAdaptiveReusePreference", enabled: true });
    await application.submit({
      type: "excludeLearnerModelInference",
      entryId: state.learnerModel.entries[0].id
    });
    await application.submit({ type: "submitQuestion", text: "Try a different explanation." });
    expect(runtime.teachingRequests.at(-1)?.learnerModelGuidance).toBeUndefined();
    runtime.completeTeaching();
    await application.waitForModelWork();

    state = await application.submit({ type: "setSessionLearnerModelIgnored", ignored: true });
    state = await application.submit({ type: "setAdaptiveReusePreference", enabled: false });
    const targetSessionId = state.activeSessionId!;
    await application.shutdown();
    const resumedRuntime = new DeterministicModelRuntime({
      learningGoal: "Unused", scope: "Unused", initialTeachingDirection: "Unused",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const relaunched = await LearningApplication.launch(dataDirectory, resumedRuntime);
    applications.push(relaunched);
    const restoredTarget = relaunched.getState().sessions.find((session) => session.id === targetSessionId)!;
    expect(relaunched.getState().learnerModel.adaptiveReuseEnabled).toBe(false);
    expect(restoredTarget.ignoreLearnerModel).toBe(true);
    expect(restoredTarget.evidenceTransfers).toEqual(state.sessions.find((session) => session.id === targetSessionId)!.evidenceTransfers);
    expect(restoredTarget.priorUnderstandingEvidence).toEqual(
      state.sessions.find((session) => session.id === targetSessionId)!.priorUnderstandingEvidence
    );
    expect(restoredTarget.interactionPreferenceReuses).toEqual(
      state.sessions.find((session) => session.id === targetSessionId)!.interactionPreferenceReuses
    );
    expect(relaunched.getState().learnerModel.entries[0].status).toBe("excluded");

    await relaunched.submit({ type: "resumeSession", sessionId: targetSessionId });
    await relaunched.submit({ type: "setAdaptiveReusePreference", enabled: true });
    await relaunched.submit({ type: "setSessionLearnerModelIgnored", ignored: false });
    await relaunched.submit({ type: "submitQuestion", text: "Confirm excluded evidence stays inactive after reload." });
    expect(resumedRuntime.teachingRequests.at(-1)?.learnerModelGuidance).toBeUndefined();
    resumedRuntime.completeTeaching();
    await relaunched.waitForModelWork();

    const deletedEntryId = relaunched.getState().learnerModel.entries[0].id;
    const historicalTransfers = structuredClone(restoredTarget.evidenceTransfers);
    const historicalPreferences = structuredClone(restoredTarget.interactionPreferenceReuses);
    await relaunched.submit({ type: "deleteLearnerModelInference", entryId: deletedEntryId });
    await relaunched.shutdown();

    const afterDeleteRuntime = new DeterministicModelRuntime({
      learningGoal: "Unused", scope: "Unused", initialTeachingDirection: "Unused",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const afterDelete = await LearningApplication.launch(dataDirectory, afterDeleteRuntime);
    applications.push(afterDelete);
    const targetAfterDelete = afterDelete.getState().sessions.find((session) => session.id === targetSessionId)!;
    expect(afterDelete.getState().learnerModel.entries.some((entry) => entry.id === deletedEntryId)).toBe(false);
    expect(targetAfterDelete.evidenceTransfers).toEqual(historicalTransfers);
    expect(targetAfterDelete.interactionPreferenceReuses).toEqual(historicalPreferences);
    await afterDelete.submit({ type: "resumeSession", sessionId: targetSessionId });
    await afterDelete.submit({ type: "submitQuestion", text: "Confirm deleted evidence stays inactive after reload." });
    expect(afterDeleteRuntime.teachingRequests.at(-1)?.learnerModelGuidance).toBeUndefined();
    afterDeleteRuntime.completeTeaching();
    await afterDelete.waitForModelWork();

    await afterDelete.submit({ type: "resetLearnerModel" });
    await afterDelete.shutdown();
    const afterReset = await LearningApplication.launch(dataDirectory);
    applications.push(afterReset);
    const targetAfterReset = afterReset.getState().sessions.find((session) => session.id === targetSessionId)!;
    expect(afterReset.getState().learnerModel.entries).toEqual([]);
    expect(targetAfterReset.evidenceTransfers).toEqual(historicalTransfers);
    expect(targetAfterReset.interactionPreferenceReuses).toEqual(historicalPreferences);
  });

  it("migrates existing Understanding Evidence into a conservative Learner Model Ledger", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain the proof",
      initialTeachingDirection: "Start from separation", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({ type: "submitSessionIntake", mathematics: "Prove compact subsets are closed." });
    runtime.emitTeaching("Separate the outside point, then use compactness.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({
      type: "offerUnderstandingCheck", kind: "explain", prompt: "Explain the compactness step.",
      concept: "finite subcover", representation: "proofStructural"
    });
    state = await application.submit({
      type: "recordUnderstandingEvidence", checkId: state.sessions[0].understandingChecks[0].id,
      response: "A finite subcover reduces the family to finitely many neighbourhoods.",
      interpretation: "secureUnderstanding", confidence: "high"
    });
    await application.shutdown();
    const persisted = JSON.parse(await readFile(join(dataDirectory, "learning-application.json"), "utf8")) as Record<string, unknown>;
    delete persisted.learnerModel;
    await writeFile(join(dataDirectory, "learning-application.json"), JSON.stringify(persisted), "utf8");

    const migrated = await LearningApplication.launch(dataDirectory);
    applications.push(migrated);
    expect(migrated.getState().learnerModel).toMatchObject({
      adaptiveReuseEnabled: true,
      entries: [{
        id: `legacy-understanding-evidence-${state.sessions[0].understandingEvidence[0].id}`,
        kind: "understandingEvidence",
        inference: "secure understanding",
        confidence: "low",
        sourceEvidence: {
          sessionId: state.sessions[0].id,
          evidenceIds: [state.sessions[0].understandingEvidence[0].id]
        }
      }]
    });
  });

  it("records skippable reasoning checks as contextual Understanding Evidence and explains the adaptive next Teaching Move", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain the proof", initialTeachingDirection: "Start from separation",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Show that a compact subset of a Hausdorff space is closed."
    });
    await expect(application.submit({
      type: "offerUnderstandingCheck", kind: "apply", prompt: "Try the separation step.",
      concept: "compactness in Hausdorff spaces", representation: "proofStructural"
    })).rejects.toThrow("Complete a substantive Teaching Card");
    runtime.emitTeaching("Use Hausdorff separation and compactness.");
    runtime.completeTeaching();
    await application.waitForModelWork();

    state = await application.submit({
      type: "offerUnderstandingCheck",
      kind: "apply",
      prompt: "Which separation property would you use for a point outside the compact set, and why?",
      concept: "compactness in Hausdorff spaces",
      representation: "proofStructural"
    });
    const check = state.sessions[0].understandingChecks[0];
    expect(check).toMatchObject({
      kind: "apply",
      status: "offered",
      concept: "compactness in Hausdorff spaces",
      representation: "proofStructural"
    });

    state = await application.submit({
      type: "recordUnderstandingEvidence",
      checkId: check.id,
      response: "I would use Hausdorff separation, but I do not see how to make finitely many neighbourhoods.",
      interpretation: "specificGap"
    });
    const adapted = state.sessions[0];
    expect(adapted.understandingEvidence).toHaveLength(1);
    expect(adapted.understandingEvidence[0]).toMatchObject({
      checkId: check.id,
      concept: "compactness in Hausdorff spaces",
      task: adapted.sessionTarget,
      representation: "proofStructural",
      elicitingTeachingMoveId: adapted.teachingMoves[0].id,
      interpretation: "specificGap"
    });
    expect(adapted.currentTeachingMove).toMatchObject({
      kind: "demonstrate",
      reason: expect.stringContaining("specific gap")
    });
    await application.submit({ type: "submitQuestion", text: "Show me the finite-subcover step." });
    expect(runtime.teachingRequests.at(-1)?.adaptiveTeaching).toEqual({
      kind: "demonstrate",
      route: "proofStructural",
      reason: adapted.currentTeachingMove.reason
    });
    runtime.completeTeaching();
    await application.waitForModelWork();

    state = await application.submit({
      type: "offerUnderstandingCheck",
      kind: "diagnose",
      prompt: "Identify the missing step in this proof outline.",
      concept: "compactness in Hausdorff spaces",
      representation: "proofStructural"
    });
    const skippable = state.sessions[0].understandingChecks[1];
    state = await application.submit({ type: "skipUnderstandingCheck", checkId: skippable.id });
    expect(state.sessions[0].understandingChecks[1].status).toBe("skipped");
    expect(state.sessions[0].understandingEvidence).toHaveLength(1);

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].understandingEvidence).toEqual(state.sessions[0].understandingEvidence);
    expect(relaunched.getState().sessions[0].understandingChecks[1].status).toBe("skipped");
  });

  it("keeps representation preferences contextual and lets the learner correct adaptation or test another route", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain the proof", initialTeachingDirection: "Start from separation",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Explain why every compact subset of a Hausdorff space is closed."
    });
    runtime.emitTeaching("Use disjoint neighbourhoods and a finite subcover.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({
      type: "offerUnderstandingCheck",
      kind: "explain",
      prompt: "Explain the finite-subcover step in your own words.",
      concept: "compactness",
      representation: "proofStructural"
    });
    const checkId = state.sessions[0].understandingChecks[0].id;
    state = await application.submit({
      type: "recordUnderstandingEvidence",
      checkId,
      response: "I can explain the finite-subcover step.",
      interpretation: "secureUnderstanding"
    });
    expect(state.sessions[0].currentTeachingMove).toMatchObject({ kind: "apply" });

    state = await application.submit({
      type: "startTeachingExperiment",
      route: "visual",
      reason: "Try a neighbourhood picture before another proof-structural explanation."
    });
    const experiment = state.sessions[0].teachingExperiments[0];
    expect(state.sessions[0].currentTeachingMove).toMatchObject({ kind: "visualize", experimentId: experiment.id });

    state = await application.submit({
      type: "completeTeachingExperiment",
      experimentId: experiment.id,
      outcome: "helpful"
    });
    expect(state.sessions[0].interactionPreferences[0]).toMatchObject({
      route: "visual",
      context: { concept: "compactness", task: state.sessions[0].sessionTarget },
      status: "supported"
    });
    const preferenceEntry = state.learnerModel.entries.at(-1)!;
    expect(preferenceEntry).toMatchObject({
      kind: "interactionPreference",
      inference: "visual route supported",
      confidence: "medium",
      status: "active",
      sourceEvidence: {
        sessionId: state.sessions[0].id,
        evidenceIds: [state.sessions[0].understandingEvidence[0].id],
        summary: "The visual Teaching Experiment was helpful for this context."
      },
      mathematicalContext: {
        concepts: ["compactness"],
        mathematicalStructures: [],
        prerequisiteRelationships: [],
        taskDemands: [state.sessions[0].sessionTarget]
      }
    });
    await application.submit({ type: "excludeLearnerModelInference", entryId: preferenceEntry.id });
    await application.submit({ type: "submitQuestion", text: "Choose the next route without that preference." });
    expect(runtime.teachingRequests.at(-1)?.adaptiveTeaching).toBeUndefined();
    runtime.completeTeaching();
    await application.waitForModelWork();

    state = await application.submit({
      type: "correctUnderstandingEvidence",
      evidenceId: state.sessions[0].understandingEvidence[0].id,
      interpretation: "excessivePace",
      correction: "I recognized the step, but the pace hid why compactness supplies the finite cover."
    });
    expect(state.sessions[0].understandingEvidence[0]).toMatchObject({
      interpretation: "excessivePace",
      learnerCorrection: "I recognized the step, but the pace hid why compactness supplies the finite cover."
    });
    expect(state.sessions[0].currentTeachingMove).toMatchObject({
      kind: "slowDown",
      reason: expect.stringContaining("corrected")
    });
    expect(state.sessions[0].trailDraft.items.find((item) => item.links.understandingEvidenceIds.length > 0)?.content)
      .toBe("Understanding Evidence for compactness: excessive pace.");
  });

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

  async function scheduleDelayedTransfer(application: LearningApplication, dueAt: string) {
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Show that a compact subset of a Hausdorff space is closed."
    });
    const sessionId = state.activeSessionId!;
    await application.submit({ type: "beginSessionConsolidation" });
    await application.submit({
      type: "reviseSessionConsolidation",
      centralInsight: "Compactness reduces pointwise choices to finitely many.",
      learningProgress: "I can identify the finite-subcover step.",
      unresolvedQuestions: [],
      nextStep: "Apply the structure after a delay.",
      includedArtifactIds: [],
      targetDisposition: "addressed"
    });
    await application.submit({ type: "consolidateSession" });
    state = await application.submit({
      type: "scheduleDelayedTransfer",
      sessionId,
      intendedTransferGoal: "Apply the finite-subcover structure to a new argument.",
      dueAt
    });
    return { sessionId, checkId: state.delayedTransferChecks.at(-1)!.id };
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

  async function launchWithExternalResearch(externalResearch: ExternalResearch) {
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(dataDirectory, null, null, null, externalResearch);
    applications.push(application);
    return { dataDirectory, application };
  }

  async function launchWithRuntimeAndExternalResearch(
    runtime: ModelRuntime,
    externalResearch: ExternalResearch,
    formalVerificationAuthority: FormalVerificationAuthority | null = null
  ) {
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(
      dataDirectory, runtime, null, null, externalResearch, formalVerificationAuthority
    );
    applications.push(application);
    return { dataDirectory, application };
  }

  async function launchWithRuntimeSourceAccessAndExternalResearch(
    runtime: ModelRuntime, sourceAccess: LocalSourceAccess, externalResearch: ExternalResearch
  ) {
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(dataDirectory, runtime, sourceAccess, null, externalResearch);
    applications.push(application);
    return { dataDirectory, application };
  }

  async function launchWithExternalResearchAndSourceAccess(
    externalResearch: ExternalResearch,
    sourceAccess: LocalSourceAccess
  ) {
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(dataDirectory, null, sourceAccess, null, externalResearch);
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
    state = await application.submit({ type: "synthesizeLearningArtifact", artifactId, confirmWholeArtifact: true });

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
      claims: [expect.objectContaining({ claimOrigin: "mixed" })],
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

    const synthesizedArtifact = state.sessions[0].learningArtifacts[0];
    const synthesizedContribution = structuredClone(synthesizedArtifact.currentRevision.personalNoteContributions[0]);
    runtime.artifactRegenerationResult = {
      replacementContent: `${synthesizedArtifact.currentRevision.content} Clarified without rewriting the note.`,
      claimEdits: [{
        claimId: synthesizedArtifact.currentRevision.claims[0].claimId,
        statement: `${synthesizedArtifact.currentRevision.claims[0].claimStatement} Clarified.`
      }],
      claimImpacts: [{
        claimId: synthesizedArtifact.currentRevision.claims[0].claimId,
        effect: "changed", changedAspects: ["text"]
      }],
      unresolvedRepairs: []
    };
    state = await application.submit({
      type: "previewLearningArtifactRegeneration", artifactId, scope: "section",
      selection: { startOffset: 0, endOffset: synthesizedArtifact.currentRevision.content.length },
      instruction: "Clarify the synthesized section without rewriting the Personal Note."
    });
    state = await application.submit({
      type: "applyLearningArtifactRegeneration", artifactId,
      proposalId: state.sessions[0].learningArtifacts[0].pendingRegenerationProposal!.id,
      confirmClaimImpact: true
    });
    expect(state.sessions[0].annotations[0]).toEqual(originalAnnotation);
    expect(state.sessions[0].learningArtifacts[0].currentRevision.personalNoteContributions)
      .toEqual([synthesizedContribution]);

    state = await application.submit({ type: "setPersonalNoteSynthesis", enabled: false });
    expect(state.personalNoteSynthesisPreference.includePersonalNotes).toBe(false);
    state = await application.submit({ type: "synthesizeLearningArtifact", artifactId, confirmWholeArtifact: true });
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

    await expect(application.submit({ type: "synthesizeLearningArtifact", artifactId, confirmWholeArtifact: true }))
      .rejects.toThrow("Synthesis network unavailable");
    await application.waitForModelWork();
    expect(application.getState().sessions[0].learningArtifacts[0].currentRevision).toEqual(revision);
    expect(application.getState().sessions[0].learningArtifacts[0].revisions).toEqual([]);

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].learningArtifacts[0].currentRevision).toEqual(revision);
  });

  it("records every claim level through evidence-specific boundaries and ignores model confidence", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain one step",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const verifier = new DeterministicFormalVerificationAuthority();
    const { application } = await launchWithRuntimeAndExternalResearch(
      runtime, supportingExternalResearch(), verifier
    );
    const { artifactId, researchActionId } = await createCorroboratedPinnedArtifact(application, runtime);
    const prelaunchArtifact = application.getState().sessions[0].learningArtifacts[0];
    verifier.receipts.set("mismatched-statement", {
      target: "learningArtifact", targetId: artifactId,
      claimId: prelaunchArtifact.currentRevision.claims[0].claimId,
      exactStatement: `${prelaunchArtifact.currentRevision.claims[0].claimStatement} changed`,
      checker: "Lean", verificationEnvironment: "lean-fixture-1"
    });
    verifier.receipts.set("accepted-exact-statement", {
      target: "learningArtifact", targetId: artifactId,
      claimId: prelaunchArtifact.currentRevision.claims[0].claimId,
      exactStatement: prelaunchArtifact.currentRevision.claims[0].claimStatement,
      checker: "Lean", verificationEnvironment: "lean-fixture-1"
    });
    const artifact = application.getState().sessions[0].learningArtifacts[0];
    const claimId = artifact.currentRevision.claims[0].claimId;

    let state = await application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId,
      method: "reasoningReview", outcome: "supports",
      summary: "A separate reasoning pass found the finite-subcover step continuous.",
      evidence: { kind: "agentWork", sessionId: artifact.originatingSessionId, fromSequence: 1, toSequence: 2 }
    });
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0].verificationLevel).toBe("reasoningReviewed");

    state = await application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId,
      method: "sourceGrounded", outcome: "supports",
      summary: "The exact assumptions and conclusion are consistent with the cited source.",
      evidence: { kind: "researchEvidence", researchActionId }
    });
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      verificationLevel: "sourceGrounded",
      verificationCurrency: "current",
      verificationEvidence: [
        expect.objectContaining({ method: "reasoningReview", outcome: "supports", currency: "current" }),
        expect.objectContaining({
          method: "sourceGrounded", outcome: "supports", currency: "current",
          limitation: "Consistent with the cited source; this does not prove that the claim or source is correct."
        })
      ]
    });
    const producingWork = artifact.currentRevision.claims[0].claimOriginReferences.find(
      (reference) => reference.kind === "agentWork"
    )!;
    await expect(application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId,
      method: "independentCorroboration", outcome: "supports",
      summary: "This incorrectly reuses the work that produced the claim.",
      evidence: producingWork
    })).rejects.toThrow("separate from the work that produced");

    await application.submit({
      type: "reviseTeachingCard",
      cardId: state.sessions[0].anchoredTeachingCards[0].id,
      instruction: "Run a separate derivation for corroboration."
    });
    runtime.emitTeaching("A separate derivation reaches the same conclusion.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    const independentWork = application.getState().sessions[0].anchoredTeachingCards[0].currentRevision.agentWorkLogReference!;

    state = await application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId,
      method: "independentCorroboration", outcome: "supports",
      summary: "An independent derivation supports the same conclusion.",
      evidence: { kind: "agentWork", ...independentWork }
    });
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0].verificationLevel).toBe("independentlyCorroborated");

    await expect(application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId,
      method: "formalVerification", outcome: "supports",
      summary: "The exact formal statement was accepted.",
      evidence: { kind: "formalChecker", checker: "Lean", verificationEnvironment: "lean-fixture-1" }
    } as unknown as ClaimCheckRecord)).rejects.toThrow("Only the Verifier Runtime");

    await expect(application.recordFormalVerification(
      artifact.originatingSessionId, "mismatched-statement"
    )).rejects.toThrow("exactly match the current claim");

    state = await application.recordFormalVerification(artifact.originatingSessionId, "accepted-exact-statement");
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      verificationLevel: "formallyVerified",
      verificationEvidence: expect.arrayContaining([expect.objectContaining({
        method: "formalVerification", outcome: "supports",
        limitation: "Formal verification covers only the exact accepted statement in the recorded environment."
      })])
    });

    state = await application.assessVerificationEscalation(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId,
      riskFactors: [], modelConfidence: 1
    });
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      verificationLevel: "formallyVerified",
      verificationEscalation: { recommended: false, reasons: [] }
    });
  });

  it("durably records a precisely scoped Verifier Manifest and promotes only an accepted exact claim", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check one arithmetic identity", scope: "One exact claim",
      initialTeachingDirection: "Formalize the statement", requiresConfirmation: false, confirmationReason: null
    }, true);
    const verifier: VerifierRuntime = {
      run: vi.fn(async (request) => ({
        outcome: "accepted" as const,
        diagnostics: "Lean completed without diagnostics.",
        evidenceLocation: join(request.evidenceDirectory, `${request.runId}.lean`),
        command: "lean exact-claim.lean",
        environment: BUNDLED_LEAN_ENVIRONMENT
      }))
    };
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(dataDirectory, runtime, null, null, null, null, verifier);
    applications.push(application);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    const artifact = application.getState().sessions[0].learningArtifacts[0];
    await application.submit({
      type: "editLearningArtifact", artifactId, content: artifact.currentRevision.content,
      claimEdits: [{
        claimId: artifact.currentRevision.claims[0].claimId,
        statement: "For every natural number n, n + 0 = n."
      }]
    });
    const current = application.getState().sessions[0].learningArtifacts[0];

    const checked = await application.runFormalVerification(current.originatingSessionId, {
      runId: "accepted-run",
      target: "learningArtifact", targetId: artifactId, claimId: current.currentRevision.claims[0].claimId
    });

    expect(checked.verifierManifests[0]).toMatchObject({
      claimRevisionId: current.currentRevision.id,
      exactClaim: "For every natural number n, n + 0 = n.",
      formalStatement: "theorem quickStudyNatAddZero (n : Nat) : n + 0 = n",
      assumptions: ["n : Nat"],
      environment: BUNDLED_LEAN_ENVIRONMENT,
      commandOutcome: "accepted",
      formalStatementVerificationLevel: "formallyVerified",
      evidenceLocation: expect.stringContaining("verifier-evidence")
    });
    expect(checked.sessions[0].learningArtifacts[0].currentRevision.claims[0].verificationLevel)
      .toBe("notIndependentlyChecked");

    await expect(application.runFormalVerification(current.originatingSessionId, {
      runId: "accepted-run", target: "learningArtifact", targetId: artifactId,
      claimId: current.currentRevision.claims[0].claimId
    })).rejects.toThrow("already been used");
    expect(verifier.run).toHaveBeenCalledTimes(1);
    expect(application.getState().verifierManifests).toHaveLength(1);

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().verifierManifests).toEqual(checked.verifierManifests);
  });

  it("removes and reinstalls Lean without relabeling historical verification evidence", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check one arithmetic identity", scope: "One exact claim",
      initialTeachingDirection: "Formalize the statement", requiresConfirmation: false, confirmationReason: null
    }, true);
    const verifier: VerifierRuntime = {
      run: vi.fn(async (request) => ({
        outcome: "accepted" as const,
        diagnostics: "Lean completed without diagnostics.",
        evidenceLocation: join(request.evidenceDirectory, `${request.runId}.lean`),
        command: "lean exact-claim.lean",
        environment: BUNDLED_LEAN_ENVIRONMENT
      }))
    };
    let installed = true;
    const environmentManager: VerifierEnvironmentManager = {
      inspect: vi.fn(async () => ({ installed, installedBytes: installed ? 734_003_200 : 0, cleanupRequired: false })),
      remove: vi.fn(async () => {
        installed = false;
        return { removedLogicalBytes: 734_003_200 };
      }),
      install: vi.fn(async () => {
        installed = true;
        return { installedBytes: 734_003_200 };
      }),
      cleanup: vi.fn(async () => ({ installed, installedBytes: installed ? 734_003_200 : 0 }))
    };
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(
      dataDirectory, runtime, null, null, null, null, verifier, environmentManager
    );
    applications.push(application);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    const artifact = application.getState().sessions[0].learningArtifacts[0];
    await application.submit({
      type: "editLearningArtifact", artifactId, content: artifact.currentRevision.content,
      claimEdits: [{
        claimId: artifact.currentRevision.claims[0].claimId,
        statement: "For every natural number n, n + 0 = n."
      }]
    });
    const current = application.getState().sessions[0].learningArtifacts[0];
    const request = {
      target: "learningArtifact" as const,
      targetId: artifactId,
      claimId: current.currentRevision.claims[0].claimId
    };
    await application.runFormalVerification(current.originatingSessionId, { runId: "before-removal", ...request });
    const historicalManifest = structuredClone(application.getState().verifierManifests[0]);

    const removed = await application.submit({ type: "removeVerifierEnvironment" });

    expect(removed.verifierEnvironment).toMatchObject({
      status: "absent", installedBytes: 0, lastRemovedLogicalBytes: 734_003_200, error: null,
      environment: BUNDLED_LEAN_ENVIRONMENT
    });
    expect(removed.verifierManifests[0]).toEqual(historicalManifest);
    const unavailable = await application.runFormalVerification(
      current.originatingSessionId, { runId: "while-absent", ...request }
    );
    expect(unavailable.verifierManifests.at(-1)).toMatchObject({
      commandOutcome: "unavailable",
      environment: BUNDLED_LEAN_ENVIRONMENT,
      diagnostics: expect.stringContaining("removed")
    });
    expect(verifier.run).toHaveBeenCalledTimes(1);

    const reinstalled = await application.submit({ type: "installVerifierEnvironment" });
    expect(reinstalled.verifierEnvironment).toMatchObject({
      status: "installed", installedBytes: 734_003_200, error: null,
      environment: BUNDLED_LEAN_ENVIRONMENT
    });
    const checkedAgain = await application.runFormalVerification(
      current.originatingSessionId, { runId: "after-reinstall", ...request }
    );
    expect(checkedAgain.verifierManifests.at(-1)).toMatchObject({
      commandOutcome: "accepted", environment: BUNDLED_LEAN_ENVIRONMENT
    });
    expect(checkedAgain.verifierManifests[0]).toEqual(historicalManifest);
    expect(verifier.run).toHaveBeenCalledTimes(2);

    vi.mocked(verifier.run).mockResolvedValueOnce({
      outcome: "versionMismatch",
      diagnostics: "Installed content differs from the signed payload.",
      evidenceLocation: join(dataDirectory, "verifier-evidence", "integrity-failure.lean"),
      command: "lean integrity-failure.lean",
      environment: BUNDLED_LEAN_ENVIRONMENT
    });
    const integrityFailure = await application.runFormalVerification(
      current.originatingSessionId, { runId: "integrity-failure", ...request }
    );
    expect(integrityFailure.verifierEnvironment).toMatchObject({
      status: "cleanupRequired", error: "Installed content differs from the signed payload."
    });
  });

  it("keeps failed environment operations recoverable without exposing a half-active checker", async () => {
    let installed = true;
    let installationAttempts = 0;
    const environmentManager: VerifierEnvironmentManager = {
      inspect: vi.fn(async () => ({ installed, installedBytes: installed ? 1024 : 0, cleanupRequired: false })),
      remove: vi.fn(async () => {
        installed = false;
        throw new Error("Removal was interrupted after deactivation.");
      }),
      install: vi.fn(async () => {
        installationAttempts += 1;
        if (installationAttempts === 1) throw new Error("Downloaded environment failed validation.");
        installed = true;
        return { installedBytes: 2048 };
      }),
      cleanup: vi.fn(async () => ({ installed: false, installedBytes: 0 }))
    };
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(
      dataDirectory, null, null, null, null, null, null, environmentManager
    );
    applications.push(application);

    const failedRemoval = await application.submit({ type: "removeVerifierEnvironment" });
    expect(failedRemoval.verifierEnvironment).toMatchObject({
      status: "removeFailed", error: "Removal was interrupted after deactivation."
    });
    const cleaned = await application.submit({ type: "cleanupVerifierEnvironment" });
    expect(cleaned.verifierEnvironment).toMatchObject({ status: "absent", installedBytes: 0, error: null });

    const failedInstall = await application.submit({ type: "installVerifierEnvironment" });
    expect(failedInstall.verifierEnvironment).toMatchObject({
      status: "installFailed", error: "Downloaded environment failed validation."
    });
    const recovered = await application.submit({ type: "installVerifierEnvironment" });
    expect(recovered.verifierEnvironment).toMatchObject({ status: "installed", installedBytes: 2048, error: null });
  });

  it("keeps a retained Verifier Environment pinned through cleanup and switches the active default without rewriting history", async () => {
    const priorEnvironment = { ...BUNDLED_LEAN_ENVIRONMENT, id: "lean-4.28.0-mathlib-4.28.0-quick-study-v1" };
    let activeEnvironmentId = priorEnvironment.id;
    let installations = [
      { environment: priorEnvironment, installedBytes: 1024 },
      { environment: BUNDLED_LEAN_ENVIRONMENT, installedBytes: 2048 }
    ];
    const cleanupRequests: string[][] = [];
    const environmentManager: VerifierEnvironmentManager = {
      inspect: vi.fn(async () => ({
        installed: true,
        installedBytes: installations.find((entry) => entry.environment.id === activeEnvironmentId)?.installedBytes ?? 0,
        cleanupRequired: false,
        environments: installations,
        activeEnvironmentId
      })),
      remove: vi.fn(async () => ({ removedLogicalBytes: 0 })),
      install: vi.fn(async () => ({ installedBytes: 2048, environment: BUNDLED_LEAN_ENVIRONMENT })),
      activate: vi.fn(async (environmentId: string) => { activeEnvironmentId = environmentId; }),
      cleanup: vi.fn(async (environmentIds: string[] = []) => {
        cleanupRequests.push(environmentIds);
        installations = installations.filter((entry) => !environmentIds.includes(entry.environment.id));
        return { installed: true, installedBytes: 2048 };
      })
    };
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(dataDirectory, null, null, null, null, null, null, environmentManager);
    applications.push(application);

    let state = await application.submit({ type: "startQuickStudy", mathematics: "For every natural number n, n + 0 = n." });
    const sessionId = state.activeSessionId!;
    state = await application.submit({ type: "setSessionVerifierEnvironmentPin", sessionId, environmentId: priorEnvironment.id });
    expect(state.sessions.find((session) => session.id === sessionId)?.verifierEnvironmentPinId).toBe(priorEnvironment.id);
    state = await application.submit({ type: "setVerifierEnvironmentPinned", environmentId: priorEnvironment.id, pinned: true });
    expect(state.verifierEnvironment.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({ environment: expect.objectContaining({ id: priorEnvironment.id }), pinned: true })
    ]));
    state = await application.submit({ type: "activateVerifierEnvironment", environmentId: BUNDLED_LEAN_ENVIRONMENT.id });
    expect(state.verifierEnvironment).toMatchObject({
      activeEnvironmentId: BUNDLED_LEAN_ENVIRONMENT.id,
      environment: BUNDLED_LEAN_ENVIRONMENT
    });
    await application.submit({ type: "cleanupVerifierEnvironment" });
    expect(cleanupRequests).toEqual([[]]);

    await application.shutdown();
    const restored = await LearningApplication.launch(dataDirectory, null, null, null, null, null, null, environmentManager);
    applications.push(restored);
    expect(restored.getState().verifierEnvironment).toMatchObject({ activeEnvironmentId: BUNDLED_LEAN_ENVIRONMENT.id });
    expect(restored.getState().verifierEnvironment.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({ environment: expect.objectContaining({ id: priorEnvironment.id }), pinned: true })
    ]));
    expect(restored.getState().sessions.find((session) => session.id === sessionId)?.verifierEnvironmentPinId).toBe(priorEnvironment.id);

    await restored.submit({ type: "setSessionVerifierEnvironmentPin", sessionId, environmentId: null });
    await restored.submit({ type: "setVerifierEnvironmentPinned", environmentId: priorEnvironment.id, pinned: false });
    state = await restored.submit({ type: "cleanupVerifierEnvironment" });
    expect(cleanupRequests.at(-1)).toEqual([priorEnvironment.id]);
    expect(state.verifierEnvironment.environments.map((entry) => entry.environment.id)).not.toContain(priorEnvironment.id);
  });

  it("migrates pre-registry verifier state and sessions without a Verification Environment pin", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(dataDirectory);
    applications.push(application);
    await application.submit({ type: "startQuickStudy", mathematics: "Every compact subset is closed." });
    await application.shutdown();
    const statePath = join(dataDirectory, "learning-application.json");
    const stored = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    const storedSessions = stored.sessions as Array<Record<string, unknown>>;
    delete storedSessions[0].verifierEnvironmentPinId;
    stored.verifierEnvironment = {
      status: "installed", environment: BUNDLED_LEAN_ENVIRONMENT,
      installedBytes: 1024, lastRemovedLogicalBytes: 0, error: null
    };
    await writeFile(statePath, JSON.stringify(stored), "utf8");

    const restored = await LearningApplication.launch(dataDirectory);
    applications.push(restored);
    expect(restored.getState().sessions[0]?.verifierEnvironmentPinId).toBeNull();
    expect(restored.getState().verifierEnvironment.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({ environment: BUNDLED_LEAN_ENVIRONMENT, installedBytes: 1024 })
    ]));
  });

  it("retains formalization and diagnostics for an incomplete run without calling the claim false", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check one arithmetic identity", scope: "One exact claim",
      initialTeachingDirection: "Formalize the statement", requiresConfirmation: false, confirmationReason: null
    }, true);
    const verifier: VerifierRuntime = {
      run: vi.fn(async (request) => ({
        outcome: "timedOut" as const, diagnostics: "Lean exceeded 15 seconds.",
        evidenceLocation: join(request.evidenceDirectory, `${request.runId}.lean`),
        command: "lean exact-claim.lean", environment: BUNDLED_LEAN_ENVIRONMENT
      }))
    };
    const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-test-"));
    dataDirectories.push(dataDirectory);
    const application = await LearningApplication.launch(dataDirectory, runtime, null, null, null, null, verifier);
    applications.push(application);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    const artifact = application.getState().sessions[0].learningArtifacts[0];
    await application.submit({
      type: "editLearningArtifact", artifactId, content: artifact.currentRevision.content,
      claimEdits: [{ claimId: artifact.currentRevision.claims[0].claimId, statement: "For every natural number n, n + 0 = n." }]
    });
    const current = application.getState().sessions[0].learningArtifacts[0];
    const checked = await application.runFormalVerification(current.originatingSessionId, {
      runId: "timed-out-run",
      target: "learningArtifact", targetId: artifactId, claimId: current.currentRevision.claims[0].claimId
    });

    expect(checked.verifierManifests[0]).toMatchObject({
      commandOutcome: "timedOut", diagnostics: "Lean exceeded 15 seconds.",
      formalStatementVerificationLevel: "incomplete",
      proofSource: expect.stringContaining("quickStudyNatAddZero")
    });
    expect(checked.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      verificationLevel: "notIndependentlyChecked",
      verificationGaps: [expect.objectContaining({
        reason: expect.stringContaining("timed out"),
        affectedConclusion: "For every natural number n, n + 0 = n."
      })]
    });

    vi.mocked(verifier.run).mockResolvedValueOnce({
      outcome: "accepted", diagnostics: "Lean completed without diagnostics.",
      evidenceLocation: join(dataDirectory, "verifier-evidence", "accepted-rerun.lean"),
      command: "lean accepted-rerun.lean", environment: BUNDLED_LEAN_ENVIRONMENT
    });
    const rerun = await application.runFormalVerification(current.originatingSessionId, {
      runId: "accepted-rerun", target: "learningArtifact", targetId: artifactId,
      claimId: current.currentRevision.claims[0].claimId
    });
    expect(rerun.verifierManifests.at(-1)).toMatchObject({
      commandOutcome: "accepted", formalStatementVerificationLevel: "formallyVerified"
    });
    expect(rerun.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      verificationLevel: "notIndependentlyChecked", verificationGaps: []
    });
  });

  it("attaches inspectable provenance and verification evidence to a Teaching Card claim", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain one step",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntimeAndExternalResearch(
      runtime, supportingExternalResearch()
    );
    await createPinnedArtifact(application, runtime);
    const session = application.getState().sessions[0];
    const card = session.anchoredTeachingCards[0];
    const claimId = card.currentRevision.claims![0].claimId;

    const state = await application.recordClaimCheck(session.id, {
      target: "teachingCard", targetId: card.id, claimId,
      method: "reasoningReview", outcome: "supports",
      summary: "A separate reasoning pass preserved the Hausdorff assumption and conclusion.",
      evidence: { kind: "agentWork", sessionId: session.id, fromSequence: 1, toSequence: 2 }
    });
    expect(state.sessions[0].anchoredTeachingCards[0].currentRevision.claims![0]).toMatchObject({
      claimOrigin: "modelGenerated",
      verificationLevel: "reasoningReviewed",
      verificationCurrency: "current",
      verificationEvidence: [expect.objectContaining({
        method: "reasoningReview", outcome: "supports",
        reference: { kind: "agentWork", sessionId: session.id, fromSequence: 1, toSequence: 2 }
      })]
    });

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].anchoredTeachingCards[0].currentRevision)
      .toEqual(state.sessions[0].anchoredTeachingCards[0].currentRevision);
  });

  it("rejects a successful Corroboration Pass that checked a different claim", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain one step",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntimeAndExternalResearch(runtime, supportingExternalResearch());
    const { artifactId, researchActionId } = await createCorroboratedPinnedArtifact(application, runtime);
    const initial = application.getState().sessions[0].learningArtifacts[0];
    const edited = await application.submit({
      type: "editLearningArtifact", artifactId, content: "An unrelated theorem is true.",
      claimEdits: [{ claimId: initial.currentRevision.claims[0].claimId, statement: "An unrelated theorem is true." }]
    });
    const artifact = edited.sessions[0].learningArtifacts[0];
    await expect(application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId,
      claimId: artifact.currentRevision.claims[0].claimId,
      method: "sourceGrounded", outcome: "supports", summary: "The other theorem was corroborated.",
      evidence: { kind: "researchEvidence", researchActionId }
    })).rejects.toThrow("exact current claim");
  });

  it("keeps disagreement and semantic staleness visible in durable state and portable copies", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain one step",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntimeAndExternalResearch(
      runtime, supportingExternalResearch()
    );
    const { artifactId, researchActionId } = await createCorroboratedPinnedArtifact(application, runtime);
    const artifact = application.getState().sessions[0].learningArtifacts[0];
    const claimId = artifact.currentRevision.claims[0].claimId;
    await application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId,
      method: "sourceGrounded", outcome: "supports", summary: "The source states the same claim.",
      evidence: { kind: "researchEvidence", researchActionId }
    });

    let state = await application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId,
      method: "independentCorroboration", outcome: "disagrees",
      summary: "The independent route requires a Hausdorff assumption missing from this claim.",
      evidence: { kind: "agentWork", sessionId: artifact.originatingSessionId, fromSequence: 1, toSequence: 2 }
    });
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      verificationLevel: "notIndependentlyChecked",
      verificationGaps: [expect.objectContaining({
        reason: "The independent route requires a Hausdorff assumption missing from this claim.",
        affectedConclusion: artifact.currentRevision.claims[0].claimStatement
      })],
      verificationEscalation: {
        recommended: true,
        reasons: ["Independent checking disagreed with the claim."]
      }
    });

    state = await application.submit({
      type: "editLearningArtifact", artifactId,
      content: "Learner-edited proof with a changed separation assumption.", mathematicalChange: "semantic"
    });
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      verificationLevel: "notIndependentlyChecked",
      verificationCurrency: "changedSinceCheck",
      verificationEvidence: [
        expect.objectContaining({ method: "sourceGrounded", currency: "changedSinceCheck" }),
        expect.objectContaining({ method: "independentCorroboration", currency: "changedSinceCheck" })
      ],
      verificationGaps: [expect.objectContaining({ reason: expect.stringContaining("Hausdorff") })]
    });
    const portable = application.createArtifactPortableCopy(state.sessions[0].id, artifactId);
    expect(portable.content).toContain("Verification Currency: Changed since check");
    expect(portable.content).toContain("Verification Gap");
    expect(portable.content).toContain("Hausdorff assumption");
    expect(portable.content).toContain("Verification Escalation recommended");

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].learningArtifacts[0].currentRevision)
      .toEqual(state.sessions[0].learningArtifacts[0].currentRevision);
  });

  it("retains current verification for formatting-only artifact edits and escalates observable risk", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain one step",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntimeAndExternalResearch(runtime, supportingExternalResearch());
    const { artifactId, researchActionId } = await createCorroboratedPinnedArtifact(application, runtime);
    const artifact = application.getState().sessions[0].learningArtifacts[0];
    const claimId = artifact.currentRevision.claims[0].claimId;
    await application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId,
      method: "sourceGrounded", outcome: "supports", summary: "The exact claim matches the source.",
      evidence: { kind: "researchEvidence", researchActionId }
    });
    let state = await application.submit({
      type: "editLearningArtifact", artifactId,
      content: `${artifact.currentRevision.content}\n`,
      mathematicalChange: "formattingOnly"
    });
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      verificationLevel: "sourceGrounded",
      verificationCurrency: "current",
      verificationEvidence: [expect.objectContaining({ currency: "current" })]
    });

    state = await application.assessVerificationEscalation(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId,
      riskFactors: ["nonTrivial", "weakSupport"], modelConfidence: 0.99
    });
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      verificationLevel: "sourceGrounded",
      verificationEscalation: {
        recommended: true,
        reasons: ["The claim is mathematically non-trivial.", "The available support is weak or sparse."]
      }
    });

    const currentArtifact = state.sessions[0].learningArtifacts[0];
    state = await application.submit({
      type: "editLearningArtifact", artifactId,
      content: `${currentArtifact.currentRevision.content}\nAdd a new mathematical inference.`,
      claimEdits: currentArtifact.currentRevision.claims.map((claim) => ({
        claimId: claim.claimId, statement: claim.claimStatement
      }))
    });
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      verificationLevel: "notIndependentlyChecked",
      verificationCurrency: "changedSinceCheck",
      verificationEvidence: [expect.objectContaining({
        currency: "changedSinceCheck",
        changedBecause: "The Artifact content changed without an exact claim-change classification."
      })]
    });
  });

  it("stales only the exact changed claim in a multi-claim Artifact revision", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain two steps",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake", mathematics: "Every compact subset of a Hausdorff space is closed."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
    state = await application.submit({
      type: "createSourceAnchor", sourceId: state.sessions[0].sourceIds[0],
      selection: {
        kind: "text", startOffset: 6, endOffset: 20, exactText: "compact subset",
        prefix: "Every ", suffix: " of a Hausdorff space is closed."
      },
      paletteAction: "explain"
    });
    runtime.emitTeaching("Use a finite subcover, so the complement is open.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    const card = application.getState().sessions[0].anchoredTeachingCards[0];
    state = await application.submit({
      type: "editTeachingCardClaims", cardId: card.id,
      claimEdits: [
        { claimId: card.currentRevision.claims![0].claimId, statement: "Use a finite subcover." },
        { claimId: null, statement: "The complement is open." }
      ]
    });
    expect(state.sessions[0].anchoredTeachingCards[0].currentRevision.claims).toMatchObject([
      { claimStatement: "Use a finite subcover.", claimOrigin: "mixed" },
      { claimStatement: "The complement is open.", claimOrigin: "learner",
        claimOriginReferences: [expect.objectContaining({ kind: "learnerRevision" })] }
    ]);
    state = await application.submit({ type: "pinTeachingCardArtifact", cardId: card.id });
    const artifact = state.sessions[0].learningArtifacts[0];
    const artifactId = artifact.id;
    for (const claim of artifact.currentRevision.claims) {
      await application.recordClaimCheck(artifact.originatingSessionId, {
        target: "learningArtifact", targetId: artifactId, claimId: claim.claimId,
        method: "reasoningReview", outcome: "supports", summary: "A separate pass supports this step.",
        evidence: { kind: "agentWork", sessionId: artifact.originatingSessionId, fromSequence: 1, toSequence: 2 }
      });
    }
    const firstClaimId = artifact.currentRevision.claims[0].claimId;
    const secondClaimId = artifact.currentRevision.claims[1].claimId;
    const edited = await application.submit({
      type: "editLearningArtifact",
      artifactId,
      content: "The complement is open.\n\nUse a finite subcover of the chosen neighbourhoods.\n\nThe proof uses Hausdorff separation.",
      claimEdits: [
        { claimId: secondClaimId, statement: "The complement is open." },
        { claimId: firstClaimId, statement: "Use a finite subcover of the chosen neighbourhoods." },
        { claimId: null, statement: "The proof uses Hausdorff separation." }
      ]
    });
    const claims = edited.sessions[0].learningArtifacts[0].currentRevision.claims;
    expect(claims).toHaveLength(3);
    expect(claims[0]).toMatchObject({
      claimId: secondClaimId,
      claimStatement: "The complement is open.",
      verificationLevel: "reasoningReviewed",
      verificationCurrency: "current",
      verificationEvidence: [expect.objectContaining({ currency: "current" })]
    });
    expect(claims[1]).toMatchObject({
      claimStatement: "Use a finite subcover of the chosen neighbourhoods.",
      verificationLevel: "notIndependentlyChecked",
      verificationCurrency: "changedSinceCheck",
      verificationEvidence: [expect.objectContaining({ currency: "changedSinceCheck" })]
    });
    expect(claims[1].claimId).not.toBe(firstClaimId);
    expect(claims[2]).toMatchObject({
      claimStatement: "The proof uses Hausdorff separation.",
      claimOrigin: "learner",
      verificationLevel: "notIndependentlyChecked",
      verificationCurrency: "current",
      verificationEvidence: []
    });
  });

  it("previews and applies one Artifact section while retaining unaffected verified claims", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain two steps",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    let artifact = application.getState().sessions[0].learningArtifacts[0];
    await application.submit({
      type: "editLearningArtifact", artifactId,
      content: "## Finite subcover\nUse a finite subcover.\n\n## Complement\nThe complement is open.",
      claimEdits: [
        { claimId: artifact.currentRevision.claims[0].claimId, statement: "Use a finite subcover." },
        { claimId: null, statement: "The complement is open." }
      ]
    });
    artifact = application.getState().sessions[0].learningArtifacts[0];
    for (const claim of artifact.currentRevision.claims) {
      await application.recordClaimCheck(artifact.originatingSessionId, {
        target: "learningArtifact", targetId: artifactId, claimId: claim.claimId,
        method: "reasoningReview", outcome: "supports", summary: "A separate pass supports this exact step.",
        evidence: { kind: "agentWork", sessionId: artifact.originatingSessionId, fromSequence: 1, toSequence: 2 }
      });
    }
    artifact = application.getState().sessions[0].learningArtifacts[0];
    const before = structuredClone(artifact.currentRevision);
    const sectionText = "Use a finite subcover.";
    const startOffset = before.content.indexOf(sectionText);
    runtime.artifactRegenerationResult = {
      replacementContent: "Use a finite subcover of the selected neighbourhoods.",
      claimEdits: [
        { claimId: before.claims[0].claimId, statement: "Use a finite subcover of the selected neighbourhoods." },
        { claimId: before.claims[1].claimId, statement: "The complement is open." }
      ],
      claimImpacts: [
        { claimId: before.claims[0].claimId, effect: "changed", changedAspects: ["text", "dependencies"] },
        { claimId: before.claims[1].claimId, effect: "unchanged", changedAspects: [] }
      ],
      unresolvedRepairs: []
    };

    const previewed = await application.submit({
      type: "previewLearningArtifactRegeneration", artifactId, scope: "section",
      selection: { startOffset, endOffset: startOffset + sectionText.length },
      instruction: "Name which neighbourhoods are selected."
    });
    const previewArtifact = previewed.sessions[0].learningArtifacts[0];
    expect(previewArtifact.currentRevision).toEqual(before);
    expect(previewArtifact.pendingRegenerationProposal).toMatchObject({
      baseRevisionId: before.id, scope: "section", replacementContent: runtime.artifactRegenerationResult.replacementContent,
      proposedContent: "## Finite subcover\nUse a finite subcover of the selected neighbourhoods.\n\n## Complement\nThe complement is open."
    });
    expect(runtime.artifactRegenerationRequests[0]).toMatchObject({
      artifactContent: before.content, selectedContent: sectionText,
      instruction: "Name which neighbourhoods are selected."
    });
    const relaunchedPreview = await LearningApplication.launch(dataDirectory);
    applications.push(relaunchedPreview);
    expect(relaunchedPreview.getState().sessions[0].learningArtifacts[0].pendingRegenerationProposal)
      .toEqual(previewArtifact.pendingRegenerationProposal);

    await expect(application.submit({
      type: "applyLearningArtifactRegeneration", artifactId,
      proposalId: previewArtifact.pendingRegenerationProposal!.id,
      confirmClaimImpact: false
    })).rejects.toThrow("Review and confirm the proposed claim impact");

    const applied = await application.submit({
      type: "applyLearningArtifactRegeneration", artifactId,
      proposalId: previewArtifact.pendingRegenerationProposal!.id,
      confirmClaimImpact: true
    });
    const revised = applied.sessions[0].learningArtifacts[0];
    expect(revised.revisions.at(-1)).toEqual(before);
    expect(revised.currentRevision).toMatchObject({
      content: previewArtifact.pendingRegenerationProposal!.proposedContent,
      provenance: { action: "regenerated", priorRevisionId: before.id }
    });
    expect(revised.pendingRegenerationProposal).toBeNull();
    expect(revised.currentRevision.claims[0]).toMatchObject({
      claimStatement: "Use a finite subcover of the selected neighbourhoods.",
      claimOrigin: "mixed", verificationLevel: "notIndependentlyChecked", verificationCurrency: "changedSinceCheck",
      claimOriginReferences: expect.arrayContaining([expect.objectContaining({ kind: "agentWork" })])
    });
    expect(revised.currentRevision.claims[0].claimOriginReferences)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "learnerRevision", revisionId: revised.currentRevision.id })]));
    expect(revised.currentRevision.claims[1]).toMatchObject({
      claimId: before.claims[1].claimId, claimStatement: "The complement is open.",
      verificationLevel: "reasoningReviewed", verificationCurrency: "current"
    });
  });

  it("invalidates a claim when regeneration changes assumptions without changing its displayed statement", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Make assumptions explicit",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    let artifact = application.getState().sessions[0].learningArtifacts[0];
    const claimId = artifact.currentRevision.claims[0].claimId;
    await application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId,
      method: "reasoningReview", outcome: "supports", summary: "The current assumptions support the exact claim.",
      evidence: { kind: "agentWork", sessionId: artifact.originatingSessionId, fromSequence: 1, toSequence: 2 }
    });
    artifact = application.getState().sessions[0].learningArtifacts[0];
    runtime.artifactRegenerationResult = {
      replacementContent: `${artifact.currentRevision.content}\nAssume the space is Hausdorff.`,
      claimEdits: [{ claimId, statement: artifact.currentRevision.claims[0].claimStatement }],
      claimImpacts: [{ claimId, effect: "changed", changedAspects: ["assumptions"] }],
      unresolvedRepairs: []
    };
    let state = await application.submit({
      type: "previewLearningArtifactRegeneration", artifactId, scope: "section",
      selection: { startOffset: 0, endOffset: artifact.currentRevision.content.length },
      instruction: "State the separation assumption."
    });
    state = await application.submit({
      type: "applyLearningArtifactRegeneration", artifactId,
      proposalId: state.sessions[0].learningArtifacts[0].pendingRegenerationProposal!.id,
      confirmClaimImpact: true
    });
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      claimStatement: artifact.currentRevision.claims[0].claimStatement,
      verificationLevel: "notIndependentlyChecked", verificationCurrency: "changedSinceCheck",
      verificationEvidence: [expect.objectContaining({
        currency: "changedSinceCheck", changedBecause: expect.stringContaining("assumptions")
      })]
    });
    expect(state.sessions[0].learningArtifacts[0].currentRevision.claims[0].claimId).not.toBe(claimId);
  });

  it("enforces protected Artifact content and requires explicit whole-replacement confirmation", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Protect the proof structure",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    let artifact = application.getState().sessions[0].learningArtifacts[0];
    const protectedSentence = artifact.currentRevision.content;
    await application.submit({ type: "addTrailItem", kind: "reasoningStep", content: protectedSentence });
    await application.submit({
      type: "setLearningArtifactTextProtected", artifactId,
      selection: { startOffset: 0, endOffset: protectedSentence.length }, protected: true
    });
    expect(application.getState().sessions[0].learningArtifacts[0].protectedContent).toMatchObject([{
      revisionId: artifact.currentRevision.id, startOffset: 0, endOffset: protectedSentence.length,
      content: protectedSentence
    }]);
    runtime.artifactRegenerationResult = {
      replacementContent: "A replacement that drops the protected argument.",
      claimEdits: artifact.currentRevision.claims.map((claim) => ({
        claimId: claim.claimId, statement: claim.claimStatement
      })),
      claimImpacts: artifact.currentRevision.claims.map((claim) => ({
        claimId: claim.claimId, effect: "unchanged" as const, changedAspects: []
      })),
      unresolvedRepairs: []
    };

    await expect(application.submit({
      type: "previewLearningArtifactRegeneration", artifactId, scope: "wholeArtifact",
      instruction: "Rewrite everything."
    })).rejects.toThrow("Confirm that this proposal may replace the whole Learning Artifact");
    expect(runtime.artifactRegenerationRequests).toHaveLength(0);
    await expect(application.submit({
      type: "previewLearningArtifactRegeneration", artifactId, scope: "wholeArtifact",
      instruction: "Rewrite everything.", confirmWholeArtifact: true
    })).rejects.toThrow("would remove protected Required Trail Item content");
    expect(runtime.artifactRegenerationRequests[0].protectedContent).toEqual([
      { kind: "requiredTrailItem", content: protectedSentence },
      { kind: "learnerProtected", content: protectedSentence }
    ]);
    artifact = application.getState().sessions[0].learningArtifacts[0];
    expect(artifact.currentRevision.content).toBe(protectedSentence);
    expect(artifact.pendingRegenerationProposal).toBeNull();
    expect(artifact.regenerationTask).toMatchObject({ status: "failed", retryable: true });
  });

  it("rejects a regeneration response when the Artifact revision changes in flight", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Clarify one section",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    const artifact = application.getState().sessions[0].learningArtifacts[0];
    runtime.artifactRegenerationResult = {
      replacementContent: "Old response.",
      claimEdits: artifact.currentRevision.claims.map((claim) => ({ claimId: claim.claimId, statement: claim.claimStatement })),
      claimImpacts: artifact.currentRevision.claims.map((claim) => ({
        claimId: claim.claimId, effect: "unchanged" as const, changedAspects: []
      })), unresolvedRepairs: []
    };
    runtime.holdArtifactRegeneration = true;
    const preview = application.submit({
      type: "previewLearningArtifactRegeneration", artifactId, scope: "section",
      selection: { startOffset: 0, endOffset: artifact.currentRevision.content.length }, instruction: "Clarify."
    });
    await vi.waitFor(() => expect(runtime.artifactRegenerationRequests).toHaveLength(1));
    await application.submit({
      type: "editLearningArtifact", artifactId,
      content: `${artifact.currentRevision.content}\nLearner edit.`, mathematicalChange: "formattingOnly"
    });
    runtime.completeArtifactRegeneration();
    await expect(preview).rejects.toThrow("changed while regeneration was running");
    expect(application.getState().sessions[0].learningArtifacts[0]).toMatchObject({
      currentRevision: { content: `${artifact.currentRevision.content}\nLearner edit.` },
      pendingRegenerationProposal: null,
      regenerationTask: { status: "failed", retryable: false, statusMessage: expect.stringContaining("Select") }
    });
  });

  it("preserves the learner-selected occurrence when protected text is duplicated", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Clarify one step",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    let artifact = application.getState().sessions[0].learningArtifacts[0];
    const content = "Repeated claim.\nMiddle step.\nRepeated claim.";
    await application.submit({
      type: "editLearningArtifact", artifactId, content, mathematicalChange: "formattingOnly"
    });
    artifact = application.getState().sessions[0].learningArtifacts[0];
    const protectedStart = content.lastIndexOf("Repeated claim.");
    await application.submit({
      type: "setLearningArtifactTextProtected", artifactId,
      selection: { startOffset: protectedStart, endOffset: protectedStart + "Repeated claim.".length }, protected: true
    });
    const middleStart = content.indexOf("Middle step.");
    runtime.artifactRegenerationResult = {
      replacementContent: "Expanded middle step with detail.",
      claimEdits: artifact.currentRevision.claims.map((claim) => ({ claimId: claim.claimId, statement: claim.claimStatement })),
      claimImpacts: artifact.currentRevision.claims.map((claim) => ({
        claimId: claim.claimId, effect: "unchanged" as const, changedAspects: []
      })),
      unresolvedRepairs: []
    };
    let state = await application.submit({
      type: "previewLearningArtifactRegeneration", artifactId, scope: "section",
      selection: { startOffset: middleStart, endOffset: middleStart + "Middle step.".length },
      instruction: "Expand only the middle step."
    });
    state = await application.submit({
      type: "applyLearningArtifactRegeneration", artifactId,
      proposalId: state.sessions[0].learningArtifacts[0].pendingRegenerationProposal!.id,
      confirmClaimImpact: true
    });
    const revised = state.sessions[0].learningArtifacts[0];
    const selectedOccurrence = revised.protectedContent[0];
    expect(selectedOccurrence.revisionId).toBe(revised.currentRevision.id);
    expect(selectedOccurrence.startOffset).toBe(revised.currentRevision.content.lastIndexOf("Repeated claim."));
    expect(revised.currentRevision.content.slice(selectedOccurrence.startOffset, selectedOccurrence.endOffset))
      .toBe("Repeated claim.");
  });

  it("surfaces lost mathematical formatting as repair work and attaches a targeted recheck to the new revision", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Clarify notation",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    let artifact = application.getState().sessions[0].learningArtifacts[0];
    const currentClaimId = artifact.currentRevision.claims[0].claimId;
    await application.submit({
      type: "editLearningArtifact", artifactId,
      content: "## Claim\n- For \\(x \\in K\\), compare $z$ with $z$ using [source][compact].\n\n```\ntemporary block\n```\n\n| Step | Reason |\n| --- | --- |\n| 1 | Source Anchor anchor-1 |\n\n[compact]: https://example.test/source",
      claimEdits: [{ claimId: currentClaimId, statement: "For x in K, use compactness." }]
    });
    artifact = application.getState().sessions[0].learningArtifacts[0];
    await application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId: artifact.currentRevision.claims[0].claimId,
      method: "reasoningReview", outcome: "supports", summary: "The earlier exact claim has a separate reasoning pass.",
      evidence: { kind: "agentWork", sessionId: artifact.originatingSessionId, fromSequence: 1, toSequence: 2 }
    });
    artifact = application.getState().sessions[0].learningArtifacts[0];
    runtime.artifactRegenerationResult = {
      replacementContent: "Explain the compactness step more directly with $z$.\n```",
      claimEdits: [{ claimId: artifact.currentRevision.claims[0].claimId, statement: "Compactness gives a finite subcover." }],
      claimImpacts: [{
        claimId: artifact.currentRevision.claims[0].claimId,
        effect: "changed", changedAspects: ["text", "assumptions"]
      }],
      unresolvedRepairs: []
    };
    const previewed = await application.submit({
      type: "previewLearningArtifactRegeneration", artifactId, scope: "section",
      selection: { startOffset: 0, endOffset: artifact.currentRevision.content.length },
      instruction: "Make the step direct."
    });
    const proposal = previewed.sessions[0].learningArtifacts[0].pendingRegenerationProposal!;
    expect(proposal.unresolvedRepairs).toEqual([
      { kind: "mathematicalNotation", description: "Restore or resolve the missing mathematical notation: \\(x \\in K\\)." },
      { kind: "mathematicalNotation", description: "Restore or resolve the missing mathematical notation: $z$. Lost 1 of 2 occurrences." },
      { kind: "citation", description: "Restore or resolve the missing citation: [source][compact]." },
      { kind: "citation", description: "Restore or resolve the missing citation: Source Anchor anchor-1." },
      { kind: "citation", description: "Restore or resolve the missing citation: [compact]: https://example.test/source." },
      { kind: "structure", description: "Restore or resolve the missing structural formatting: ## Claim." },
      { kind: "structure", description: "Restore or resolve the missing structural formatting: - For \\(x \\in K\\), compare $z$ with $z$ using [source][compact]." },
      { kind: "structure", description: "Restore or resolve the missing structural formatting: ```. Lost 1 of 2 occurrences." },
      { kind: "structure", description: "Restore or resolve the missing structural formatting: | Step | Reason |." },
      { kind: "structure", description: "Restore or resolve the missing structural formatting: | --- | --- |." },
      { kind: "structure", description: "Restore or resolve the missing structural formatting: | 1 | Source Anchor anchor-1 |." }
    ]);
    const applied = await application.submit({
      type: "applyLearningArtifactRegeneration", artifactId, proposalId: proposal.id, confirmClaimImpact: true
    });
    const changedClaim = applied.sessions[0].learningArtifacts[0].currentRevision.claims[0];
    expect(applied.sessions[0].learningArtifacts[0].sourceAnchorIds).toEqual(artifact.sourceAnchorIds);
    expect(applied.sessions[0].learningArtifacts[0].currentRevision.unresolvedRepairs).toEqual(proposal.unresolvedRepairs);
    expect(application.createArtifactPortableCopy(artifact.originatingSessionId, artifactId).content)
      .toContain("## Unresolved Artifact Repair Work");
    runtime.artifactClaimRecheckResult = {
      outcome: "supports", summary: "A targeted pass supports the regenerated claim."
    };
    const rechecked = await application.submit({
      type: "requestLearningArtifactClaimRecheck", artifactId, claimId: changedClaim.claimId
    });
    expect(runtime.artifactClaimRecheckRequests[0]).toMatchObject({
      exactClaim: changedClaim.claimStatement,
      priorEvidence: expect.arrayContaining([expect.objectContaining({ changedBecause: expect.any(String) })])
    });
    expect(rechecked.sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      claimId: changedClaim.claimId, verificationLevel: "reasoningReviewed", verificationCurrency: "current",
      verificationEvidence: expect.arrayContaining([
        expect.objectContaining({ summary: "A targeted pass supports the regenerated claim.", currency: "current" })
      ])
    });
  });

  it("stops an in-flight Artifact regeneration without persisting a partial preview", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Clarify one section",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    const artifact = application.getState().sessions[0].learningArtifacts[0];
    runtime.holdArtifactRegeneration = true;

    const preview = application.submit({
      type: "previewLearningArtifactRegeneration", artifactId, scope: "section",
      selection: { startOffset: 0, endOffset: artifact.currentRevision.content.length },
      instruction: "Clarify the section."
    });
    const stopped = preview.catch((error: unknown) => error);
    await vi.waitFor(() => expect(runtime.artifactRegenerationRequests).toHaveLength(1));
    await application.shutdown();
    expect(await stopped).toEqual(expect.objectContaining({
      message: "Learning Artifact regeneration was stopped."
    }));
    expect(application.getState().sessions[0].learningArtifacts[0]).toMatchObject({
      pendingRegenerationProposal: null,
      regenerationTask: { status: "stopped", retryable: true, statusMessage: expect.stringContaining("unchanged") }
    });
    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].learningArtifacts[0].currentRevision).toEqual(artifact.currentRevision);
    expect(relaunched.getState().sessions[0].learningArtifacts[0].pendingRegenerationProposal).toBeNull();
    expect(relaunched.getState().sessions[0].learningArtifacts[0].regenerationTask).toMatchObject({
      status: "stopped", retryable: true
    });
  });

  it("does not mutate an Artifact when synthesis drops learner-protected text", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Synthesize safely",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    const before = structuredClone(application.getState().sessions[0].learningArtifacts[0]);
    await application.submit({
      type: "setLearningArtifactTextProtected", artifactId,
      selection: { startOffset: 0, endOffset: before.currentRevision.content.length }, protected: true
    });
    const protectedBefore = structuredClone(application.getState().sessions[0].learningArtifacts[0]);
    runtime.artifactSynthesisContent = "A synthesis that omits the protected text.";
    await expect(application.submit({
      type: "synthesizeLearningArtifact", artifactId, confirmWholeArtifact: true
    })).rejects.toThrow("did not preserve learner-protected text");
    expect(application.getState().sessions[0].learningArtifacts[0]).toEqual(protectedBefore);
  });

  it("rejects a targeted recheck response when the Artifact revision changes in flight", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Recheck safely",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    const { artifactId } = await createPinnedArtifact(application, runtime);
    let artifact = application.getState().sessions[0].learningArtifacts[0];
    await application.recordClaimCheck(artifact.originatingSessionId, {
      target: "learningArtifact", targetId: artifactId, claimId: artifact.currentRevision.claims[0].claimId,
      method: "reasoningReview", outcome: "supports", summary: "A prior separate pass.",
      evidence: { kind: "agentWork", sessionId: artifact.originatingSessionId, fromSequence: 1, toSequence: 2 }
    });
    artifact = application.getState().sessions[0].learningArtifacts[0];
    await application.submit({
      type: "editLearningArtifact", artifactId, content: `${artifact.currentRevision.content}\nChanged mathematics.`
    });
    artifact = application.getState().sessions[0].learningArtifacts[0];
    const claimId = artifact.currentRevision.claims[0].claimId;
    runtime.holdArtifactClaimRecheck = true;
    const recheck = application.submit({ type: "requestLearningArtifactClaimRecheck", artifactId, claimId });
    await vi.waitFor(() => expect(runtime.artifactClaimRecheckRequests).toHaveLength(1));
    await application.submit({
      type: "editLearningArtifact", artifactId,
      content: `${artifact.currentRevision.content}\nNewer learner edit.`, mathematicalChange: "formattingOnly"
    });
    runtime.completeArtifactClaimRecheck();
    await expect(recheck).rejects.toThrow("changed while the claim recheck was running");
    expect(application.getState().sessions[0].learningArtifacts[0].currentRevision.content)
      .toBe(`${artifact.currentRevision.content}\nNewer learner edit.`);
  });

  it("stops in-flight synthesis on shutdown without stranding or partially persisting a revision", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness", scope: "Explain one step",
      initialTeachingDirection: "Start locally", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    const { artifactId, revision } = await createPinnedArtifact(application, runtime);
    runtime.holdArtifactSynthesis = true;

    const synthesis = application.submit({ type: "synthesizeLearningArtifact", artifactId, confirmWholeArtifact: true });
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

  it("offers Delayed Transfer once only after an Addressed Session Target and defaults to no follow-up", async () => {
    const runtime = new DeterministicModelRuntime(transferableSessionProposal(), false);
    const { application } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Show that every convergent sequence is bounded."
    });
    const addressedSessionId = state.activeSessionId!;
    await application.submit({ type: "beginSessionConsolidation" });
    await application.submit({
      type: "reviseSessionConsolidation",
      centralInsight: "Convergence controls the tail while a finite prefix is bounded.",
      learningProgress: "I can split the sequence into a finite prefix and a controlled tail.",
      unresolvedQuestions: [],
      nextStep: "Write the bound explicitly.",
      includedArtifactIds: [],
      targetDisposition: "addressed"
    });
    state = await application.submit({ type: "consolidateSession" });

    const addressed = state.sessions.find((session) => session.id === addressedSessionId)!;
    expect(addressed.delayedTransferOffer).toMatchObject({ status: "pending" });
    expect(Date.parse(addressed.delayedTransferOffer!.proposedDueAt)
      - Date.parse(addressed.delayedTransferOffer!.offeredAt)).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(state.delayedTransferChecks).toEqual([]);

    state = await application.submit({ type: "declineDelayedTransfer", sessionId: addressedSessionId });
    expect(state.sessions.find((session) => session.id === addressedSessionId)?.delayedTransferOffer?.status)
      .toBe("declined");
    expect(state.delayedTransferChecks).toEqual([]);
    await expect(application.submit({ type: "declineDelayedTransfer", sessionId: addressedSessionId }))
      .rejects.toThrow("already been decided");

    const { application: unsuitable } = await launch();
    await unsuitable.submit({ type: "startQuickStudy", mathematics: "Review my general study plan." });
    await unsuitable.submit({ type: "beginSessionConsolidation" });
    await unsuitable.submit({
      type: "reviseSessionConsolidation",
      centralInsight: "The plan needs a smaller next step.", learningProgress: "", unresolvedQuestions: [],
      nextStep: "Choose a mathematical target.", includedArtifactIds: [], targetDisposition: "addressed"
    });
    expect((await unsuitable.submit({ type: "consolidateSession" })).sessions[0].delayedTransferOffer).toBeNull();
  });

  it("does not offer Delayed Transfer for Deferred, Unresolved, or merely Paused work", async () => {
    for (const disposition of ["deferred", "unresolved"] as const) {
      const runtime = new DeterministicModelRuntime(transferableSessionProposal(), false);
      const { application } = await launchWithRuntime(runtime);
      await application.submit({ type: "submitSessionIntake", mathematics: "Explain a finite-subcover proof." });
      await application.submit({ type: "beginSessionConsolidation" });
      await application.submit({
        type: "reviseSessionConsolidation",
        centralInsight: "Compactness makes the choice finite.", learningProgress: "", unresolvedQuestions: [],
        nextStep: "Return to the proof.", includedArtifactIds: [], targetDisposition: disposition
      });
      const state = await application.submit({ type: "consolidateSession" });
      expect(state.sessions[0].delayedTransferOffer).toBeNull();
      expect(state.delayedTransferChecks).toEqual([]);
    }
    const runtime = new DeterministicModelRuntime(transferableSessionProposal(), false);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Explain a finite-subcover proof." });
    const paused = await application.submit({ type: "leaveSession" });
    expect(paused.sessions[0].status).toBe("paused");
    expect(paused.sessions[0].delayedTransferOffer).toBeNull();
  });

  it("schedules one durable Delayed Transfer Check and supports rescheduling and cancellation", async () => {
    const runtime = new DeterministicModelRuntime(transferableSessionProposal(), false);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    let state = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Prove that every finite subgroup of the multiplicative group of a field is cyclic."
    });
    const sessionId = state.activeSessionId!;
    await application.submit({ type: "beginSessionConsolidation" });
    await application.submit({
      type: "reviseSessionConsolidation",
      centralInsight: "Bound the number of roots of each polynomial and compare element orders.",
      learningProgress: "I can explain the element-order argument.",
      unresolvedQuestions: [],
      nextStep: "Try the same structural idea on a different finite group problem.",
      includedArtifactIds: [],
      targetDisposition: "addressed"
    });
    state = await application.submit({ type: "consolidateSession" });
    const offeredAt = state.sessions[0].delayedTransferOffer!.offeredAt;
    const dueAt = new Date(Date.parse(offeredAt) + 10 * 24 * 60 * 60 * 1_000).toISOString();

    state = await application.submit({
      type: "scheduleDelayedTransfer",
      sessionId,
      intendedTransferGoal: "Recognize and reuse the root-counting structure in a fresh proof.",
      dueAt
    });
    expect(state.delayedTransferChecks).toHaveLength(1);
    const scheduled = state.delayedTransferChecks[0];
    expect(scheduled).toMatchObject({
      relatedSessionId: sessionId,
      relatedLearningSessionGoal: state.sessions[0].learningGoal,
      originatingSessionTarget: state.sessions[0].sessionTarget,
      originatingConcepts: ["finite subcover"],
      intendedTransferGoal: "Recognize and reuse the root-counting structure in a fresh proof.",
      dueAt,
      status: "scheduled"
    });
    expect(scheduled.task).toBeNull();
    expect(scheduled).not.toHaveProperty("question");
    expect(scheduled.relevantSourceAnchorId).toBeNull();
    const transferContextPoint = state.sessions[0].consolidatedOutcome!.trailItems.find((item) =>
      item.id === scheduled.relevantTrailItemId);
    expect(transferContextPoint).toMatchObject({
      kind: "reasoningStep",
      curationKey: `delayed-transfer-context:${sessionId}`
    });
    expect(transferContextPoint?.content).toContain("finite subcover");
    expect(transferContextPoint?.content).toContain("Try the same structural idea");
    expect(state.sessions[0].delayedTransferOffer?.status).toBe("scheduled");
    const persistedScheduled = JSON.parse(await readFile(join(dataDirectory, "learning-application.json"), "utf8"));
    persistedScheduled.delayedTransferChecks = [];
    await writeFile(join(dataDirectory, "learning-application.json"), JSON.stringify(persistedScheduled), "utf8");
    await expect(LearningApplication.launch(dataDirectory)).rejects.toThrow(
      "Stored Delayed Transfer offer does not match its check state"
    );
    await expect(application.submit({
      type: "scheduleDelayedTransfer",
      sessionId,
      intendedTransferGoal: "Create a duplicate.",
      dueAt
    })).rejects.toThrow("already has a Delayed Transfer Check");

    state = await application.submit({ type: "openFollowUpQueue" });
    expect(state.screen).toBe("followUps");
    state = await application.submit({ type: "closeFollowUpQueue" });
    expect(state.screen).toBe("dashboard");

    const rescheduledDueAt = new Date(Date.parse(dueAt) + 4 * 24 * 60 * 60 * 1_000).toISOString();
    state = await application.submit({
      type: "rescheduleDelayedTransfer",
      checkId: scheduled.id,
      dueAt: rescheduledDueAt
    });
    expect(state.delayedTransferChecks[0].dueAt).toBe(rescheduledDueAt);

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().delayedTransferChecks[0]).toEqual(state.delayedTransferChecks[0]);

    state = await relaunched.submit({ type: "cancelDelayedTransfer", checkId: scheduled.id });
    expect(state.delayedTransferChecks[0].status).toBe("cancelled");
    expect(state.sessions[0].delayedTransferOffer?.status).toBe("cancelled");
    const persistedCancelled = JSON.parse(await readFile(join(dataDirectory, "learning-application.json"), "utf8"));
    persistedCancelled.delayedTransferChecks = [];
    await writeFile(join(dataDirectory, "learning-application.json"), JSON.stringify(persistedCancelled), "utf8");
    await expect(LearningApplication.launch(dataDirectory)).rejects.toThrow(
      "Stored Delayed Transfer offer does not match its check state"
    );
  });

  it("generates an unseen Delayed Transfer task only when a due check is launched", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-03T12:00:00.000Z"));
      const runtime = new DeterministicModelRuntime(transferableSessionProposal(), false);
      runtime.delayedTransferTask = {
        prompt: "Let (U_i) cover a compact space K and suppose each U_i is paired with an open set V_i satisfying a local separation condition. Explain how to obtain one finite global construction.",
        concept: "finite subcover",
        taskDemand: "transfer the finite-subcover strategy to a new separation construction",
        structuralComparison: "The task preserves the local-choice-to-finite-global-step structure without repeating the original theorem.",
        mathematicalContext: delayedTaskContext("transfer the finite-subcover strategy to a new separation construction")
      };
      const { application } = await launchWithRuntime(runtime);
      let state = await application.submit({
        type: "submitSessionIntake",
        mathematics: "Show that a compact subset of a Hausdorff space is closed."
      });
      const sessionId = state.activeSessionId!;
      await application.submit({ type: "beginSessionConsolidation" });
      await application.submit({
        type: "reviseSessionConsolidation",
        centralInsight: "Compactness turns pointwise choices into finitely many choices.",
        learningProgress: "I can identify the finite-subcover step.",
        unresolvedQuestions: [],
        nextStep: "Transfer the structure to a new proof.",
        includedArtifactIds: [],
        targetDisposition: "addressed"
      });
      state = await application.submit({ type: "consolidateSession" });
      const futureDueAt = new Date(Date.now() + 60_000).toISOString();
      state = await application.submit({
        type: "scheduleDelayedTransfer",
        sessionId,
        intendedTransferGoal: "Reuse the finite-subcover structure in a fresh proof.",
        dueAt: futureDueAt
      });
      const checkId = state.delayedTransferChecks[0].id;

      expect(runtime.delayedTransferTaskRequests).toEqual([]);
      expect(state.delayedTransferChecks[0].task).toBeNull();
      await expect(application.submit({ type: "startDelayedTransferCheck", checkId }))
        .rejects.toThrow("not due yet");
      expect(runtime.delayedTransferTaskRequests).toEqual([]);

      vi.setSystemTime(new Date(Date.parse(futureDueAt) + 1));
      state = await application.submit({ type: "startDelayedTransferCheck", checkId });

      expect(runtime.delayedTransferTaskRequests).toHaveLength(1);
      expect(runtime.delayedTransferTaskRequests[0]).toMatchObject({
        checkId,
        originatingSessionTarget: "Explain the finite-subcover step",
        originatingConcepts: ["finite subcover"],
        intendedTransferGoal: "Reuse the finite-subcover structure in a fresh proof."
      });
      expect(state.screen).toBe("delayedTransfer");
      expect(state.activeDelayedTransferCheckId).toBe(checkId);
      expect(state.delayedTransferChecks[0]).toMatchObject({
        status: "inProgress",
        task: runtime.delayedTransferTask,
        taskError: null
      });
      expect(state.delayedTransferChecks[0].task?.prompt).not.toContain(
        "Show that a compact subset of a Hausdorff space is closed."
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes cancellable task preparation without allowing competing queue actions", async () => {
    const runtime = new DeterministicModelRuntime(transferableSessionProposal(), false);
    runtime.holdDelayedTransferTask = true;
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    const { checkId } = await scheduleDelayedTransfer(
      application,
      new Date(Date.now() + 50).toISOString()
    );
    await new Promise((resolve) => setTimeout(resolve, 60));

    const starting = application.submit({ type: "startDelayedTransferCheck", checkId });
    for (let attempt = 0; attempt < 100 && (application.getState().delayedTransferChecks[0].status !== "preparing"
      || runtime.delayedTransferTaskRequests.length === 0); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(application.getState().delayedTransferChecks[0]).toMatchObject({ status: "preparing", task: null });
    const recovered = await LearningApplication.launch(
      dataDirectory,
      new DeterministicModelRuntime(transferableSessionProposal(), false)
    );
    applications.push(recovered);
    expect(recovered.getState().delayedTransferChecks[0]).toMatchObject({
      status: "scheduled",
      task: null,
      taskError: expect.stringContaining("stopped when Quick Study closed")
    });
    await expect(application.submit({ type: "skipDelayedTransferCheck", checkId }))
      .rejects.toThrow("Choose an active Delayed Transfer Check");
    await expect(application.submit({ type: "cancelDelayedTransfer", checkId }))
      .rejects.toThrow("Choose a scheduled Delayed Transfer Check");

    const cancelled = await application.submit({ type: "cancelDelayedTransferPreparation", checkId });
    await starting;
    expect(runtime.canceledSessionIds).toContain(checkId);
    expect(cancelled.delayedTransferChecks[0]).toMatchObject({
      status: "scheduled",
      task: null,
      taskError: null
    });
    expect(cancelled.activeDelayedTransferCheckId).toBeNull();
  });

  it("keeps an honest stopping state when task interruption is not confirmed", async () => {
    const runtime = new DeterministicModelRuntime(transferableSessionProposal(), false);
    runtime.holdDelayedTransferTask = true;
    runtime.ignoreDelayedTransferAbort = true;
    runtime.cancelError = new Error("turn interruption unavailable");
    const { application } = await launchWithRuntime(runtime);
    const { checkId } = await scheduleDelayedTransfer(application, new Date(Date.now() + 50).toISOString());
    await new Promise((resolve) => setTimeout(resolve, 60));

    const starting = application.submit({ type: "startDelayedTransferCheck", checkId });
    for (let attempt = 0; attempt < 100 && runtime.delayedTransferTaskRequests.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await expect(application.submit({ type: "cancelDelayedTransferPreparation", checkId }))
      .rejects.toThrow("could not confirm that task preparation stopped");
    expect(application.getState().delayedTransferChecks[0]).toMatchObject({
      status: "stopping",
      task: null,
      taskError: expect.stringContaining("Retry the stop action")
    });

    runtime.completeDelayedTransferTaskPreparation();
    await starting;
    expect(application.getState().delayedTransferChecks[0]).toMatchObject({
      status: "scheduled",
      task: null,
      taskError: null
    });
  });

  it("rejects a superficial rewrite that preserves the originating task conditions", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));
      const proposal = transferableSessionProposal();
      const runtime = new DeterministicModelRuntime(proposal, false);
      runtime.delayedTransferTask = {
        prompt: "Prove, in other words, that a compact subset of a Hausdorff space is closed under uniform bounded estimates.",
        concept: "finite subcover",
        taskDemand: "apply a finite-subcover proof strategy",
        structuralComparison: "Only the wording has changed.",
        mathematicalContext: {
          concepts: ["finite subcover"],
          mathematicalStructures: [" COMPACT   TOPOLOGICAL SPACE ", "uniform bounded estimates"],
          prerequisiteRelationships: structuredClone(proposal.evidenceTransferContext!.prerequisiteRelationships),
          taskDemands: ["apply a finite-subcover proof strategy", "use uniform bounded estimates"]
        }
      };
      const { application } = await launchWithRuntime(runtime);
      const { checkId } = await scheduleDelayedTransfer(
        application,
        new Date(Date.now() + 1_000).toISOString()
      );
      vi.setSystemTime(new Date(Date.now() + 2_000));

      const state = await application.submit({ type: "startDelayedTransferCheck", checkId });

      expect(state.delayedTransferChecks[0]).toMatchObject({ status: "scheduled", task: null });
      expect(state.delayedTransferChecks[0].taskError).toContain("invalid Delayed Transfer task");
      expect(state.activeDelayedTransferCheckId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records nuanced Delayed Transfer Evidence and governed Learner Model context", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
      const runtime = new DeterministicModelRuntime(transferableSessionProposal(), false);
      runtime.delayedTransferTask = {
        prompt: "A family of local estimates covers a compact parameter space. Explain how to choose finitely many estimates and combine them into one uniform bound.",
        concept: "finite subcover",
        taskDemand: "apply the local-to-finite-global proof structure",
        structuralComparison: "The task transfers the finite-subcover step from separation to uniform control.",
        mathematicalContext: delayedTaskContext("apply the local-to-finite-global proof structure")
      };
      runtime.delayedTransferClarification = "Describe which sets form the open cover; you still need to choose and justify the finite reduction yourself.";
      runtime.delayedTransferAssessment = {
        result: "partial",
        reasoningQuality: "developing",
        confidenceCalibration: "aligned",
        misconceptionOrStrength: "The learner identifies compactness but does not yet justify why the finite maximum is uniform.",
        recommendedNextAction: "Review the finite-maximum step and then retry on another uniform-bound problem.",
        refresherGoal: "Connect the finite subcover to the construction of one uniform bound."
      };
      const { application, dataDirectory } = await launchWithRuntime(runtime);
      let state = await application.submit({
        type: "submitSessionIntake",
        mathematics: "Show that a compact subset of a Hausdorff space is closed."
      });
      const sessionId = state.activeSessionId!;
      await application.submit({ type: "beginSessionConsolidation" });
      await application.submit({
        type: "reviseSessionConsolidation",
        centralInsight: "Compactness reduces pointwise choices to finitely many.",
        learningProgress: "I can locate the compactness step.",
        unresolvedQuestions: [],
        nextStep: "Apply the structure after a delay.",
        includedArtifactIds: [],
        targetDisposition: "addressed"
      });
      state = await application.submit({ type: "consolidateSession" });
      state = await application.submit({
        type: "scheduleDelayedTransfer",
        sessionId,
        intendedTransferGoal: "Apply the finite-subcover structure to a new argument.",
        dueAt: new Date(Date.now() + 1_000).toISOString()
      });
      const checkId = state.delayedTransferChecks[0].id;
      vi.setSystemTime(new Date(Date.now() + 2_000));
      await application.submit({ type: "startDelayedTransferCheck", checkId });
      state = await application.submit({
        type: "saveDelayedTransferDraft",
        checkId,
        work: "Choose a finite subcover and take the maximum of the corresponding local bounds.",
        reasoning: "Compactness makes the local family finite, so a maximum can be selected.",
        confidence: "medium"
      });
      expect(state.delayedTransferChecks[0].draft).toMatchObject({
        work: "Choose a finite subcover and take the maximum of the corresponding local bounds.",
        reasoning: "Compactness makes the local family finite, so a maximum can be selected.",
        confidence: "medium"
      });

      state = await application.submit({
        type: "requestDelayedTransferClarification",
        checkId,
        question: "What objects should form the cover?"
      });
      expect(runtime.delayedTransferClarificationRequests).toHaveLength(1);
      expect(state.delayedTransferChecks[0].draft.clarifications).toEqual([{
        question: "What objects should form the cover?",
        response: runtime.delayedTransferClarification,
        requestedAt: expect.any(String)
      }]);

      const historicalOrigin = structuredClone(state.sessions.find((session) => session.id === sessionId));
      state = await application.submit({ type: "completeDelayedTransferCheck", checkId });
      const completed = state.delayedTransferChecks[0];
      expect(completed.status).toBe("completed");
      expect(completed.evidence).toMatchObject({
        checkId,
        originatingSessionId: sessionId,
        dueAt: expect.any(String),
        completedAt: expect.any(String),
        task: runtime.delayedTransferTask,
        mathematicalContext: runtime.delayedTransferTask.mathematicalContext,
        work: "Choose a finite subcover and take the maximum of the corresponding local bounds.",
        reasoning: "Compactness makes the local family finite, so a maximum can be selected.",
        confidence: "medium",
        assistanceUsed: true,
        result: "partial",
        reasoningQuality: "developing",
        confidenceCalibration: "aligned",
        misconceptionOrStrength: runtime.delayedTransferAssessment.misconceptionOrStrength,
        recommendedNextAction: runtime.delayedTransferAssessment.recommendedNextAction
      });
      expect(completed.result).toEqual({
        evidenceId: completed.evidence!.id,
        refresherOffer: {
          status: "pending",
          goal: runtime.delayedTransferAssessment.refresherGoal,
          refresherSessionId: null
        }
      });
      expect(state.learnerModel.entries).toContainEqual(expect.objectContaining({
        kind: "understandingEvidence",
        inference: "delayed transfer shows developing reasoning",
        sourceEvidence: expect.objectContaining({ sessionId, sourceRecordId: completed.evidence!.id }),
        mathematicalContext: runtime.delayedTransferTask.mathematicalContext,
        confidence: "medium",
        status: "active"
      }));
      expect(state.sessions.find((session) => session.id === sessionId)).toEqual(historicalOrigin);

      const relaunched = await LearningApplication.launch(dataDirectory);
      applications.push(relaunched);
      expect(relaunched.getState().delayedTransferChecks[0]).toEqual(completed);
      expect(relaunched.getState().learnerModel.entries).toEqual(state.learnerModel.entries);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records skipped and dismissed due checks without negative Understanding Evidence", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
      for (const actionType of ["skipDelayedTransferCheck", "dismissDueDelayedTransferCheck"] as const) {
        const runtime = new DeterministicModelRuntime(transferableSessionProposal(), false);
        const { application } = await launchWithRuntime(runtime);
        const { checkId } = await scheduleDelayedTransfer(application, new Date(Date.now() + 1_000).toISOString());
        vi.setSystemTime(new Date(Date.now() + 2_000));
        const state = await application.submit({ type: actionType, checkId });
        expect(state.delayedTransferChecks[0]).toMatchObject({
          status: actionType === "skipDelayedTransferCheck" ? "skipped" : "dismissed",
          task: null,
          evidence: null,
          result: null
        });
        expect(state.learnerModel.entries).toEqual([]);
        expect(state.screen).toBe("dashboard");
        expect(runtime.delayedTransferTaskRequests).toEqual([]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts or declines an optional Refresher Session without rewriting the delayed result", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-25T12:00:00.000Z"));
      const runtime = new DeterministicModelRuntime(transferableSessionProposal(), false);
      runtime.delayedTransferAssessment = {
        result: "difficulty",
        reasoningQuality: "developing",
        confidenceCalibration: "overconfident",
        misconceptionOrStrength: "The response chooses a finite family but does not show that it covers the full compact set.",
        recommendedNextAction: "Review how the open cover is constructed.",
        refresherGoal: "Justify that the local neighbourhoods form an open cover before taking a finite subcover."
      };
      const { application } = await launchWithRuntime(runtime);
      const { sessionId, checkId } = await scheduleDelayedTransfer(
        application,
        new Date(Date.now() + 1_000).toISOString()
      );
      vi.setSystemTime(new Date(Date.now() + 2_000));
      await application.submit({ type: "startDelayedTransferCheck", checkId });
      await application.submit({
        type: "saveDelayedTransferDraft",
        checkId,
        work: "Select several local neighbourhoods.",
        reasoning: "Compactness means finitely many are enough.",
        confidence: "high"
      });
      let state = await application.submit({ type: "completeDelayedTransferCheck", checkId });
      const historicalEvidence = structuredClone(state.delayedTransferChecks[0].evidence);
      const historicalResult = structuredClone(state.delayedTransferChecks[0].result);
      const historicalOrigin = structuredClone(state.sessions.find((session) => session.id === sessionId));

      state = await application.submit({ type: "acceptDelayedTransferRefresher", checkId });
      const refresher = state.sessions.find((session) => session.id === state.activeSessionId)!;
      expect(refresher).toMatchObject({
        workspaceId: historicalOrigin!.workspaceId,
        missionId: historicalOrigin!.missionId,
        learningGoal: runtime.delayedTransferAssessment.refresherGoal,
        status: "active",
        refresherOf: {
          checkId,
          evidenceId: historicalEvidence!.id,
          originatingSessionId: sessionId,
          sourceAnchorId: null,
          trailItemId: expect.any(String)
        }
      });
      expect(refresher.askBarContext.items).toContainEqual(expect.objectContaining({
        id: `refresher-trail-item:${refresher.refresherOf!.trailItemId}`,
        typeLabel: "Linked Learning Trail point"
      }));
      expect(refresher.id).not.toBe(sessionId);
      expect(state.delayedTransferChecks[0].evidence).toEqual(historicalEvidence);
      expect(state.delayedTransferChecks[0].result).toEqual({
        ...historicalResult,
        refresherOffer: {
          ...historicalResult!.refresherOffer,
          status: "accepted",
          refresherSessionId: refresher.id
        }
      });
      expect(state.sessions.find((session) => session.id === sessionId)).toEqual(historicalOrigin);

      const secondRuntime = new DeterministicModelRuntime(transferableSessionProposal(), false);
      secondRuntime.delayedTransferAssessment = structuredClone(runtime.delayedTransferAssessment);
      const { application: declineApplication } = await launchWithRuntime(secondRuntime);
      const scheduled = await scheduleDelayedTransfer(
        declineApplication,
        new Date(Date.now() + 1_000).toISOString()
      );
      vi.setSystemTime(new Date(Date.now() + 2_000));
      await declineApplication.submit({ type: "startDelayedTransferCheck", checkId: scheduled.checkId });
      await declineApplication.submit({
        type: "saveDelayedTransferDraft",
        checkId: scheduled.checkId,
        work: "Choose finitely many sets.",
        reasoning: "Use compactness.",
        confidence: null
      });
      const completed = await declineApplication.submit({
        type: "completeDelayedTransferCheck",
        checkId: scheduled.checkId
      });
      const evidenceBeforeDecline = structuredClone(completed.delayedTransferChecks[0].evidence);
      const declined = await declineApplication.submit({
        type: "declineDelayedTransferRefresher",
        checkId: scheduled.checkId
      });
      expect(declined.delayedTransferChecks[0].result?.refresherOffer).toMatchObject({ status: "declined" });
      expect(declined.delayedTransferChecks[0].evidence).toEqual(evidenceBeforeDecline);
      expect(declined.sessions).toHaveLength(1);
      expect(declined.screen).toBe("dashboard");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the learner begin Session Consolidation while teaching is in flight", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand compactness",
      scope: "Explain the finite-subcover step",
      initialTeachingDirection: "Start from pointwise separation",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
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
      currentRevision: {
        content: "Learner revision after consolidation.",
        claims: [expect.objectContaining({ claimOrigin: "mixed" })]
      },
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
        claimId: "legacy-revision",
        claimStatement: "Use a finite subcover.",
        claimOriginReferences: [],
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
        claims: [expect.objectContaining({
          verificationLevel: "notIndependentlyChecked",
          verificationCurrency: "current",
          verificationEvidence: [],
          verificationGaps: [],
          verificationEscalation: { recommended: false, reasons: [] }
        })],
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
        claims: [expect.objectContaining({
          claimOrigin: "modelGenerated",
          verificationLevel: "notIndependentlyChecked",
          verificationCurrency: "current"
        })]
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
      currentRevision: {
        content: "Learner-edited finite-subcover proof.",
        claims: [expect.objectContaining({ claimOrigin: "mixed" })]
      },
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

  it("marks source-dependent claim evidence stale when its Linked Source changes", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Audit compactness", scope: "Check one claim", initialTeachingDirection: "Compare assumptions",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const sourceAccess = new DeterministicSourceAccess();
    const original = "Prove the orbit-stabilizer theorem for a finite group acting on a set.";
    sourceAccess.contentBySourceName.set("proof.txt", original);
    sourceAccess.indexBySourceName.set("proof.txt", textExtraction(original));
    const launched = await launchWithRuntimeSourceAccessAndExternalResearch(
      runtime, sourceAccess, supportingExternalResearch()
    );
    const { application } = launched;
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
      type: "startQuickStudy", mathematics: original,
      location: { workspaceId: workspace.navigation.workspaceId, missionId: mission.navigation.missionId! }
    });
    await application.submit({ type: "addSourceToSession", sourceId: source.id });
    const withCard = await application.submit({
      type: "createSourceAnchor", sourceId: source.id,
      selection: {
        kind: "text", startOffset: 10, endOffset: 34, exactText: "orbit-stabilizer theorem",
        prefix: "Prove the ", suffix: " for a finit"
      },
      paletteAction: "explain"
    });
    runtime.emitTeaching(withCard.sessions[0].corroborationPass!.currentUse.conclusion);
    runtime.completeTeaching();
    await application.waitForModelWork();
    const card = application.getState().sessions[0].anchoredTeachingCards[0];
    const pinned = await application.submit({ type: "pinTeachingCardArtifact", cardId: card.id });
    const artifact = pinned.sessions[0].learningArtifacts[0];
    await application.recordClaimCheck(pinned.sessions[0].id, {
      target: "learningArtifact", targetId: artifact.id, claimId: artifact.currentRevision.claims[0].claimId,
      method: "sourceGrounded", outcome: "supports",
      summary: "The exact assumptions and conclusion match the cited Source Revision.",
      evidence: {
        kind: "researchEvidence",
        researchActionId: withCard.sessions[0].corroborationPass!.researchActionId!
      }
    });

    sourceAccess.fingerprint = { size: 72, modifiedAtMs: 5678 };
    sourceAccess.contentBySourceName.set("proof.txt", `Recall: ${original}`);
    await application.openLinkedSource(source.id);

    expect(application.getState().sessions[0].learningArtifacts[0].currentRevision.claims[0]).toMatchObject({
      verificationLevel: "notIndependentlyChecked",
      verificationCurrency: "changedSinceCheck",
      verificationEvidence: [expect.objectContaining({
        method: "sourceGrounded",
        currency: "changedSinceCheck",
        changedBecause: "Source proof.txt changed to a new Source Revision."
      })]
    });
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
          tools: ["checkpointSpecialistResult"], maxTokens: 512, maxLatencyMs: 120_000
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

  it("uses each Reasoning Preference to select an inspectable automatic Agent Budget", async () => {
    const expected = {
      faster: { model: "runtimeDefault", reasoningEffort: "low", maxTokens: 512, maxLatencyMs: 120_000 },
      balanced: { model: "runtimeDefault", reasoningEffort: "medium", maxTokens: 512, maxLatencyMs: 120_000 },
      deeper: { model: "codex-deep", reasoningEffort: "high", maxTokens: 512, maxLatencyMs: 120_000 }
    } as const;
    for (const preference of ["faster", "balanced", "deeper"] as const) {
      const runtime = new DeterministicModelRuntime({
        learningGoal: "Understand why compact subsets are closed",
        scope: "Find the hidden separation assumption",
        initialTeachingDirection: "Inspect the complement argument",
        requiresConfirmation: false, confirmationReason: null
      }, true);
      const { application } = await launchWithRuntime(runtime);
      await application.submit({ type: "submitSessionIntake", mathematics: "Prove compact subsets are closed." });
      runtime.emitTeaching("Choose disjoint neighbourhoods and use compactness.");
      runtime.completeTeaching();
      await application.waitForModelWork();
      expect(application.getState().sessions[0]).toMatchObject({ reasoningPreference: "balanced", runtimeOverride: null });
      await application.submit({ type: "setReasoningPreference", preference });
      await application.submit({ type: "submitQuestion", text: "Which assumption controls the separation step?" });
      expect(runtime.teachingRequests.at(-1)?.runtimeSelection).toEqual({
        model: expected[preference].model, reasoningEffort: expected[preference].reasoningEffort
      });
      expect(runtime.teachingRequests.at(-1)?.runtimeSelection.reasoningEffort).not.toBe("max");
      runtime.completeTeaching();
      await application.waitForModelWork();
      const state = await application.submit({ type: "requestSpecialistReview" });
      expect(state.sessions[0].agentTasks[0].budget).toMatchObject(expected[preference]);
      expect(state.sessions[0].agentTasks[0].budget.reasoningEffort).not.toBe("max");
      runtime.completeSpecialist({ title: "Review", content: "The Hausdorff assumption is required." });
      await application.waitForModelWork();
    }
  });

  it("validates an advanced Runtime Override against active Codex Runtime capabilities", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the claim", scope: "One inference",
      initialTeachingDirection: "Start from the definition", requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Explain the claim." });
    runtime.completeTeaching();
    await application.waitForModelWork();

    await expect(application.submit({
      type: "setRuntimeOverride", override: { model: "codex-fast", reasoningEffort: "high" }
    })).rejects.toThrow("does not support high reasoning");
    const state = await application.submit({
      type: "setRuntimeOverride", override: { model: "codex-deep", reasoningEffort: "high" }
    });
    expect(state.sessions[0].runtimeOverride).toEqual({ model: "codex-deep", reasoningEffort: "high" });
    expect(state.runtimeCapabilities.models).toEqual(runtime.capabilities.models);
    await application.submit({ type: "submitQuestion", text: "Check this inference." });
    expect(runtime.teachingRequests.at(-1)?.runtimeSelection).toEqual({ model: "codex-deep", reasoningEffort: "high" });
    runtime.completeTeaching();
    await application.waitForModelWork();
    const relaunched = await LearningApplication.launch(dataDirectory, runtime);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0]).toMatchObject({
      reasoningPreference: "balanced",
      runtimeOverride: { model: "codex-deep", reasoningEffort: "high" }
    });

    const replacementRuntime = new DeterministicModelRuntime({
      learningGoal: "Unused", scope: "Unused", initialTeachingDirection: "Unused",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    replacementRuntime.capabilities.models.splice(0, replacementRuntime.capabilities.models.length, {
      model: "codex-fast", displayName: "Codex Fast", isDefault: true, supportedReasoningEfforts: ["low", "medium"]
    });
    const restored = await relaunched.restoreModelRuntime(replacementRuntime);
    expect(restored.sessions[0]).toMatchObject({ reasoningPreference: "balanced", runtimeOverride: null });
  });

  it("routes automatic teaching to a safe effort on another advertised model before requiring an override", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the claim", scope: "One inference",
      initialTeachingDirection: "Start from the definition", requiresConfirmation: false,
      confirmationReason: null
    }, true);
    runtime.capabilities.models.splice(0, runtime.capabilities.models.length,
      { model: "maximum-only", displayName: "Maximum Only", isDefault: true, supportedReasoningEfforts: ["max", "ultra"] },
      { model: "safe-model", displayName: "Safe Model", isDefault: false, supportedReasoningEfforts: ["medium"] }
    );
    const { application } = await launchWithRuntime(runtime);

    await application.submit({ type: "submitSessionIntake", mathematics: "Explain the claim." });

    expect(runtime.teachingRequests.at(-1)?.runtimeSelection).toEqual({
      model: "safe-model", reasoningEffort: "medium"
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
  });

  it("keeps confirmed authentication distinct from a runtime capability discovery failure", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand the claim", scope: "One inference", initialTeachingDirection: "Start",
      requiresConfirmation: false, confirmationReason: null
    });
    runtime.capabilitiesError = new Error("model catalog unavailable");
    const { application } = await launchWithRuntime(runtime);
    expect(application.getState()).toMatchObject({
      authentication: { status: "signedIn", accountLabel: "learner@example.com" },
      runtimeAvailable: false,
      modelAccess: { status: "unavailable", cause: "runtime" }
    });
  });

  it("sequences dependent Specialist Agents and supplies the first result to the next Agent Brief", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check the proof", scope: "Inspect assumptions", initialTeachingDirection: "Read the step",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    const state = await application.submit({ type: "requestSpecialistReview", coordination: "dependent" });
    expect(state.sessions[0].agentTasks[0].budget).toMatchObject({ agentCount: 2, concurrency: 1 });
    expect(runtime.specialistRequests).toHaveLength(1);
    runtime.completeSpecialistRequest(runtime.specialistRequests[0], {
      title: "Assumption review", content: "The step requires Hausdorff separation."
    });
    await vi.waitFor(() => expect(runtime.specialistRequests).toHaveLength(2));
    expect(runtime.specialistRequests[1].brief.constraints).toContain(
      "Earlier Specialist Agent conclusion: The step requires Hausdorff separation."
    );
    runtime.completeSpecialistRequest(runtime.specialistRequests[1], {
      title: "Boundary review", content: "Without Hausdorff separation the claim can fail."
    });
    await application.waitForModelWork();
    expect(application.getState().sessions[0].agentTasks[0]).toMatchObject({
      status: "complete",
      integratedTeachingCard: { status: "completed", content: expect.stringContaining("Without Hausdorff separation") }
    });
  });

  it("rejects an unrecognized Specialist Agent coordination value at the application boundary", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check the proof", scope: "Inspect assumptions", initialTeachingDirection: "Read the step",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();

    await expect(application.submit({
      type: "requestSpecialistReview", coordination: "unbounded-swarm"
    } as never)).rejects.toThrow("Choose single, dependent, or independent");
    expect(application.getState().sessions[0].agentTasks).toEqual([]);
  });

  it("starts genuinely independent Specialist Agents concurrently within the Agent Budget", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Compare checks", scope: "Inspect assumptions", initialTeachingDirection: "Read the step",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this proof independently." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    const state = await application.submit({ type: "requestSpecialistReview", coordination: "independent" });
    expect(state.sessions[0].agentTasks[0].budget).toMatchObject({ agentCount: 2, concurrency: 2 });
    expect(runtime.specialistRequests).toHaveLength(2);
    expect(runtime.specialistRequests[1].brief.constraints).not.toEqual(expect.arrayContaining([
      expect.stringContaining("Earlier Specialist Agent conclusion")
    ]));
    runtime.completeSpecialistRequest(runtime.specialistRequests[0], { title: "Review A", content: "Assumption A." });
    runtime.completeSpecialistRequest(runtime.specialistRequests[1], { title: "Review B", content: "Boundary B." });
    await application.waitForModelWork();
    expect(application.getState().sessions[0].agentTasks[0].status).toBe("complete");
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

  it("stops honestly at a budget limit while preserving useful partial output", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check a compactness argument", scope: "Inspect one assumption",
      initialTeachingDirection: "Read the current explanation", requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this compactness proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "requestSpecialistReview" });
    runtime.emitSpecialistPartial("The step uses Hausdorff separation.");
    runtime.failSpecialist(new Error("Specialist Agent output exceeded its token budget."));
    await application.waitForModelWork();

    expect(application.getState().sessions[0].agentTasks[0]).toMatchObject({
      status: "stopped",
      statusMessage: "Agent Task stopped at its token limit. Useful partial output was preserved.",
      integratedTeachingCard: {
        status: "stopped", content: "The step uses Hausdorff separation.", retryable: true
      }
    });
  });

  it("does not claim partial output was preserved when a budget limit is reached before a checkpoint", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check a compactness argument", scope: "Inspect one assumption",
      initialTeachingDirection: "Read the current explanation", requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const { application } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this compactness proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "requestSpecialistReview" });
    runtime.failSpecialist(new Error("Specialist Agent exceeded its token budget."));
    await application.waitForModelWork();

    expect(application.getState().sessions[0].agentTasks[0]).toMatchObject({
      status: "stopped",
      statusMessage: "Agent Task stopped at its token limit. No useful partial output was available to preserve.",
      integratedTeachingCard: { status: "stopped", content: "", retryable: true }
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

  it("checkpoints an unfinished Agent Task on quit and resumes it only after an explicit learner action", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check one proof step", scope: "Inspect one assumption",
      initialTeachingDirection: "Read the current explanation", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "requestSpecialistReview" });
    runtime.emitSpecialistPartial("This step uses Hausdorff separation.");
    runtime.reportSpecialistTokenUsage(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const sessionId = application.getState().sessions[0].id;
    const taskId = application.getState().sessions[0].agentTasks[0].id;

    await application.submit({ type: "leaveSession" });
    expect(application.getState().sessions[0].agentTasks[0]).toMatchObject({
      id: taskId,
      status: "working",
      integratedTeachingCard: { content: "This step uses Hausdorff separation." }
    });

    await application.shutdown();
    expect(application.getState().sessions[0].agentTasks[0]).toMatchObject({
      id: taskId,
      status: "stopped",
      statusMessage: "Agent Task checkpointed when the application closed. Resume when ready.",
      resumeAvailable: true,
      integratedTeachingCard: {
        status: "stopped",
        content: "This step uses Hausdorff separation.",
        retryable: false
      }
    });

    const localRelaunch = await LearningApplication.launch(dataDirectory);
    applications.push(localRelaunch);
    const localState = localRelaunch.getState();
    await expect(localRelaunch.submit({ type: "resumeAgentTask", taskId })).rejects.toThrow(
      "Codex Runtime is unavailable"
    );
    expect(localRelaunch.getState()).toEqual(localState);

    const resumedRuntime = new DeterministicModelRuntime({
      learningGoal: "Unused", scope: "Unused", initialTeachingDirection: "Unused",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const relaunched = await LearningApplication.launch(dataDirectory, resumedRuntime);
    applications.push(relaunched);
    expect(resumedRuntime.specialistRequests).toHaveLength(0);
    expect(relaunched.getState()).toMatchObject({ screen: "dashboard", activeSessionId: null });

    const resuming = await relaunched.submit({ type: "resumeAgentTask", taskId });
    expect(resuming).toMatchObject({ screen: "workbench", activeSessionId: sessionId });
    expect(resuming.sessions[0].agentTasks[0]).toMatchObject({
      id: taskId,
      status: "working",
      resumeAvailable: false,
      integratedTeachingCard: {
        status: "streaming",
        content: "This step uses Hausdorff separation.",
        retryable: false
      }
    });
    expect(resumedRuntime.specialistRequests).toHaveLength(1);
    expect(resumedRuntime.specialistRequests[0].budget.maxTokens).toBe(312);
    expect(resumedRuntime.specialistRequests[0].budget.maxLatencyMs).toBeLessThan(120_000);

    resumedRuntime.emitSpecialistPartial(
      "This step uses Hausdorff separation. The proof also needs compactness."
    );
    resumedRuntime.completeSpecialist({
      title: "Specialist review",
      content: "This step uses Hausdorff separation. The proof also needs compactness."
    });
    await relaunched.waitForModelWork();
    expect(relaunched.getState().sessions[0].agentTasks[0].integratedTeachingCard.content).toBe(
      "This step uses Hausdorff separation. The proof also needs compactness."
    );
  });

  it("resumes only unfinished specialists in a checkpointed dependent Agent Task", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check one proof step", scope: "Inspect one assumption",
      initialTeachingDirection: "Read the current explanation", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "requestSpecialistReview", coordination: "dependent" });
    runtime.completeSpecialistRequest(runtime.specialistRequests[0], {
      title: "First review", content: "The first specialist confirmed Hausdorff separation."
    });
    await vi.waitFor(() => expect(runtime.specialistRequests).toHaveLength(2));
    runtime.specialistRequests[1].onPartialResult(
      "The second specialist began checking the compactness step."
    );
    const taskId = application.getState().sessions[0].agentTasks[0].id;
    await application.shutdown();

    const resumedRuntime = new DeterministicModelRuntime({
      learningGoal: "Unused", scope: "Unused", initialTeachingDirection: "Unused",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const relaunched = await LearningApplication.launch(dataDirectory, resumedRuntime);
    applications.push(relaunched);
    await relaunched.submit({ type: "resumeAgentTask", taskId });

    await vi.waitFor(() => expect(resumedRuntime.specialistRequests).toHaveLength(1));
    expect(resumedRuntime.specialistRequests[0]).toMatchObject({
      purpose: "Stress-test the current Teaching Card for a counterexample or boundary case"
    });
    expect(resumedRuntime.specialistRequests[0].brief.constraints).toContain(
      "Earlier Specialist Agent conclusion: The first specialist confirmed Hausdorff separation."
    );
    resumedRuntime.completeSpecialistRequest(resumedRuntime.specialistRequests[0], {
      title: "Second review",
      content: "The second specialist began checking the compactness step. Compactness supplies the finite reduction."
    });
    await relaunched.waitForModelWork();

    const completed = relaunched.getState().sessions[0].agentTasks[0];
    expect(completed.status).toBe("complete");
    expect(completed.integratedTeachingCard.content.match(/first specialist confirmed/g)).toHaveLength(1);
    expect(completed.integratedTeachingCard.content.match(/second specialist began/g)).toHaveLength(1);
  });

  it("migrates a legacy Agent Task checkpoint into specialist progress before retrying", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check one proof step", scope: "Inspect one assumption",
      initialTeachingDirection: "Read the current explanation", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "requestSpecialistReview" });
    runtime.emitSpecialistPartial("Legacy checkpoint: Hausdorff separation is required.");
    runtime.failSpecialist(new Error("The legacy review stopped early."));
    await application.waitForModelWork();

    const stored = JSON.parse(await readFile(join(dataDirectory, "learning-application.json"), "utf8")) as {
      sessions: Array<{ agentTasks: Array<Record<string, unknown>> }>;
    };
    delete stored.sessions[0].agentTasks[0].specialistProgress;
    await writeFile(join(dataDirectory, "learning-application.json"), JSON.stringify(stored), "utf8");

    const resumedRuntime = new DeterministicModelRuntime({
      learningGoal: "Unused", scope: "Unused", initialTeachingDirection: "Unused",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const relaunched = await LearningApplication.launch(dataDirectory, resumedRuntime);
    applications.push(relaunched);
    const sessionId = relaunched.getState().sessions[0].id;
    const taskId = relaunched.getState().sessions[0].agentTasks[0].id;
    await relaunched.submit({ type: "resumeSession", sessionId });
    const retrying = await relaunched.submit({ type: "retryAgentTask", taskId });
    expect(retrying.sessions[0].agentTasks[0].integratedTeachingCard.content).toBe(
      "Legacy checkpoint: Hausdorff separation is required."
    );

    resumedRuntime.emitSpecialistPartial("The retry also checks compactness.");
    expect(relaunched.getState().sessions[0].agentTasks[0].integratedTeachingCard.content).toBe(
      "Legacy checkpoint: Hausdorff separation is required.\n\nRetry checkpoint:\nThe retry also checks compactness."
    );
    resumedRuntime.completeSpecialist({
      title: "Specialist review",
      content: "Legacy checkpoint: Hausdorff separation is required. The retry also checks compactness."
    });
    await relaunched.waitForModelWork();
  });

  it("retains but does not unsafely resume a legacy coordinated Agent Task checkpoint", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check one proof step", scope: "Inspect one assumption",
      initialTeachingDirection: "Read the current explanation", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "requestSpecialistReview", coordination: "dependent" });
    runtime.completeSpecialistRequest(runtime.specialistRequests[0], {
      title: "First review", content: "The first legacy specialist confirmed separation."
    });
    await vi.waitFor(() => expect(runtime.specialistRequests).toHaveLength(2));
    runtime.specialistRequests[1].onPartialResult("The second legacy specialist began a boundary check.");
    runtime.failSpecialist(new Error("The coordinated legacy review stopped early."));
    await application.waitForModelWork();
    const retainedContent = application.getState().sessions[0].agentTasks[0].integratedTeachingCard.content;

    const stored = JSON.parse(await readFile(join(dataDirectory, "learning-application.json"), "utf8")) as {
      sessions: Array<{ agentTasks: Array<Record<string, unknown>> }>;
    };
    delete stored.sessions[0].agentTasks[0].specialistProgress;
    await writeFile(join(dataDirectory, "learning-application.json"), JSON.stringify(stored), "utf8");

    const relaunched = await LearningApplication.launch(dataDirectory);
    applications.push(relaunched);
    expect(relaunched.getState().sessions[0].agentTasks[0]).toMatchObject({
      status: "stopped",
      resumeAvailable: false,
      statusMessage: expect.stringContaining("predates resumable specialist checkpoints"),
      integratedTeachingCard: {
        status: "stopped",
        content: retainedContent,
        retryable: false
      }
    });
  });

  it.each(["single", "dependent"] as const)(
    "restores a completed legacy %s Agent Task with retained historical progress",
    async (coordination) => {
      const runtime = new DeterministicModelRuntime({
        learningGoal: "Check one proof step", scope: "Inspect one assumption",
        initialTeachingDirection: "Read the current explanation", requiresConfirmation: false, confirmationReason: null
      }, true);
      const { application, dataDirectory } = await launchWithRuntime(runtime);
      await application.submit({ type: "submitSessionIntake", mathematics: "Review this proof." });
      runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
      runtime.completeTeaching();
      await application.waitForModelWork();
      await application.submit({ type: "requestSpecialistReview", coordination });
      runtime.completeSpecialistRequest(runtime.specialistRequests[0], {
        title: "First review", content: "The completed legacy review confirmed separation."
      });
      if (coordination === "dependent") {
        await vi.waitFor(() => expect(runtime.specialistRequests).toHaveLength(2));
        runtime.completeSpecialistRequest(runtime.specialistRequests[1], {
          title: "Second review", content: "The completed legacy stress test confirmed compactness."
        });
      }
      await application.waitForModelWork();
      const completedContent = application.getState().sessions[0].agentTasks[0].integratedTeachingCard.content;

      const stored = JSON.parse(await readFile(join(dataDirectory, "learning-application.json"), "utf8")) as {
        sessions: Array<{ agentTasks: Array<Record<string, unknown>> }>;
      };
      delete stored.sessions[0].agentTasks[0].specialistProgress;
      await writeFile(join(dataDirectory, "learning-application.json"), JSON.stringify(stored), "utf8");

      const relaunched = await LearningApplication.launch(dataDirectory);
      applications.push(relaunched);
      const restored = relaunched.getState().sessions[0].agentTasks[0];
      expect(restored).toMatchObject({
        status: "complete",
        resumeAvailable: false,
        integratedTeachingCard: { status: "completed", content: completedContent, retryable: false }
      });
      expect(restored.specialistProgress).toHaveLength(coordination === "single" ? 1 : 2);
      expect(restored.specialistProgress.every((progress) => progress.status === "retained")).toBe(true);
      expect(restored.specialistProgress[0].checkpoint).toBe(completedContent);
      expect(restored.specialistProgress.slice(1).every((progress) => progress.checkpoint === "")).toBe(true);
    }
  );

  it("does not offer an impossible retry after a checkpointed Agent Task exhausts its budget", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Check one proof step", scope: "Inspect one assumption",
      initialTeachingDirection: "Read the current explanation", requiresConfirmation: false, confirmationReason: null
    }, true);
    const { application, dataDirectory } = await launchWithRuntime(runtime);
    await application.submit({ type: "submitSessionIntake", mathematics: "Review this proof." });
    runtime.emitTeaching("The proof chooses disjoint neighbourhoods.");
    runtime.completeTeaching();
    await application.waitForModelWork();
    await application.submit({ type: "requestSpecialistReview" });
    runtime.emitSpecialistPartial("The bounded checkpoint is retained.");
    runtime.reportSpecialistTokenUsage(512);
    const taskId = application.getState().sessions[0].agentTasks[0].id;
    await application.shutdown();

    const resumedRuntime = new DeterministicModelRuntime({
      learningGoal: "Unused", scope: "Unused", initialTeachingDirection: "Unused",
      requiresConfirmation: false, confirmationReason: null
    }, true);
    const relaunched = await LearningApplication.launch(dataDirectory, resumedRuntime);
    applications.push(relaunched);
    await relaunched.submit({ type: "resumeAgentTask", taskId });
    await relaunched.waitForModelWork();

    expect(resumedRuntime.specialistRequests).toHaveLength(0);
    expect(relaunched.getState().sessions[0].agentTasks[0]).toMatchObject({
      status: "stopped",
      statusMessage: expect.stringContaining("No Agent Budget remains"),
      integratedTeachingCard: {
        content: "The bounded checkpoint is retained.",
        retryable: false
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

    expect(state).toMatchObject({
      runtimeAvailable: true,
      modelAccess: { status: "available" },
      runtimeCapabilities: runtime.capabilities
    });
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

  it.each(["focused", "workspace", "full"] as const)(
    "researches through a minimized inspectable query under %s access without model access",
    async (policy) => {
      const research = new DeterministicExternalResearch();
      const { application } = await launchWithExternalResearch(research);
      let state = await application.submit({ type: "startQuickStudy", mathematics: "Study orbit-stabilizer." });
      if (policy === "workspace") state = await application.submit({ type: "selectSessionAccessPolicy", policy });
      if (policy === "full") {
        state = await application.submit({ type: "setFullAccessConfirmation", enabled: false });
        state = await application.submit({ type: "selectSessionAccessPolicy", policy });
      }
      state = await application.submit({
        type: "researchWeb",
        query: {
          theoremNames: ["Orbit-stabilizer theorem"],
          assumptions: ["G acts on X"],
          keywords: ["stabilizer cosets"]
        },
        sourceAnchorIds: []
      });
      await application.waitForModelWork();
      state = application.getState();

      expect(research.requests).toHaveLength(1);
      expect(research.requests[0]).toMatchObject({
        query: {
          text: "Orbit-stabilizer theorem; G acts on X; stabilizer cosets",
          theoremNames: ["Orbit-stabilizer theorem"],
          assumptions: ["G acts on X"],
          keywords: ["stabilizer cosets"]
        },
        destination: "https://duckduckgo.com/?q=Orbit-stabilizer+theorem%3B+G+acts+on+X%3B+stabilizer+cosets",
        excerpts: []
      });
      expect(state.sessions[0].researchActions[0]).toMatchObject({
        status: "completed",
        accessPolicy: policy,
        query: { text: "Orbit-stabilizer theorem; G acts on X; stabilizer cosets" },
        destination: expect.stringMatching(/^https:\/\/duckduckgo\.com\/\?q=/),
        result: { title: "Research references" }
      });
      expect(state.modelAccess.status).toBe("unavailable");
    }
  );

  it("starts privacy-minimized automatic Source Corroboration under every policy without excerpt permission", async () => {
    const research = new DeterministicExternalResearch();
    const { application } = await launchWithExternalResearch(research);
    let state = await application.submit({
      type: "startQuickStudy",
      mathematics: "Prove the orbit-stabilizer theorem for a finite group acting on a set."
    });
    expect(state.sessions[0].researchEgressPermission).toEqual({ status: "notGranted" });
    expect(state.sessions[0].researchActions.find((action) => action.researchDepth === "lightweight")).toMatchObject({
      queryOrigin: "automaticCorroboration",
      informedBySourceIds: state.sessions[0].sourceIds,
      query: {
        theoremNames: ["orbit-stabilizer theorem"],
        assumptions: ["finite group"],
        keywords: []
      }
    });
    await application.waitForModelWork();
    expect(application.getState().sessions[0]).toMatchObject({
      researchActions: expect.arrayContaining([expect.objectContaining({ status: "completed" })]),
      corroborationPass: {
        status: "incomplete",
        errataCheck: "unchecked",
        independentSupport: "missing",
        deeperResearch: { required: true },
        message: expect.stringContaining("not presented as settled")
      }
    });
    expect(research.requests[0]).toMatchObject({
      queryOrigin: "automaticCorroboration",
      informedBySourceIds: state.sessions[0].sourceIds,
      excerpts: []
    });
  });

  it("completes a visible Corroboration Pass before substantive proof teaching begins", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Understand orbit-stabilizer",
      scope: "Prove the orbit-stabilizer theorem",
      initialTeachingDirection: "Compare the orbit map with its fibres",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const research = new DeterministicExternalResearch();
    let releaseResearch!: () => void;
    research.gate = new Promise<void>((resolve) => { releaseResearch = resolve; });
    research.result = {
      title: "Authoritative corroboration",
      summary: "The theorem statement and its use agree.",
      sources: [{ title: "Standard theorem reference", url: "https://example.test/orbit-stabilizer" }],
      corroboration: {
        relevantResult: "Orbit-stabilizer theorem",
        errataCheck: "noneFound",
        proposedApproachDeparture: false,
        evidence: [{
          sourceTitle: "Standard theorem reference",
          sourceUrl: "https://example.test/orbit-stabilizer",
          authority: "authoritative",
          relevance: "direct",
          relation: "supports",
          assumptions: "matches",
          conclusion: "matches",
          proofApproaches: ["Identify the orbit with the cosets of the stabilizer"],
          detail: "The stated action hypotheses and orbit-cardinality conclusion match the current use."
        }]
      }
    };
    const { application } = await launchWithRuntimeAndExternalResearch(runtime, research);

    const submission = application.submit({
      type: "submitSessionIntake",
      mathematics: "Prove the orbit-stabilizer theorem for a finite group acting on a set."
    });
    await vi.waitFor(() => expect(research.requests).toHaveLength(1));

    const whileCorroborating = application.getState().sessions[0];
    releaseResearch();
    const state = await submission;

    expect(whileCorroborating).toMatchObject({
      teachingCard: { status: "idle" },
      corroborationPass: {
        status: "running",
        relevantResult: "orbit-stabilizer theorem"
      }
    });
    expect(state.sessions[0]).toMatchObject({
      teachingCard: { status: "streaming" },
      corroborationPass: {
        status: "completed",
        assumptionComparison: "matches",
        conclusionComparison: "matches",
        errataCheck: "noneFound",
        independentSupport: "sufficient",
        deeperResearch: { required: false }
      }
    });
    expect(runtime.teachingRequests[0].corroboration).toMatchObject({
      status: "completed", relevantResult: "Orbit-stabilizer theorem", independentSupport: "sufficient"
    });
    runtime.completeTeaching();
  });

  it.each([
    "What is the argument of a complex number, and what does equivalent mean?",
    "What is the difference between a lemma and a proposition?",
    "What is a proof?",
    "Why is the orbit-stabilizer theorem called a theorem?"
  ])("does not treat definitional vocabulary as substantive proof intent: %s", async (mathematics) => {
    const research = new DeterministicExternalResearch();
    const { application } = await launchWithExternalResearch(research);

    const state = await application.submit({ type: "startQuickStudy", mathematics });

    expect(research.requests).toEqual([]);
    expect(state.sessions[0].corroborationPass).toBeNull();
  });

  it("recognizes selected source proof material as a Pedagogical Baseline", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Prove the selected claim",
      scope: "Use the selected statement",
      initialTeachingDirection: "Inspect the selection",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const research = new DeterministicExternalResearch();
    research.result = {
      title: "Authoritative corroboration",
      summary: "The selected statement agrees with an authoritative reference.",
      sources: [{ title: "Topology reference", url: "https://example.test/topology" }],
      corroboration: {
        relevantResult: "Compact subsets of Hausdorff spaces are closed",
        errataCheck: "noneFound",
        proposedApproachDeparture: false,
        evidence: [authoritativeEvidence({
          sourceTitle: "Topology reference",
          sourceUrl: "https://example.test/topology",
          proofApproaches: []
        })]
      }
    };
    const { application } = await launchWithRuntimeAndExternalResearch(runtime, research);
    const started = await application.submit({
      type: "submitSessionIntake",
      mathematics: "Study compact subsets of Hausdorff spaces."
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
    expect(research.requests).toEqual([]);

    await application.submit({
      type: "createSourceAnchor",
      sourceId: started.sessions[0].sourceIds[0],
      selection: {
        kind: "text",
        startOffset: 6,
        endOffset: 13,
        exactText: "compact",
        prefix: "Study ",
        suffix: " subsets of Hausdorff spaces."
      },
      paletteAction: "explain"
    });

    expect(research.requests).toHaveLength(1);
    expect(application.getState().sessions[0].corroborationPass).toMatchObject({
      status: "completed",
      pedagogicalBaselinePresent: true,
      proofApproachResearch: "notRequired",
      deeperResearch: { required: false }
    });
    runtime.completeTeaching();
  });

  it("keeps an authoritative assumption mismatch disputed", async () => {
    const pass = await corroborateWithEvidence([authoritativeEvidence({
      assumptions: "mismatch",
      detail: "The reference requires a group action, but the current use supplies only a set map."
    })]);
    expect(pass).toMatchObject({
      status: "disputed",
      assumptionComparison: "mismatch",
      independentSupport: "conflicting",
      deeperResearch: { required: true },
      sourceDiscrepancies: [{ competingEvidence: [expect.objectContaining({ assumptions: "mismatch" })] }]
    });
  });

  it("preserves known errata as a Source Discrepancy", async () => {
    const pass = await corroborateWithEvidence([authoritativeEvidence({
      authority: "primary",
      relation: "erratum",
      detail: "The publisher erratum adds the missing action hypothesis."
    })]);
    expect(pass).toMatchObject({
      status: "disputed",
      errataCheck: "found",
      sourceDiscrepancies: [{
        summary: expect.stringContaining("materially disagrees"),
        competingEvidence: [expect.objectContaining({ relation: "erratum" })]
      }]
    });
  });

  it("keeps a reported erratum disputed when the provider omits correction evidence", async () => {
    const research = new DeterministicExternalResearch();
    research.result = {
      title: "Incomplete errata report",
      summary: "The provider reports errata but omits the correction evidence.",
      sources: [{ title: "Authoritative theorem reference", url: "https://example.test/orbit-stabilizer" }],
      corroboration: {
        relevantResult: "Orbit-stabilizer theorem",
        errataCheck: "found",
        proposedApproachDeparture: false,
        evidence: [authoritativeEvidence()]
      }
    };
    const { application } = await launchWithExternalResearch(research);

    await application.submit({
      type: "startQuickStudy",
      mathematics: "Prove the orbit-stabilizer theorem for a finite group acting on a set."
    });
    await application.waitForModelWork();

    expect(application.getState().sessions[0].corroborationPass).toMatchObject({
      status: "disputed",
      errataCheck: "found",
      independentSupport: "conflicting",
      sourceDiscrepancies: [{ summary: expect.stringContaining("without attaching") }]
    });
  });

  it("does not treat agreement among derivative sources as sufficient corroboration", async () => {
    const pass = await corroborateWithEvidence([
      authoritativeEvidence({ sourceTitle: "Derivative notes A", authority: "derivative", relevance: "related" }),
      authoritativeEvidence({ sourceTitle: "Derivative notes B", authority: "derivative", relevance: "weak" })
    ]);
    expect(pass).toMatchObject({
      status: "incomplete",
      independentSupport: "weakOnly",
      deeperResearch: { required: true, reason: expect.stringContaining("weak") },
      sourceDiscrepancies: []
    });
  });

  it("preserves both sides when authoritative sources conflict", async () => {
    const pass = await corroborateWithEvidence([
      authoritativeEvidence({ sourceTitle: "Authority supporting the use" }),
      authoritativeEvidence({
        sourceTitle: "Authority disputing the conclusion",
        relation: "conflicts",
        conclusion: "mismatch",
        detail: "This source gives a counterexample under the stated assumptions."
      })
    ]);
    expect(pass).toMatchObject({
      status: "disputed",
      conclusionComparison: "mismatch",
      independentSupport: "conflicting",
      sourceDiscrepancies: [{ competingEvidence: [
        expect.objectContaining({ sourceTitle: "Authority supporting the use" }),
        expect.objectContaining({ sourceTitle: "Authority disputing the conclusion" })
      ] }]
    });
  });

  it("researches an established proof approach when no Pedagogical Baseline exists", async () => {
    const pass = await corroborateWithEvidence([authoritativeEvidence({
      proofApproaches: ["Identify the orbit with stabilizer cosets"]
    })]);
    expect(pass).toMatchObject({
      status: "completed",
      pedagogicalBaselinePresent: false,
      proofApproachResearch: "established",
      deeperResearch: { required: false }
    });
  });

  it("runs a new Corroboration Pass before a later substantive proof Question Card", async () => {
    const runtime = new DeterministicModelRuntime({
      learningGoal: "Explore arithmetic",
      scope: "Begin with a simple computation",
      initialTeachingDirection: "Compute directly",
      requiresConfirmation: false,
      confirmationReason: null
    }, true);
    const research = new DeterministicExternalResearch();
    const { application } = await launchWithRuntimeAndExternalResearch(runtime, research);
    await application.submit({ type: "submitSessionIntake", mathematics: "Compute 2 + 2." });
    runtime.completeTeaching();
    await application.waitForModelWork();
    research.result = {
      title: "Irrationality references",
      summary: "A standard proof was found.",
      sources: [{ title: "Authoritative number theory reference", url: "https://example.test/irrationality" }],
      corroboration: {
        relevantResult: "Irrationality of the square root of 2",
        errataCheck: "noneFound",
        proposedApproachDeparture: false,
        evidence: [authoritativeEvidence({
          sourceTitle: "Authoritative number theory reference",
          sourceUrl: "https://example.test/irrationality",
          proofApproaches: ["Contradict a lowest-terms rational representation"]
        })]
      }
    };
    let releaseResearch!: () => void;
    research.gate = new Promise<void>((resolve) => { releaseResearch = resolve; });

    const question = application.submit({ type: "submitQuestion", text: "Prove that sqrt 2 is irrational." });
    await vi.waitFor(() => expect(research.requests).toHaveLength(1));
    expect(runtime.teachingRequests).toHaveLength(1);
    expect(application.getState().sessions[0].corroborationPass).toMatchObject({
      status: "running",
      relevantResult: "Current proof claim",
      currentUse: { conclusion: "Prove that sqrt 2 is irrational." }
    });

    releaseResearch();
    await question;
    expect(runtime.teachingRequests).toHaveLength(2);
    expect(runtime.teachingRequests[1].corroboration).toMatchObject({
      status: "completed",
      relevantResult: "Irrationality of the square root of 2"
    });
    runtime.completeTeaching();
    await application.waitForModelWork();
    research.gate = null;
    await application.submit({ type: "submitQuestion", text: "Prove the orbit-stabilizer theorem." });
    expect(application.getState().sessions[0]).toMatchObject({
      corroborationPass: { currentUse: { conclusion: "Prove the orbit-stabilizer theorem." } },
      corroborationPassHistory: [
        { currentUse: { conclusion: "Prove that sqrt 2 is irrational." }, status: "completed" }
      ]
    });
    runtime.completeTeaching();
  });

  it("dispatches one bounded deeper research action when lightweight evidence is weak", async () => {
    const research = new DeterministicExternalResearch();
    const weakEvidence = authoritativeEvidence({ authority: "derivative", relevance: "weak" });
    research.result = {
      title: "Weak references",
      summary: "Only derivative agreement was found.",
      sources: [{ title: weakEvidence.sourceTitle, url: weakEvidence.sourceUrl }],
      corroboration: {
        relevantResult: "Orbit-stabilizer theorem",
        errataCheck: "unavailable",
        proposedApproachDeparture: false,
        evidence: [weakEvidence]
      }
    };
    const { application } = await launchWithExternalResearch(research);
    await application.submit({
      type: "startQuickStudy",
      mathematics: "Prove the orbit-stabilizer theorem for a finite group acting on a set."
    });
    await application.waitForModelWork();

    expect(research.requests.map((request) => request.researchDepth)).toEqual(["lightweight", "deep"]);
    expect(research.requests[1].query.keywords).toEqual(["published errata", "authoritative proof approach"]);
    expect(application.getState().sessions[0]).toMatchObject({
      researchActions: [
        { researchDepth: "lightweight", status: "completed" },
        { researchDepth: "deep", status: "completed" }
      ],
      corroborationPass: {
        status: "incomplete",
        deeperResearch: { required: true, performed: true }
      }
    });
  });

  it("preserves a lightweight Source Discrepancy when deeper research only finds support", async () => {
    const research = new DeterministicExternalResearch();
    research.resultsByDepth.set("lightweight", {
      title: "Conflicting reference",
      summary: "An authoritative counterexample was found.",
      sources: [{ title: "Counterexample reference", url: "https://example.test/counterexample" }],
      corroboration: {
        relevantResult: "Orbit-stabilizer theorem",
        errataCheck: "noneFound",
        proposedApproachDeparture: false,
        evidence: [authoritativeEvidence({
          sourceTitle: "Counterexample reference",
          sourceUrl: "https://example.test/counterexample",
          relation: "conflicts",
          conclusion: "mismatch",
          detail: "The stated conclusion fails under the supplied assumptions."
        })]
      }
    });
    research.resultsByDepth.set("deep", {
      title: "Supporting reference",
      summary: "A standard proof was also found.",
      sources: [{ title: "Supporting reference", url: "https://example.test/support" }],
      corroboration: {
        relevantResult: "Orbit-stabilizer theorem",
        errataCheck: "noneFound",
        proposedApproachDeparture: false,
        evidence: [authoritativeEvidence({
          sourceTitle: "Supporting reference",
          sourceUrl: "https://example.test/support"
        })]
      }
    });
    const { application } = await launchWithExternalResearch(research);

    await application.submit({
      type: "startQuickStudy",
      mathematics: "Prove the orbit-stabilizer theorem for a finite group acting on a set."
    });
    await application.waitForModelWork();

    expect(application.getState().sessions[0].corroborationPass).toMatchObject({
      status: "disputed",
      independentSupport: "conflicting",
      deeperResearch: { required: true, performed: true },
      evidence: [
        expect.objectContaining({ relation: "conflicts" }),
        expect.objectContaining({ relation: "supports" })
      ],
      sourceDiscrepancies: [{ competingEvidence: [
        expect.objectContaining({ relation: "conflicts" }),
        expect.objectContaining({ relation: "supports" })
      ] }]
    });
  });

  async function corroborateWithEvidence(evidence: CorroborationResearchEvidence[]) {
    const research = new DeterministicExternalResearch();
    research.result = {
      title: "Deterministic benchmark evidence",
      summary: "Pinned corroboration fixture.",
      sources: evidence.map((item) => ({ title: item.sourceTitle, url: item.sourceUrl })),
      corroboration: {
        relevantResult: "Orbit-stabilizer theorem",
        errataCheck: evidence.some((item) => item.relation === "erratum") ? "found" : "noneFound",
        proposedApproachDeparture: false,
        evidence
      }
    };
    const { application } = await launchWithExternalResearch(research);
    await application.submit({
      type: "startQuickStudy",
      mathematics: "Prove the orbit-stabilizer theorem for a finite group acting on a set."
    });
    await application.waitForModelWork();
    return application.getState().sessions[0].corroborationPass;
  }

  it.each([
    ["Study Cauchy's theorem from /Users/alice/private-course-notes.pdf", ["Cauchy's theorem"], [], []],
    ["Give a proof of Cauchy's theorem using unrelated topology notes.", ["Cauchy's theorem"], [], []],
    ["Let G be a finite group; prove that every subgroup has finite index.", [], ["finite group"], ["subgroup"]],
    ["Why are all compact subsets of a Hausdorff space closed?", [], ["hausdorff space"], ["compact"]],
    ["Study the Sylow theorems", ["Sylow theorems"], [], []]
  ] as const)("automatically derives only allowlisted mathematical terms from %s", async (mathematics, theoremNames, assumptions, keywords) => {
    const research = new DeterministicExternalResearch();
    const { application } = await launchWithExternalResearch(research);
    await application.submit({ type: "startQuickStudy", mathematics });
    await application.waitForModelWork();
    expect(research.requests[0].query).toMatchObject({
      theoremNames: [...theoremNames], assumptions: [...assumptions], keywords: [...keywords]
    });
    expect(research.requests[0].query.text).not.toMatch(/Users|alice|private-course-notes|pdf/i);
  });

  it("keeps Source Excerpt Egress session-scoped, inspectable, and revocable", async () => {
    const research = new DeterministicExternalResearch();
    const { application, dataDirectory } = await launchWithExternalResearch(research);
    let state = await application.submit({
      type: "startQuickStudy",
      mathematics: "The orbit map induces a bijection from G/G_x to Gx."
    });
    const session = state.sessions[0];
    const sourceId = session.sourceIds[0];
    state = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "equation", equationIndex: 0, startOffset: 39, endOffset: 44,
        exactText: "G/G_x", prefix: "bijection from ", suffix: " to Gx."
      },
      paletteAction: "addNote"
    });
    const anchorId = state.sessions[0].sourceAnchors[0].id;

    state = await application.submit({
      type: "researchWeb",
      query: { theoremNames: ["Orbit-stabilizer theorem"], assumptions: [], keywords: [] },
      sourceAnchorIds: [anchorId]
    });
    await application.waitForModelWork();
    state = application.getState();
    expect(state.sessions[0].researchActions.at(-1)).toMatchObject({ status: "denied" });
    expect(research.requests).toEqual([]);

    state = await application.submit({ type: "setSourceExcerptEgressPreference", enabled: true });
    state = await application.submit({ type: "setResearchEgressPermission", enabled: true });
    state = await application.submit({
      type: "researchWeb",
      query: { theoremNames: ["Orbit-stabilizer theorem"], assumptions: [], keywords: [] },
      sourceAnchorIds: [anchorId]
    });
    await application.waitForModelWork();
    state = application.getState();
    expect(research.requests[0].excerpts).toEqual([{
      sourceId, kind: "equation", content: "G/G_x", location: "Equation 1: characters 39–44",
      relevance: "learnerSelectedForQuery"
    }]);
    expect(state.sessions[0].researchEgressPermission).toEqual({ status: "granted" });
    expect(state.sessions[0].researchActions.at(-1)?.excerpts).toEqual([{
      sourceId, kind: "equation", location: "Equation 1: characters 39–44", content: "G/G_x",
      relevance: "learnerSelectedForQuery"
    }]);

    research.hold = true;
    state = await application.submit({
      type: "researchWeb",
      query: { theoremNames: ["Orbit-stabilizer theorem"], assumptions: [], keywords: [] },
      sourceAnchorIds: [anchorId]
    });
    expect(state.sessions[0].researchActions.at(-1)).toMatchObject({ status: "running" });
    state = await application.submit({ type: "setResearchEgressPermission", enabled: false });
    await application.waitForModelWork();
    expect(application.getState().sessions[0].researchActions.at(-1)).toMatchObject({
      status: "stopped", error: expect.stringContaining("Permission for Source Excerpts was revoked")
    });
    research.hold = false;
    state = await application.submit({ type: "setResearchEgressPermission", enabled: true });

    state = await application.submit({
      type: "createSourceAnchor",
      sourceId,
      selection: {
        kind: "text", startOffset: 0, endOffset: session.mathematics.length,
        exactText: session.mathematics, prefix: "", suffix: ""
      },
      paletteAction: "addNote"
    });
    const wholeSourceAnchorId = state.sessions[0].sourceAnchors.at(-1)!.id;
    state = await application.submit({
      type: "researchWeb",
      query: { theoremNames: ["Orbit-stabilizer theorem"], assumptions: [], keywords: [] },
      sourceAnchorIds: [wholeSourceAnchorId]
    });
    expect(state.sessions[0].researchActions.at(-1)).toMatchObject({
      status: "denied", error: expect.stringContaining("Whole-file transmission requires a separate explicit confirmation")
    });
    expect(research.requests).toHaveLength(2);

    state = await application.submit({ type: "setResearchEgressPermission", enabled: false });
    state = await application.submit({
      type: "researchWeb",
      query: { theoremNames: ["Orbit-stabilizer theorem"], assumptions: [], keywords: [] },
      sourceAnchorIds: [anchorId]
    });
    expect(state.sessions[0].researchEgressPermission).toEqual({ status: "revoked" });
    expect(state.sessions[0].researchActions.at(-1)).toMatchObject({ status: "denied" });
    expect(research.requests).toHaveLength(2);

    await application.submit({ type: "leaveSession" });
    const reloaded = await LearningApplication.launch(dataDirectory, null, null, null, research);
    applications.push(reloaded);
    expect(reloaded.getState().sourceExcerptEgressPreference).toEqual({ enabled: true });
    expect(reloaded.getState().sessions[0]).toMatchObject({
      researchEgressPermission: { status: "revoked" },
      researchActions: expect.arrayContaining([expect.objectContaining({ status: "completed" })])
    });
    const next = await reloaded.submit({ type: "startQuickStudy", mathematics: "Study Lagrange's theorem." });
    expect(next.sessions.find((candidate) => candidate.id === next.activeSessionId)?.researchEgressPermission)
      .toEqual({ status: "notGranted" });
  });

  it("permits only selected pages verified against an available policy-authorized Source Index", async () => {
    const research = new DeterministicExternalResearch();
    const sourceAccess = new DeterministicSourceAccess();
    sourceAccess.indexBySourceName.set("cauchy-proof.pdf", {
      extractionMethod: "pdfText",
      pages: [{
        pageNumber: 2, width: 1000, height: 1400, thumbnailDataUrl: "data:image/png;base64,cDI=",
        regions: [{
          kind: "text", text: "Cauchy theorem proof", bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
          sourceStartOffset: 0, sourceEndOffset: 20
        }]
      }]
    });
    const { application } = await launchWithExternalResearchAndSourceAccess(research, sourceAccess);
    let state = await application.linkExternalAttachment("quick-study-workspace", {
      name: "cauchy-proof.pdf", resourceType: "file",
      lastKnownPath: "/Users/learner/cauchy-proof.pdf", canonicalPath: "/Users/learner/cauchy-proof.pdf",
      accessGrant: { kind: "securityScopedBookmark", bookmarkData: "cauchy-bookmark" },
      fingerprint: sourceAccess.fingerprint
    });
    const sourceId = state.sources[0].id;
    state = await application.submit({ type: "startQuickStudy", mathematics: "Review the finite group argument." });
    await application.submit({ type: "addSourceToSession", sourceId });
    await expect(application.submit({
      type: "createSourceAnchor", sourceId,
      selection: {
        kind: "text", startOffset: 0, endOffset: 14, exactText: "Cauchy theorem",
        prefix: "", suffix: " proof", pageNumbers: [999]
      },
      paletteAction: "addNote"
    })).rejects.toThrow("available in the current Source Index");

    state = await application.submit({
      type: "createSourceAnchor", sourceId,
      selection: {
        kind: "text", startOffset: 0, endOffset: 14, exactText: "Cauchy theorem",
        prefix: "", suffix: " proof", pageNumbers: [2]
      },
      paletteAction: "addNote"
    });
    const selectedPagesAnchorId = state.sessions[0].sourceAnchors.at(-1)!.id;
    await application.submit({ type: "setSourceExcerptEgressPreference", enabled: true });
    await application.submit({ type: "setResearchEgressPermission", enabled: true });
    await application.submit({
      type: "researchWeb",
      query: { theoremNames: ["Cauchy's theorem"], assumptions: ["finite group"], keywords: [] },
      sourceAnchorIds: [selectedPagesAnchorId]
    });
    await application.waitForModelWork();
    expect(research.requests.at(-1)?.excerpts).toEqual([{
      sourceId, kind: "selectedPages", content: "Cauchy theorem",
      location: "Selected pages 2: characters 0–14", relevance: "learnerSelectedForQuery"
    }]);
  });

  it("retains visible timeout and malformed-result states without broader egress", async () => {
    const research = new DeterministicExternalResearch();
    const { application } = await launchWithExternalResearch(research);
    let state = await application.submit({ type: "startQuickStudy", mathematics: "Study Cauchy's theorem." });
    state = await application.submit({ type: "setResearchEgressPermission", enabled: true });
    research.error = new DOMException("Research timed out", "TimeoutError");
    state = await application.submit({
      type: "researchWeb",
      query: { theoremNames: ["Cauchy's theorem"], assumptions: [], keywords: ["finite groups"] },
      sourceAnchorIds: []
    });
    await application.waitForModelWork();
    state = application.getState();
    expect(state.sessions[0].researchActions.at(-1)).toMatchObject({
      status: "timedOut", error: expect.stringContaining("timed out")
    });

    research.error = null;
    research.result = { title: "", summary: "missing title", sources: [] };
    state = await application.submit({
      type: "researchWeb",
      query: { theoremNames: ["Cauchy's theorem"], assumptions: [], keywords: [] },
      sourceAnchorIds: []
    });
    await application.waitForModelWork();
    state = application.getState();
    expect(state.sessions[0].researchActions.at(-1)).toMatchObject({
      status: "failed", error: expect.stringContaining("malformed result")
    });
    expect(state.sessions[0].accessPolicy).toBe("focused");
  });

  it("publishes cancellable external research and never retries it silently", async () => {
    const research = new DeterministicExternalResearch();
    research.hold = true;
    const { application } = await launchWithExternalResearch(research);
    let state = await application.submit({ type: "startQuickStudy", mathematics: "Explore finite-group structure." });
    state = await application.submit({ type: "setResearchEgressPermission", enabled: true });
    const observedStatuses: string[] = [];
    application.subscribe((next) => {
      const status = next.sessions[0]?.researchActions.at(-1)?.status;
      if (status) observedStatuses.push(status);
    });

    state = await application.submit({
      type: "researchWeb",
      query: { theoremNames: ["Sylow theorems"], assumptions: [], keywords: ["finite groups"] },
      sourceAnchorIds: []
    });
    const actionId = state.sessions[0].researchActions.at(-1)!.id;
    expect(observedStatuses).toContain("running");
    expect(state.sessions[0].researchActions.at(-1)).toMatchObject({ status: "running" });

    state = await application.submit({ type: "cancelExternalResearch", researchActionId: actionId });
    await application.waitForModelWork();
    expect(state.sessions[0].researchActions.at(-1)).toMatchObject({
      status: "stopped", error: expect.stringContaining("stopped by the learner")
    });
    expect(research.requests).toHaveLength(1);
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

function transferableSessionProposal(): SessionProposal {
  return {
    learningGoal: "Understand the finite-subcover strategy",
    scope: "Explain the finite-subcover step",
    initialTeachingDirection: "Start from pointwise choices",
    requiresConfirmation: false,
    confirmationReason: null,
    evidenceTransferContext: {
      concepts: ["finite subcover"],
      mathematicalStructures: ["compact topological space"],
      prerequisiteRelationships: [{
        prerequisiteConcept: "open cover",
        supportsConcept: "finite subcover",
        relationship: "requiredFor"
      }],
      taskDemands: ["apply a finite-subcover proof strategy"]
    }
  };
}

function delayedTaskContext(taskDemand = "derive a uniform bound from finitely many local bounds") {
  return {
    concepts: ["finite subcover"],
    mathematicalStructures: ["compact parameter space with local bounds"],
    prerequisiteRelationships: [{
      prerequisiteConcept: "open cover", supportsConcept: "finite subcover", relationship: "requiredFor" as const
    }],
    taskDemands: [taskDemand]
  };
}

async function createCorroboratedPinnedArtifact(
  application: LearningApplication,
  runtime: DeterministicModelRuntime
) {
  let state = await application.submit({
    type: "submitSessionIntake",
    mathematics: "Prove the orbit-stabilizer theorem for a finite group acting on a set."
  });
  runtime.completeTeaching();
  await application.waitForModelWork();
  const source = state.sources.find((candidate) => candidate.id === state.sessions[0].sourceIds[0])!;
  if (source.kind !== "managedAsset") throw new Error("Expected the typed mathematics source fixture.");
  const exactText = "orbit-stabilizer theorem";
  const startOffset = source.content.indexOf(exactText);
  state = await application.submit({
    type: "createSourceAnchor", sourceId: source.id,
    selection: {
      kind: "text", startOffset, endOffset: startOffset + exactText.length, exactText,
      prefix: source.content.slice(Math.max(0, startOffset - 6), startOffset),
      suffix: source.content.slice(startOffset + exactText.length, startOffset + exactText.length + 12)
    },
    paletteAction: "explain"
  });
  const pass = state.sessions[0].corroborationPass!;
  runtime.emitTeaching(pass.currentUse.conclusion);
  runtime.completeTeaching();
  await application.waitForModelWork();
  state = await application.submit({
    type: "pinTeachingCardArtifact", cardId: application.getState().sessions[0].anchoredTeachingCards[0].id
  });
  const artifact = state.sessions[0].learningArtifacts[0];
  return {
    artifactId: artifact.id,
    revision: structuredClone(artifact.currentRevision),
    researchActionId: pass.researchActionId!
  };
}

function supportingExternalResearch(): DeterministicExternalResearch {
  const research = new DeterministicExternalResearch();
  research.result = {
    title: "Authoritative corroboration",
    summary: "The assumptions and conclusion agree with an authoritative reference.",
    sources: [{ title: "Authoritative algebra reference", url: "https://example.test/orbit-stabilizer" }],
    corroboration: {
      relevantResult: "Orbit-stabilizer theorem",
      errataCheck: "noneFound",
      proposedApproachDeparture: false,
      evidence: [authoritativeEvidence({
        sourceTitle: "Authoritative algebra reference",
        sourceUrl: "https://example.test/orbit-stabilizer",
        proofApproaches: ["Identify the orbit with cosets of the stabilizer"],
        detail: "The group-action assumptions and orbit-cardinality conclusion match the current use."
      })]
    }
  };
  return research;
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

class DeterministicExternalResearch implements ExternalResearch {
  readonly requests: ExternalResearchRequest[] = [];
  readonly resultsByDepth = new Map<ExternalResearchRequest["researchDepth"], ExternalResearchResult>();
  result: ExternalResearchResult = {
    title: "Research references",
    summary: "A browser search was prepared from minimized mathematical terms.",
    sources: [{ title: "Orbit-stabilizer theorem", url: "https://example.test/orbit-stabilizer" }]
  };
  error: Error | null = null;
  hold = false;
  gate: Promise<void> | null = null;

  async research(request: ExternalResearchRequest): Promise<ExternalResearchResult> {
    this.requests.push(request);
    if (this.error) throw this.error;
    if (this.gate) await this.gate;
    if (this.hold) {
      await new Promise<void>((_resolve, reject) => request.signal.addEventListener(
        "abort", () => reject(new DOMException("External research was stopped.", "AbortError")), { once: true }
      ));
    }
    return structuredClone(this.resultsByDepth.get(request.researchDepth) ?? this.result);
  }
}

class DeterministicFormalVerificationAuthority implements FormalVerificationAuthority {
  readonly receipts = new Map<string, AcceptedFormalVerification>();

  async resolveAcceptedReceipt(receiptId: string): Promise<AcceptedFormalVerification | null> {
    return structuredClone(this.receipts.get(receiptId) ?? null);
  }
}

function authoritativeEvidence(
  overrides: Partial<CorroborationResearchEvidence> = {}
): CorroborationResearchEvidence {
  return {
    sourceTitle: "Authoritative theorem reference",
    sourceUrl: "https://example.test/orbit-stabilizer",
    authority: "authoritative",
    relevance: "direct",
    relation: "supports",
    assumptions: "matches",
    conclusion: "matches",
    proofApproaches: ["Identify the orbit with the cosets of the stabilizer"],
    detail: "The theorem statement matches the current use.",
    ...overrides
  };
}

class DeterministicModelRuntime implements ModelRuntime {
  readonly teachingRequests: TeachingRequest[] = [];
  readonly specialistRequests: SpecialistAgentRequest[] = [];
  readonly artifactSynthesisRequests: ArtifactSynthesisRequest[] = [];
  readonly artifactRegenerationRequests: ArtifactRegenerationRequest[] = [];
  readonly artifactClaimRecheckRequests: Parameters<ModelRuntime["recheckArtifactClaim"]>[0][] = [];
  artifactClaimRecheckResult: Awaited<ReturnType<ModelRuntime["recheckArtifactClaim"]>> = {
    outcome: "supports", summary: "The exact revised claim follows from its stated assumptions."
  };
  artifactRegenerationResult: Awaited<ReturnType<ModelRuntime["regenerateArtifact"]>> = {
    replacementContent: "A regenerated section.", claimEdits: [], claimImpacts: [], unresolvedRepairs: []
  };
  readonly conceptPeekRequests: Parameters<ModelRuntime["createConceptPeek"]>[0][] = [];
  readonly delayedTransferTaskRequests: Parameters<ModelRuntime["createDelayedTransferTask"]>[0][] = [];
  delayedTransferTask: Awaited<ReturnType<ModelRuntime["createDelayedTransferTask"]>> = {
    prompt: "A compact parameter space has local bounds. Use a finite subcover to obtain one uniform bound.",
    concept: "finite subcover",
    taskDemand: "derive a uniform bound from finitely many local bounds",
    structuralComparison: "This task preserves the structure while changing the surface problem.",
    mathematicalContext: delayedTaskContext()
  };
  readonly delayedTransferClarificationRequests: Parameters<ModelRuntime["clarifyDelayedTransferTask"]>[0][] = [];
  delayedTransferClarification = "Clarify the structure while leaving the proof step to the learner.";
  readonly delayedTransferAssessmentRequests: Parameters<ModelRuntime["assessDelayedTransferWork"]>[0][] = [];
  delayedTransferAssessment: Awaited<ReturnType<ModelRuntime["assessDelayedTransferWork"]>> = {
    result: "demonstrated",
    reasoningQuality: "strong",
    confidenceCalibration: "aligned",
    misconceptionOrStrength: "The learner transfers the structure correctly.",
    recommendedNextAction: "Continue with a more distant application.",
    refresherGoal: null
  };
  readonly canceledSessionIds: string[] = [];
  private readonly teachingCompletions = new Map<TeachingRequest, () => void>();
  private readonly teachingFailures = new Map<TeachingRequest, (error: Error) => void>();
  private readonly specialistCompletions = new Map<SpecialistAgentRequest, (result: SpecialistAgentResult) => void>();
  private readonly specialistFailures = new Map<SpecialistAgentRequest, (error: Error) => void>();
  authentication: Awaited<ReturnType<ModelRuntime["getAuthentication"]>> = {
    status: "signedIn",
    method: "chatgpt",
    accountLabel: "learner@example.com"
  };
  readonly capabilities: Awaited<ReturnType<ModelRuntime["getCapabilities"]>> = {
    models: [
      { model: "codex-fast", displayName: "Codex Fast", isDefault: true, supportedReasoningEfforts: ["low", "medium"] },
      { model: "codex-deep", displayName: "Codex Deep", isDefault: false, supportedReasoningEfforts: ["medium", "high", "max"] }
    ]
  };
  chatGptLoginStarts = 0;
  readonly receivedApiKeys: string[] = [];
  proposalError: Error | null = null;
  authenticationError: Error | null = null;
  capabilitiesError: Error | null = null;
  cancelError: Error | null = null;
  artifactSynthesisError: Error | null = null;
  artifactSynthesisContent: string | null = null;
  completeTeachingOnCancel = true;
  teachingDeltaOnStart: string | null = null;
  holdConceptPeek = false;
  holdArtifactSynthesis = false;
  holdArtifactRegeneration = false;
  holdArtifactClaimRecheck = false;
  holdDelayedTransferTask = false;
  ignoreDelayedTransferAbort = false;
  private delayedTransferTaskCompletion: (() => void) | null = null;
  private artifactRegenerationCompletion: (() => void) | null = null;
  private artifactClaimRecheckCompletion: (() => void) | null = null;

  constructor(private readonly proposal: SessionProposal, private readonly holdTeaching = false) {}

  async getCapabilities() {
    if (this.capabilitiesError) throw this.capabilitiesError;
    return structuredClone(this.capabilities);
  }

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

  async createDelayedTransferTask(request: Parameters<ModelRuntime["createDelayedTransferTask"]>[0]) {
    this.delayedTransferTaskRequests.push(request);
    if (this.holdDelayedTransferTask) {
      if (request.signal.aborted) throw new Error("Delayed Transfer task preparation aborted.");
      await new Promise<void>((resolve, reject) => {
        this.delayedTransferTaskCompletion = resolve;
        if (!this.ignoreDelayedTransferAbort) request.signal.addEventListener(
          "abort", () => reject(new Error("Delayed Transfer task preparation aborted.")), { once: true }
        );
      });
    }
    return structuredClone(this.delayedTransferTask);
  }

  completeDelayedTransferTaskPreparation() {
    this.delayedTransferTaskCompletion?.();
    this.delayedTransferTaskCompletion = null;
  }

  async clarifyDelayedTransferTask(request: Parameters<ModelRuntime["clarifyDelayedTransferTask"]>[0]) {
    this.delayedTransferClarificationRequests.push(request);
    return this.delayedTransferClarification;
  }

  async assessDelayedTransferWork(request: Parameters<ModelRuntime["assessDelayedTransferWork"]>[0]) {
    this.delayedTransferAssessmentRequests.push(request);
    return structuredClone(this.delayedTransferAssessment);
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
      this.specialistCompletions.set(request, resolve);
      this.specialistFailures.set(request, reject);
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
      content: this.artifactSynthesisContent ?? (request.personalNotes.length > 0
        ? `${request.artifactContent} The learner connects this to a finite-choice picture.`
        : `${request.artifactContent} No Personal Notes were supplied.`),
      noteInterpretations: request.personalNotes.map((note) => ({
        annotationId: note.annotationId,
        interpretation: "The learner connects compactness with reducing local choices to finitely many."
      }))
    };
  }

  async regenerateArtifact(request: ArtifactRegenerationRequest) {
    this.artifactRegenerationRequests.push(request);
    request.onRuntimeEvent?.({
      type: "threadStarted", threadId: "artifact-regeneration-thread", turnId: null, detail: "Thread started."
    });
    if (this.holdArtifactRegeneration) {
      if (request.signal.aborted) throw new Error("Learning Artifact regeneration aborted.");
      await new Promise<void>((resolve, reject) => {
        this.artifactRegenerationCompletion = resolve;
        request.signal.addEventListener("abort", () => reject(new Error("Learning Artifact regeneration aborted.")), { once: true });
      });
    }
    request.onRuntimeEvent?.({
      type: "turnCompleted", threadId: "artifact-regeneration-thread", turnId: "artifact-regeneration-turn",
      detail: "Regeneration proposal completed."
    });
    return structuredClone(this.artifactRegenerationResult);
  }

  completeArtifactRegeneration() {
    this.artifactRegenerationCompletion?.();
    this.artifactRegenerationCompletion = null;
  }

  async recheckArtifactClaim(request: Parameters<ModelRuntime["recheckArtifactClaim"]>[0]) {
    this.artifactClaimRecheckRequests.push(request);
    request.onRuntimeEvent?.({
      type: "threadStarted", threadId: "artifact-claim-recheck-thread", turnId: null, detail: "Thread started."
    });
    if (this.holdArtifactClaimRecheck) {
      await new Promise<void>((resolve, reject) => {
        this.artifactClaimRecheckCompletion = resolve;
        request.signal.addEventListener("abort", () => reject(new Error("Artifact claim recheck aborted.")), { once: true });
      });
    }
    request.onRuntimeEvent?.({
      type: "turnCompleted", threadId: "artifact-claim-recheck-thread", turnId: "artifact-claim-recheck-turn",
      detail: "Reasoning recheck completed."
    });
    return structuredClone(this.artifactClaimRecheckResult);
  }

  completeArtifactClaimRecheck() {
    this.artifactClaimRecheckCompletion?.();
    this.artifactClaimRecheckCompletion = null;
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
    const request = this.specialistRequests.at(-1);
    if (request) this.completeSpecialistRequest(request, result);
  }

  completeSpecialistRequest(request: SpecialistAgentRequest, result: SpecialistAgentResult) {
    request.onRuntimeEvent?.({
      type: "turnCompleted", workKind: "specialist", threadId: "specialist-thread", turnId: "specialist-turn", detail: "Specialist turn completed."
    });
    this.specialistCompletions.get(request)?.(result);
  }

  waitSpecialist(message: string) {
    this.specialistRequests.at(-1)?.onStatus("waiting", message);
  }

  emitSpecialistPartial(content: string) {
    const request = this.specialistRequests.at(-1);
    request?.onPartialResult(content);
    request?.onRuntimeEvent?.({ type: "toolCalled", workKind: "specialist", threadId: "specialist-thread", turnId: "specialist-turn", detail: content });
  }

  reportSpecialistTokenUsage(totalTokens: number) {
    this.specialistRequests.at(-1)?.onTokenUsage?.(totalTokens);
  }

  failSpecialist(error: Error) {
    this.specialistRequests.at(-1)?.onRuntimeEvent?.({
      type: "turnFailed", workKind: "specialist", threadId: "specialist-thread", turnId: "specialist-turn", detail: error.message
    });
    const request = this.specialistRequests.at(-1);
    if (request) this.specialistFailures.get(request)?.(error);
  }

  async cancelTeaching(sessionId: string) {
    this.canceledSessionIds.push(sessionId);
    if (this.cancelError) throw this.cancelError;
    if (this.completeTeachingOnCancel) this.completeTeaching(sessionId);
    for (const [request, complete] of this.specialistCompletions) {
      if (request.sessionId === sessionId) complete({ title: "Stopped", content: "Stopped" });
    }
  }

  async shutdown() {}
}
