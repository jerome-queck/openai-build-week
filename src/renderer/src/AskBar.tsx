import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { LearningSession, QuestionCard, QuestionContextItem } from "../../shared/learning-application";

const PRIMARY_CONTEXT_LIMIT = 3;

interface AskBarProps {
  session: LearningSession;
  modelAvailable: boolean;
  onSetContext(contextId: string, included: boolean): Promise<void>;
  onSubmit(text: string): Promise<void>;
  onSavePending(text: string): Promise<void>;
  onDiscardPending(): Promise<void>;
  onStartNewQuestion(): Promise<void>;
  onRetry(cardId: string): Promise<void>;
}

export function AskBar({
  session,
  modelAvailable,
  onSetContext,
  onSubmit,
  onSavePending,
  onDiscardPending,
  onStartNewQuestion,
  onRetry
}: AskBarProps) {
  const pending = session.pendingQuestion;
  const activeCard = session.questionCards.find((card) => card.id === session.activeQuestionCardId) ?? null;
  const [text, setText] = useState(pending?.text ?? "");
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [selectedContextId, setSelectedContextId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const included = useMemo(() => {
    const ids = new Set(session.askBarContext.includedIds);
    return session.askBarContext.items.filter((item) => ids.has(item.id));
  }, [session.askBarContext]);
  const available = session.askBarContext.items.filter((item) => !session.askBarContext.includedIds.includes(item.id));
  const visible = overflowOpen ? included : included.slice(0, PRIMARY_CONTEXT_LIMIT);
  const overflowCount = Math.max(0, included.length - PRIMARY_CONTEXT_LIMIT);

  useEffect(() => setText(pending?.text ?? ""), [pending?.id, pending?.text]);
  useEffect(() => {
    if (!available.some((item) => item.id === selectedContextId)) setSelectedContextId(available[0]?.id ?? "");
  }, [available, selectedContextId]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Ask Bar could not complete that action.");
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const question = text.trim();
    if (!question) return;
    await run(async () => {
      if (modelAvailable) {
        await onSubmit(question);
        setText("");
      } else {
        await onSavePending(question);
      }
    });
  };

  return (
    <section className="ask-bar" aria-labelledby="ask-bar-title">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Ask Bar</p>
          <h2 id="ask-bar-title">{pending ? "Pending Question" : activeCard ? "Revise this Question Card" : "Ask from this session context"}</h2>
        </div>
        {activeCard && <button type="button" className="text-button" disabled={busy}
          onClick={() => void run(onStartNewQuestion)}>Ask a new question</button>}
      </div>
      <div className="context-chip-editor" aria-label="Question context">
        <p id="question-context-help">Included context. Remove or add items before submission.</p>
        <ul className="context-chip-list" aria-describedby="question-context-help">
          {visible.map((item) => <li key={item.id}><ContextChip item={item} disabled={busy}
            onRemove={() => run(() => onSetContext(item.id, false))} /></li>)}
        </ul>
        {overflowCount > 0 && <button type="button" className="context-overflow" aria-expanded={overflowOpen}
          onClick={() => setOverflowOpen((open) => !open)}>
          {overflowOpen ? "Hide excess context" : `Show ${overflowCount} more context ${overflowCount === 1 ? "item" : "items"}`}
        </button>}
        <div className="context-add-controls">
          <label htmlFor="available-question-context">Available question context</label>
          <select id="available-question-context" value={selectedContextId} disabled={busy || available.length === 0}
            onChange={(event) => setSelectedContextId(event.target.value)}>
            {available.length === 0
              ? <option value="">All available context is included</option>
              : available.map((item) => <option key={item.id} value={item.id}>{chipText(item)}</option>)}
          </select>
          <button type="button" className="secondary" disabled={busy || !selectedContextId}
            onClick={() => void run(() => onSetContext(selectedContextId, true))}>Add selected context</button>
        </div>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="ask-bar-question">{pending ? "Pending Question text" : activeCard ? "Question Card revision" : "Ask Bar question"}</label>
        <textarea id="ask-bar-question" value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
        <div className="ask-actions">
          {pending && <button type="button" className="text-button" disabled={busy}
            onClick={() => void run(onDiscardPending)}>Discard Pending Question</button>}
          <button className="primary" disabled={busy || !text.trim() || included.length === 0}>
            {modelAvailable
              ? pending ? "Submit Pending Question" : activeCard ? "Revise Question Card" : "Create Question Card"
              : pending ? "Save Pending Question changes" : "Save Pending Question"}
          </button>
        </div>
      </form>
      {error && <p className="failure-message" role="alert">{error}</p>}
      {activeCard && <QuestionCardView card={activeCard} disabled={busy} onRetry={onRetry} />}
    </section>
  );
}

function ContextChip({ item, disabled, onRemove }: {
  item: QuestionContextItem;
  disabled: boolean;
  onRemove(): Promise<void>;
}) {
  return (
    <span className="context-chip">
      <span>{chipText(item)}</span>
      <button type="button" disabled={disabled}
        aria-label={`Remove ${item.typeLabel} ${item.identity} from question context`}
        onClick={() => void onRemove()}>Remove</button>
    </span>
  );
}

function chipText(item: QuestionContextItem): string {
  return `${item.typeLabel} · ${item.identity} · ${item.location || item.preview}`;
}

function QuestionCardView({ card, disabled, onRetry }: {
  card: QuestionCard;
  disabled: boolean;
  onRetry(cardId: string): Promise<void>;
}) {
  const revision = card.currentRevision;
  return (
    <article className={`question-card ${revision.status}`} aria-label={`Question Card: ${card.question}`} aria-live="polite">
      <div className="card-heading"><div><p className="eyebrow">Question Card</p><h3>{card.question}</h3></div>
        <span className="saved">{questionStatus(revision.status)}</span></div>
      {revision.content
        ? <p>{revision.content}</p>
        : <p className="subtle">{revision.status === "streaming" ? "Preparing this contextual answer…" : "No answer content yet."}</p>}
      {revision.error && <p className="failure-message" role="alert">{revision.error}</p>}
      {revision.retryable && <button type="button" className="secondary" disabled={disabled}
        onClick={() => void onRetry(card.id)}>Retry Question Card</button>}
      <details className="context-used-receipt">
        <summary>Context Used Receipt · {revision.contextUsed.length} items</summary>
        <ul>{revision.contextUsed.map((item) => <li key={item.id}><strong>{item.typeLabel} · {item.identity}</strong> · {item.location}</li>)}</ul>
      </details>
      {card.revisions.length > 0 && <details className="question-card-history">
        <summary>Earlier Question Card revisions · {card.revisions.length}</summary>
        <ol>{card.revisions.map((previous) => <li key={previous.id}>
          <strong>{previous.question}</strong>: {previous.content || previous.error || "No answer content."}
        </li>)}</ol>
      </details>}
    </article>
  );
}

function questionStatus(status: QuestionCard["currentRevision"]["status"]): string {
  return ({ idle: "Saved", streaming: "Teaching in progress", completed: "Current revision", stopped: "Stopped", failed: "Needs attention" })[status];
}
