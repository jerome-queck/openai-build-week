import { chromium, expect, test, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bundledEnvironment from "../src/shared/bundled-verifier-environment.json";
import {
  attachPackagedDiagnostics,
  readBoundedPackagedBackendState,
  runPackagedAction,
  startPackagedTrace,
  type PackagedActionDiagnostics
} from "./packaged-action";

const executablePath = join(
  process.cwd(),
  "test-results",
  "installed-beta",
  "Quick Study.app",
  "Contents",
  "MacOS",
  "Quick Study"
);
const PACKAGED_VERIFIER_LIFECYCLE_BUDGET_MS = 660_000;

test("packaged critical source and access journey has an isolated release boundary", async ({}, testInfo) => {
  test.setTimeout(300_000);
  const scenario = await createPackagedScenario(testInfo, "critical-source-and-access");
  try {
    let page = await scenario.launch();
    await expect(page.getByRole("heading", { name: "Continue your mathematics" })).toBeVisible();
    const betaSupport = page.getByRole("region", { name: "Quick Study beta support" });
    await expect(betaSupport.getByRole("link", { name: "Report beta feedback" })).toBeVisible();
    await expectCriticalControlsNamed(page, "dashboard and settings");
    await expectKeyboardReachable(page, betaSupport.getByRole("link", { name: "Report beta feedback" }));
    await createWorkspace(scenario, page);
    await prepareIndexedSources(scenario, page);

    await scenario.action("Open Linked Source lecture-3.pdf", () =>
      page.getByRole("button", { name: "Open Linked Source lecture-3.pdf" }).press("Enter"));
    await expect(page.locator('object[aria-label="Linked PDF Source Layer"]')).toHaveAttribute("data", /^data:application\/pdf;base64,/);
    await scenario.action("Build Source Index for lecture-3.pdf", () =>
      page.getByRole("button", { name: "Build Source Index for lecture-3.pdf" }).press("Enter"));
    await expect(page.getByText("Ready · 1 page · 1 equation region", { exact: true })).toBeVisible({ timeout: 45_000 });
    await page.getByLabel("Search indexed source content").fill("Heine Borel");
    await scenario.action("Search indexed source content for Heine Borel", () =>
      page.getByRole("button", { name: "Search sources" }).press("Enter"));
    await scenario.action("Open source result lecture-3.pdf", () =>
      page.getByRole("button", { name: /Open source result lecture-3.pdf, Page 1: Heine Borel/ }).press("Enter"));
    await expect(page.getByLabel("Opened Source Index visual match")).toBeVisible();

    await rename(scenario.paths.attachmentPath, scenario.paths.relocatedAttachmentPath);
    await scenario.action("Open moved Linked Source lecture-3.pdf", () =>
      page.getByRole("button", { name: "Open Linked Source lecture-3.pdf" }).press("Enter"));
    await expect(page.getByRole("alert")).toContainText(/no such file|missing|not available/i);
    await scenario.action("Locate Linked Source lecture-3.pdf again", () =>
      page.getByRole("button", { name: "Locate Linked Source lecture-3.pdf again" }).press("Enter"));
    await expect(page.getByText(scenario.paths.relocatedAttachmentPath, { exact: true })).toBeVisible();
    await scenario.action("Preserve current Source Revision for lecture-3.pdf", () =>
      page.getByRole("button", { name: "Preserve current Source Revision for lecture-3.pdf" }).press("Enter"));
    await expect(page.getByText("lecture-3.pdf — Source Snapshot", { exact: true })).toBeVisible();

    const changedProblemSet = "Classify the orbits and stabilizers. Compare the revised orbit decomposition.";
    await writeFile(join(scenario.paths.primaryFolderPath, "problem-set.txt"), changedProblemSet, "utf8");
    await scenario.action("Open changed Linked Source algebra-course", () =>
      page.getByRole("button", { name: "Open Linked Source algebra-course" }).press("Enter"));
    await expect(page.getByText(/Historical content unavailable/)).toContainText("Source Index and Source Fingerprint are not backups");

    await writeFile(scenario.paths.accessStatePath, JSON.stringify({ status: "available", holdTeaching: true }), "utf8");
    await page.getByLabel("Typed mathematics").fill("Explain orbit-stabilizer without requesting new access.");
    await scenario.action("Start held teaching for operation-state coverage", () =>
      page.getByRole("button", { name: "Propose Learning Session" }).press("Enter"));
    const operationNotice = page.getByRole("region", { name: "Learner action status" });
    await expect(operationNotice).toContainText("Busy: Model teaching");
    await scenario.action("Request Full Access confirmation during held teaching", () =>
      page.getByRole("radio", { name: "Full Access" }).click());
    const fullAccessConfirmation = page.getByRole("region", { name: "Full Access confirmation" });
    await expect(fullAccessConfirmation).toBeVisible();
    await scenario.action("Cancel Full Access confirmation", () =>
      fullAccessConfirmation.getByRole("button", { name: "Cancel Full Access" }).press("Enter"));
    await expect(fullAccessConfirmation).not.toBeVisible();
    await scenario.action("Re-request Full Access confirmation", () =>
      page.getByRole("radio", { name: "Full Access" }).click());
    await expect(fullAccessConfirmation).toBeVisible();
    await scenario.action("Confirm fresh Full Access confirmation", () =>
      fullAccessConfirmation.getByRole("button", { name: "Confirm Full Access" }).press("Enter"));
    const workbenchSource = page.getByRole("region", { name: "Workbench Source Layer" });
    const sourceLayer = workbenchSource.getByRole("article", { name: "Read-only Source Layer" });
    await sourceLayer.evaluate((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      if (!text) throw new Error("The held teaching source had no selectable text.");
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, Math.min(text.textContent?.length ?? 0, 18));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await scenario.action("Queue anchored explanation during held teaching", () =>
      page.getByRole("button", { name: /Explain or unpack selected text/ }).press("Enter"));
    await expect(operationNotice).toContainText("Queued: anchored explanation");
    await writeFile(scenario.paths.accessStatePath, JSON.stringify({ status: "available", holdTeaching: false }), "utf8");
    await expect(page.getByRole("region", { name: /Current anchored Teaching Card/ })).toBeVisible({ timeout: 30_000 });
    await scenario.action("Leave held operation session", () => page.getByRole("button", { name: "Leave session" }).press("Enter"));
    await expect(page.getByRole("heading", { name: "Continue your mathematics" })).toBeVisible();

    await page.getByRole("textbox", { name: "Typed mathematics" }).fill("TRIGGER_ACCESS_REQUEST: Explain orbit-stabilizer using the workspace sources.");
    await scenario.action("Propose Learning Session with workspace sources", () =>
      page.getByRole("button", { name: "Propose Learning Session" }).press("Enter"));
    const accessRequest = page.getByRole("region", { name: "Request Full Access" });
    await expect(accessRequest).toContainText("The proof cites a local lemma that is not available under the current policy.");
    await scenario.action("Deny Access Request", () => accessRequest.getByRole("button", { name: "Deny Access Request" }).press("Enter"));
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText("Access denied");
    await page.getByLabel("Initial teaching direction").fill("Request the missing supporting lemma again");
    await scenario.action("Apply proposal changes for access request", () =>
      page.getByRole("button", { name: "Apply proposal changes" }).press("Enter"));
    await scenario.action("Approve Access Request", () =>
      page.getByRole("button", { name: "Approve Access Request" }).press("Enter"));

    await scenario.action("Leave source and access session", () => page.getByRole("button", { name: "Leave session" }).press("Enter"));
    await scenario.quit();
    page = await scenario.launch();
    await expect(page.getByRole("button", { name: "Open Study Workspace Abstract Algebra" })).toBeVisible();
    await scenario.action("Open persisted Abstract Algebra workspace", () =>
      page.getByRole("button", { name: "Open Study Workspace Abstract Algebra" }).press("Enter"));
    await scenario.action("Open persisted lecture-3.pdf", () =>
      page.getByRole("button", { name: "Open Linked Source lecture-3.pdf" }).press("Enter"));
    await expect(page.getByText("lecture-3.pdf — Source Snapshot", { exact: true })).toBeVisible();
    expect(await readFile(scenario.paths.relocatedAttachmentPath)).toEqual(scenario.attachmentContent);
  } finally {
    await scenario.dispose();
  }
});

test("packaged action diagnostics identify a deliberately stalled learner boundary", async ({}, testInfo) => {
  test.setTimeout(60_000);
  const scenario = await createPackagedScenario(testInfo, "deliberate-action-stall");
  try {
    const page = await scenario.launch();
    await expect(page.getByLabel("Typed mathematics")).toBeVisible();
    await expect(scenario.action(
      "Deliberately stalled learner action",
      () => new Promise<never>(() => undefined),
      50
    )).rejects.toThrow(/Deliberately stalled learner action.*50ms/);
    expect(scenario.diagnostics.receipts).toEqual([
      expect.objectContaining({ operation: "Deliberately stalled learner action", settlement: "failed" })
    ]);
  } finally {
    await scenario.dispose();
  }
});

test("packaged durable-session and Local Working Mode journey survives filing and reload", async ({}, testInfo) => {
  test.setTimeout(300_000);
  const scenario = await createPackagedScenario(testInfo, "durable-session-local-working");
  try {
    let page = await scenario.launch();
    await createWorkspace(scenario, page);
    await scenario.action("Open Quick Study workspace for durable session", () => page.getByRole("button", { name: "Open Study Workspace Quick Study" }).press("Enter"));
    await page.getByLabel("Typed mathematics").fill("Show that every convergent sequence is bounded.");
    await scenario.action("Propose convergence Learning Session", () => page.getByRole("button", { name: "Propose Learning Session" }).press("Enter"));
    await expect(page.getByText("Teaching Card", { exact: true })).toBeVisible();
    await page.getByLabel("Learning Goal").fill("Understand where convergence controls the tail");
    await page.getByLabel("Session Target").fill("Bound the sequence using its finite prefix and tail");
    await scenario.action("Leave convergence Learning Session", () => page.getByRole("button", { name: "Leave session" }).press("Enter"));
    await page.getByLabel("Destination Study Mission").selectOption({ label: "Abstract Algebra — Finite group structure" });
    await scenario.action("File convergence Learning Session", () => page.getByRole("button", { name: "File Quick Study session" }).press("Enter"));

    await scenario.action("Open Abstract Algebra workspace", () => page.getByRole("button", { name: "Open Study Workspace Abstract Algebra" }).press("Enter"));
    await expect(page.getByRole("heading", { name: "Abstract Algebra", exact: true })).toBeVisible();
    const missionControl = page.getByRole("button", { name: "Open Study Mission Finite group structure" });
    await scenario.action("Open Finite group structure mission", () => missionControl.press("Enter"));
    await expect(missionControl).toHaveAttribute("aria-current", "page");
    await scenario.action("Resume grouped convergence Learning Session", () => page.getByRole("button", {
      name: "Resume grouped Learning Session Understand where convergence controls the tail"
    }).press("Enter"));
    await expect(page.getByRole("heading", { name: "Mathematical Workbench" })).toBeVisible();
    await expect(page.getByLabel("Learning Goal")).toHaveValue("Understand where convergence controls the tail");
    await scenario.action("Leave grouped convergence session", () => page.getByRole("button", { name: "Leave session" }).press("Enter"));
    await scenario.quit();

    await writeFile(scenario.paths.accessStatePath, JSON.stringify({ status: "runtime" }), "utf8");
    page = await scenario.launch();
    await expect(page.getByRole("heading", { name: "Local Working Mode" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Local Working Mode" })).toContainText("Codex runtime became unavailable.");
    await page.getByLabel("Search Learning Sessions").fill("finite prefix");
    await scenario.action("Open local search result for convergence session", () => page.getByRole("button", {
      name: "Open search result Understand where convergence controls the tail"
    }).press("Enter"));
    await page.getByLabel("Learning Goal").fill("Keep studying convergence locally");
    await page.getByLabel("Session Target").fill("Review the finite prefix and tail bounds");
    await scenario.action("Save local session changes", () => page.getByRole("button", { name: "Save local session changes" }).press("Enter"));
    await page.getByLabel("Ask Bar question").fill("Why does the finite prefix have a maximum absolute value?");
    await scenario.action("Save Pending Question locally", () => page.getByRole("button", { name: "Save Pending Question" }).press("Enter"));
    await expect(page.getByRole("heading", { name: "Pending Question" })).toBeVisible();

    await writeFile(scenario.paths.accessStatePath, JSON.stringify({ status: "available" }), "utf8");
    await scenario.action("Check Codex access after local work", () => page.getByRole("button", { name: "Check Codex access" }).press("Enter"));
    await expect(page.getByRole("heading", { name: "Model teaching available" })).toBeVisible();
    await page.getByLabel("Pending Question text").fill("Why must a finite set of absolute values have a maximum?");
    await scenario.action("Submit Pending Question after recovery", () => page.getByRole("button", { name: "Submit Pending Question" }).press("Enter"));
    const questionCard = page.getByRole("article", { name: "Question Card: Why must a finite set of absolute values have a maximum?" });
    await expect(questionCard.getByText("Current revision", { exact: true })).toBeVisible({ timeout: 15_000 });
  } finally {
    await scenario.dispose();
  }
});

test("packaged verifier and artifact journey keeps lifecycle evidence across reinstall", async ({}, testInfo) => {
  test.setTimeout(900_000);
  const scenario = await createPackagedScenario(testInfo, "verifier-artifact-reinstall");
  try {
    let page = await scenario.launch();
    await createWorkspace(scenario, page);
    await prepareIndexedSources(scenario, page);
    await page.getByLabel("Typed mathematics").fill("Adapt the source proof around $a=b$ without changing the supplied source.");
    await scenario.action("Propose source-grounded Learning Session", () => page.getByRole("button", { name: "Propose Learning Session" }).press("Enter"));
    const externalResearch = page.getByRole("region", { name: "Privacy-minimized web research" });
    await expect(externalResearch.getByText("Source Excerpt Egress: Not granted")).toBeVisible();
    await scenario.action("Enable app-wide Source Excerpt Egress", () => externalResearch.getByLabel("Enable Source Excerpt Egress Preference app-wide").press("Space"));
    const sessionResearchEgress = externalResearch.getByLabel("Allow Source Excerpt Egress for this Learning Session");
    await scenario.action("Enable session Source Excerpt Egress", () => sessionResearchEgress.press("Space"));
    await externalResearch.getByLabel("Theorem names").fill("Natural-number addition identity");
    await scenario.action("Research the web for Natural-number addition identity", () => externalResearch.getByRole("button", { name: "Research the web" }).press("Enter"));
    await expect(externalResearch.getByRole("article", { name: "External research receipt for Natural-number addition identity" })).toContainText("completed");
    await scenario.action("Revoke session Source Excerpt Egress", () => sessionResearchEgress.press("Space"));
    const equation = page.getByRole("button", { name: "Select equation 1: $a=b$" });
    await scenario.action("Select equation 1 for annotation", () => equation.press("Enter"));
    await scenario.action("Add note to selected equation", () => page.getByRole("button", { name: "Add note to selected equation" }).press("Enter"));
    const annotationInspector = page.getByRole("complementary", { name: /Annotations for Equation Source Anchor/ });
    await annotationInspector.getByRole("textbox", { name: "Personal Note" }).fill("  My exact finite-choice insight.\n");
    await scenario.action("Save Personal Note", () => annotationInspector.getByRole("button", { name: "Save Personal Note" }).press("Enter"));
    await scenario.action("Close Annotation Inspector", () => annotationInspector.getByRole("button", { name: "Close Annotation Inspector" }).press("Enter"));
    await scenario.action("Reselect equation 1 for explanation", () => equation.press("Enter"));
    await scenario.action("Explain or unpack selected equation", () => page.getByRole("button", { name: "Explain or unpack selected equation" }).press("Enter"));
    const inspector = page.getByRole("complementary", { name: /Contextual Inspector/ });
    await expect(inspector.getByRole("region", { name: "Current anchored Teaching Card" })).toContainText("Start from the key definition", { timeout: 15_000 });
    await scenario.action("Save as Reformulated Proof", () => inspector.getByRole("button", { name: "Save as Reformulated Proof" }).press("Enter"));
    const reformulatedProof = page.getByRole("article", { name: /Reformulated Proof/ });
    const claimTrust = reformulatedProof.getByRole("region", { name: "Claim provenance and verification" });
    await reformulatedProof.getByRole("textbox", { name: "Exact claim 1", exact: true }).fill("For every natural number n, n + 0 = n.");
    await scenario.action("Save exact natural-number claim", () => reformulatedProof.getByRole("button", { name: /Save Learning Artifact revision/ }).press("Enter"));
    await expect(claimTrust.getByRole("region", { name: "Formalization for mathematical claim 1" })).toContainText("theorem quickStudyNatAddZero (n : Nat) : n + 0 = n");
    const checkExactClaim = claimTrust.getByRole("button", { name: "Check exact claim 1 with bundled Lean" });
    await expect(checkExactClaim).toBeEnabled({ timeout: PACKAGED_VERIFIER_LIFECYCLE_BUDGET_MS });
    await scenario.action("Check exact natural-number claim with bundled Lean", () => checkExactClaim.press("Enter"));
    await expect(claimTrust).toContainText("Formally verified", { timeout: 60_000 });
    await expect.poll(() => scenario.output(), { timeout: 60_000 }).toContain('"status":"completed","outcome":"accepted"');
    await scenario.action("Leave verified Learning Session", () => page.getByRole("button", { name: "Leave session" }).press("Enter"));
    const settings = page.getByRole("region", { name: "Application settings" });
    await scenario.action("Open Remove Lean confirmation", () => settings.getByRole("button", { name: "Remove Lean environment" }).press("Enter"));
    const removalConfirmation = page.getByRole("alertdialog", { name: "Remove the Bundled Lean Runtime?" });
    await scenario.action("Remove installed Lean copy", () => removalConfirmation.getByRole("button", { name: "Remove installed Lean copy" }).press("Enter"));
    await expect(settings).toContainText("Removal failed", { timeout: 30_000 });
    await scenario.action("Retry Lean removal", () => settings.getByRole("button", { name: "Retry Lean removal" }).press("Enter"));
    await expect(settings).toContainText("Not installed", { timeout: 120_000 });
    await scenario.action("Resume verified session without Lean", () => page.getByRole("button", { name: "Resume Learning Session", exact: true }).press("Enter"));
    await expect(claimTrust).toContainText("Bundled Lean is not installed");
    const retainedProofLogs = (await readdir(join(scenario.paths.dataDirectory, "verifier-evidence"))).filter((name) => name.endsWith(".lean"));
    expect(retainedProofLogs.length).toBeGreaterThan(0);
    await scenario.action("Leave session before Lean reinstall", () => page.getByRole("button", { name: "Leave session" }).press("Enter"));
    await scenario.action("Reinstall supported Lean environment", () => settings.getByRole("button", { name: "Reinstall supported Lean environment" }).press("Enter"));
    await expect(settings).toContainText("Installed and ready", { timeout: PACKAGED_VERIFIER_LIFECYCLE_BUDGET_MS });
    await scenario.action("Resume session after Lean reinstall", () => page.getByRole("button", { name: "Resume Learning Session", exact: true }).press("Enter"));
    await scenario.action("Check exact claim after Lean reinstall", () => claimTrust.getByRole("button", { name: "Check exact claim 1 with bundled Lean" }).press("Enter"));
    await expect(claimTrust.getByRole("article", { name: "Verifier Manifest" })).toHaveCount(2, { timeout: 60_000 });
    const synthesizeArtifact = reformulatedProof.getByRole("button", { name: /Synthesize Learning Artifact/ });
    await scenario.action("Confirm whole Learning Artifact synthesis scope", () =>
      reformulatedProof.getByRole("checkbox", { name: "Confirm this proposal may replace the whole Learning Artifact" }).check());
    await scenario.action("Wait for Learning Artifact synthesis readiness", () => expect(synthesizeArtifact).toBeEnabled());
    await scenario.action("Synthesize Learning Artifact", () => synthesizeArtifact.press("Enter"));
    await scenario.action("Wait for Learning Artifact synthesis settlement", () =>
      expect(reformulatedProof.getByRole("status")).toContainText(
        "Learning Artifact synthesized with the current Personal Note Synthesis Preference.",
        { timeout: 60_000 }
      ));
    await expect(reformulatedProof).toContainText("My exact finite-choice insight.");
    await scenario.action("Export Reformulated Proof", () => reformulatedProof.getByRole("button", { name: /Export Reformulated Proof/ }).press("Enter"));
    await expect(reformulatedProof.getByText(`Artifact Export saved to ${scenario.paths.artifactExportPath}`)).toBeVisible();
    const exportedArtifact = await readFile(scenario.paths.artifactExportPath, "utf8");
    expect(exportedArtifact).toContain("- Exact statement status: Formally verified");
    expect(exportedArtifact).toContain("### Note Interpretation");
    const verifierLifecycleSamplesMs = readCompletedVerifierLifecycleSamples(scenario.output());
    expect(verifierLifecycleSamplesMs.length).toBeGreaterThan(0);
    const verifierLifecycleP95Ms = nearestRankP95(verifierLifecycleSamplesMs);
    expect(verifierLifecycleP95Ms).toBeLessThanOrEqual(PACKAGED_VERIFIER_LIFECYCLE_BUDGET_MS);
    await updateBetaInstallReport((report) => {
      report.operationalMeasurements = {
        ...(report.operationalMeasurements as Record<string, unknown> | undefined),
        verifierLifecycleP95Ms,
        verifierLifecycleSamplesMs
      };
      (report.validations as string[]).push("verifier-lifecycle-budget");
    });
  } finally {
    await scenario.dispose();
  }
});

test("packaged delayed-transfer journey preserves its explicit due and reload contract", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const scenario = await createPackagedScenario(testInfo, "delayed-transfer-reload");
  try {
    let page = await scenario.launch();
    await page.getByLabel("Typed mathematics").fill("Show that every convergent sequence is bounded.");
    await scenario.action("Propose delayed-transfer source session", () => page.getByRole("button", { name: "Propose Learning Session" }).press("Enter"));
    await expect(page.getByText("Teaching Card", { exact: true })).toBeVisible();
    await page.getByLabel("Learning Goal").fill("Understand where convergence controls the tail");
    await page.getByLabel("Session Target").fill("Bound the sequence using its finite prefix and tail");
    await scenario.action("Finish Learning Session", () => page.getByRole("button", { name: "Finish & consolidate" }).press("Enter"));
    const consolidation = page.getByRole("region", { name: "Session Consolidation" });
    await expect(consolidation).toBeVisible();
    await scenario.action("Mark session Addressed", () => consolidation.getByRole("radio", { name: "Addressed" }).press("Space"));
    await scenario.action("Create Consolidated Session Outcome", () => consolidation.getByRole("button", { name: "Create Consolidated Session Outcome" }).press("Enter"));
    const delayedTransfer = page.getByRole("region", { name: "Delayed Transfer follow-up" });
    await scenario.action("Choose Check me later", () => delayedTransfer.getByRole("radio", { name: "Check me later" }).press("Space"));
    await delayedTransfer.getByLabel("Intended transfer goal").fill("Apply finite-reduction proof structure in a fresh setting.");
    const dueSoon = new Date(Math.ceil((Date.now() + 30_000) / 60_000) * 60_000);
    const dueSoonLocal = new Date(dueSoon.getTime() - dueSoon.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await delayedTransfer.getByLabel("When should Quick Study check in?").fill(dueSoonLocal);
    await scenario.action("Save delayed-transfer choice", () => delayedTransfer.getByRole("button", { name: "Save follow-up choice" }).press("Enter"));
    const followUps = page.getByRole("region", { name: "Follow-ups" });
    await expect(followUps).toContainText("1 scheduled");
    await scenario.action("Open Follow-up Queue", () => followUps.getByRole("button", { name: /Open Follow-up Queue/ }).press("Enter"));
    const queue = page.getByRole("region", { name: "Follow-up Queue" });
    await expect(queue).toContainText("Apply finite-reduction proof structure in a fresh setting.");
    const startDelayed = queue.getByRole("button", { name: /Start delayed check for/ });
    await expect(startDelayed).toBeVisible({ timeout: 100_000 });
    await scenario.action("Start delayed transfer check", () => startDelayed.press("Enter"));
    await expect.poll(async () => {
      const state = await page.evaluate(() => (window as unknown as Window & {
        quickStudy: { getState(): Promise<{ screen: string; delayedTransferChecks: Array<{ status: string; taskError: string | null }> }> }
      }).quickStudy.getState());
      return {
        screen: state.screen,
        checks: state.delayedTransferChecks.map((check) => ({ status: check.status, taskError: check.taskError }))
      };
    }, { timeout: 15_000 }).toEqual(expect.objectContaining({ screen: "delayedTransfer" }));
    const delayedCheck = page.getByRole("region", { name: "Delayed Transfer Check" });
    await expect(delayedCheck).toContainText("compact parameter space", { timeout: 15_000 });
    await delayedCheck.getByLabel("Your work").fill("Choose a finite subcover and take the largest local bound.");
    await delayedCheck.getByLabel("Explain your reasoning").fill("Compactness makes the local family finite.");
    await scenario.action("Save delayed-check work", () => delayedCheck.getByRole("button", { name: "Save check work" }).press("Enter"));
    await delayedCheck.getByLabel("Ask for clarification").fill("Which sets form the cover?");
    await scenario.action("Request delayed-check clarification", () => delayedCheck.getByRole("button", { name: "Request clarification" }).press("Enter"));
    await expect(delayedCheck.getByRole("list", { name: "Clarification assistance" })).toContainText("parameter neighbourhoods");
    await scenario.action("Complete delayed transfer check", () => delayedCheck.getByRole("button", { name: "Complete delayed check" }).press("Enter"));
    const delayedResult = page.getByRole("region", { name: "Delayed Check Result" });
    await expect(delayedResult).toContainText("Partial evidence");
    await scenario.action("Decline delayed-transfer refresher", () => delayedResult.getByRole("button", { name: "Decline refresher" }).press("Enter"));
    await expect(page.getByRole("region", { name: "Follow-ups" })).toContainText("1 completed");
    await scenario.quit();
    page = await scenario.launch();
    const restoredFollowUps = page.getByRole("region", { name: "Follow-ups" });
    await expect(restoredFollowUps).toContainText("1 completed");
    await scenario.action("Reopen completed delayed-transfer result", () => restoredFollowUps.getByRole("button", { name: /Open Follow-up Queue/ }).press("Enter"));
    await scenario.action("Review completed delayed-transfer result", () => page.getByRole("region", { name: "Follow-up Queue" }).getByRole("button", { name: /Review result for/ }).press("Enter"));
    await expect(page.getByRole("region", { name: "Delayed Check Result" })).toContainText("Partial evidence");
    await expect(page.getByRole("button", { name: "Start refresher session" })).toHaveCount(0);
  } finally {
    await scenario.dispose();
  }
});

test("packaged release-critical cold-start and verifier resource budgets are measured separately", async ({}, testInfo) => {
  test.setTimeout(1_200_000);
  const scenario = await createPackagedScenario(testInfo, "cold-start-and-resource-budgets");
  try {
    const firstPage = await scenario.launch();
    await expect(firstPage.getByRole("region", { name: "Application settings" }))
      .toContainText("Installed and ready", { timeout: 660_000 });
    await scenario.quit();
    while (scenario.coldStartDurationsMs.length < 20) {
      await scenario.launch();
      await scenario.quit();
    }
    await recordInstalledMeasurements(
      scenario.paths.dataDirectory,
      scenario.packagedEnvironment,
      scenario.coldStartDurationsMs,
      scenario.memorySamples,
      scenario.peakMemoryMiB,
      scenario.peakMemoryProcesses
    );
  } finally {
    await scenario.dispose();
  }
});

test("packaged Quick Study indexes the pinned large-source corpus within budget", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-large-index-"));
  const sourceDirectory = await mkdtemp(join(tmpdir(), "quick-study-large-source-"));
  const corpusPath = join(sourceDirectory, "large-analysis-corpus-v2");
  await mkdir(corpusPath);
  const fixtures = await Promise.all(Array.from({ length: 100 }, async (_, fileIndex) => {
    const path = join(corpusPath, `reference-${String(fileIndex + 1).padStart(3, "0")}.txt`);
    const content = Array.from({ length: 500 }, (_, lineIndex) =>
      `Reference ${fileIndex + 1}.${lineIndex + 1}: Let f_${fileIndex + 1}_${lineIndex + 1} be continuous on a compact metric space; retain its assumptions.`
    ).join("\n");
    await writeFile(path, content, "utf8");
    return { path, content };
  }));
  const port = await availablePort();
  const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      QUICK_STUDY_DATA_DIR: dataDirectory,
      QUICK_STUDY_CODEX_PATH: join(process.cwd(), "tests/fixtures/fake-codex-app-server.mjs"),
      QUICK_STUDY_TEST_PRIMARY_FOLDER: corpusPath
    },
    stdio: "pipe"
  });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  let browser: Browser | undefined;
  let page: Page | undefined;
  let stopTrace: (() => Promise<void>) | undefined;
  const diagnostics: PackagedActionDiagnostics = { scenario: "large-source-index-budget", receipts: [], failures: [] };
  const action = <T>(operation: string, work: () => Promise<T>, timeoutMs?: number) => {
    if (!page) throw new Error(`Cannot run packaged operation "${operation}" before the renderer is ready.`);
    return runPackagedAction(page, testInfo, diagnostics, operation, work, timeoutMs);
  };
  try {
    const debuggerEndpoint = await waitForDebugger(port, child, () => output);
    browser = await chromium.connectOverCDP(debuggerEndpoint);
    stopTrace = await startPackagedTrace(browser, testInfo, "large-source-index-budget");
    page = await waitForPage(browser, child, () => output);
    await action("Wait for bundled verifier installation settlement", () =>
      expect(page!.getByRole("region", { name: "Application settings" })).toContainText(
        "Installed and ready", { timeout: 660_000 }
      ), 660_000);
    await page.getByLabel("New Study Workspace name").fill("Large Source Benchmark");
    await action("Create Study Workspace Large Source Benchmark", () => page!.getByRole("button", { name: "Create Study Workspace" }).press("Enter"));
    await page.getByLabel("New Study Mission name").fill("Pinned corpus indexing");
    await action("Create Study Mission Pinned corpus indexing", () => page!.getByRole("button", { name: "Create Study Mission" }).press("Enter"));
    await action("Link large-analysis-corpus-v2", () => page!.getByRole("button", { name: "Link Primary Folder" }).press("Enter"));
    await expect(page.getByRole("button", { name: "Open Linked Source large-analysis-corpus-v2" })).toBeVisible();

    const benchmark = JSON.parse(await readFile(join(
      process.cwd(), "evaluation", "benchmarks", "v2", "benchmark.json"
    ), "utf8"));
    const maximum = benchmark.operationalBudgets.find(
      (budget: { id: string }) => budget.id === "source-index-p95"
    ).maximum;
    const sourceIndexDurationsMs: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      if (run > 0) {
        await action("Clear Source Index for large-analysis-corpus-v2", () => page!.getByRole("button", { name: "Clear Source Index for large-analysis-corpus-v2" }).press("Enter"));
        await expect(page.getByText("Search data unavailable · rebuild required", { exact: true })).toBeVisible();
      }
      const startedAt = Date.now();
      const buildIndex = page!.getByRole("button", {
        name: run === 0
          ? "Build Source Index for large-analysis-corpus-v2"
          : "Rebuild Source Index for large-analysis-corpus-v2"
      });
      await action(`Wait for Source Index run ${run + 1} readiness`, () => expect(buildIndex).toBeEnabled());
      await action(`Build Source Index run ${run + 1}`, () => buildIndex.press("Enter"));
      await expect(page.getByText("Ready · 1 page · 0 equation regions", { exact: true }))
        .toBeVisible({ timeout: maximum });
      sourceIndexDurationsMs.push(Date.now() - startedAt);
    }

    for (const fixture of fixtures) expect(await readFile(fixture.path, "utf8")).toBe(fixture.content);
    const sourceIndexP95Ms = nearestRankP95(sourceIndexDurationsMs);
    expect(sourceIndexP95Ms).toBeLessThanOrEqual(maximum);
    await updateBetaInstallReport((report) => {
      report.operationalMeasurements = {
        ...(report.operationalMeasurements as Record<string, unknown> | undefined),
        sourceIndexP95Ms,
        sourceIndexSamplesMs: sourceIndexDurationsMs
      };
      (report.validations as string[]).push("source-index-latency-budget");
    });
  } finally {
    const finalBackendState = page ? await readBoundedPackagedBackendState(page) : undefined;
    await stopTrace?.().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await terminateChild(child);
    await attachPackagedDiagnostics(undefined, testInfo, diagnostics, output, finalBackendState);
    await removeTestDirectory(dataDirectory);
    await removeTestDirectory(sourceDirectory);
  }
});

