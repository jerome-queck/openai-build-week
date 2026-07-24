import { randomUUID, createHash } from "node:crypto";
import { statfs } from "node:fs/promises";
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { atomicWriteFile } from "../shared/atomic-file";
import { CLARIFOLD_IDENTITY } from "../shared/clarifold-identity";
import { LearningApplication } from "../shared/learning-application";

const MIGRATION_RECEIPT_NAME = "migration-receipt.json";
const MIGRATION_STAGING_SUFFIX = ".migration-staging";
const MIGRATION_LOCK_SUFFIX = ".migration-lock";
const MIGRATION_STAGING_MARKER_NAME = ".clarifold-migration-staging.json";
const MIGRATION_RECOVERY_RECEIPT_SUFFIX = ".migration-recovery.json";

export type MigrationStage =
  | "discovery"
  | "preflight"
  | "staging-copy"
  | "verification"
  | "atomic-commit"
  | "recovery"
  | "complete";

export type MigrationOutcome = "not-needed" | "migrated" | "already-migrated" | "blocked" | "failed";

export type MigrationReason =
  | "source-absent"
  | "source-incomplete"
  | "destination-conflict"
  | "concurrent-launch"
  | "staging-collision"
  | "insufficient-space"
  | "validation-failed"
  | "copy-failed"
  | "activation-failed";

export interface MigrationReceipt {
  readonly schemaVersion: 1;
  readonly source: string;
  readonly destination: string;
  readonly applicationVersion: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: "migrated";
  readonly retryState: "idempotent";
}

export interface MigrationRecoveryReceipt {
  readonly schemaVersion: 1;
  readonly source: string;
  readonly destination: string;
  readonly applicationVersion: string;
  readonly updatedAt: string;
  readonly outcome: "blocked" | "failed";
  readonly reason: MigrationReason;
  readonly retryState: "safe-to-retry" | "manual-intervention-required";
  readonly message: string;
}

export interface MigrationResult {
  readonly outcome: MigrationOutcome;
  readonly stages: MigrationStage[];
  readonly reason?: MigrationReason;
  readonly message?: string;
  readonly receipt?: MigrationReceipt;
}

export interface ClarifoldDataMigrationOptions {
  readonly sourceDirectory: string;
  readonly destinationDirectory: string;
  readonly applicationVersion: string;
  readonly now?: () => Date;
  readonly onStage?: (stage: MigrationStage) => void;
  readonly getFreeSpaceBytes?: (path: string) => Promise<number>;
  readonly validateStagedDirectory?: (path: string) => Promise<void>;
}

export async function migrateQuickStudyData(options: ClarifoldDataMigrationOptions): Promise<MigrationResult> {
  const observedStages: MigrationStage[] = [];
  const observeStage = (stage: MigrationStage): void => {
    if (observedStages.at(-1) !== stage) observedStages.push(stage);
    options.onStage?.(stage);
  };
  try {
    const result = await migrateQuickStudyDataInternal({ ...options, onStage: observeStage });
    if (result.outcome === "blocked" || result.outcome === "failed") {
      try {
        await writeRecoveryReceipt(options, result);
      } catch (error) {
        return recoveryReceiptFailure(result, error);
      }
    } else if (result.outcome === "migrated" || result.outcome === "already-migrated") {
      await removeMatchingRecoveryReceipt(options).catch(() => undefined);
    }
    return result;
  } catch (error) {
    observeStage("recovery");
    observeStage("complete");
    const result: MigrationResult = {
      outcome: "failed",
      stages: [...observedStages],
      reason: "activation-failed",
      message: `Clarifold could not safely prepare its application data: ${errorMessage(error)}.`
    };
    try {
      await writeRecoveryReceipt(options, result);
    } catch (receiptError) {
      return recoveryReceiptFailure(result, receiptError);
    }
    return result;
  }
}

