import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { chmod, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUNDLED_LEAN_ENVIRONMENT,
  validVerificationEnvironment,
  type VerifierEnvironmentInspection,
  type VerifierEnvironmentManager
} from "../shared/verifier-runtime";

export class LeanEnvironmentManager implements VerifierEnvironmentManager {
  private readonly environmentPath: string;
  private readonly seedPath: string;
  private readonly removalMarkerPath: string;

  constructor(
    private readonly registryPath: string,
    seedRegistryPath: string,
    private readonly validate: (environmentPath: string) => Promise<void> = validateReferenceProof
  ) {
    this.environmentPath = join(registryPath, BUNDLED_LEAN_ENVIRONMENT.id);
    this.seedPath = join(seedRegistryPath, BUNDLED_LEAN_ENVIRONMENT.id);
    this.removalMarkerPath = join(registryPath, ".lean-environment-removed");
  }

  executablePath(): string {
    return join(this.environmentPath, "bin", "lean");
  }

  async defaultInstallationNeeded(): Promise<boolean> {
    const inspection = await this.inspect();
    return !inspection.installed && !inspection.cleanupRequired && !await exists(this.removalMarkerPath);
  }

  async inspect(): Promise<VerifierEnvironmentInspection> {
    const entries = await directoryEntries(this.registryPath);
    const interrupted = entries.some((name) => name.startsWith(`.${BUNDLED_LEAN_ENVIRONMENT.id}.installing-`)
      || name.startsWith(`.${BUNDLED_LEAN_ENVIRONMENT.id}.removing-`));
    const installed = await validInstalledEnvironment(this.environmentPath);
    const invalidActive = !installed && entries.includes(BUNDLED_LEAN_ENVIRONMENT.id);
    return {
      installed,
      installedBytes: installed ? await directorySize(this.environmentPath) : 0,
      cleanupRequired: interrupted || invalidActive
    };
  }

  async install(): Promise<{ installedBytes: number }> {
    await mkdir(this.registryPath, { recursive: true });
    const stagingPath = join(this.registryPath, `.${BUNDLED_LEAN_ENVIRONMENT.id}.installing-${randomUUID()}`);
    await copySeedToWritableRegistry(this.seedPath, stagingPath);
    if (!await validInstalledEnvironment(stagingPath)) {
      throw new Error("The staged Lean environment did not match the supported Default Verification Environment.");
    }
    await this.validate(stagingPath);
    const backupPath = join(this.registryPath, `.${BUNDLED_LEAN_ENVIRONMENT.id}.removing-${randomUUID()}`);
    const hadActive = await exists(this.environmentPath);
    if (hadActive) await rename(this.environmentPath, backupPath);
    try {
      await rename(stagingPath, this.environmentPath);
    } catch (error) {
      if (hadActive) await rename(backupPath, this.environmentPath);
      throw error;
    }
    await removeWritableTree(backupPath);
    await rm(this.removalMarkerPath, { force: true });
    return { installedBytes: await directorySize(this.environmentPath) };
  }

  async remove(): Promise<{ reclaimedBytes: number }> {
    if (!await validInstalledEnvironment(this.environmentPath)) {
      throw new Error("The installed Lean environment is missing or invalid; clean it up before retrying.");
    }
    const reclaimedBytes = await directorySize(this.environmentPath);
    const removalPath = join(this.registryPath, `.${BUNDLED_LEAN_ENVIRONMENT.id}.removing-${randomUUID()}`);
    await rename(this.environmentPath, removalPath);
    await writeFile(this.removalMarkerPath, `${BUNDLED_LEAN_ENVIRONMENT.id}\n`, "utf8");
    await removeWritableTree(removalPath);
    return { reclaimedBytes };
  }

  async cleanup(): Promise<{ installed: boolean; installedBytes: number }> {
    for (const name of await directoryEntries(this.registryPath)) {
      if (name.startsWith(`.${BUNDLED_LEAN_ENVIRONMENT.id}.installing-`)
        || name.startsWith(`.${BUNDLED_LEAN_ENVIRONMENT.id}.removing-`)
        || (name === BUNDLED_LEAN_ENVIRONMENT.id && !await validInstalledEnvironment(this.environmentPath))) {
        await removeWritableTree(join(this.registryPath, name));
      }
    }
    const inspection = await this.inspect();
    return { installed: inspection.installed, installedBytes: inspection.installedBytes };
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
  try {
    const manifest: unknown = JSON.parse(await readFile(join(path, "manifest.json"), "utf8"));
    if (!validVerificationEnvironment(manifest)) return false;
    return (await stat(join(path, "bin", "lean"))).isFile();
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
    total += entry.isDirectory() ? await directorySize(child) : (await stat(child)).size;
  }
  return total;
}

async function copySeedToWritableRegistry(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourceChild = join(source, entry.name);
    const destinationChild = join(destination, entry.name);
    if (entry.isDirectory()) await copySeedToWritableRegistry(sourceChild, destinationChild);
    else if (entry.isFile()) {
      await copyFile(sourceChild, destinationChild, constants.COPYFILE_FICLONE);
      await chmod(destinationChild, destinationChild.endsWith(join("bin", "lean")) ? 0o700 : 0o600);
    } else {
      throw new Error(`The bundled Lean environment contains an unsupported filesystem entry: ${entry.name}`);
    }
  }
}

async function removeWritableTree(path: string): Promise<void> {
  if (!await exists(path)) return;
  await makeTreeWritable(path);
  await rm(path, { recursive: true, force: true });
}

async function makeTreeWritable(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isDirectory()) {
    await chmod(path, 0o600);
    return;
  }
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    await makeTreeWritable(join(path, entry.name));
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