test("packaged Quick Study checkpoints Background Agent Tasks and resumes them explicitly", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-agent-task-smoke-"));
  const runtimeControlDirectory = await mkdtemp(join(tmpdir(), "quick-study-agent-runtime-control-"));
  const accessStatePath = join(runtimeControlDirectory, "fake-codex-access.json");
  let launched: { browser: Browser; page: Page; process: ChildProcess; output(): string; stopTrace: () => Promise<void> } | undefined;
  const diagnostics: PackagedActionDiagnostics = { scenario: "agent-task-recovery", receipts: [], failures: [] };
  const agentLatencySamples: Array<{
    outcome: "checkpointed" | "completed" | "cancelled" | "failed";
    durationMs: number;
  }> = [];

  const launch = async () => {
    const port = await availablePort();
    const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1",
        QUICK_STUDY_DATA_DIR: dataDirectory,
        CODEX_HOME: runtimeControlDirectory,
        QUICK_STUDY_CODEX_PATH: join(process.cwd(), "tests/fixtures/fake-codex-app-server.mjs"),
        QUICK_STUDY_TEST_EXTERNAL_RESEARCH: "stub"
      },
      stdio: "pipe"
    });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
    const debuggerEndpoint = await waitForDebugger(port, child, () => output);
    const browser = await chromium.connectOverCDP(debuggerEndpoint);
    const stopTrace = await startPackagedTrace(browser, testInfo, "agent-task-recovery");
    const page = await waitForPage(browser, child, () => output);
    launched = { browser, page, process: child, output: () => output, stopTrace };
    return page;
  };

  const quit = async () => {
    if (!launched) return;
    const current = launched;
    launched = undefined;
    await current.stopTrace();
    await current.page.close();
    const exitedNormally = await waitForExit(current.process, 5_000);
    await current.browser.close().catch(() => undefined);
    if (!exitedNormally) {
      await terminateChild(current.process);
      throw new Error(`Packaged Quick Study did not checkpoint Agent Tasks before exiting.\n${current.output()}`);
    }
  };
  const action = <T>(operation: string, work: () => Promise<T>, timeoutMs?: number) => {
    if (!launched) throw new Error(`Cannot run packaged operation "${operation}" without a launched renderer.`);
    return runPackagedAction(launched.page, testInfo, diagnostics, operation, work, timeoutMs);
  };

  try {
    await writeFile(accessStatePath, JSON.stringify({ status: "available", specialist: "hold" }), "utf8");
    let page = await launch();
    await page.getByLabel("Typed mathematics").fill("Check the hidden assumption in this compactness proof.");
    await action("Propose Learning Session for checkpoint", () => page.getByRole("button", { name: "Propose Learning Session" }).press("Enter"));
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText(
      "Start from the key definition",
      { timeout: 15_000 }
    );
    let agentStartedAt = Date.now();
    await action("Start bounded specialist review", () => page.getByRole("button", { name: "One bounded review" }).press("Enter"));
    await expect(page.getByRole("region", { name: "Agent Task Status" })).toContainText(
      "The retained checkpoint identifies Hausdorff separation.",
      { timeout: 15_000 }
    );
    agentLatencySamples.push({ outcome: "checkpointed", durationMs: Date.now() - agentStartedAt });

    await action("Leave checkpointed specialist session", () => page.getByRole("button", { name: "Leave session" }).press("Enter"));
    await expect(page.getByRole("status").filter({
      hasText: "Specialist Agent is working in the background"
    })).toBeVisible();
    await quit();

    await writeFile(accessStatePath, JSON.stringify({ status: "available", specialist: "complete" }), "utf8");
    page = await launch();
    const checkpoint = page.getByRole("status", { name: "Checkpointed Agent Task" });
    await expect(checkpoint).toContainText("Useful partial output is saved");
    const resume = checkpoint.getByRole("button", { name: "Resume Agent Task" });
    agentStartedAt = Date.now();
    await action("Resume checkpointed specialist review", () => resume.press("Enter"));
    await expect(page.getByRole("region", { name: "Agent Task Status" })).toContainText(
      "Compactness supplies the finite reduction.",
      { timeout: 15_000 }
    );
    agentLatencySamples.push({ outcome: "completed", durationMs: Date.now() - agentStartedAt });

    await action("Leave completed specialist session", () => page.getByRole("button", { name: "Leave session" }).press("Enter"));
    await writeFile(accessStatePath, JSON.stringify({ status: "available", specialist: "hold" }), "utf8");
    await page.getByLabel("Typed mathematics").fill("Cancel a bounded review without losing its checkpoint.");
    await action("Propose cancellable specialist session", () => page.getByRole("button", { name: "Propose Learning Session" }).press("Enter"));
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText(
      "Start from the key definition",
      { timeout: 15_000 }
    );
    agentStartedAt = Date.now();
    await action("Start cancellable specialist review", () => page.getByRole("button", { name: "One bounded review" }).press("Enter"));
    let agentTask = page.getByRole("region", { name: "Agent Task Status" });
    await expect(agentTask).toContainText("The retained checkpoint identifies Hausdorff separation.");
    await action("Stop Agent Task", () => agentTask.getByRole("button", { name: "Stop Agent Task" }).press("Enter"));
    await expect(agentTask.getByText("Stopped", { exact: true })).toBeVisible();
    agentLatencySamples.push({ outcome: "cancelled", durationMs: Date.now() - agentStartedAt });
    await expect(agentTask).toContainText("The retained checkpoint identifies Hausdorff separation.");

    await action("Leave cancelled specialist session", () => page.getByRole("button", { name: "Leave session" }).press("Enter"));
    await writeFile(accessStatePath, JSON.stringify({ status: "available", specialist: "fail" }), "utf8");
    await page.getByLabel("Typed mathematics").fill("Recover a bounded review after a runtime failure.");
    await action("Propose failing specialist session", () => page.getByRole("button", { name: "Propose Learning Session" }).press("Enter"));
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText(
      "Start from the key definition",
      { timeout: 15_000 }
    );
    agentStartedAt = Date.now();
    await action("Start failing specialist review", () => page.getByRole("button", { name: "One bounded review" }).press("Enter"));
    agentTask = page.getByRole("region", { name: "Agent Task Status" });
    await expect(agentTask).toContainText(
      "Codex could not complete this request. Retry when the runtime is available.",
      { timeout: 15_000 }
    );
    agentLatencySamples.push({ outcome: "failed", durationMs: Date.now() - agentStartedAt });
    const retry = agentTask.getByRole("button", { name: "Retry Agent Task" });
    await expect(retry).toBeVisible();
    await writeFile(accessStatePath, JSON.stringify({ status: "available", specialist: "complete" }), "utf8");
    agentStartedAt = Date.now();
    await action("Retry failed specialist review", () => retry.press("Enter"));
    await expect(agentTask).toContainText("Compactness supplies the finite reduction.", { timeout: 15_000 });
    agentLatencySamples.push({ outcome: "completed", durationMs: Date.now() - agentStartedAt });
    await updateBetaInstallReport((report) => {
      report.operationalMeasurements = {
        ...(report.operationalMeasurements as Record<string, unknown> | undefined),
        agentLatencyP95Ms: nearestRankP95(agentLatencySamples.map((sample) => sample.durationMs)),
        agentLatencySamples
      };
      (report.validations as string[]).push("agent-recovery-journeys");
    });
  } finally {
    const lifecycleLog = launched?.output() ?? "";
    await quit();
    await attachPackagedDiagnostics(undefined, testInfo, diagnostics, lifecycleLog);
    await removeTestDirectory(dataDirectory);
    await removeTestDirectory(runtimeControlDirectory);
  }
});

