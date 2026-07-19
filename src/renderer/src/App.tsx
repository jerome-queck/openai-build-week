import { useEffect, useState, type FormEvent } from "react";
import type {
  AgentWorkLogEvidence,
  AnnotationPurpose,
  LearningApplicationState,
  LearningArtifact,
  LearningSession,
  LearnerAction,
  LinkedSource,
  LinkedSourceView,
  OpenedSourceSearchResult,
  SessionSearchResult,
  SourceSearchResult,
  StudyMission,
  StudyWorkspace,
  TargetDisposition
} from "../../shared/learning-application";
import { annotationPurposeLabel } from "../../shared/annotations";
import { sessionAccessPolicyLabel } from "../../shared/session-access";
import { SourceLayer } from "./SourceLayer";
import { ContextualInspector } from "./ContextualInspector";
import { AskBar } from "./AskBar";
import { TrailDraft } from "./TrailDraft";
import { AnnotationInspector } from "./AnnotationInspector";
import { ReanchoringReview } from "./ReanchoringReview";

type StateHandler = (state: LearningApplicationState) => void;

export function App() {
  const [state, setState] = useState<LearningApplicationState | null>(null);
  const [returnFocusAnchorId, setReturnFocusAnchorId] = useState<string | null>(null);

  useEffect(() => {
    void window.quickStudy.getState().then(setState);
    return window.quickStudy.onStateChanged(setState);
  }, []);

  if (!state) return <main className="loading">Opening Quick Study…</main>;
  if (state.screen === "workbench" && state.activeSessionId) {
    return <Workbench
      key={state.activeSessionId}
      state={state}
      onState={setState}
      returnFocusAnchorId={returnFocusAnchorId}
      onReturnFocusConsumed={() => setReturnFocusAnchorId(null)}
      onReturnToOrigin={(nextState, sourceAnchorId) => {
        setReturnFocusAnchorId(sourceAnchorId);
        setState(nextState);
      }}
    />;
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
          <ApplicationSettings state={state} onState={onState} />
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

function ApplicationSettings({ state, onState }: { state: LearningApplicationState; onState: StateHandler }) {
  return (
    <section className="settings-card" aria-labelledby="application-settings-title">
      <p className="eyebrow">Settings</p>
      <h2 id="application-settings-title">Application settings</h2>
      <label className="confirmation-preference">
        <input
          type="checkbox"
          checked={state.personalNoteSynthesisPreference.includePersonalNotes}
          onChange={(event) => void window.quickStudy.submit({
            type: "setPersonalNoteSynthesis",
            enabled: event.target.checked
          }).then(onState)}
        />
        Allow Personal Notes during artifact synthesis
      </label>
      <small>Enabled by default. Personal Notes remain excluded from ordinary Teaching Moves.</small>
    </section>
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
  const reanchoringReviews = state.reanchoringDecisions.filter(
    (decision) => (decision.status === "unresolved" || decision.status === "leftUnresolved")
    && linkedSources.some((source) => source.id === decision.sourceId));
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
  const locate = (sourceId: string) => runSourceAction(() => window.quickStudy.locateLinkedSource(sourceId));
  const preserveSnapshot = (sourceId: string) => runSourceAction(() => window.quickStudy.preserveSourceSnapshot(sourceId));

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
        revisions={state.sourceRevisions}
        assets={managedAssets}
        onLocate={locate}
        onPreserveSnapshot={preserveSnapshot}
      />
      <SourceGroup
        title="External Attachments"
        empty="No individual files linked outside the Primary Folder."
        sources={attachments}
        onOpen={open}
        revisions={state.sourceRevisions}
        assets={managedAssets}
        onLocate={locate}
        onPreserveSnapshot={preserveSnapshot}
      />
      {reanchoringReviews.length > 0 && <section className="reanchoring-reviews" aria-labelledby="reanchoring-reviews-title">
        <div className="card-heading">
          <div><p className="eyebrow">Changed source protection</p><h3 id="reanchoring-reviews-title">Unresolved Anchors</h3></div>
          <span className="source-badge">{reanchoringReviews.filter((review) => review.status === "unresolved").length} to review</span>
        </div>
        <p className="subtle">These old locations are discoverable but are not used as current source context until you confirm a match.</p>
        {reanchoringReviews.map((decision) => {
          const session = state.sessions.find((candidate) => candidate.id === decision.sessionId);
          const source = linkedSources.find((candidate) => candidate.id === decision.sourceId)!;
          const cards = session?.anchoredTeachingCards.filter((card) => card.sourceAnchorId === decision.sourceAnchorId)
            .map((card) => card.title) ?? [];
          const annotations = session?.annotations.filter((annotation) => annotation.sourceAnchorId === decision.sourceAnchorId)
            .map((annotation) => `${annotationPurposeLabel(annotation.purpose)}: ${annotation.content}`) ?? [];
          const trailItems = session?.trailDraft.items.filter(
            (item) => item.links.sourceAnchorIds.includes(decision.sourceAnchorId)
          ).map((item) => `${item.kind}: ${item.content}`) ?? [];
          return <ReanchoringReview key={decision.id} decision={decision} sourceName={source.name}
            affectedTeachingCards={cards} affectedAnnotations={annotations} affectedTrailItems={trailItems}
            sourceView={view?.status === "available" && view.sourceId === source.id ? view : null}
            onOpenSource={() => open(source.id)}
            onResolve={async (action) => onState(await window.quickStudy.submit(action))} />;
        })}
      </section>}
      <div className="source-group">
        <h3>Managed Assets</h3>
        {managedAssets.length === 0 ? <p className="subtle">No fileless input retained here.</p> : (
          <ul className="source-list">
            {managedAssets.map((asset) => (
              <li key={asset.id}>
                <div><strong>{asset.name}</strong><span className="source-badge managed">
                  {asset.sourceSnapshot ? "Source Snapshot" : "Managed Asset"}
                </span></div>
                {asset.sourceSnapshot ? <p>Preserves Source Revision {asset.sourceSnapshot.sourceRevisionId} of Linked Source {
                  linkedSources.find((source) => source.id === asset.sourceSnapshot?.linkedSourceId)?.name ?? asset.sourceSnapshot.linkedSourceId
                }.</p> : <p>{asset.content}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <SourceIndexPanel workspace={workspace} state={state} onState={onState} />
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

function SourceIndexPanel({ workspace, state, onState }: {
  workspace: StudyWorkspace;
  state: LearningApplicationState;
  onState: StateHandler;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SourceSearchResult[]>([]);
  const [opened, setOpened] = useState<OpenedSourceSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sources = state.sources.filter((source): source is LinkedSource =>
    source.kind === "linkedSource" && source.workspaceId === workspace.id
  );
  const runIndexMutation = async (label: string, action: () => Promise<LearningApplicationState>) => {
    setError(null);
    setBusy(label);
    try {
      const nextState = await action();
      onState(nextState);
      setResults([]);
      setOpened(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Source Index could not be updated.");
    } finally {
      setBusy(null);
    }
  };
  const search = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setOpened(null);
    setBusy("Searching indexed source content…");
    try {
      setResults(await window.quickStudy.searchSourceIndex(workspace.id, query));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Source Index could not be searched.");
    } finally {
      setBusy(null);
    }
  };
  const openResult = async (resultId: string) => {
    setError(null);
    setBusy("Opening the indexed source location…");
    try {
      setOpened(await window.quickStudy.openSourceSearchResult(resultId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Source Index result could not be opened.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="source-index" aria-labelledby="source-index-title">
      <div className="card-heading">
        <div><p className="eyebrow">Rebuildable local search</p><h3 id="source-index-title">Source Index</h3></div>
        <span className="saved">Derived data, not a source copy</span>
      </div>
      {sources.length === 0 ? <p className="subtle">Link a supported file to build searchable source data.</p> : (
        <ul className="source-index-statuses" aria-live="polite">
          {sources.map((source) => {
            const status = state.sourceIndexes.find((candidate) => candidate.sourceId === source.id);
            const label = status?.status === "ready"
              ? `Ready · ${status.pageCount} ${status.pageCount === 1 ? "page" : "pages"} · ${status.equationCount} ${status.equationCount === 1 ? "equation region" : "equation regions"}`
              : status?.status === "cleared" ? "Search data unavailable · rebuild required"
                : status?.status === "unavailable" ? "Search data unavailable" : "Not indexed";
            const shouldRebuild = status?.status === "ready" || status?.status === "cleared";
            return (
              <li key={source.id}>
                <div><strong>{source.name}</strong><span>{label}</span></div>
                {status?.error && <p className="failure-message">{status.error}</p>}
                <div className="source-actions">
                  <button className="secondary" aria-label={`${shouldRebuild ? "Rebuild" : "Build"} Source Index for ${source.name}`}
                    disabled={Boolean(busy)}
                    onClick={() => void runIndexMutation(shouldRebuild ? "Rebuilding the Source Index…" : "Building the Source Index…", () => shouldRebuild
                      ? window.quickStudy.rebuildSourceIndex(source.id)
                      : window.quickStudy.indexSource(source.id))}>
                    {shouldRebuild ? "Rebuild index" : "Build index"}
                  </button>
                  <button className="text-button" aria-label={`Clear Source Index for ${source.name}`}
                    disabled={Boolean(busy) || !status || status.status === "cleared"}
                    onClick={() => void runIndexMutation("Clearing the Source Index…", () => window.quickStudy.clearSourceIndex(source.id))}>Clear index</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form className="source-index-search" onSubmit={(event) => void search(event)}>
        <label htmlFor={`source-index-search-${workspace.id}`}>Search indexed source content</label>
        <div>
          <input id={`source-index-search-${workspace.id}`} type="search" value={query} disabled={Boolean(busy)}
            onChange={(event) => setQuery(event.target.value)} />
          <button className="primary" type="submit" disabled={Boolean(busy)}>Search sources</button>
        </div>
      </form>
      {results.length > 0 && (
        <ul className="source-index-results" aria-live="polite">
          {results.map((result) => (
            <li key={result.id}>
              <img src={result.thumbnailDataUrl} alt="" />
              <button className="text-button" aria-label={`Open source result ${result.sourceName}, ${result.locationLabel}: ${result.preview}`}
                disabled={Boolean(busy)}
                onClick={() => void openResult(result.id)}>
                <strong>{result.sourceName} · {result.locationLabel}</strong>
                <span>{result.preview}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results.length === 0 && query.trim() && <p className="subtle" role="status">No indexed source matches.</p>}
      {busy && <p className="subtle" role="status" aria-live="polite">{busy}</p>}
      {opened?.status === "available" && (
        <section className="source-index-opened" aria-label="Opened Source Index result">
          <h4>Source location</h4>
          {opened.mediaType === "text/plain" ? (
            <SourceLayer sourceId={opened.sourceId} content={opened.content} anchors={[]}
              highlight={opened.highlight?.sourceStartOffset === undefined || opened.highlight.sourceEndOffset === undefined
                ? undefined
                : {
                    startOffset: opened.highlight.sourceStartOffset,
                    endOffset: opened.highlight.sourceEndOffset,
                    exactText: opened.highlight.exactText
                  }}
              onChooseAction={() => undefined} />
          ) : opened.highlight ? (
            <figure className="indexed-visual-match">
              <div>
                <img src={opened.highlight.thumbnailDataUrl} alt={`Indexed source page ${opened.highlight.pageNumber}`} />
                <span aria-label="Opened Source Index visual match" style={{
                  left: `${opened.highlight.bounds.x * 100}%`,
                  top: `${opened.highlight.bounds.y * 100}%`,
                  width: `${opened.highlight.bounds.width * 100}%`,
                  height: `${opened.highlight.bounds.height * 100}%`
                }} />
              </div>
              <figcaption>Page {opened.highlight.pageNumber}: {opened.highlight.exactText}</figcaption>
            </figure>
          ) : <p className="failure-message">The indexed source location is unavailable.</p>}
        </section>
      )}
      {opened?.status === "unavailable" && <p className="failure-message" role="alert">{opened.error}</p>}
      {error && <p className="failure-message" role="alert">{error}</p>}
    </section>
  );
}

function SourceGroup({ title, empty, sources, revisions, assets, onOpen, onLocate, onPreserveSnapshot }: {
  title: string;
  empty: string;
  sources: Array<Extract<LearningApplicationState["sources"][number], { kind: "linkedSource" }>>;
  revisions: LearningApplicationState["sourceRevisions"];
  assets: Array<Extract<LearningApplicationState["sources"][number], { kind: "managedAsset" }>>;
  onOpen(sourceId: string): Promise<void>;
  onLocate(sourceId: string): Promise<void>;
  onPreserveSnapshot(sourceId: string): Promise<void>;
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
              {source.link.accessStatus === "unavailable" && <button className="text-button"
                aria-label={`Locate Linked Source ${source.name} again`}
                onClick={() => void onLocate(source.id)}>Locate again</button>}
              {source.link.accessStatus === "available" && <button className="text-button"
                aria-label={`Preserve current Source Revision for ${source.name}`}
                onClick={() => void onPreserveSnapshot(source.id)}>Preserve source snapshot</button>}
              <ul aria-label={`Source Revisions for ${source.name}`}>
                {revisions.filter((revision) => revision.sourceId === source.id).map((revision) => {
                  const snapshot = revision.snapshotAssetId
                    ? assets.find((asset) => asset.id === revision.snapshotAssetId)
                    : null;
                  const current = revision.id === source.link.currentRevisionId;
                  return <li key={revision.id}>
                    <strong>{current ? "Current Source Revision" : "Historical Source Revision"}</strong>
                    {snapshot ? <span> Preserved by Source Snapshot {snapshot.name}.</span>
                      : current ? <span> Not preserved as a Source Snapshot.</span>
                        : <span> Historical content unavailable — this Source Revision was not preserved as a Source Snapshot. Source Index and Source Fingerprint are not backups.</span>}
                  </li>;
                })}
              </ul>
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
                                {session.status === "consolidated" ? (
                                  <span className="consolidated-nav-item">{session.learningGoal}<small>Consolidated Session Outcome</small></span>
                                ) : <button
                                  aria-label={session.prerequisiteBranch
                                    ? `Resume Prerequisite Branch ${session.prerequisiteBranch.prerequisite}, linked from ${
                                      state.sessions.find((candidate) => candidate.id === session.prerequisiteBranch?.returnPoint.originSessionId)?.learningGoal
                                        ?? "originating Learning Session"
                                    }`
                                    : `Resume grouped Learning Session ${session.learningGoal}`}
                                  onClick={() => void window.quickStudy.submit({
                                    type: "resumeSession",
                                    sessionId: session.id
                                  }).then(onState)}
                                >
                                  {session.learningGoal}
                                  {session.prerequisiteBranch && <small>Prerequisite Branch · {session.prerequisiteBranch.prerequisite}</small>}
                                </button>}
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
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
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
      {hasBackgroundModelWork(session) && (
        <div className="background-work" role="status">
          <span>{backgroundModelWorkLabel(session)}</span>
          <button className="secondary" onClick={() => void window.quickStudy.submit({
            type: "cancelSessionModelWork", sessionId: session.id
          }).then(onState).catch((cause: unknown) => setBackgroundError(
            cause instanceof Error ? cause.message : "The model work could not be stopped."
          ))}>{backgroundModelWorkStopLabel(session)}</button>
        </div>
      )}
      {backgroundError && <p className="failure-message" role="alert">{backgroundError}</p>}
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
                onClick={() => void window.quickStudy.submit(result.status === "consolidated"
                  ? { type: "navigateToMission", workspaceId: result.workspaceId, missionId: result.missionId }
                  : { type: "resumeSession", sessionId: result.sessionId }).then(onState)}
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
  const workspace = state.workspaces.find((candidate) => candidate.id === state.navigation.workspaceId)!;
  const mission = state.missions.find((candidate) => candidate.id === state.navigation.missionId) ?? null;
  const location = workspace.kind === "named" && mission
    ? { workspaceId: workspace.id, missionId: mission.id }
    : undefined;
  const initialAccess = location ? "Workspace Access" : "Focused Access";
  const start = async (event: FormEvent) => {
    event.preventDefault();
    onState(await window.quickStudy.submit({
      type: modelAvailable ? "submitSessionIntake" : "startQuickStudy",
      mathematics,
      ...(location ? { location } : {})
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
          <span>{modelAvailable ? `${initialAccess} · ${location ? `${workspace.name} · ${mission!.name}` : "no workspace setup required"}` : `Local Working Mode · ${initialAccess}`}</span>
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

function ModelStopConfirmationNotice({ session, onState, onError }: {
  session: LearningSession;
  onState: StateHandler;
  onError(message: string): void;
}) {
  const confirmation = session.modelStopConfirmation;
  if (!confirmation) return null;
  return (
    <div className="model-stop-confirmation" role={confirmation.status === "unconfirmed" ? "alert" : "status"}>
      <span>{confirmation.message}</span>
      {confirmation.status === "unconfirmed" && (
        <button className="secondary" aria-label={`Retry Codex interruption for ${session.learningGoal}`}
          onClick={() => void window.quickStudy.submit({ type: "retrySessionModelStop", sessionId: session.id })
            .then(onState).catch((cause: unknown) => onError(
              cause instanceof Error ? cause.message : "Codex interruption could not be retried."
            ))}>Retry interruption</button>
      )}
    </div>
  );
}

function MissionHistory({ workspace, mission, state, onState }: {
  workspace: StudyWorkspace;
  mission: StudyMission | null;
  state: LearningApplicationState;
  onState: StateHandler;
}) {
  const [modelWorkError, setModelWorkError] = useState<string | null>(null);
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
                {hasBackgroundModelWork(session) && <small>{backgroundModelWorkLabel(session)}</small>}
              </div>
              <div className="session-actions">
                {hasBackgroundModelWork(session) && <button className="secondary" onClick={() => void window.quickStudy.submit({
                  type: "cancelSessionModelWork", sessionId: session.id
                }).then(onState).catch((cause: unknown) => setModelWorkError(
                  cause instanceof Error ? cause.message : "The model work could not be stopped."
                ))}>{backgroundModelWorkStopLabel(session)}</button>}
                {session.status === "consolidated" ? (
                  <button className="primary" aria-label={`Continue this work from ${session.learningGoal}`} onClick={() => void window.quickStudy.submit({
                    type: "continueSession", sessionId: session.id
                  }).then(onState).catch((cause: unknown) => setModelWorkError(
                    cause instanceof Error ? cause.message : "The Continuation Session could not be started."
                  ))}>Continue this work</button>
                ) : <button className="text-button" aria-label={`Resume Learning Session ${session.learningGoal}`} onClick={() => void window.quickStudy.submit({
                    type: "resumeSession", sessionId: session.id
                  }).then(onState)}>Resume</button>}
              </div>
              <ModelStopConfirmationNotice session={session} onState={onState} onError={setModelWorkError} />
              {session.consolidatedOutcome && <ConsolidatedOutcome state={state} session={session} onState={onState} />}
            </li>
          ))}
        </ul>
      )}
      {modelWorkError && <p className="failure-message" role="alert">{modelWorkError}</p>}
    </section>
  );
}

function Workbench({ state, onState, returnFocusAnchorId, onReturnFocusConsumed, onReturnToOrigin }: {
  state: LearningApplicationState;
  onState: StateHandler;
  returnFocusAnchorId: string | null;
  onReturnFocusConsumed(): void;
  onReturnToOrigin(state: LearningApplicationState, sourceAnchorId: string): void;
}) {
  const session = state.sessions.find((candidate) => candidate.id === state.activeSessionId)!;
  const workspace = state.workspaces.find((candidate) => candidate.id === session.workspaceId)!;
  const mission = state.missions.find((candidate) => candidate.id === session.missionId)!;
  const [goal, setGoal] = useState(session.learningGoal);
  const [target, setTarget] = useState(session.sessionTarget);
  const [direction, setDirection] = useState(session.proposal.initialTeachingDirection);
  const [restoringReturnPoint] = useState(Boolean(returnFocusAnchorId));
  const [inspectorCardId, setInspectorCardId] = useState<string | null>(
    returnFocusAnchorId ? session.activeTeachingCardId : null
  );
  const [annotationAnchorId, setAnnotationAnchorId] = useState<string | null>(null);
  const [annotationPurpose, setAnnotationPurpose] = useState<AnnotationPurpose>("personalNote");
  const [focusAnchorId, setFocusAnchorId] = useState<string | null>(returnFocusAnchorId);
  const [workbenchError, setWorkbenchError] = useState<string | null>(null);
  const inspectorCard = session.anchoredTeachingCards.find((card) => card.id === inspectorCardId) ?? null;
  const inspectorArtifact = inspectorCard?.artifactId
    ? session.learningArtifacts.find((artifact) => artifact.id === inspectorCard.artifactId) ?? null
    : null;
  const annotationAnchor = session.sourceAnchors.find((anchor) => anchor.id === annotationAnchorId) ?? null;
  useEffect(() => {
    if (returnFocusAnchorId) onReturnFocusConsumed();
  }, []);

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
  const beginConsolidation = async () => {
    await saveProposal();
    onState(await window.quickStudy.submit({ type: "beginSessionConsolidation" }));
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
            <button className="primary" disabled={Boolean(session.consolidationDraft)} onClick={() => void beginConsolidation()}>
              {session.consolidationDraft ? "Consolidation review open" : "Finish & consolidate"}
            </button>
            <ReasoningControls state={state} session={session} onState={onState} />
            <ModelStopConfirmationNotice session={session} onState={onState} onError={setWorkbenchError} />
          </aside>
          <section className="math-canvas">
            <ContinuationContext state={state} session={session} />
            {session.consolidationDraft && <SessionConsolidation session={session} onState={onState} />}
            <PrerequisiteNavigation
              state={state}
              session={session}
              onState={onState}
              onReturnToOrigin={onReturnToOrigin}
              onShowSourceAnchor={(sourceAnchorId) => {
                setFocusAnchorId(sourceAnchorId);
                void window.quickStudy.submit({ type: "activateSourceAnchor", sourceAnchorId })
                  .then(onState)
                  .catch((error: unknown) => setWorkbenchError(
                    error instanceof Error ? error.message : "The Source Anchor could not be shown."
                  ));
              }}
            />
            <div className="canvas-heading">
              <div><p className="eyebrow">Source Layer</p><h2>Session source</h2></div>
              <span className="saved">Saved locally</span>
            </div>
            {session.learningSlice && <ArgumentRoadmapPanel state={state} session={session} onState={onState} />}
            <WorkbenchSourceLayer state={state} session={session} onState={onState}
              focusAnchorId={focusAnchorId}
              onTeachingCardCreated={(teachingCardId) => {
                setInspectorCardId(teachingCardId);
                setAnnotationAnchorId(null);
              }}
              onAnnotationRequested={(sourceAnchorId, purpose) => {
                setAnnotationAnchorId(sourceAnchorId);
                setAnnotationPurpose(purpose);
                setInspectorCardId(null);
              }}
              onActivateAnchor={(sourceAnchorId) => {
                const card = session.anchoredTeachingCards.find((candidate) => candidate.sourceAnchorId === sourceAnchorId);
                const hasAnnotations = session.annotations.some((annotation) => annotation.sourceAnchorId === sourceAnchorId);
                setFocusAnchorId(null);
                setInspectorCardId(card?.id ?? null);
                setAnnotationAnchorId(hasAnnotations ? sourceAnchorId : null);
                setWorkbenchError(null);
                void window.quickStudy.submit({ type: "activateSourceAnchor", sourceAnchorId })
                  .then(onState)
                  .catch((error: unknown) => setWorkbenchError(
                    error instanceof Error ? error.message : "The Source Anchor could not be activated."
                  ));
              }} />
            {workbenchError && <p className="failure-message" role="alert">{workbenchError}</p>}
            {session.learningArtifacts.map((artifact) => <PinnedLearningArtifact artifact={artifact} onState={onState}
              modelAvailable={state.modelAccess.status === "available"} key={artifact.id} />)}
            {!session.consolidationDraft && <TrailDraft session={session} onAction={async (action) => {
              onState(await window.quickStudy.submit(action));
            }} onActivateSourceAnchor={async (sourceAnchorId) => {
              setFocusAnchorId(sourceAnchorId);
              setInspectorCardId(null);
              onState(await window.quickStudy.submit({ type: "activateSourceAnchor", sourceAnchorId }));
            }} onOpenTeachingCard={async (teachingCardId) => {
              const card = session.anchoredTeachingCards.find((candidate) => candidate.id === teachingCardId);
              if (!card) throw new Error("Choose a linked Teaching Card in this Learning Session.");
              setFocusAnchorId(null);
              setInspectorCardId(card.id);
              onState(await window.quickStudy.submit({ type: "activateSourceAnchor", sourceAnchorId: card.sourceAnchorId }));
            }} />}
            <SessionAccessPanel state={state} session={session} onState={onState} />
            <ModelAccessPanel state={state} onState={onState} />
            <SessionRecord session={session} />
            <TeachingCard session={session} modelAvailable={state.modelAccess.status === "available"} onState={onState} />
            <AskBar
              session={session}
              modelAvailable={state.modelAccess.status === "available"}
              onSetContext={async (contextId, included) => onState(await window.quickStudy.submit({
                type: "setAskBarContextItem", contextId, included
              }))}
              onSubmit={async (text) => {
                if (session.pendingQuestion) {
                  if (text !== session.pendingQuestion.text) {
                    await window.quickStudy.submit({ type: "editPendingQuestion", text });
                  }
                  onState(await window.quickStudy.submit({ type: "submitPendingQuestion" }));
                  return;
                }
                onState(await window.quickStudy.submit({ type: "submitQuestion", text }));
              }}
              onSavePending={async (text) => onState(await window.quickStudy.submit({
                type: session.pendingQuestion ? "editPendingQuestion" : "savePendingQuestion", text
              }))}
              onDiscardPending={async () => onState(await window.quickStudy.submit({ type: "discardPendingQuestion" }))}
              onStartNewQuestion={async () => onState(await window.quickStudy.submit({ type: "startNewQuestion" }))}
              onRetry={async (cardId) => onState(await window.quickStudy.submit({ type: "retryQuestionCard", cardId }))}
            />
          </section>
          {inspectorCard && <ContextualInspector
            card={inspectorCard}
            artifact={inspectorArtifact}
            autoFocusClose={!restoringReturnPoint}
            onClose={() => {
              setInspectorCardId(null);
              setFocusAnchorId(inspectorCard.sourceAnchorId);
            }}
            onRevise={async (instruction) => onState(await window.quickStudy.submit({
              type: "reviseTeachingCard", cardId: inspectorCard.id, instruction
            }))}
            onRestore={async (revisionId) => onState(await window.quickStudy.submit({
              type: "restoreTeachingCardRevision", cardId: inspectorCard.id, revisionId
            }))}
            onCreateVariant={async (name, instruction) => onState(await window.quickStudy.submit({
              type: "createTeachingVariant", cardId: inspectorCard.id, name, instruction
            }))}
            onRetry={async (variantId) => onState(await window.quickStudy.submit({
              type: "retryAnchoredTeachingCard", cardId: inspectorCard.id, ...(variantId ? { variantId } : {})
            }))}
            onPin={async (artifactKind) => onState(await window.quickStudy.submit({
              type: "pinTeachingCardArtifact", cardId: inspectorCard.id, artifactKind
            }))}
          />}
          {annotationAnchor && <AnnotationInspector
            anchorLabel={annotationAnchorLabel(annotationAnchor)}
            annotations={session.annotations.filter((annotation) => annotation.sourceAnchorId === annotationAnchor.id)}
            initialPurpose={annotationPurpose}
            onClose={() => {
              setAnnotationAnchorId(null);
              setFocusAnchorId(annotationAnchor.id);
            }}
            onCreate={async (purpose, content) => onState(await window.quickStudy.submit({
              type: "createAnnotation", sourceAnchorId: annotationAnchor.id, purpose, content
            }))}
            onConvert={async (annotationId, purpose) => onState(await window.quickStudy.submit({
              type: "convertAnnotation", annotationId, purpose
            }))}
          />}
        </div>
      </div>
    </main>
  );
}

function ReasoningControls({ state, session, onState }: {
  state: LearningApplicationState;
  session: LearningSession;
  onState: StateHandler;
}) {
  const defaultModel = session.runtimeOverride?.model
    ?? state.runtimeCapabilities.models.find((model) => model.isDefault)?.model
    ?? state.runtimeCapabilities.models[0]?.model
    ?? "";
  const [model, setModel] = useState(defaultModel);
  const selectedModel = state.runtimeCapabilities.models.find((candidate) => candidate.model === model) ?? null;
  const defaultEffort = session.runtimeOverride?.model === model
    ? session.runtimeOverride.reasoningEffort
    : selectedModel?.supportedReasoningEfforts[0] ?? "medium";
  const [effort, setEffort] = useState(defaultEffort);
  const chooseModel = (nextModel: string) => {
    setModel(nextModel);
    const capability = state.runtimeCapabilities.models.find((candidate) => candidate.model === nextModel);
    setEffort(capability?.supportedReasoningEfforts[0] ?? "medium");
  };
  return (
    <section className="reasoning-controls" aria-labelledby="reasoning-controls-title">
      <h2 id="reasoning-controls-title">Reasoning choices</h2>
      <fieldset>
        <legend>Reasoning Preference</legend>
        {(["faster", "balanced", "deeper"] as const).map((preference) => (
          <label key={preference}>
            <input type="radio" name="reasoning-preference" value={preference}
              checked={session.reasoningPreference === preference}
              onChange={() => void window.quickStudy.submit({ type: "setReasoningPreference", preference }).then(onState)} />
            {preference[0].toUpperCase() + preference.slice(1)}
          </label>
        ))}
      </fieldset>
      <p className="subtle">This biases later automatic Agent Budgets; it does not promise one exact model or effort.</p>
      {state.runtimeCapabilities.models.length > 0 && <details>
        <summary>Advanced Runtime Override</summary>
        <label htmlFor="runtime-model">Runtime model</label>
        <select id="runtime-model" value={model} onChange={(event) => chooseModel(event.target.value)}>
          {state.runtimeCapabilities.models.map((capability) => (
            <option key={capability.model} value={capability.model}>{capability.displayName}</option>
          ))}
        </select>
        <label htmlFor="runtime-reasoning">Runtime reasoning</label>
        <select id="runtime-reasoning" value={effort} onChange={(event) => setEffort(event.target.value as typeof effort)}>
          {selectedModel?.supportedReasoningEfforts.map((reasoningEffort) => (
            <option key={reasoningEffort} value={reasoningEffort}>{reasoningEffort}</option>
          ))}
        </select>
        <div className="teaching-actions">
          <button className="secondary" disabled={!model || !selectedModel?.supportedReasoningEfforts.includes(effort)}
            onClick={() => void window.quickStudy.submit({ type: "setRuntimeOverride", override: { model, reasoningEffort: effort } }).then(onState)}>
            Apply Runtime Override
          </button>
          {session.runtimeOverride && <button className="secondary"
            onClick={() => void window.quickStudy.submit({ type: "setRuntimeOverride", override: null }).then(onState)}>
            Use automatic routing
          </button>}
        </div>
      </details>}
    </section>
  );
}

function ContinuationContext({ state, session }: { state: LearningApplicationState; session: LearningSession }) {
  if (!session.continuationOf) return null;
  const historical = state.sessions.find((candidate) => candidate.id === session.continuationOf?.sessionId);
  const outcome = historical?.consolidatedOutcome;
  if (!historical || !outcome || outcome.id !== session.continuationOf.outcomeId) return null;
  const evidence = outcome.trailItems.filter((item) => item.kind === "evidence");
  const artifacts = historical.learningArtifacts.filter((artifact) => outcome.includedArtifactIds.includes(artifact.id));
  return (
    <section className="continuation-context" aria-label="Continuation context">
      <p className="eyebrow">Linked Continuation Session</p>
      <h2>Continue from the prior outcome</h2>
      <p>{outcome.centralInsight}</p>
      {outcome.unresolvedQuestions.length > 0 && <p><strong>Unresolved:</strong> {outcome.unresolvedQuestions.join("; ")}</p>}
      <p><strong>Next step:</strong> {outcome.nextStep}</p>
      {historical.prerequisiteBranch && <p><strong>Return Point:</strong> {historical.prerequisiteBranch.returnPoint.label}</p>}
      {evidence.length > 0 && <p><strong>Trail evidence:</strong> {evidence.map((item) => item.content).join("; ")}</p>}
      {artifacts.length > 0 && <p><strong>Included Learning Artifacts:</strong> {artifacts.map((artifact) => artifact.title).join("; ")}</p>}
      <small>The prior Session Record remains a separate stable historical record.</small>
    </section>
  );
}

function SessionConsolidation({ session, onState }: { session: LearningSession; onState: StateHandler }) {
  const draft = session.consolidationDraft!;
  const [centralInsight, setCentralInsight] = useState(draft.centralInsight);
  const [learningProgress, setLearningProgress] = useState(draft.learningProgress);
  const [unresolvedQuestions, setUnresolvedQuestions] = useState(draft.unresolvedQuestions.join("\n"));
  const [nextStep, setNextStep] = useState(draft.nextStep);
  const [includedArtifactIds, setIncludedArtifactIds] = useState(draft.includedArtifactIds);
  const [targetDisposition, setTargetDisposition] = useState<TargetDisposition | null>(draft.targetDisposition);
  const [error, setError] = useState<string | null>(null);
  const consolidate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await window.quickStudy.submit({
        type: "reviseSessionConsolidation",
        centralInsight,
        learningProgress,
        unresolvedQuestions: unresolvedQuestions.split("\n").map((question) => question.trim()).filter(Boolean),
        nextStep,
        includedArtifactIds,
        targetDisposition
      });
      onState(await window.quickStudy.submit({ type: "consolidateSession" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Session Consolidation could not be saved.");
    }
  };
  return (
    <section className="session-consolidation" aria-labelledby="session-consolidation-title">
      <p className="eyebrow">Learner-controlled checkpoint</p>
      <h2 id="session-consolidation-title">Session Consolidation</h2>
      <p>Review and revise what this Learning Session should retain. Consolidated is a lifecycle state, not a claim of mastery.</p>
      <TrailDraft session={session} onAction={async (action) => onState(await window.quickStudy.submit(action))}
        onActivateSourceAnchor={async (sourceAnchorId) => onState(await window.quickStudy.submit({ type: "activateSourceAnchor", sourceAnchorId }))}
        onOpenTeachingCard={async (teachingCardId) => {
          const card = session.anchoredTeachingCards.find((candidate) => candidate.id === teachingCardId);
          if (!card) throw new Error("Choose a linked Teaching Card in this Learning Session.");
          onState(await window.quickStudy.submit({ type: "activateSourceAnchor", sourceAnchorId: card.sourceAnchorId }));
        }} />
      <form onSubmit={(event) => void consolidate(event)}>
        <label htmlFor="central-insight">Central insight</label>
        <textarea id="central-insight" value={centralInsight} onChange={(event) => setCentralInsight(event.target.value)} />
        <label htmlFor="learning-progress">Learning Progress</label>
        <textarea id="learning-progress" value={learningProgress} onChange={(event) => setLearningProgress(event.target.value)} />
        <label htmlFor="unresolved-questions">Unresolved questions</label>
        <textarea id="unresolved-questions" value={unresolvedQuestions} onChange={(event) => setUnresolvedQuestions(event.target.value)} />
        <label htmlFor="next-step">Next step</label>
        <textarea id="next-step" value={nextStep} onChange={(event) => setNextStep(event.target.value)} />
        <fieldset>
          <legend>Included Learning Artifacts</legend>
          {session.learningArtifacts.length === 0 ? <p>No Learning Artifacts are available to include.</p> : session.learningArtifacts.map((artifact) => (
            <label key={artifact.id}><input type="checkbox" checked={includedArtifactIds.includes(artifact.id)} onChange={(event) => {
              setIncludedArtifactIds((current) => event.target.checked
                ? [...current, artifact.id]
                : current.filter((artifactId) => artifactId !== artifact.id));
            }} />{artifact.title}</label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Session Target disposition</legend>
          {(["addressed", "deferred", "unresolved"] as const).map((disposition) => (
            <label key={disposition}><input type="radio" name="target-disposition" value={disposition}
              checked={targetDisposition === disposition} onChange={() => setTargetDisposition(disposition)} />
              {disposition[0].toUpperCase() + disposition.slice(1)}</label>
          ))}
          <p>Addressed means sufficient for now. None of these choices asserts mastery.</p>
        </fieldset>
        <button className="primary" disabled={!centralInsight.trim() || !nextStep.trim() || !targetDisposition}>
          Create Consolidated Session Outcome
        </button>
        {error && <p className="failure-message" role="alert">{error}</p>}
      </form>
    </section>
  );
}

function ConsolidatedOutcome({ state, session, onState }: {
  state: LearningApplicationState;
  session: LearningSession;
  onState: StateHandler;
}) {
  const outcome = session.consolidatedOutcome!;
  const includedArtifacts = session.learningArtifacts.filter((artifact) => outcome.includedArtifactIds.includes(artifact.id));
  const essentialReasoning = outcome.trailItems.filter((item) => item.kind === "reasoningStep").map((item) => item.content);
  return (
    <article className="consolidated-outcome" aria-label={`Consolidated Session Outcome ${session.learningGoal}`}>
      <p className="eyebrow">Consolidated Session Outcome</p>
      <h3>Trail Overview</h3>
      <dl>
        <div><dt>Learning Goal</dt><dd>{session.learningGoal}</dd></div>
        <div><dt>Central insight</dt><dd>{outcome.centralInsight}</dd></div>
        <div><dt>Essential reasoning path</dt><dd>{essentialReasoning.join(" → ") || "No reasoning steps retained."}</dd></div>
        <div><dt>Learning Progress</dt><dd>{outcome.learningProgress || "No demonstrated Learning Progress retained."}</dd></div>
        <div><dt>Unresolved points</dt><dd>{outcome.unresolvedQuestions.join("; ") || "None recorded."}</dd></div>
        <div><dt>Next step</dt><dd>{outcome.nextStep}</dd></div>
        <div><dt>Target Disposition</dt><dd>{outcome.targetDisposition} · not a mastery claim</dd></div>
      </dl>
      <details>
        <summary>Expand complete outcome details</summary>
        <h4>Learning Trail</h4>
        <ul>{outcome.trailItems.map((item) => <TrailItemOutcomeDetail key={item.id} item={item} session={session} />)}</ul>
        <h4>Included Learning Artifacts</h4>
        {includedArtifacts.length ? includedArtifacts.map((artifact) => (
          <PinnedLearningArtifact key={artifact.id} artifact={artifact} sessionId={session.id}
            modelAvailable={state.modelAccess.status === "available"}
            statusLabel="Included in this Consolidated Session Outcome" onState={onState} />
        )) : <p>None included.</p>}
        <p className="subtle">Proof, source, note, Teaching Variant, and verification details appear above when they were retained in this Learning Session.</p>
      </details>
    </article>
  );
}

function TrailItemOutcomeDetail({ item, session }: { item: LearningSession["trailDraft"]["items"][number]; session: LearningSession }) {
  const anchors = item.links.sourceAnchorIds.flatMap((anchorId) => {
    const anchor = session.sourceAnchors.find((candidate) => candidate.id === anchorId);
    return anchor ? [anchor.selection.kind === "diagramRegion" ? "Selected diagram region" : `“${anchor.selection.exactText}”`] : [];
  });
  const cards = item.links.teachingCardIds.flatMap((cardId) => {
    const card = session.anchoredTeachingCards.find((candidate) => candidate.id === cardId);
    return card ? [`${card.title}${card.variants.length ? `; Teaching Variants: ${card.variants.map((variant) => variant.name).join(", ")}` : ""}`] : [];
  });
  const artifacts = item.links.learningArtifactIds.flatMap((artifactId) => {
    const artifact = session.learningArtifacts.find((candidate) => candidate.id === artifactId);
    return artifact ? [`${artifact.title} · ${artifact.currentRevision.claimOrigin} · Not independently checked`] : [];
  });
  return (
    <li>
      {item.content}{item.required && <strong> · Required Trail Item</strong>}
      {(anchors.length > 0 || cards.length > 0 || artifacts.length > 0 || item.links.understandingEvidenceIds.length > 0) && <ul className="trail-links">
        {anchors.map((anchor) => <li key={`anchor-${anchor}`}>Source Anchor: {anchor}</li>)}
        {cards.map((card) => <li key={`card-${card}`}>Teaching Card: {card}</li>)}
        {artifacts.map((artifact) => <li key={`artifact-${artifact}`}>Learning Artifact: {artifact}</li>)}
        {item.links.understandingEvidenceIds.map((evidenceId) => <li key={evidenceId}>Understanding Evidence: {evidenceId}</li>)}
      </ul>}
    </li>
  );
}

function PrerequisiteNavigation({ state, session, onState, onReturnToOrigin, onShowSourceAnchor }: {
  state: LearningApplicationState;
  session: LearningSession;
  onState: StateHandler;
  onReturnToOrigin(state: LearningApplicationState, sourceAnchorId: string): void;
  onShowSourceAnchor(sourceAnchorId: string): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const branchTrail: LearningSession[] = [];
  let cursor: LearningSession | undefined = session;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    branchTrail.unshift(cursor);
    cursor = cursor.prerequisiteBranch
      ? state.sessions.find((candidate) => candidate.id === cursor!.prerequisiteBranch!.returnPoint.originSessionId)
      : undefined;
  }
  const pending = session.prerequisiteBranchProposals.filter((proposal) => proposal.status === "pending");
  const openPeeks = session.conceptPeeks.filter((peek) => peek.status === "open");
  const submit = async (action: LearnerAction) => {
    setError(null);
    try {
      onState(await window.quickStudy.submit(action));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Prerequisite navigation could not be updated.");
    }
  };
  const returnToOrigin = async () => {
    const returnPoint = session.prerequisiteBranch?.returnPoint;
    if (!returnPoint) return;
    setError(null);
    try {
      const nextState = await window.quickStudy.submit({ type: "returnToPrerequisiteOrigin" });
      onReturnToOrigin(nextState, returnPoint.sourceAnchorId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Return Point could not be restored.");
    }
  };
  if (!session.prerequisiteBranch && pending.length === 0 && openPeeks.length === 0 && !session.pendingConceptPeek) return null;
  return (
    <section className="prerequisite-navigation" aria-label="Prerequisite navigation">
      {session.pendingConceptPeek && (
        <div className="background-work" role="status">
          <span>Creating Concept Peek: {session.pendingConceptPeek.prerequisite}</span>
          <button className="secondary" aria-label={`Stop Concept Peek generation ${session.pendingConceptPeek.prerequisite}`}
            onClick={() => void submit({ type: "cancelSessionModelWork", sessionId: session.id })}>
            Stop generation
          </button>
        </div>
      )}
      {session.prerequisiteBranch && (
        <nav aria-label="Branch Trail">
          <p className="eyebrow">Branch Trail</p>
          <ol>
            {branchTrail.map((trailSession, index) => (
              <li key={trailSession.id} aria-current={trailSession.id === session.id ? "page" : undefined}>
                {index > 0 && <span aria-hidden="true"> → </span>}
                <span>{trailSession.prerequisiteBranch?.prerequisite ?? trailSession.learningGoal}</span>
              </li>
            ))}
          </ol>
          <button className="primary" onClick={() => void returnToOrigin()}>
            Return to {session.prerequisiteBranch.returnPoint.label}
          </button>
        </nav>
      )}
      {openPeeks.map((peek) => (
        <article key={peek.id} className="concept-peek" aria-label={`Concept Peek ${peek.prerequisite}`}>
          <div><p className="eyebrow">Concept Peek</p><h2>{peek.prerequisite}</h2></div>
          <p>{peek.content}</p>
          <p className="subtle">Anchored at {conceptPeekAnchorLabel(session, peek.sourceAnchorId)}</p>
          <button className="secondary" aria-label={`Show Source Anchor for Concept Peek ${peek.prerequisite}`}
            onClick={() => onShowSourceAnchor(peek.sourceAnchorId)}>Show Source Anchor</button>
          <button className="text-button" aria-label={`Close Concept Peek ${peek.prerequisite}`} onClick={() => void submit({
            type: "closeConceptPeek", conceptPeekId: peek.id
          })}>Close peek</button>
        </article>
      ))}
      {pending.map((proposal) => (
        <article key={proposal.id} className="branch-proposal" aria-label={`Prerequisite Branch proposal ${proposal.prerequisite}`}>
          <p className="eyebrow">Learner approval required</p>
          <h2>Study {proposal.prerequisite} in a Prerequisite Branch?</h2>
          <p>This substantial prerequisite would open a linked Learning Session with its own Mathematical Workbench.</p>
          <div className="branch-proposal-actions">
            <button className="primary" disabled={Boolean(session.pendingConceptPeek)} aria-label={`Accept Prerequisite Branch ${proposal.prerequisite}`} onClick={() => void submit({
              type: "decidePrerequisiteBranch", proposalId: proposal.id, decision: "accept"
            })}>Open branch</button>
            <button className="secondary" disabled={Boolean(session.pendingConceptPeek)} aria-label={`Keep ${proposal.prerequisite} inline as a Concept Peek`} onClick={() => void submit({
              type: "decidePrerequisiteBranch", proposalId: proposal.id, decision: "keepInline"
            })}>Keep inline instead</button>
            <button className="text-button" disabled={Boolean(session.pendingConceptPeek)} aria-label={`Defer Prerequisite Branch ${proposal.prerequisite}`} onClick={() => void submit({
              type: "decidePrerequisiteBranch", proposalId: proposal.id, decision: "defer"
            })}>Defer</button>
          </div>
        </article>
      ))}
      {error && <p className="failure-message" role="alert">{error}</p>}
    </section>
  );
}

function conceptPeekAnchorLabel(session: LearningSession, sourceAnchorId: string): string {
  const anchor = session.sourceAnchors.find((candidate) => candidate.id === sourceAnchorId);
  if (!anchor) return "an unavailable Source Anchor";
  if (anchor.selection.kind === "diagramRegion") return "the selected diagram region";
  return `“${anchor.selection.exactText}” (characters ${anchor.selection.startOffset}–${anchor.selection.endOffset})`;
}

function hasBackgroundModelWork(session: LearningSession): boolean {
  const agentTask = session.agentTasks.find((task) => task.id === session.activeAgentTaskId);
  return session.teachingCard.status === "streaming" || session.pendingConceptPeek !== null
    || Boolean(agentTask && (agentTask.status === "working" || agentTask.status === "waiting"));
}

function backgroundModelWorkLabel(session: LearningSession): string {
  const agentTask = session.agentTasks.find((task) => task.id === session.activeAgentTaskId);
  if (agentTask?.status === "working" || agentTask?.status === "waiting") {
    return `Specialist Agent is ${agentTask.status} in the background`;
  }
  if (session.pendingConceptPeek) return `Codex is creating the Concept Peek ${session.pendingConceptPeek.prerequisite}`;
  return "Codex is teaching in the background";
}

function backgroundModelWorkStopLabel(session: LearningSession): string {
  const agentTask = session.agentTasks.find((task) => task.id === session.activeAgentTaskId);
  if (agentTask?.status === "working" || agentTask?.status === "waiting") return "Stop Agent Task";
  return session.pendingConceptPeek ? "Stop Concept Peek generation" : "Stop background teaching";
}

function ArgumentRoadmapPanel({ state, session, onState }: {
  state: LearningApplicationState;
  session: LearningSession;
  onState: StateHandler;
}) {
  const roadmap = state.argumentRoadmaps.find((candidate) => candidate.id === session.learningSlice?.roadmapId);
  const [boundary, setBoundary] = useState(session.learningSlice?.boundary ?? "");
  const [prerequisites, setPrerequisites] = useState(session.learningSlice?.immediatePrerequisites.join("\n") ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setBoundary(session.learningSlice?.boundary ?? "");
    setPrerequisites(session.learningSlice?.immediatePrerequisites.join("\n") ?? "");
  }, [session.id, session.learningSlice?.boundary, session.learningSlice?.immediatePrerequisites]);
  if (!roadmap || !session.learningSlice) return null;
  const activeStage = roadmap.stages.find((stage) => stage.id === session.learningSlice?.stageId);
  const editable = session.proposal.status === "awaitingConfirmation";
  const save = async () => {
    setError(null);
    try {
      onState(await window.quickStudy.submit({
        type: "reviseLearningSlice",
        boundary,
        immediatePrerequisites: prerequisites.split("\n").map((item) => item.trim()).filter(Boolean)
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Learning Slice could not be saved.");
    }
  };
  const choose = async (stageId: string) => {
    setError(null);
    try {
      onState(await window.quickStudy.submit({ type: "selectRoadmapStage", roadmapId: roadmap.id, stageId }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Learning Slice could not be selected.");
    }
  };
  const showAnchor = async (sourceAnchorId: string) => {
    setError(null);
    try {
      onState(await window.quickStudy.submit({ type: "activateSourceAnchor", sourceAnchorId }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Source Anchor could not be shown.");
    }
  };
  const handlePrerequisite = async (action: Extract<LearnerAction,
    { type: "openConceptPeek" | "proposePrerequisiteBranch" }>) => {
    setError(null);
    try {
      onState(await window.quickStudy.submit(action));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The prerequisite action could not be completed.");
    }
  };
  return (
    <section className="argument-roadmap" aria-label="Argument Roadmap">
      <div className="card-heading">
        <div><p className="eyebrow">Argument Roadmap</p><h2 id="argument-roadmap-title">{roadmap.title}</h2></div>
        <span className="saved">{roadmap.stages.length} linked Learning Sessions</span>
      </div>
      <p className="subtle">Orientation only. Detailed teaching stays inside the Learning Slice you confirm.</p>
      <ol className="roadmap-stages">
        {roadmap.stages.map((stage) => {
          const selected = stage.id === roadmap.selectedStageId;
          const stageSession = state.sessions.find((candidate) => candidate.id === stage.sessionId);
          const anchor = stageSession?.sourceAnchors.find((candidate) => candidate.id === stage.sourceAnchorId);
          const anchorDescription = anchor && anchor.selection.kind !== "diagramRegion"
            ? `Source Anchor “${anchor.selection.exactText}” · characters ${anchor.selection.startOffset}–${anchor.selection.endOffset}`
            : `Source Anchor ${stage.sourceAnchorId}`;
          const dependencies = stage.dependsOnStageIds
            .map((id) => roadmap.stages.find((candidate) => candidate.id === id)?.title)
            .filter((title): title is string => Boolean(title));
          return (
            <li key={stage.id} className={selected ? "selected" : ""}>
              <div><strong>{stage.title}</strong><p>{stage.majorClaim}</p>
                <small>{dependencies.length ? `Depends on ${dependencies.join(", ")}` : "No roadmap dependencies"} · {anchorDescription}</small>
              </div>
              {selected ? <div className="roadmap-stage-actions"><span className="saved">Current Learning Slice</span>
                <button className="text-button" aria-label={`Show Source Anchor for ${stage.title}`}
                  onClick={() => void showAnchor(stage.sourceAnchorId)}>
                  Show Source Anchor
                </button></div> : (
                <button className="secondary" disabled={!editable}
                  aria-label={`Choose Learning Slice ${stage.title}`} onClick={() => void choose(stage.id)}>Choose this slice</button>
              )}
            </li>
          );
        })}
      </ol>
      <div className="learning-slice-editor">
        <p className="proposal-label">Editable Learning Slice</p>
        <label htmlFor="learning-slice-boundary">Learning Slice boundary</label>
        <textarea id="learning-slice-boundary" value={boundary} disabled={!editable}
          onChange={(event) => setBoundary(event.target.value)} />
        <label htmlFor="learning-slice-prerequisites">Immediate prerequisites</label>
        <textarea id="learning-slice-prerequisites" value={prerequisites} disabled={!editable}
          onChange={(event) => setPrerequisites(event.target.value)} />
        {editable && <button className="secondary" disabled={!boundary.trim()} onClick={() => void save()}>Save Learning Slice</button>}
      </div>
      {activeStage && session.learningSlice.immediatePrerequisites.length > 0 && (
        <section className="immediate-prerequisites" aria-label="Learning Slice prerequisite choices">
          <p className="proposal-label">Handle a prerequisite without losing orientation</p>
          <ul>{session.learningSlice.immediatePrerequisites.map((prerequisite) => <li key={prerequisite}>
            <span>{prerequisite}</span>
            <div>
              <button className="secondary" disabled={Boolean(session.pendingConceptPeek)} aria-label={`Open Concept Peek ${prerequisite}`} onClick={() => void handlePrerequisite({
                type: "openConceptPeek", sourceAnchorId: activeStage.sourceAnchorId, prerequisite
              })}>Open Concept Peek</button>
              <button className="text-button" disabled={Boolean(session.pendingConceptPeek)} aria-label={`Propose Prerequisite Branch ${prerequisite}`} onClick={() => void handlePrerequisite({
                type: "proposePrerequisiteBranch", sourceAnchorId: activeStage.sourceAnchorId, prerequisite
              })}>Study as branch</button>
            </div>
          </li>)}</ul>
        </section>
      )}
      {error && <p className="failure-message" role="alert">{error}</p>}
    </section>
  );
}

function WorkbenchSourceLayer({ state, session, onState, onActivateAnchor, onTeachingCardCreated, onAnnotationRequested, focusAnchorId }: {
  state: LearningApplicationState;
  session: LearningSession;
  onState: StateHandler;
  onActivateAnchor(sourceAnchorId: string): void;
  onTeachingCardCreated(teachingCardId: string): void;
  onAnnotationRequested(sourceAnchorId: string, purpose: AnnotationPurpose): void;
  focusAnchorId: string | null;
}) {
  const selectableSources = state.sources.filter((source) => source.workspaceId === session.workspaceId
    && (session.sourceIds.includes(source.id) || (source.kind === "linkedSource" && source.resourceType === "file")));
  const returnSourceId = session.sourceAnchors.find((anchor) => anchor.id === focusAnchorId)?.sourceId;
  const [sourceId, setSourceId] = useState(returnSourceId ?? session.sourceIds[0]);
  const [linkedView, setLinkedView] = useState<Extract<LinkedSourceView, { status: "available" }> | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const source = selectableSources.find((candidate) => candidate.id === sourceId) ?? selectableSources[0];
  const chooseSource = async (nextSourceId: string) => {
    setSourceError(null);
    const nextSource = selectableSources.find((candidate) => candidate.id === nextSourceId);
    if (!nextSource) return;
    if (nextSource.kind === "managedAsset") {
      setSourceId(nextSource.id);
      setLinkedView(null);
      return;
    }
    const view = await window.quickStudy.openLinkedSource(nextSource.id);
    if (view.status === "unavailable") {
      setSourceError(view.error);
      return;
    }
    onState(await window.quickStudy.submit({ type: "addSourceToSession", sourceId: nextSource.id }));
    setSourceId(nextSource.id);
    setLinkedView(view);
  };
  useEffect(() => {
    const returnSource = selectableSources.find((candidate) => candidate.id === returnSourceId);
    if (returnSource?.kind === "managedAsset") {
      setSourceId(returnSource.id);
      setLinkedView(null);
    } else if (returnSource?.kind === "linkedSource" && linkedView?.sourceId !== returnSource.id) {
      void chooseSource(returnSource.id).catch((cause: unknown) => setSourceError(
        cause instanceof Error ? cause.message : "The Return Point source could not be reopened."
      ));
    }
  }, [returnSourceId]);
  const content = source?.kind === "managedAsset" ? source.content : linkedView?.sourceId === source?.id ? linkedView.content : null;
  const mediaType = source?.kind === "managedAsset" ? source.mediaType : linkedView?.sourceId === source?.id ? linkedView.mediaType : null;
  const selectableMedia = mediaType === "text/plain" || mediaType === "image/png" || mediaType === "image/jpeg";

  return (
    <section className="workbench-source" aria-labelledby="workbench-source-title">
      <label id="workbench-source-title" htmlFor="workbench-source-choice">Workbench Source Layer</label>
      <select id="workbench-source-choice" value={source?.id ?? ""} onChange={(event) => void chooseSource(event.target.value)}>
        {selectableSources.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
      </select>
      {content !== null && selectableMedia ? (
        <SourceLayer
          sourceId={source.id}
          content={content}
          mediaType={mediaType}
          anchors={session.sourceAnchors.filter((anchor) => anchor.sourceId === source.id
            && (source.kind === "managedAsset" || anchor.sourceRevisionId === source.link.currentRevisionId))}
          onActivateAnchor={onActivateAnchor}
          focusAnchorId={focusAnchorId}
          onChooseAction={(selection, paletteAction) => {
            void window.quickStudy.submit({
              type: "createSourceAnchor",
              sourceId: source.id,
              selection,
              paletteAction
            }).then((nextState) => {
              onState(nextState);
              const activeSession = nextState.sessions.find((candidate) => candidate.id === nextState.activeSessionId);
              if ((paletteAction === "explain" || paletteAction === "question") && activeSession?.activeTeachingCardId) {
                onTeachingCardCreated(activeSession.activeTeachingCardId);
              }
              if ((paletteAction === "addNote" || paletteAction === "tellTutor") && activeSession?.activeSourceAnchorId) {
                onAnnotationRequested(activeSession.activeSourceAnchorId,
                  paletteAction === "addNote" ? "personalNote" : "tutorFeedback");
              }
            });
          }}
        />
      ) : source?.kind === "linkedSource" && content === null ? (
        <button className="secondary open-workbench-source" onClick={() => void chooseSource(source.id)}>Open Linked Source read-only</button>
      ) : (
        <p className="subtle">This source format is read-only here, but precise selection is not available yet.</p>
      )}
      {sourceError && <p className="failure-message" role="alert">{sourceError}</p>}
    </section>
  );
}

function annotationAnchorLabel(anchor: LearningSession["sourceAnchors"][number]): string {
  if (anchor.selection.kind === "diagramRegion") return "selected diagram-region Source Anchor";
  return `${anchor.selection.kind === "equation" ? "Equation" : "Text"} Source Anchor: ${anchor.selection.exactText}`;
}

function PinnedLearningArtifact({ artifact, onState, sessionId, modelAvailable = false, statusLabel = "Pinned on the main canvas" }: {
  artifact: LearningArtifact;
  onState: StateHandler;
  sessionId?: string;
  modelAvailable?: boolean;
  statusLabel?: string;
}) {
  const [content, setContent] = useState(artifact.currentRevision.content);
  const [portabilityStatus, setPortabilityStatus] = useState<string | null>(null);
  const [portabilityError, setPortabilityError] = useState<string | null>(null);
  const [synthesisStatus, setSynthesisStatus] = useState<string | null>(null);
  const artifactLabel = artifact.kind === "reformulatedProof" ? "Reformulated Proof" : "Learning Artifact";
  const originatingSessionId = sessionId ?? artifact.originatingSessionId;
  useEffect(() => setContent(artifact.currentRevision.content), [artifact.currentRevision.id, artifact.currentRevision.content]);
  const save = async () => onState(await window.quickStudy.submit({
    type: "editLearningArtifact",
    ...(sessionId ? { sessionId } : {}),
    artifactId: artifact.id,
    content
  }));
  const exportArtifact = async () => {
    setPortabilityError(null);
    const result = await window.quickStudy.exportLearningArtifact(originatingSessionId, artifact.id);
    if (result.status === "exported") setPortabilityStatus(`Artifact Export saved to ${result.path}`);
  };
  const shareArtifact = async () => {
    setPortabilityError(null);
    await window.quickStudy.shareLearningArtifact(originatingSessionId, artifact.id);
    setPortabilityStatus("Artifact Export handed to macOS sharing.");
  };
  const synthesize = async () => {
    setPortabilityError(null);
    setSynthesisStatus("Synthesizing Learning Artifact…");
    try {
      onState(await window.quickStudy.submit({
        type: "synthesizeLearningArtifact",
        ...(sessionId ? { sessionId } : {}),
        artifactId: artifact.id
      }));
      setSynthesisStatus("Learning Artifact synthesized with the current Personal Note Synthesis Preference.");
    } catch (cause) {
      setSynthesisStatus(null);
      setPortabilityError(cause instanceof Error ? cause.message : "The Learning Artifact could not be synthesized.");
    }
  };
  const runPortableAction = (action: () => Promise<void>) => void action().catch((cause: unknown) => {
    setPortabilityError(cause instanceof Error ? cause.message : "The Learning Artifact could not be handed off.");
  });
  return (
    <article id={`learning-artifact-${artifact.id}`} className="learning-artifact"
      aria-label={`${artifact.kind === "learningArtifact" ? "Pinned Learning Artifact" : artifactLabel} ${artifact.title}`}>
      <div className="card-heading">
        <div><p className="eyebrow">{artifactLabel}</p><h2>{artifact.title}</h2></div>
        <span className="saved">{statusLabel}</span>
      </div>
      <label htmlFor={`artifact-content-${artifact.id}`}>Learning Artifact content for {artifact.title}</label>
      <textarea id={`artifact-content-${artifact.id}`} className="artifact-content" value={content}
        onChange={(event) => setContent(event.target.value)} />
      <button className="secondary" aria-label={`Save Learning Artifact revision for ${artifact.title}`}
        disabled={!content.trim() || content === artifact.currentRevision.content}
        onClick={() => void save()}>Save Learning Artifact revision</button>
      <button className="secondary" aria-label={`Synthesize Learning Artifact ${artifact.title}`}
        disabled={!modelAvailable || synthesisStatus === "Synthesizing Learning Artifact…"}
        onClick={() => void synthesize()}>Synthesize artifact</button>
      <div className="artifact-portability-actions">
        <button className="secondary" aria-label={`Export ${artifactLabel} ${artifact.title}`}
          onClick={() => runPortableAction(exportArtifact)}>Export portable copy</button>
        <button className="secondary" aria-label={`Share ${artifactLabel} ${artifact.title}`}
          onClick={() => runPortableAction(shareArtifact)}>Share export</button>
      </div>
      <dl className="artifact-evidence">
        <div><dt>Claim Origin</dt><dd>{artifact.currentRevision.claimOrigin === "learner"
          ? "Learner"
          : artifact.currentRevision.claimOrigin === "mixed" ? "Mixed learner and model" : "Model-generated"}</dd></div>
        <div><dt>Verification Level</dt><dd>Not independently checked</dd></div>
        <div><dt>Source relationship</dt><dd>{artifact.sourceAnchorIds.length} retained Source Anchor{artifact.sourceAnchorIds.length === 1 ? "" : "s"}</dd></div>
        <div><dt>Revision provenance</dt><dd>{artifactRevisionProvenance(artifact.currentRevision)}</dd></div>
      </dl>
      {artifact.currentRevision.personalNoteContributions.length > 0 && (
        <section className="personal-note-contributions" aria-label="Personal Notes used in this Learning Artifact revision">
          <h3>Personal Notes used in this synthesis</h3>
          {artifact.currentRevision.personalNoteContributions.map((note) => (
            <article key={note.annotationId} aria-label={`Personal Note ${note.annotationId}`}>
              <p className="record-link">Original annotation {note.annotationId} · Source Anchor {note.sourceAnchorId}</p>
              <h4>Verbatim original</h4>
              <blockquote>{note.verbatim}</blockquote>
              {note.interpretation !== null && <><h4>Note Interpretation</h4><p>{note.interpretation}</p></>}
            </article>
          ))}
        </section>
      )}
      {synthesisStatus && <p className="saved" role="status">{synthesisStatus}</p>}
      {portabilityStatus && <p className="saved" role="status">{portabilityStatus}</p>}
      {portabilityError && <p className="failure-message" role="alert">{portabilityError}</p>}
      {artifact.revisions.length > 0 && <details className="artifact-history">
        <summary>Learning Artifact revision history</summary>
        <ol>{artifact.revisions.map((revision, index) => <li key={revision.id}>
          <p>Revision {index + 1}: {revision.content}</p>
          <p className="subtle">{artifactRevisionProvenance(revision)}</p>
          {revision.personalNoteContributions.map((note) => <div className="historical-personal-note" key={note.annotationId}>
            <p className="record-link">Personal Note {note.annotationId} · Source Anchor {note.sourceAnchorId}</p>
            <h4>Verbatim original</h4>
            <blockquote>{note.verbatim}</blockquote>
            {note.interpretation !== null && <><h4>Note Interpretation</h4><p>{note.interpretation}</p></>}
          </div>)}
          <button className="text-button" aria-label={`Restore ${artifact.title} revision ${index + 1}`}
            onClick={() => void window.quickStudy.submit({
              type: "restoreLearningArtifactRevision",
              ...(sessionId ? { sessionId } : {}),
              artifactId: artifact.id,
              revisionId: revision.id
            }).then(onState)}>Restore this artifact revision</button>
        </li>)}</ol>
      </details>}
    </article>
  );
}

function artifactRevisionProvenance(revision: LearningArtifact["currentRevision"]): string {
  const action = revision.provenance.action === "promoted"
    ? "Promoted"
    : revision.provenance.action === "edited" ? "Edited"
      : revision.provenance.action === "synthesized" ? "Synthesized" : "Restored";
  const created = revision.provenance.createdAt
    ? new Date(revision.provenance.createdAt).toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric", timeZone: "UTC"
      })
    : "Date unavailable";
  return `${action} · ${created}`;
}

function SessionAccessPanel({ state, session, onState }: {
  state: LearningApplicationState;
  session: LearningSession;
  onState: StateHandler;
}) {
  const [accessError, setAccessError] = useState<string | null>(null);
  const pendingRequest = session.accessRequests.find((request) => request.status === "pending") ?? null;
  const submitAccessAction = async (action: LearnerAction) => {
    setAccessError(null);
    try {
      onState(await window.quickStudy.submit(action));
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Could not update the Session Access Policy.");
    }
  };
  const choosePolicy = (policy: LearningSession["accessPolicy"]) => {
    void submitAccessAction({ type: "selectSessionAccessPolicy", policy });
  };
  const decide = (decision: "approve" | "deny" | "narrow") => {
    if (!pendingRequest) return;
    void submitAccessAction({
      type: "decideAccessRequest",
      requestId: pendingRequest.id,
      decision,
      ...(decision === "narrow" ? { narrowedPolicy: "workspace" as const } : {})
    });
  };
  return (
    <section className="access-policy" aria-labelledby="session-access-title">
      <div className="access-heading">
        <div>
          <p className="eyebrow">Session Access Policy</p>
          <h2 id="session-access-title">{sessionAccessPolicyLabel(session.accessPolicy)}</h2>
          <p>{accessPolicyDescription(session.accessPolicy)}</p>
        </div>
        <span className="saved" role="status">Current session only</span>
      </div>
      <fieldset disabled={Boolean(pendingRequest) || session.pendingFullAccessConfirmation}>
        <legend>Choose Session Access Policy</legend>
        {(["focused", "workspace", "full"] as const).map((policy) => (
          <label key={policy}>
            <input
              type="radio"
              name="session-access-policy"
              value={policy}
              checked={session.accessPolicy === policy}
              onChange={() => choosePolicy(policy)}
            />
            {sessionAccessPolicyLabel(policy)}
          </label>
        ))}
      </fieldset>
      <label className="confirmation-preference">
        <input
          type="checkbox"
          checked={state.accessConfirmationPreference.confirmFullAccess}
          onChange={(event) => void submitAccessAction({
            type: "setFullAccessConfirmation",
            enabled: event.target.checked
          })}
        />
        Confirm before Full Access
      </label>
      <small>Full Access never permits arbitrary source modification or deletion.</small>
      {session.pendingFullAccessConfirmation && (
        <section className="access-request" aria-labelledby="full-access-confirmation-title">
          <p className="eyebrow">Additional confirmation</p>
          <h3 id="full-access-confirmation-title">Full Access confirmation</h3>
          <p>Allow broader read-only local-file and agent-tool access for this Learning Session only?</p>
          <div className="teaching-actions">
            <button className="primary" onClick={() => void submitAccessAction({
              type: "decideFullAccessConfirmation", decision: "confirm"
            })}>Confirm Full Access</button>
            <button className="secondary" onClick={() => void submitAccessAction({
              type: "decideFullAccessConfirmation", decision: "cancel"
            })}>Cancel Full Access</button>
          </div>
        </section>
      )}
      {pendingRequest && (
        <section className="access-request" aria-labelledby="access-request-title">
          <p className="eyebrow">Access Request</p>
          <h3 id="access-request-title">Request {sessionAccessPolicyLabel(pendingRequest.requestedPolicy)}</h3>
          <dl>
            <div><dt>Reason</dt><dd>{pendingRequest.reason}</dd></div>
            <div><dt>Exact requested scope</dt><dd>{pendingRequest.exactScope}</dd></div>
            <div><dt>Intended action</dt><dd>{pendingRequest.intendedAction}</dd></div>
          </dl>
          <div className="teaching-actions">
            <button className="primary" onClick={() => decide("approve")}>Approve Access Request</button>
            {session.accessPolicy === "focused" && pendingRequest.requestedPolicy === "full" && (
              <button className="secondary" onClick={() => decide("narrow")}>Narrow to Workspace Access</button>
            )}
            <button className="secondary" onClick={() => decide("deny")}>Deny Access Request</button>
          </div>
        </section>
      )}
      {accessError && <p className="failure-message" role="alert">{accessError}</p>}
    </section>
  );
}

function accessPolicyDescription(policy: LearningSession["accessPolicy"]): string {
  return {
    focused: "Only material explicitly attached, pasted, highlighted, or selected for this Learning Session.",
    workspace: "Current session material and supported sources owned by this Study Workspace; unrelated workspaces and device content stay excluded.",
    full: "Broader local-file and agent-tool access for this Learning Session only."
  }[policy];
}

function TeachingCard({ session, modelAvailable, onState }: { session: LearningSession; modelAvailable: boolean; onState: StateHandler }) {
  const card = session.teachingCard;
  const agentTask = session.agentTasks.find((task) => task.id === session.activeAgentTaskId) ?? null;
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
  return <>
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
        {card.status === "completed" && modelAvailable && !agentTask && <fieldset>
          <legend>Specialist review plan</legend>
          <p className="subtle">Choose parallel work only for independent perspectives; use sequential review when the second brief needs the first result.</p>
          <button className="secondary"
            onClick={() => void window.quickStudy.submit({ type: "requestSpecialistReview", coordination: "single" }).then(onState)}>
            One bounded review
          </button>
          <button className="secondary"
            onClick={() => void window.quickStudy.submit({ type: "requestSpecialistReview", coordination: "dependent" }).then(onState)}>
            Sequential review then challenge
          </button>
          <button className="secondary"
            onClick={() => void window.quickStudy.submit({ type: "requestSpecialistReview", coordination: "independent" }).then(onState)}>
            Two independent perspectives
          </button>
        </fieldset>}
      </div>
    </section>
    {agentTask && <AgentTaskStatusCard task={agentTask} modelAvailable={modelAvailable} onState={onState} />}
  </>;
}

function AgentTaskStatusCard({ task, modelAvailable, onState }: {
  task: LearningSession["agentTasks"][number];
  modelAvailable: boolean;
  onState: StateHandler;
}) {
  return (
    <section className={`teaching-card ${task.integratedTeachingCard.status}`} aria-live="polite" aria-label="Agent Task Status">
      <div className="card-heading">
        <div><p className="eyebrow">Agent Task Status</p><h2>{task.purpose}</h2></div>
        <span className="saved">{agentTaskStatusLabel(task.status)}</span>
      </div>
      {task.statusMessage && <p className={task.status === "failed" ? "failure-message" : "subtle"}>{task.statusMessage}</p>}
      <details>
        <summary>Inspect Agent Brief</summary>
        <dl>
          <div><dt>Identified need</dt><dd>{task.identifiedNeed.description}</dd></div>
          <div><dt>Learning Goal</dt><dd>{task.brief.learningGoal}</dd></div>
          <div><dt>Source Anchors</dt><dd>{task.brief.sourceAnchors.length}</dd></div>
          <div><dt>Constraints</dt><dd>{task.brief.constraints.join(" ")}</dd></div>
          <div><dt>Learner evidence</dt><dd>{task.brief.learnerEvidence.join(" ") || "None"}</dd></div>
          <div><dt>Expected output</dt><dd>{task.brief.expectedOutput}</dd></div>
          <div><dt>Verification needs</dt><dd>{task.brief.verificationNeeds.join(" ")}</dd></div>
        </dl>
      </details>
      <details>
        <summary>Inspect Agent Budget</summary>
        <dl>
          <div><dt>Agent count</dt><dd>{task.budget.agentCount}</dd></div>
          <div><dt>Concurrency</dt><dd>{task.budget.concurrency}</dd></div>
          <div><dt>Model</dt><dd>{task.budget.model === "runtimeDefault" ? "Automatic runtime default" : task.budget.model}</dd></div>
          <div><dt>Reasoning effort</dt><dd>{task.budget.reasoningEffort}</dd></div>
          <div><dt>Tool access</dt><dd>{task.budget.tools.join(", ") || "None"}</dd></div>
          <div><dt>Token use limit</dt><dd>{task.budget.maxTokens} total input, output, and reasoning tokens</dd></div>
          <div><dt>Latency limit</dt><dd>{task.budget.maxLatencyMs / 1000} seconds</dd></div>
        </dl>
      </details>
      {(task.integratedTeachingCard.content || task.status === "complete") && <div className="teaching-section">
        <h3>{task.integratedTeachingCard.title}</h3>
        <div className="teaching-content">{task.integratedTeachingCard.content}</div>
      </div>}
      {task.priorAgentWorkLogReferences.map((reference, index) => (
        <AgentWorkLogLink key={`${reference.fromSequence}-${index}`} reference={reference} />
      ))}
      {task.agentWorkLogReference && <AgentWorkLogLink reference={task.agentWorkLogReference} />}
      <div className="teaching-actions">
        {(task.status === "working" || task.status === "waiting") && <button className="secondary"
          onClick={() => void window.quickStudy.submit({ type: "cancelModelWork" }).then(onState)}>Stop Agent Task</button>}
        {task.integratedTeachingCard.retryable && modelAvailable && <button className="primary"
          onClick={() => void window.quickStudy.submit({ type: "retryAgentTask", taskId: task.id }).then(onState)}>
          Retry Agent Task
        </button>}
      </div>
    </section>
  );
}

function SessionRecord({ session }: { session: LearningSession }) {
  if (session.submittedPendingQuestions.length === 0 && session.teachingCardHistory.length === 0
    && session.questionCards.length === 0 && session.anchoredTeachingCards.length === 0
    && session.annotations.length === 0 && session.learningArtifacts.length === 0 && session.agentTasks.length === 0) return null;
  return (
    <section className="session-record" aria-labelledby="session-record-title">
      <p className="eyebrow">Session Record</p>
      <h2 id="session-record-title">Retained learner-visible teaching work</h2>
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
      {session.questionCards.map((card) => (
        <article key={card.id}>
          <h3>Question Card · {card.question}</h3>
          <p>{card.currentRevision.content || card.currentRevision.error || "Teaching has not produced content."}</p>
          <p className="record-link">Context Used Receipt: {card.currentRevision.contextUsed.length} items</p>
          {card.currentRevision.agentWorkLogReference && <AgentWorkLogLink reference={card.currentRevision.agentWorkLogReference} />}
          {card.revisions.length > 0 && <details>
            <summary>{card.revisions.length} prior Question Card revisions</summary>
            {card.revisions.map((revision, index) => <p key={revision.id}>
              Revision {index + 1} · {revision.question}: {revision.content || revision.error}
            </p>)}
          </details>}
        </article>
      ))}
      {session.anchoredTeachingCards.map((card) => (
        <article key={card.id}>
          <h3>Anchored Teaching Card · {card.title}</h3>
          <p>{card.currentRevision.content || card.currentRevision.error || "Teaching has not produced content."}</p>
          <p className="record-link">Linked Source Anchor: {card.sourceAnchorId}</p>
          {card.currentRevision.agentWorkLogReference && <AgentWorkLogLink reference={card.currentRevision.agentWorkLogReference} />}
          {(card.revisions.length > 0 || card.variants.length > 0) && <details>
            <summary>{card.revisions.length} prior revisions · {card.variants.length} named variants</summary>
            {card.revisions.map((revision, index) => <p key={revision.id}>Revision {index + 1}: {revision.content || revision.error}</p>)}
            {card.variants.map((variant) => <p key={variant.id}>{variant.name}: {variant.revision.content || variant.revision.error}</p>)}
          </details>}
        </article>
      ))}
      {session.agentTasks.map((task) => (
        <article key={task.id}>
          <h3>Agent Task · {task.purpose}</h3>
          <p>{task.integratedTeachingCard.content || task.integratedTeachingCard.error || task.statusMessage || "Specialist work has not produced content."}</p>
          <p className="record-link">Agent Task Status: {agentTaskStatusLabel(task.status)}</p>
          {task.priorAgentWorkLogReferences.map((reference, index) => (
            <AgentWorkLogLink key={`${reference.fromSequence}-${index}`} reference={reference} />
          ))}
          {task.agentWorkLogReference && <AgentWorkLogLink reference={task.agentWorkLogReference} />}
        </article>
      ))}
      {session.annotations.map((annotation) => (
        <article key={annotation.id}>
          <h3>{annotationPurposeLabel(annotation.purpose)}</h3>
          <p>{annotation.content}</p>
          <p className="record-link">Linked Source Anchor: {annotation.sourceAnchorId}</p>
          {annotation.purposeChanges.map((change, index) => <p className="record-link" key={`${change.from}-${change.to}-${index}`}>
            Changed from {annotationPurposeLabel(change.from)} to {annotationPurposeLabel(change.to)}; future use follows the current purpose.
          </p>)}
        </article>
      ))}
      {session.learningArtifacts.map((artifact) => (
        <article key={artifact.id}>
          <h3>Pinned Learning Artifact · {artifact.title}</h3>
          <p>{artifact.currentRevision.content}</p>
          <p className="record-link">Linked Source Anchors: {artifact.sourceAnchorIds.join(", ")}</p>
        </article>
      ))}
    </section>
  );
}

function AgentWorkLogLink({ reference }: {
  reference: NonNullable<LearningSession["anchoredTeachingCards"][number]["currentRevision"]["agentWorkLogReference"]>;
}) {
  const [events, setEvents] = useState<AgentWorkLogEvidence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inspect = async () => {
    try {
      setEvents(await window.quickStudy.getAgentWorkLogEvidence(
        reference.sessionId,
        reference.fromSequence,
        reference.toSequence
      ));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent Work Log evidence is unavailable.");
    }
  };
  return (
    <div className="agent-work-log-link">
      <button className="text-button" aria-expanded={events !== null}
        onClick={() => void inspect()}>Inspect Agent Work Log events {reference.fromSequence}–{reference.toSequence}</button>
      {events && <ol aria-label="Agent Work Log evidence">
        {events.map((event) => <li key={event.sequence}><strong>{event.type}</strong>: {event.summary}</li>)}
      </ol>}
      {error && <p className="failure-message" role="alert">{error}</p>}
    </div>
  );
}

function teachingStatusLabel(status: LearningSession["teachingCard"]["status"]): string {
  return ({ idle: "Ready", streaming: "Streaming", completed: "Complete", stopped: "Stopped", failed: "Needs attention" })[status];
}

function agentTaskStatusLabel(status: LearningSession["agentTasks"][number]["status"]): string {
  return ({ working: "Working", waiting: "Waiting", failed: "Failed", stopped: "Stopped", complete: "Complete" })[status];
}
