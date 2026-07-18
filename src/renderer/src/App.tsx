import { useEffect, useState, type FormEvent } from "react";
import type {
  LearningApplicationState,
  LearningSession,
  StudyMission,
  StudyWorkspace
} from "../../shared/learning-application";

type StateHandler = (state: LearningApplicationState) => void;

export function App() {
  const [state, setState] = useState<LearningApplicationState | null>(null);

  useEffect(() => {
    void window.quickStudy.getState().then(setState);
  }, []);

  if (!state) return <main className="loading">Opening Quick Study…</main>;
  if (state.screen === "workbench" && state.activeSessionId) {
    return <Workbench key={state.activeSessionId} state={state} onState={setState} />;
  }
  return <Dashboard state={state} onState={setState} />;
}

function Brand() {
  return (
    <header className="brand">
      <span className="brand-mark" aria-hidden="true">Q</span>
      <span>Quick Study</span>
      <span className="local-pill">Stored locally</span>
    </header>
  );
}

function Dashboard({ state, onState }: { state: LearningApplicationState; onState: StateHandler }) {
  const workspace = state.workspaces.find((candidate) => candidate.id === state.navigation.workspaceId)!;
  const mission = state.missions.find((candidate) => candidate.id === state.navigation.missionId) ?? null;
  const resumeSession = state.sessions.find((session) => session.id === state.resumeSessionId) ?? null;

  return (
    <main className="shell">
      <Brand />
      <div className="dashboard-grid">
        <Hierarchy state={state} onState={onState} />
        <section className="dashboard-content" aria-labelledby="dashboard-title">
          <header className="dashboard-heading">
            <p className="eyebrow">Resume-first dashboard</p>
            <h1 id="dashboard-title">Continue your mathematics</h1>
            <p className="lede">Return to the exact focus you left behind, or begin a new durable Quick Study.</p>
          </header>
          {resumeSession ? <ResumeCard state={state} session={resumeSession} onState={onState} /> : <EmptyResume />}
          <Intake onState={onState} />
          <WorkspaceEditor workspace={workspace} mission={mission} state={state} onState={onState} />
          <MissionHistory workspace={workspace} mission={mission} state={state} onState={onState} />
        </section>
      </div>
    </main>
  );
}

