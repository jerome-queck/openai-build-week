import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executablePath = join(
  process.cwd(),
  "out",
  `Quick Study-darwin-${process.arch === "arm64" ? "arm64" : "x64"}`,
  "Quick Study.app",
  "Contents",
  "MacOS",
  "Quick Study"
);

test("packaged Quick Study organizes durable work and resumes the latest session", async () => {
  test.setTimeout(300_000);
  const packagedEnvironment = join(executablePath, "..", "..", "Resources", "verifiers",
    "lean-4.29.1-mathlib-4.29.1-quick-study-v1");
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
  let launched: { browser: Browser; page: Page; process: ChildProcess; output(): string } | undefined;

  const launch = async () => {
    const port = await availablePort();
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
    await waitForDebugger(port, child, () => output);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
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
      current.process.kill("SIGTERM");
      throw new Error(`Packaged Quick Study did not exit after its last window closed.\n${current.output()}`);
    }
  };

  try {
    let page = await launch();
    await expect(page.getByRole("heading", { name: "Continue your mathematics" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Application settings" }))
      .toContainText("Installed and ready", { timeout: 60_000 });
    const noteSynthesisPreference = page.getByRole("checkbox", { name: "Allow Personal Notes during artifact synthesis" });
    await expect(noteSynthesisPreference).toBeChecked();
    await noteSynthesisPreference.click();
    await expect(noteSynthesisPreference).not.toBeChecked();
    await noteSynthesisPreference.click();
    await expect(noteSynthesisPreference).toBeChecked();

    await page.getByLabel("New Study Workspace name").fill("Abstract Algebra");
    await page.getByRole("button", { name: "Create Study Workspace" }).click();
    await page.getByLabel("New Study Mission name").fill("Finite group structure");
    await page.getByRole("button", { name: "Create Study Mission" }).click();
    await page.getByLabel("New Study Mission name").fill("Group actions");
    await page.getByRole("button", { name: "Create Study Mission" }).click();

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
    await page.getByRole("button", { name: "Propose Learning Session" }).click();
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
    await page.getByRole("button", { name: "Apply proposal changes" }).click();
    await expect(page.getByRole("region", { name: "Request Full Access" })).toBeVisible();
    await page.getByRole("button", { name: "Approve Access Request" }).press("Enter");
    await expect(page.getByRole("region", { name: "Full Access" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText("Start from the key definition");
    await page.getByRole("radio", { name: "Workspace Access" }).click();
    await expect(page.getByRole("region", { name: "Workspace Access" })).toBeVisible();
    await page.getByRole("radio", { name: "Full Access" }).click();
    const fullConfirmation = page.getByRole("region", { name: "Full Access confirmation" });
    await expect(fullConfirmation).toContainText("broader read-only local-file and agent-tool access");
    await fullConfirmation.getByRole("button", { name: "Cancel Full Access" }).click();
    await expect(page.getByRole("region", { name: "Workspace Access" })).toBeVisible();
    await page.getByRole("radio", { name: "Full Access" }).click();
    await page.getByRole("button", { name: "Confirm Full Access" }).click();
    await expect(page.getByRole("region", { name: "Full Access" })).toBeVisible();
    await page.getByRole("button", { name: "Leave session" }).click();
    await page.getByRole("button", { name: "Open Study Workspace Quick Study" }).click();
    await expect(page.getByText("Focused Access · no workspace setup required", { exact: true })).toBeVisible();

    await page.getByLabel("Typed mathematics").fill("TRIGGER_NARROW_ACCESS_REQUEST: Explain why a finite group action has finite orbits.");
    await page.getByRole("button", { name: "Propose Learning Session" }).click();
    await expect(page.getByRole("region", { name: "Request Full Access" })).toBeVisible();
    await page.getByRole("button", { name: "Narrow to Workspace Access" }).press("Enter");
    await expect(page.getByRole("region", { name: "Workspace Access" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText(
      "Start from the key definition"
    );
    await page.getByRole("button", { name: "Leave session" }).click();
    await page.getByLabel("Destination Study Mission").selectOption({ label: "Abstract Algebra — Group actions" });
    await page.getByRole("button", { name: "File Quick Study session" }).click();
    await page.getByRole("button", { name: "Open Study Workspace Quick Study" }).click();

    await page.getByLabel("Typed mathematics").fill("Show that every convergent sequence is bounded.");
    await page.getByRole("button", { name: "Propose Learning Session" }).click();
    await expect(page.getByText("Teaching Card", { exact: true })).toBeVisible();
    await page.getByLabel("Learning Goal").fill("Understand where convergence controls the tail");
    await page.getByLabel("Session Target").fill("Bound the sequence using its finite prefix and tail");
    await page.getByRole("button", { name: "Leave session" }).click();

    await expect(page.getByRole("heading", { name: "Continue your mathematics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Understand where convergence controls the tail" })).toBeVisible();
    await page.getByLabel("Destination Study Mission").selectOption({ label: "Abstract Algebra — Finite group structure" });
    await page.getByRole("button", { name: "File Quick Study session" }).click();
    await page.getByRole("button", { name: "Open Study Workspace Quick Study" }).click();

    await page.getByLabel("Typed mathematics").fill("Determine the subgroups of a cyclic group of order 12.");
    await page.getByRole("button", { name: "Propose Learning Session" }).click();
    await page.getByLabel("Learning Goal").fill("Relate subgroups to divisors");
    await page.getByRole("button", { name: "Leave session" }).click();
    await page.getByLabel("Destination Study Mission").selectOption({ label: "Abstract Algebra — Finite group structure" });
    await page.getByRole("button", { name: "File Quick Study session" }).click();
    await page.getByRole("button", { name: "Resume Learning Session", exact: true }).click();

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
    await page.getByRole("button", { name: "Leave session" }).click();
    await quit();

    page = await launch();
    await expect(page.getByRole("heading", { name: "Continue your mathematics" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Study Workspace Abstract Algebra" })).toBeVisible();
    await page.getByRole("button", { name: "Open Study Workspace Quick Study" }).click();
    await page.getByLabel("Typed mathematics").fill("Prove that a finite union of finite sets is finite.");
    await page.getByRole("button", { name: "Propose Learning Session" }).click();
    await expect(page.getByRole("region", { name: "Focused Access" })).toBeVisible();
    await page.getByRole("button", { name: "Leave session" }).click();
    await page.getByLabel("Destination Study Mission").selectOption({ label: "Abstract Algebra — Finite group structure" });
    await page.getByRole("button", { name: "File Quick Study session" }).click();
    await page.getByRole("button", { name: "Open Study Workspace Abstract Algebra" }).click();
    const reopenedPrimaryFolder = page.getByRole("button", { name: "Open Linked Source algebra-course" });
    await reopenedPrimaryFolder.press("Enter");
    await expect(page.getByRole("region", { name: "Linked Source view" })).toContainText("problem-set.txt");
    const reopenedAttachment = page.getByRole("button", { name: "Open Linked Source lecture-3.pdf" });
    await reopenedAttachment.press("Enter");
    await expect(page.locator('object[aria-label="Linked PDF Source Layer"]')).toHaveAttribute("data", /^data:application\/pdf;base64,/);
    expect(await readFile(relocatedAttachmentPath)).toEqual(attachmentContent);
    expect(await readFile(join(primaryFolderPath, "problem-set.txt"), "utf8")).toBe(changedProblemSet);
    await expect(page.getByText("lecture-3.pdf — Source Snapshot", { exact: true })).toBeVisible();
    await expect(page.getByText("Bound the sequence using its finite prefix and tail")).toBeVisible();
    await page.getByRole("button", { name: "Open Study Mission Finite group structure" }).click();
    await page.getByRole("button", {
      name: "Resume grouped Learning Session Understand where convergence controls the tail"
    }).press("Enter");

    await expect(page.getByRole("heading", { name: "Mathematical Workbench" })).toBeVisible();
    await expect(page.getByLabel("Learning Goal")).toHaveValue("Understand where convergence controls the tail");

    await page.getByRole("button", { name: "Leave session" }).click();
    await quit();
    await writeFile(accessStatePath, JSON.stringify({
      status: "runtime"
    }), "utf8");

    page = await launch();
    await expect(page.getByRole("heading", { name: "Local Working Mode" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Codex runtime became unavailable.");
    await page.getByLabel("Search Learning Sessions").fill("finite prefix");
    const searchResult = page.getByRole("button", {
      name: "Open search result Understand where convergence controls the tail"
    });
    await searchResult.press("Enter");

    await page.getByLabel("Learning Goal").fill("Keep studying convergence locally");
    await page.getByLabel("Session Target").fill("Review the finite prefix and tail bounds");
    await page.getByRole("button", { name: "Save local session changes" }).click();
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

    await page.getByRole("button", { name: "Leave session" }).click();
    await page.getByRole("button", { name: "Open Study Workspace Quick Study" }).click();
    await page.getByLabel("Typed mathematics").fill("Adapt the source proof around $a=b$ without changing the supplied source.");
    await page.getByRole("button", { name: "Propose Learning Session" }).click();
    const equation = page.getByRole("button", { name: "Select equation 1: $a=b$" });
    await equation.press("Enter");
    await page.getByRole("button", { name: "Add note to selected equation" }).press("Enter");
    const annotationInspector = page.getByRole("complementary", { name: /Annotations for Equation Source Anchor/ });
    await annotationInspector.getByRole("textbox", { name: "Personal Note" }).fill("  My exact finite-choice insight.\n");
    await annotationInspector.getByRole("button", { name: "Save Personal Note" }).click();
    await expect(annotationInspector.getByRole("article", { name: "Personal Note" }))
      .toContainText("My exact finite-choice insight.");
    await annotationInspector.getByRole("button", { name: "Close Annotation Inspector" }).click();
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
    await claimTrust.getByRole("button", { name: "Check exact claim 1 with bundled Lean" }).press("Enter");
    await expect(claimTrust).toContainText("Formally verified", { timeout: 60_000 });
    await expect(claimTrust).toContainText("Not independently checked");
    const manifest = claimTrust.getByRole("article", { name: "Verifier Manifest" });
    await expect(manifest).toContainText("accepted");
    await expect(manifest).toContainText("lean-4.29.1-mathlib-4.29.1-quick-study-v1 · Lean 4.29.1 · mathlib 4.29.1");
    await expect(manifest).toContainText("theorem quickStudyNatAddZero (n : Nat) : n + 0 = n");
    await expect(manifest).toContainText("Exact statement statusFormally verified");
    await page.getByRole("button", { name: "Leave session" }).click();
    const settings = page.getByRole("region", { name: "Application settings" });
    await settings.getByRole("button", { name: "Remove Lean environment" }).click();
    const removalConfirmation = page.getByRole("alertdialog", { name: "Remove the Bundled Lean Runtime?" });
    await expect(removalConfirmation).toContainText("new formal verification capability");
    await expect(removalConfirmation).toContainText("Historical verification evidence and labels will be preserved");
    await removalConfirmation.getByRole("button", { name: "Remove installed Lean copy" }).click();
    await expect(settings).toContainText("Removal failed", { timeout: 30_000 });
    await expect(settings.getByRole("alert")).toContainText("Synthetic removal interruption before deactivation.");
    await settings.getByRole("button", { name: "Retry Lean removal" }).click();
    await expect(settings).toContainText("Not installed", { timeout: 30_000 });
    await expect(settings).toContainText("reasoning review, source-grounded checking, and independent corroboration");

    await page.getByRole("button", { name: "Resume Learning Session", exact: true }).click();
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

    await page.getByRole("button", { name: "Leave session" }).click();
    await settings.getByRole("button", { name: "Reinstall supported Lean environment" }).click();
    await expect(settings).toContainText("Installed and ready", { timeout: 120_000 });
    await page.getByRole("button", { name: "Resume Learning Session", exact: true }).click();
    await claimTrust.getByRole("button", { name: "Check exact claim 1 with bundled Lean" }).press("Enter");
    await expect(claimTrust.getByRole("article", { name: "Verifier Manifest" })).toHaveCount(2, { timeout: 60_000 });
    await expect(claimTrust.getByRole("article", { name: "Verifier Manifest" }).nth(1)).toContainText("accepted");
    await reformulatedProof.getByRole("button", { name: /Synthesize Learning Artifact/ }).press("Enter");
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
    await consolidation.getByRole("radio", { name: "Addressed" }).click();
    await consolidation.getByRole("button", { name: "Create Consolidated Session Outcome" }).press("Enter");
    const delayedTransfer = page.getByRole("region", { name: "Delayed Transfer follow-up" });
    await expect(delayedTransfer.getByRole("radio", { name: "No follow-up" })).toBeChecked();
    await expect(page.getByRole("region", { name: "Follow-ups" })).toHaveCount(0);
    await delayedTransfer.getByRole("radio", { name: "Check me later" }).click();
    await delayedTransfer.getByLabel("Intended transfer goal").fill(
      "Apply the finite-choice proof structure to a fresh mathematical setting."
    );
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
    await page.getByRole("button", { name: "Return to dashboard" }).press("Enter");

    await quit();
    page = await launch();
    const restoredFollowUps = page.getByRole("region", { name: "Follow-ups" });
    await expect(restoredFollowUps).toContainText("1 scheduled");
    await restoredFollowUps.getByRole("button", { name: /Open Follow-up Queue/ }).press("Enter");
    const restoredQueue = page.getByRole("region", { name: "Follow-up Queue" });
    await restoredQueue.getByRole("button", { name: /Cancel follow-up for/ }).press("Enter");
    await expect(page.getByRole("region", { name: "Follow-ups" })).toHaveCount(0);

  } finally {
    await quit();
    await removeTestDirectory(dataDirectory);
    await removeTestDirectory(sourceDirectory);
  }
});

test("packaged Quick Study checkpoints Background Agent Tasks and resumes them explicitly", async () => {
  test.setTimeout(120_000);
  const dataDirectory = await mkdtemp(join(tmpdir(), "quick-study-agent-task-smoke-"));
  const accessStatePath = join(dataDirectory, "fake-codex-access.json");
  let launched: { browser: Browser; page: Page; process: ChildProcess; output(): string } | undefined;

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
    await waitForDebugger(port, child, () => output);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
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
      current.process.kill("SIGTERM");
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
    await page.getByRole("button", { name: "One bounded review" }).press("Enter");
    await expect(page.getByRole("region", { name: "Agent Task Status" })).toContainText(
      "The retained checkpoint identifies Hausdorff separation.",
      { timeout: 15_000 }
    );

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
    await resume.press("Enter");
    await expect(page.getByRole("region", { name: "Agent Task Status" })).toContainText(
      "Compactness supplies the finite reduction.",
      { timeout: 15_000 }
    );

    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await writeFile(accessStatePath, JSON.stringify({ status: "available", specialist: "hold" }), "utf8");
    await page.getByLabel("Typed mathematics").fill("Cancel a bounded review without losing its checkpoint.");
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText(
      "Start from the key definition",
      { timeout: 15_000 }
    );
    await page.getByRole("button", { name: "One bounded review" }).press("Enter");
    let agentTask = page.getByRole("region", { name: "Agent Task Status" });
    await expect(agentTask).toContainText("The retained checkpoint identifies Hausdorff separation.");
    await agentTask.getByRole("button", { name: "Stop Agent Task" }).press("Enter");
    await expect(agentTask.getByText("Stopped", { exact: true })).toBeVisible();
    await expect(agentTask).toContainText("The retained checkpoint identifies Hausdorff separation.");

    await page.getByRole("button", { name: "Leave session" }).press("Enter");
    await writeFile(accessStatePath, JSON.stringify({ status: "available", specialist: "fail" }), "utf8");
    await page.getByLabel("Typed mathematics").fill("Recover a bounded review after a runtime failure.");
    await page.getByRole("button", { name: "Propose Learning Session" }).press("Enter");
    await expect(page.getByRole("region", { name: "Current Teaching Card" })).toContainText(
      "Start from the key definition",
      { timeout: 15_000 }
    );
    await page.getByRole("button", { name: "One bounded review" }).press("Enter");
    agentTask = page.getByRole("region", { name: "Agent Task Status" });
    await expect(agentTask).toContainText(
      "Codex could not complete this request. Retry when the runtime is available.",
      { timeout: 15_000 }
    );
    const retry = agentTask.getByRole("button", { name: "Retry Agent Task" });
    await expect(retry).toBeVisible();
    await writeFile(accessStatePath, JSON.stringify({ status: "available", specialist: "complete" }), "utf8");
    await retry.press("Enter");
    await expect(agentTask).toContainText("Compactness supplies the finite reduction.", { timeout: 15_000 });
  } finally {
    await quit();
    await removeTestDirectory(dataDirectory);
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

async function waitForDebugger(port: number, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged Quick Study exited early with code ${child.exitCode}.\n${output()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // The packaged main process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for packaged Quick Study to expose its renderer.\n${output()}`);
}

async function waitForPage(browser: Browser, child: ChildProcess, output: () => string): Promise<Page> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) return page;
    if (child.exitCode !== null) {
      throw new Error(`Packaged Quick Study exited before opening a renderer page.\n${output()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Packaged Quick Study did not open a renderer page.\n${output()}`);
}

async function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
  if (child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function removeTestDirectory(path: string): Promise<void> {
  try {
    await makeTestTreeWritable(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rm(path, { recursive: true, force: true });
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
