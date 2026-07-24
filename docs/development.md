# Development guide

This is the canonical guide for building and verifying Quick Study from source. It owns the supported development environment, setup, runnable commands, native and Verifier Runtime preparation, packaging, packaged smoke tests, and developer troubleshooting. `package.json` and [macOS CI](../.github/workflows/macos-ci.yml) remain the executable sources; update this guide when those sources or the supported workflow changes.

## Supported environment

- macOS 14 Sonoma or later
- Apple Silicon is the validated beta baseline
- At least 16 GB memory and 12 GB free disk space
- Node.js 22 or 24 and npm 11 (`npm run verify` is exercised with Node 24 in macOS CI)
- Node.js 26 is not supported by the Electron packaging toolchain

The application is local-first and does not need an API key or application secret for the walking-skeleton development flow. Codex authentication is owned by Codex when model-backed teaching is used.

## Set up and run

From a clean checkout, install the pinned dependency tree:

```sh
npm ci
```

Start the renderer, main-process typecheck watcher, native helpers, bundled Verifier Runtime preparation, and Electron development app with:

```sh
npm run dev
```

The development command builds the native Source Index and security-scoped bookmark helpers before starting Electron. Restart it after changing either helper under `native/` so the helper is rebuilt.

The first development or production build downloads the pinned Lean 4.29.1 archive for the current Mac architecture, verifies its SHA-256 digest, checks out mathlib 4.29.1 at its pinned commit, and prepares the immutable `lean-4.29.1-mathlib-4.29.1-quick-study-v1` environment. The staged environment must accept the app's reference proof before activation. Downloads are reused from `node_modules/.cache/quick-study-lean`; a separate Lean or `elan` installation is not required.

Use Electron's standard local application-data directory by default. Set `QUICK_STUDY_DATA_DIR` when an isolated directory is needed for development or diagnosis. `QUICK_STUDY_LEAN_PATH` is reserved for deterministic adapter tests and diagnosis; normal installations use the packaged verifier. `QUICK_STUDY_TEST_*` variables belong to the packaged test harness and are not product configuration.

## Verification commands

Run focused checks while changing code, then run the complete lane before review:

| Command | Purpose |
| --- | --- |
| `npm run lint` | Renderer and shared-code static analysis |
| `npm run typecheck` | Renderer, Learning Application, preload, main, and quality-gate TypeScript checks |
| `npm test` | Deterministic unit and integration tests |
| `npm run build` | Production renderer, main-process, native-helper, and verifier build |
| `npm run security:dependencies` | Production dependency audit |
| `npm run security:secrets` | Full-history secret scan with the pinned Gitleaks release |
| `npm run security:swift` | Warnings-as-errors Swift boundary analysis |
| `npm run license:audit` | Inspect a packaged application for required legal surfaces, upstream notices, and allowed runtime dependency licenses |
| `npm run policy:documentation` | Required documents, local Markdown links and anchors, documented npm commands, pull-request template declarations, active repository-reference checks, and conservative ignore-rule checks; PR-body answers are checked in pull-request CI |
| `npm run policy:classify -- --base <sha> --head <sha>` | Fail-closed changed-path classification and selected verification surfaces |
| `npm run test:policy` | Focused policy fixtures for documentation and changed-path classification |
| `npm run verify:prepackage` | Run the required lint, typecheck, unit, policy-fixture, and documentation-policy checks |
| `npm run verify:package` | Run the quality fixture, package, maker, and packaged smoke lane |
| `npm run quality:gate:fixture` | Deterministic quality-gate harness fixture only |
| `npm run quality:gate -- --evidence /absolute/path/to/release-evidence.json --out /absolute/path/to/report` | Evaluate separately collected release evidence |
| `npm run package` | Package an ad-hoc-signed macOS application under `out/` |
| `npm run make:beta` | Create the architecture-native beta ZIP from the packaged app |
| `npm run test:smoke` | Install the ZIP and exercise critical packaged journeys |
| `npm run verify` | Run the core checks, policy fixtures, documentation policy, quality fixture, package, maker, and packaged smoke lane in release order |

The smoke command expects `npm run package` and `npm run make:beta` to have completed first. It extracts the archive into an isolated installation directory, verifies the code signature and bundled verifier, and launches the installed application. The packaged scenarios cover source/index and access transitions, verifier removal/reinstall and artifact export, delayed-transfer persistence, cold-start/resource budgets, Agent Task recovery, Local Working Mode, authentication navigation, and action-level lifecycle diagnostics. A scenario timeout is not a product-operation timeout.

The [evaluation guide](../evaluation/README.md) owns benchmark evidence collection, moderated learning-study instruments, live model samples, and candidate quality reports. It is the source for release-evidence procedures, not a replacement for this development command matrix.

## Packaging and distribution boundary

`npm run package`, `npm run make:beta`, and `npm run test:smoke` produce an internal evaluation candidate for the current Mac architecture. The archive is ad-hoc signed and is not a signed, notarized ordinary-user release. Do not publish it as a public download or instruct users to bypass Gatekeeper. Developer ID signing, notarization, stapling, assessment, and a clean-machine audit remain future release gates.

Every packaged application also includes Clarifold's `LICENSE.md`, `NOTICE`, and
`THIRD_PARTY_NOTICES.md` at the application resource root. Electron's own
`LICENSE` and `LICENSES.chromium.html` files are copied into the application
resource root as `ELECTRON_LICENSE` and `CHROMIUM_LICENSES.html` before code
signing for ZIP
recipients. The Verifier Environment's upstream license files remain alongside
their respective packaged components. Keep these files with any permitted
noncommercial redistribution and consult the [license audit](legal/dependency-and-asset-license-audit.md)
when the packaged contents change.

For candidate evidence, use the commands in the [evaluation guide](../evaluation/README.md) after collecting evidence against the exact committed candidate. Do not publish candidate evidence or rebuild the application after the evidence has been bound to a commit.

## Troubleshooting

### Node or packaging failures

Use Node 24 for the release lane and confirm the active version before diagnosing packaging failures. Node 26 is outside the supported engine range. Remove only the relevant generated output and rerun the focused command; do not delete learner data or Linked Sources.

### Native helper changes

`npm run dev` and `npm run build` compile the Swift helpers. Restart the development process after changing `native/source-index-extractor.swift` or `native/source-bookmark-helper.swift`. `npm run security:swift` runs the warnings-as-errors analysis without packaging the app.

### Verifier preparation

The first build may download and prepare the pinned Lean/mathlib environment. Check the reported digest, architecture, and staged preparation error. A failed preparation must not be treated as a ready Verifier Environment; retry the build or use the application's visible recovery action.

After formal verification, wait for the learner-visible Codex runtime lifecycle to reach `available` or `failed`; the verifier result and runtime restoration are deliberately separate correlated states. Packaged tests should wait on that named terminal state rather than a fixed delay or an incidental manifest count.

### Isolated data and smoke runs

Set `QUICK_STUDY_DATA_DIR` to a fresh temporary directory when reproducing persistence or packaged behavior. The smoke installer creates its own isolated paths. Linked Sources remain externally owned; never use a source fixture as the application-data directory.

### Packaged output already exists

The package and maker write under `out/`. Preserve any candidate-bound evidence before cleaning generated output, then rerun the complete affected lane so the archive, smoke receipt, and digest describe one exact candidate.

## Maintenance

The maintainer reviews this guide whenever `package.json`, the macOS workflow, the supported Node/macOS baseline, packaging behavior, Verifier Runtime preparation, developer recovery paths, or verification-policy surfaces change. The documentation policy and changed-path classifier are repository-owned checks; vendored or upstream skill sources remain untouched.
