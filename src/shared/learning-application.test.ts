import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LearningApplication,
  type LinkedSource,
  type LocalSourceAccess,
  type SelectedLocalSource,
  type SourceFingerprint
} from "./learning-application";
import { ModelAccessError, type ModelAccessCause, type ModelRuntime, type RuntimeAccessRequest, type SessionProposal, type TeachingRequest } from "./model-runtime";

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
    expect(changed).toEqual({
      status: "unavailable",
      sourceId: source.id,
      error: "This source has changed since it was linked. Its original association is retained, but changed-source recovery is not available yet."
    });
    expect(application.getState().sources.find((candidate) => candidate.id === source.id)).toMatchObject({
      link: { fingerprint: { size: 64, modifiedAtMs: 1234 } }
    });

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

  });

  it("refuses a legacy Primary Folder until its descendant fingerprint can be re-established", async () => {
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

    await expect(application.openLinkedSource(source.id)).resolves.toEqual({
      status: "unavailable",
      sourceId: source.id,
      error: "This source has changed since it was linked. Its original association is retained, but changed-source recovery is not available yet."
    });
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

  it("bundles a submitted Pending Question with its Teaching Card and retries the same input", async () => {
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

    expect(state.sessions[0].submittedPendingQuestions).toEqual([
      expect.objectContaining({
        text: "Why finite?",
        teachingCard: expect.objectContaining({ status: "streaming" })
      })
    ]);
    expect(state.sessions[0].teachingCardHistory).toEqual([
      expect.objectContaining({ status: "completed", content: "First explanation" })
    ]);
    runtime.failTeaching(new ModelAccessError("network", "Network connection is unavailable."));
    await application.waitForModelWork();

    state = application.getState();
    expect(state.sessions[0].submittedPendingQuestions[0]).toMatchObject({
      text: "Why finite?",
      teachingCard: { status: "failed" }
    });

    await application.submit({ type: "refreshAuthentication" });
    await application.submit({ type: "retryModelWork" });
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

class DeterministicSourceAccess implements LocalSourceAccess {
  readonly openedSourceIds: string[] = [];
  readonly contentBySourceName = new Map<string, string>();
  error: Error | null = null;
  fingerprint: SourceFingerprint = { size: 64, modifiedAtMs: 1234 };

  async read(source: LinkedSource) {
    this.openedSourceIds.push(source.id);
    if (this.error) throw this.error;
    return {
      sourceId: source.id,
      resourceType: source.resourceType,
      content: this.contentBySourceName.get(source.name) ?? "Every open cover has a finite subcover.",
      fingerprint: this.fingerprint,
      mediaType: "text/plain" as const
    };
  }
}

class DeterministicModelRuntime implements ModelRuntime {
  readonly teachingRequests: TeachingRequest[] = [];
  readonly canceledSessionIds: string[] = [];
  private readonly teachingCompletions = new Map<TeachingRequest, () => void>();
  private readonly teachingFailures = new Map<TeachingRequest, (error: Error) => void>();
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
  completeTeachingOnCancel = true;
  teachingDeltaOnStart: string | null = null;

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

  async cancelTeaching(sessionId: string) {
    this.canceledSessionIds.push(sessionId);
    if (this.cancelError) throw this.cancelError;
    if (this.completeTeachingOnCancel) this.completeTeaching(sessionId);
  }

  async shutdown() {}
}
