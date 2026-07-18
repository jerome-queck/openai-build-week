# Quick Study

Quick Study is a local-first macOS mathematical learning workbench. The current walking skeleton starts a durable Learning Session directly from typed mathematics, keeps its Learning Goal and Session Target editable, and resumes the same work after quit and relaunch without requiring workspace setup.

## Requirements

- macOS
- Node.js 22 or 24 and npm 11

Node.js 26 is not currently supported by the Electron packaging toolchain.

## Development

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

There is no hosted preview or deployment for this local-first desktop slice. The packaged `.app` is the preview artifact. A successful `npm run test:smoke` is the expected demo evidence: it starts Quick Study without workspace setup, persists edited session focus, quits the packaged app, relaunches it, and resumes the same Learning Session. GitHub's macOS CI runs the full `npm run verify` lane for pull requests.

## Architecture

- `src/shared/learning-application.ts` is the public Learning Application boundary and owns learner actions plus durable state transitions.
- `src/main/` owns filesystem persistence and exposes only typed learning actions through a sandboxed preload bridge.
- `src/renderer/` is the React Mathematical Workbench.
- `tests/packaged-quick-study.spec.ts` launches the packaged application and verifies the critical relaunch journey through the visible UI.
