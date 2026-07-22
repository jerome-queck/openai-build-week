import { chmod, link, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import bundledEnvironment from "../shared/bundled-verifier-environment.json";
import {
  LeanEnvironmentManager,
  validateReferenceProof,
  type LeanIntegrityScanner,
  type LeanIntegritySnapshot
} from "./lean-environment-manager";

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
    const { registry, seedRoot, manager } = await fixture();
    expect(await manager.inspect()).toMatchObject({
      installed: false, installedBytes: 0, cleanupRequired: false, activeEnvironmentId: null, environments: []
    });
    expect(await manager.defaultInstallationNeeded()).toBe(true);

    const installed = await manager.install();

    expect(installed.installedBytes).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(join(registry, bundledEnvironment.id, "manifest.json"), "utf8"))).toMatchObject({
      id: bundledEnvironment.id,
      leanVersion: bundledEnvironment.leanVersion
    });
    expect(await manager.inspect()).toMatchObject({
      installed: true, installedBytes: installed.installedBytes, cleanupRequired: false,
      activeEnvironmentId: bundledEnvironment.id,
      environments: [expect.objectContaining({ environment: expect.objectContaining({ id: bundledEnvironment.id }) })]
    });
    expect(await manager.defaultInstallationNeeded()).toBe(false);
    expect((await stat(join(registry, bundledEnvironment.id))).mode & 0o222).toBe(0);
    expect((await stat(join(registry, bundledEnvironment.id, "bin", "lean"))).mode & 0o222).toBe(0);

    const restartedManager = new LeanEnvironmentManager(
      registry, seedRoot, async () => undefined
    );
    expect(await restartedManager.inspect()).toMatchObject({
      installed: true, installedBytes: installed.installedBytes, cleanupRequired: false
    });

    const removed = await manager.remove();
    expect(removed.removedLogicalBytes).toBeGreaterThan(0);
    expect(await manager.inspect()).toMatchObject({
      installed: false, installedBytes: 0, cleanupRequired: false, activeEnvironmentId: null, environments: []
    });
    expect(await manager.defaultInstallationNeeded()).toBe(false);

    await manager.install();
    expect((await manager.inspect()).installed).toBe(true);
  });

  it("rejects staged activation when the supported mathlib dependency cannot resolve", async () => {
    const root = await mkdtemp(join(tmpdir(), "quick-study-lean-validation-"));
    directories.push(root);
    await mkdir(join(root, "bin"), { recursive: true });
    await mkdir(join(root, "app-support"), { recursive: true });
    await writeFile(join(root, "bin", "lean"), [
      "#!/bin/sh",
      "if [ \"$1\" = \"--deps\" ]; then",
      "  echo 'missing Mathlib.Data.Nat.Basic' >&2",
      "  exit 1",
      "fi",
      "exit 0",
      ""
    ].join("\n"), "utf8");
    await chmod(join(root, "bin", "lean"), 0o700);
    await expect(validateReferenceProof(root)).rejects.toThrow(
      /failed mathlib dependency resolution.*missing Mathlib\.Data\.Nat\.Basic/i
    );
  });

  it("reports and cleans interrupted staging without activating a half-installed checker", async () => {
    const { root, registry, manager } = await fixture();
    const interrupted = join(registry, `.${bundledEnvironment.id}.installing-interrupted`);
    const outside = join(root, "outside");
    await mkdir(interrupted, { recursive: true });
    await mkdir(outside);
    await writeFile(join(interrupted, "partial"), "partial", "utf8");
    await writeFile(join(outside, "must-stay-read-only"), "outside", { encoding: "utf8", mode: 0o400 });
    await symlink(outside, join(interrupted, "unsafe-link"));
    await link(join(outside, "must-stay-read-only"), join(interrupted, "unsafe-hard-link"));

    expect(await manager.inspect()).toMatchObject({ installed: false, installedBytes: 0, cleanupRequired: true });
    expect(await manager.cleanup()).toEqual({ installed: false, installedBytes: 0 });
    expect(await manager.inspect()).toMatchObject({ installed: false, installedBytes: 0, cleanupRequired: false, environments: [] });
    expect((await stat(join(outside, "must-stay-read-only"))).mode & 0o222).toBe(0);
  });

  it("keeps a failed validation in inactive staging for explicit cleanup", async () => {
    const { registry, seedRoot } = await fixture();
    let rejectReferenceProof = true;
    const manager = new LeanEnvironmentManager(registry, seedRoot, async () => {
      if (rejectReferenceProof) throw new Error("Reference proof was rejected.");
    });

    await expect(manager.install()).rejects.toThrow("Reference proof was rejected");
    expect(await manager.inspect()).toMatchObject({ installed: false, installedBytes: 0, cleanupRequired: true });
    rejectReferenceProof = false;
    await manager.install();
    expect(await manager.inspect()).toMatchObject({ installed: true, cleanupRequired: false });
  });

  it("leaves a cancelled installation recoverable as interrupted staging", async () => {
    const { registry, seedRoot } = await fixture();
    const controller = new AbortController();
    const manager = new LeanEnvironmentManager(registry, seedRoot, async (_path, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
    });

    await expect(manager.install(controller.signal)).rejects.toThrow("Lean environment operation was cancelled");
    expect(await manager.inspect()).toMatchObject({ installed: false, cleanupRequired: true });
    await expect(manager.cleanup()).resolves.toMatchObject({ installed: false, installedBytes: 0 });
    expect(await manager.inspect()).toMatchObject({ installed: false, cleanupRequired: false });
  });

  it("requires cleanup to repair a valid environment whose size record is missing", async () => {
    const { registry, seedRoot, manager } = await fixture();
    await manager.install();
    await rm(join(registry, `.lean-environment-size-${bundledEnvironment.id}`));

    const restarted = new LeanEnvironmentManager(registry, seedRoot, async () => undefined);
    expect(await restarted.inspect()).toMatchObject({ installed: true, installedBytes: 0, cleanupRequired: true });
    const recovered = await restarted.cleanup();

    expect(recovered.installed).toBe(true);
    expect(recovered.installedBytes).toBeGreaterThan(0);
    expect(await restarted.inspect()).toMatchObject({
      installed: true,
      installedBytes: recovered.installedBytes,
      cleanupRequired: false
    });
  });

  it("preserves removal intent when cleanup finishes an interrupted post-deactivation removal", async () => {
    const { registry, manager } = await fixture();
    await manager.install();
    const interruptedRemoval = join(registry, `.${bundledEnvironment.id}.removing-interrupted`);
    await writeFile(join(registry, ".lean-environment-removed"), `${bundledEnvironment.id}\n`, "utf8");
    await chmod(join(registry, bundledEnvironment.id), 0o700);
    await rename(join(registry, bundledEnvironment.id), interruptedRemoval);

    expect(await manager.inspect()).toMatchObject({ installed: false, cleanupRequired: true });
    await manager.cleanup();
    expect(await manager.defaultInstallationNeeded()).toBe(false);
  });

  it("runs a pre-deactivation removal interruption before traversing the installed payload", async () => {
    const { registry, seedRoot } = await fixture();
    const manager = new LeanEnvironmentManager(registry, seedRoot, async () => undefined, async () => {
      throw new Error("Synthetic removal interruption before deactivation.");
    });
    await manager.install();
    const executable = join(registry, bundledEnvironment.id, "bin", "lean");
    await chmod(executable, 0o700);
    await writeFile(executable, "tampered executable", "utf8");
    await chmod(executable, 0o500);

    await expect(manager.remove()).rejects.toThrow("Synthetic removal interruption before deactivation.");
    await expect(readFile(executable, "utf8")).resolves.toBe("tampered executable");
  });

  it("rejects a read-only installed tree whose content differs from the signed seed", async () => {
    const { registry, manager } = await fixture();
    await manager.install();
    await manager.prepareInstalledIntegrity();
    const executable = join(registry, bundledEnvironment.id, "bin", "lean");
    await chmod(executable, 0o700);
    await writeFile(executable, "tampered executable", "utf8");
    await chmod(executable, 0o500);

    await expect(manager.assertInstalledIntegrity()).rejects.toThrow("changed after readiness preparation");
    await expect(manager.prepareInstalledIntegrity()).rejects.toThrow("does not match the signed application payload");
    expect(await manager.inspect()).toMatchObject({ installed: true, cleanupRequired: false });
  });

  it("defers a deep immutability walk until integrity enforcement", async () => {
    const { registry, seedRoot, manager } = await fixture();
    await manager.install();
    const component = join(registry, bundledEnvironment.id, "component.txt");
    await chmod(join(registry, bundledEnvironment.id), 0o700);
    await writeFile(component, "unexpected mutable component", { encoding: "utf8", mode: 0o600 });
    await chmod(join(registry, bundledEnvironment.id), 0o500);

    const restartedManager = new LeanEnvironmentManager(registry, seedRoot, async () => undefined);
    expect(await restartedManager.inspect()).toMatchObject({ installed: true, cleanupRequired: false });
    await expect(restartedManager.assertInstalledIntegrity()).rejects.toThrow("integrity preparation has not completed");
    await expect(restartedManager.prepareInstalledIntegrity()).rejects.toThrow("contains a writable filesystem entry");
  });

  it("prepares full integrity before readiness and keeps execution checks off the content-scan path", async () => {
    const { registry, seedRoot, manager: installer } = await fixture();
    await installer.install();
    const installed = deferred<LeanIntegritySnapshot>();
    const trusted = deferred<LeanIntegritySnapshot>();
    let metadataDigest = "installed-metadata";
    const scanner: LeanIntegrityScanner = {
      scanTree: async (root) => root.startsWith(registry) ? installed.promise : trusted.promise,
      scanMetadata: async () => metadataDigest
    };
    const events: Array<{ phase: string; status: string; elapsedMs: number }> = [];
    const manager = new LeanEnvironmentManager(
      registry,
      seedRoot,
      async () => undefined,
      async () => undefined,
      { scanner, preparationTimeoutMs: 1_000, executionTimeoutMs: 1_000, observe: (event) => events.push(event) }
    );

    const preparation = manager.prepareInstalledIntegrity();
    await expect(manager.assertInstalledIntegrity()).rejects.toThrow(
      "Lean integrity preparation is still running; Lean was not launched"
    );
    installed.resolve({ contentDigest: "trusted-content", metadataDigest: "installed-metadata" });
    trusted.resolve({ contentDigest: "trusted-content", metadataDigest: "seed-metadata" });
    await expect(preparation).resolves.toBeUndefined();
    await expect(manager.assertInstalledIntegrity()).resolves.toBeUndefined();

    metadataDigest = "changed-metadata";
    await expect(manager.assertInstalledIntegrity()).rejects.toThrow(
      "installed Lean environment changed after readiness preparation; Lean was not launched"
    );
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "installed-content", status: "started" }),
      expect.objectContaining({ phase: "trusted-seed", status: "completed" }),
      expect.objectContaining({ phase: "execution-metadata", status: "completed" })
    ]));
  });

  it("settles a stalled integrity phase at a hard deadline with actionable diagnostics", async () => {
    const { registry, seedRoot, manager: installer } = await fixture();
    await installer.install();
    const scanner: LeanIntegrityScanner = {
      scanTree: async () => await new Promise<LeanIntegritySnapshot>(() => undefined),
      scanMetadata: async () => "metadata"
    };
    const manager = new LeanEnvironmentManager(
      registry,
      seedRoot,
      async () => undefined,
      async () => undefined,
      { scanner, preparationTimeoutMs: 20, executionTimeoutMs: 20 }
    );

    await expect(manager.prepareInstalledIntegrity()).rejects.toThrow(
      /Lean integrity phase (installed-content|trusted-seed) exceeded 20 ms after \d+ ms; Lean was not launched/
    );
  });

  it("aborts the active integrity scanner when preparation is cancelled", async () => {
    const { registry, seedRoot, manager: installer } = await fixture();
    await installer.install();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let scannerObservedCancellation = false;
    const scanner: LeanIntegrityScanner = {
      scanTree: async (_root, signal) => {
        markStarted();
        return await new Promise<LeanIntegritySnapshot>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            scannerObservedCancellation = true;
            reject(new Error("scanner cancelled"));
          }, { once: true });
        });
      },
      scanMetadata: async () => "metadata"
    };
    const manager = new LeanEnvironmentManager(
      registry,
      seedRoot,
      async () => undefined,
      async () => undefined,
      { scanner, preparationTimeoutMs: 1_000 }
    );
    const controller = new AbortController();

    const preparation = manager.prepareInstalledIntegrity(controller.signal);
    await started;
    controller.abort();

    await expect(preparation).rejects.toThrow(/cancelled.*Lean was not launched/);
    expect(scannerObservedCancellation).toBe(true);
  });

  it("aborts the activation metadata check when lifecycle cancellation begins", async () => {
    const { registry, seedRoot, manager: installer } = await fixture();
    await installer.install();
    let markMetadataStarted!: () => void;
    const metadataStarted = new Promise<void>((resolve) => { markMetadataStarted = resolve; });
    let scannerObservedCancellation = false;
    const scanner: LeanIntegrityScanner = {
      scanTree: async () => ({ contentDigest: "trusted-content", metadataDigest: "installed-metadata" }),
      scanMetadata: async (_root, signal) => {
        markMetadataStarted();
        return await new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            scannerObservedCancellation = true;
            reject(new Error("metadata scan cancelled"));
          }, { once: true });
        });
      }
    };
    const manager = new LeanEnvironmentManager(
      registry,
      seedRoot,
      async () => undefined,
      async () => undefined,
      { scanner, preparationTimeoutMs: 1_000, executionTimeoutMs: 1_000 }
    );
    await manager.prepareInstalledIntegrity();
    const controller = new AbortController();

    const activation = manager.activate(bundledEnvironment.id, controller.signal);
    await metadataStarted;
    controller.abort();

    await expect(activation).rejects.toThrow(/execution-metadata was cancelled.*Lean was not launched/);
    expect(scannerObservedCancellation).toBe(true);
  });

  it("does not follow an active-environment symlink while preparing a managed move", async () => {
    const { root, registry, manager } = await fixture();
    const outside = join(root, "outside-environment");
    const active = join(registry, bundledEnvironment.id);
    await mkdir(registry, { recursive: true });
    await mkdir(outside, { mode: 0o500 });
    await symlink(outside, active);

    await expect(manager.install()).rejects.toThrow("unsafe filesystem link");
    expect((await stat(outside)).mode & 0o222).toBe(0);
    await rm(active, { force: true });
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

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
