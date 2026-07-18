import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AnchoredTeachingCard, LearningArtifact } from "../../shared/learning-application";

interface ContextualInspectorProps {
  card: AnchoredTeachingCard;
  artifact: LearningArtifact | null;
  onClose(): void;
  onRevise(instruction: string): Promise<void>;
  onRestore(revisionId: string): Promise<void>;
  onCreateVariant(name: string, instruction: string): Promise<void>;
  onRetry(variantId?: string): Promise<void>;
  onPin(): Promise<void>;
}

export function ContextualInspector({
  card,
  artifact,
  onClose,
  onRevise,
  onRestore,
  onCreateVariant,
  onRetry,
  onPin
}: ContextualInspectorProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [followUp, setFollowUp] = useState("");
  const [variantName, setVariantName] = useState("");
  const [variantInstruction, setVariantInstruction] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isQuestionDraft = card.currentRevision.status === "idle" && card.title.startsWith("Question about");

  useEffect(() => closeRef.current?.focus(), [card.id]);

  const submitRevision = async (event: FormEvent) => {
    event.preventDefault();
    if (!followUp.trim()) return;
    setBusy(true);
    try {
      await onRevise(followUp.trim());
      setFollowUp("");
    } finally {
      setBusy(false);
    }
  };
  const submitVariant = async (event: FormEvent) => {
    event.preventDefault();
    if (!variantName.trim() || !variantInstruction.trim()) return;
    setBusy(true);
    try {
      await onCreateVariant(variantName.trim(), variantInstruction.trim());
      setVariantName("");
      setVariantInstruction("");
    } finally {
      setBusy(false);
    }
  };
  const restore = async (revisionId: string) => {
    setBusy(true);
    try {
      await onRestore(revisionId);
    } finally {
      setBusy(false);
    }
  };
  const pin = async () => {
    setBusy(true);
    try {
      await onPin();
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="contextual-inspector" aria-label={`Contextual Inspector for ${card.title}`}>
      <div className="card-heading">
        <div><p className="eyebrow">Contextual Inspector</p><h2>{card.title}</h2></div>
        <button ref={closeRef} className="text-button" aria-label="Close Contextual Inspector" onClick={onClose}>Close</button>
      </div>
      <section className={`anchored-teaching-card ${card.currentRevision.status}`} aria-label="Current anchored Teaching Card" aria-live="polite">
        <div className="card-heading">
          <h3>Current route</h3>
          <span className="saved">{teachingStatus(card.currentRevision.status)}</span>
        </div>
        {card.currentRevision.content
          ? <p>{card.currentRevision.content}</p>
          : <p className="subtle">{card.currentRevision.status === "streaming" ? "Preparing the anchored explanation…" : "No explanation content yet."}</p>}
        {card.currentRevision.error && <p className="failure-message" role="alert">{card.currentRevision.error}</p>}
        {card.currentRevision.retryable && <button className="secondary" disabled={busy}
          onClick={() => void onRetry()}>Retry anchored Teaching Card</button>}
        {card.currentRevision.contextUsed.length > 0 && <details className="context-used-receipt">
          <summary>Context Used Receipt</summary>
          <p>Context supplied to this Teaching Card:</p>
          <ul>{card.currentRevision.contextUsed.map((context) => <li key={`${context.sourceId}-${context.location}`}>
            <strong>{context.sourceName}</strong> · {context.location}
          </li>)}</ul>
        </details>}
      </section>

      {card.revisions.length > 0 && (
        <section className="teaching-history" aria-label="Teaching Card revision history">
          <button className="secondary" aria-expanded={historyOpen} onClick={() => setHistoryOpen((current) => !current)}>
            {historyOpen ? "Hide Teaching Card revision history" : "Show Teaching Card revision history"}
          </button>
          {historyOpen && <ol>
            {card.revisions.map((revision, index) => <li key={revision.id}>
              <p>{revision.content || revision.error}</p>
              <button className="text-button" disabled={busy || revision.status === "streaming"}
                aria-label={`Restore Teaching Card revision ${index + 1}`} onClick={() => void restore(revision.id)}>Restore this revision</button>
            </li>)}
          </ol>}
        </section>
      )}

      {card.variants.map((variant) => (
        <section className="teaching-variant" aria-label={`Teaching Variant ${variant.name}`} aria-live="polite" key={variant.id}>
          <div className="card-heading"><h3>{variant.name}</h3><span className="saved">Named alternative</span></div>
          {variant.revision.error
            ? <p className="failure-message" role="alert">{variant.revision.error}</p>
            : <p>{variant.revision.content || (variant.revision.status === "streaming" ? "Preparing this alternative route…" : "No alternative content yet.")}</p>}
          {variant.revision.retryable && <button className="secondary" disabled={busy}
            onClick={() => void onRetry(variant.id)}>Retry Teaching Variant {variant.name}</button>}
        </section>
      ))}

      <form className="inspector-form" onSubmit={(event) => void submitRevision(event)}>
        <label htmlFor={`teaching-follow-up-${card.id}`}>{isQuestionDraft ? "Question about this Source Anchor" : "Teaching Card follow-up"}</label>
        <textarea id={`teaching-follow-up-${card.id}`} value={followUp} disabled={busy || card.currentRevision.status === "streaming"}
          onChange={(event) => setFollowUp(event.target.value)} />
        <button className="primary" disabled={busy || !followUp.trim() || card.currentRevision.status === "streaming"}>
          {isQuestionDraft ? "Ask about this Source Anchor" : "Revise current Teaching Card"}
        </button>
      </form>

      <form className="inspector-form" onSubmit={(event) => void submitVariant(event)}>
        <label htmlFor={`variant-name-${card.id}`}>Teaching Variant name</label>
        <input id={`variant-name-${card.id}`} value={variantName} disabled={busy}
          onChange={(event) => setVariantName(event.target.value)} />
        <label htmlFor={`variant-instruction-${card.id}`}>Alternative route instruction</label>
        <textarea id={`variant-instruction-${card.id}`} value={variantInstruction} disabled={busy}
          onChange={(event) => setVariantInstruction(event.target.value)} />
        <button className="secondary" disabled={busy || !variantName.trim() || !variantInstruction.trim()}>Create named Teaching Variant</button>
      </form>

      {artifact ? (
        <p className="saved" role="status">Pinned Learning Artifact retains this Source Anchor.</p>
      ) : (
        <button className="secondary" disabled={busy || card.currentRevision.status !== "completed" || !card.currentRevision.content.trim()}
          onClick={() => void pin()}>Pin as Learning Artifact</button>
      )}
    </aside>
  );
}

function teachingStatus(status: AnchoredTeachingCard["currentRevision"]["status"]): string {
  return {
    idle: "Saved request",
    streaming: "Teaching in progress",
    completed: "Current revision",
    stopped: "Stopped",
    failed: "Needs attention"
  }[status];
}
