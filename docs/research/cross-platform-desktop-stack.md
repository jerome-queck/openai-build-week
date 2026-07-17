# Cross-platform desktop stack for the mathematical learning app

Research date: 2026-07-18

Decision update: [ADR 0002](../adr/0002-build-macos-first-with-a-portable-electron-core.md) accepts Electron with React and TypeScript but defers all Windows and Linux builds, CI, packaging, and platform QA until the macOS product is fully featured. The cross-platform evidence below remains background for the later port; its earlier recommendation to begin multi-platform CI after scaffolding is superseded.

## Recommendation

Use **Electron + React + TypeScript for version one**, with a sandboxed renderer, a narrow typed preload bridge, and all filesystem, database, Codex, and Lean work owned by the main process. Package with Electron Forge. Keep the application architecture portable to macOS, Windows, and Linux, but ship and describe only the platforms that have actually passed the release matrix.

This is a product judgment, not a claim made by the frameworks. Electron is the lower-risk choice for this app because its Node main process is a direct fit for the official Codex TypeScript SDK and `codex app-server`, both of which are subprocess-and-stream oriented. It also supplies one bundled Chromium version for the PDF/canvas/graph/math surface. Tauri 2 is credible and materially better at package size, declarative least privilege, first-party SQLite, and Linux-capable updates, but it adds a Rust/IPC boundary and system-WebView variance to the two riskiest parts of this build.