test("installed Quick Study authenticates with the live Codex runtime and completes teaching", async ({}, testInfo) => {
  test.skip(process.env.QUICK_STUDY_LIVE_CODEX !== "1", "Live Codex release evidence is opt-in.");
  test.setTimeout(180_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-live-codex-"));
  const port = await availablePort();
  const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    env: { ...process.env, QUICK_STUDY_DATA_DIR: dataDirectory },
    stdio: "pipe"
  });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  let browser: Browser | undefined;
  let page: Page | undefined;
  let stopTrace: (() => Promise<void>) | undefined;
  const diagnostics: PackagedActionDiagnostics = { scenario: "live-codex-teaching", receipts: [], failures: [] };
  try {
    const debuggerEndpoint = await waitForDebugger(port, child, () => output);
    browser = await chromium.connectOverCDP(debuggerEndpoint);
    stopTrace = await startPackagedTrace(browser, testInfo, "live-codex-teaching");
    page = await waitForPage(browser, child, () => output);
    await expect(page.getByRole("heading", { name: /Connected with (ChatGPT subscription|API key)/ }))
      .toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Typed mathematics").fill(
      "Explain why the continuous image of a compact topological space is compact."
    );
    await runPackagedAction(page, testInfo, diagnostics, "Propose live Codex Learning Session", () => page!.getByRole("button", { name: "Propose Learning Session" }).press("Enter"));
    const teachingCard = page.getByRole("region", { name: "Current Teaching Card" });
    await expect(teachingCard).toBeVisible({ timeout: 120_000 });
    await expect(teachingCard).not.toContainText("Codex is preparing the first teaching move…", { timeout: 120_000 });
    await expect(teachingCard).not.toContainText(/timed out|became unavailable|could not complete/i);
    const teachingContent = teachingCard.locator(".teaching-content");
    await expect(teachingContent).toContainText(/compact/i, { timeout: 120_000 });
    await expect(teachingContent).toContainText(/finite subcover|preimage|inverse image/i);
    await expect(page.getByRole("button", { name: "One bounded review" })).toBeVisible({ timeout: 120_000 });
    await updateBetaInstallReport((report) => {
      (report.validations as string[]).push("live-codex-authentication-and-teaching");
    });
  } finally {
    const finalBackendState = page ? await readBoundedPackagedBackendState(page) : undefined;
    await stopTrace?.().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await terminateChild(child);
    await attachPackagedDiagnostics(undefined, testInfo, diagnostics, output, finalBackendState);
    await removeTestDirectory(dataDirectory);
  }
});

