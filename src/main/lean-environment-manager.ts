import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { chmod, cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  BUNDLED_LEAN_ENVIRONMENT,
  validRecordedVerificationEnvironment,
  type VerificationEnvironment,
  type VerifierEnvironmentInstallation,
  type VerifierEnvironmentInspection,
  type VerifierEnvironmentManager
} from "../shared/verifier-runtime";

export class LeanEnvironmentManager implements VerifierEnvironmentManager {
  private readonly environmentPath: string;
  private readonly seedPath: string;
  private readonly removalMarkerPath: string;
  private readonly activeMarkerPath: string;
  private activeEnvironmentId: string | null = null;
  private readonly installedBytesById = new Map<string, number>();
  private trustedSeedDigest: Promise<string> | null = null;

  constructor(
    private readonly registryPath: string,
    seedRegistryPath: string,
    private readonly validate: (environmentPath: string) => Promise<void> = validateReferenceProof,
    private readonly beforeRemove: () => Promise<void> = async () => undefined
  ) {
    this.environmentPath = join(registryPath, BUNDLED_LEAN_ENVIRONMENT.id);
    this.seedPath = join(seedRegistryPath, BUNDLED_LEAN_ENVIRONMENT.id);
    this.removalMarkerPath = join(registryPath, ".lean-environment-removed");
    this.activeMarkerPath = join(registryPath, ".active-lean-environment");
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

  async defaultInstallationNeeded(): Promise<boolean> {
    const inspection = await this.inspect();
    return !inspection.installed && !inspection.cleanupRequired && !await exists(this.removalMarkerPath);
  }

  async inspect(): Promise<VerifierEnvironmentInspection> {
    const entries = await directoryEntries(this.registryPath);
    const interrupted = entries.some((name) => /\.((installing)|(removing))-[a-zA-Z0-9-]+$/.test(name));
    const environments = (await Promise.all(entries
      .filter((name) => !name.startsWith("."))
      .map((name) => installedEnvironment(join(this.registryPath, name), this.installedBytesById.get(name))))).filter((entry): entry is VerifierEnvironmentInstallation => entry !== null);
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
      cleanupRequired: interrupted || invalidActive,
      environments,
      activeEnvironmentId
    };
  }

  async install(): Promise<{ installedBytes: number; environment: Readonly<VerificationEnvironment> }> {
    await mkdir(this.registryPath, { recursive: true });
    for (const name of await directoryEntries(this.registryPath)) {
      if (name.startsWith(`.${BUNDLED_LEAN_ENVIRONMENT.id}.installing-`)) {
        await removeWritableTree(this.registryPath, join(this.registryPath, name));
      }
    }
    const stagingPath = join(this.registryPath, `.${BUNDLED_LEAN_ENVIRONMENT.id}.installing-${randomUUID()}`);
    await copySeedToWritableRegistry(this.seedPath, stagingPath);
    if (!await validEnvironmentIdentity(stagingPath)) {
      throw new Error("The staged Lean environment did not match the supported Default Verification Environment.");
    }
    await this.validate(stagingPath);
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
    await removeWritableTree(this.registryPath, backupPath);
    void this.recordEnvironmentDigest(BUNDLED_LEAN_ENVIRONMENT.id);
    await rm(this.removalMarkerPath, { force: true });
    this.installedBytesById.set(BUNDLED_LEAN_ENVIRONMENT.id, 0);
    return { installedBytes: 0, environment: BUNDLED_LEAN_ENVIRONMENT };
  }

