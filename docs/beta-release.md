# Quick Study macOS beta

This is an evaluation beta for the supported Apple Silicon baseline. It is not a public production release and makes no causal learning-effectiveness claim.

## Supported environment

- Apple Silicon Mac with macOS 14 Sonoma or later.
- At least 16 GB memory and 12 GB free disk space for the application, local data, indexes, and the bundled verifier.
- Network access and a supported Codex authentication path are needed for model-backed teaching. ChatGPT sign-in and OpenAI API-key sign-in are owned by Codex; Quick Study does not store either credential.
- Local Working Mode, Linked Sources, Session Records, annotations, search, artifacts, export, and installed Lean checks remain usable without Codex access.

The automated release lane runs on GitHub's `macos-14` runner with Node 24. The final local installed-artifact audit records the exact Mac, OS, candidate commit, archive digest, and operational measurements with the release evidence described in [`evaluation/README.md`](../evaluation/README.md).

The candidate quality report and its complete, non-private evidence are bundled under ignored `out/release/macos-beta-<version>/` only after `quality:gate:beta` passes. That bundle is attached to a GitHub prerelease whose tag targets the exact attested candidate commit, so publishing evidence does not change the candidate it describes. The deterministic harness fixture is uploaded separately by CI as `quality-gate-harness-fixture-only`; it is never included in or presented as the candidate report.

## Build and validate

The canonical setup, command matrix, packaging behavior, smoke coverage, and developer troubleshooting live in the [development guide](development.md). Use Node 24 from a clean checkout for the release lane and run the complete verification flow there before collecting candidate evidence.

The [evaluation guide](../evaluation/README.md) owns live model samples, blinded evaluator records, recovery evidence, candidate quality gates, and report publication. It also explains the exact-commit and evidence-binding rules. This beta guide intentionally keeps only the user-facing install boundary and limitations rather than duplicating those procedures.

For an evaluation install, use the architecture-native archive produced by the development guide and copy `Quick Study.app` to `/Applications` or another local Applications folder. The current archive is ad-hoc signed but not Developer ID signed or notarized. It is therefore suitable for local and CI evaluation, not public internet distribution; do not bypass organizational Gatekeeper policy to install it. Developer ID signing, notarization, and a post-notarization rerun are required before calling any artifact a public beta.

## Privacy and source access defaults

The complete current data-practices disclosure is the [privacy notice](../PRIVACY.md).
Security reports and conduct reports use their separate private channels in
[SECURITY.md](../SECURITY.md) and [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

- Application state stays in the local Electron `userData` directory.
- Linked Sources remain at their original locations. Study, indexing, export, and verification do not silently copy, replace, or modify them.
- The ad-hoc evaluation build is not App-Sandboxed. Its last-known path is location metadata, not persistent permission. It does not claim the security-scoped persistence of a provisioned Mac App Store build.
- Model access, external research, and Source Excerpt Egress are separate boundaries. Personal Notes remain excluded from ordinary teaching; optional artifact synthesis is the only governed exception.
- The source-safety smoke assertions compare the original Linked Source bytes after indexing, relocation recovery, snapshot creation, teaching, formal verification, artifact synthesis, export, quit, and relaunch.

## Recovery

- If Codex, authentication, quota, or network access is unavailable, use Local Working Mode and save Pending Questions for explicit later submission.
- If a Linked Source is missing or moved, use Retry or Locate again. Quick Study retains its identity and associations and does not reconstruct unavailable content from an index or fingerprint.
- If Lean installation or removal is interrupted, use the visible retry or cleanup action. Historical Verifier Manifests and proof evidence remain intact.
- If Quick Study quits with unfinished Agent Tasks, reopen the app and explicitly resume the checkpoint. Relaunch never resumes model spending automatically.
- Back up the local application-data directory before destructive machine repair. Linked Sources require their own normal backup because Quick Study does not own or duplicate them.

## Known limitations

- macOS only; Windows, Linux, mobile, and web are not supported.
- Apple Silicon is the validated beta baseline. Intel and universal archives are not claimed.
- The evaluation archive is not notarized and has no automatic updater.
- The non-App-Sandbox evaluation build cannot demonstrate production security-scoped bookmark persistence.
- Formal verification covers only exact app-supported statements in the recorded Lean environment. Checker failure is not mathematical disproof, and model or source agreement is not formal verification.
- The quality-gate fixture proves the harness only. A candidate needs separately collected release evidence for every benchmark and operational budget; missing evidence fails the gate.
- No causal learning benefit is claimed without a separately governed comparative study.

## Feedback

Report beta feedback through [GitHub Issues](https://github.com/jerome-queck/clarifold/issues/new). Do not attach learner records, source documents, credentials, Personal Notes, or other private data. Include the beta version, macOS version, Mac model, action attempted, visible error, and whether recovery succeeded.

## Maintenance

The maintainer reviews this guide when the supported beta environment, installation boundary, privacy defaults, recovery paths, known limitations, or feedback route changes. Development commands and candidate evidence remain owned by the [development](development.md) and [evaluation](../evaluation/README.md) guides.
