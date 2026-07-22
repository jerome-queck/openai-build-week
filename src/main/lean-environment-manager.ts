import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { boundedProcessEnvironment } from "./bounded-process-environment";
import {
  BUNDLED_LEAN_ENVIRONMENT,
  validRecordedVerificationEnvironment,
  type VerificationEnvironment,
  type VerifierEnvironmentInstallation,
  type VerifierEnvironmentInspection,
  type VerifierEnvironmentManager
} from "../shared/verifier-runtime";

export interface LeanIntegritySnapshot {
  contentDigest: string;
  metadataDigest: string;
}

export interface LeanIntegrityScanner {
  scanTree(root: string, signal?: AbortSignal): Promise<LeanIntegritySnapshot>;
  scanMetadata(root: string, signal?: AbortSignal): Promise<string>;
}

export interface LeanIntegrityLifecycleEvent {
  phase: "installed-content" | "trusted-seed" | "execution-metadata";
  status: "started" | "completed" | "failed";
  elapsedMs: number;
  environmentId: string;
  detail?: string;
}

interface LeanIntegrityOptions {
  scanner?: LeanIntegrityScanner;
  preparationTimeoutMs?: number;
  executionTimeoutMs?: number;
  observe?: (event: LeanIntegrityLifecycleEvent) => void;
}

export class LeanEnvironmentManager implements VerifierEnvironmentManager {
  private readonly environmentPath: string;
  private readonly seedPath: string;
  private readonly removalMarkerPath: string;
  private readonly activeMarkerPath: string;
  private activeEnvironmentId: string | null = null;
  private readonly installedBytesById = new Map<string, number>();
  private trustedSeedDigest: Promise<string> | null = null;
  private readonly integrityPreparations = new Map<string, Promise<void>>();
  private readonly verifiedInstalledIntegrity = new Map<string, LeanIntegritySnapshot>();
  private readonly integrityScanner: LeanIntegrityScanner;
  private readonly preparationTimeoutMs: number;
  private readonly executionTimeoutMs: number;
  private readonly observeIntegrity: (event: LeanIntegrityLifecycleEvent) => void;

  constructor(
    private readonly registryPath: string,
    seedRegistryPath: string,
    private readonly validate: (environmentPath: string, signal?: AbortSignal) => Promise<void> = validateReferenceProof,
    private readonly beforeRemove: () => Promise<void> = async () => undefined,
    integrity: LeanIntegrityOptions = {}
  ) {
    this.environmentPath = join(registryPath, BUNDLED_LEAN_ENVIRONMENT.id);
    this.seedPath = join(seedRegistryPath, BUNDLED_LEAN_ENVIRONMENT.id);
    this.removalMarkerPath = join(registryPath, ".lean-environment-removed");
    this.activeMarkerPath = join(registryPath, ".active-lean-environment");
    this.integrityScanner = integrity.scanner ?? DEFAULT_INTEGRITY_SCANNER;
    this.preparationTimeoutMs = integrity.preparationTimeoutMs ?? 300_000;
    this.executionTimeoutMs = integrity.executionTimeoutMs ?? 60_000;
    this.observeIntegrity = integrity.observe ?? (() => undefined);
  }

  executablePath(environmentId = this.activeEnvironmentId ?? BUNDLED_LEAN_ENVIRONMENT.id): string {
    return join(this.registryPath, environmentId, "bin", "lean");
  }

  private digestPath(environmentId: string): string {
    if (!/^[a-zA-Z0-9._-]{1,200}$/.test(environmentId)) {
      throw new Error("The Verifier Environment identifier is invalid.");
    }
    return join(this.registryPath, `.lean-environment-digest-${environmentId}`);
  }

  private installedSizePath(environmentId: string): string {
    if (!/^[a-zA-Z0-9._-]{1,200}$/.test(environmentId)) {
      throw new Error("The Verifier Environment identifier is invalid.");
    }
    return join(this.registryPath, `.lean-environment-size-${environmentId}`);
  }

  async defaultInstallationNeeded(): Promise<boolean> {
    const inspection = await this.inspect();
    return !inspection.installed && !inspection.cleanupRequired && !await exists(this.removalMarkerPath);
  }

