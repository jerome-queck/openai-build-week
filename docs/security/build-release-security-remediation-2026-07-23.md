# Build and release security remediation — 2026-07-23

Issue #86 turns the disclosure-safe triage in [`build-release-security-triage-2026-07-22.md`](build-release-security-triage-2026-07-22.md) into repeatable repository controls.

## Workflow trust boundary

The macOS verification job now has an explicit empty workflow permission baseline and grants only `contents: read` to its job. Pull requests, including untrusted fork contributions, receive no write, release, signing, or secret authority. Every third-party action is pinned to a reviewed full commit SHA, with its maintained version retained in a comment so Dependabot can propose pin updates:

- `actions/checkout` v7: `3d3c42e5aac5ba805825da76410c181273ba90b1`
- `actions/setup-node` v7: `820762786026740c76f36085b0efc47a31fe5020`
- `actions/cache` v6: `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`
- `actions/upload-artifact` v7: `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`

Dependabot's GitHub Actions update group remains enabled. A pin change is reviewable as a normal pull request and cannot self-approve or publish a release.

## Dependencies

On 2026-07-23 with Node 24, `npm audit --omit=dev --audit-level=high` reports zero production vulnerabilities. The full audit reports 24 development-only vulnerability nodes (3 low, 20 high, 1 critical), with the fixed `fast-uri` transitive package removed from that set and now locked at 3.1.4.

The remaining full-audit findings are transitive development-only paths and are not reachable from the packaged application or supported learner-controlled runtime. They remain time-bounded exceptions rather than silent dismissals:

| Root package | Path | Classification | Review-by | Evidence and condition |
| --- | --- | --- | --- | --- |
| `tar` | Electron Forge → Electron rebuild → node-gyp → make-fetch-happen | Development-only, transitive; no supported fix is available in the current stable Forge lane | 2026-10-23 | Packaging tooling runs only in the trusted build job; upgrade Forge/rebuild when a supported release removes the vulnerable range, then rerun the full audit and packaging lane |
| `tmp` | Electron Forge → Inquirer editor → external-editor | Development-only, transitive; no supported fix is available in the current stable Forge lane | 2026-10-23 | No learner or repository input reaches the editor's temporary-directory prefix; remove the exception when Forge's supported dependency graph updates |
| `shell-quote` | `concurrently` used only by the local development launcher | Development-only, transitive; no supported upgrade is available without changing the launcher major version | 2026-10-23 | The launcher is not used by CI or packaged runtime and receives only repository-authored commands; replace or upgrade the launcher before expiry |

The production audit command is a required CI check. The full audit must still be reviewed whenever Dependabot changes the lockfile; any new runtime finding or unlisted development path is a release blocker. This exception record is valid only through the review-by date and does not authorize introducing the affected packages into runtime dependencies.

## Secret scanning

The macOS CI checkout fetches full history and runs `npm run security:secrets`. That command downloads Gitleaks v8.30.1 for the runner architecture from the official release URL, verifies the pinned SHA-256 (`b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5` for arm64 and `dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709` for x64), and scans the complete Git history with no GitHub write authority or license secret. GitHub Secret Scanning remains the repository's hosted alerting control. The 2026-07-22 tracked-content and relevant-history scans reported no known live secret; a future finding must be handled privately and rotated before disclosure.

## Swift boundary

`npm run security:swift` runs Swift 6.4 compiler typechecking with warnings-as-errors for both native helpers and the scanned-PDF fixture. It runs before the broader verification lane and fails visibly on a compiler or warning regression. This is the documented equivalent analysis boundary from the triage; it does not replace the private-resource and filesystem ownership in #85.

## Release integrity

The packaged smoke installer now uses `lstat` to reject a symbolic-link application root before code-signature and verifier attestation. The candidate receipt binds the exact archive digest, candidate commit, extracted application, signature, and bundled verifier. After the beta upload, CI records the upload service's artifact digest together with that candidate receipt in a separately uploaded binding receipt. Publishing rejects a missing or digest-mismatched archive, and no signed or notarized public release is introduced by this change.
