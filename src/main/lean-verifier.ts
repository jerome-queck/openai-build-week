import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { boundedProcessEnvironment } from "./bounded-process-environment";
import {
  validRecordedVerificationEnvironment,
  type VerificationEnvironment,
  type VerifierCommandOutcome,
  type VerifierRunRequest,
  type VerifierRunResult,
  type VerifierRuntime
} from "../shared/verifier-runtime";
import { atomicWriteFile } from "../shared/atomic-file";

export interface LeanCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
  timedOut?: boolean;
  cancelled?: boolean;
}

export type LeanCommandExecutor = (
  executable: string,
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal }
) => Promise<LeanCommandResult>;

const executeLean: LeanCommandExecutor = (executable, args, options) => new Promise((resolve, reject) => {
  execFile(executable, args, {
    cwd: dirname(executable),
    env: boundedProcessEnvironment(),
    timeout: options.timeoutMs,
    signal: options.signal,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  }, (error, stdout, stderr) => {
    if (!error) {
      resolve({ stdout, stderr, exitCode: 0, signal: null });
      return;
    }
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals };
    if (failure.code === "ENOENT") {
      reject(failure);
      return;
    }
    resolve({
      stdout: typeof stdout === "string" ? stdout : "",
      stderr: typeof stderr === "string" ? stderr : failure.message,
      exitCode: typeof failure.code === "number" ? failure.code : null,
      signal: failure.signal ?? null,
      timedOut: failure.killed === true && failure.code === null,
      cancelled: failure.name === "AbortError" || options.signal?.aborted === true
    });
  });
});

export class LeanVerifierRuntime implements VerifierRuntime {
  constructor(
    private readonly executablePath: string | ((environmentId?: string) => string),
    private readonly execute: LeanCommandExecutor = executeLean,
    private readonly timeoutMs = 15_000,
    private readonly loadEnvironment: (executablePath: string) => Promise<VerificationEnvironment> = loadEnvironmentBeside,
    private readonly validateInstallation: (signal?: AbortSignal, environmentId?: string) => Promise<void> = async () => undefined,
    private readonly stagingId: () => string = () => crypto.randomUUID()
  ) {}

  async run(request: VerifierRunRequest, signal?: AbortSignal): Promise<VerifierRunResult> {
    const executablePath = typeof this.executablePath === "function" ? this.executablePath(request.environmentId) : this.executablePath;
    await mkdir(request.evidenceDirectory, { recursive: true });
    const evidenceLocation = join(request.evidenceDirectory, `${safeRunId(request.runId)}.lean`);
    await atomicWriteFile(evidenceLocation, request.proofSource, {
      encoding: "utf8", stagingSuffix: ".tmp", uniqueId: this.stagingId
    });
    const command = `${basename(executablePath)} ${basename(evidenceLocation)}`;

    let environment: VerificationEnvironment;
    try {
      environment = await this.loadEnvironment(executablePath);
    } catch (error) {
      return this.result("versionMismatch", usefulError(error), evidenceLocation, command, null);
    }
    try {
      await this.validateInstallation(signal, request.environmentId);
    } catch (error) {
      if (signal?.aborted) return this.result("cancelled", usefulError(error), evidenceLocation, command, environment);
      return this.result("versionMismatch", usefulError(error), evidenceLocation, command, environment);
    }

    let version: LeanCommandResult;
    try {
      version = await this.execute(executablePath, ["--version"], { timeoutMs: this.timeoutMs, signal });
    } catch (error) {
      return this.result("unavailable", usefulError(error), evidenceLocation, command, environment);
    }
    if (!validCommandResult(version)) {
      return this.result("malformedOutput", "Lean returned malformed version output.", evidenceLocation, command, environment);
    }
    if (version.cancelled) return this.result("cancelled", diagnostics(version), evidenceLocation, command, environment);
    if (version.timedOut) return this.result("timedOut", diagnostics(version), evidenceLocation, command, environment);
    if (version.exitCode !== 0) return this.result("unavailable", diagnostics(version), evidenceLocation, command, environment);
    if (!version.stdout.includes(`version ${environment.leanVersion}`)) {
      return this.result(
        "versionMismatch",
        `Expected Lean ${environment.leanVersion}; received ${version.stdout.trim() || "no version"}.`,
        evidenceLocation,
        command,
        environment
      );
    }

    let checked: LeanCommandResult;
    try {
      checked = await this.execute(executablePath, [evidenceLocation], { timeoutMs: this.timeoutMs, signal });
    } catch (error) {
      return this.result("unavailable", usefulError(error), evidenceLocation, command, environment);
    }
    if (!validCommandResult(checked)) {
      return this.result("malformedOutput", "Lean returned malformed command output.", evidenceLocation, command, environment);
    }
    return this.result(outcomeFor(checked), diagnostics(checked), evidenceLocation, command, environment);
  }

  private result(
    outcome: VerifierCommandOutcome,
    diagnosticsText: string,
    evidenceLocation: string,
    command: string,
    environment: VerificationEnvironment | null
  ): VerifierRunResult {
    return {
      outcome,
      diagnostics: diagnosticsText,
      evidenceLocation,
      command,
      environment: environment ?? invalidEnvironmentIdentity()
    };
  }
}

async function loadEnvironmentBeside(executablePath: string): Promise<VerificationEnvironment> {
  const manifestPath = join(dirname(dirname(executablePath)), "manifest.json");
  const value: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!validRecordedVerificationEnvironment(value)) throw new Error("The installed Verification Environment Manifest is invalid or malformed.");
  return value;
}

function invalidEnvironmentIdentity(): VerificationEnvironment {
  return {
    id: "untrusted-environment",
    checker: "Lean",
    leanVersion: "unknown",
    mathlibVersion: "unknown",
    mathlibCommit: "unknown",
    platform: process.platform,
    architecture: process.arch,
    sourceArchive: "unknown",
    sourceSha256: "unknown",
    supportProfile: "unknown",
    mathlibModules: [],
    runtimeFormat: 0
  };
}

function outcomeFor(result: LeanCommandResult): VerifierCommandOutcome {
  if (result.cancelled) return "cancelled";
  if (result.timedOut) return "timedOut";
  if (result.signal) return "crashed";
  return result.exitCode === 0 ? "accepted" : "rejected";
}

function diagnostics(result: LeanCommandResult): string {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n") || "Lean completed without diagnostics.";
}

function validCommandResult(value: unknown): value is LeanCommandResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<LeanCommandResult>;
  return typeof result.stdout === "string" && typeof result.stderr === "string"
    && (typeof result.exitCode === "number" || result.exitCode === null)
    && (typeof result.signal === "string" || result.signal === null);
}

function safeRunId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(normalized)) throw new Error("Verifier run identifier is invalid.");
  return normalized;
}

function usefulError(error: unknown): string {
  return error instanceof Error ? error.message : "Lean could not be launched.";
}