function recoveryReceiptFailure(result: MigrationResult, error: unknown): MigrationResult {
  return {
    ...result,
    outcome: "failed",
    reason: "activation-failed",
    message: `${result.message ?? "Clarifold could not complete the data migration."} Recovery receipt could not be persisted: ${errorMessage(error)}.`
  };
}

async function migrateQuickStudyDataInternal(options: ClarifoldDataMigrationOptions): Promise<MigrationResult> {
  const sourceDirectory = normalizedDirectory(options.sourceDirectory, "source");
  const destinationDirectory = normalizedDirectory(options.destinationDirectory, "destination");
  if (sourceDirectory === destinationDirectory) throw new Error("Migration source and destination must differ.");

  const stages: MigrationStage[] = [];
  const emit = (stage: MigrationStage): void => {
    if (stages.at(-1) === stage) return;
    stages.push(stage);
    options.onStage?.(stage);
  };
  const result = (
    outcome: MigrationOutcome,
    reason?: MigrationReason,
    message?: string,
    receipt?: MigrationReceipt
  ): MigrationResult => {
    if (outcome === "blocked" || outcome === "failed") emit("recovery");
    emit("complete");
    return {
      outcome,
      stages: [...stages],
      ...(reason ? { reason } : {}),
      ...(message ? { message } : {}),
      ...(receipt ? { receipt } : {})
    };
  };

  emit("discovery");
  const sourceStatus = await directoryStatus(sourceDirectory);
  const destinationStatus = await directoryStatus(destinationDirectory);
  const receipt = destinationStatus.isDirectory ? await readMigrationReceipt(destinationDirectory) : null;
  if (receipt && receipt.source === sourceDirectory && receipt.destination === destinationDirectory) {
    emit("preflight");
    emit("verification");
    try {
      await (options.validateStagedDirectory ?? validateApplicationDirectory)(destinationDirectory);
    } catch (error) {
      return result("failed", "validation-failed", `The activated Clarifold data directory failed validation: ${errorMessage(error)}.`);
    }
    return result("already-migrated", undefined, undefined, receipt);
  }

  emit("preflight");
  if (!sourceStatus.exists) return result("not-needed", "source-absent");
  if (!sourceStatus.isDirectory) return result("blocked", "source-incomplete", "The legacy Quick Study data path is not a directory.");
  if (!(await isCompleteSourceDirectory(sourceDirectory))) {
    return result("blocked", "source-incomplete", "The legacy Quick Study data directory has no complete application state file.");
  }
  if (destinationStatus.exists && (!destinationStatus.isDirectory || destinationStatus.meaningful)) {
    return result("blocked", "destination-conflict", "The Clarifold data directory already contains data; automatic migration will not merge or overwrite it.");
  }

  const lockPath = `${destinationDirectory}${MIGRATION_LOCK_SUFFIX}`;
  await mkdir(dirname(destinationDirectory), { recursive: true });
  let lockHeld = false;
  try {
    if (!await acquireMigrationLock(lockPath, options.now ?? (() => new Date()))) {
      return result("blocked", "concurrent-launch", "Another Clarifold launch is already preparing this migration.");
    }
    lockHeld = true;

    const stagingDirectory = `${destinationDirectory}${MIGRATION_STAGING_SUFFIX}`;
    const existingStaging = await pathStatus(stagingDirectory);
    if (existingStaging.exists) {
      if (!existingStaging.isDirectory) return result("failed", "staging-collision", "Clarifold found an unexpected migration staging path and left it untouched.");
      if (!await hasMatchingStagingMarker(stagingDirectory, sourceDirectory, destinationDirectory)) {
        return result("failed", "staging-collision", "Clarifold found staging output it did not create and left it untouched.");
      }
      await rm(stagingDirectory, { recursive: true, force: true });
    }

    const sourceBytes = await directorySize(sourceDirectory);
    const freeSpaceBytes = await (options.getFreeSpaceBytes ?? availableSpaceBytes)(dirname(destinationDirectory));
    if (freeSpaceBytes < sourceBytes) {
      return result("failed", "insufficient-space", "There is not enough free space to stage the legacy Quick Study data safely.");
    }

    emit("staging-copy");
    const sourceSnapshot = await snapshotDirectory(sourceDirectory);
    try {
      await mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
      await writeFile(join(stagingDirectory, MIGRATION_STAGING_MARKER_NAME), `${JSON.stringify({
        schemaVersion: 1, source: sourceDirectory, destination: destinationDirectory
      })}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await copyDirectoryContents(sourceDirectory, stagingDirectory);
    } catch (error) {
      await removeOwnedStaging(stagingDirectory);
      return result("failed", "copy-failed", `Clarifold could not stage the legacy data: ${errorMessage(error)}.`);
    }

    emit("verification");
    try {
      await (options.validateStagedDirectory ?? validateApplicationDirectory)(stagingDirectory);
      if (await snapshotDirectory(sourceDirectory) !== sourceSnapshot) {
        throw new Error("the legacy Quick Study data changed while it was being migrated");
      }
    } catch (error) {
      await removeOwnedStaging(stagingDirectory);
      const reason = errorMessage(error).includes("changed while it was being migrated") ? "copy-failed" : "validation-failed";
      return result("failed", reason, `Clarifold rejected the staged data: ${errorMessage(error)}.`);
    }

    const now = options.now ?? (() => new Date());
    const startedAt = now().toISOString();
    const migrationReceipt: MigrationReceipt = {
      schemaVersion: 1,
      source: sourceDirectory,
      destination: destinationDirectory,
      applicationVersion: options.applicationVersion,
      startedAt,
      completedAt: now().toISOString(),
      outcome: "migrated",
      retryState: "idempotent"
    };
    await atomicWriteFile(join(stagingDirectory, MIGRATION_RECEIPT_NAME), `${JSON.stringify(migrationReceipt, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });

    emit("atomic-commit");
    try {
      const currentDestination = await directoryStatus(destinationDirectory);
      if (currentDestination.exists && (!currentDestination.isDirectory || currentDestination.meaningful)) {
        throw new Error("The Clarifold data directory changed while migration was being prepared.");
      }
      if (currentDestination.exists) await rm(destinationDirectory, { recursive: false });
      await rename(stagingDirectory, destinationDirectory);
      await rm(join(destinationDirectory, MIGRATION_STAGING_MARKER_NAME), { force: true });
    } catch (error) {
      await removeOwnedStaging(stagingDirectory);
      return result("failed", "activation-failed", `Clarifold could not activate the staged data: ${errorMessage(error)}.`);
    }
    return result("migrated", undefined, undefined, migrationReceipt);
  } finally {
    if (lockHeld) await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export function legacyQuickStudyDataDirectory(defaultDataDirectory: string): string {
  const normalizedDefault = normalizedDirectory(defaultDataDirectory, "default");
  return join(dirname(normalizedDefault), CLARIFOLD_IDENTITY.legacyDataDirectoryName);
}

interface DirectoryStatus {
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly meaningful: boolean;
}

interface MigrationLockOwner {
  readonly pid: number;
  readonly token?: string;
}

const MALFORMED_LOCK_GRACE_MS = 30_000;

async function directoryStatus(path: string): Promise<DirectoryStatus> {
  const status = await pathStatus(path);
  if (!status.exists) return status;
  if (!status.isDirectory) return status;
  return { ...status, meaningful: (await readdir(path)).length > 0 };
}

async function pathStatus(path: string): Promise<DirectoryStatus> {
  try {
    const info = await lstat(path);
    return {
      exists: true,
      isDirectory: info.isDirectory(),
      meaningful: info.isDirectory() ? (await readdir(path)).length > 0 : true
    };
  } catch (error) {
    if (isMissing(error)) return { exists: false, isDirectory: false, meaningful: false };
    throw error;
  }
}

async function isCompleteSourceDirectory(path: string): Promise<boolean> {
  const statePath = join(path, "learning-application.json");
  try {
    const info = await lstat(statePath);
    return info.isFile() && !info.isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function validateApplicationDirectory(path: string): Promise<void> {
  const application = await LearningApplication.launch(path);
  if (application.getState().persistenceRecovery.status !== "ready") {
    throw new Error("the stored learner state requires blocked recovery");
  }
}

async function copyDirectoryContents(source: string, destination: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`the source contains an unsupported symbolic link (${entry.name})`);
    if (entry.name === MIGRATION_STAGING_MARKER_NAME) throw new Error(`the source contains a reserved migration marker (${entry.name})`);
    if (entry.isDirectory()) {
      await mkdir(destinationPath, { recursive: false, mode: 0o700 });
      await copyDirectoryContents(sourcePath, destinationPath);
    }
    else if (entry.isFile()) await copyFile(sourcePath, destinationPath);
    else throw new Error(`the source contains an unsupported filesystem entry (${entry.name})`);
  }
}

async function snapshotDirectory(path: string): Promise<string> {
  const entries: Array<{ path: string; kind: "directory" | "file" | "symlink" | "other"; digest?: string }> = [];
  const visit = async (currentPath: string, relativePath: string): Promise<void> => {
    const children = (await readdir(currentPath, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of children) {
      const entryPath = join(currentPath, entry.name);
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        entries.push({ path: entryRelativePath, kind: "symlink" });
      } else if (entry.isDirectory()) {
        entries.push({ path: entryRelativePath, kind: "directory" });
        await visit(entryPath, entryRelativePath);
      } else if (entry.isFile()) {
        entries.push({
          path: entryRelativePath,
          kind: "file",
          digest: createHash("sha256").update(await readFile(entryPath)).digest("hex")
        });
      } else {
        entries.push({ path: entryRelativePath, kind: "other" });
      }
    }
  };
  await visit(path, "");
  return JSON.stringify(entries);
}

async function directorySize(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile()) total += (await stat(entryPath)).size;
  }
  return total;
}

async function availableSpaceBytes(path: string): Promise<number> {
  const filesystem = await statfs(path);
  return Number(filesystem.bavail) * Number(filesystem.bsize);
}

async function acquireMigrationLock(lockPath: string, now: () => Date): Promise<boolean> {
  const lockContents = (): string => `${JSON.stringify({ pid: process.pid, token: randomUUID(), startedAt: now().toISOString() })}\n`;
  try {
    await writeFile(lockPath, lockContents(), {
      encoding: "utf8", flag: "wx", mode: 0o600
    });
    return true;
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const reclaimPath = `${lockPath}.reclaim`;
    if (!await acquireMigrationLockReclaimer(reclaimPath, now)) return false;
    try {
      const owner = await readMigrationLockOwner(lockPath);
      if (!await isStaleMigrationLock(lockPath, owner, now())) return false;
      const observedOwner = owner;
      const currentOwner = await readMigrationLockOwner(lockPath);
      if (!sameLockOwner(observedOwner, currentOwner)) return false;
      await rm(lockPath, { force: true });
    } finally {
      await rm(reclaimPath, { force: true }).catch(() => undefined);
    }
    try {
      await writeFile(lockPath, lockContents(), {
        encoding: "utf8", flag: "wx", mode: 0o600
      });
      return true;
    } catch (retryError) {
      if (isAlreadyExists(retryError)) return false;
      throw retryError;
    }
  }
}

async function acquireMigrationLockReclaimer(path: string, now: () => Date): Promise<boolean> {
  try {
    await writeFile(path, `${JSON.stringify({ pid: process.pid, token: randomUUID(), startedAt: now().toISOString() })}\n`, {
      encoding: "utf8", flag: "wx", mode: 0o600
    });
    return true;
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const owner = await readMigrationLockOwner(path);
    if (!await isStaleMigrationLock(path, owner, now())) return false;
    const currentOwner = await readMigrationLockOwner(path);
    if (!sameLockOwner(owner, currentOwner)) return false;
    await rm(path, { force: true });
    return acquireMigrationLockReclaimer(path, now);
  }
}

async function isStaleMigrationLock(path: string, owner: MigrationLockOwner | null, now: Date): Promise<boolean> {
  if (owner) return !processIsAlive(owner.pid);
  try {
    const info = await lstat(path);
    return now.getTime() - info.mtimeMs >= MALFORMED_LOCK_GRACE_MS;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function sameLockOwner(left: MigrationLockOwner | null, right: MigrationLockOwner | null): boolean {
  if (!left || !right || left.pid !== right.pid) return left === right;
  return left.token === right.token;
}

async function readMigrationLockOwner(path: string): Promise<MigrationLockOwner | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return Number.isInteger(value.pid) && Number(value.pid) > 0
      ? { pid: Number(value.pid), ...(typeof value.token === "string" ? { token: value.token } : {}) }
      : null;
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

async function removeOwnedStaging(path: string): Promise<void> {
  try {
    if (await hasAnyStagingMarker(path)) await rm(path, { recursive: true, force: true });
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function hasAnyStagingMarker(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    const marker = await readFile(join(path, MIGRATION_STAGING_MARKER_NAME), "utf8");
    return marker.trim().length > 0;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function hasMatchingStagingMarker(path: string, source: string, destination: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(join(path, MIGRATION_STAGING_MARKER_NAME), "utf8")) as Record<string, unknown>;
    return marker.schemaVersion === 1 && marker.source === source && marker.destination === destination;
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return false;
    throw error;
  }
}

async function readMigrationReceipt(path: string): Promise<MigrationReceipt | null> {
  try {
    const raw = JSON.parse(await readFile(join(path, MIGRATION_RECEIPT_NAME), "utf8")) as Record<string, unknown>;
    if (raw.schemaVersion !== 1 || raw.outcome !== "migrated" || raw.retryState !== "idempotent"
      || typeof raw.source !== "string" || typeof raw.destination !== "string"
      || typeof raw.applicationVersion !== "string" || typeof raw.startedAt !== "string"
      || typeof raw.completedAt !== "string") return null;
    return raw as unknown as MigrationReceipt;
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeRecoveryReceipt(options: ClarifoldDataMigrationOptions, result: MigrationResult): Promise<void> {
  if (!result.reason || (result.outcome !== "blocked" && result.outcome !== "failed") || !isAbsolute(options.destinationDirectory)) return;
  const destination = resolve(options.destinationDirectory);
  const receipt: MigrationRecoveryReceipt = {
    schemaVersion: 1,
    source: isAbsolute(options.sourceDirectory) ? resolve(options.sourceDirectory) : options.sourceDirectory,
    destination,
    applicationVersion: options.applicationVersion,
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
    outcome: result.outcome,
    reason: result.reason,
    retryState: result.reason === "destination-conflict" || result.reason === "staging-collision"
      ? "manual-intervention-required" : "safe-to-retry",
    message: result.message ?? "Clarifold could not complete the data migration."
  };
  await mkdir(dirname(destination), { recursive: true });
  await atomicWriteFile(`${destination}${MIGRATION_RECOVERY_RECEIPT_SUFFIX}`, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8", mode: 0o600
  });
}

async function removeMatchingRecoveryReceipt(options: ClarifoldDataMigrationOptions): Promise<void> {
  if (!isAbsolute(options.destinationDirectory)) return;
  const destination = resolve(options.destinationDirectory);
  const path = `${destination}${MIGRATION_RECOVERY_RECEIPT_SUFFIX}`;
  try {
    const receipt = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (receipt.schemaVersion === 1 && receipt.destination === destination) await rm(path, { force: true });
  } catch (error) {
    if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
  }
}

function normalizedDirectory(path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(`The migration ${label} directory must be absolute.`);
  const normalized = resolve(path);
  if (normalized === dirname(normalized) || !normalized.startsWith(`${dirname(normalized)}${sep}`)) {
    throw new Error(`The migration ${label} directory must be an absolute child path.`);
  }
  return normalized;
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