test("packaged Quick Study rejects a child-controlled authentication destination", async ({}, testInfo) => {
  test.setTimeout(60_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-auth-policy-"));
  const runtimeControlDirectory = await mkdtemp(join(tmpdir(), "quick-study-auth-runtime-control-"));
  const accessStatePath = join(runtimeControlDirectory, "fake-codex-access.json");
  const openLogPath = join(dataDirectory, "authentication-open.log");
  await writeFile(accessStatePath, JSON.stringify({
    status: "signedOut",
    authenticationUrl: "https://auth.openai.com.evil.example/oauth/authorize?state=\u03c0;open=/Applications/Calculator.app"
  }), "utf8");
  const port = await availablePort();
  const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
    env: {
      ...process.env,
      QUICK_STUDY_DATA_DIR: dataDirectory,
      CODEX_HOME: runtimeControlDirectory,
      QUICK_STUDY_CODEX_PATH: join(process.cwd(), "tests/fixtures/fake-codex-app-server.mjs"),
      QUICK_STUDY_TEST_AUTHENTICATION_OPEN_LOG: openLogPath
    },
    stdio: "pipe"
  });
  let output = "";
  child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  let browser: Browser | undefined;
  let page: Page | undefined;
  let stopTrace: (() => Promise<void>) | undefined;
  const diagnostics: PackagedActionDiagnostics = { scenario: "authentication-navigation-policy", receipts: [], failures: [] };
  try {
    const debuggerEndpoint = await waitForDebugger(port, child, () => output);
    browser = await chromium.connectOverCDP(debuggerEndpoint);
    stopTrace = await startPackagedTrace(browser, testInfo, "authentication-navigation-policy");
    page = await waitForPage(browser, child, () => output);
    await expect(page.getByRole("heading", { name: "Connect Codex to begin teaching" })).toBeVisible();

    await runPackagedAction(page, testInfo, diagnostics, "Sign in with ChatGPT", () => page!.getByRole("button", { name: "Sign in with ChatGPT" }).press("Enter"));

    await expect(page.getByRole("alert")).toContainText(
      "Codex returned an unsupported ChatGPT authentication URL."
    );
    await expect(lstat(openLogPath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    const finalBackendState = page ? await readBoundedPackagedBackendState(page) : undefined;
    await stopTrace?.().catch(() => undefined);
    await page?.close().catch(() => undefined);
    const exitedNormally = await waitForExit(child, 5_000);
    await browser?.close().catch(() => undefined);
    try {
      if (!exitedNormally) {
        await terminateChild(child);
        throw new Error(`Packaged Quick Study did not cancel verifier setup before exiting.\n${output}`);
      }
    } finally {
      await attachPackagedDiagnostics(undefined, testInfo, diagnostics, output, finalBackendState);
      await removeTestDirectory(dataDirectory);
      await removeTestDirectory(runtimeControlDirectory);
    }
  }
});

type PackagedScenario = {
  paths: {
    dataDirectory: string;
    runtimeControlDirectory: string;
    sourceDirectory: string;
    primaryFolderPath: string;
    attachmentPath: string;
    relocatedAttachmentPath: string;
    unrelatedPath: string;
    artifactExportPath: string;
    accessStatePath: string;
  };
  packagedEnvironment: string;
  attachmentContent: Buffer;
  diagnostics: PackagedActionDiagnostics;
  coldStartDurationsMs: number[];
  memorySamples: Array<{ recordedAt: string; rssMiB: number }>;
  peakMemoryMiB: number;
  peakMemoryProcesses: Array<{ pid: number; parentPid: number; rssMiB: number; command: string }>;
  launch(): Promise<Page>;
  currentPage(): Page | undefined;
  output(): string;
  action<T>(operation: string, action: () => Promise<T>, timeoutMs?: number): Promise<T>;
  quit(): Promise<void>;
  dispose(): Promise<void>;
};

async function createPackagedScenario(testInfo: TestInfo, scenarioName: string): Promise<PackagedScenario> {
  const packagedEnvironment = join(executablePath, "..", "..", "Resources", "verifiers", bundledEnvironment.id);
  const packagedManifest = join(packagedEnvironment, "manifest.json");
  expect((await stat(packagedEnvironment)).mode & 0o222).toBe(0);
  expect((await stat(packagedManifest)).mode & 0o222).toBe(0);
  const dataDirectory = await mkdtemp(join(tmpdir(), `quick-study-${scenarioName}-`));
  const runtimeControlDirectory = await mkdtemp(join(tmpdir(), `quick-study-${scenarioName}-runtime-`));
  const sourceDirectory = await mkdtemp(join(tmpdir(), `quick-study-${scenarioName}-source-`));
  const primaryFolderPath = join(sourceDirectory, "algebra-course");
  const attachmentPath = join(sourceDirectory, "lecture-3.pdf");
  const relocatedDirectory = join(sourceDirectory, "relocated");
  const relocatedAttachmentPath = join(relocatedDirectory, "lecture-3.pdf");
  const unrelatedPath = join(sourceDirectory, "private-unrelated.txt");
  const artifactExportPath = join(sourceDirectory, "reformulated-proof.md");
  await mkdir(primaryFolderPath);
  await mkdir(relocatedDirectory);
  execFileSync("/usr/bin/xcrun", ["swift", join(process.cwd(), "tests/fixtures/create-scanned-pdf.swift"), attachmentPath], { timeout: 30_000 });
  const attachmentContent = await readFile(attachmentPath);
  await writeFile(join(primaryFolderPath, "problem-set.txt"), "Classify the orbits and stabilizers.", "utf8");
  await writeFile(unrelatedPath, "PRIVATE_UNRELATED_DEVICE_CONTENT", "utf8");
  const accessStatePath = join(runtimeControlDirectory, "fake-codex-access.json");
  const diagnostics: PackagedActionDiagnostics = {
    scenario: scenarioName,
    startedAt: new Date().toISOString(),
    receipts: [],
    failures: []
  };
  const coldStartDurationsMs: number[] = [];
  const memorySamples: Array<{ recordedAt: string; rssMiB: number }> = [];
  let peakMemoryMiB = 0;
  let peakMemoryProcesses: Array<{ pid: number; parentPid: number; rssMiB: number; command: string }> = [];
  const processLifecycleOutput: string[] = [];
  let launched: {
    browser: Browser; page: Page; process: ChildProcess; output(): string;
    memorySampler: ReturnType<typeof setInterval>;
    stopTrace: () => Promise<void>;
  } | undefined;

  const launch = async (): Promise<Page> => {
    const port = await availablePort();
    const startedAt = Date.now();
    const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1",
        QUICK_STUDY_DATA_DIR: dataDirectory,
        CODEX_HOME: runtimeControlDirectory,
        QUICK_STUDY_CODEX_PATH: join(process.cwd(), "tests/fixtures/fake-codex-app-server.mjs"),
        QUICK_STUDY_TEST_PRIMARY_FOLDER: primaryFolderPath,
        QUICK_STUDY_TEST_EXTERNAL_ATTACHMENT: attachmentPath,
        QUICK_STUDY_TEST_RELOCATED_SOURCE: relocatedAttachmentPath,
        QUICK_STUDY_TEST_ARTIFACT_EXPORT_PATH: artifactExportPath,
        QUICK_STUDY_TEST_EXTERNAL_RESEARCH: "stub",
        QUICK_STUDY_TEST_VERIFIER_REMOVAL_FAILURE: "once"
      },
      stdio: "pipe"
    });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
    const debuggerEndpoint = await waitForDebugger(port, child, () => output);
    const browser = await chromium.connectOverCDP(debuggerEndpoint);
    const stopTrace = await startPackagedTrace(browser, testInfo, scenarioName);
    const page = await waitForPage(browser, child, () => output);
    await page.getByLabel("Typed mathematics").waitFor({ state: "visible" });
    coldStartDurationsMs.push(Date.now() - startedAt);
    const sampleMemory = () => {
      const snapshot = processTreeRssSnapshot(child.pid);
      if (snapshot.rssMiB > peakMemoryMiB) {
        peakMemoryMiB = snapshot.rssMiB;
        peakMemoryProcesses = snapshot.processes;
      }
      memorySamples.push({ recordedAt: new Date().toISOString(), rssMiB: snapshot.rssMiB });
    };
    sampleMemory();
    const memorySampler = setInterval(sampleMemory, 1_000);
    memorySampler.unref();
    launched = { browser, page, process: child, output: () => output, memorySampler, stopTrace };
    return page;
  };

  const quit = async () => {
    if (!launched) return;
    const current = launched;
    launched = undefined;
    clearInterval(current.memorySampler);
    try {
      await current.stopTrace();
      await current.page.close();
      const exitedNormally = await waitForExit(current.process, 5_000);
      await current.browser.close().catch(() => undefined);
      if (!exitedNormally) {
        await terminateChild(current.process);
        throw new Error(`Packaged Quick Study did not exit after its last window closed.\n${current.output()}`);
      }
    } finally {
      processLifecycleOutput.push(current.output());
    }
  };

  return {
    paths: { dataDirectory, runtimeControlDirectory, sourceDirectory, primaryFolderPath, attachmentPath,
      relocatedAttachmentPath, unrelatedPath, artifactExportPath, accessStatePath },
    packagedEnvironment, attachmentContent, diagnostics, coldStartDurationsMs, memorySamples,
    get peakMemoryMiB() { return peakMemoryMiB; },
    get peakMemoryProcesses() { return peakMemoryProcesses; },
    launch,
    currentPage: () => launched?.page,
    output: () => launched?.output() ?? processLifecycleOutput.join("\n--- packaged relaunch ---\n"),
    action: async <T>(operation: string, action: () => Promise<T>, timeoutMs?: number) => {
      if (!launched) throw new Error(`Cannot run packaged operation "${operation}" without a launched scenario.`);
      return runPackagedAction(launched.page, testInfo, diagnostics, operation, action, timeoutMs);
    },
    quit,
    dispose: async () => {
      const activePage = launched?.page;
      const finalBackendState = activePage ? await readBoundedPackagedBackendState(activePage) : undefined;
      try {
        await quit();
      } finally {
        try {
          await attachPackagedDiagnostics(undefined, testInfo, diagnostics,
            processLifecycleOutput.join("\n--- packaged relaunch ---\n"), finalBackendState);
        } finally {
          await removeTestDirectory(dataDirectory);
          await removeTestDirectory(sourceDirectory);
          await removeTestDirectory(runtimeControlDirectory);
        }
      }
    }
  };
}

