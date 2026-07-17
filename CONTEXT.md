# Mathematical Learning

This context describes how the product organizes a learner's work to understand advanced mathematics.

## Language

### Workspaces and sessions

**Study Workspace**:
The top-level local collection for a durable course, subject, research area, or source collection, sharing sources and learner context across one or more Study Missions.
_Avoid_: Project, folder, chat

**Quick Study**:
The built-in home for standalone questions, pasted mathematics, loose attachments, and their Managed Assets. It supplies a distinct system-owned Study Workspace and unfiled Study Mission until the learner optionally files a session into a named workspace and mission.
_Avoid_: Mandatory setup, temporary unsaved chat, general inbox

**Primary Folder**:
The optional single local directory linked to a Study Workspace and recursively available under Workspace Access.
_Avoid_: App data directory, multiple root set

**Managed Asset**:
A fileless input, such as a pasted image or capture, or an explicitly requested source copy or Source Snapshot retained in app-controlled local storage.
_Avoid_: Automatically copied source, artifact export

**Linked Source**:
A disk-backed source that remains at its original local location and is accessed through a Source Link Record without being copied, moved, or replaced by the app.
_Avoid_: Managed Asset, symlink

**Source Link Record**:
The persistent permission and identity relationship through which the app can reopen a Linked Source, help the learner recover it, and detect a changed source.
_Avoid_: Symlink, source copy, stored path alone

**Source Fingerprint**:
Lightweight derived metadata used to recognize that a Linked Source was replaced or changed without serving as either its access permission or a copy of its contents.
_Avoid_: Backup, security token

**Source Index**:
Rebuildable local search and anchor-support data derived from a Linked Source without becoming the canonical source or a complete duplicate.
_Avoid_: Source copy, canonical document

**Source Revision**:
A detected state of a Linked Source distinguished by its Source Fingerprint and presented when the source changes after anchors or session work were created.
_Avoid_: App-created copy, silent overwrite

**Source Snapshot**:
A learner-requested Managed Asset preserving an exact copy of one Source Revision for reproducibility when a Linked Source may later change or disappear. It is never created automatically and does not replace or modify the Linked Source.
_Avoid_: Hidden backup, Source Index, automatic duplicate

**Re-anchoring**:
The attempt to map existing Source Anchors onto a new Source Revision, applying only strong matches automatically and surfacing uncertain or missing matches for learner review.
_Avoid_: Silent remapping, text search alone

**Unresolved Anchor**:
A Source Anchor that cannot be mapped confidently to the current Source Revision and therefore cannot safely carry its prior annotations or Teaching Moves forward without review.
_Avoid_: Deleted annotation, guessed location

**External Attachment**:
A Linked Source individually selected outside the Primary Folder and made available to a Study Workspace without adding another folder root.
_Avoid_: Secondary workspace, implicit filesystem access

**Study Mission**:
A goal-oriented body of work inside one Study Workspace that organizes one or more related Learning Sessions and their Learning Trails around a longer-lived reason and observable outcome.
_Avoid_: Study Workspace, Learning Goal, topic

**Resume Card**:
The primary dashboard entry for the most recent resumable unconsolidated Learning Session, showing its Learning Goal, exact return context, and next suggested action.
_Avoid_: Recent chat, activity notification

**Learning Session**:
A coherent period of work centered on mathematical material or a learner's question, preserving the context needed to diagnose, explain, practise, and consolidate understanding.
_Avoid_: Chat, conversation

**Learning Goal**:
One visible, editable outcome that scopes a Learning Session and determines what belongs in its Learning Trail.
_Avoid_: Prompt, topic, mission

**Session Target**:
The particular proof, exercise, tutorial question, or focused mathematical problem that the current Learning Goal is intended to address.
_Avoid_: Study Mission, mastery objective, whole syllabus

**Mathematical Workbench**:
The primary interactive surface of a Learning Session, centered on the mathematical object being studied and coordinating its source anchors, Teaching Moves, annotations, and Learning Artifacts.
_Avoid_: Chat window, document viewer