  async inspect(): Promise<VerifierEnvironmentInspection> {
    const entries = await directoryEntries(this.registryPath);
    const interrupted = entries.some((name) => /\.((installing)|(removing))-[a-zA-Z0-9-]+$/.test(name));
    let missingInstalledSize = false;
    const environments = (await Promise.all(entries
      .filter((name) => !name.startsWith("."))
      .map(async (name) => {
        const recordedSize = this.installedBytesById.get(name) ?? await recordedInstalledBytes(this.installedSizePath(name));
        const environment = await installedEnvironment(join(this.registryPath, name), recordedSize);
        if (environment && recordedSize === undefined) missingInstalledSize = true;
        return environment;
      }))).filter((entry): entry is VerifierEnvironmentInstallation => entry !== null);
    const recordedActive = await readActiveEnvironmentId(this.activeMarkerPath);
    const fallbackActive = environments.find((entry) => entry.environment.id === BUNDLED_LEAN_ENVIRONMENT.id)?.environment.id ?? null;
    const activeEnvironmentId = environments.some((entry) => entry.environment.id === recordedActive)
      ? recordedActive : fallbackActive;
    this.activeEnvironmentId = activeEnvironmentId;
    const active = environments.find((entry) => entry.environment.id === activeEnvironmentId) ?? null;
    const invalidActive = entries.some((name) => !name.startsWith(".")
      && !environments.some((entry) => entry.environment.id === name));
    return {
      installed: active !== null,
      installedBytes: active?.installedBytes ?? 0,
      cleanupRequired: interrupted || invalidActive || missingInstalledSize,
      environments,
      activeEnvironmentId
    };
  }

  async install(signal?: AbortSignal): Promise<{ installedBytes: number; environment: Readonly<VerificationEnvironment> }> {
    requireLeanOperationActive(signal);
    await mkdir(this.registryPath, { recursive: true });
    for (const name of await directoryEntries(this.registryPath)) {
      if (name.startsWith(`.${BUNDLED_LEAN_ENVIRONMENT.id}.installing-`)) {
        await removeWritableTree(this.registryPath, join(this.registryPath, name));
      }
    }
    const stagingPath = join(this.registryPath, `.${BUNDLED_LEAN_ENVIRONMENT.id}.installing-${randomUUID()}`);
    await copySeedToWritableRegistry(this.seedPath, stagingPath, signal);
    requireLeanOperationActive(signal);
    if (!await validEnvironmentIdentity(stagingPath)) {
      throw new Error("The staged Lean environment did not match the supported Default Verification Environment.");
    }
    await this.validate(stagingPath, signal);
    requireLeanOperationActive(signal);
    const installedBytes = await directorySize(stagingPath, signal);
    requireLeanOperationActive(signal);
    // Keep the staging root writable until it has been renamed. Hosted macOS
    // runners reject renaming a directory after its own write bit is removed,
    // even though the registry parent remains writable.
    const backupPath = join(this.registryPath, `.${BUNDLED_LEAN_ENVIRONMENT.id}.removing-${randomUUID()}`);
    const hadActive = await exists(this.environmentPath);
    if (hadActive) await renameReadOnlyTree(this.registryPath, this.environmentPath, backupPath);
    try {
      await rename(stagingPath, this.environmentPath);
      await chmod(this.environmentPath, 0o500);
    } catch (error) {
      if (await exists(this.environmentPath)) await removeWritableTree(this.registryPath, this.environmentPath);
      if (hadActive) {
        await rename(backupPath, this.environmentPath);
        await chmod(this.environmentPath, 0o500);
      }
      throw error;
    }
    await writeFile(this.installedSizePath(BUNDLED_LEAN_ENVIRONMENT.id), `${installedBytes}\n`, {
      encoding: "utf8", mode: 0o600
    });
    await removeWritableTree(this.registryPath, backupPath);
    await rm(this.removalMarkerPath, { force: true });
    this.installedBytesById.set(BUNDLED_LEAN_ENVIRONMENT.id, installedBytes);
    this.clearInstalledIntegrity(BUNDLED_LEAN_ENVIRONMENT.id);
    return { installedBytes, environment: BUNDLED_LEAN_ENVIRONMENT };
  }

