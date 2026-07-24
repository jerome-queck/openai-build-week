// @vitest-environment node

import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LearningApplication } from "../shared/learning-application";
import {
  migrateQuickStudyData,
  type MigrationStage
} from "./clarifold-data-migration";

describe("Clarifold data migration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("reports that no migration is needed when the old default is absent", async () => {
    const root = await temporaryDirectory("clarifold-migration-absent-");
    const result = await migrateQuickStudyData({
      sourceDirectory: join(root, "Quick Study"),
      destinationDirectory: join(root, "Clarifold"),
      applicationVersion: "0.2.0"
    });

    expect(result.outcome).toBe("not-needed");
    expect(result.stages).toEqual(["discovery", "preflight", "complete"]);
  });

  it("copies valid learner state through staging, leaves the source intact, and records a safe receipt", async () => {
    const root = await temporaryDirectory("clarifold-migration-success-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    await createLearnerState(sourceDirectory);
    await writeFile(join(sourceDirectory, "rollback-marker.txt"), "retain me\n", "utf8");
    const sourceState = await readFile(join(sourceDirectory, "learning-application.json"), "utf8");

    const result = await migrateQuickStudyData({
      sourceDirectory,
      destinationDirectory,
      applicationVersion: "0.2.0",
      now: () => new Date("2026-07-24T01:02:03.000Z")
    });

    expect(result.outcome).toBe("migrated");
    expect(result.stages).toEqual<MigrationStage[]>([
      "discovery", "preflight", "staging-copy", "verification", "atomic-commit", "complete"
    ]);
    expect(await readFile(join(destinationDirectory, "learning-application.json"), "utf8")).toBe(sourceState);
    expect(await readFile(join(sourceDirectory, "learning-application.json"), "utf8")).toBe(sourceState);
    expect(await readFile(join(sourceDirectory, "rollback-marker.txt"), "utf8")).toBe("retain me\n");
    expect(JSON.parse(await readFile(join(destinationDirectory, "migration-receipt.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      source: sourceDirectory,
      destination: destinationDirectory,
      applicationVersion: "0.2.0",
      startedAt: "2026-07-24T01:02:03.000Z",
      completedAt: "2026-07-24T01:02:03.000Z",
      outcome: "migrated",
      retryState: "idempotent"
    });
    expect(await readdir(dirname(destinationDirectory))).not.toContain("Clarifold.migration-staging");
  });

  it("is idempotent after activation and does not copy the preserved source again", async () => {
    const root = await temporaryDirectory("clarifold-migration-retry-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    await createLearnerState(sourceDirectory);
    await expect(migrateQuickStudyData({ sourceDirectory, destinationDirectory, applicationVersion: "0.2.0" }))
      .resolves.toMatchObject({ outcome: "migrated" });
    const receipt = await readFile(join(destinationDirectory, "migration-receipt.json"), "utf8");

    await expect(migrateQuickStudyData({ sourceDirectory, destinationDirectory, applicationVersion: "0.2.0" }))
      .resolves.toMatchObject({ outcome: "already-migrated" });
    expect(await readFile(join(destinationDirectory, "migration-receipt.json"), "utf8")).toBe(receipt);
  });

  it("blocks a meaningful destination instead of overwriting or merging it", async () => {
    const root = await temporaryDirectory("clarifold-migration-conflict-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    await createLearnerState(sourceDirectory);
    await mkdir(destinationDirectory, { recursive: true });
    await writeFile(join(destinationDirectory, "local-history.txt"), "keep destination\n", "utf8");
    const sourceState = await readFile(join(sourceDirectory, "learning-application.json"), "utf8");

    await expect(migrateQuickStudyData({ sourceDirectory, destinationDirectory, applicationVersion: "0.2.0" }))
      .resolves.toMatchObject({ outcome: "blocked", reason: "destination-conflict" });
    expect(await readFile(join(sourceDirectory, "learning-application.json"), "utf8")).toBe(sourceState);
    expect(await readFile(join(destinationDirectory, "local-history.txt"), "utf8")).toBe("keep destination\n");
  });

  it("cleans its own failed staging output and exposes recovery without touching the source", async () => {
    const root = await temporaryDirectory("clarifold-migration-failure-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    await createLearnerState(sourceDirectory);
    const result = await migrateQuickStudyData({
      sourceDirectory,
      destinationDirectory,
      applicationVersion: "0.2.0",
      getFreeSpaceBytes: async () => 0
    });

    expect(result).toMatchObject({ outcome: "failed", reason: "insufficient-space" });
    expect(result.stages).toContain("recovery");
    expect(JSON.parse(await readFile(`${destinationDirectory}.migration-recovery.json`, "utf8"))).toMatchObject({
      outcome: "failed", reason: "insufficient-space", retryState: "safe-to-retry"
    });
    await expect(readFile(join(sourceDirectory, "learning-application.json"))).resolves.toBeTruthy();
    await expect(readdir(destinationDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an incomplete source before any staging copy", async () => {
    const root = await temporaryDirectory("clarifold-migration-incomplete-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(join(sourceDirectory, "partial-copy.txt"), "partial\n", "utf8");

    await expect(migrateQuickStudyData({ sourceDirectory, destinationDirectory, applicationVersion: "0.2.0" }))
      .resolves.toMatchObject({ outcome: "blocked", reason: "source-incomplete" });
    await expect(readdir(destinationDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers an abandoned lock owned by a dead process", async () => {
    const root = await temporaryDirectory("clarifold-migration-stale-lock-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    await createLearnerState(sourceDirectory);
    const lockDirectory = `${destinationDirectory}.migration-lock`;
    await writeFile(lockDirectory, JSON.stringify({ pid: 999_999_999, token: "stale-lock" }), "utf8");

    await expect(migrateQuickStudyData({ sourceDirectory, destinationDirectory, applicationVersion: "0.2.0" }))
      .resolves.toMatchObject({ outcome: "migrated" });
  });

  it("serializes concurrent reclamation of an abandoned lock", async () => {
    const root = await temporaryDirectory("clarifold-migration-stale-lock-race-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    await createLearnerState(sourceDirectory);
    await writeFile(`${destinationDirectory}.migration-lock`, JSON.stringify({ pid: 999_999_999, token: "stale-lock" }), "utf8");

    const results = await Promise.all([
      migrateQuickStudyData({ sourceDirectory, destinationDirectory, applicationVersion: "0.2.0" }),
      migrateQuickStudyData({ sourceDirectory, destinationDirectory, applicationVersion: "0.2.0" })
    ]);
    expect(results.filter((result) => result.outcome === "migrated")).toHaveLength(1);
    expect(results.filter((result) => result.reason === "concurrent-launch")).toHaveLength(1);
  });

  it("recovers an abandoned stale-lock reclaimer guard", async () => {
    const root = await temporaryDirectory("clarifold-migration-stale-reclaimer-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    await createLearnerState(sourceDirectory);
    const staleOwner = JSON.stringify({ pid: 999_999_999, token: "stale-lock" });
    await writeFile(`${destinationDirectory}.migration-lock`, staleOwner, "utf8");
    await writeFile(`${destinationDirectory}.migration-lock.reclaim`, staleOwner, "utf8");

    await expect(migrateQuickStudyData({ sourceDirectory, destinationDirectory, applicationVersion: "0.2.0" }))
      .resolves.toMatchObject({ outcome: "migrated" });
  });

  it("does not delete staging output without its Clarifold ownership marker", async () => {
    const root = await temporaryDirectory("clarifold-migration-staging-collision-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    await createLearnerState(sourceDirectory);
    const stagingDirectory = `${destinationDirectory}.migration-staging`;
    await mkdir(stagingDirectory, { recursive: true });
    await writeFile(join(stagingDirectory, "unrelated.txt"), "leave me\n", "utf8");

    await expect(migrateQuickStudyData({ sourceDirectory, destinationDirectory, applicationVersion: "0.2.0" }))
      .resolves.toMatchObject({ outcome: "failed", reason: "staging-collision" });
    await expect(readFile(join(stagingDirectory, "unrelated.txt"), "utf8")).resolves.toBe("leave me\n");
  });

  it("blocks concurrent launches while the first launch owns the guard", async () => {
    const root = await temporaryDirectory("clarifold-migration-concurrent-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    await createLearnerState(sourceDirectory);
    let releaseValidation!: () => void;
    let signalValidationStarted!: () => void;
    const validationStarted = new Promise<void>((resolve) => { signalValidationStarted = resolve; });
    const validationRelease = new Promise<void>((resolve) => { releaseValidation = resolve; });
    const first = migrateQuickStudyData({
      sourceDirectory,
      destinationDirectory,
      applicationVersion: "0.2.0",
      onStage: (stage) => { if (stage === "verification") signalValidationStarted(); },
      validateStagedDirectory: async () => validationRelease
    });
    await validationStarted;
    await expect(migrateQuickStudyData({ sourceDirectory, destinationDirectory, applicationVersion: "0.2.0" }))
      .resolves.toMatchObject({ outcome: "blocked", reason: "concurrent-launch" });
    releaseValidation();
    await expect(first).resolves.toMatchObject({ outcome: "migrated" });
  });

  it("preserves a resumable session and Linked Source references for rollback", async () => {
    const root = await temporaryDirectory("clarifold-migration-preservation-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    const linkedSourcePath = join(root, "externally-owned-notes.txt");
    await writeFile(linkedSourcePath, "externally owned\n", "utf8");
    await mkdir(sourceDirectory, { recursive: true });
    const application = await LearningApplication.launch(sourceDirectory);
    await application.submit({ type: "startQuickStudy", mathematics: "Study compactness." });
    await application.linkExternalAttachment(application.getState().quickStudy.workspace.id, {
      name: "externally-owned-notes.txt",
      resourceType: "file",
      lastKnownPath: linkedSourcePath,
      canonicalPath: linkedSourcePath,
      accessGrant: null,
      fingerprint: { size: 17, modifiedAtMs: 1 }
    });
    const sourceState = JSON.parse(await readFile(join(sourceDirectory, "learning-application.json"), "utf8")) as {
      sessions: Array<{ learningGoal: string }>;
      sources: Array<{ kind: string; link?: { canonicalPath: string } }>;
    };
    const sourceSnapshot = await readFile(join(sourceDirectory, "learning-application.json"), "utf8");

    await expect(migrateQuickStudyData({ sourceDirectory, destinationDirectory, applicationVersion: "0.2.0" }))
      .resolves.toMatchObject({ outcome: "migrated" });
    const migrated = await LearningApplication.launch(destinationDirectory);
    const rolledBack = await LearningApplication.launch(sourceDirectory);
    expect(migrated.getState().sessions.map((session) => session.learningGoal)).toEqual(
      sourceState.sessions.map((session) => session.learningGoal)
    );
    expect(migrated.getState().sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "linkedSource", link: expect.objectContaining({ canonicalPath: linkedSourcePath }) })
    ]));
    expect(rolledBack.getState().sessions).toHaveLength(sourceState.sessions.length);
    expect(await readFile(join(sourceDirectory, "learning-application.json"), "utf8")).toBe(sourceSnapshot);
    expect(await readFile(linkedSourcePath, "utf8")).toBe("externally owned\n");
    await expect(readFile(join(destinationDirectory, "externally-owned-notes.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails safely when the legacy source changes during staging", async () => {
    const root = await temporaryDirectory("clarifold-migration-source-change-");
    const sourceDirectory = join(root, "Quick Study");
    const destinationDirectory = join(root, "Clarifold");
    await createLearnerState(sourceDirectory);

    await expect(migrateQuickStudyData({
      sourceDirectory,
      destinationDirectory,
      applicationVersion: "0.2.0",
      validateStagedDirectory: async () => {
        await appendFile(join(sourceDirectory, "learning-application.json"), "\n", "utf8");
      }
    })).resolves.toMatchObject({ outcome: "failed", reason: "copy-failed" });
    await expect(readdir(destinationDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  async function temporaryDirectory(prefix: string): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), prefix));
    temporaryDirectories.push(path);
    return path;
  }

  async function createLearnerState(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
    const application = await LearningApplication.launch(path);
    await application.submit({ type: "createWorkspace", name: "Topology" });
    await application.submit({ type: "startQuickStudy", mathematics: "Study compactness." });
  }
});