**Contextual Inspector**:
The secondary panel that presents Teaching Moves, annotations, evidence, and actions relevant to the currently selected Source Anchor without becoming a chronological conversation feed.
_Avoid_: Chat sidebar, agent transcript

**Ask Bar**:
The universal workbench input for open-ended questions, using the active Source Anchor when present or the Learning Goal and visible session context otherwise.
_Avoid_: Chat window, agent command line

**Context Chip**:
A compact editable Ask Bar reference that clearly identifies one primary included context item by its type, human-readable identity, and relevant location or preview; excess items are grouped behind a labeled overflow control.
_Avoid_: Unlabeled pill, color-only indicator

**Context Used Receipt**:
An expandable, complete account attached to a Teaching Card that identifies the source locations and other context actually retrieved or supplied during its production.
_Avoid_: Visible chip pile, hidden retrieval log

**Anchor Marker**:
A subtle indicator on a Source Layer showing that a Source Anchor has associated Teaching Moves, annotations, verification evidence, or Trail Items.
_Avoid_: Expanded explanation, notification badge

**Session Record**:
The complete retained history of learner-relevant activity in a Learning Session, including learner and orchestrator inputs, source selections, annotations, Teaching Moves, Learning Artifacts, and revisions, while internal specialist messages and tool execution remain in the Agent Work Log.
_Avoid_: Chat history, raw transcript

**Source Layer**:
A non-editable in-app view of an accessible source revision against which explanations, annotations, and reformulations can be compared without altering the original source. A Linked Source does not preserve unavailable historical content unless the learner created a Source Snapshot.
_Avoid_: Editable copy, generated explanation, guaranteed hidden backup

**Source Anchor**:
A stable reference to a passage, equation, diagram region, page area, or other precise location in a Source Layer.
_Avoid_: Loose citation, screenshot alone

**Selection Palette**:
A compact menu opened from a text, equation, or diagram-region selection that lets the learner deliberately request an explanation, ask a question, annotate, add to the Learning Trail, or choose a context-specific secondary action.
_Avoid_: Automatic agent dispatch, permanent toolbar

**Personal Note**:
A learner annotation retained locally and excluded from ordinary model context; it may be supplied during artifact synthesis when the learner's Personal Note Synthesis Preference permits it.
_Avoid_: Tutor instruction, implicit model input

**Personal Note Synthesis Preference**:
An app-wide, learner-controlled setting that determines whether Personal Notes may be used during artifact synthesis, enabled by default without exposing them to ordinary Teaching Moves.
_Avoid_: General model access, mandatory inclusion

**Note Interpretation**:
A polished, agent-generated rendering of a Personal Note used to guide coherent artifact prose while remaining linked to and never replacing the verbatim original.
_Avoid_: Edited original, hidden paraphrase

**Tutor Feedback**:
A learner annotation explicitly supplied to the teaching system to revise the current explanation, guide later Teaching Moves, and inform future artifact synthesis.
_Avoid_: Private note, disposable prompt

**Reformulated Proof**:
An editable Learning Artifact that restates or restructures a source proof for the current learner while retaining links back to the relevant Source Anchors.
_Avoid_: Corrected source, overwritten proof

**Session Intake**:
The single entry surface for starting a Learning Session from a typed question, pasted mathematics, dropped PDF or image, or selected workspace material without requiring the learner to choose a study mode first.
_Avoid_: Mode picker, chat composer

**Session Proposal**:
The app's editable interpretation of a Session Intake, including a proposed Learning Goal, working scope, and initial teaching direction.
_Avoid_: Final plan, hidden classification

**Session Confirmation**:
Learner approval of a Session Proposal when ambiguity, source size, or competing interpretations make an incorrect start materially costly.
_Avoid_: Mandatory start screen, approval for every question