  async activate(environmentId: string, signal?: AbortSignal): Promise<void> {
    const environment = await installedEnvironment(join(this.registryPath, environmentId), this.installedBytesById.get(environmentId));
    if (!environment) throw new Error("The selected Lean environment is unavailable or invalid.");
    if (environmentId === BUNDLED_LEAN_ENVIRONMENT.id) {
      await this.prepareInstalledIntegrity(signal, environmentId);
      await this.assertInstalledIntegrity(signal, environmentId);
    }
    await mkdir(this.registryPath, { recursive: true });
    const stagingPath = `${this.activeMarkerPath}.${randomUUID()}.tmp`;
    await writeFile(stagingPath, `${environmentId}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(stagingPath, this.activeMarkerPath);
    this.activeEnvironmentId = environmentId;
  }

  async remove(environmentId = this.activeEnvironmentId ?? BUNDLED_LEAN_ENVIRONMENT.id): Promise<{ removedLogicalBytes: number }> {
    const path = join(this.registryPath, environmentId);
    await this.beforeRemove();
    if (!await this.installedIntegrityIsValid(environmentId)) {
      throw new Error("The installed Lean environment is missing or invalid; clean it up before retrying.");
    }
    const removedLogicalBytes = await directorySize(path);
    const removalPath = join(this.registryPath, `.${environmentId}.removing-${randomUUID()}`);
    if (environmentId === BUNDLED_LEAN_ENVIRONMENT.id) {
      await writeFile(this.removalMarkerPath, `${BUNDLED_LEAN_ENVIRONMENT.id}\n`, "utf8");
    }
    await renameReadOnlyTree(this.registryPath, path, removalPath);
    await removeWritableTree(this.registryPath, removalPath);
    this.installedBytesById.delete(environmentId);
    this.clearInstalledIntegrity(environmentId);
    await rm(this.digestPath(environmentId), { force: true });
    await rm(this.installedSizePath(environmentId), { force: true });
    if (this.activeEnvironmentId === environmentId) {
      await rm(this.activeMarkerPath, { force: true });
      this.activeEnvironmentId = null;
    }
    return { removedLogicalBytes };
  }

  async cleanup(environmentIds: string[] = []): Promise<{ installed: boolean; installedBytes: number }> {
    for (const name of await directoryEntries(this.registryPath)) {
      if (/\.((installing)|(removing))-[a-zA-Z0-9-]+$/.test(name)
        || (name === BUNDLED_LEAN_ENVIRONMENT.id && !await this.installedIntegrityIsValid(name))) {
        await removeWritableTree(this.registryPath, join(this.registryPath, name));
        if (name === BUNDLED_LEAN_ENVIRONMENT.id) {
          await rm(this.digestPath(name), { force: true });
          await rm(this.installedSizePath(name), { force: true });
        }
      }
    }
    for (const environmentId of environmentIds) {
      if (environmentId === this.activeEnvironmentId) continue;
      const path = join(this.registryPath, environmentId);
      if (await exists(path)) await removeWritableTree(this.registryPath, path);
      this.clearInstalledIntegrity(environmentId);
      await rm(this.digestPath(environmentId), { force: true });
      await rm(this.installedSizePath(environmentId), { force: true });
    }
    for (const name of await directoryEntries(this.registryPath)) {
      if (name.startsWith(".") || await recordedInstalledBytes(this.installedSizePath(name)) !== undefined) continue;
      const path = join(this.registryPath, name);
      if (!await installedEnvironment(path, 0)) continue;
      const installedBytes = await directorySize(path);
      await writeFile(this.installedSizePath(name), `${installedBytes}\n`, { encoding: "utf8", mode: 0o600 });
      this.installedBytesById.set(name, installedBytes);
    }
    const inspection = await this.inspect();
    return { installed: inspection.installed, installedBytes: inspection.installedBytes };
  }

  async assertInstalledIntegrity(signal?: AbortSignal, environmentId = this.activeEnvironmentId ?? BUNDLED_LEAN_ENVIRONMENT.id): Promise<void> {
    const environmentPath = join(this.registryPath, environmentId);
    if (!await validEnvironmentIdentity(environmentPath)) {
      throw new Error("The installed Lean environment does not match the signed application payload.");
    }
    const prepared = this.verifiedInstalledIntegrity.get(environmentId);
    if (!prepared) {
      const progress = this.integrityPreparations.has(environmentId) ? "is still running" : "has not completed";
      throw new Error(`Lean integrity preparation ${progress}; Lean was not launched.`);
    }
    const currentMetadata = await this.runIntegrityPhase(
      "execution-metadata",
      environmentId,
      this.executionTimeoutMs,
      signal,
      (phaseSignal) => this.integrityScanner.scanMetadata(environmentPath, phaseSignal)
    );
    if (currentMetadata !== prepared.metadataDigest) {
      this.clearInstalledIntegrity(environmentId);
      throw new Error("The installed Lean environment changed after readiness preparation; Lean was not launched. Re-prepare integrity before retrying.");
    }
  }

  async prepareInstalledIntegrity(
    signal?: AbortSignal,
    environmentId = this.activeEnvironmentId ?? BUNDLED_LEAN_ENVIRONMENT.id
  ): Promise<void> {
    if (this.verifiedInstalledIntegrity.has(environmentId)) return;
    let preparation = this.integrityPreparations.get(environmentId);
    if (!preparation) {
      preparation = this.prepareInstalledIntegritySnapshot(environmentId, signal).catch((error) => {
        this.integrityPreparations.delete(environmentId);
        throw error;
      });
      this.integrityPreparations.set(environmentId, preparation);
    }
    await waitForSharedPreparation(preparation, signal);
  }

  private async installedIntegrityIsValid(environmentId = this.activeEnvironmentId ?? BUNDLED_LEAN_ENVIRONMENT.id, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.prepareInstalledIntegrity(signal, environmentId);
      await this.assertInstalledIntegrity(signal, environmentId);
      return true;
    } catch {
      return false;
    }
  }

  private seedDigest(environmentId: string, signal?: AbortSignal): Promise<string> {
    this.trustedSeedDigest ??= this.runIntegrityPhase(
      "trusted-seed",
      environmentId,
      this.preparationTimeoutMs,
      signal,
      (signal) => this.integrityScanner.scanTree(this.seedPath, signal)
    ).then((snapshot) => snapshot.contentDigest).catch((error) => {
      this.trustedSeedDigest = null;
      throw error;
    });
    return this.trustedSeedDigest;
  }

  private async prepareInstalledIntegritySnapshot(environmentId: string, signal?: AbortSignal): Promise<void> {
    const environmentPath = join(this.registryPath, environmentId);
    if (!await validEnvironmentIdentity(environmentPath)) {
      throw new Error("The installed Lean environment does not match the signed application payload; Lean was not launched.");
    }
    const installed = await this.runIntegrityPhase(
      "installed-content",
      environmentId,
      this.preparationTimeoutMs,
      signal,
      (signal) => this.integrityScanner.scanTree(environmentPath, signal)
    );
    const expectedDigest = environmentId === BUNDLED_LEAN_ENVIRONMENT.id
      ? await this.seedDigest(environmentId, signal)
      : await recordedEnvironmentDigest(this.digestPath(environmentId));
    if (!expectedDigest || installed.contentDigest !== expectedDigest) {
      throw new Error(environmentId === BUNDLED_LEAN_ENVIRONMENT.id
        ? "The installed Lean environment does not match the signed application payload; Lean was not launched."
        : "The installed Lean environment does not match its recorded validated content; Lean was not launched.");
    }
    this.verifiedInstalledIntegrity.set(environmentId, installed);
    this.integrityPreparations.delete(environmentId);
  }

  private clearInstalledIntegrity(environmentId: string): void {
    this.integrityPreparations.delete(environmentId);
    this.verifiedInstalledIntegrity.delete(environmentId);
  }

  private async runIntegrityPhase<T>(
    phase: LeanIntegrityLifecycleEvent["phase"],
    environmentId: string,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const startedAt = Date.now();
    this.observeIntegrity({ phase, status: "started", elapsedMs: 0, environmentId });
    const controller = new AbortController();
    const timedOut = Symbol("integrity-timeout");
    const cancelled = Symbol("integrity-cancelled");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelListener: (() => void) | undefined;
    const boundary = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(timedOut);
        controller.abort();
      }, timeoutMs);
      if (signal) {
        cancelListener = () => {
          reject(cancelled);
          controller.abort();
        };
        signal.addEventListener("abort", cancelListener, { once: true });
        if (signal.aborted) cancelListener();
      }
    });
    try {
      const result = await Promise.race([work(controller.signal), boundary]);
      this.observeIntegrity({ phase, status: "completed", elapsedMs: Date.now() - startedAt, environmentId });
      return result;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error === timedOut
        ? `Lean integrity phase ${phase} exceeded ${timeoutMs} ms after ${elapsedMs} ms; Lean was not launched.`
        : error === cancelled
          ? `Lean integrity phase ${phase} was cancelled after ${elapsedMs} ms; Lean was not launched.`
          : usefulIntegrityError(error);
      this.observeIntegrity({ phase, status: "failed", elapsedMs, environmentId, detail: message });
      throw new Error(message);
    } finally {
      if (timer) clearTimeout(timer);
      if (signal && cancelListener) signal.removeEventListener("abort", cancelListener);
    }
  }
}

export async function validateReferenceProof(environmentPath: string, signal?: AbortSignal): Promise<void> {
  const executable = join(environmentPath, "bin", "lean");
  await executeValidation(executable, [
    "--deps", join(environmentPath, "app-support", "QuickStudyMathlibDependency.lean")
  ], "mathlib dependency resolution", signal);
  await executeValidation(executable, [
    join(environmentPath, "app-support", "QuickStudyRuntimeHealth.lean")
  ], "runtime health proof", signal);
}

function executeValidation(executable: string, args: string[], description: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      cwd: dirname(dirname(executable)),
      env: boundedProcessEnvironment(),
      timeout: 15_000,
      signal,
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    }, (error, _stdout, stderr) => {
      if (!error) resolve();
      else reject(new Error(
        `The staged Lean environment failed ${description}. ${stderr.trim() || error.message}`
      ));
    });
  });
}

async function installedEnvironment(path: string, installedBytes?: number): Promise<VerifierEnvironmentInstallation | null> {
  if (!await validInspectableEnvironment(path)) return null;
  try {
    return {
      environment: JSON.parse(await readFile(join(path, "manifest.json"), "utf8")) as VerificationEnvironment,
      installedBytes: installedBytes ?? 0
    };
  } catch {
    return null;
  }
}

async function recordedInstalledBytes(path: string): Promise<number | undefined> {
  try {
    const value = Number((await readFile(path, "utf8")).trim());
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readActiveEnvironmentId(path: string): Promise<string | null> {
  try {
    const id = (await readFile(path, "utf8")).trim();
    return /^[a-zA-Z0-9._-]{1,200}$/.test(id) ? id : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function recordedEnvironmentDigest(path: string): Promise<string | null> {
  try {
    const digest = (await readFile(path, "utf8")).trim();
    return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function validEnvironmentIdentity(path: string): Promise<boolean> {
  try {
    const root = await lstat(path);
    const manifestPath = join(path, "manifest.json");
    const manifestInfo = await lstat(manifestPath);
    if (!root.isDirectory() || root.isSymbolicLink() || !manifestInfo.isFile() || manifestInfo.isSymbolicLink()) return false;
    const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!validRecordedVerificationEnvironment(manifest)) return false;
    const executable = await lstat(join(path, "bin", "lean"));
    return executable.isFile() && !executable.isSymbolicLink();
  } catch {
    return false;
  }
}

async function validInspectableEnvironment(path: string): Promise<boolean> {
  if (!await validEnvironmentIdentity(path)) return false;
  try {
    const criticalPaths = [path, join(path, "manifest.json"), join(path, "bin"), join(path, "bin", "lean")];
    return (await Promise.all(criticalPaths.map((criticalPath) => lstat(criticalPath))))
      .every((info) => !info.isSymbolicLink() && (info.mode & 0o222) === 0);
  } catch {
    return false;
  }
}

async function directoryEntries(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function directorySize(path: string, signal?: AbortSignal): Promise<number> {
  requireLeanOperationActive(signal);
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    requireLeanOperationActive(signal);
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error("The Lean environment contains an unsafe filesystem link.");
    total += entry.isDirectory() ? await directorySize(child, signal) : (await lstat(child)).size;
  }
  return total;
}

const DEFAULT_INTEGRITY_SCANNER: LeanIntegrityScanner = {
  scanTree: treeIntegritySnapshot,
  scanMetadata: treeMetadataDigest
};

async function treeIntegritySnapshot(root: string, signal?: AbortSignal): Promise<LeanIntegritySnapshot> {
  const contentHash = createHash("sha256");
  const metadataHash = createHash("sha256");
  await appendTreeIntegrityDigest(metadataHash, root, root, signal, contentHash);
  return { contentDigest: contentHash.digest("hex"), metadataDigest: metadataHash.digest("hex") };
}

async function treeMetadataDigest(root: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  await appendTreeIntegrityDigest(hash, root, root, signal);
  return hash.digest("hex");
}

async function appendTreeIntegrityDigest(
  metadataHash: ReturnType<typeof createHash>,
  root: string,
  path: string,
  signal: AbortSignal | undefined,
  contentHash?: ReturnType<typeof createHash>
): Promise<void> {
  requireIntegrityScanActive(signal);
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const relation = relative(resolvedRoot, resolvedPath);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error("The Lean environment contains a path outside its managed integrity root.");
  }
  const info = await lstat(resolvedPath, { bigint: true });
  if (info.isSymbolicLink()) throw new Error("The Lean environment contains an unsafe filesystem link.");
  if ((info.mode & 0o222n) !== 0n) throw new Error("The Lean environment contains a writable filesystem entry.");
  metadataHash.update([
    relation, info.mode, info.size, info.dev, info.ino, info.mtimeNs, info.ctimeNs
  ].map(String).join("\0"));
  if (!info.isDirectory()) {
    if (!info.isFile()) throw new Error("The Lean environment contains an unsupported filesystem entry.");
    if (contentHash) {
      contentHash.update(`file\0${relation}\0`);
      for await (const chunk of createReadStream(resolvedPath, { signal })) {
        requireIntegrityScanActive(signal);
        contentHash.update(chunk);
      }
    }
    return;
  }
  if (contentHash && relation) contentHash.update(`directory\0${relation}\0`);
  for (const entry of (await readdir(resolvedPath)).sort((left, right) => left.localeCompare(right))) {
    await appendTreeIntegrityDigest(metadataHash, resolvedRoot, join(resolvedPath, entry), signal, contentHash);
  }
}

function requireIntegrityScanActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("The Lean integrity check was cancelled.");
}

function requireLeanOperationActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("The Lean environment operation was cancelled.");
}

async function waitForSharedPreparation(preparation: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return await preparation;
  if (signal.aborted) throw new Error("Lean integrity preparation was cancelled; Lean was not launched.");
  let cancel!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(new Error("Lean integrity preparation was cancelled; Lean was not launched."));
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    await Promise.race([preparation, cancelled]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function usefulIntegrityError(error: unknown): string {
  return error instanceof Error ? error.message : "Lean integrity preparation failed; Lean was not launched.";
}

async function copySeedToWritableRegistry(source: string, destination: string, signal?: AbortSignal): Promise<void> {
  requireLeanOperationActive(signal);
  await new Promise<void>((resolve, reject) => {
    const child = execFile("/bin/cp", ["-R", "-c", source, destination], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    });
    let stderr = "";
    let childError: Error | null = null;
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 300_000);
    const cancel = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", cancel, { once: true });
    child.once("error", (error) => {
      childError = error;
    });
    child.once("close", (code, terminationSignal) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) reject(new Error("The Lean environment operation was cancelled."));
      else if (code === 0) resolve();
      else reject(new Error(
        `The Lean environment payload could not be copied. ${stderr.trim() || childError?.message
          || `cp exited with ${terminationSignal ?? code}.`}`
      ));
    });
  });
  requireLeanOperationActive(signal);
  await chmod(destination, 0o700);
}

async function makeTreeReadOnly(registryPath: string, path: string, includeRoot = true): Promise<void> {
  assertManagedPath(registryPath, path);
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error("The Lean environment contains an unsafe filesystem link.");
  if (!info.isDirectory()) {
    await chmod(path, path.endsWith(join("bin", "lean")) ? 0o500 : 0o400);
    return;
  }
  for (const entry of await readdir(path)) await makeTreeReadOnly(registryPath, join(path, entry));
  if (includeRoot) await chmod(path, 0o500);
}

async function removeWritableTree(registryPath: string, path: string): Promise<void> {
  assertManagedPath(registryPath, path);
  if (!await exists(path)) return;
  await makeTreeWritable(registryPath, path);
  await rm(path, { recursive: true, force: true });
}

async function renameReadOnlyTree(registryPath: string, source: string, destination: string): Promise<void> {
  assertManagedPath(registryPath, source);
  assertManagedPath(registryPath, destination);
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new Error("The Lean environment contains an unsafe filesystem link.");
  }
  await chmod(source, 0o700);
  try {
    await rename(source, destination);
  } catch (error) {
    await chmod(source, 0o500);
    throw error;
  }
}

async function makeTreeWritable(registryPath: string, path: string): Promise<void> {
  assertManagedPath(registryPath, path);
  const info = await lstat(path);
  if (info.isSymbolicLink()) return;
  if (!info.isDirectory()) return;
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    await makeTreeWritable(registryPath, join(path, entry.name));
  }
}

function assertManagedPath(registryPath: string, path: string): void {
  const relation = relative(registryPath, path);
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error("Refusing to modify a path outside the Verifier Environment Registry.");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
