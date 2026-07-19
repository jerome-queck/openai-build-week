import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VerifierEnvironmentRegistry } from "./verifier-environment-registry";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("VerifierEnvironmentRegistry", () => {
  it("stages, activates, removes, and reinstalls without touching learner state", async () => {
    const root = await mkdtemp(join(tmpdir(), "quick-study-registry-"));
    directories.push(root);
    const seed = join(root, "seed");
    const data = join(root, "learner-data");
    await mkdir(seed, { recursive: true });
    await writeFile(join(seed, "marker"), "valid", "utf8");
    await writeFile(join(data, "learning-application.json"), "learner state", { encoding: "utf8", flag: "wx" }).catch(async () => {
      await mkdir(data, { recursive: true });
      await writeFile(join(data, "learning-application.json"), "learner state", "utf8");
    });
    const validate = async (candidate: string) => {
      if (await readFile(join(candidate, "marker"), "utf8") !== "valid") throw new Error("invalid");
    };
    const registry = new VerifierEnvironmentRegistry(data, seed, validate);

    expect(await registry.ensureDefaultInstalled()).toMatchObject({ installed: true, ready: true });
    expect(await registry.remove()).toMatchObject({ installed: false, ready: false });
    expect(await readFile(join(data, "learning-application.json"), "utf8")).toBe("learner state");
    expect(await registry.ensureDefaultInstalled()).toMatchObject({ installed: false });
    expect(await registry.install()).toMatchObject({ installed: true, ready: true });
  });
});
