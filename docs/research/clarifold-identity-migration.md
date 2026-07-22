# Clarifold identity migration scope

## Why this is a parent-spec workstream

`Quick Study` currently names the product package, Electron product, macOS application and archive, bundle identifier, default Electron data directory, CI artifacts, release documentation, runtime client identity, tests, environment variables, media types, verifier identifiers, and the built-in loose-work workspace. Those occurrences do not all mean the same thing. A global replacement would rename durable domain concepts that must remain Quick Study while failing to protect existing beta data.

The Clarifold parent spec must give identity migration its own implementation slice and make all later branding, icon, documentation, and public-release slices depend on the migrated identity contract.

## Target public identity

- Product, macOS application, and executable: `Clarifold`.
- Repository and package slug: `clarifold`.
- macOS bundle identifier: `org.jeromegroup.clarifold`.
- Built-in loose-work Study Workspace: `Quick Study`, retaining its existing durable workspace and mission identifiers.
- Historical Quick Study release evidence remains historically named; do not rewrite it as if it had been produced under the Clarifold name. After Build Week was abandoned, the three unpublished-in-practice candidate prereleases and their matching tags were explicitly approved for deletion and removed on 2026-07-21; every asset had recorded zero downloads, and the empty Releases list and candidate-tag namespace were verified afterward.

## Data migration contract

Before the normal application services open the new default data directory, Clarifold must:

1. Distinguish an explicit development or test data-directory override from the default Electron `userData` path. Overrides never trigger migration of a person's default data.
2. Detect whether the old Quick Study default directory exists and whether the new Clarifold default directory is absent or empty.
3. Acquire a migration guard so concurrent launches cannot perform the migration twice.
4. Copy the old directory into a staging location on the same filesystem without altering the source.
5. Validate the staged canonical `learning-application.json` through the application's real loading and migration boundary. Treat the Source Index as rebuildable, while preserving source identities, revision history, learner records, artifacts, verification evidence, and the Verifier Environment Registry consistently.
6. Activate the staged directory atomically only after validation and write a durable migration receipt identifying source, destination, application version, time, and result without learner content.
7. Leave the old Quick Study directory unchanged as a rollback source. This work must not introduce automatic deletion.

If the destination already contains meaningful data, the source is incomplete, the copy is interrupted, validation fails, or free space is insufficient, Clarifold must not merge, overwrite, or claim success. It must leave the source intact, clean or quarantine only its own staging output, and present an actionable recovery state. Reopening after interruption must be idempotent.

Linked Sources remain externally owned files and folders. Migration preserves their durable references and never copies, moves, or rewrites the source material itself. Codex authentication remains owned by Codex and is not treated as Clarifold learner data to migrate.

## Rename surfaces the spec must classify

The implementation inventory must distinguish:

- **Rename now:** product metadata, window/document titles that mean the app, app-support copy, package and archive paths, bundle metadata, release/CI artifact names, repository URLs, runtime client title, public documentation, screenshots, and installation instructions.
- **Preserve as domain language:** the built-in Quick Study workspace, its durable IDs, filing behavior, and historical records that refer to that workspace.
- **Migrate or alias deliberately:** environment-variable prefixes, runtime client machine name, media types, verifier-environment IDs, cache paths, and other identifiers consumed outside a single process. `CLARIFOLD_*` is the canonical documented environment-variable namespace and one central configuration adapter maps external inputs to brand-neutral internal configuration fields. Source code outside that adapter, tests, CI, scripts, and documentation must use the canonical configuration or new names rather than spreading environment lookups. Only the genuinely user-facing `QUICK_STUDY_DATA_DIR` remains accepted for one Clarifold beta, with a visible deprecation warning and lower precedence than `CLARIFOLD_DATA_DIR`; internal, CI, diagnostic, and test-only `QUICK_STUDY_*` variables are renamed without compatibility aliases. Durable persisted identifiers remain unchanged wherever a rename would endanger historical records or provenance.
- **Keep historical:** evidence and decision records for the withdrawn Quick Study prereleases, tags, checksums, and release manifests. The deleted remote releases and tags are not recreated merely to preserve that history.

## Required verification

The parent spec and tickets must require at least:

- Unit tests for absent source, empty destination, populated destination, interrupted staging, invalid state, insufficient-space or copy failure, retry, and successful idempotent migration.
- A migration test containing durable sessions, Personal Notes, Learning Artifacts, Source Anchors, a missing or moved Linked Source, source-index state, verifier manifests/evidence, and a removable verifier environment.
- Proof that explicit test/development data directories cannot touch default user data.
- Packaged verification that installs and launches a Quick Study beta fixture, creates learner state, launches packaged Clarifold, migrates once, resumes the exact state, and leaves the old directory intact.
- Packaged verification of the new bundle identifier, application name, archive name, icon, code signature, resources, repository links, privacy/support surfaces, and quit/relaunch behavior.
- Rollback evidence showing the preserved Quick Study directory remains readable by the historical beta fixture after Clarifold migration.
- A repository-wide semantic search in review so every remaining `Quick Study`, `quick-study`, and `QUICK_STUDY` occurrence is classified as preserved, historical, compatibility-bound, or erroneous.
- Updated development, architecture, beta/release, privacy, licensing, contribution, and README documentation in the same slices that change their owning facts.

## Release and operational constraints

- Do not publish a Clarifold artifact until the migration and installed-app tests pass on the release candidate.
- Pull-request CI packages only when a fail-closed path classifier finds an artifact-affecting change; every `main` integration and release candidate still runs the complete packaging lane. Routine CI does not retain the approximately 1.1 GB application archive. Retain small reports and diagnostics for 14 days; retain the exact artifact from a manually dispatched release-candidate workflow for 30 days; promote that verified artifact to the GitHub prerelease without rebuilding it.
- Until Apple Developer Program enrollment makes Developer ID signing and notarization possible, candidate archives are named `internal-candidate-not-for-distribution`, no prebuilt app is attached to GitHub Releases, and the README offers build-from-source only. The package line moves to `0.2.0`, but the first public prerelease version is chosen when signed distribution actually becomes feasible.
- Warn against running Quick Study and Clarifold concurrently after migration because their retained directories can diverge; do not imply ongoing two-way synchronization.
- Never rewrite an existing release or move its tag merely to make history appear consistently branded. The separately approved deletion of the never-consumed Quick Study candidate releases was cleanup, not historical relabeling.
- Repository rename and application-link changes must be sequenced so README, in-app feedback links, issue forms, release documentation, and candidate evidence resolve at the public cutover.
- Remove the legacy `QUICK_STUDY_DATA_DIR` compatibility input in the next breaking beta after its one-beta transition, and make that removal explicit in release notes and verification.
- The application migration uses the approved internal `0.2.0` package line. The first public prerelease version remains deliberately unset until signed distribution is feasible and is selected from the then-current product state.

## Final local-workspace migration

The current local workspace remains `/Users/jeromequeck/Hackathons/OpenAI Build Week` throughout planning, implementation, review, merge, and integrated verification because the active Codex workspace and repository-local skill paths resolve through it. Only after the Clarifold migration has merged and the active task is complete should the directory move to `/Users/jeromequeck/Hackathons/Clarifold`. Perform that as a separate final operation, reopen Codex on the new path, and verify the canonical Git remote, clean branch state, repository instructions and skill discovery, Node 24 setup, `npm ci`, the normal verification entrypoint, and any machine-level scripts or shortcuts that contain the old absolute path. Do not create a compatibility symlink unless a verified external dependency genuinely requires it; prefer updating the owning reference.