  async activate(environmentId: string): Promise<void> {
    const environment = await installedEnvironment(join(this.registryPath, environmentId), this.installedBytesById.get(environmentId));
    if (!environment) throw new Error("The selected Lean environment is unavailable or invalid.");
    if (environmentId === BUNDLED_LEAN_ENVIRONMENT.id && !await this.installedIntegrityIsValid(environmentId)) {
      throw new Error("The selected Lean environment does not match the signed application payload.");
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
    await rm(this.digestPath(environmentId), { force: true });
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
      }
    }
    for (const environmentId of environmentIds) {
      if (environmentId === this.activeEnvironmentId) continue;
      const path = join(this.registryPath, environmentId);
      if (await exists(path)) await removeWritableTree(this.registryPath, path);
      await rm(this.digestPath(environmentId), { force: true });
    }
    const inspection = await this.inspect();
    return { installed: inspection.installed, installedBytes: inspection.installedBytes };
  }

  async assertInstalledIntegrity(signal?: AbortSignal, environmentId = this.activeEnvironmentId ?? BUNDLED_LEAN_ENVIRONMENT.id): Promise<void> {
    const environmentPath = join(this.registryPath, environmentId);
    if (!await validInstalledEnvironment(environmentPath)) {
      throw new Error("The installed Lean environment does not match the signed application payload.");
    }
    if (environmentId !== BUNDLED_LEAN_ENVIRONMENT.id) {
      const expectedDigest = await recordedEnvironmentDigest(this.digestPath(environmentId));
      const actualDigest = await treeContentDigest(environmentPath, signal, Date.now() + 60_000);
      if (!expectedDigest || actualDigest !== expectedDigest) {
        throw new Error("The installed Lean environment does not match its recorded validated content.");
      }
      return;
    }
    const deadline = Date.now() + 60_000;
    const [installedDigest, trustedDigest] = await Promise.all([
      treeContentDigest(environmentPath, signal, deadline),
      this.seedDigest(signal, deadline)
    ]);
    if (installedDigest !== trustedDigest) {
      throw new Error("The installed Lean environment does not match the signed application payload.");
    }
  }

  primeSeedIntegrity(): void {
    void this.seedDigest(undefined, Date.now() + 60_000).catch(() => undefined);
  }

  private async installedIntegrityIsValid(environmentId = this.activeEnvironmentId ?? BUNDLED_LEAN_ENVIRONMENT.id, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.assertInstalledIntegrity(signal, environmentId);
      return true;
    } catch {
      return false;
    }
  }

  private seedDigest(signal?: AbortSignal, deadline = Date.now() + 60_000): Promise<string> {
    this.trustedSeedDigest ??= treeContentDigest(this.seedPath, signal, deadline).catch((error) => {
      this.trustedSeedDigest = null;
      throw error;
    });
    return this.trustedSeedDigest;
  }

  private async recordEnvironmentDigest(environmentId: string): Promise<void> {
    try {
      await writeFile(this.digestPath(environmentId), `${await this.seedDigest()}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      // The active current bundle is still checked against its signed seed at execution time.
    }
  }
}

function validateReferenceProof(environmentPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(join(environmentPath, "bin", "lean"), [join(environmentPath, "app-support", "QuickStudyNatAddZero.lean")], {
      timeout: 15_000,
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    }, (error, _stdout, stderr) => {
      if (!error) resolve();
      else reject(new Error(`The staged Lean environment failed its reference proof. ${stderr.trim() || error.message}`));
    });
  });
}

async function validInstalledEnvironment(path: string): Promise<boolean> {
  return await validEnvironmentIdentity(path) && await treeIsImmutable(path);
}

async function installedEnvironment(path: string, installedBytes?: number): Promise<VerifierEnvironmentInstallation | null> {
  if (!await validInstalledEnvironment(path)) return null;
  try {
    return {
      environment: JSON.parse(await readFile(join(path, "manifest.json"), "utf8")) as VerificationEnvironment,
      installedBytes: installedBytes ?? await directorySize(path)
    };
  } catch {
    return null;
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

async function directoryEntries(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function directorySize(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error("The Lean environment contains an unsafe filesystem link.");
    total += entry.isDirectory() ? await directorySize(child) : (await lstat(child)).size;
  }
  return total;
}

async function treeContentDigest(root: string, signal?: AbortSignal, deadline = Date.now() + 60_000): Promise<string> {
  const hash = createHash("sha256");
  await appendTreeDigest(hash, root, root, signal, deadline);
  return hash.digest("hex");
}

async function appendTreeDigest(
  hash: ReturnType<typeof createHash>, root: string, path: string, signal: AbortSignal | undefined, deadline: number
): Promise<void> {
  requireIntegrityScanActive(signal, deadline);
  const entries = (await readdir(path, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    requireIntegrityScanActive(signal, deadline);
    const child = join(path, entry.name);
    const identity = relative(root, child);
    if (entry.isSymbolicLink()) throw new Error("The Lean environment contains an unsafe filesystem link.");
    hash.update(entry.isDirectory() ? `directory\0${identity}\0` : `file\0${identity}\0`);
    if (entry.isDirectory()) await appendTreeDigest(hash, root, child, signal, deadline);
    else if (entry.isFile()) {
      for await (const chunk of createReadStream(child, { signal })) {
        requireIntegrityScanActive(signal, deadline);
        hash.update(chunk);
      }
    } else throw new Error("The Lean environment contains an unsupported filesystem entry.");
  }
}

function requireIntegrityScanActive(signal: AbortSignal | undefined, deadline: number): void {
  if (signal?.aborted) throw new Error("The Lean integrity check was cancelled.");
  if (Date.now() > deadline) throw new Error("The Lean integrity check exceeded 60 seconds.");
}

async function copySeedToWritableRegistry(source: string, destination: string): Promise<void> {
  await cp(source, destination, { recursive: true, dereference: false, mode: constants.COPYFILE_FICLONE });
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

async function treeIsImmutable(path: string): Promise<boolean> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (info.mode & 0o222) !== 0) return false;
  if (!info.isDirectory()) return true;
  for (const entry of await readdir(path)) {
    if (!await treeIsImmutable(join(path, entry))) return false;
  }
  return true;
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