**Session Consolidation**:
A learner-controlled checkpoint that reviews the Trail Draft, demonstrated progress, unresolved questions, and next step before producing the durable outcome of a Learning Session.
_Avoid_: Automatic ending, mastery gate

**Consolidated Session Outcome**:
The durable, revisable result of Session Consolidation, including the Learning Trail, Understanding Evidence, unresolved questions, next step, and any selected Learning Artifacts.
_Avoid_: Transcript summary, completion badge

**Continuation Session**:
A new Learning Session linked to a Consolidated Session Outcome when the learner chooses to continue teaching work, preserving the earlier session as a stable historical record while carrying forward the relevant goal, return context, unresolved points, and evidence.
_Avoid_: Reopened consolidated session, appended transcript, duplicated history

**Session Status**:
The lifecycle state of a Learning Session, such as active, paused, or consolidated, recorded independently from any claim about the learner's understanding.
_Avoid_: Mastery level, learning score

**Target Disposition**:
The learner-selected outcome for a Session Target during consolidation: Addressed when the learner considers the session's treatment sufficient for now, Deferred when they intentionally postpone it, or Unresolved when the present work did not settle it. None is a mastery claim.
_Avoid_: Grade, Understanding Evidence, automatic completion

**Local Working Mode**:
The degraded but fully usable state in which local sources, sessions, annotations, indexes, artifacts, exports, and an installed Verifier Runtime remain available while model-dependent teaching and online research are unavailable.
_Avoid_: Fully offline AI, read-only failure screen

**Pending Question**:
An Ask Bar draft retained locally while the Model Runtime is unavailable and submitted only when the learner chooses after connectivity or access returns.
_Avoid_: Automatic retry, queued agent job

**Argument Roadmap**:
A compact, source-anchored outline of the major claims, stages, and dependencies in long mathematical material, used for orientation and session planning rather than expanded teaching.
_Avoid_: Full explanation, Concept Atlas

**Learning Slice**:
One coherent part of an Argument Roadmap, together with only the immediate prerequisites needed for a focused Learning Session.
_Avoid_: Page chunk, arbitrary token limit

**Concept Peek**:
A compact, collapsible explanation of a small prerequisite such as a definition, lemma, or familiar technique, anchored where it is needed without changing the current Learning Session.
_Avoid_: New session, permanent expansion

**Prerequisite Branch**:
A linked Learning Session for a substantial prerequisite that would otherwise overwhelm the current Learning Slice.
_Avoid_: Inline footnote, silent redirection

**Return Point**:
The exact source or reasoning anchor from which a Prerequisite Branch was opened, retained so the learner can return to the original Learning Session without reconstructing their place.
_Avoid_: Browser history, generic backlink

**Branch Trail**:
The persistent visible path from an originating Learning Session and Return Point through the currently active Prerequisite Branches.
_Avoid_: Raw navigation history, hidden stack

### Adaptive teaching

**Learner Model**:
A revisable, evidence-backed representation of what helps a learner engage, what they have demonstrated, and where uncertainty or recurring difficulty remains across Learning Sessions.
_Avoid_: Learning style, personality profile, mastery score

**Learner Model Ledger**:
The local, inspectable account of every active Interaction Preference and item of Understanding Evidence used for adaptation, showing its source, date, mathematical context, and later corrections or exclusions.
_Avoid_: Hidden profile, raw agent log, immutable learner label

**Adaptive Reuse Preference**:
An app-wide learner setting, enabled by default, that controls whether provenance-matched Learner Model information may guide work across Study Missions and Study Workspaces. It can be disabled globally or ignored for one Learning Session without deleting the underlying Session Records.
_Avoid_: Global mastery, permanent opt-out, Session Access Policy

**Interaction Preference**:
A revisable tendency in pace, questioning, formality, representation, or feedback that may change with the mathematical material and current goal.
_Avoid_: Learning style, learner type

**Evidence Transfer**:
The provenance-backed reuse of relevant Understanding Evidence in another Study Mission or Study Workspace after the underlying mathematical concept and context have been matched, without converting it into blanket mastery.
_Avoid_: Global mastery, preference transfer

