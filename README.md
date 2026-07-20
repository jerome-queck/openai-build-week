# Quick Study

Quick Study is a local-first macOS mathematical learning workbench. It starts durable Learning Sessions directly from typed mathematics without requiring setup, organizes them under Study Workspaces and Study Missions, and restores the latest resumable work after quit and relaunch. Substantial teaching output can become a source-linked Learning Artifact or Reformulated Proof with recoverable revision provenance, previewed Section Regeneration that preserves protected content and invalidates only changed claims, portable Markdown export, and a macOS share handoff that exposes only the export.

Bounded Agent Tasks may continue while the learner navigates elsewhere in the running app. Their current purpose and status remain visible, cancellation preserves useful partial results, failures offer an explicit retry, and quitting checkpoints unfinished work. Relaunch never restarts model usage automatically; the learner must explicitly resume the existing Agent Task and Learning Session.

The built-in Quick Study workspace remains the immediate home for loose work. A learner can later file a Quick Study session into a named Study Workspace and Study Mission without replacing the session or losing its Learning Goal, Session Target, or return context.

Study Workspaces can link one Primary Folder and individual External Attachments without copying or modifying them. Fileless typed mathematics is retained as a Managed Asset. Linked Sources reopen through a read-only Source Layer. Stale bookmarks are refreshed when they still resolve; an unavailable source keeps its identity and associations while offering Retry and Locate again. Fingerprint changes create visible Source Revisions and rebuild derived search data. Strong, unique Re-anchoring matches advance automatically, while uncertain and missing matches remain visible as Unresolved Anchors with their affected Teaching Cards, annotations, and Trail Items until the learner accepts, replaces, or leaves them unresolved. Unresolved Anchors are excluded from current model context. Exact Source Snapshots are Managed Assets created only when the learner explicitly requests one; unsnapshotted historical content is reported as unavailable rather than reconstructed from fingerprints or indexes.

Supported Linked Sources can build a separate local Source Index containing searchable extracted or recognized text, page and equation geometry, and small thumbnails. Search results identify the source and exact location before reopening the original. Clearing or rebuilding this derived cache never changes the Linked Source, Source Anchors, or Learning Session records, and unavailable originals cannot be reconstructed through search.

## Requirements

- macOS
- Node.js 22 or 24 and npm 11

Node.js 26 is not currently supported by the Electron packaging toolchain.

## Development

Before contributing, read [`CONTRIBUTING.md`](CONTRIBUTING.md) for the GitHub workflow and [`CODING_STANDARDS.md`](CODING_STANDARDS.md) for the repository-wide engineering contract.

Install the pinned dependencies and launch the renderer and Electron main process:

```sh
npm ci
npm run dev
```

The development command builds the native Source Index and security-scoped bookmark helpers before starting Electron. Restart it after changing either helper under `native/` so it is rebuilt.

The first development or production build downloads the official Lean 4.29.1 archive for the current Mac architecture, verifies its pinned SHA-256 digest, checks out mathlib 4.29.1 at its pinned commit, and uses mathlib's cache tool to prepare the transitive precompiled support closure for the immutable `lean-4.29.1-mathlib-4.29.1-quick-study-v1` environment. Its undergraduate-foundations profile spans naturals, reals, algebraic groups, topology, and differential calculus; this release exposes one app-supported exact formalization. The staged environment must accept the app's real reference proof before atomic activation. Downloads are reused from `node_modules/.cache/quick-study-lean`; learners do not need a separate Lean or `elan` installation. On first application launch, Quick Study atomically installs the validated default into its local Verifier Environment Registry. The registry shows installed versions, logical storage, the active default, pins, and retained Verifier Manifest references; it switches versions only after validation and allows a rollback to a retained version. Cleanup removes only inactive, unpinned versions without retained Manifest references. Learners can remove the active logical-size registry copy and reinstall it later from the signed application payload; the interface notes that macOS determines the actual disk space freed because the installer payload remains. Interrupted staging is kept inactive and exposed through cleanup or retry actions.

Local application data uses Electron's standard `userData` directory. Set `QUICK_STUDY_DATA_DIR` to isolate it when developing or diagnosing persistence.

## Verification

```sh
npm run lint        # renderer and shared-code static analysis
npm run typecheck   # renderer, Learning Application, preload, and main process
npm test            # deterministic Learning Application behavior
npm run build       # production renderer and Electron main-process bundles
npm run package     # ad-hoc-signed macOS .app under out/
npm run test:smoke  # packaged start, persist, quit, relaunch, and resume
npm run quality:gate -- --evidence /absolute/path/to/release-evidence.json --out /absolute/path/to/report
npm run verify      # all of the above in release order
```

