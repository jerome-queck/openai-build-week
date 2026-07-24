import { useState, type FormEvent } from "react";
import type {
  EvidenceTransferContext,
  LearningApplicationState,
  LearningSession,
  LearnerAction,
  LearnerModelLedgerEntry
} from "../../shared/learning-application";

export function LearnerModelLedger({ state, session, onState }: {
  state: LearningApplicationState;
  session: LearningSession | null;
  onState(state: LearningApplicationState): void;
}) {
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const submit = async (action: LearnerAction) => {
    setError(null);
    try {
      onState(await window.clarifold.submit(action));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Learner Model could not be updated.");
    }
  };
  const correct = (event: FormEvent, entry: LearnerModelLedgerEntry) => {
    event.preventDefault();
    void submit({
      type: "correctLearnerModelInference",
      entryId: entry.id,
      correction: corrections[entry.id] ?? ""
    });
  };

  return (
    <section className="learner-model-ledger" aria-labelledby="learner-model-ledger-title">
      <div className="card-heading">
        <div><p className="eyebrow">Inspectable adaptation</p><h2 id="learner-model-ledger-title">Learner Model Ledger</h2></div>
        <span className="saved">Saved locally</span>
      </div>
      <p className="subtle">Inference governance changes future adaptation without rewriting historical Session Records.</p>
      <label className="confirmation-preference">
        <input type="checkbox" checked={state.learnerModel.adaptiveReuseEnabled}
          onChange={(event) => void submit({ type: "setAdaptiveReusePreference", enabled: event.target.checked })} />
        Allow qualified Learner Model reuse across Learning Sessions
      </label>
      <small>Evidence Transfer is reserved for matched Understanding Evidence from another Study Mission or Study Workspace. Prior-session evidence and Interaction Preferences remain separately identified.</small>
      {session && <label className="confirmation-preference">
        <input type="checkbox" checked={session.ignoreLearnerModel}
          onChange={(event) => void submit({ type: "setSessionLearnerModelIgnored", ignored: event.target.checked })} />
        Ignore the Learner Model for this Learning Session
      </label>}

      {session && session.evidenceTransfers.length > 0 && <section aria-label="Evidence Transfers for this Learning Session">
        <h3>Evidence Transfers</h3>
        <ul className="learner-model-list">
          {session.evidenceTransfers.map((transfer) => <li key={transfer.id}>
            <strong>{transfer.inference}</strong> · {confidenceLabel(transfer.confidence)}
            <p>Transferred from {transfer.sourceSessionId} · {transfer.provenance.sessionTarget}</p>
            <p>{transfer.provenance.summary}</p>
            <p className="subtle">Provenance-matched; not evidence observed in this Learning Session.</p>
          </li>)}
        </ul>
      </section>}

      {session && session.priorUnderstandingEvidence.length > 0 && <section aria-label="Prior Understanding Evidence for this Learning Session">
        <h3>Prior Understanding Evidence</h3>
        <ul className="learner-model-list">
          {session.priorUnderstandingEvidence.map((evidence) => <li key={evidence.id}>
            <strong>{evidence.inference}</strong> · {confidenceLabel(evidence.confidence)}
            <p>Observed in prior Session {evidence.sourceSessionId} · {evidence.provenance.sessionTarget}</p>
            <p>{evidence.provenance.summary}</p>
            <p className="subtle">Reused within this Study Mission; not Evidence Transfer and not evidence observed in this Learning Session.</p>
          </li>)}
        </ul>
      </section>}

      {session && session.interactionPreferenceReuses.length > 0 && <section aria-label="Reused Interaction Preferences for this Learning Session">
        <h3>Reused Interaction Preferences</h3>
        <ul className="learner-model-list">
          {session.interactionPreferenceReuses.map((preference) => <li key={preference.id}>
            <strong>{preference.inference}</strong> · {confidenceLabel(preference.confidence)}
            <p>Inferred from Session {preference.sourceSessionId} · {preference.provenance.sessionTarget}</p>
            <p>{preference.provenance.summary}</p>
            <p className="subtle">A revisable teaching tendency; not Understanding Evidence or a fixed learning style.</p>
          </li>)}
        </ul>
      </section>}

      {state.learnerModel.entries.length === 0
        ? <p>No active Learner Model inferences are stored.</p>
        : <ul className="learner-model-list" aria-label="Learner Model inferences">
          {state.learnerModel.entries.map((entry) => <li key={entry.id}>
            <article>
              <p><strong>{entry.inference}</strong> · {confidenceLabel(entry.confidence)} · {entry.status}</p>
              <p><strong>Source evidence:</strong> {entry.sourceEvidence.summary}</p>
              <p><strong>Source Session:</strong> {entry.sourceEvidence.sessionId}</p>
              <p><strong>Scope:</strong> {entry.scope.sessionTarget} · workspace {entry.scope.workspaceId} · mission {entry.scope.missionId}</p>
              <ContextSummary context={entry.mathematicalContext} />
              <p><strong>Last update:</strong> {formatTimestamp(entry.lastUpdatedAt)}</p>
              {entry.correction && <p><strong>Learner correction:</strong> {entry.correction}</p>}
              {entry.governanceHistory.length > 0 && <ul aria-label={`Governance history for ${entry.inference}`}>
                {entry.governanceHistory.map((event) => <li key={event.id}>
                  {event.action} at {formatTimestamp(event.at)}{event.note ? `: ${event.note}` : ""}
                </li>)}
              </ul>}
              <form className="evidence-correction" onSubmit={(event) => correct(event, entry)}>
                <label htmlFor={`ledger-correction-${entry.id}`}>Correction for {entry.inference}</label>
                <input id={`ledger-correction-${entry.id}`} value={corrections[entry.id] ?? ""}
                  onChange={(event) => setCorrections((current) => ({ ...current, [entry.id]: event.target.value }))} />
                <button className="secondary" disabled={!(corrections[entry.id] ?? "").trim()}
                  aria-label={`Save correction for ${entry.inference}`}>Save correction</button>
              </form>
              <div className="adaptive-actions">
                <button className="secondary" onClick={() => void submit({ type: "excludeLearnerModelInference", entryId: entry.id })}
                  aria-label={`Exclude ${entry.inference} from adaptation`}>Exclude from adaptation</button>
                <button className="text-button" onClick={() => void submit({ type: "deleteLearnerModelInference", entryId: entry.id })}
                  aria-label={`Delete ${entry.inference} from the Learner Model`}>Delete inference</button>
              </div>
            </article>
          </li>)}
        </ul>}
      <button className="secondary" disabled={state.learnerModel.entries.length === 0}
        onClick={() => void submit({ type: "resetLearnerModel" })}>Reset Learner Model</button>
      {state.learnerModel.lastResetAt && <p className="subtle">Last reset: {formatTimestamp(state.learnerModel.lastResetAt)}</p>}
      {error && <p className="failure-message" role="alert">{error}</p>}
    </section>
  );
}

function ContextSummary({ context }: { context: EvidenceTransferContext }) {
  const relationships = context.prerequisiteRelationships.map(
    (relationship) => `${relationship.prerequisiteConcept} is required for ${relationship.supportsConcept}`
  );
  return <p><strong>Mathematical context:</strong> concepts {context.concepts.join(", ") || "not recorded"}; structures {context.mathematicalStructures.join(", ") || "not recorded"}; prerequisite relationships {relationships.join(", ") || "not recorded"}; task demands {context.taskDemands.join(", ") || "not recorded"}</p>;
}

function confidenceLabel(confidence: LearnerModelLedgerEntry["confidence"]): string {
  return `${confidence[0].toUpperCase()}${confidence.slice(1)} confidence`;
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}