async function createWorkspace(scenario: PackagedScenario, page: Page): Promise<void> {
  await page.getByLabel("New Study Workspace name").fill("Abstract Algebra");
  await scenario.action("Create Study Workspace Abstract Algebra", () => page.getByRole("button", { name: "Create Study Workspace" }).press("Enter"));
  await page.getByLabel("New Study Mission name").fill("Finite group structure");
  await scenario.action("Create Study Mission Finite group structure", () => page.getByRole("button", { name: "Create Study Mission" }).press("Enter"));
  await page.getByLabel("New Study Mission name").fill("Group actions");
  await scenario.action("Create Study Mission Group actions", () => page.getByRole("button", { name: "Create Study Mission" }).press("Enter"));
}

async function prepareIndexedSources(scenario: PackagedScenario, page: Page): Promise<void> {
  await scenario.action("Link Primary Folder algebra-course", () => page.getByRole("button", { name: "Link Primary Folder" }).press("Enter"));
  await expect(page.getByRole("button", { name: "Open Linked Source algebra-course" })).toBeVisible();
  await scenario.action("Build Source Index for algebra-course", () => page.getByRole("button", { name: "Build Source Index for algebra-course" }).press("Enter"));
  await expect(page.getByText("Ready · 1 page · 0 equation regions", { exact: true })).toBeVisible({ timeout: 45_000 });
  await page.getByLabel("Search indexed source content").fill("orbits stabilizers");
  await scenario.action("Search algebra-course Source Index", () => page.getByRole("button", { name: "Search sources" }).press("Enter"));
  await scenario.action("Open algebra-course Source Index result", () => page.getByRole("button", { name: /Open source result algebra-course, Page 1: Classify the orbits/ }).press("Enter"));
  await expect(page.getByLabel("Opened Source Index match")).toHaveText("Classify the orbits and stabilizers.");
  await scenario.action("Clear Source Index for algebra-course", () => page.getByRole("button", { name: "Clear Source Index for algebra-course" }).press("Enter"));
  await expect(page.getByText("Search data unavailable · rebuild required", { exact: true })).toBeVisible();
  const rebuildIndex = page.getByRole("button", { name: "Rebuild Source Index for algebra-course" });
  await scenario.action("Wait for algebra-course Source Index rebuild readiness", () => expect(rebuildIndex).toBeEnabled());
  await scenario.action("Rebuild Source Index for algebra-course", () => rebuildIndex.press("Enter"));
  await expect(page.getByText("Ready · 1 page · 0 equation regions", { exact: true })).toBeVisible({ timeout: 45_000 });
  await scenario.action("Add External Attachment lecture-3.pdf", () => page.getByRole("button", { name: "Add External Attachment" }).press("Enter"));
  await expect(page.getByRole("button", { name: "Open Linked Source lecture-3.pdf" })).toBeVisible();
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a debugging port."));
      server.close(() => resolve(address.port));
    });
  });
}

