import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUNDLED_LEAN_ENVIRONMENT, formalizationForClaim, validVerificationEnvironment } from "../shared/verifier-runtime";
import { LeanVerifierRuntime, type LeanCommandExecutor } from "./lean-verifier";

const directories: string[] = [];
const installedEnvironment = {
  ...BUNDLED_LEAN_ENVIRONMENT,
  architecture: "arm64",
  sourceArchive: "lean-4.29.1-darwin_aarch64.zip",
  sourceSha256: "c15284adf88ad830c71775b9828cb81f49f7f262cbe1456b25d935855bd70975"
};
const runtime = (execute: LeanCommandExecutor, stagingId: () => string = () => crypto.randomUUID()) => new LeanVerifierRuntime(
  "/bundle/bin/lean", execute, 15_000, async () => installedEnvironment, async () => undefined, stagingId
);

afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function request() {
  const evidenceDirectory = await mkdtemp(join(tmpdir(), "quick-study-lean-test-"));
  directories.push(evidenceDirectory);
  return {
    runId: "run-1",
    evidenceDirectory,
    ...formalizationForClaim("For every natural number n, n + 0 = n.")!
  };
}

function scripted(...results: Array<Awaited<ReturnType<LeanCommandExecutor>>>): LeanCommandExecutor {
  return async () => {
    const result = results.shift();
    if (!result) throw new Error("Unexpected Lean invocation.");
    return result;
  };
}

describe("LeanVerifierRuntime", () => {
  it("leaves an unsupported exact claim without an invented formal translation", () => {
    expect(formalizationForClaim("Every continuous function is differentiable.")).toBeNull();
  });

  it("accepts an exact statement with the pinned bundled version and preserves its proof evidence", async () => {
    const verifier = runtime(scripted(
      { stdout: "Lean (version 4.29.1, aarch64-apple-darwin)", stderr: "", exitCode: 0, signal: null },
      { stdout: "", stderr: "", exitCode: 0, signal: null }
    ));

    const result = await verifier.run(await request());

    expect(result).toMatchObject({ outcome: "accepted", environment: installedEnvironment });
    expect(await readFile(result.evidenceLocation, "utf8")).toContain("theorem quickStudyNatAddZero");
  });

  it("fails safely without deleting an exact verifier staging symlink", async () => {
    const verificationRequest = await request();
    const outsidePath = join(verificationRequest.evidenceDirectory, "must-remain-unchanged");
    const stagingPath = join(verificationRequest.evidenceDirectory, "run-1.lean.collision.tmp");
    await writeFile(outsidePath, "unrelated content", "utf8");
    await symlink(outsidePath, stagingPath);
    const verifier = runtime(scripted(
      { stdout: "Lean (version 4.29.1, aarch64-apple-darwin)", stderr: "", exitCode: 0, signal: null },
      { stdout: "", stderr: "", exitCode: 0, signal: null }
    ), () => "collision");

    await expect(verifier.run(verificationRequest)).rejects.toMatchObject({ code: "EEXIST" });

    expect(await readFile(outsidePath, "utf8")).toBe("unrelated content");
    expect((await lstat(stagingPath)).isSymbolicLink()).toBe(true);
  });

  it.each([
    ["rejection", { stdout: "", stderr: "type mismatch", exitCode: 1, signal: null }, "rejected"],
    ["timeout", { stdout: "", stderr: "timed out", exitCode: null, signal: "SIGTERM", timedOut: true }, "timedOut"],
    ["cancellation", { stdout: "", stderr: "cancelled", exitCode: null, signal: "SIGTERM", cancelled: true }, "cancelled"],
    ["tool crash", { stdout: "", stderr: "segmentation fault", exitCode: null, signal: "SIGSEGV" }, "crashed"]
  ] as const)("reports %s without treating it as mathematical disproof", async (_label, commandResult, outcome) => {
    const verifier = runtime(scripted(
      { stdout: "Lean (version 4.29.1, aarch64-apple-darwin)", stderr: "", exitCode: 0, signal: null },
      commandResult
    ));
    expect(await verifier.run(await request())).toMatchObject({ outcome, diagnostics: expect.any(String) });
  });

  it("reports an unavailable checker", async () => {
    const verifier = new LeanVerifierRuntime("/missing/lean", async () => {
      const error = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
      throw error;
    }, 15_000, async () => installedEnvironment);
    expect(await verifier.run(await request())).toMatchObject({ outcome: "unavailable" });
  });

  it("rejects malformed command output", async () => {
    const verifier = runtime(async () => ({ stdout: 42 } as never));
    expect(await verifier.run(await request())).toMatchObject({ outcome: "malformedOutput" });
  });

  it("refuses a different Lean version before checking the proof", async () => {
    const verifier = runtime(scripted(
      { stdout: "Lean (version 4.28.0, aarch64-apple-darwin)", stderr: "", exitCode: 0, signal: null }
    ));
    expect(await verifier.run(await request())).toMatchObject({ outcome: "versionMismatch" });
  });

  it("refuses to attribute a check to a missing or invalid environment manifest", async () => {
    const verifier = new LeanVerifierRuntime("/bundle/bin/lean", scripted(
      { stdout: "Lean (version 4.29.1, aarch64-apple-darwin)", stderr: "", exitCode: 0, signal: null }
    ), 15_000, async () => { throw new Error("invalid manifest"); });

    expect(await verifier.run(await request())).toMatchObject({
      outcome: "versionMismatch",
      environment: { id: "untrusted-environment" }
    });
  });

  it("refuses to execute when installed content no longer matches the signed payload", async () => {
    const verifier = new LeanVerifierRuntime(
      "/bundle/bin/lean",
      async () => { throw new Error("Lean must not execute after an integrity failure."); },
      15_000,
      async () => installedEnvironment,
      async () => { throw new Error("Installed content differs from the signed payload."); }
    );

    expect(await verifier.run(await request())).toMatchObject({
      outcome: "versionMismatch",
      diagnostics: "Installed content differs from the signed payload."
    });
  });

  it("requires the architecture-specific pinned archive digest in the environment identity", () => {
    expect(validVerificationEnvironment({ ...installedEnvironment, sourceSha256: "0".repeat(64) })).toBe(false);
    expect(validVerificationEnvironment(installedEnvironment)).toBe(true);
  });
});
