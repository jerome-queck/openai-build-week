# Quick Study

Quick Study is a local-first macOS mathematical learning workbench. It starts durable Learning Sessions directly from typed mathematics without requiring setup, organizes them under Study Workspaces and Study Missions, and restores the latest resumable work after quit and relaunch.

The built-in Quick Study workspace remains the immediate home for loose work. A learner can later file a Quick Study session into a named Study Workspace and Study Mission without replacing the session or losing its Learning Goal, Session Target, or return context.

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

This walking skeleton needs no API keys or application secrets. `QUICK_STUDY_DATA_DIR` is the only supported runtime override; it selects an isolated local data directory and must not point at imported learner sources. Do not commit learner data or local `.env` files.

There is no hosted preview or deployment for this local-first desktop slice. The packaged `.app` is the preview artifact. A successful `npm run test:smoke` is the expected demo evidence: it organizes and resumes durable study work, enters Local Working Mode during controlled access loss, searches and edits local session metadata, retains a Pending Question without automatic submission, then restores access and submits only on the learner's keyboard action. GitHub's macOS CI runs the full `npm run verify` lane for pull requests.

## Architecture

- `src/shared/learning-application.ts` is the public Learning Application boundary and owns Study Workspace, Study Mission, Learning Session, filing, navigation, Local Working Mode, Pending Questions, session metadata search, and durable state transitions.
- `src/main/` owns filesystem persistence and exposes only typed learning actions through a sandboxed preload bridge.
- `src/renderer/` is the React Mathematical Workbench.
- `tests/packaged-quick-study.spec.ts` launches the packaged application and verifies organization, identity-preserving filing, keyboard-operable navigation, quit and relaunch, Local Working Mode, access recovery, and explicit Pending Question submission through the visible UI.
