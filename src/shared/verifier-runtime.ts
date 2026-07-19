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
  runtimeFormat: number;
}

const { releases: _releases, ...environmentIdentity } = bundledEnvironment;

export const BUNDLED_LEAN_ENVIRONMENT: Readonly<VerificationEnvironment> = Object.freeze({
  ...environmentIdentity,
  architecture: "platform-specific",
  sourceArchive: "recorded by installed runtime",
  sourceSha256: "recorded by installed runtime"
});

export interface VerifierEnvironmentStatus {
  environmentId: string;
  installed: boolean;
  ready: boolean;
  diagnostics: string;
}

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
  return environment.id === bundledEnvironment.id
    && environment.checker === bundledEnvironment.checker
    && environment.leanVersion === bundledEnvironment.leanVersion
    && environment.mathlibVersion === bundledEnvironment.mathlibVersion
    && environment.mathlibCommit === bundledEnvironment.mathlibCommit
    && environment.platform === bundledEnvironment.platform
    && (environment.architecture === "arm64" || environment.architecture === "x64")
    && typeof environment.sourceArchive === "string"
    && typeof environment.sourceSha256 === "string" && /^[a-f0-9]{64}$/.test(environment.sourceSha256)
    && environment.supportProfile === bundledEnvironment.supportProfile
    && environment.runtimeFormat === bundledEnvironment.runtimeFormat;
}
