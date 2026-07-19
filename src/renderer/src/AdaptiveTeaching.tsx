import { useEffect, useState, type FormEvent } from "react";
import {
  TEACHING_ROUTES,
  UNDERSTANDING_CHECK_KINDS,
  canOfferUnderstandingCheck,
  type LearningApplicationState,
  type LearningSession,
  type LearnerAction,
  type TeachingRoute,
  type LearnerModelConfidence,
  type UnderstandingCheckKind,
  type UnderstandingInterpretation
} from "../../shared/learning-application";

const CHECK_LABELS: Record<UnderstandingCheckKind, string> = {
  explain: "Explain",
  apply: "Apply",
  compare: "Compare",
  diagnose: "Diagnose",
  continueReasoning: "Continue reasoning"
};

const ROUTE_LABELS: Record<TeachingRoute, string> = {
  visual: "Visual",
  symbolic: "Symbolic",
  exampleFirst: "Example-first",
  proofStructural: "Proof-structural"
};

const INTERPRETATION_LABELS: Record<UnderstandingInterpretation, string> = {
  specificGap: "A specific gap is visible",
  secureUnderstanding: "The reasoning seems secure here",
  excessivePace: "The pace was excessive"
};

export function AdaptiveTeaching({ session, onState }: {
  session: LearningSession;
  onState(state: LearningApplicationState): void;
}) {
  const [kind, setKind] = useState<UnderstandingCheckKind>("explain");
  const [route, setRoute] = useState<TeachingRoute>("proofStructural");
  const [concept, setConcept] = useState(session.learningGoal);
  const [prompt, setPrompt] = useState("");
  const [mathematicalStructures, setMathematicalStructures] = useState("");
  const [prerequisiteConcepts, setPrerequisiteConcepts] = useState("");
  const [taskDemands, setTaskDemands] = useState("");
  const [response, setResponse] = useState("");
  const [interpretation, setInterpretation] = useState<UnderstandingInterpretation>("specificGap");
  const [confidence, setConfidence] = useState<LearnerModelConfidence>("medium");
  const [experimentRoute, setExperimentRoute] = useState<TeachingRoute>("visual");
  const [experimentReason, setExperimentReason] = useState("");
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const offered = session.understandingChecks.find((check) => check.status === "offered") ?? null;
  const activeExperiment = session.teachingExperiments.find((experiment) => experiment.status === "active") ?? null;
  const canOfferCheck = canOfferUnderstandingCheck(session);

  useEffect(() => {
    setKind("explain");
    setRoute("proofStructural");
    setConcept(session.learningGoal);
    setPrompt("");
    setMathematicalStructures("");
    setPrerequisiteConcepts("");
    setTaskDemands("");
    setResponse("");
    setInterpretation("specificGap");
    setConfidence("medium");
    setExperimentRoute("visual");
    setExperimentReason("");
    setCorrectionDrafts({});
    setError(null);
  }, [session.id]);

  const submit = async (action: LearnerAction) => {
    setError(null);
    try {
      onState(await window.quickStudy.submit(action));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Adaptive teaching could not be updated.");
    }
  };
  const offer = (event: FormEvent) => {
    event.preventDefault();
    const transferable = mathematicalStructures.trim() && prerequisiteConcepts.trim() && taskDemands.trim();
    void submit({
      type: "offerUnderstandingCheck", kind, prompt, concept, representation: route,
      ...(transferable ? { evidenceTransferContext: {
        concepts: [concept.trim()],
        mathematicalStructures: commaSeparatedTerms(mathematicalStructures),
        prerequisiteRelationships: commaSeparatedTerms(prerequisiteConcepts).map((prerequisiteConcept) => ({
          prerequisiteConcept, supportsConcept: concept.trim(), relationship: "requiredFor" as const
        })),
        taskDemands: commaSeparatedTerms(taskDemands)
      } } : {})
    });
  };
  const answer = (event: FormEvent) => {
    event.preventDefault();
    if (!offered) return;
    void submit({ type: "recordUnderstandingEvidence", checkId: offered.id, response, interpretation, confidence });
  };
  const beginExperiment = (event: FormEvent) => {
    event.preventDefault();
    void submit({ type: "startTeachingExperiment", route: experimentRoute, reason: experimentReason });
  };

  return (
    <section className="adaptive-teaching-card" aria-labelledby="adaptive-teaching-title">
      <div className="card-heading">
        <div><p className="eyebrow">Inspectable adaptation</p><h2 id="adaptive-teaching-title">Understanding Evidence</h2></div>
        <span className="saved">Saved locally</span>
      </div>
      <p className="subtle">Checks are optional. They ask for reasoning, not recall, and skipping one does not count against you.</p>

      <article className="next-teaching-move" aria-label="Current Teaching Move">
        <p className="eyebrow">Next Teaching Move · {session.currentTeachingMove.kind}</p>
        <p>{ROUTE_LABELS[session.currentTeachingMove.route]} route</p>
        <p><strong>Why this move:</strong> {session.currentTeachingMove.reason}</p>
      </article>

      {offered ? (
        <form className="adaptive-form" onSubmit={answer}>
          <p className="eyebrow">Understanding Check · {CHECK_LABELS[offered.kind]}</p>
          <p>{offered.prompt}</p>
          <label htmlFor="understanding-response">Your reasoning</label>
          <textarea id="understanding-response" className="field" value={response} onChange={(event) => setResponse(event.target.value)} />
          <label htmlFor="understanding-interpretation">How should this guide the next move?</label>
          <select id="understanding-interpretation" value={interpretation} onChange={(event) => setInterpretation(event.target.value as UnderstandingInterpretation)}>
            {Object.entries(INTERPRETATION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
          <label htmlFor="understanding-confidence">Inference confidence</label>
          <select id="understanding-confidence" value={confidence}
            onChange={(event) => setConfidence(event.target.value as LearnerModelConfidence)}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
          <div className="adaptive-actions">
            <button className="primary" disabled={!response.trim()}>Save Understanding Evidence</button>
            <button type="button" className="secondary" onClick={() => void submit({ type: "skipUnderstandingCheck", checkId: offered.id })}>Skip without penalty</button>
          </div>
        </form>
      ) : canOfferCheck ? (
        <form className="adaptive-form" onSubmit={offer}>
          <label htmlFor="understanding-check-kind">Reasoning check</label>
          <select id="understanding-check-kind" value={kind} onChange={(event) => setKind(event.target.value as UnderstandingCheckKind)}>
            {UNDERSTANDING_CHECK_KINDS.map((value) => <option value={value} key={value}>{CHECK_LABELS[value]}</option>)}
          </select>
          <label htmlFor="understanding-check-concept">Concept</label>
          <input id="understanding-check-concept" value={concept} onChange={(event) => setConcept(event.target.value)} />
          <label htmlFor="understanding-check-route">Current representation</label>
          <select id="understanding-check-route" value={route} onChange={(event) => setRoute(event.target.value as TeachingRoute)}>
            {TEACHING_ROUTES.map((value) => <option value={value} key={value}>{ROUTE_LABELS[value]}</option>)}
          </select>
          <label htmlFor="understanding-check-prompt">Brief prompt</label>
          <textarea id="understanding-check-prompt" className="field" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <p className="subtle">Optional Evidence Transfer context must include every field; partial context stays local to this Learning Session.</p>
          <label htmlFor="understanding-check-structures">Mathematical structures</label>
          <input id="understanding-check-structures" value={mathematicalStructures}
            onChange={(event) => setMathematicalStructures(event.target.value)} placeholder="compact Hausdorff subspace" />
          <label htmlFor="understanding-check-prerequisites">Prerequisite relationships</label>
          <input id="understanding-check-prerequisites" value={prerequisiteConcepts}
            onChange={(event) => setPrerequisiteConcepts(event.target.value)} placeholder="Hausdorff separation" />
          <label htmlFor="understanding-check-demands">Task demands</label>
          <input id="understanding-check-demands" value={taskDemands}
            onChange={(event) => setTaskDemands(event.target.value)} placeholder="apply a finite-subcover argument" />
          <button className="secondary" disabled={!concept.trim() || !prompt.trim()}>Offer Understanding Check</button>
        </form>
      ) : (
        <p className="subtle">Complete a substantive Teaching Card before offering an Understanding Check.</p>
      )}

      {activeExperiment ? (
        <div className="adaptive-form" aria-label="Active Teaching Experiment">
          <p><strong>{ROUTE_LABELS[activeExperiment.route]} Teaching Experiment:</strong> {activeExperiment.reason}</p>
          <p>Did this route help for this concept and task?</p>
          <div className="adaptive-actions">
            <button className="secondary" onClick={() => void submit({ type: "completeTeachingExperiment", experimentId: activeExperiment.id, outcome: "helpful" })}>Helpful</button>
            <button className="secondary" onClick={() => void submit({ type: "completeTeachingExperiment", experimentId: activeExperiment.id, outcome: "notHelpful" })}>Not helpful</button>
            <button className="secondary" onClick={() => void submit({ type: "completeTeachingExperiment", experimentId: activeExperiment.id, outcome: "inconclusive" })}>Inconclusive</button>
          </div>
        </div>
      ) : (
        <form className="adaptive-form" onSubmit={beginExperiment}>
          <p className="eyebrow">Try a different route</p>
          <label htmlFor="teaching-experiment-route">Teaching route</label>
          <select id="teaching-experiment-route" value={experimentRoute} onChange={(event) => setExperimentRoute(event.target.value as TeachingRoute)}>
            {TEACHING_ROUTES.map((value) => <option value={value} key={value}>{ROUTE_LABELS[value]}</option>)}
          </select>
          <label htmlFor="teaching-experiment-reason">Why try it?</label>
          <input id="teaching-experiment-reason" value={experimentReason} onChange={(event) => setExperimentReason(event.target.value)} />
          <button className="secondary" disabled={!experimentReason.trim()}>Start Teaching Experiment</button>
        </form>
      )}

      {session.interactionPreferences.length > 0 && <ul className="interaction-preferences" aria-label="Contextual Interaction Preferences">
        {session.interactionPreferences.map((preference) => <li key={preference.id}>
          {ROUTE_LABELS[preference.route]} route · {preference.status} for {preference.context.concept} in this Session Target.
        </li>)}
      </ul>}
      {session.interactionPreferences.length > 0 && <p className="subtle">These are context-bound hypotheses, not a permanent learner-style label.</p>}

      {session.understandingEvidence.length > 0 && <div className="understanding-evidence-list">
        <p className="eyebrow">Recorded Understanding Evidence</p>
        {session.understandingEvidence.map((evidence) => (
          <form key={evidence.id} className="evidence-correction" onSubmit={(event) => {
            event.preventDefault();
            const correction = correctionDrafts[evidence.id] ?? "";
            void submit({ type: "correctUnderstandingEvidence", evidenceId: evidence.id, interpretation: evidence.interpretation, correction });
          }}>
            <p>{evidence.response}</p>
            <label htmlFor={`evidence-interpretation-${evidence.id}`}>Interpretation</label>
            <select id={`evidence-interpretation-${evidence.id}`} value={evidence.interpretation} onChange={(event) => void submit({
              type: "correctUnderstandingEvidence", evidenceId: evidence.id,
              interpretation: event.target.value as UnderstandingInterpretation,
              correction: correctionDrafts[evidence.id] || "Learner updated the interpretation."
            })}>
              {Object.entries(INTERPRETATION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
            <label htmlFor={`evidence-correction-${evidence.id}`}>Correction note</label>
            <input id={`evidence-correction-${evidence.id}`} value={correctionDrafts[evidence.id] ?? evidence.learnerCorrection ?? ""}
              onChange={(event) => setCorrectionDrafts((drafts) => ({ ...drafts, [evidence.id]: event.target.value }))} />
            <button className="text-button" disabled={!(correctionDrafts[evidence.id] ?? evidence.learnerCorrection ?? "").trim()}>Correct interpretation</button>
          </form>
        ))}
      </div>}
      {error && <p className="failure-message" role="alert">{error}</p>}
    </section>
  );
}

function commaSeparatedTerms(value: string): string[] {
  return value.split(",").map((term) => term.trim()).filter(Boolean);
}
