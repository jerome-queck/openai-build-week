# Quick Study

Quick Study is a local-first macOS mathematical learning workbench. It starts durable Learning Sessions directly from typed mathematics without requiring setup, organizes them under Study Workspaces and Study Missions, and restores the latest resumable work after quit and relaunch. Substantial teaching output can become a source-linked Learning Artifact or Reformulated Proof with recoverable revision provenance, portable Markdown export, and a macOS share handoff that exposes only the export.

The built-in Quick Study workspace remains the immediate home for loose work. A learner can later file a Quick Study session into a named Study Workspace and Study Mission without replacing the session or losing its Learning Goal, Session Target, or return context.

Study Workspaces can link one Primary Folder and individual External Attachments without copying or modifying them. Fileless typed mathematics is retained as a Managed Asset. Linked Sources reopen through a read-only Source Layer; an unavailable source keeps its identity and can be retried without changing its association.

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

The development command builds the native Source Index helper before starting Electron. Restart it after changing `native/source-index-extractor.swift` so the helper is rebuilt.

Local application data uses Electron's standard `userData` directory. Set `QUICK_STUDY_DATA_DIR` to isolate it when developing or diagnosing persistence.

## Verification

```sh
npm run lint        # renderer and shared-code static analysis
npm run typecheck   # renderer, Learning Application, preload, and main process
npm test            # deterministic Learning Application behavior
npm run build       # production renderer and Electron main-process bundles
npm run package     # ad-hoc-signed macOS .app under out/
npm run test:smoke  # packaged start, persist, quit, relaunch, and resume
npm run verify      # all of the above in release order
```

The packaged smoke test expects `npm run package` to have completed first. Packaging targets the current Mac architecture and produces `out/Quick Study-darwin-<arch>/Quick Study.app`. The build is ad-hoc signed for local and CI execution; distribution signing and notarization are separate release work.

## Environment and demo evidence

This walking skeleton needs no API keys or application secrets. `QUICK_STUDY_DATA_DIR` is the only supported user-facing runtime override; it selects an isolated local data directory and must not point at imported learner sources. Do not commit learner data or local `.env` files. The packaged smoke test supplies isolated `QUICK_STUDY_TEST_*` fixture paths; those variables are test harness inputs, not product configuration.

There is no hosted preview or deployment for this local-first desktop slice. The packaged `.app` is the preview artifact. A successful `npm run test:smoke` is the expected demo evidence: it organizes and resumes durable study work, builds, searches, clears, and rebuilds a local Source Index, enters Local Working Mode during controlled access loss, searches and edits local session metadata, retains a Pending Question without automatic submission, restores access and submits only on the learner's keyboard action, then promotes anchored teaching to a Reformulated Proof and exports a source-linked portable copy by keyboard. GitHub's macOS CI runs the full `npm run verify` lane for pull requests.

## Architecture

- `src/shared/learning-application.ts` is the public Learning Application boundary and owns Study Workspace, Study Mission, Learning Session, Managed Asset and Linked Source relationships, Source Index lifecycle and search, filing, navigation, Local Working Mode, Pending Questions, Learning Artifact revisions and portable-copy construction, session metadata search, and durable state transitions. Canonical application state and the clearable `source-index.json` cache are persisted separately and atomically.
- `src/main/` owns filesystem persistence and narrow macOS adapters for source access and Artifact Share. It requests security-scoped bookmarks when the Mac App Store runtime supports them, records no synthetic permission grant in the current non-App-Sandbox preview package, balances scoped access around read-only and indexing operations, uses a bounded native PDFKit/Vision helper for PDF extraction, OCR, geometry, and thumbnails, hands only a temporary Artifact Export to the native share menu, and exposes typed operations through a sandboxed preload bridge. The last-known path lets that unrestricted preview reopen a source but is never presented as sandbox authority.
- `src/renderer/` is the React Mathematical Workbench.
- `tests/packaged-quick-study.spec.ts` launches the packaged application and verifies organization, Source Index build/search/clear/rebuild, identity-preserving filing, keyboard-operable source, hierarchy, and Artifact Export controls, source non-mutation across relaunch, Local Working Mode, access recovery, explicit Pending Question submission, and source-linked Reformulated Proof export through the visible UI.
