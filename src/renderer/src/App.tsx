import { useEffect, useState } from "react";
import type { LearningApplicationState } from "../../shared/learning-application";

export function App() {
  const [state, setState] = useState<LearningApplicationState | null>(null);

  useEffect(() => {
    void window.quickStudy.getState().then(setState);
  }, []);

  if (!state) return <main className="loading">Opening Quick Study…</main>;
  if (state.screen === "intake") return <Intake onState={setState} />;
  if (state.screen === "resume" && state.session) return <Resume state={state} onState={setState} />;
  if (state.session) return <Workbench state={state} onState={setState} />;
  return null;
}

function Brand() {
  return (
    <header className="brand">
      <span className="brand-mark">Q</span>
      <span>Quick Study</span>
      <span className="local-pill">Stored locally</span>
    </header>
  );
}

function Intake({ onState }: { onState: (state: LearningApplicationState) => void }) {
  const [mathematics, setMathematics] = useState("");

  return (
    <main className="shell intake-shell">
      <Brand />
      <section className="intake-card">
        <p className="eyebrow">Session Intake</p>
        <h1>Begin with the mathematics</h1>
        <p className="lede">Paste a question, proof, or expression. Quick Study gives it a durable home immediately.</p>
        <label htmlFor="mathematics">Typed mathematics</label>
        <textarea
          id="mathematics"
          value={mathematics}
          onChange={(event) => setMathematics(event.target.value)}
          placeholder="What would you like to understand?"
          autoFocus
        />
        <div className="intake-actions">
          <span>No workspace setup required</span>
          <button
            className="primary"
            disabled={!mathematics.trim()}
            onClick={() => void window.quickStudy.submit({ type: "startQuickStudy", mathematics }).then(onState)}
          >
            Start Quick Study
          </button>
        </div>
      </section>
    </main>
  );
}

function Workbench({ state, onState }: { state: LearningApplicationState; onState: (state: LearningApplicationState) => void }) {
  const session = state.session!;
  const [goal, setGoal] = useState(session.learningGoal);
  const [target, setTarget] = useState(session.sessionTarget);

  const leave = async () => {
    await window.quickStudy.submit({ type: "editLearningGoal", value: goal });
    await window.quickStudy.submit({ type: "editSessionTarget", value: target });
    onState(await window.quickStudy.submit({ type: "leaveSession" }));
  };

  return (
    <main className="shell">
      <Brand />
      <div className="workbench-grid">
        <aside className="session-panel">
          <p className="eyebrow">Quick Study · Active</p>
          <h1>Mathematical Workbench</h1>
          <label htmlFor="goal">Learning Goal</label>
          <textarea
            id="goal"
            className="field"
            value={goal}
            onChange={(event) => {
              const value = event.target.value;
              setGoal(value);
              void window.quickStudy.submit({ type: "editLearningGoal", value });
            }}
          />
          <label htmlFor="target">Session Target</label>
          <textarea
            id="target"
            className="field"
            value={target}
            onChange={(event) => {
              const value = event.target.value;
              setTarget(value);
              void window.quickStudy.submit({ type: "editSessionTarget", value });
            }}
          />
          <button className="secondary" onClick={() => void leave()}>Leave session</button>
        </aside>
        <section className="math-canvas">
          <div className="canvas-heading">
            <div>
              <p className="eyebrow">Source Layer</p>
              <h2>Your typed mathematics</h2>
            </div>
            <span className="saved">Saved locally</span>
          </div>
          <article>{session.mathematics}</article>
          <div className="next-step">
            <span>Next teaching move</span>
            <strong>{session.returnContext.nextAction}</strong>
          </div>
        </section>
      </div>
    </main>
  );
}

function Resume({ state, onState }: { state: LearningApplicationState; onState: (state: LearningApplicationState) => void }) {
  const session = state.session!;
  return (
    <main className="shell resume-shell">
      <Brand />
      <section className="resume-card">
        <p className="eyebrow">Quick Study · Paused</p>
        <h1>Ready when you are</h1>
        <p className="lede">Your session is saved with the exact focus you left behind.</p>
        <div className="resume-detail">
          <span>Learning Goal</span>
          <strong>{session.learningGoal}</strong>
        </div>
        <div className="resume-detail">
          <span>Session Target</span>
          <strong>{session.sessionTarget}</strong>
        </div>
        <div className="return-context">
          <span>Return to</span>
          <p>{session.returnContext.label}</p>
          <small>{session.returnContext.nextAction}</small>
        </div>
        <button className="primary" onClick={() => void window.quickStudy.submit({ type: "resumeSession" }).then(onState)}>
          Resume Quick Study
        </button>
      </section>
    </main>
  );
}
