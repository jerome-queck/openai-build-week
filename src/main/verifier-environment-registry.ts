import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import bundledEnvironment from "../shared/bundled-verifier-environment.json";
import { validVerificationEnvironment, type VerifierEnvironmentStatus } from "../shared/verifier-runtime";

const execFileAsync = promisify(execFile);

interface RegistryMetadata {
  activeEnvironmentId: string | null;
  bundledEnvironmentRemoved: boolean;
}

export class VerifierEnvironmentRegistry {
  private readonly registryRoot: string;
  private readonly metadataPath: string;

  constructor(
    private readonly dataDirectory: string,
    private readonly bundledSeedDirectory: string,
    private readonly validateEnvironment: (root: string) => Promise<void> = validateInstalledEnvironment
  ) {
    this.registryRoot = join(dataDirectory, "verifiers");
    this.metadataPath = join(this.registryRoot, "registry.json");
  }

  environmentDirectory(): string {
    return join(this.registryRoot, bundledEnvironment.id);
  }

  executablePath(): string {
    return join(this.environmentDirectory(), "bin", "lean");
  }

  async ensureDefaultInstalled(): Promise<VerifierEnvironmentStatus> {
    const metadata = await this.readMetadata();
    if (metadata.bundledEnvironmentRemoved) return this.status(false, "Removed by learner. Reinstall it to run new Lean checks.");
    try {
      await this.validateEnvironment(this.environmentDirectory());
      return this.status(true, "Ready for local formal checks.");
    } catch {
      return this.install();
    }
  }

  async install(): Promise<VerifierEnvironmentStatus> {
    await mkdir(this.registryRoot, { recursive: true });
    const staging = join(this.registryRoot, `.${bundledEnvironment.id}.staging-${process.pid}`);
    await rm(staging, { recursive: true, force: true });
    await cp(this.bundledSeedDirectory, staging, { recursive: true, force: false });
    await this.validateEnvironment(staging);
    const active = this.environmentDirectory();
    const backup = `${active}.superseded-${process.pid}`;
    let hadActive = false;
    try {
      await rename(active, backup);
      hadActive = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, active);
    } catch (error) {
      if (hadActive) await rename(backup, active);
      throw error;
    }
    await rm(backup, { recursive: true, force: true });
    await this.writeMetadata({ activeEnvironmentId: bundledEnvironment.id, bundledEnvironmentRemoved: false });
    return this.status(true, "Installed and ready for local formal checks.");
  }

  async remove(): Promise<VerifierEnvironmentStatus> {
    await rm(this.environmentDirectory(), { recursive: true, force: true });
    await this.writeMetadata({ activeEnvironmentId: null, bundledEnvironmentRemoved: true });
    return this.status(false, "Removed. Existing sessions, proof source, and Verifier Manifests are preserved.");
  }

  async getStatus(): Promise<VerifierEnvironmentStatus> {
    const metadata = await this.readMetadata();
    if (metadata.bundledEnvironmentRemoved) return this.status(false, "Removed by learner. Reinstall it to run new Lean checks.");
    try {
      await this.validateEnvironment(this.environmentDirectory());
      return this.status(true, "Ready for local formal checks.");
    } catch {
      return this.status(false, "The bundled Verification Environment is not ready.");
    }
  }

  private status(ready: boolean, diagnostics: string): VerifierEnvironmentStatus {
    return { environmentId: bundledEnvironment.id, installed: ready, ready, diagnostics };
  }

  private async readMetadata(): Promise<RegistryMetadata> {
    try {
      const value = JSON.parse(await readFile(this.metadataPath, "utf8")) as Partial<RegistryMetadata>;
      return {
        activeEnvironmentId: typeof value.activeEnvironmentId === "string" ? value.activeEnvironmentId : null,
        bundledEnvironmentRemoved: value.bundledEnvironmentRemoved === true
      };
    } catch {
      return { activeEnvironmentId: null, bundledEnvironmentRemoved: false };
    }
  }

  private async writeMetadata(metadata: RegistryMetadata): Promise<void> {
    await mkdir(this.registryRoot, { recursive: true });
    const staging = `${this.metadataPath}.tmp`;
    await writeFile(staging, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await rename(staging, this.metadataPath);
  }
}

async function validateInstalledEnvironment(root: string): Promise<void> {
  const value: unknown = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (!validVerificationEnvironment(value)) throw new Error("Installed Verification Environment Manifest is invalid.");
  const executable = join(root, "bin", "lean");
  const version = await execFileAsync(executable, ["--version"], { encoding: "utf8", timeout: 15_000 });
  if (!version.stdout.includes(`version ${value.leanVersion}`)) throw new Error("Installed Lean executable does not match its manifest.");
  await execFileAsync(executable, [join(root, "app-support", "QuickStudyNatAddZero.lean")], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024
  });
}
