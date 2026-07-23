# Public-cutover security gate — 2026-07-23

## Decision

**PASS for downstream Clarifold public-repository and rebrand work, with the residual-risk register below.**

This gate audits the integrated security candidate after runtime and learner-facing triage (#82), build/release triage (#83), and their remediation tickets (#84–#86). It does not authorize a signed or notarized public download, close parent issue #81, or replace the later migration, legal, identity, accessibility, release, or human-brand gates.

The audited product candidate is the exact `main` merge revision [`01320782654a854e01afd45431c84a35002ae6a0`](https://github.com/jerome-queck/clarifold/commit/01320782654a854e01afd45431c84a35002ae6a0), merged by [PR #121](https://github.com/jerome-queck/clarifold/pull/121) for #86. Evidence below was collected on 2026-07-23 with Node `v24.11.0` on macOS arm64. The gate record is a documentation receipt for that candidate; the PR carrying this record must run the same checks again on its own merge revision.

## Acceptance matrix

| Requirement | Result | Evidence |
| --- | --- | --- |
| Triage findings have a fix, evidence-backed dismissal, or approved exception | **Pass** | [#82](https://github.com/jerome-queck/clarifold/issues/82) records 24/24 runtime receipts and three private draft advisories; [#83](https://github.com/jerome-queck/clarifold/issues/83) records 87/87 build/release receipts. [#84](https://github.com/jerome-queck/clarifold/issues/84), [#85](https://github.com/jerome-queck/clarifold/issues/85), and [#86](https://github.com/jerome-queck/clarifold/issues/86) are closed through [PR #110](https://github.com/jerome-queck/clarifold/pull/110), [PR #114](https://github.com/jerome-queck/clarifold/pull/114), and [PR #121](https://github.com/jerome-queck/clarifold/pull/121). |
| No high or critical finding lacks an explicit time-bounded exception | **Pass** | The only remaining high/critical findings are transitive development-tool paths listed in the residual-risk register. Jerome Queck owns and approved the exceptions through 2026-10-23. No production dependency vulnerability is present. |
| Full repository verification passes on the audited revision | **Pass** | `PATH=/Users/jeromequeck/.nvm/versions/node/v24.11.0/bin:$PATH npm run verify` passed on `0132078`: 27 test files, 411 tests, quality fixture, macOS package, beta make, one index-budget smoke, and eight functional packaged checks (one intentional skip). |
| Security diff review and applicable scanners pass | **Pass** | The integrated remediation diffs were reviewed through the security route and ordinary two-axis review in their delivery PRs. On this candidate, production audit, full-history Gitleaks, Swift warnings-as-errors analysis, and hosted CodeQL all passed; the two newly surfaced CodeQL path variants were reviewed and dismissed as false positives with public, disclosure-safe evidence ([alert 82](https://github.com/jerome-queck/clarifold/security/code-scanning/82), [alert 84](https://github.com/jerome-queck/clarifold/security/code-scanning/84)). |
| Packaged checks exercise remediated boundaries | **Pass** | The packaged suite covered source/access and path controls, durable session persistence and reload, verifier/artifact lifecycle, action diagnostics, and child-controlled authentication-destination rejection. The exact installed receipt is `test-results/beta-install.json`; its candidate is `0132078` and its arm64 archive digest is `562adab7ddc7667a8a6817a7105639575facb5eb17eb2b43e6a432ab85bdca74`. |
| Dependency, workflow, secret-scanning, and Swift evidence is reviewable | **Pass** | See the evidence ledger below. Workflow permissions and action pins are recorded in [`build-release-security-remediation-2026-07-23.md`](build-release-security-remediation-2026-07-23.md); GitHub security settings, CodeQL, Dependabot, and secret-scanning state were read from the live repository API. |
| Residual risk has expiry and owner without exploitable disclosure | **Pass** | The residual-risk register names Jerome Queck as owner and approver, sets a 2026-10-23 review-by date, records trigger conditions, and keeps private advisory details out of this public record. |
| Downstream rebrand/public-repository work receives a decision | **Pass** | Security is an approved prerequisite for the downstream Clarifold work. Each downstream ticket remains responsible for its own exact integrated acceptance lane and must not interpret this decision as release, licensing, icon, migration, or parent-spec completion. |

## Evidence ledger

### Local candidate checks

| Check | Result |
| --- | --- |
| `npm run security:dependencies` | Pass: production dependency audit reported zero vulnerabilities. |
| `npm audit --json` | 24 vulnerable development-only dependency nodes: 3 low, 20 high, 1 critical. All are transitive paths rooted in `tar`, `tmp`, or `shell-quote`; none is in the production dependency graph. |
| `npm run security:secrets` | Pass: pinned Gitleaks scanned 100 commits and approximately 3.57 MB; no leaks found. |
| `npm run security:swift` | Pass: Swift 6.4 warnings-as-errors typechecking covered both native helpers and the scanned-PDF fixture. |
| `npm run verify` | Pass: see the acceptance matrix. The generated arm64 receipt binds the installed archive, candidate commit, packaged signature, bundled verifier, persistence journeys, and operational budgets. |

### Hosted repository checks

- The exact candidate's [macOS CI run](https://github.com/jerome-queck/clarifold/actions/runs/29998050221) passed `verify`. The exact candidate's [CodeQL run](https://github.com/jerome-queck/clarifold/actions/runs/29998049879) passed both Actions and JavaScript/TypeScript analysis.
- The workflow has `permissions: {}` at the workflow level and grants only `contents: read` to the verification job. Third-party actions are pinned to reviewed full commit SHAs. The job has no release, signing, write-token, or secret authority.
- Live CodeQL state has no open alerts after the false-positive closures above. The two dismissed alerts point only at the dirname of application state/cache paths whose upstream is launch-time local configuration or platform-owned `userData`; neither is renderer, network, learner, or model input.
- GitHub Secret Scanning has no alerts. Repository secret scanning and push protection are enabled; non-provider pattern scanning and validity checks remain disabled as an intentional repository setting.
- GitHub Dependabot currently reports 11 open alerts, all transitive development dependencies. The alert state is not silently treated as zero; the applicable paths and expiry are recorded below.
- Branch protection requires the strict `verify` status check and linear history, rejects force-pushes and deletion, and enables merged-branch deletion. The repository remains public with Discussions disabled.

## Residual-risk register

These are explicit, time-bounded development-tool exceptions. They do not authorize moving the affected packages into runtime dependencies or accepting attacker-controlled input in the trusted build lane.

| Root path | Reachability and impact boundary | Owner / approver | Review-by | Required follow-up |
| --- | --- | --- | --- | --- |
| `tar` through Electron Forge → Electron rebuild → node-gyp → make-fetch-happen/cacache | Development-only packaging tooling; no supported learner or repository input reaches the extraction path in this lane. The package is not shipped as application runtime code. | Jerome Queck | 2026-10-23 | Upgrade the supported Forge/rebuild graph when it removes the vulnerable range, then rerun the full audit and packaging lane. Re-rate immediately if an untrusted archive or runtime path is introduced. |
| `tmp` through Electron Forge → Inquirer editor → external-editor | Development-only interactive tooling; the supported lane supplies repository-authored commands and no learner-controlled temporary-directory prefix. | Jerome Queck | 2026-10-23 | Upgrade the supported Forge/Inquirer graph when available and rerun the full audit. Re-rate immediately if the editor becomes reachable from untrusted input. |
| `shell-quote` through the local `concurrently` launcher | Development-only local launcher; it is not used by CI or packaged runtime and receives repository-authored commands only. | Jerome Queck | 2026-10-23 | Replace or upgrade the launcher before expiry, then rerun the full audit. Do not use this exception to parse learner or remote command strings. |

The three private draft advisories from #82 remain private and disclosure-safe. Their remediation invariants and exact evidence stay in the private security records and the linked remediation PRs. Any future public disclosure, hosted service, signed release, or new externally reachable input requires a fresh severity and attack-path review before relying on this gate.

## Limitations and revalidation triggers

- This record is candidate-bound to `0132078`; a later commit invalidates the exact revision, package digest, scanner snapshot, and hosted check references as evidence for that later commit.
- A new production dependency advisory, open high/critical CodeQL finding, secret alert, workflow authority, release credential, hosted service, signed/notarized distribution path, or attacker-controlled build input reopens this gate.
- The unsigned internal beta remains suitable for technical evaluation and build-from-source use only. This security pass is not a public-distribution approval.