**Understanding Evidence**:
A learner action or explanation that supports a context-specific inference about what they can currently recognize, explain, apply, or prove, including an exposed uncertainty or difficulty.
_Avoid_: Engagement signal, self-confidence, completion

**Understanding Check**:
A brief, contextual, skippable prompt used within a Learning Session to elicit Understanding Evidence when it can improve the next Teaching Move. It asks the learner to explain, reconstruct, diagnose, choose, or apply mathematical reasoning rather than merely recall a theorem name or repeat the studied example.
_Avoid_: Quiz, examination, completion gate, pure recall prompt

**Delayed Transfer Check**:
A learner-opted follow-up for one Addressed Session Target, scheduled after a learner-editable delay and using an unseen problem that requires the same underlying concept or proof method. No Delayed Transfer Check is created unless the learner explicitly opts in; the default delay is seven days.
_Avoid_: Automatic review assignment, repeated source question, mandatory homework, global spaced-repetition queue

**Delayed Transfer Evidence**:
High-quality, concept-specific Understanding Evidence produced by a completed Delayed Transfer Check and added automatically to the Learner Model with its source, delay, task, result, and confidence context. It may document demonstrated understanding or an exposed difficulty; declining, postponing, dismissing, or skipping a check produces no negative evidence.
_Avoid_: Global mastery score, penalty for opting out, permanent learner label

**Follow-ups Card**:
The single, non-blocking dashboard entry showing the aggregate number of due Delayed Transfer Checks and opening the Follow-up Queue without listing each check on the dashboard.
_Avoid_: One dashboard card per check, mandatory task list, interruption modal

**Follow-up Queue**:
The separate optional view containing the learner's explicitly requested Delayed Transfer Checks, organized away from active-session Resume Cards and ordinary Study Mission navigation.
_Avoid_: Main dashboard backlog, automatic homework plan, prerequisite for continuing work

**Delayed Check Result**:
The compact learner-facing outcome of a completed Delayed Transfer Check, identifying demonstrated reasoning, any specific difficulty, confidence calibration, and a recommended next action without assigning blanket mastery or failure.
_Avoid_: Grade, topic mastery score, failure label

**Refresher Session**:
A learner-started Learning Session linked from a Delayed Check Result to the exact relevant Source Anchor or Learning Trail point and focused on the exposed difficulty. It is offered but never opened automatically and does not rewrite the status of the original session.
_Avoid_: Automatic remediation, reopened original session, mandatory retry

**Learning Progress**:
An evidence-supported change toward a Learning Goal, judged by what the learner can recognize, explain, apply, or prove rather than by time, completion, or engagement alone.
_Avoid_: Content consumed, session length, activity

**Teaching Move**:
A deliberate next action, such as explaining, questioning, demonstrating, visualizing, comparing, or checking understanding, selected from the learner's input, Learning Goal, Session Record, and Learner Model.
_Avoid_: Response, fixed mode

**Teaching Card**:
The current structured learner-facing synthesis of Teaching Moves associated with one Source Anchor or focused question, updated through follow-up interaction rather than extended as a message feed.
_Avoid_: Assistant message, raw thread

**Teaching Variant**:
A separately named Teaching Card presenting a genuinely different mathematical or pedagogical route to the same focused question.
_Avoid_: Revision, duplicate response

**Question Card**:
A structured Teaching Card created or revised through the Ask Bar for an open-ended question that may not begin from a Source Anchor.
_Avoid_: Chat message, transcript fragment

**Teaching Experiment**:
A small, reversible change in Teaching Move used to test whether a different approach better supports the current learner, mathematical material, and Learning Goal.
_Avoid_: Personality test, permanent rule

### Mathematical trust

**Claim Origin**:
The provenance dimension identifying whether an exact mathematical claim or revision originated with the learner, a supplied source, a model, or a mixture of these, independently of how the claim was checked.
_Avoid_: Verification Level, ownership, correctness

