import { useEffect, useState, type FormEvent } from "react";
import type {
  LearningApplicationState,
  LearningSession,
  LinkedSource,
  LinkedSourceView,
  SessionSearchResult,
  StudyMission,
  StudyWorkspace
} from "../../shared/learning-application";

type StateHandler = (state: LearningApplicationState) => void;

export function App() {
  const [state, setState] = useState<LearningApplicationState | null>(null);

  useEffect(() => {
    void window.quickStudy.getState().then(setState);
    return window.quickStudy.onStateChanged(setState);
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
          <AuthenticationPanel state={state} onState={onState} />
          <ModelAccessPanel state={state} onState={onState} />
          {resumeSession ? <ResumeCard state={state} session={resumeSession} onState={onState} /> : <EmptyResume />}
          <Intake state={state} onState={onState} />
          <SessionSearch onState={onState} />
          <WorkspaceEditor workspace={workspace} mission={mission} state={state} onState={onState} />
          <SourcesPanel key={workspace.id} workspace={workspace} state={state} onState={onState} />
          <MissionHistory workspace={workspace} mission={mission} state={state} onState={onState} />
        </section>
      </div>
    </main>
  );
}

function SourcesPanel({ workspace, state, onState }: {
  workspace: StudyWorkspace;
  state: LearningApplicationState;
  onState: StateHandler;
}) {
  const [view, setView] = useState<LinkedSourceView | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const sources = state.sources.filter((source) => source.workspaceId === workspace.id);
  const linkedSources = sources.filter((source): source is LinkedSource => source.kind === "linkedSource");
  const primaryFolder = linkedSources.find((source) => source.role === "primaryFolder");
  const attachments = linkedSources.filter((source) => source.role === "externalAttachment");
  const managedAssets = sources.filter((source) => source.kind === "managedAsset");
  const runSourceAction = async (action: () => Promise<LearningApplicationState>) => {
    setSourceError(null);
    try {
      onState(await action());
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Quick Study could not update this source.");
    }
  };
  const open = async (sourceId: string) => {
    setSourceError(null);
    try {
      setView(await window.quickStudy.openLinkedSource(sourceId));
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Quick Study could not open this source.");
    }
  };

  return (
    <section className="sources-card" aria-labelledby="sources-title">
      <div className="card-heading">
        <div>
          <p className="eyebrow">Local source ownership</p>
          <h2 id="sources-title">Sources and Managed Assets</h2>
        </div>
        <span className="saved">Originals stay in place</span>
      </div>
      <div className="source-actions">
        <button
          className="secondary"
          disabled={Boolean(primaryFolder)}
          onClick={() => void runSourceAction(() => window.quickStudy.linkPrimaryFolder(workspace.id))}
        >
          {primaryFolder ? "Primary Folder linked" : "Link Primary Folder"}
        </button>
        <button
          className="secondary"
          onClick={() => void runSourceAction(() => window.quickStudy.linkExternalAttachment(workspace.id))}
        >Add External Attachment</button>
      </div>
      <SourceGroup
        title="Primary Folder content"
        empty="No Primary Folder linked."
        sources={primaryFolder ? [primaryFolder] : []}
        onOpen={open}
      />
      <SourceGroup
        title="External Attachments"
        empty="No individual files linked outside the Primary Folder."
        sources={attachments}
        onOpen={open}
      />
      <div className="source-group">
        <h3>Managed Assets</h3>
        {managedAssets.length === 0 ? <p className="subtle">No fileless input retained here.</p> : (
          <ul className="source-list">
            {managedAssets.map((asset) => (
              <li key={asset.id}>
                <div><strong>{asset.name}</strong><span className="source-badge managed">Managed Asset</span></div>
                <p>{asset.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {view?.status === "available" && (
        <section className="source-view" aria-label="Linked Source view">
          <h3>Read-only Source Layer</h3>
          {view.mediaType === "image/png" || view.mediaType === "image/jpeg" ? (
            <img src={view.content} alt="Linked Source preview" />
          ) : view.mediaType === "application/pdf" ? (
            <object data={view.content} type="application/pdf" aria-label="Linked PDF Source Layer" />
          ) : <pre>{view.content}</pre>}
        </section>
      )}
      {view?.status === "unavailable" && <p className="failure-message" role="alert">{view.error}</p>}
      {sourceError && <p className="failure-message" role="alert">{sourceError}</p>}
    </section>
  );
}

function SourceGroup({ title, empty, sources, onOpen }: {
  title: string;
  empty: string;
  sources: Array<Extract<LearningApplicationState["sources"][number], { kind: "linkedSource" }>>;
  onOpen(sourceId: string): Promise<void>;
}) {
  return (
    <div className="source-group">
      <h3>{title}</h3>
      {sources.length === 0 ? <p className="subtle">{empty}</p> : (
        <ul className="source-list">
          {sources.map((source) => (
            <li key={source.id}>
              <div>
                <strong>{source.name}</strong>
                <span className="source-badge linked">Linked Source</span>
                <span className="source-badge">{source.role === "primaryFolder" ? "Primary Folder" : "External Attachment"}</span>
              </div>
              <small>{source.link.lastKnownPath}</small>
              {source.link.error && <p className="failure-message">{source.link.error}</p>}
              <button
                className="text-button"
                aria-label={`${source.link.accessStatus === "unavailable" ? "Retry" : "Open"} Linked Source ${source.name}`}
                onClick={() => void onOpen(source.id)}
              >{source.link.accessStatus === "unavailable" ? "Retry access" : "Open read-only"}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModelAccessPanel({ state, onState }: { state: LearningApplicationState; onState: StateHandler }) {
  if (state.modelAccess.status === "available") {
    return (
      <section className="model-access available" role="status" aria-labelledby="model-access-title">
        <div><p className="eyebrow">Model access</p><h2 id="model-access-title">Model teaching available</h2></div>
        <p>Codex-backed Teaching Cards and Pending Question submission are available.</p>
      </section>
    );
  }
  return (
    <section className="model-access unavailable" role="status" aria-labelledby="model-access-title">
      <div>
        <p className="eyebrow">Local capabilities remain available</p>
        <h2 id="model-access-title">Local Working Mode</h2>
        <p>{state.modelAccess.message}</p>
        <small>You can open, resume, search, and edit local sessions. Model teaching is unavailable.</small>
      </div>
      <button className="secondary" onClick={() => void window.quickStudy.submit({ type: "refreshAuthentication" }).then(onState)}>
        Check Codex access
      </button>
    </section>
  );
}

function AuthenticationPanel({ state, onState }: { state: LearningApplicationState; onState: StateHandler }) {
  const [apiKey, setApiKey] = useState("");
  const authentication = state.authentication;
  const signInWithChatGpt = async () => {
    const next = await window.quickStudy.submit({ type: "startChatGptLogin" });
    onState(next);
    if (next.authentication.loginUrl) await window.quickStudy.openExternal(next.authentication.loginUrl);
  };
  const useApiKey = async (event: FormEvent) => {
    event.preventDefault();
    const next = await window.quickStudy.submit({ type: "loginWithApiKey", apiKey });
    setApiKey("");
    onState(next);
  };

  return (
    <section className="authentication-card" aria-labelledby="authentication-title">
      <div>
        <p className="eyebrow">Codex Runtime</p>
        <h2 id="authentication-title">
          {!state.runtimeAvailable
            ? "Codex Runtime unavailable"
            : authentication.status === "signedIn"
            ? `Connected with ${authentication.method === "chatgpt" ? "ChatGPT subscription" : "API key"}`
            : "Connect Codex to begin teaching"}
        </h2>
        {authentication.status === "signedIn" ? (
          <p className="subtle">{authentication.accountLabel ?? "Codex owns this credential; Quick Study does not store it."}</p>
        ) : (
          <p className="subtle">Use included ChatGPT plan access or usage-based OpenAI API billing.</p>
        )}
        {authentication.error && <p className="failure-message" role="alert">{authentication.error}</p>}
      </div>
      {state.runtimeAvailable && authentication.status !== "signedIn" && (
        <div className="authentication-actions">
          <button className="primary" onClick={() => void signInWithChatGpt()}>Sign in with ChatGPT</button>
          <form className="api-key-form" onSubmit={(event) => void useApiKey(event)}>
            <label htmlFor="api-key">OpenAI API key</label>
            <div><input id="api-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
            <button className="secondary" disabled={!apiKey.trim()}>Use API key</button></div>
          </form>
          {authentication.status === "signingIn" && (
            <button className="text-button" onClick={() => void window.quickStudy.submit({ type: "refreshAuthentication" }).then(onState)}>
              I’ve completed sign-in
            </button>
          )}
        </div>
      )}
    </section>
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
      {session.teachingCard.status === "streaming" && (
        <div className="background-work" role="status">
          <span>Codex is teaching in the background</span>
          <button className="secondary" onClick={() => void window.quickStudy.submit({
            type: "cancelSessionModelWork",
            sessionId: session.id
          }).then(onState)}>Stop background teaching</button>
        </div>
      )}
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

function SessionSearch({ onState }: { onState: StateHandler }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SessionSearchResult[]>([]);
  useEffect(() => {
    let current = true;
    void window.quickStudy.searchSessions(query).then((matches) => {
      if (current) setResults(matches);
    });
    return () => { current = false; };
  }, [query]);
  return (
    <section className="search-card" aria-labelledby="session-search-title">
      <p className="eyebrow">Local session metadata</p>
      <h2 id="session-search-title">Find a Learning Session</h2>
      <label htmlFor="session-search">Search Learning Sessions</label>
      <input id="session-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      {query.trim() && (
        <ul className="search-results" aria-live="polite">
          {results.map((result) => (
            <li key={result.sessionId}>
              <button
                className="text-button"
                aria-label={`Open search result ${result.learningGoal}`}
                onClick={() => void window.quickStudy.submit({ type: "resumeSession", sessionId: result.sessionId }).then(onState)}
              >
                <strong>{result.learningGoal}</strong>
                <small>{result.workspaceName} · {result.missionName} · {result.sessionTarget}</small>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="subtle">No matching Learning Sessions.</li>}
        </ul>
      )}
    </section>
  );
}

function Intake({ state, onState }: { state: LearningApplicationState; onState: StateHandler }) {
  const [mathematics, setMathematics] = useState("");
  const modelAvailable = state.modelAccess.status === "available";
  const start = async (event: FormEvent) => {
    event.preventDefault();
    onState(await window.quickStudy.submit({
      type: modelAvailable ? "submitSessionIntake" : "startQuickStudy",
      mathematics
    }));
  };
  return (
    <section className="intake-card" aria-labelledby="intake-title">
      <p className="eyebrow">Session Intake</p>
      <h2 id="intake-title">Begin with the mathematics</h2>
      <p className="lede">Paste a question, proof, or expression. Codex proposes a focused Learning Session before teaching.</p>
      <form onSubmit={(event) => void start(event)}>
        <label htmlFor="mathematics">Typed mathematics</label>
        <textarea
          id="mathematics"
          value={mathematics}
          onChange={(event) => setMathematics(event.target.value)}
          placeholder="What would you like to understand?"
        />
        <div className="intake-actions">
          <span>{modelAvailable ? "Focused Access · no workspace setup required" : "Local Working Mode · local study remains available"}</span>
          <button className="primary" disabled={!mathematics.trim()}>{modelAvailable ? "Propose Learning Session" : "Start local Learning Session"}</button>
        </div>
        {state.intakeError && <p className="failure-message" role="alert">{state.intakeError}</p>}
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
              <div><strong>{session.learningGoal}</strong><small>{session.sessionTarget}</small>
                {session.teachingCard.status === "streaming" && <small>Codex teaching in background</small>}
              </div>
              <div className="session-actions">
                {session.teachingCard.status === "streaming" && <button className="secondary" onClick={() => void window.quickStudy.submit({
                  type: "cancelSessionModelWork",
                  sessionId: session.id
                }).then(onState)}>Stop</button>}
                <button className="text-button" aria-label={`Resume Learning Session ${session.learningGoal}`} onClick={() => void window.quickStudy.submit({
                  type: "resumeSession",
                  sessionId: session.id
                }).then(onState)}>Resume</button>
              </div>
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
  const [direction, setDirection] = useState(session.proposal.initialTeachingDirection);

  const saveProposal = (applyToTeaching = false) => window.quickStudy.submit({
      type: applyToTeaching ? "applySessionProposalRevision" : "reviseSessionProposal",
      learningGoal: goal,
      scope: target,
      initialTeachingDirection: direction
    });
  const leave = async () => {
    await saveProposal();
    onState(await window.quickStudy.submit({ type: "leaveSession" }));
  };
  const acceptProposal = async () => {
    await saveProposal();
    onState(await window.quickStudy.submit({ type: "confirmSessionProposal" }));
  };
  const saveLocalChanges = async () => {
    await window.quickStudy.submit({ type: "editLearningGoal", value: goal });
    onState(await window.quickStudy.submit({ type: "editSessionTarget", value: target }));
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
            <p className="proposal-label">Session Proposal</p>
            <label htmlFor="goal">Learning Goal</label>
            <textarea id="goal" className="field" value={goal} onChange={(event) => setGoal(event.target.value)} />
            <label htmlFor="target">Session Target</label>
            <textarea id="target" className="field" value={target} onChange={(event) => setTarget(event.target.value)} />
            <label htmlFor="direction">Initial teaching direction</label>
            <textarea id="direction" className="field" value={direction} disabled={state.modelAccess.status === "unavailable"} onChange={(event) => setDirection(event.target.value)} />
            {state.modelAccess.status === "available" && session.proposal.status === "awaitingConfirmation" ? (
              <>
                <p className="confirmation-reason">{session.proposal.confirmationReason}</p>
                <button className="primary proposal-action" disabled={!goal.trim() || !target.trim() || !direction.trim()} onClick={() => void acceptProposal()}>
                  Accept and start teaching
                </button>
              </>
            ) : state.modelAccess.status === "available" ? (
              <button className="secondary proposal-action" disabled={!goal.trim() || !target.trim() || !direction.trim()} onClick={() => void saveProposal(true).then(onState)}>
                Apply proposal changes
              </button>
            ) : (
              <button className="secondary proposal-action" disabled={!goal.trim() || !target.trim()} onClick={() => void saveLocalChanges()}>
                Save local session changes
              </button>
            )}
            <button className="secondary" onClick={() => void leave()}>Leave session</button>
          </aside>
          <section className="math-canvas">
            <div className="canvas-heading">
              <div><p className="eyebrow">Source Layer</p><h2>Your typed mathematics</h2></div>
              <span className="saved">Saved locally</span>
            </div>
            <article>{session.mathematics}</article>
            <p className="access-policy"><strong>Session Access Policy:</strong> Focused Access · only the mathematics pasted into this session</p>
            <ModelAccessPanel state={state} onState={onState} />
            <SessionRecord session={session} />
            <TeachingCard session={session} modelAvailable={state.modelAccess.status === "available"} onState={onState} />
            <AskBar session={session} modelAvailable={state.modelAccess.status === "available"} onState={onState} />
          </section>
        </div>
      </div>
    </main>
  );
}

function TeachingCard({ session, modelAvailable, onState }: { session: LearningSession; modelAvailable: boolean; onState: StateHandler }) {
  const card = session.teachingCard;
  if (session.proposal.status === "awaitingConfirmation" && modelAvailable) {
    return <div className="next-step"><span>Session Confirmation</span><strong>Review the proposal before Codex begins.</strong></div>;
  }
  if (!modelAvailable && card.status === "idle") {
    return (
      <section className="teaching-card unavailable" aria-label="Current Teaching Card">
        <p className="eyebrow">Model-dependent action</p>
        <h2 id="teaching-card-title">Model teaching unavailable</h2>
        <p className="subtle">No Teaching Card will be fabricated in Local Working Mode.</p>
      </section>
    );
  }
  return (
    <section className={`teaching-card ${card.status}`} aria-live="polite" aria-label="Current Teaching Card">
      <div className="card-heading">
        <div><p className="eyebrow">Teaching Card</p><h2 id="teaching-card-title">{session.learningGoal}</h2></div>
        <span className="saved">{teachingStatusLabel(card.status)}</span>
      </div>
      <div className="teaching-section">
        <h3>Explanation</h3>
        {card.content ? <div className="teaching-content">{card.content}</div> : card.status === "streaming" ? <p className="subtle">Codex is preparing the first teaching move…</p> : null}
      </div>
      <div className="teaching-section next-step"><span>Next step</span><strong>{session.returnContext.nextAction}</strong></div>
      {card.error && <p className="failure-message" role="alert">{card.error}</p>}
      <div className="teaching-actions">
        {card.status === "streaming" && <button className="secondary" onClick={() => void window.quickStudy.submit({ type: "cancelModelWork" }).then(onState)}>Stop teaching</button>}
        {card.retryable && modelAvailable && <button className="primary" onClick={() => void window.quickStudy.submit({ type: "retryModelWork" }).then(onState)}>Retry Teaching Card</button>}
      </div>
    </section>
  );
}

function SessionRecord({ session }: { session: LearningSession }) {
  if (session.submittedPendingQuestions.length === 0 && session.teachingCardHistory.length === 0) return null;
  return (
    <section className="session-record" aria-labelledby="session-record-title">
      <p className="eyebrow">Session Record</p>
      <h2 id="session-record-title">Submitted questions and earlier teaching</h2>
      {session.teachingCardHistory.map((card, index) => (
        <article key={`teaching-${index}`}>
          <h3>Earlier Teaching Card</h3>
          <p>{card.content || card.error}</p>
        </article>
      ))}
      {session.submittedPendingQuestions.map((submission) => (
        <article key={submission.id}>
          <h3>Submitted Pending Question</h3>
          <p>{submission.text}</p>
          <details>
            <summary>Teaching Card · {teachingStatusLabel(submission.teachingCard.status)}</summary>
            <p>{submission.teachingCard.content || submission.teachingCard.error || "Teaching has not produced content."}</p>
          </details>
        </article>
      ))}
    </section>
  );
}

function AskBar({ session, modelAvailable, onState }: {
  session: LearningSession;
  modelAvailable: boolean;
  onState: StateHandler;
}) {
  const pending = session.pendingQuestion;
  const [text, setText] = useState(pending?.text ?? "");
  useEffect(() => setText(pending?.text ?? ""), [pending?.id, pending?.text]);

  const save = () => window.quickStudy.submit({
    type: pending ? "editPendingQuestion" : "savePendingQuestion",
    text
  }).then(onState);
  const submitPending = async () => {
    if (text.trim() !== pending?.text) await window.quickStudy.submit({ type: "editPendingQuestion", text });
    onState(await window.quickStudy.submit({ type: "submitPendingQuestion" }));
  };
  const ask = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) {
      if (modelAvailable) await submitPending();
      else await save();
      return;
    }
    await save();
  };

  if (!pending && modelAvailable) return null;

  return (
    <section className="ask-bar" aria-labelledby="ask-bar-title">
      <p className="eyebrow">Ask Bar</p>
      <h2 id="ask-bar-title">{pending ? "Pending Question" : "Ask from this session context"}</h2>
      <form onSubmit={(event) => void ask(event)}>
        <label htmlFor="ask-bar-question">{pending ? "Pending Question text" : "Ask Bar question"}</label>
        <textarea id="ask-bar-question" value={text} onChange={(event) => setText(event.target.value)} />
        <div className="ask-actions">
          {pending && <button type="button" className="text-button" onClick={() => void window.quickStudy.submit({ type: "discardPendingQuestion" }).then(onState)}>Discard Pending Question</button>}
          <button className="primary" disabled={!text.trim()}>
            {pending ? (modelAvailable ? "Submit Pending Question" : "Save Pending Question changes") : "Save Pending Question"}
          </button>
        </div>
      </form>
    </section>
  );
}

function teachingStatusLabel(status: LearningSession["teachingCard"]["status"]): string {
  return ({ idle: "Ready", streaming: "Streaming", completed: "Complete", stopped: "Stopped", failed: "Needs attention" })[status];
}
