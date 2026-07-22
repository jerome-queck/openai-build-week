import {
  claimCheckMethodLabel,
  claimCheckOutcomeLabel,
  claimEvidenceReferenceLabel,
  claimOriginLabel,
  verificationCurrencyLabel,
  verificationLevelLabel,
  type ClaimVerificationState,
  type VerifierEnvironmentState,
  type VerifierManifest
} from "../../shared/learning-application";
import { formalizationForClaim } from "../../shared/verifier-runtime";
import { useState } from "react";

export interface ClaimTrustRevision {
  claims?: ClaimVerificationState[];
}

export function ClaimTrust({ revision, revisionId, verifierManifests = [], verifierEnvironmentStatus = "installed", onVerify, onCancel,
  onReasoningRecheck, onCancelReasoningRecheck }: {
  revision: ClaimTrustRevision;
  revisionId?: string;
  verifierManifests?: VerifierManifest[];
  verifierEnvironmentStatus?: VerifierEnvironmentState["status"];
  onVerify?: (claimId: string, runId: string) => Promise<void>;
  onCancel?: (runId: string) => Promise<void>;
  onReasoningRecheck?: (claimId: string) => Promise<void>;
  onCancelReasoningRecheck?: () => Promise<void>;
}) {
  const claims = revision.claims ?? [];
  const [runningClaimId, setRunningClaimId] = useState<string | null>(null);
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recheckingClaimId, setRecheckingClaimId] = useState<string | null>(null);
  const verifierAvailable = verifierEnvironmentStatus === "installed";
  const verify = async (claimId: string) => {
    if (!onVerify) return;
    setError(null);
    const runId = crypto.randomUUID();
    setRunningClaimId(claimId);
    setRunningRunId(runId);
    try {
      await onVerify(claimId, runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The formal check could not be started.");
    } finally {
      setRunningClaimId(null);
      setRunningRunId(null);
    }
  };
  const recheck = async (claimId: string) => {
    if (!onReasoningRecheck) return;
    setError(null);
    setRecheckingClaimId(claimId);
    try {
      await onReasoningRecheck(claimId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The targeted reasoning recheck could not be completed.");
    } finally {
      setRecheckingClaimId(null);
    }
  };
  return (
    <section className="claim-trust" aria-label="Claim provenance and verification">
      {claims.map((claim, index) => {
        const formalization = formalizationForClaim(claim.claimStatement);
        const manifests = verifierManifests.filter((manifest) => manifest.claimId === claim.claimId
          && (!revisionId || manifest.claimRevisionId === revisionId));
        return <article aria-label={`Mathematical claim ${index + 1}`} key={claim.claimId}>
      <dl className="artifact-evidence">
        <div><dt>Claim Origin</dt><dd>{claimOriginLabel(claim.claimOrigin)}</dd></div>
        <div><dt>Verification Level</dt><dd>{verificationLevelLabel(claim.verificationLevel)}</dd></div>
        <div><dt>Verification Currency</dt><dd>{verificationCurrencyLabel(claim.verificationCurrency)}</dd></div>
      </dl>
      <p className="claim-statement"><strong>Exact claim:</strong> {claim.claimStatement}</p>
      {claim.claimOriginReferences.length > 0 && <p className="record-link">Origin evidence: {
        claim.claimOriginReferences.map(claimEvidenceReferenceLabel).join(" · ")
      }</p>}
      {claim.verificationEvidence.length > 0 && <details className="verification-evidence">
        <summary>Verification evidence</summary>
        <ol>{claim.verificationEvidence.map((item) => <li key={item.id}>
          <p><strong>{claimCheckMethodLabel(item.method)}</strong> · {claimCheckOutcomeLabel(item.outcome)} · {verificationCurrencyLabel(item.currency)}</p>
          <p>{item.summary}</p>
          <p className="record-link">{claimEvidenceReferenceLabel(item.reference)}</p>
          {item.limitation && <p className="subtle">{item.limitation}</p>}
          {item.changedBecause && <p className="subtle">Changed because: {item.changedBecause}</p>}
        </li>)}</ol>
      </details>}
      {claim.verificationGaps.map((gap) => <div className="verification-gap" role="alert" aria-label="Verification Gap" key={gap.id}>
        <strong>Verification Gap</strong>
        <p>{gap.reason}</p>
        <p>Affected conclusion: {gap.affectedConclusion}</p>
      </div>)}
      {claim.verificationEscalation.recommended && <div className="verification-escalation" role="status" aria-label="Verification Escalation">
        <strong>Verification Escalation recommended</strong>
        <ul>{claim.verificationEscalation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </div>}
      {claim.verificationCurrency === "changedSinceCheck" && onReasoningRecheck && <section
        aria-label={`Targeted recheck for mathematical claim ${index + 1}`}>
        <p className="subtle">This exact revised claim needs fresh evidence. A reasoning recheck is separate from source, corroboration, and formal checks.</p>
        <button type="button" className="secondary" disabled={recheckingClaimId !== null}
          onClick={() => void recheck(claim.claimId)}>
          {recheckingClaimId === claim.claimId ? "Rechecking exact claim…" : "Request targeted reasoning recheck"}
        </button>
        {recheckingClaimId === claim.claimId && onCancelReasoningRecheck && <button type="button" className="secondary"
          onClick={() => void onCancelReasoningRecheck()}>Stop targeted reasoning recheck</button>}
      </section>}
      <section className="formalization-preview" aria-label={`Formalization for mathematical claim ${index + 1}`}>
        <h3>Exact formal statement</h3>
        {formalization ? <>
          <pre>{formalization.formalStatement}</pre>
          <p><strong>Assumptions:</strong> {formalization.assumptions.join(", ")}</p>
          <p className="subtle">A successful run applies only to this exact formal statement, not the surrounding explanation or unformalized steps.</p>
        </> : <p className="subtle">No supported formal translation exists for this exact claim. Recording the attempt will preserve an inspectable unsupported outcome.</p>}
        {onVerify && <button className="secondary" disabled={runningClaimId !== null || !verifierAvailable}
          aria-label={`Check exact claim ${index + 1} with bundled Lean`}
          onClick={() => void verify(claim.claimId)}>
          {runningClaimId === claim.claimId ? "Checking with bundled Lean…" : "Check exact claim with bundled Lean"}
        </button>}
        {!verifierAvailable && <p role="status">{verifierUnavailableMessage(verifierEnvironmentStatus)}</p>}
        {!verifierAvailable && <p className="subtle">You can still use reasoning review, source-grounded checking, or independent corroboration.</p>}
        {runningClaimId === claim.claimId && runningRunId && onCancel && <button className="secondary"
          aria-label={`Cancel exact claim ${index + 1} Lean check`}
          onClick={() => void onCancel(runningRunId)}>Cancel Lean check</button>}
      </section>
      {manifests.length > 0 && <details className="verifier-manifests" open>
        <summary>Verifier Manifests</summary>
        {manifests.map((manifest) => <article key={manifest.id} aria-label="Verifier Manifest">
          <dl className="artifact-evidence">
            <div><dt>Command outcome</dt><dd>{manifest.commandOutcome}</dd></div>
            <div><dt>Exact statement status</dt><dd>{manifest.formalStatementVerificationLevel === "formallyVerified" ? "Formally verified" : "Incomplete"}</dd></div>
            <div><dt>Verification Environment</dt><dd>{manifest.environment.id} · Lean {manifest.environment.leanVersion} · mathlib {manifest.environment.mathlibVersion} · {manifest.environment.architecture}</dd></div>
            <div><dt>Formal statement</dt><dd>{manifest.formalStatement ?? "Unsupported translation"}</dd></div>
            <div><dt>Assumptions</dt><dd>{manifest.assumptions.join(", ") || "None recorded"}</dd></div>
            <div><dt>Evidence location</dt><dd>{manifest.evidenceLocation ?? "No proof file was produced"}</dd></div>
          </dl>
          <p>{manifest.diagnostics}</p>
        </article>)}
      </details>}
      </article>})}
      {error && <p className="failure-message" role="alert">{error}</p>}
    </section>
  );
}

function verifierUnavailableMessage(status: VerifierEnvironmentState["status"]): string {
  if (status === "absent") return "Bundled Lean is not installed. Reinstall it in Application settings to run this formal check.";
  if (status === "installing" || status === "removing") {
    return "Bundled Lean is unavailable while the current environment operation completes. Review its status in Application settings.";
  }
  if (status === "preparing") return "Bundled Lean is unavailable until integrity preparation completes; Lean has not been launched.";
  if (status === "integrityFailed") return "Bundled Lean integrity preparation failed. Review diagnostics in Application settings and retry.";
  return "Bundled Lean is unavailable while its environment needs recovery. Use Retry or Clean up in Application settings.";
}