**Verification Level**:
The assurance dimension describing whether an exact mathematical claim is Not independently checked, Independently checked, or Formally verified, without treating the level itself as a correctness guarantee.
_Avoid_: Claim Origin, confidence score, correctness guarantee

**Verification Currency**:
The condition of verification evidence relative to the exact current claim revision: Current when the examined claim is unchanged, or Changed since check after a semantic edit. Changed evidence remains inspectable but cannot support the current Verification Level until the claim is rechecked.
_Avoid_: Failed verification, whole-artifact invalidation

**Model-generated**:
A Claim Origin indicating that a mathematical claim or revision was produced by a model; it states nothing about its Verification Level.
_Avoid_: Not independently checked, verified, reliable by default

**Not independently checked**:
A Verification Level indicating that no qualifying independent examination applies to the exact current claim revision, including after a semantic change invalidates the currency of prior evidence.
_Avoid_: Model-generated, false, unchecked source origin

**Independently checked**:
A Verification Level indicating that a separate agent, tool, or authoritative source examined the exact mathematical claim and found no unresolved conflict; it is not a proof of correctness.
_Avoid_: Formally verified, proven

**Formally verified**:
A Verification Level reserved for the exact formal statement accepted by an identified proof checker under a recorded verification environment.
_Avoid_: Lean-assisted, probably correct, checked informally

**Source-grounded check**:
An independent comparison of a mathematical claim or reformulated proof against the learner's source or authoritative references, including its assumptions, dependencies, and logical structure.
_Avoid_: Citation attached, search-result match

**Verification Escalation**:
The selection of a stronger checking method when observable risk rises because of factors such as proof complexity, dependency depth, sparse or conflicting sources, a substantial departure from a known proof, or disagreement between checkers.
_Avoid_: Model confidence alone, formalize everything

**Verifier Runtime**:
The local environment that performs formal proof checks separately from model reasoning and identifies the exact checking environment used.
_Avoid_: Specialist Agent, model self-check

**Bundled Lean Runtime**:
The Verifier Runtime installed with the app by default and removable or reinstallable by the learner without affecting ordinary teaching or prior verification records.
_Avoid_: Required external setup, permanent app component

**Default Verification Environment**:
The complete versioned formal-checking environment supplied with an app release and used by default for supported verification work.
_Avoid_: Bare Lean executable, unversioned global setup

**Verification Environment Manifest**:
The recorded identity and versions of the exact formal-checking environment used for one verification result.
_Avoid_: App version alone, generic Lean badge

**Verifier Environment Registry**:
The catalog of versioned formal-checking environments available or retained for current and reproducible verification work.
_Avoid_: Shared mutable Lean folder, PATH discovery

**Pinned Verification Environment**:
An older verification bundle explicitly retained by the learner when it would otherwise be removed after a successful upgrade.
_Avoid_: Current default, permanently bundled version

**Verification Gap**:
An exact claim or reasoning step that remains unresolved because checking failed, was inconclusive, or could not be completed, together with the reason and the conclusions that depend on it.
_Avoid_: Hidden error, proof is false, generic warning

**Pedagogical Baseline**:
The learner-provided source whose notation, definitions, sequencing, and course context guide a Learning Session without being treated as mathematical ground truth.
_Avoid_: Source of truth, infallible textbook

**Source Corroboration**:
The comparison of a mathematical statement, its assumptions, and its known proof approaches against independent sources and published errata, with each source weighted by its authority and relevance.
_Avoid_: Single-source lookup, search-result agreement

**Corroboration Pass**:
A lightweight automatic Source Corroboration step for substantive proof work that identifies the relevant result, checks its assumptions and known errata, and seeks suitable independent support before teaching proceeds.
_Avoid_: Deep research, optional citation search

**Source Discrepancy**:
A material disagreement between a Pedagogical Baseline, another source, or a verification result that is preserved and surfaced rather than silently resolved.
_Avoid_: Hidden correction, notation difference

