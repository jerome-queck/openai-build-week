import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import bundledEnvironment from "../shared/bundled-verifier-environment.json";
import { LeanEnvironmentManager } from "./lean-environment-manager";

describe("LeanEnvironmentManager", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(async (path) => {
      await makeWritable(path);
      await rm(path, { recursive: true, force: true });
    }));
  });

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "quick-study-lean-manager-"));
    directories.push(root);
    const seed = join(root, "seed", bundledEnvironment.id);
    const registry = join(root, "registry");
    await mkdir(join(seed, "bin"), { recursive: true });
    await writeFile(join(seed, "bin", "lean"), "fixture executable", "utf8");
    await writeFile(join(seed, "manifest.json"), JSON.stringify({
      ...bundledEnvironment,
      releases: undefined,
      architecture: process.arch,
      sourceArchive: bundledEnvironment.releases[process.arch as "arm64" | "x64"].archive,
      sourceSha256: bundledEnvironment.releases[process.arch as "arm64" | "x64"].sha256,
      components: ["fixture"]
    }), "utf8");
    await chmod(join(seed, "bin", "lean"), 0o555);
    await chmod(join(seed, "manifest.json"), 0o444);
    await chmod(join(seed, "bin"), 0o555);
    await chmod(seed, 0o555);
    return {
      root, seedRoot: join(root, "seed"), registry,
      manager: new LeanEnvironmentManager(registry, join(root, "seed"), async () => undefined)
    };
  }

  it("installs through staging, reports storage, removes the active environment, and reinstalls it", async () => {
    const { registry, manager } = await fixture();
    expect(await manager.inspect()).toEqual({ installed: false, installedBytes: 0, cleanupRequired: false });
    expect(await manager.defaultInstallationNeeded()).toBe(true);

    const installed = await manager.install();

    expect(installed.installedBytes).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(join(registry, bundledEnvironment.id, "manifest.json"), "utf8"))).toMatchObject({
      id: bundledEnvironment.id,
      leanVersion: bundledEnvironment.leanVersion
    });
    expect(await manager.inspect()).toEqual({
      installed: true, installedBytes: installed.installedBytes, cleanupRequired: false
    });
    expect(await manager.defaultInstallationNeeded()).toBe(false);

    const removed = await manager.remove();
    expect(removed.reclaimedBytes).toBe(installed.installedBytes);
    expect(await manager.inspect()).toEqual({ installed: false, installedBytes: 0, cleanupRequired: false });
    expect(await manager.defaultInstallationNeeded()).toBe(false);

    await manager.install();
    expect((await manager.inspect()).installed).toBe(true);
  });

  it("reports and cleans interrupted staging without activating a half-installed checker", async () => {
    const { registry, manager } = await fixture();
    await mkdir(join(registry, `.${bundledEnvironment.id}.installing-interrupted`), { recursive: true });
    await writeFile(join(registry, `.${bundledEnvironment.id}.installing-interrupted`, "partial"), "partial", "utf8");

    expect(await manager.inspect()).toEqual({ installed: false, installedBytes: 0, cleanupRequired: true });
    expect(await manager.cleanup()).toEqual({ installed: false, installedBytes: 0 });
    expect(await manager.inspect()).toEqual({ installed: false, installedBytes: 0, cleanupRequired: false });
  });

  it("keeps a failed validation in inactive staging for explicit cleanup", async () => {
    const { registry, seedRoot } = await fixture();
    const manager = new LeanEnvironmentManager(registry, seedRoot, async () => {
      throw new Error("Reference proof was rejected.");
    });

    await expect(manager.install()).rejects.toThrow("Reference proof was rejected");
    expect(await manager.inspect()).toEqual({ installed: false, installedBytes: 0, cleanupRequired: true });
  });
});

async function makeWritable(path: string): Promise<void> {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await makeWritable(child);
    else await chmod(child, 0o600);
  }
}