async function findExactManagedCopies(directory: string, expected: Buffer): Promise<string[]> {
  const copies: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === "verifiers") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      copies.push(...await findExactManagedCopies(path, expected));
    } else if (entry.isFile() && (await stat(path)).size === expected.length
      && (await readFile(path)).equals(expected)) {
      copies.push(path);
    }
  }
  return copies;
}

async function waitForDebugger(port: number, child: ChildProcess, output: () => string): Promise<string> {
  const deadline = Date.now() + 60_000;
  const endpointPattern = new RegExp(
    `DevTools listening on (ws://127\\.0\\.0\\.1:${port}/devtools/browser/[a-zA-Z0-9-]+)`
  );
  while (Date.now() < deadline) {
    const termination = childTermination(child);
    if (termination) {
      throw new Error(`Packaged Quick Study exited early with ${termination}.\n${output()}`);
    }
    const endpoint = output().match(endpointPattern)?.[1];
    if (endpoint) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for packaged Quick Study to expose its renderer.\n${output()}`);
}

async function waitForPage(browser: Browser, child: ChildProcess, output: () => string): Promise<Page> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) return page;
    const termination = childTermination(child);
    if (termination) {
      throw new Error(`Packaged Quick Study exited with ${termination} before opening a renderer page.\n${output()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Packaged Quick Study did not open a renderer page.\n${output()}`);
}

async function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
  if (childTermination(child)) return true;
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeout);
    child.once("exit", onExit);
    if (childTermination(child)) onExit();
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (childTermination(child)) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 5_000)) return;
  child.kill("SIGKILL");
  if (!await waitForExit(child, 5_000)) {
    throw new Error("Packaged Quick Study did not terminate after SIGKILL.");
  }
}

function childTermination(child: ChildProcess): string | null {
  if (child.exitCode !== null) return `code ${child.exitCode}`;
  if (child.signalCode !== null) return `signal ${child.signalCode}`;
  return null;
}

async function removeTestDirectory(path: string): Promise<void> {
  try {
    await makeTestTreeWritable(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rm(path, { recursive: true, force: true });
}

async function recordInstalledMeasurements(
  dataDirectory: string,
  packagedEnvironment: string,
  coldStartDurationsMs: number[],
  memorySamples: Array<{ recordedAt: string; rssMiB: number }>,
  peakMemoryMiB: number,
  peakMemoryProcesses: Array<{ pid: number; parentPid: number; rssMiB: number; command: string }>
): Promise<void> {
  const benchmark = JSON.parse(await readFile(join(
    process.cwd(), "evaluation", "benchmarks", "v2", "benchmark.json"
  ), "utf8"));
  const thresholds = new Map<string, number>(benchmark.operationalBudgets.map(
    (budget: { id: string; maximum: number }) => [budget.id, budget.maximum]
  ));
  const applicationMiB = apparentMiB(join(executablePath, "..", "..", ".."));
  const packagedVerifierMiB = apparentMiB(packagedEnvironment);
  const activeVerifierMiB = apparentMiB(join(dataDirectory, "verifiers",
    bundledEnvironment.id));
  const applicationDataMiB = apparentMiB(dataDirectory);
  const verifierFootprintMiB = packagedVerifierMiB + activeVerifierMiB;
  const applicationDiskUseMiB = applicationMiB + applicationDataMiB;

  const coldStartP95Ms = nearestRankP95(coldStartDurationsMs);
  await updateBetaInstallReport((report) => {
    report.benchmarkVersion = benchmark.benchmarkVersion;
    report.testHardware = {
      model: execFileSync("/usr/sbin/sysctl", ["-n", "hw.model"], { encoding: "utf8" }).trim(),
      memoryBytes: Number(execFileSync("/usr/sbin/sysctl", ["-n", "hw.memsize"], { encoding: "utf8" }).trim()),
      operatingSystem: execFileSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()
    };
    report.installedDiskMeasurements = {
      applicationMiB, applicationDataMiB, packagedVerifierMiB, activeVerifierMiB,
      verifierFootprintMiB, applicationDiskUseMiB
    };
    report.operationalMeasurements = {
      ...(report.operationalMeasurements as Record<string, unknown> | undefined),
      coldStartP95Ms,
      coldStartSamplesMs: coldStartDurationsMs,
      peakMemoryMiB,
      peakMemoryProcesses,
      memorySamples
    };
    (report.validations as string[]).push(
      "cold-start-budget", "peak-memory-goal-measured",
      "verifier-footprint-budget", "application-disk-use-budget", "installed-critical-journeys"
    );
  });

  expect(verifierFootprintMiB).toBeLessThanOrEqual(thresholds.get("verifier-footprint")!);
  expect(applicationDiskUseMiB).toBeLessThanOrEqual(thresholds.get("application-disk-use")!);
  expect(coldStartDurationsMs).toHaveLength(20);
  expect(memorySamples.length).toBeGreaterThan(20);
  expect(coldStartP95Ms).toBeLessThanOrEqual(thresholds.get("cold-start-p95")!);
}

async function updateBetaInstallReport(update: (report: Record<string, unknown>) => void): Promise<void> {
  const reportPath = join(process.cwd(), "test-results", "beta-install.json");
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, unknown>;
  update(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function nearestRankP95(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

function readCompletedVerifierLifecycleSamples(output: string): number[] {
  return output.split("\n").flatMap((line) => {
    const match = line.match(/\[Lean integrity\] (\{.*\})$/);
    if (!match) return [];
    try {
      const event = JSON.parse(match[1]) as { status?: string; elapsedMs?: number };
      return event.status === "completed" && typeof event.elapsedMs === "number" ? [event.elapsedMs] : [];
    } catch {
      return [];
    }
  });
}

function processTreeRssSnapshot(rootPid: number | undefined): {
  rssMiB: number;
  processes: Array<{ pid: number; parentPid: number; rssMiB: number; command: string }>;
} {
  if (!rootPid) return { rssMiB: 0, processes: [] };
  const rows = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,rss=,comm="], { encoding: "utf8" })
    .trim().split("\n").map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) throw new Error(`Could not parse process memory row: ${line}`);
      return { pid: Number(match[1]), parentPid: Number(match[2]), rssKiB: Number(match[3]), command: match[4] };
    });
  const included = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (included.has(row.parentPid) && !included.has(row.pid)) {
        included.add(row.pid);
        changed = true;
      }
    }
  }
  const processes = rows.filter((row) => included.has(row.pid)).map((row) => ({
    pid: row.pid,
    parentPid: row.parentPid,
    rssMiB: Math.ceil(row.rssKiB / 1024),
    command: row.command
  }));
  return {
    rssMiB: Math.ceil(rows.filter((row) => included.has(row.pid)).reduce((sum, row) => sum + row.rssKiB, 0) / 1024),
    processes
  };
}

function apparentMiB(path: string): number {
  const output = execFileSync("/usr/bin/du", ["-A", "-m", "-s", path], { encoding: "utf8" });
  return Number(output.trim().split(/\s+/, 1)[0]);
}

async function expectCriticalControlsNamed(page: Page, surface: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const interactiveRoles = new Set([
      "button", "checkbox", "combobox", "link", "menuitem", "option", "radio", "slider", "spinbutton",
      "switch", "tab", "textbox", "treeitem"
    ]);
    const unnamed = nodes.filter((node) => {
      const role = String(node.role?.value ?? "");
      const name = String(node.name?.value ?? "").trim();
      return !node.ignored && interactiveRoles.has(role) && name.length === 0;
    }).map((node) => `${String(node.role?.value ?? "control")}#${node.nodeId}`);
    expect(unnamed, `${surface} must expose an accessible name in Chromium's accessibility tree`).toEqual([]);
  } finally {
    await cdp.detach();
  }
}

async function expectKeyboardReachable(page: Page, target: Locator): Promise<void> {
  for (let step = 0; step < 400; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      expect(await target.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      expect(await target.evaluate((element) => element === document.activeElement)).toBe(true);
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("Critical control was not reachable through sequential keyboard navigation.");
}

async function makeTestTreeWritable(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) return;
  if (!info.isDirectory()) {
    await chmod(path, 0o600);
    return;
  }
  await chmod(path, 0o700);
  for (const entry of await readdir(path)) await makeTestTreeWritable(join(path, entry));
}
