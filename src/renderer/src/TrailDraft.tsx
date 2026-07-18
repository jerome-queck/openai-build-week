import { useState, type FormEvent } from "react";
import type { LearnerAction, LearningSession, TrailItem, TrailItemKind } from "../../shared/learning-application";

const TRAIL_ITEM_LABELS: Record<TrailItemKind, string> = {
  concept: "Concept",
  reasoningStep: "Reasoning step",
  learningArtifact: "Learning Artifact",
  evidence: "Evidence",
  unresolvedQuestion: "Unresolved question",
  nextStep: "Next step"
};

export function TrailDraft({ session, onAction, onActivateSourceAnchor, onOpenTeachingCard }: {
  session: LearningSession;
  onAction(action: LearnerAction): Promise<void>;
  onActivateSourceAnchor(sourceAnchorId: string): Promise<void> | void;
  onOpenTeachingCard(teachingCardId: string): Promise<void> | void;
}) {
  const [newKind, setNewKind] = useState<TrailItemKind>("concept");
  const [newContent, setNewContent] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (action: LearnerAction, success: string): Promise<boolean> => {
    setError(null);
    setStatus(null);
    try {
      await onAction(action);
      setStatus(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Trail Draft could not be updated.");
      return false;
    }
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!newContent.trim()) return;
    if (await run({ type: "addTrailItem", kind: newKind, content: newContent }, "Trail Item added.")) {
      setNewContent("");
    }
  };
  const followLink = async (follow: () => Promise<void> | void) => {
    setError(null);
    try {
      await follow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The linked learning context could not be opened.");
    }
  };

  return (
    <section className="trail-draft" aria-labelledby="trail-draft-title">
      <div className="card-heading">
        <div><p className="eyebrow">Teaching Agent curation</p><h2 id="trail-draft-title">Trail Draft</h2></div>
        <span className="saved">Saved locally</span>
      </div>
      <p className="subtle">Shape the durable route through this Learning Session. Required Trail Items cannot be removed or replaced by automatic curation.</p>
      {session.trailDraft.items.length === 0 ? <p>No Trail Items yet. Add one directly or continue teaching.</p> : (
        <ol className="trail-items" aria-label="Trail Items">
          {session.trailDraft.items.map((item, index) => (
            <li key={item.id} className="trail-item">
              <div className="trail-item-heading">
                <strong>{TRAIL_ITEM_LABELS[item.kind]}</strong>
                <span className={`source-badge ${item.origin === "learner" ? "managed" : "linked"}`}>
                  {item.origin === "learner" ? "Learner" : "Teaching Agent"}
                </span>
              </div>
              <label htmlFor={`trail-item-${item.id}`}>Trail Item {index + 1} content</label>
              <textarea
                id={`trail-item-${item.id}`}
                className="field"
                value={drafts[item.id] ?? item.content}
                onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
              />
              <TrailItemLinks item={item} session={session}
                onActivateSourceAnchor={(sourceAnchorId) => followLink(() => onActivateSourceAnchor(sourceAnchorId))}
                onOpenTeachingCard={(teachingCardId) => followLink(() => onOpenTeachingCard(teachingCardId))} />
              <label className="trail-required">
                <input
                  type="checkbox"
                  checked={item.required}
                  aria-label={`Required Trail Item ${index + 1}`}
                  onChange={(event) => void run({
                    type: "setTrailItemRequired", trailItemId: item.id, required: event.target.checked
                  }, event.target.checked ? "Trail Item is required." : "Required marker removed.")}
                />
                Required Trail Item
              </label>
              <div className="trail-item-actions">
                <button className="secondary" aria-label={`Save Trail Item ${index + 1}`} onClick={() => void run({
                  type: "editTrailItem", trailItemId: item.id, content: drafts[item.id] ?? item.content
                }, "Trail Item saved.")}>Save</button>
                <button className="text-button" disabled={index === 0} aria-label={`Move Trail Item ${index + 1} up`} onClick={() => void run({
                  type: "moveTrailItem", trailItemId: item.id, direction: "up"
                }, "Trail Item moved up.")}>Move up</button>
                <button className="text-button" disabled={index === session.trailDraft.items.length - 1}
                  aria-label={`Move Trail Item ${index + 1} down`} onClick={() => void run({
                    type: "moveTrailItem", trailItemId: item.id, direction: "down"
                  }, "Trail Item moved down.")}>Move down</button>
                <button className="text-button" disabled={item.required} aria-label={`Remove Trail Item ${item.content}`} onClick={() => void run({
                  type: "removeTrailItem", trailItemId: item.id
                }, "Trail Item removed.")}>Remove</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <form className="trail-add" onSubmit={(event) => void add(event)}>
        <label htmlFor="new-trail-item-kind">New Trail Item type</label>
        <select id="new-trail-item-kind" className="field" value={newKind}
          onChange={(event) => setNewKind(event.target.value as TrailItemKind)}>
          {Object.entries(TRAIL_ITEM_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <label htmlFor="new-trail-item-content">New Trail Item content</label>
        <textarea id="new-trail-item-content" className="field" value={newContent}
          onChange={(event) => setNewContent(event.target.value)} />
        <button className="primary" disabled={!newContent.trim()}>Add Trail Item</button>
      </form>
      {status && <p className="saved" role="status">{status}</p>}
      {error && <p className="failure-message" role="alert">{error}</p>}
    </section>
  );
}

function TrailItemLinks({ item, session, onActivateSourceAnchor, onOpenTeachingCard }: {
  item: TrailItem;
  session: LearningSession;
  onActivateSourceAnchor(sourceAnchorId: string): Promise<void> | void;
  onOpenTeachingCard(teachingCardId: string): Promise<void> | void;
}) {
  const links = [
    ...item.links.sourceAnchorIds.flatMap((id) => {
      const anchor = session.sourceAnchors.find((candidate) => candidate.id === id);
      if (!anchor) return [];
      const label = anchor.selection.kind === "diagramRegion" ? "selected diagram region" : anchor.selection.exactText;
      return [{ key: `source-anchor:${id}`, content: <button className="text-button" aria-label={`Open Source Anchor ${label}`}
        onClick={() => void onActivateSourceAnchor(id)}>Source Anchor · {label}</button> }];
    }),
    ...item.links.teachingCardIds.flatMap((id) => {
      const card = session.anchoredTeachingCards.find((candidate) => candidate.id === id);
      return card ? [{ key: `teaching-card:${id}`, content: <button className="text-button" aria-label={`Open Teaching Card ${card.title}`}
        onClick={() => void onOpenTeachingCard(id)}>Teaching Card · {card.title}</button> }] : [];
    }),
    ...item.links.learningArtifactIds.flatMap((id) => {
      const artifact = session.learningArtifacts.find((candidate) => candidate.id === id);
      return artifact ? [{ key: `learning-artifact:${id}`, content: <a aria-label={`Open Learning Artifact ${artifact.title}`}
        href={`#learning-artifact-${id}`}>Learning Artifact · {artifact.title}</a> }] : [];
    })
  ];
  if (links.length === 0) return null;
  return <ul className="trail-links" aria-label="Linked learning context">
    {links.map((link) => <li key={link.key}>{link.content}</li>)}
  </ul>;
}
