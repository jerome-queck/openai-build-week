import { chromium, expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bundledEnvironment from "../src/shared/bundled-verifier-environment.json";

const executablePath = join(
  process.cwd(),
  "test-results",
  "installed-beta",
  "Quick Study.app",
  "Contents",
  "MacOS",
  "Quick Study"
);

test("packaged Quick Study organizes durable work and resumes the latest session", async ({}, testInfo) => {
  test.setTimeout(1_200_000);
  const packagedEnvironment = join(executablePath, "..", "..", "Resources", "verifiers",
    bundledEnvironment.id);
  const packagedManifest = join(packagedEnvironment, "manifest.json");
  expect((await stat(packagedEnvironment)).mode & 0o222).toBe(0);
  expect((await stat(packagedManifest)).mode & 0o222).toBe(0);
  const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-smoke-"));
  const sourceDirectory = await mkdtemp(join(tmpdir(), "quick-study-source-"));
  const primaryFolderPath = join(sourceDirectory, "algebra-course");
  const attachmentPath = join(sourceDirectory, "lecture-3.pdf");
  const relocatedDirectory = join(sourceDirectory, "relocated");
  const relocatedAttachmentPath = join(relocatedDirectory, "lecture-3.pdf");
  const unrelatedPath = join(sourceDirectory, "private-unrelated.txt");
  const artifactExportPath = join(sourceDirectory, "reformulated-proof.md");
  await mkdir(primaryFolderPath);
  await mkdir(relocatedDirectory);
  execFileSync("/usr/bin/xcrun", ["swift", join(process.cwd(), "tests/fixtures/create-scanned-pdf.swift"), attachmentPath], {
    timeout: 30_000
  });
  const attachmentContent = await readFile(attachmentPath);
  await writeFile(join(primaryFolderPath, "problem-set.txt"), "Classify the orbits and stabilizers.", "utf8");
  await writeFile(unrelatedPath, "PRIVATE_UNRELATED_DEVICE_CONTENT", "utf8");
  const accessStatePath = join(dataDirectory, "fake-codex-access.json");
  let launched: {
    browser: Browser; page: Page; process: ChildProcess; output(): string;
    memorySampler: ReturnType<typeof setInterval>;
  } | undefined;
  const coldStartDurationsMs: number[] = [];
  let peakMemoryMiB = 0;
  let peakMemoryProcesses: Array<{ pid: number; parentPid: number; rssMiB: number; command: string }> = [];
  const memorySamples: Array<{ recordedAt: string; rssMiB: number }> = [];
  const processLifecycleOutput: string[] = [];

  const launch = async () => {
    const port = await availablePort();
    const startedAt = Date.now();
    const child = spawn(executablePath, [`--remote-debugging-port=${port}`], {
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1",
        QUICK_STUDY_DATA_DIR: dataDirectory,
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
    const page = await waitForPage(browser, child, () => output);
    await page.getByLabel("Typed mathematics").waitFor({ state: "visible" });
    coldStartDurationsMs.push(Date.now() - startedAt);
    const sampleMemory = () => {
      const snapshot = processTreeRssSnapshot(child.pid);
      const rssMiB = snapshot.rssMiB;
      if (rssMiB > peakMemoryMiB) {
        peakMemoryMiB = rssMiB;
        peakMemoryProcesses = snapshot.processes;
      }
      memorySamples.push({ recordedAt: new Date().toISOString(), rssMiB });
    };
    sampleMemory();
    const memorySampler = setInterval(sampleMemory, 1_000);
    memorySampler.unref();
    launched = { browser, page, process: child, output: () => output, memorySampler };
    return page;
  };

  const quit = async () => {
    if (!launched) return;
    const current = launched;
    launched = undefined;
    clearInterval(current.memorySampler);
    try {
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

  try {
    let page = await launch();
    await expect(page.getByRole("heading", { name: "Continue your mathematics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connected with ChatGPT subscription" })).toBeVisible();
    const betaSupport = page.getByRole("region", { name: "Quick Study beta support" });
    await expect(betaSupport).toContainText("install and hardware requirements are documented with the release artifact");
    await expect(betaSupport.getByRole("link", { name: "Report beta feedback" })).toBeVisible();
    await expectCriticalControlsNamed(page, "dashboard and settings");
    await expectKeyboardReachable(page, betaSupport.getByRole("link", { name: "Report beta feedback" }));
    await expect(page.getByRole("region", { name: "Application settings" }))
      .toContainText("Installed and ready", { timeout: 660_000 });
    await expect.poll(() => launched?.output() ?? "", { timeout: 660_000 })
      .toContain('"phase":"installed-content","status":"completed"');
    await expect.poll(() => launched?.output() ?? "", { timeout: 660_000 })
      .toContain('"phase":"trusted-seed","status":"completed"');
    const noteSynthesisPreference = page.getByRole("checkbox", { name: "Allow Personal Notes during artifact synthesis" });
    await expect(noteSynthesisPreference).toBeChecked();
    await noteSynthesisPreference.press("Space");
    await expect(noteSynthesisPreference).not.toBeChecked();
    await noteSynthesisPreference.press("Space");
    await expect(noteSynthesisPreference).toBeChecked();

    await page.getByLabel("New Study Workspace name").fill("Abstract Algebra");
    await page.getByRole("button", { name: "Create Study Workspace" }).press("Enter");
    await page.getByLabel("New Study Mission name").fill("Finite group structure");
    await page.getByRole("button", { name: "Create Study Mission" }).press("Enter");
    await page.getByLabel("New Study Mission name").fill("Group actions");
    await page.getByRole("button", { name: "Create Study Mission" }).press("Enter");

    const linkPrimaryFolder = page.getByRole("button", { name: "Link Primary Folder" });
    await linkPrimaryFolder.press("Enter");
    await expect(page.getByRole("button", { name: "Open Linked Source algebra-course" })).toBeVisible();
    await page.getByRole("button", { name: "Build Source Index for algebra-course" }).press("Enter");
    await expect(page.getByText("Ready · 1 page · 0 equation regions", { exact: true })).toBeVisible();
    await page.getByLabel("Search indexed source content").fill("orbits stabilizers");
    await page.getByRole("button", { name: "Search sources" }).press("Enter");
    await page.getByRole("button", { name: /Open source result algebra-course, Page 1: Classify the orbits/ }).press("Enter");
    await expect(page.getByLabel("Opened Source Index match")).toHaveText("Classify the orbits and stabilizers.");
    await page.getByRole("button", { name: "Clear Source Index for algebra-course" }).press("Enter");
    await expect(page.getByText("Search data unavailable · rebuild required", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Rebuild Source Index for algebra-course" }).press("Enter");
    await expect(page.getByText("Ready · 1 page · 0 equation regions", { exact: true })).toBeVisible();
    const addAttachment = page.getByRole("button", { name: "Add External Attachment" });
    await addAttachment.press("Enter");
    const openAttachment = page.getByRole("button", { name: "Open Linked Source lecture-3.pdf" });
    await openAttachment.press("Enter");
    await expect(page.locator('object[aria-label="Linked PDF Source Layer"]')).toHaveAttribute("data", /^data:application\/pdf;base64,/);
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", /object-src 'self' data:/);
    await page.getByRole("button", { name: "Build Source Index for lecture-3.pdf" }).press("Enter");
    await page.getByLabel("Search indexed source content").fill("Heine Borel");
    await page.getByRole("button", { name: "Search sources" }).press("Enter");
    await expect(page.getByText("Ready · 1 page · 1 equation region", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Open source result lecture-3.pdf, Page 1: Heine Borel/ }).press("Enter");
    await expect(page.getByLabel("Opened Source Index visual match")).toBeVisible();
    await expect(page.getByText(/Page 1: Heine Borel compactness theorem/)).toBeVisible();

    await rename(attachmentPath, relocatedAttachmentPath);
    await openAttachment.press("Enter");
    await expect(page.getByRole("alert")).toContainText(/no such file|missing|not available/i);
    await expect(page.getByRole("button", { name: "Retry Linked Source lecture-3.pdf" })).toBeVisible();
    await page.getByRole("button", { name: "Locate Linked Source lecture-3.pdf again" }).press("Enter");
    await expect(page.getByText(relocatedAttachmentPath, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Preserve current Source Revision for lecture-3.pdf" }).press("Enter");
    await expect(page.getByText("lecture-3.pdf — Source Snapshot", { exact: true })).toBeVisible();

    const changedProblemSet = "Classify the orbits and stabilizers. Compare the revised orbit decomposition.";
    await writeFile(join(primaryFolderPath, "problem-set.txt"), changedProblemSet, "utf8");
    await page.getByRole("button", { name: "Open Linked Source algebra-course" }).press("Enter");
    await expect(page.getByText(/Historical content unavailable/)).toContainText("Source Index and Source Fingerprint are not backups");
    await expect(page.getByText("Ready · 1 page · 0 equation regions", { exact: true }).first()).toBeVisible();

    await expect(page.getByText("Workspace Access · Abstract Algebra · Group actions", { exact: true })).toBeVisible();
    await page.getByLabel("Typed mathematics").fill("TRIGGER_ACCESS_REQUEST: Explain orbit-stabilizer using the workspace sources.");
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
    await expect(page.getByRole("region", { name: "Workspace Access" })).toBeVisible();
    const accessRequest = page.getByRole("region", { name: "Request Full Access" });
    await expect(accessRequest).toContainText("The proof cites a local lemma that is not available under the current policy.");
    await expect(accessRequest).toContainText("/Users/learner/reference/lemma.pdf");
    await expect(accessRequest).toContainText("Read the cited lemma statement without modifying the source.");
    const workspacePrompt = JSON.parse(await readFile(join(dataDirectory, "fake-codex-last-teaching-input.json"), "utf8")).prompt;
    expect(workspacePrompt).toContain("lecture-3.pdf");
    expect(workspacePrompt).toContain("problem-set.txt");
    expect(workspacePrompt).toContain("Classify the orbits and stabilizers.");
    expect(workspacePrompt).not.toContain("PRIVATE_UNRELATED_DEVICE_CONTENT");
    await accessRequest.getByRole("button", { name: "Deny Access Request" }).press("Enter");
    await expect(page.getByRole("region", { name: "Workspace Access" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText("Access denied");
    await page.getByLabel("Initial teaching direction").fill("Request the missing supporting lemma again");
    await page.getByRole("button", { name: "Apply proposal changes" }).press("Enter");
    await expect(page.getByRole("region", { name: "Request Full Access" })).toBeVisible();
    await page.getByRole("button", { name: "Approve Access Request" }).press("Enter");
    await expect(page.getByRole("region", { name: "Full Access", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText("Start from the key definition");
    await page.getByRole("radio", { name: "Workspace Access" }).press("Space");
    await expect(page.getByRole("region", { name: "Workspace Access" })).toBeVisible();
    await page.getByRole("radio", { name: "Full Access" }).press("Space");
    const fullConfirmation = page.getByRole("region", { name: "Full Access confirmation" });
    await expect(fullConfirmation).toContainText("broader read-only local-file and agent-tool access");
    await fullConfirmation.getByRole("button", { name: "Cancel Full Access" }).press("Enter");
    await expect(page.getByRole("region", { name: "Workspace Access" })).toBeVisible();
    await page.getByRole("radio", { name: "Full Access" }).press("Space");
    await page.getByRole("button", { name: "Confirm Full Access" }).press("Enter");
    await expect(page.getByRole("region", { name: "Full Access", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await page.getByRole("button", { name: "Open Study Workspace Quick Study" }).press("Enter");
    await expect(page.getByText("Focused Access · no workspace setup required", { exact: true })).toBeVisible();

    await page.getByLabel("Typed mathematics").fill("TRIGGER_NARROW_ACCESS_REQUEST: Explain why a finite group action has finite orbits.");
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
    await expect(page.getByRole("region", { name: "Request Full Access" })).toBeVisible();
    await page.getByRole("button", { name: "Narrow to Workspace Access" }).press("Enter");
    await expect(page.getByRole("region", { name: "Workspace Access" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText(
      "Start from the key definition"
    );
    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await page.getByLabel("Destination Study Mission").selectOption({ label: "Abstract Algebra — Group actions" });
    await page.getByRole("button", { name: "File Quick Study session" }).press("Enter");
    await page.getByRole("button", { name: "Open Study Workspace Quick Study" }).press("Enter");

    await page.getByLabel("Typed mathematics").fill("Show that every convergent sequence is bounded.");
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
    await expect(page.getByText("Teaching Card", { exact: true })).toBeVisible();
    await page.getByLabel("Learning Goal").fill("Understand where convergence controls the tail");
    await page.getByLabel("Session Target").fill("Bound the sequence using its finite prefix and tail");
    await page.getByRole("button", { name: "Leave session" }).press("Enter");

    await expect(page.getByRole("heading", { name: "Continue your mathematics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Understand where convergence controls the tail" })).toBeVisible();
    await page.getByLabel("Destination Study Mission").selectOption({ label: "Abstract Algebra — Finite group structure" });
    await page.getByRole("button", { name: "File Quick Study session" }).press("Enter");
    await page.getByRole("button", { name: "Open Study Workspace Quick Study" }).press("Enter");

    await page.getByLabel("Typed mathematics").fill("Determine the subgroups of a cyclic group of order 12.");
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
    await page.getByLabel("Learning Goal").fill("Relate subgroups to divisors");
    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await page.getByLabel("Destination Study Mission").selectOption({ label: "Abstract Algebra — Finite group structure" });
    await page.getByRole("button", { name: "File Quick Study session" }).press("Enter");
    await page.getByRole("button", { name: "Resume Learning Session", exact: true }).press("Enter");

    const workspaceControl = page.getByRole("button", { name: "Open Study Workspace Abstract Algebra" });
    await workspaceControl.press("Enter");
    await expect(page.getByRole("heading", { name: "Abstract Algebra", exact: true })).toBeVisible();
    const missionControl = page.getByRole("button", { name: "Open Study Mission Finite group structure" });
    await missionControl.press("Enter");
    await expect(missionControl).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Open Study Mission Group actions" })).toBeVisible();
    const groupedSessionControl = page.getByRole("button", {
      name: "Resume grouped Learning Session Understand where convergence controls the tail"
    });
    await groupedSessionControl.press("Enter");
    await expect(page.getByRole("heading", { name: "Mathematical Workbench" })).toBeVisible();
    await expect(page.getByLabel("Learning Goal")).toHaveValue("Understand where convergence controls the tail");
    await expect(page.getByRole("region", { name: "Focused Access" })).toBeVisible();
    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await quit();

    page = await launch();
    await expect(page.getByRole("heading", { name: "Continue your mathematics" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Study Workspace Abstract Algebra" })).toBeVisible();
    await page.getByRole("button", { name: "Open Study Workspace Quick Study" }).press("Enter");
    await page.getByLabel("Typed mathematics").fill("Prove that a finite union of finite sets is finite.");
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
    await expect(page.getByRole("region", { name: "Focused Access" })).toBeVisible();
    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await page.getByLabel("Destination Study Mission").selectOption({ label: "Abstract Algebra — Finite group structure" });
    await page.getByRole("button", { name: "File Quick Study session" }).press("Enter");
    await page.getByRole("button", { name: "Open Study Workspace Abstract Algebra" }).press("Enter");
    const reopenedPrimaryFolder = page.getByRole("button", { name: "Open Linked Source algebra-course" });
    await reopenedPrimaryFolder.press("Enter");
    await expect(page.getByRole("region", { name: "Linked Source view" })).toContainText("problem-set.txt");
    const reopenedAttachment = page.getByRole("button", { name: "Open Linked Source lecture-3.pdf" });
    await reopenedAttachment.press("Enter");
    await expect(page.locator('object[aria-label="Linked PDF Source Layer"]')).toHaveAttribute("data", /^data:application\/pdf;base64,/);
    expect(await readFile(relocatedAttachmentPath)).toEqual(attachmentContent);
    expect(await readFile(join(primaryFolderPath, "problem-set.txt"), "utf8")).toBe(changedProblemSet);
    expect(await readFile(unrelatedPath, "utf8")).toBe("PRIVATE_UNRELATED_DEVICE_CONTENT");
    await expect(page.getByText("lecture-3.pdf — Source Snapshot", { exact: true })).toBeVisible();
    await expect(page.getByText("Bound the sequence using its finite prefix and tail")).toBeVisible();
    await page.getByRole("button", { name: "Open Study Mission Finite group structure" }).press("Enter");
    await page.getByRole("button", {
      name: "Resume grouped Learning Session Understand where convergence controls the tail"
    }).press("Enter");

    await expect(page.getByRole("heading", { name: "Mathematical Workbench" })).toBeVisible();
    await expect(page.getByLabel("Learning Goal")).toHaveValue("Understand where convergence controls the tail");

    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await quit();
    await writeFile(accessStatePath, JSON.stringify({
      status: "runtime"
    }), "utf8");

    page = await launch();
    await expect(page.getByRole("heading", { name: "Local Working Mode" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Local Working Mode" }))
      .toContainText("Codex runtime became unavailable.");
    await page.getByLabel("Search Learning Sessions").fill("finite prefix");
    const searchResult = page.getByRole("button", {
      name: "Open search result Understand where convergence controls the tail"
    });
    await searchResult.press("Enter");

    await page.getByLabel("Learning Goal").fill("Keep studying convergence locally");
    await page.getByLabel("Session Target").fill("Review the finite prefix and tail bounds");
    await page.getByRole("button", { name: "Save local session changes" }).press("Enter");
    await page.getByLabel("Ask Bar question").fill("Why does the finite prefix have a maximum absolute value?");
    const savePending = page.getByRole("button", { name: "Save Pending Question" });
    await savePending.press("Enter");
    await expect(page.getByRole("heading", { name: "Pending Question" })).toBeVisible();

    await writeFile(accessStatePath, JSON.stringify({ status: "available" }), "utf8");
    const checkAccess = page.getByRole("button", { name: "Check Codex access" });
    await checkAccess.press("Enter");
    await expect(page.getByRole("heading", { name: "Model teaching available" })).toBeVisible();
    await expect(page.getByLabel("Pending Question text")).toHaveValue(
      "Why does the finite prefix have a maximum absolute value?"
    );
    await page.getByLabel("Pending Question text").fill("Why must a finite set of absolute values have a maximum?");
    const submitPending = page.getByRole("button", { name: "Submit Pending Question" });
    await submitPending.press("Enter");
    const questionCard = page.getByRole("article", {
      name: "Question Card: Why must a finite set of absolute values have a maximum?"
    });
    await expect(questionCard.getByText("Current revision", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(questionCard.getByText(
      "Start from the key definition, then connect each inference to the stated goal.",
      { exact: true }
    )).toBeVisible();

    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await page.getByRole("button", { name: "Open Study Workspace Quick Study" }).press("Enter");
    await page.getByLabel("Typed mathematics").fill("Adapt the source proof around $a=b$ without changing the supplied source.");
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
    const externalResearch = page.getByRole("region", { name: "Privacy-minimized web research" });
    await expect(externalResearch.getByText("Source Excerpt Egress: Not granted")).toBeVisible();
    const appWideResearchEgress = externalResearch.getByLabel("Enable Source Excerpt Egress Preference app-wide");
    await appWideResearchEgress.press("Space");
    await expect(appWideResearchEgress).toBeChecked();
    const sessionResearchEgress = externalResearch.getByLabel("Allow Source Excerpt Egress for this Learning Session");
    await sessionResearchEgress.press("Space");
    await expect(sessionResearchEgress).toBeChecked();
    await externalResearch.getByLabel("Theorem names").fill("Natural-number addition identity");
    await externalResearch.getByRole("button", { name: "Research the web" }).press("Enter");
    const researchReceipt = externalResearch.getByRole("article", {
      name: "External research receipt for Natural-number addition identity"
    });
    await expect(researchReceipt).toContainText("Source Excerpts sent0");
    await expect(researchReceipt).toContainText("completed");
    await sessionResearchEgress.press("Space");
    await expect(externalResearch.getByText("Source Excerpt Egress: Revoked")).toBeVisible();
    await expectCriticalControlsNamed(page, "workbench, research, and source controls");
    await expectKeyboardReachable(page, externalResearch.getByRole("button", { name: "Research the web" }));
    const equation = page.getByRole("button", { name: "Select equation 1: $a=b$" });
    await equation.press("Enter");
    await page.getByRole("button", { name: "Add note to selected equation" }).press("Enter");
    const annotationInspector = page.getByRole("complementary", { name: /Annotations for Equation Source Anchor/ });
    await annotationInspector.getByRole("textbox", { name: "Personal Note" }).fill("  My exact finite-choice insight.\n");
    await annotationInspector.getByRole("button", { name: "Save Personal Note" }).press("Enter");
    await expect(annotationInspector.getByRole("article", { name: "Personal Note" }))
      .toContainText("My exact finite-choice insight.");
    await annotationInspector.getByRole("button", { name: "Close Annotation Inspector" }).press("Enter");
    await equation.press("Enter");
    await page.getByRole("button", { name: "Explain or unpack selected equation" }).press("Enter");
    const inspector = page.getByRole("complementary", { name: /Contextual Inspector/ });
    await expect(inspector.getByRole("region", { name: "Current anchored Teaching Card" })).toContainText(
      "Start from the key definition, then connect each inference to the stated goal.",
      { timeout: 15_000 }
    );
    await inspector.getByRole("button", { name: "Save as Reformulated Proof" }).press("Enter");
    const reformulatedProof = page.getByRole("article", { name: /Reformulated Proof/ });
    await expect(reformulatedProof).toContainText("1 retained Source Anchor");
    const claimTrust = reformulatedProof.getByRole("region", { name: "Claim provenance and verification" });
    await expect(claimTrust).toContainText("Exact claim:");
    await expect(claimTrust).toContainText("Model-generated");
    await expect(claimTrust).toContainText("Not independently checked");
    await expect(claimTrust).toContainText("Current");
    await expect(claimTrust).toContainText("Agent Work");
    await reformulatedProof.getByRole("textbox", { name: "Exact claim 1", exact: true })
      .fill("For every natural number n, n + 0 = n.");
    await reformulatedProof.getByRole("button", { name: /Save Learning Artifact revision/ }).press("Enter");
    await expect(claimTrust.getByRole("region", { name: "Formalization for mathematical claim 1" }))
      .toContainText("theorem quickStudyNatAddZero (n : Nat) : n + 0 = n");
    const checkExactClaim = claimTrust.getByRole("button", { name: "Check exact claim 1 with bundled Lean" });
    await expect(checkExactClaim).toBeEnabled({ timeout: 660_000 });
    await expect.poll(() => launched?.output() ?? "", { timeout: 660_000 })
      .toContain('"phase":"installed-content","status":"completed"');
    await expect.poll(() => launched?.output() ?? "", { timeout: 660_000 })
      .toContain('"phase":"trusted-seed","status":"completed"');
    await checkExactClaim.press("Enter");
    await expect(claimTrust).toContainText("Formally verified", { timeout: 60_000 });
    await expect.poll(() => launched?.output() ?? "", { timeout: 60_000 })
      .toContain('"phase":"execution-metadata","status":"completed"');
    await expect.poll(() => launched?.output() ?? "", { timeout: 60_000 })
      .toContain('"status":"completed","outcome":"accepted"');
    await expect.poll(() => launched?.output() ?? "", { timeout: 60_000 })
      .toContain('"status":"model-runtime-paused"');
    await expect.poll(() => launched?.output() ?? "", { timeout: 60_000 })
      .toContain('"status":"model-runtime-restored"');
    await expect(claimTrust).toContainText("Not independently checked");
    const manifest = claimTrust.getByRole("article", { name: "Verifier Manifest" });
    await expect(manifest).toContainText("accepted");
    await expect(manifest).toContainText("lean-4.29.1-mathlib-4.29.1-quick-study-v1 · Lean 4.29.1 · mathlib 4.29.1");
    await expect(manifest).toContainText("theorem quickStudyNatAddZero (n : Nat) : n + 0 = n");
    await expect(manifest).toContainText("Exact statement statusFormally verified");
    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    const settings = page.getByRole("region", { name: "Application settings" });
    await settings.getByRole("button", { name: "Remove Lean environment" }).press("Enter");
    const removalConfirmation = page.getByRole("alertdialog", { name: "Remove the Bundled Lean Runtime?" });
    await expect(removalConfirmation).toContainText("new formal verification capability");
    await expect(removalConfirmation).toContainText("Historical verification evidence and labels will be preserved");
    await removalConfirmation.getByRole("button", { name: "Remove installed Lean copy" }).press("Enter");
    await expect(settings).toContainText("Removal failed", { timeout: 30_000 });
    await expect(settings.getByRole("alert")).toContainText("Synthetic removal interruption before deactivation.");
    await settings.getByRole("button", { name: "Retry Lean removal" }).press("Enter");
    // Removing the bundled 3.2 GB registry copy is intentionally synchronous so
    // the UI cannot report success while files remain. Hosted runners can take
    // longer than 30 seconds to unlink that tree under I/O contention.
    await expect(settings).toContainText("Not installed", { timeout: 120_000 });
    await expect(settings).toContainText("reasoning review, source-grounded checking, and independent corroboration");

    await page.getByRole("button", { name: "Resume Learning Session", exact: true }).press("Enter");
    await expect(claimTrust.getByRole("button", { name: "Check exact claim 1 with bundled Lean" })).toBeDisabled();
    await expect(claimTrust).toContainText("Bundled Lean is not installed");
    await expect(claimTrust.getByRole("article", { name: "Verifier Manifest" })).toContainText("accepted");
    await expect(claimTrust.getByRole("article", { name: "Verifier Manifest" }))
      .toContainText("lean-4.29.1-mathlib-4.29.1-quick-study-v1");
    await expect(claimTrust.getByRole("article", { name: "Verifier Manifest" }))
      .toContainText("theorem quickStudyNatAddZero (n : Nat) : n + 0 = n");
    const retainedProofLogs = (await readdir(join(dataDirectory, "verifier-evidence")))
      .filter((name) => name.endsWith(".lean"));
    expect(retainedProofLogs.length).toBeGreaterThan(0);
    expect(await readFile(join(dataDirectory, "verifier-evidence", retainedProofLogs[0]), "utf8"))
      .toContain("theorem quickStudyNatAddZero");

    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await settings.getByRole("button", { name: "Reinstall supported Lean environment" }).press("Enter");
    await expect(settings).toContainText("Installed and ready", { timeout: 660_000 });
    await page.getByRole("button", { name: "Resume Learning Session", exact: true }).press("Enter");
    await claimTrust.getByRole("button", { name: "Check exact claim 1 with bundled Lean" }).press("Enter");
    await expect(claimTrust.getByRole("article", { name: "Verifier Manifest" })).toHaveCount(2, { timeout: 60_000 });
    await expect(claimTrust.getByRole("article", { name: "Verifier Manifest" }).nth(1)).toContainText("accepted");
    const synthesizeArtifact = reformulatedProof.getByRole("button", { name: /Synthesize Learning Artifact/ });
    await expect(synthesizeArtifact).toBeDisabled();
    await reformulatedProof.getByRole("checkbox", {
      name: "Confirm this proposal may replace the whole Learning Artifact"
    }).check();
    await expect(synthesizeArtifact).toBeEnabled();
    await synthesizeArtifact.press("Enter");
    await expect(reformulatedProof).toContainText("My exact finite-choice insight.");
    await expect(reformulatedProof).toContainText("The learner connects the equation with a finite-choice insight.");
    await expect(reformulatedProof.getByText(/Learning Artifact synthesized/)).toBeVisible();
    await reformulatedProof.getByRole("button", { name: /Export Reformulated Proof/ }).press("Enter");
    await expect(reformulatedProof.getByText(`Artifact Export saved to ${artifactExportPath}`)).toBeVisible();
    const exportedArtifact = await readFile(artifactExportPath, "utf8");
    expect(exportedArtifact).toContain("# Reformulated Proof");
    expect(exportedArtifact).toContain("- Exact Claim:");
    expect(exportedArtifact).toContain("- Verification Level: Not independently checked");
    expect(exportedArtifact).toContain("- Verification Currency: Current");
    expect(exportedArtifact).toContain("## Verifier Manifests");
    expect(exportedArtifact).toContain("- Exact statement status: Formally verified");
    expect(exportedArtifact).toContain("- Verification Environment: lean-4.29.1-mathlib-4.29.1-quick-study-v1");
    expect(exportedArtifact).toContain("`$a=b$`");
    expect(exportedArtifact).toContain("Start from the key definition, then preserve the learner's finite-choice insight.");
    expect(exportedArtifact).toContain("  My exact finite-choice insight.\n");
    expect(exportedArtifact).toContain("### Note Interpretation");
    await expect(reformulatedProof.getByLabel("Learning Artifact content for Explain $a=b$")).toHaveValue(
      "Start from the key definition, then preserve the learner's finite-choice insight."
    );
    await expect(page.getByRole("article", { name: "Read-only Source Layer" })).toContainText(
      "Adapt the source proof around $a=b$ without changing the supplied source."
    );

    await page.getByRole("button", { name: "Finish & consolidate" }).press("Enter");
    const consolidation = page.getByRole("region", { name: "Session Consolidation" });
    await expect(consolidation).toBeVisible();
    await consolidation.getByRole("radio", { name: "Addressed" }).press("Space");
    await consolidation.getByRole("button", { name: "Create Consolidated Session Outcome" }).press("Enter");
    const delayedTransfer = page.getByRole("region", { name: "Delayed Transfer follow-up" });
    await expect(delayedTransfer.getByRole("radio", { name: "No follow-up" })).toBeChecked();
    await expect(page.getByRole("region", { name: "Follow-ups" })).toHaveCount(0);
    await delayedTransfer.getByRole("radio", { name: "Check me later" }).press("Space");
    await delayedTransfer.getByLabel("Intended transfer goal").fill(
      "Apply the finite-choice proof structure to a fresh mathematical setting."
    );
    const dueSoon = new Date(Math.ceil((Date.now() + 30_000) / 60_000) * 60_000);
    const dueSoonLocal = new Date(dueSoon.getTime() - dueSoon.getTimezoneOffset() * 60_000)
      .toISOString().slice(0, 16);
    await delayedTransfer.getByLabel("When should Quick Study check in?").fill(dueSoonLocal);
    await delayedTransfer.getByRole("button", { name: "Save follow-up choice" }).press("Enter");
    const followUps = page.getByRole("region", { name: "Follow-ups" });
    await expect(followUps).toContainText("1 scheduled");
    await followUps.getByRole("button", { name: /Open Follow-up Queue/ }).press("Enter");
    await expect(page.getByRole("region", { name: "Follow-up Queue" })).toContainText(
      "Apply the finite-choice proof structure to a fresh mathematical setting."
    );
    await expect(page.getByRole("region", { name: "Follow-up Queue" })).toContainText(
      "Related Learning Session:"
    );
    const queue = page.getByRole("region", { name: "Follow-up Queue" });
    const startDelayed = queue.getByRole("button", { name: /Start delayed check for/ });
    await expect(startDelayed).toBeVisible({ timeout: 100_000 });
    await startDelayed.press("Enter");
    const delayedCheck = page.getByRole("region", { name: "Delayed Transfer Check" });
    await expect(delayedCheck).toContainText("compact parameter space");
    await delayedCheck.getByLabel("Your work").fill("Choose a finite subcover and take the largest local bound.");
    await delayedCheck.getByLabel("Explain your reasoning").fill("Compactness makes the local family finite.");
    await delayedCheck.getByRole("radio", { name: "Medium confidence" }).press("Space");
    await delayedCheck.getByRole("button", { name: "Save check work" }).press("Enter");
    await delayedCheck.getByLabel("Ask for clarification").fill("Which sets form the cover?");
    await delayedCheck.getByRole("button", { name: "Request clarification" }).press("Enter");
    await expect(delayedCheck.getByRole("list", { name: "Clarification assistance" }))
      .toContainText("parameter neighbourhoods");
    await delayedCheck.getByRole("button", { name: "Complete delayed check" }).press("Enter");
    const delayedResult = page.getByRole("region", { name: "Delayed Check Result" });
    await expect(delayedResult).toContainText("Partial evidence");
    await expect(delayedResult).toContainText("Developing reasoning");
    await expect(delayedResult).toContainText("Confidence aligned");
    await expect(delayedResult).toContainText("Clarification assistance used");
    await delayedResult.getByRole("button", { name: "Decline refresher" }).press("Enter");
    await expect(page.getByRole("region", { name: "Follow-ups" })).toContainText("1 completed");
    await expectCriticalControlsNamed(page, "trail, artifacts, follow-ups, and delayed verification");
    await expectKeyboardReachable(page, page.getByRole("button", { name: /Open Follow-up Queue/ }));

    await quit();
    page = await launch();
    const restoredFollowUps = page.getByRole("region", { name: "Follow-ups" });
    await expect(restoredFollowUps).toContainText("1 completed");
    await restoredFollowUps.getByRole("button", { name: /Open Follow-up Queue/ }).press("Enter");
    const restoredQueue = page.getByRole("region", { name: "Follow-up Queue" });
    await restoredQueue.getByRole("button", { name: /Review result for/ }).press("Enter");
    await expect(page.getByRole("region", { name: "Delayed Check Result" })).toContainText("Partial evidence");
    await expect(page.getByRole("button", { name: "Start refresher session" })).toHaveCount(0);

    expect(await readFile(relocatedAttachmentPath)).toEqual(attachmentContent);
    expect(await readFile(join(primaryFolderPath, "problem-set.txt"), "utf8")).toBe(changedProblemSet);
    expect(await readFile(unrelatedPath, "utf8")).toBe("PRIVATE_UNRELATED_DEVICE_CONTENT");
    const publicState = await page.evaluate(() => window.quickStudy.getState());
    const sourceSnapshots = publicState.sources.filter((source) => source.kind === "managedAsset"
      && source.sourceSnapshot);
    expect(sourceSnapshots).toHaveLength(1);
    expect(sourceSnapshots[0]?.content).toBe(attachmentContent.toString("base64"));
    expect(publicState.sources.filter((source) => source.kind === "managedAsset"
      && source.content === attachmentContent.toString("base64")))
      .toHaveLength(1);
    expect(publicState.sourceRevisions.filter((revision) => revision.snapshotAssetId !== null))
      .toEqual([expect.objectContaining({ snapshotAssetId: sourceSnapshots[0]?.id })]);
    await quit();
    expect(await findExactManagedCopies(dataDirectory, attachmentContent)).toEqual([]);
    expect(await findExactManagedCopies(dataDirectory, Buffer.from(changedProblemSet))).toEqual([]);
    while (coldStartDurationsMs.length < 20) {
      await quit();
      page = await launch();
    }
    if (launched) {
      const snapshot = processTreeRssSnapshot(launched.process.pid);
      if (snapshot.rssMiB > peakMemoryMiB) {
        peakMemoryMiB = snapshot.rssMiB;
        peakMemoryProcesses = snapshot.processes;
      }
    }
    await recordInstalledMeasurements(
      dataDirectory, packagedEnvironment, coldStartDurationsMs, memorySamples, peakMemoryMiB, peakMemoryProcesses
    );

  } finally {
    try {
      await quit();
    } finally {
      await testInfo.attach("packaged-app-lifecycle.log", {
        body: Buffer.from(processLifecycleOutput.join("\n--- packaged relaunch ---\n"), "utf8"),
        contentType: "text/plain"
      });
      await removeTestDirectory(dataDirectory);
      await removeTestDirectory(sourceDirectory);
    }
  }
});

test("packaged Quick Study indexes the pinned large-source corpus within budget", async () => {
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
  try {
    const debuggerEndpoint = await waitForDebugger(port, child, () => output);
    browser = await chromium.connectOverCDP(debuggerEndpoint);
    const page = await waitForPage(browser, child, () => output);
    await page.getByLabel("New Study Workspace name").fill("Large Source Benchmark");
    await page.getByRole("button", { name: "Create Study Workspace" }).press("Enter");
    await page.getByLabel("New Study Mission name").fill("Pinned corpus indexing");
    await page.getByRole("button", { name: "Create Study Mission" }).press("Enter");
    await page.getByRole("button", { name: "Link Primary Folder" }).press("Enter");
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
        await page.getByRole("button", { name: "Clear Source Index for large-analysis-corpus-v2" }).press("Enter");
        await expect(page.getByText("Search data unavailable · rebuild required", { exact: true })).toBeVisible();
      }
      const startedAt = Date.now();
      await page.getByRole("button", {
        name: run === 0
          ? "Build Source Index for large-analysis-corpus-v2"
          : "Rebuild Source Index for large-analysis-corpus-v2"
      }).press("Enter");
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
    await browser?.close().catch(() => undefined);
    await terminateChild(child);
    await removeTestDirectory(dataDirectory);
    await removeTestDirectory(sourceDirectory);
  }
});

test("packaged Quick Study checkpoints Background Agent Tasks and resumes them explicitly", async () => {
  test.setTimeout(120_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-agent-task-smoke-"));
  const accessStatePath = join(dataDirectory, "fake-codex-access.json");
  let launched: { browser: Browser; page: Page; process: ChildProcess; output(): string } | undefined;
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
    const page = await waitForPage(browser, child, () => output);
    launched = { browser, page, process: child, output: () => output };
    return page;
  };

  const quit = async () => {
    if (!launched) return;
    const current = launched;
    launched = undefined;
    await current.page.close();
    const exitedNormally = await waitForExit(current.process, 5_000);
    await current.browser.close().catch(() => undefined);
    if (!exitedNormally) {
      await terminateChild(current.process);
      throw new Error(`Packaged Quick Study did not checkpoint Agent Tasks before exiting.\n${current.output()}`);
    }
  };

  try {
    await writeFile(accessStatePath, JSON.stringify({ status: "available", specialist: "hold" }), "utf8");
    let page = await launch();
    await page.getByLabel("Typed mathematics").fill("Check the hidden assumption in this compactness proof.");
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText(
      "Start from the key definition",
      { timeout: 15_000 }
    );
    let agentStartedAt = Date.now();
    await page.getByRole("button", { name: "One bounded review" }).press("Enter");
    await expect(page.getByRole("region", { name: "Agent Task Status" })).toContainText(
      "The retained checkpoint identifies Hausdorff separation.",
      { timeout: 15_000 }
    );
    agentLatencySamples.push({ outcome: "checkpointed", durationMs: Date.now() - agentStartedAt });

    await page.getByRole("button", { name: "Leave session" }).press("Enter");
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
    await resume.press("Enter");
    await expect(page.getByRole("region", { name: "Agent Task Status" })).toContainText(
      "Compactness supplies the finite reduction.",
      { timeout: 15_000 }
    );
    agentLatencySamples.push({ outcome: "completed", durationMs: Date.now() - agentStartedAt });

    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await writeFile(accessStatePath, JSON.stringify({ status: "available", specialist: "hold" }), "utf8");
    await page.getByLabel("Typed mathematics").fill("Cancel a bounded review without losing its checkpoint.");
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText(
      "Start from the key definition",
      { timeout: 15_000 }
    );
    agentStartedAt = Date.now();
    await page.getByRole("button", { name: "One bounded review" }).press("Enter");
    let agentTask = page.getByRole("region", { name: "Agent Task Status" });
    await expect(agentTask).toContainText("The retained checkpoint identifies Hausdorff separation.");
    await agentTask.getByRole("button", { name: "Stop Agent Task" }).press("Enter");
    await expect(agentTask.getByText("Stopped", { exact: true })).toBeVisible();
    agentLatencySamples.push({ outcome: "cancelled", durationMs: Date.now() - agentStartedAt });
    await expect(agentTask).toContainText("The retained checkpoint identifies Hausdorff separation.");

    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await writeFile(accessStatePath, JSON.stringify({ status: "available", specialist: "fail" }), "utf8");
    await page.getByLabel("Typed mathematics").fill("Recover a bounded review after a runtime failure.");
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText(
      "Start from the key definition",
      { timeout: 15_000 }
    );
    agentStartedAt = Date.now();
    await page.getByRole("button", { name: "One bounded review" }).press("Enter");
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
    await retry.press("Enter");
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
    await quit();
    await removeTestDirectory(dataDirectory);
  }
});

test("installed Quick Study authenticates with the live Codex runtime and completes teaching", async () => {
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
  try {
    const debuggerEndpoint = await waitForDebugger(port, child, () => output);
    browser = await chromium.connectOverCDP(debuggerEndpoint);
    const page = await waitForPage(browser, child, () => output);
    await expect(page.getByRole("heading", { name: /Connected with (ChatGPT subscription|API key)/ }))
      .toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Typed mathematics").fill(
      "Explain why the continuous image of a compact topological space is compact."
    );
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
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
    await browser?.close().catch(() => undefined);
    await terminateChild(child);
    await removeTestDirectory(dataDirectory);
  }
});

test("packaged Quick Study rejects a child-controlled authentication destination", async () => {
  test.setTimeout(60_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-auth-policy-"));
  const accessStatePath = join(dataDirectory, "fake-codex-access.json");
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
  try {
    const debuggerEndpoint = await waitForDebugger(port, child, () => output);
    browser = await chromium.connectOverCDP(debuggerEndpoint);
    page = await waitForPage(browser, child, () => output);
    await expect(page.getByRole("heading", { name: "Connect Codex to begin teaching" })).toBeVisible();

    await page.getByRole("button", { name: "Sign in with ChatGPT" }).press("Enter");

    await expect(page.getByRole("alert")).toContainText(
      "Codex returned an unsupported ChatGPT authentication URL."
    );
    await expect(lstat(openLogPath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await page?.close().catch(() => undefined);
    const exitedNormally = await waitForExit(child, 5_000);
    await browser?.close().catch(() => undefined);
    try {
      if (!exitedNormally) {
        await terminateChild(child);
        throw new Error(`Packaged Quick Study did not cancel verifier setup before exiting.\n${output}`);
      }
    } finally {
      await removeTestDirectory(dataDirectory);
    }
  }
});

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