For the hackathon, target a tested **macOS build**. The [Official Rules](https://openai.devpost.com/rules) require a project to install and run consistently on **the platform for which it is intended**; they do not require macOS, Windows, and Linux. A submission may therefore identify macOS as the current intended platform while retaining Windows and Linux as deferred future platforms. Do not claim three-platform support until all three are tested.

## Evidence and trade-offs

The statements in the **Evidence** columns are source-backed facts. The **Decision** column is inference for this product.

| Concern | Electron evidence | Tauri 2 evidence | Decision for this app |
| --- | --- | --- | --- |
| React/TypeScript graph and canvas UI | Electron renderers are Chromium web pages and use ordinary web tooling; Electron embeds Chromium and Node and targets Windows, macOS, and Linux ([process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [overview](https://www.electronjs.org/docs/latest/)). | Tauri renders HTML in an OS WebView and exposes TypeScript bindings to a Rust core; ordinary frontend frameworks are supported ([architecture](https://v2.tauri.app/concept/architecture/), [frontend setup](https://v2.tauri.app/start/frontend/)). | Both can host the same React graph/canvas UI. Electron's fixed Chromium reduces renderer variability during a short build. |
| PDF, images, and region annotations | The renderer supplies normal browser APIs. | The renderer also supplies browser APIs, but uses WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux ([process model](https://v2.tauri.app/concept/process-model/), [WebView versions](https://v2.tauri.app/reference/webview-versions/)). | Use [PDF.js](https://mozilla.github.io/pdf.js/examples/) for canvas rendering and maintain annotations as the app's own page-plus-normalized-box overlay. Electron is lower risk; Tauri needs three-engine visual tests. PDF.js workers must be tested under the packaged local protocol because its [getting-started guide](https://mozilla.github.io/pdf.js/getting_started/) notes limitations under `file://`. |
| Mathematical typesetting | Web assets can be bundled into the renderer. | Same. | Neutral. [KaTeX supports major browsers](https://katex.org/docs/browser) and is the lean default; [MathJax produces HTML or SVG in modern browsers and can be hosted locally](https://docs.mathjax.org/en/stable/web/start.html). Bundle either locally rather than depend on a CDN. |
| Filesystem and Study Workspace roots | Electron's main process can use all Node APIs, while the renderer is separated by preload/IPC ([process model](https://www.electronjs.org/docs/latest/tutorial/process-model)). Electron's security guide requires context isolation, renderer sandboxing, CSP, and IPC sender validation ([security checklist](https://www.electronjs.org/docs/latest/tutorial/security)). | Capabilities grant commands to particular windows/WebViews, and filesystem scopes constrain allowed paths ([capabilities](https://v2.tauri.app/security/capabilities/), [filesystem scopes](https://v2.tauri.app/plugin/file-system/)). Dialog-selected paths enter the runtime scope and can be retained with the persisted-scope plugin ([dialog API](https://v2.tauri.app/reference/javascript/dialog/)). | Tauri has the stronger ready-made least-privilege model. With Electron, implement that policy: the main process records user-approved roots, canonicalizes every path, rejects escapes/symlink violations, and exposes task-specific IPC rather than generic `read(path)` or `spawn(command)`. |
| Local data and SQLite | `app.getPath('userData')` provides the conventional per-user data location. Native Node modules work but must match Electron's ABI; Forge performs rebuilds automatically ([app paths](https://www.electronjs.org/docs/latest/api/app), [native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)). | The official SQL plugin supports SQLite and locates its database relative to app configuration data ([SQL plugin](https://v2.tauri.app/plugin/sql/)). | Tauri wins this row. Electron remains viable, but the SQLite driver and packaged migration behavior are a prototype gate because Electron has no first-party database layer. Store the DB in an app-specific subdirectory, separate from imported source files. |
| Codex integration and dual authentication | The official [Codex TypeScript SDK](https://github.com/openai/codex/blob/main/sdk/typescript/README.md) requires Node 18+, wraps the Codex CLI, exchanges JSONL over stdin/stdout, supports streamed events, and explicitly documents controlled environments for Electron. `codex app-server` uses bidirectional JSON-RPC over JSONL stdio, exposes version-matched generated TypeScript schemas, and supports both ChatGPT-managed OAuth/device-code and API-key login ([app-server protocol and auth](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)). | Tauri's shell API can spawn a process, stream stdout/stderr, write stdin, and capability-scope executable names and arguments ([shell plugin](https://v2.tauri.app/plugin/shell/), [sidecars](https://v2.tauri.app/develop/sidecar/)). A bundled sidecar needs a binary for each target triple. | Electron wins the core integration seam: no Rust bridge is needed between the official TypeScript client and Node process streams. Use app-server directly when the UI needs account state, login, approvals, and lifecycle events; keep credentials and auth RPCs out of the renderer. Pin the Codex package and generate protocol types from that exact version. |
| Lean subprocesses | The Node main process can launch and stream an external process; Electron also exposes piped utility-process output ([utility process](https://www.electronjs.org/docs/latest/api/utility-process)). | The shell/sidecar APIs support the same lifecycle with declarative command scope. | Both work. Electron is simpler in a TypeScript-only v1; Tauri is safer by configuration. Launch only a resolved `elan`/`lake`/`lean` executable with structured arguments and a Study Workspace `cwd`, never through a shell string. [Elan](https://github.com/leanprover/elan) selects the toolchain from `lean-toolchain`; Lean publishes binaries for Linux, macOS, and Windows with explicit support tiers ([platforms](https://lean-lang.org/doc/reference/latest/platforms/)). |
| Auto-update | Electron's built-in updater supports macOS and Windows; Linux is delegated to distribution package managers. macOS updates require signing ([autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater/)). | The updater supports macOS, Windows, and Linux and generates signed updater artifacts ([updater](https://v2.tauri.app/plugin/updater/)). | Tauri wins. Auto-update is not needed for the hackathon test build; defer it rather than let it decide the initial stack. |
| Packaging, signing, and CI | Forge packages Electron plus the app, produces OS-specific makers, automates native-module rebuilds, and recommends native Windows/macOS/Linux CI because cross-building has caveats ([packaging](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging), [Forge lifecycle](https://www.electronforge.io/core-concepts/build-lifecycle)). macOS distribution requires signing and notarization; Windows distribution should be signed ([Electron signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)). | Tauri bundles formats for each platform, documents macOS and Windows signing, and publishes an official GitHub Actions matrix for macOS, Ubuntu, and Windows ([distribution](https://v2.tauri.app/distribute/), [macOS signing](https://v2.tauri.app/distribute/sign/macos/), [Windows signing](https://v2.tauri.app/distribute/sign/windows/), [pipeline](https://v2.tauri.app/distribute/pipelines/github/)). | Comparable release work. Build and sign on the target OS. A successful local development build is not evidence that Codex, Lean, SQLite, and PDF workers survived packaging. |
| Bundle size and security surface | Electron ships Electron, Chromium, and Node. Its security guide makes the app responsible for updating that bundle and hardening its privileged boundary ([security](https://www.electronjs.org/docs/latest/tutorial/security), [size discussion](https://www.electronjs.org/docs/latest/why-electron)). | Tauri dynamically uses the OS WebView, does not ship that runtime, and offers capability-scoped IPC ([architecture](https://v2.tauri.app/concept/architecture/), [security](https://v2.tauri.app/security/)). | Tauri should produce a much smaller shell and starts with a better declarative boundary. Actual installer size must be measured: React, PDF.js, fonts, Codex, and any Lean payload make minimal-framework figures non-comparable. Electron's cost is acceptable for v1 only if the packaged footprint and idle memory pass the prototype budget. |

## Version-one shape

```text
React/TypeScript renderer
  - Reader: PDF.js canvas/image plus source-region overlay
  - Mathematical Workbench: Source Layer, Contextual Inspector, Learning Trail, and Learning Artifacts
  - KaTeX by default; MathJax only where its coverage/accessibility is needed
        |
        | narrow typed preload API
        v
Electron main-process broker
  - approved Study Workspace roots and path policy
  - SQLite repository under app user data
  - one supervised Codex app-server over JSONL stdio
  - supervised elan/lake/lean processes
  - auth URL opening, lifecycle, cancellation, logs
```

Security invariants:

- local packaged renderer only; no Node integration;
- context isolation, sandboxing, restrictive CSP, navigation/new-window denial, and IPC sender checks;
- no generic shell, filesystem, or database API exposed to React;
- renderer receives redacted domain events, not API keys, Codex token files, raw environment variables, or unrestricted process handles;
- every Codex thread and Lean invocation is bound to one canonical Study Workspace root; and
- import, annotation, database, and generated-output paths remain distinct.

## Deferred rollout and verification matrix

Only the macOS work below is in current scope. The Windows, Linux, and multi-platform CI steps are retained as future acceptance criteria, not present work.

1. **Initial packaged macOS slice:** prove the installed shell can launch, persist and resume one Quick Study session, and exercise its real development, test, and packaging seams. Later vertical slices add packaged Codex, source, and Lean checks without waiting for the final beta.
2. **macOS beta candidate:** test the documented supported hardware, sign and notarize when distribution requires it, and rerun the packaged critical journeys after signing. Apple Silicon is the initial baseline unless Intel or a universal build is explicitly supported and verified.
3. **Windows 11 x64:** build on Windows, exercise paths with spaces and non-ASCII characters, browser OAuth callback, process cancellation, SQLite native module, PDF worker, Lean/elan discovery, and signed installer.
4. **Ubuntu LTS x64:** build on Linux, test Web sandbox behavior, AppImage/deb file permissions, browser OAuth opening, Lean/elan discovery, and package-manager/manual update instructions.
5. **Multi-platform CI when porting begins:** renderer unit/component tests plus Electron E2E on `macos`, `windows`, and `ubuntu`; native package creation on the same OS matrix; release signing only in protected jobs. Electron documents Playwright/WebDriver-based [automated testing](https://www.electronjs.org/docs/latest/tutorial/automated-testing).

## Implementation validation gates

These are unknowns, not framework defects:

1. **Packaged Codex discovery:** does the chosen pinned `@openai/codex` package expose a runnable `app-server` binary after Forge packaging/ASAR on the documented supported macOS hardware? Verify spawn, schema generation, graceful shutdown, cancellation, and update compatibility.
2. **Auth ownership:** does app-server reuse the user's existing Codex login safely, or should the app isolate `CODEX_HOME`? Test ChatGPT browser/device flow, API-key switching, logout, token refresh, proxy/firewall behavior, and secrets never crossing renderer IPC.
3. **Non-Git Study Workspaces:** confirm app-server threads work in an ordinary Study Workspace with the intended sandbox/approval policy and canonical `cwd`, without silently broadening filesystem access.
4. **Bundled Lean validation:** validate the version-pinned default environment, compatible mathlib content, removal and reinstallation, offline checks, licence notices, cancellation, and process-tree cleanup on the documented supported macOS hardware.
5. **SQLite binding:** select an Electron-compatible driver only after clean macOS installs and packaged migrations pass on the documented supported hardware. Confirm ABI rebuilds, WAL/backup behavior, and recovery after interruption.
6. **Renderer fidelity:** stress PDF.js worker loading, large PDFs, HiDPI region-coordinate round trips, zoom/rotation, KaTeX/MathJax fonts, graph canvas/WebGL, printing, and accessibility in the packaged app.
7. **Resource budget:** measure cold start, idle memory, installer/download size, and a large Study Workspace. Treat a missed version-one budget as a release blocker and retain the equivalent Tauri comparison as evidence for a later architecture review.
8. **Release operations:** prove the supported packaged macOS artifact can still launch Codex and Lean child binaries after any applicable signing and notarization. Windows signing and Linux distribution remain in the deferred rollout matrix.

## Revisit trigger

Reconsider Tauri after the vertical slice if any of these become dominant: installer size, idle memory, a requirement for declarative path/command capabilities, a first-party SQLite layer, or in-app Linux updates. Do not switch merely because a minimal Tauri hello-world is smaller; compare the same packaged Study Workspace slice, including PDF.js, math fonts, SQLite, Codex, and the chosen Lean distribution.
