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
  environmentId?: string;
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
  environments?: VerifierEnvironmentInstallation[];
  activeEnvironmentId?: string | null;
}

export interface VerifierEnvironmentInstallation {
  environment: Readonly<VerificationEnvironment>;
  installedBytes: number;
}

export interface VerifierEnvironmentManager {
  inspect(): Promise<VerifierEnvironmentInspection>;
  prepareInstalledIntegrity?(signal?: AbortSignal, environmentId?: string): Promise<void>;
  remove(environmentId?: string): Promise<{ removedLogicalBytes: number }>;
  install(signal?: AbortSignal): Promise<{ installedBytes: number; environment?: Readonly<VerificationEnvironment> }>;
  activate?(environmentId: string, signal?: AbortSignal): Promise<void>;
  cleanup(environmentIds?: string[]): Promise<{ installed: boolean; installedBytes: number }>;
}

const KNOWN_CLAIM = "For every natural number n, n + 0 = n.";

export function formalizationForClaim(exactClaim: string): Formalization | null {
  if (exactClaim.trim() !== KNOWN_CLAIM) return null;
  return {
    exactClaim: KNOWN_CLAIM,
    formalStatement: "theorem quickStudyNatAddZero (n : Nat) : n + 0 = n",
    assumptions: ["n : Nat"],
    proofSource: "theorem quickStudyNatAddZero (n : Nat) : n + 0 = n := by\n  rfl\n"
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

export function validRecordedVerificationEnvironment(value: unknown): value is VerificationEnvironment {
  if (!value || typeof value !== "object") return false;
  const environment = value as Record<string, unknown>;
  return ["id", "checker", "leanVersion", "mathlibVersion", "mathlibCommit", "platform", "architecture", "sourceArchive",
    "sourceSha256", "supportProfile"].every((key) => typeof environment[key] === "string" && Boolean(String(environment[key]).trim()))
    && Array.isArray(environment.mathlibModules) && environment.mathlibModules.every((module) => typeof module === "string")
    && typeof environment.runtimeFormat === "number" && Number.isFinite(environment.runtimeFormat);
}
