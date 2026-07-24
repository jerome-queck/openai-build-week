import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("beta report publication", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("bundles evidence outside Git without changing the exact attested candidate", async () => {
    const repository = await mkdtemp(join(tmpdir(), "quick-study-beta-report-"));
    temporaryDirectories.push(repository);
    await mkdir(join(repository, "test-results", "release-quality-gate"), { recursive: true });
    await mkdir(join(repository, "test-results", "release-evidence"), { recursive: true });
    await mkdir(join(repository, "out", "make", "zip", "darwin", "arm64"), { recursive: true });
    await writeFile(join(repository, ".gitignore"), "out/\ntest-results/\nevaluation/\n", "utf8");
    await writeJson(join(repository, "package.json"), { version: "0.2.0" });
    git(repository, ["init"]);
    git(repository, ["config", "user.name", "Release Test"]);
    git(repository, ["config", "user.email", "release-test@example.com"]);
    git(repository, ["add", ".gitignore", "package.json"]);
    git(repository, ["commit", "-m", "test candidate"]);
    const candidateCommit = git(repository, ["rev-parse", "HEAD"]).trim();
    const reportDirectory = join(repository, "test-results", "release-quality-gate");
    const evidenceDirectory = join(repository, "test-results", "release-evidence");
    await writeFile(join(reportDirectory, "macos-beta-0.2.0.md"), `# Candidate ${candidateCommit}\n`, "utf8");
    await writeJson(join(reportDirectory, "macos-beta-0.2.0.json"), {
      decision: "pass", benchmarkVersion: "2.0.0", release: { id: "macos-beta-0.2.0", commit: candidateCommit }
    });
    const betaArchivePath = join(repository, "out", "make", "zip", "darwin", "arm64", "Clarifold.zip");
    await writeFile(betaArchivePath, "signed beta archive", "utf8");
    const betaPath = join(repository, "test-results", "beta-install.json");
    await writeJson(betaPath, {
      candidateCommit, architecture: "arm64", artifact: "Clarifold.zip", sha256: await digest(betaArchivePath)
    });
    const modelPath = join(evidenceDirectory, "model-responses.json");
    const verdictPath = join(evidenceDirectory, "blinded-verdicts.json");
    const recoveryPath = join(evidenceDirectory, "recovery-verdicts.json");
    await writeJson(modelPath, { provenance: { candidateCommit } });
    await writeJson(verdictPath, { candidateCommit });
    await writeJson(recoveryPath, { candidateCommit });
    const rawRecoveryPath = join(evidenceDirectory, "recovery-vitest.json");
    await writeJson(rawRecoveryPath, { success: true });
    const recoveryPolicyPath = join(repository, "evaluation", "benchmarks", "v2", "recovery-evidence.json");
    await mkdir(join(repository, "evaluation", "benchmarks", "v2"), { recursive: true });
    await writeJson(recoveryPolicyPath, { schemaVersion: 1, scenarios: [] });
    await writeJson(join(reportDirectory, "evidence.json"), {
      release: { commit: candidateCommit },
      provenance: {
        inputAssets: await Promise.all([
          ["installed-beta", betaPath], ["model-responses", modelPath], ["blinded-verdicts", verdictPath],
          ["recovery-verdicts", recoveryPath], ["recovery-vitest", rawRecoveryPath],
          ["recovery-policy", recoveryPolicyPath]
        ].map(async ([role, path]) => ({ role, name: path.split("/").at(-1), sha256: await digest(path) })))
      }
    });

    execFileSync(process.execPath, [join(process.cwd(), "scripts", "publish-beta-release-report.mjs")], {
      cwd: repository,
      env: {
        ...process.env,
        CLARIFOLD_MODEL_EVIDENCE: modelPath,
        CLARIFOLD_EVALUATOR_VERDICTS: verdictPath,
        CLARIFOLD_RECOVERY_EVIDENCE: recoveryPath
      }
    });

    const manifest = JSON.parse(await readFile(
      join(repository, "out", "release", "macos-beta-0.2.0", "manifest.json"), "utf8"
    ));
    expect(manifest.release.commit).toBe(candidateCommit);
    expect(manifest.decision).toBe("pass");
    expect(manifest.files.map((file: { name: string }) => file.name)).toContain("recovery-vitest.json");
    expect(manifest.distributable).toEqual({
      name: "Clarifold.zip", sha256: await digest(betaArchivePath)
    });
    expect(git(repository, ["rev-parse", "HEAD"]).trim()).toBe(candidateCommit);
    expect(git(repository, ["status", "--porcelain"]).trim()).toBe("");

    await rm(join(repository, "out", "release", "macos-beta-0.2.0"), { recursive: true });
    await writeJson(modelPath, { provenance: { candidateCommit }, substitutedAfterGate: true });
    expect(() => execFileSync(process.execPath, [join(process.cwd(), "scripts", "publish-beta-release-report.mjs")], {
      cwd: repository,
      env: {
        ...process.env,
        CLARIFOLD_MODEL_EVIDENCE: modelPath,
        CLARIFOLD_EVALUATOR_VERDICTS: verdictPath,
        CLARIFOLD_RECOVERY_EVIDENCE: recoveryPath
      },
      stdio: "pipe"
    })).toThrow(/not the exact input used by the passing candidate gate/);
  });
});

function git(repository: string, args: string[]): string {
  return execFileSync("/usr/bin/git", args, { cwd: repository, encoding: "utf8" });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function digest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
