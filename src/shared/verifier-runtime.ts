import bundledEnvironment from "./bundled-verifier-environment.json";

export interface VerificationEnvironment {
  id: string;
  checker: string;
  leanVersion: string;
  mathlibVersion: string;
  mathlibCommit: string;
  platform: string;
  architecture: string;
  sourceArchive: string;
  sourceSha256: string;
  supportProfile: string;
  mathlibModules: string[];
  runtimeFormat: number;
}

const { releases: _releases, ...environmentIdentity } = bundledEnvironment;

export const BUNDLED_LEAN_ENVIRONMENT: Readonly<VerificationEnvironment> = Object.freeze({
  ...environmentIdentity,
  architecture: "platform-specific",
  sourceArchive: "recorded by installed runtime",
  sourceSha256: "recorded by installed runtime"
});

export interface Formalization {
  exactClaim: string;
  formalStatement: string;
  assumptions: string[];
  proofSource: string;
}

export interface VerifierRunRequest extends Formalization {
  runId: string;
  evidenceDirectory: string;
}

export type VerifierCommandOutcome = "accepted" | "rejected" | "timedOut" | "cancelled"
  | "unsupported" | "unavailable" | "crashed" | "malformedOutput" | "versionMismatch";

export interface VerifierRunResult {
  outcome: VerifierCommandOutcome;
  diagnostics: string;
  evidenceLocation: string;
  command: string;
  environment: Readonly<VerificationEnvironment>;
}

export interface VerifierRuntime {
  run(request: VerifierRunRequest, signal?: AbortSignal): Promise<VerifierRunResult>;
}

export interface VerifierEnvironmentInspection {
  installed: boolean;
  installedBytes: number;
  cleanupRequired: boolean;
}

export interface VerifierEnvironmentManager {
  inspect(): Promise<VerifierEnvironmentInspection>;
  remove(): Promise<{ reclaimedBytes: number }>;
  install(): Promise<{ installedBytes: number }>;
  cleanup(): Promise<{ installed: boolean; installedBytes: number }>;
}

const KNOWN_CLAIM = "For every natural number n, n + 0 = n.";

export function formalizationForClaim(exactClaim: string): Formalization | null {
  if (exactClaim.trim() !== KNOWN_CLAIM) return null;
  return {
    exactClaim: KNOWN_CLAIM,
    formalStatement: "theorem quickStudyNatAddZero (n : Nat) : n + 0 = n",
    assumptions: ["n : Nat"],
    proofSource: "import Mathlib.Data.Nat.Basic\n\ntheorem quickStudyNatAddZero (n : Nat) : n + 0 = n := by\n  simpa using Nat.add_zero n\n"
  };
}

export function validVerificationEnvironment(value: unknown): value is VerificationEnvironment {
  if (!value || typeof value !== "object") return false;
  const environment = value as Record<string, unknown>;
  const architecture = environment.architecture;
  const release = architecture === "arm64" ? bundledEnvironment.releases.arm64
    : architecture === "x64" ? bundledEnvironment.releases.x64 : null;
  return environment.id === bundledEnvironment.id
    && environment.checker === bundledEnvironment.checker
    && environment.leanVersion === bundledEnvironment.leanVersion
    && environment.mathlibVersion === bundledEnvironment.mathlibVersion
    && environment.mathlibCommit === bundledEnvironment.mathlibCommit
    && environment.platform === bundledEnvironment.platform
    && release !== null
    && environment.sourceArchive === release.archive
    && environment.sourceSha256 === release.sha256
    && environment.supportProfile === bundledEnvironment.supportProfile
    && Array.isArray(environment.mathlibModules)
    && environment.mathlibModules.length === bundledEnvironment.mathlibModules.length
    && environment.mathlibModules.every((module, index) => module === bundledEnvironment.mathlibModules[index])
    && environment.runtimeFormat === bundledEnvironment.runtimeFormat;
}