The versioned mathematical and failure-recovery release gate, operational budgets, evidence-collection procedure, and moderated learning-study instruments live under [`evaluation/`](evaluation/README.md). `npm run verify` exercises the gate with a clearly labelled deterministic fixture; a real release decision must supply separately collected evidence and can never default to that fixture.

The packaged smoke test expects `npm run package` to have completed first. Packaging targets the current Mac architecture and produces `out/Quick Study-darwin-<arch>/Quick Study.app`. The build is ad-hoc signed for local and CI execution; distribution signing and notarization are separate release work.

## Environment and demo evidence

This walking skeleton needs no API keys or application secrets. `QUICK_STUDY_DATA_DIR` is the only supported user-facing runtime override; it selects an isolated local data directory and must not point at imported learner sources. Do not commit learner data or local `.env` files. `QUICK_STUDY_LEAN_PATH` exists only for deterministic adapter tests and diagnosis; normal installations always use the packaged, pinned verifier. The packaged smoke test supplies isolated `QUICK_STUDY_TEST_*` fixture paths and a stubbed external-research handoff; those variables are test harness inputs, not product configuration.

There is no hosted preview or deployment for this local-first desktop slice. The packaged `.app` is the preview artifact. A successful `npm run test:smoke` is the expected demo evidence: it organizes and resumes durable study work; keeps Background Agent Tasks visible across navigation; preserves checkpoints through cancellation, failure, quit, and explicit post-relaunch resumption; builds, searches, clears, and rebuilds a local Source Index; recovers a moved Linked Source through Locate again; detects a changed source, records its revision, and rebuilds its index; creates an explicit Source Snapshot without mutating the original; enters and recovers from Local Working Mode without automatic submission; formally checks one exact natural-number claim with packaged Lean, removes Lean while preserving the historical Verifier Manifest, shows formal checking as unavailable, reinstalls the same supported environment, and accepts a post-reinstall check; and exports a source-linked Reformulated Proof by keyboard. GitHub's macOS CI runs the full `npm run verify` lane for pull requests.

## Architecture

- `src/shared/learning-application.ts` is the public Learning Application boundary and owns Study Workspace, Study Mission, Learning Session, Managed Asset and Linked Source relationships, Source Index lifecycle and search, filing, navigation, Local Working Mode, Pending Questions, privacy-minimized external-research receipts, evidence-weighted Corroboration Passes and Source Discrepancies, cancellation, session-scoped permissions, the recoverable Verifier Environment lifecycle, exact-claim Verifier Manifests, section-scoped Learning Artifact regeneration and claim-level invalidation, Learning Artifact revisions and portable-copy construction, session metadata search, and durable state transitions. `src/shared/external-research.ts` and `src/shared/verifier-runtime.ts` are provider-neutral external-research and formal-verifier contracts; both remain separate from the Model Runtime boundary. Canonical application state and the clearable `source-index.json` cache are persisted separately and atomically.
- `src/main/` owns filesystem persistence and narrow macOS adapters for source access, Artifact Share, disclosed browser research, the atomic Verifier Environment Registry, and the bounded local Lean process. It requests and refreshes security-scoped bookmarks when the Mac App Store runtime supports them, records no synthetic permission grant in the current non-App-Sandbox preview package, balances scoped access around read-only, indexing, and explicit snapshot operations, uses bounded native helpers for bookmark resolution and PDFKit/Vision extraction, hands only a temporary Artifact Export to the native share menu, opens only the inspectable DuckDuckGo HTTPS research destination constructed by the Learning Application, installs a new pinned verifier through isolated staging, records its validated content digest, activates an immutable registry version only after success, rechecks the active version at the execution boundary, executes it against atomically retained proof evidence, and exposes typed operations through a sandboxed preload bridge. The last-known path lets that unrestricted preview reopen a source but is never presented as sandbox authority.
- `src/renderer/` is the React Mathematical Workbench.
- `tests/packaged-quick-study.spec.ts` launches the packaged application and verifies organization, Source Index build/search/clear/rebuild, identity-preserving filing, keyboard-operable source, hierarchy, and Artifact Export controls, source non-mutation across relaunch, Local Working Mode, access recovery, explicit Pending Question submission, Lean removal/unavailable/reinstall behavior with preserved evidence, and source-linked Reformulated Proof export through the visible UI.