function Hierarchy({ state, onState }: { state: LearningApplicationState; onState: StateHandler }) {
  return (
    <nav className="hierarchy" aria-label="Study hierarchy">
      <div className="hierarchy-heading">
        <p className="eyebrow">Your study</p>
        <h2>Study Workspaces</h2>
      </div>
      <ul className="workspace-list">
        {state.workspaces.map((workspace) => {
          const missions = state.missions.filter((mission) => mission.workspaceId === workspace.id);
          const selected = state.navigation.workspaceId === workspace.id;
          return (
            <li key={workspace.id}>
              <button
                className={`workspace-link${selected ? " selected" : ""}`}
                aria-expanded={selected}
                aria-label={`Open Study Workspace ${workspace.name}`}
                onClick={() => void window.quickStudy.submit({ type: "navigateToWorkspace", workspaceId: workspace.id }).then(onState)}
              >
                <span>{workspace.name}</span>
                <small>{missions.length} {missions.length === 1 ? "mission" : "missions"}</small>
              </button>
              {selected && (
                <ul className="mission-list">
                  {missions.map((mission) => {
                    const sessions = state.sessions.filter((session) => session.missionId === mission.id);
                    return (
                      <li key={mission.id}>
                        <button
                          className={`mission-link${state.navigation.missionId === mission.id ? " selected" : ""}`}
                          aria-current={state.navigation.missionId === mission.id ? "page" : undefined}
                          aria-label={`Open Study Mission ${mission.name}`}
                          onClick={() => void window.quickStudy.submit({
                            type: "navigateToMission",
                            workspaceId: workspace.id,
                            missionId: mission.id
                          }).then(onState)}
                        >
                          <span>{mission.name}</span>
                          <small>{sessions.length}</small>
                        </button>
                        {state.navigation.missionId === mission.id && sessions.length > 0 && (
                          <ul className="session-nav-list">
                            {sessions.map((session) => (
                              <li key={session.id}>
                                <button
                                  aria-label={`Resume grouped Learning Session ${session.learningGoal}`}
                                  onClick={() => void window.quickStudy.submit({
                                    type: "resumeSession",
                                    sessionId: session.id
                                  }).then(onState)}
                                >
                                  {session.learningGoal}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <CreateWorkspace onState={onState} />
    </nav>
  );
}

function CreateWorkspace({ onState }: { onState: StateHandler }) {
  const [name, setName] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextState = await window.quickStudy.submit({ type: "createWorkspace", name });
    setName("");
    onState(nextState);
  };
  return (
    <form className="compact-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="workspace-name">New Study Workspace name</label>
      <input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} />
      <button className="secondary" disabled={!name.trim()}>Create Study Workspace</button>
    </form>
  );
}

function ResumeCard({ state, session, onState }: {
  state: LearningApplicationState;
  session: LearningSession;
  onState: StateHandler;
}) {
  const workspace = state.workspaces.find((candidate) => candidate.id === session.workspaceId)!;
  const mission = state.missions.find((candidate) => candidate.id === session.missionId)!;
  return (
    <section className="resume-card" aria-labelledby="resume-card-title">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Resume Card</p>
          <h2 id="resume-card-title">{session.learningGoal}</h2>
        </div>
        <span className="saved">{workspace.name} · {mission.name}</span>
      </div>
      <div className="return-context">
        <span>Return to</span>
        <p>{session.returnContext.label}</p>
        <small>{session.returnContext.nextAction}</small>
      </div>
      <div className="resume-actions">
        <button className="primary" onClick={() => void window.quickStudy.submit({
          type: "resumeSession",
          sessionId: session.id
        }).then(onState)}>Resume Learning Session</button>
        {session.workspaceId === state.quickStudy.workspace.id && <FilingControls state={state} session={session} onState={onState} />}
      </div>
    </section>
  );
}

function FilingControls({ state, session, onState }: {
  state: LearningApplicationState;
  session: LearningSession;
  onState: StateHandler;
}) {
  const destinations = state.missions.filter((mission) => mission.kind === "named");
  const [destinationMissionId, setDestinationMissionId] = useState(destinations[0]?.id ?? "");
  useEffect(() => {
    if (!destinations.some((mission) => mission.id === destinationMissionId)) {
      setDestinationMissionId(destinations[0]?.id ?? "");
    }
  }, [destinationMissionId, destinations]);
  if (destinations.length === 0) return <span className="filing-hint">Create a named workspace and mission to file this session.</span>;
  const file = async () => {
    const mission = destinations.find((candidate) => candidate.id === destinationMissionId)!;
    onState(await window.quickStudy.submit({
      type: "fileSession",
      sessionId: session.id,
      workspaceId: mission.workspaceId,
      missionId: mission.id
    }));
  };
  return (
    <div className="filing-controls">
      <label htmlFor={`filing-${session.id}`}>Destination Study Mission</label>
      <select id={`filing-${session.id}`} value={destinationMissionId} onChange={(event) => setDestinationMissionId(event.target.value)}>
        {destinations.map((mission) => {
          const workspace = state.workspaces.find((candidate) => candidate.id === mission.workspaceId)!;
          return <option key={mission.id} value={mission.id}>{workspace.name} — {mission.name}</option>;
        })}
      </select>
      <button className="secondary" onClick={() => void file()}>File Quick Study session</button>
    </div>
  );
}

function EmptyResume() {
  return (
    <section className="resume-card empty-resume">
      <p className="eyebrow">Resume Card</p>
      <h2>No paused session yet</h2>
      <p>Your next Quick Study will be retained here for an immediate return.</p>
    </section>
  );
}

function Intake({ onState }: { onState: StateHandler }) {
  const [mathematics, setMathematics] = useState("");
  const start = async (event: FormEvent) => {
    event.preventDefault();
    onState(await window.quickStudy.submit({ type: "startQuickStudy", mathematics }));
  };
  return (
    <section className="intake-card" aria-labelledby="intake-title">
      <p className="eyebrow">Session Intake</p>
      <h2 id="intake-title">Begin with the mathematics</h2>
      <p className="lede">Paste a question, proof, or expression. Quick Study gives it a durable home immediately.</p>
      <form onSubmit={(event) => void start(event)}>
        <label htmlFor="mathematics">Typed mathematics</label>
        <textarea
          id="mathematics"
          value={mathematics}
          onChange={(event) => setMathematics(event.target.value)}
          placeholder="What would you like to understand?"
        />
        <div className="intake-actions">
          <span>No workspace setup required</span>
          <button className="primary" disabled={!mathematics.trim()}>Start Quick Study</button>
        </div>
      </form>
    </section>
  );
}

function WorkspaceEditor({ workspace, mission, state, onState }: {
  workspace: StudyWorkspace;
  mission: StudyMission | null;
  state: LearningApplicationState;
  onState: StateHandler;
}) {
  const [workspaceName, setWorkspaceName] = useState(workspace.name);
  const [missionName, setMissionName] = useState("");
  useEffect(() => setWorkspaceName(workspace.name), [workspace.id, workspace.name]);
  if (workspace.kind !== "named") return null;
  const rename = async (event: FormEvent) => {
    event.preventDefault();
    onState(await window.quickStudy.submit({ type: "renameWorkspace", workspaceId: workspace.id, name: workspaceName }));
  };
  const createMission = async (event: FormEvent) => {
    event.preventDefault();
    const next = await window.quickStudy.submit({ type: "createMission", workspaceId: workspace.id, name: missionName });
    setMissionName("");
    onState(next);
  };
  return (
    <section className="organize-card" aria-labelledby="workspace-title">
      <p className="eyebrow">Selected Study Workspace</p>
      <h2 id="workspace-title">{workspace.name}</h2>
      <p className="subtle">{mission ? `Current mission: ${mission.name}` : "Create the first Study Mission for this workspace."}</p>
      <div className="organize-forms">
        <form className="compact-form" onSubmit={(event) => void rename(event)}>
          <label htmlFor={`rename-${workspace.id}`}>Study Workspace name</label>
          <input id={`rename-${workspace.id}`} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
          <button className="secondary" disabled={!workspaceName.trim() || workspaceName.trim() === workspace.name}>Rename Study Workspace</button>
        </form>
        <form className="compact-form" onSubmit={(event) => void createMission(event)}>
          <label htmlFor={`mission-${workspace.id}`}>New Study Mission name</label>
          <input id={`mission-${workspace.id}`} value={missionName} onChange={(event) => setMissionName(event.target.value)} />
          <button className="secondary" disabled={!missionName.trim()}>Create Study Mission</button>
        </form>
      </div>
      <span className="saved">{state.missions.filter((candidate) => candidate.workspaceId === workspace.id).length} missions share this workspace context</span>
    </section>
  );
}

function MissionHistory({ workspace, mission, state, onState }: {
  workspace: StudyWorkspace;
  mission: StudyMission | null;
  state: LearningApplicationState;
  onState: StateHandler;
}) {
  const sessions = mission ? state.sessions.filter((session) => session.missionId === mission.id) : [];
  return (
    <section className="history-card" aria-labelledby="history-title">
      <p className="eyebrow">Durable history</p>
      <h2 id="history-title">{mission ? `${workspace.name} · ${mission.name}` : workspace.name}</h2>
      {sessions.length === 0 ? <p className="subtle">No Learning Sessions in this Study Mission yet.</p> : (
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <div><strong>{session.learningGoal}</strong><small>{session.sessionTarget}</small></div>
              <button className="text-button" aria-label={`Resume Learning Session ${session.learningGoal}`} onClick={() => void window.quickStudy.submit({
                type: "resumeSession",
                sessionId: session.id
              }).then(onState)}>Resume</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Workbench({ state, onState }: { state: LearningApplicationState; onState: StateHandler }) {
  const session = state.sessions.find((candidate) => candidate.id === state.activeSessionId)!;
  const workspace = state.workspaces.find((candidate) => candidate.id === session.workspaceId)!;
  const mission = state.missions.find((candidate) => candidate.id === session.missionId)!;
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
      <div className="workbench-layout">
        <Hierarchy state={state} onState={onState} />
        <div className="workbench-grid">
          <aside className="session-panel">
            <p className="eyebrow">{workspace.name} · {mission.name}</p>
            <h1>Mathematical Workbench</h1>
            <label htmlFor="goal">Learning Goal</label>
            <textarea id="goal" className="field" value={goal} onChange={(event) => {
              const value = event.target.value;
              setGoal(value);
              void window.quickStudy.submit({ type: "editLearningGoal", value });
            }} />
            <label htmlFor="target">Session Target</label>
            <textarea id="target" className="field" value={target} onChange={(event) => {
              const value = event.target.value;
              setTarget(value);
              void window.quickStudy.submit({ type: "editSessionTarget", value });
            }} />
            <button className="secondary" onClick={() => void leave()}>Leave session</button>
          </aside>
          <section className="math-canvas">
            <div className="canvas-heading">
              <div><p className="eyebrow">Source Layer</p><h2>Your typed mathematics</h2></div>
              <span className="saved">Saved locally</span>
            </div>
            <article>{session.mathematics}</article>
            <div className="next-step"><span>Next teaching move</span><strong>{session.returnContext.nextAction}</strong></div>
          </section>
        </div>
      </div>
    </main>
  );
}