**Derived Research Query**:
A minimal external-search query formed from theorem names, assumptions, and mathematical keywords without including raw excerpts or identifying local-file metadata. Derived Research Queries may support web corroboration under every Session Access Policy; the policy limits which local material may inform the query.
_Avoid_: Document upload, copied passage

**Research Egress Permission**:
A Learning Session permission that explicitly authorizes whether raw excerpts from local sources may be sent to an external research service, independently of the configured model provider.
_Avoid_: Model access, blanket network consent

**Source Excerpt Egress Preference**:
An app-wide setting, disabled by default, that permits agents to send only the relevant excerpts, equations, or selected pages from local sources already available under the active Session Access Policy to external research services without repeated confirmation. It remains inspectable and restrictable per session and never authorizes whole-file transmission, local paths, unrelated content, annotations, or Personal Notes.
_Avoid_: Full-file upload permission, broader local access, hidden data sharing

**Session Access Policy**:
The learner-selected boundary for one Learning Session that controls which local sources may be read or used as model and research context and which agent tools may act on them. Every policy permits web corroboration through Derived Research Queries.
_Avoid_: App-wide permission, hidden escalation

**Access Elevation**:
A learner-approved, temporary change to a broader Session Access Policy whose increased authority applies only to the current Learning Session. The learner may initiate it, or an agent may request it with a reason and exact scope, but it is never granted automatically or inherited by another session.
_Avoid_: Permanent grant, silent retry

**Access Request**:
A visible agent proposal explaining why work requires material or tools outside the active Session Access Policy, the exact additional scope requested, and the intended action, which the learner may approve, narrow, or deny.
_Avoid_: Automatic elevation, generic permission prompt, hidden filesystem scan

**Focused Access**:
A Session Access Policy limited to material the learner has attached, pasted, highlighted, or explicitly selected for the current Learning Session.
_Avoid_: Workspace scan, implicit context

**Workspace Access**:
A Session Access Policy allowing agents to read the Study Workspace's Managed Assets and Source Snapshots, supported files beneath its optional Primary Folder, and External Attachments explicitly added to that workspace, in addition to current session material.
_Avoid_: Whole-device access, Full Access

**Full Access**:
A Session Access Policy allowing broader local-file and agent-tool access for the current Learning Session while preserving restrictions against arbitrary source-file modification or deletion. Its web-search capability is the same as the other policies; its broader local-source reach may inform those searches.
_Avoid_: Permanent access, unrestricted writes

**Access Confirmation Preference**:
A learner-controlled app-wide setting determining whether selecting Full Access requires an additional confirmation, without choosing an access policy for the learner or hiding the active policy.
_Avoid_: Mandatory prompt, invisible Full Access

### Learning artifacts

**Learning Trail**:
A compact, session-scoped, agent-curated record of the learner's route from a learning goal through essential concepts and reasoning steps to evidence, unresolved questions, and a next step.
_Avoid_: Transcript, summary, mind map

**Trail Item**:
A concept, reasoning step, Learning Artifact, evidence point, unresolved question, or next step selected for a Learning Trail; it may be proposed automatically or required by the learner.
_Avoid_: Saved message, bookmark

**Required Trail Item**:
A Trail Item explicitly added or marked by the learner that must remain visible through consolidation and regeneration until the learner removes that requirement.
_Avoid_: Agent suggestion, immutable content

**Trail Overview**:
The compact first layer of a Learning Trail containing its Learning Goal, central insight, essential reasoning path, demonstrated evidence, unresolved points, and next step.
_Avoid_: Full report, visual atlas

**Trail Draft**:
The visible, evolving set of Trail Items being curated for an active Learning Session before it becomes the session's Learning Trail.
_Avoid_: Final trail, checklist

**Concept Atlas**:
A deferred cross-session representation of evidence-backed mathematical concepts, relationships, uncertainties, and Understanding Evidence assembled from Learning Trails.
_Avoid_: Learning Trail, global mind map

**Learning Artifact**:
A durable, addressable output within a Session Record or assembled across sessions, such as a proof walkthrough, diagram, Learning Trail, or Concept Atlas, that can be edited, exported, or shared independently.
_Avoid_: Session state, transcript, source

**Artifact Revision**:
An immutable recoverable version created when a Learning Artifact is edited or regenerated, preserving the previous state and its provenance.
_Avoid_: Autosave event, duplicate artifact

**Section Regeneration**:
An agent rewrite limited to a learner-selected artifact section that preserves Required Trail Items, verbatim Personal Notes, and learner-authored content outside that boundary.
_Avoid_: Whole-artifact replacement, hidden overwrite

**Artifact Export**:
A portable copy of a Learning Artifact written to a user-chosen location without moving or replacing the in-app artifact.
_Avoid_: Publish, workspace storage

**Artifact Share**:
A handoff of an Artifact Export to another person, app, or service without granting access to its Study Workspace.
_Avoid_: Workspace sharing, synchronization

### Agent orchestration

**Model Runtime**:
The product capability that performs model-backed work for Learning Sessions while keeping model activity distinct from durable learning state.
_Avoid_: Model name, UI session

**Codex Runtime**:
The version-one Model Runtime that provides model-backed work through Codex and supports either ChatGPT subscription authentication or OpenAI API-key authentication.
_Avoid_: General ChatGPT OAuth, direct Responses API

**Teaching Orchestrator**:
The single coordinator that decides whether specialist work is needed, dispatches bounded Specialist Agents, and integrates their results into one coherent Learning Session.
_Avoid_: Swarm, learner-facing persona, group chat

**Teaching Agent**:
The primary active agent responsible for selecting or carrying out the next Teaching Move and synthesizing learner-facing output within a Learning Session under the Teaching Orchestrator.
_Avoid_: Chatbot, fixed persona, agent team

**Specialist Agent**:
A task-scoped agent assigned one defined capability, such as source analysis, teaching design, counterexample search, verification, formalization, or artifact synthesis.
_Avoid_: Independent tutor, permanent agent

**Agent Brief**:
The minimal task-specific context a Specialist Agent receives, including the Learning Goal, relevant source anchors, constraints, learner evidence, expected output, and verification needs.
_Avoid_: Full thread, shared chat

**Agent Budget**:
A task-level limit on agent count, concurrency, model, reasoning effort, tool access, token use, and latency.
_Avoid_: Unlimited swarm, maximum effort by default

**Agent Task**:
A bounded unit of orchestrated work tied to a Learning Session, with one learner-relevant purpose and Agent Budget even when several internal Specialist Agents contribute.
_Avoid_: Entire Learning Session, unbounded swarm, individual message

**Agent Task Status**:
A compact learner-facing account of one integrated unit of agent work, stating its current purpose and whether it is working, waiting, failed, stopped, or complete, with relevant cancel or retry actions but without exposing the internal multi-agent message stream.
_Avoid_: Agent transcript, spinner without purpose, per-agent status feed

**Background Agent Task**:
An Agent Task tied to a Learning Session that may continue while the learner navigates elsewhere within the running app. Quitting the app checkpoints and stops it, and reopening offers explicit resumption rather than silently restarting model usage.
_Avoid_: Hidden daemon, detached cloud job, automatic post-quit spending

**Reasoning Preference**:
A learner-selected Faster, Balanced, or Deeper session-level bias that guides automatic Agent Budgets without prescribing one model or effort for every task.
_Avoid_: Exact model override, learning style

**Runtime Override**:
An optional advanced setting that explicitly selects available model or reasoning parameters for a Learning Session instead of relying entirely on automatic routing.
_Avoid_: Default setup, permanent requirement

**Agent Work Log**:
The locally retained observable execution history of agents supporting a Learning Session, including messages, tool activity, outputs, revisions, and verification events.
_Avoid_: Session Record, learner-facing transcript, hidden reasoning
